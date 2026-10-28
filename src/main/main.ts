import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, session } from "electron";
import type { AudioCapturePayload } from "../audio/audio-types";
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
const controller = new DemoController();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererFilePath = path.join(currentDirectory, "..", "renderer", "index.html");
const rendererDocumentUrl = pathToFileURL(rendererFilePath).href;
const rendererPermissionOrigin = permissionOriginForDocument(rendererDocumentUrl);

if (process.env.DEMO_CAPTURE_PATH?.trim()) {
  app.disableHardwareAcceleration();
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
  ipcMain.handle(ipcChannels.initializeRuntime, () => controller.initializeRuntime());
  ipcMain.handle(ipcChannels.prepareOffline, () =>
    controller.prepareOffline((event) => {
      mainWindow?.webContents.send(ipcChannels.progress, event);
    }),
  );
  ipcMain.handle(ipcChannels.prepareAudio, () =>
    controller.prepareAudio((event) => {
      mainWindow?.webContents.send(ipcChannels.progress, event);
    }),
  );
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
  ipcMain.handle(ipcChannels.transcribeAudio, (_event, request: AudioCapturePayload) =>
    controller.transcribeAudio(request, (progress) => {
      mainWindow?.webContents.send(ipcChannels.progress, progress);
    }),
  );
  ipcMain.handle(ipcChannels.runTurn, (_event, request: RunTurnRequest) =>
    controller.runTurn(request, (progress) => {
      mainWindow?.webContents.send(ipcChannels.progress, progress);
    }),
  );
  ipcMain.handle(ipcChannels.resetConversation, () => controller.reset());
}

registerIpc();

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const gate = microphonePermissionGate;
    return (
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
      }) ?? false
    );
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const gate = microphonePermissionGate;
    callback(
      gate?.allowRequest({
        webContents,
        mainFrame: webContents.mainFrame,
        currentDocumentUrl: webContents.getURL(),
        mainFrameUrl: webContents.mainFrame.url,
        permission,
        requestingUrl: details.requestingUrl,
        securityOrigin: "securityOrigin" in details ? details.securityOrigin : undefined,
        mediaTypes: "mediaTypes" in details ? details.mediaTypes : undefined,
        isMainFrame: details.isMainFrame,
      }) ?? false,
    );
  });
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

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
      console.error("Failed to shut down Foundry Local cleanly:", error);
    })
    .finally(() => app.quit());
});
