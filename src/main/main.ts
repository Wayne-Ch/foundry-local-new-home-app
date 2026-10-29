import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain, session } from "electron";
import type {
  AudioCapturePayload,
  AudioStreamCancelRequest,
  AudioStreamChunkRequest,
  AudioStreamFinishRequest,
  AudioStreamStartRequest,
  PrepareAudioRequest,
} from "../audio/audio-types";
import { ipcChannels, type MicrophoneAuthorizationRequest, type RunTurnRequest } from "../shared/contracts";
import { DemoController } from "./demo-controller";
import {
  isAllowedAppNavigation,
  MicrophonePermissionGate,
  permissionOriginForDocument,
} from "./microphone-permission";

let mainWindow: BrowserWindow | null = null;
let microphonePermissionGate: MicrophonePermissionGate | null = null;
let shutdownStarted = false;
const microphonePermissionProbeEnabled = process.env.DEMO_MIC_PERMISSION_PROBE === "1";
const controller = new DemoController();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererFilePath = path.join(currentDirectory, "..", "renderer", "index.html");
const rendererDocumentUrl = pathToFileURL(rendererFilePath).href;
const rendererPermissionOrigin = permissionOriginForDocument(rendererDocumentUrl);
let microphonePermissionProbeCheck:
  | {
      readonly requestingOrigin: string;
      readonly requestingUrl: string | undefined;
      readonly securityOrigin: string | undefined;
      readonly mediaType: string | undefined;
      readonly allowed: boolean;
    }
  | undefined;
let microphonePermissionProbeRequest:
  | {
      readonly requestingUrl: string | undefined;
      readonly securityOrigin: string | undefined;
      readonly mediaTypes: readonly string[] | undefined;
      readonly allowed: boolean;
    }
  | undefined;

if (process.env.DEMO_CAPTURE_PATH?.trim()) {
  app.disableHardwareAcceleration();
}
if (microphonePermissionProbeEnabled) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: "#07111f",
    title: "Foundry Local New Home Layout Demo",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const permissionGate = new MicrophonePermissionGate({
    expectedWebContents: window.webContents,
    expectedDocumentUrl: rendererDocumentUrl,
    expectedOrigin: rendererPermissionOrigin,
  });
  microphonePermissionGate = permissionGate;
  window.webContents.setWindowOpenHandler(() => {
    permissionGate.revoke();
    return { action: "deny" };
  });
  window.webContents.on("will-frame-navigate", (event) => {
    permissionGate.revoke();
    if (!isAllowedAppNavigation(rendererDocumentUrl, event.url, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-redirect", (event) => {
    permissionGate.revoke();
    if (!isAllowedAppNavigation(rendererDocumentUrl, event.url, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  window.webContents.on("render-process-gone", () => permissionGate.revoke());
  window.on("closed", () => {
    permissionGate.revoke();
    if (mainWindow === window) {
      mainWindow = null;
      microphonePermissionGate = null;
    }
  });

  void window.loadURL(rendererDocumentUrl);
  window.once("ready-to-show", () => {
    window.show();
  });
  if (process.env.DEMO_SMOKE_AND_EXIT === "1") {
    window.webContents.once("did-finish-load", () => {
      setTimeout(() => app.quit(), 5000);
    });
  }
  if (microphonePermissionProbeEnabled) {
    window.webContents.once("did-finish-load", () => {
      void runMicrophonePermissionProbe(window);
    });
  }
  if (process.env.DEMO_OPEN_DEVTOOLS === "1") {
    window.webContents.openDevTools({ mode: "detach" });
  }

  const capturePath = process.env.DEMO_CAPTURE_PATH?.trim();
  if (capturePath) {
    window.webContents.once("did-finish-load", async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const image = await window.webContents.capturePage();
        await mkdir(path.dirname(capturePath), { recursive: true });
        await writeFile(capturePath, image.toPNG());
        if (process.env.DEMO_CAPTURE_AND_EXIT === "1") {
          app.quit();
        }
      } catch (error) {
        console.error("Failed to capture Electron UI:", error);
        app.exit(1);
      }
    });
  }

  return window;
}

function registerIpc(): void {
  ipcMain.handle(ipcChannels.getBootstrap, () => controller.bootstrap());
  ipcMain.handle(ipcChannels.initializeRuntime, () =>
    microphonePermissionProbeEnabled ? controller.bootstrap().readiness : controller.initializeRuntime(),
  );
  ipcMain.handle(ipcChannels.prepareOffline, () =>
    controller.prepareOffline((event) => {
      mainWindow?.webContents.send(ipcChannels.progress, event);
    }),
  );
  ipcMain.handle(ipcChannels.prepareAudio, (event, request: PrepareAudioRequest) => {
    assertTrustedRendererIpc(event);
    return controller.prepareAudio(request, (progress) => {
      mainWindow?.webContents.send(ipcChannels.progress, progress);
    });
  });
  ipcMain.handle(ipcChannels.startAudioStream, (event, request: AudioStreamStartRequest) => {
    assertTrustedRendererIpc(event);
    return controller.startAudioStream(request, (partial) => {
      mainWindow?.webContents.send(ipcChannels.audioPartial, partial);
    });
  });
  ipcMain.handle(ipcChannels.appendAudioChunk, (event, request: AudioStreamChunkRequest) => {
    assertTrustedRendererIpc(event);
    return controller.appendAudioStreamChunk(request);
  });
  ipcMain.handle(ipcChannels.finishAudioStream, (event, request: AudioStreamFinishRequest) => {
    assertTrustedRendererIpc(event);
    return controller.finishAudioStream(request, (progress) => {
      mainWindow?.webContents.send(ipcChannels.progress, progress);
    });
  });
  ipcMain.handle(ipcChannels.cancelAudioStream, (event, request: AudioStreamCancelRequest) => {
    assertTrustedRendererIpc(event);
    return controller.cancelAudioStream(request);
  });
  ipcMain.handle(ipcChannels.authorizeMicrophone, (event, request: MicrophoneAuthorizationRequest) => {
    const window = mainWindow;
    const gate = microphonePermissionGate;
    const frame = event.senderFrame;
    if (
      window === null ||
      gate === null ||
      !gate.authorize({
        webContents: event.sender,
        frame,
        mainFrame: event.sender.mainFrame,
        documentUrl: event.sender.getURL(),
        frameUrl: frame?.url ?? "",
        hasTransientUserActivation: request?.hasTransientUserActivation === true,
      })
    ) {
      throw new Error("Microphone capture was not authorized by an active app gesture.");
    }
  });
  ipcMain.handle(ipcChannels.transcribeAudio, (event, request: AudioCapturePayload) => {
    assertTrustedRendererIpc(event);
    return controller.transcribeAudio(request, (progress) => {
      mainWindow?.webContents.send(ipcChannels.progress, progress);
    });
  });
  ipcMain.handle(ipcChannels.runTurn, (_event, request: RunTurnRequest) =>
    controller.runTurn(request, (progress) => {
      mainWindow?.webContents.send(ipcChannels.progress, progress);
    }),
  );
  ipcMain.handle(ipcChannels.resetConversation, () => controller.reset());
}

function assertTrustedRendererIpc(event: IpcMainInvokeEvent): void {
  const window = mainWindow;
  const frame = event.senderFrame;
  if (
    window === null ||
    event.sender !== window.webContents ||
    frame === null ||
    frame !== event.sender.mainFrame ||
    event.sender.getURL() !== rendererDocumentUrl ||
    frame.url !== rendererDocumentUrl
  ) {
    throw new Error("Audio IPC is restricted to the active application main frame.");
  }
}

registerIpc();

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const gate = microphonePermissionGate;
    const allowed =
      gate?.allowCheck({
        webContents,
        mainFrame: webContents?.mainFrame ?? null,
        currentDocumentUrl: webContents?.getURL() ?? "",
        mainFrameUrl: webContents?.mainFrame.url ?? "",
        permission,
        requestingOrigin,
        requestingUrl: details.requestingUrl,
        securityOrigin: details.securityOrigin,
        mediaType: details.mediaType,
        isMainFrame: details.isMainFrame,
      }) ?? false;
    if (microphonePermissionProbeEnabled) {
      microphonePermissionProbeCheck = {
        requestingOrigin,
        requestingUrl: details.requestingUrl,
        securityOrigin: details.securityOrigin,
        mediaType: details.mediaType,
        allowed,
      };
    }
    return allowed;
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const gate = microphonePermissionGate;
    const securityOrigin = "securityOrigin" in details ? details.securityOrigin : undefined;
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    const allowed =
      gate?.allowRequest({
        webContents,
        mainFrame: webContents.mainFrame,
        currentDocumentUrl: webContents.getURL(),
        mainFrameUrl: webContents.mainFrame.url,
        permission,
        requestingUrl: details.requestingUrl,
        securityOrigin,
        mediaTypes,
        isMainFrame: details.isMainFrame,
      }) ?? false;
    if (microphonePermissionProbeEnabled) {
      microphonePermissionProbeRequest = {
        requestingUrl: details.requestingUrl,
        securityOrigin,
        mediaTypes,
        allowed,
      };
    }
    callback(allowed);
  });
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

async function runMicrophonePermissionProbe(window: BrowserWindow): Promise<void> {
  try {
    const rendererResult = (await window.webContents.executeJavaScript(
      `(async () => {
          await window.demoApi.authorizeMicrophone();
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          const result = {
            documentUrl: window.location.href,
            audioTrackCount: stream.getAudioTracks().length,
            videoTrackCount: stream.getVideoTracks().length,
          };
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return result;
        })()`,
      true,
    )) as {
      readonly documentUrl: string;
      readonly audioTrackCount: number;
      readonly videoTrackCount: number;
    };

    if (
      rendererResult.documentUrl !== rendererDocumentUrl ||
      rendererResult.audioTrackCount < 1 ||
      rendererResult.videoTrackCount !== 0 ||
      microphonePermissionProbeRequest?.allowed !== true ||
      microphonePermissionProbeRequest.requestingUrl !== rendererDocumentUrl ||
      microphonePermissionProbeRequest.securityOrigin !== rendererPermissionOrigin ||
      microphonePermissionProbeRequest.mediaTypes?.length !== 1 ||
      microphonePermissionProbeRequest.mediaTypes[0] !== "audio"
    ) {
      throw new Error(
        `Microphone permission probe did not reach the exact grant path: ${JSON.stringify({
          rendererDocumentUrl,
          rendererPermissionOrigin,
          rendererResult,
          permissionCheck: microphonePermissionProbeCheck,
          permissionRequest: microphonePermissionProbeRequest,
        })}`,
      );
    }

    console.log(
      `MICROPHONE_PERMISSION_PROBE_OK ${JSON.stringify({
        rendererDocumentUrl,
        rendererPermissionOrigin,
        rendererResult,
        permissionCheck: microphonePermissionProbeCheck,
        permissionRequest: microphonePermissionProbeRequest,
      })}`,
    );
  } catch (error) {
    process.exitCode = 1;
    console.error("MICROPHONE_PERMISSION_PROBE_FAILED", error);
  } finally {
    app.quit();
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shutdownStarted) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  void controller
    .shutdown()
    .catch((error: unknown) => {
      process.exitCode = 1;
      console.error("Failed to shut down Foundry Local cleanly:", error);
    })
    .finally(() => app.quit());
});
