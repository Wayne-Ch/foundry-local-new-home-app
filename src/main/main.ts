import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  session,
  type WebContents,
  type WebFrameMain,
} from "electron";
import type {
  AudioCapturePayload,
  AudioStreamCancelRequest,
  AudioStreamChunkRequest,
  AudioStreamFinishRequest,
  AudioStreamStartRequest,
  PrepareAudioRequest,
} from "../audio/audio-types";
import type { ManualPlacementRequest } from "../domain/manual-placement";
import { NEW_HOME_APP_ID, NEW_HOME_PRODUCT_NAME, resolveNewHomeProductPaths } from "../foundry/paths";
import { ipcChannels, type MicrophoneAuthorizationRequest, type RunTurnRequest } from "../shared/contracts";
import {
  type AudioStreamLease,
  type AudioStreamOwnerIdentity,
  AudioStreamOwnership,
} from "./audio-stream-owner";
import { DemoController } from "./demo-controller";
import {
  isAllowedAppNavigation,
  MicrophonePermissionGate,
  permissionOriginForDocument,
} from "./microphone-permission";
import { RendererLifecycleErrorMonitor } from "./renderer-lifecycle-errors";
import { createResetConversationHandler } from "./reset-handshake";

let mainWindow: BrowserWindow | null = null;
let mainWebContents: WebContents | null = null;
let microphonePermissionGate: MicrophonePermissionGate | null = null;
let shutdownStarted = false;
const microphonePermissionProbeEnabled = process.env.DEMO_MIC_PERMISSION_PROBE === "1";
const rendererResetProbeEnabled = process.env.DEMO_RENDERER_RESET_PROBE === "1";
const streamOwnerProbeEnabled = process.env.DEMO_STREAM_OWNER_PROBE === "1";
const rendererLifecycleProbeEnabled = rendererResetProbeEnabled || streamOwnerProbeEnabled;
let rendererResetProbeTerminating = false;
let streamOwnerProbeTerminating = false;

interface RendererLifecycleProbeLease {
  readonly lease: AudioStreamLease;
  streamId: string | null;
  activated: boolean;
  chunkCount: number;
  totalBytes: number;
}

interface RendererLifecycleProbeCancellation {
  readonly streamId: string;
  readonly startedAt: number;
  completedAt: number | null;
  failure: string | null;
}

const rendererLifecycleProbeLeases: RendererLifecycleProbeLease[] = [];
const rendererLifecycleProbeCancellations: RendererLifecycleProbeCancellation[] = [];
const rendererLifecycleProbeTrackStops = new Set<string>();
const rendererLifecycleErrorMonitor = new RendererLifecycleErrorMonitor();
let rendererLifecycleProbeMonitorReady: Promise<void> = Promise.resolve();
const rendererTrackStopMarker = "ELECTRON_RENDERER_MEDIA_TRACK_STOP ";
const controller = new DemoController();
const audioStreamOwnership = new AudioStreamOwnership(async (streamId) => {
  const probeCancellation: RendererLifecycleProbeCancellation | null = rendererLifecycleProbeEnabled
    ? {
        streamId,
        startedAt: performance.now(),
        completedAt: null,
        failure: null,
      }
    : null;
  if (probeCancellation !== null) {
    rendererLifecycleProbeCancellations.push(probeCancellation);
  }
  try {
    await controller.cancelAudioStream({ streamId });
    if (probeCancellation !== null) {
      probeCancellation.completedAt = performance.now();
    }
  } catch (error) {
    if (probeCancellation !== null) {
      probeCancellation.failure = error instanceof Error ? error.message : String(error);
    }
    throw error;
  }
});
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

const productPaths = resolveNewHomeProductPaths();
for (const directory of [
  productPaths.electronProfileDir,
  productPaths.electronSessionDir,
  productPaths.electronLogsDir,
  productPaths.electronTempDir,
  productPaths.crashDumpsDir,
]) {
  mkdirSync(directory, { recursive: true });
}
app.setName(NEW_HOME_PRODUCT_NAME);
app.setAppUserModelId(NEW_HOME_APP_ID);
app.setPath("userData", productPaths.electronProfileDir);
app.setPath("sessionData", productPaths.electronSessionDir);
app.setPath("logs", productPaths.electronLogsDir);
app.setPath("temp", productPaths.electronTempDir);
app.setPath("crashDumps", productPaths.crashDumpsDir);

if (process.env.DEMO_CAPTURE_PATH?.trim()) {
  app.disableHardwareAcceleration();
}
if (microphonePermissionProbeEnabled) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
}
if (rendererLifecycleProbeEnabled) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch(
    "use-file-for-fake-audio-capture",
    path.resolve("tests", "fixtures", "queen-desk.wav"),
  );
}
if (rendererResetProbeEnabled) {
  process.on("uncaughtException", (error) => failRendererResetProbe("UNCAUGHT_EXCEPTION", error));
  process.on("unhandledRejection", (error) => failRendererResetProbe("UNHANDLED_REJECTION", error));
}
if (streamOwnerProbeEnabled) {
  process.on("uncaughtException", (error) => failStreamOwnerProbe("UNCAUGHT_EXCEPTION", error));
  process.on("unhandledRejection", (error) => failStreamOwnerProbe("UNHANDLED_REJECTION", error));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: "#07111f",
    title: NEW_HOME_PRODUCT_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const webContents = window.webContents;
  const webContentsId = webContents.id;
  mainWebContents = webContents;
  if (rendererLifecycleProbeEnabled) {
    webContents.on("console-message", (event) => {
      recordRendererLifecycleProbeMessage(String(event.level), event.message);
    });
    rendererLifecycleProbeMonitorReady = attachRendererLifecycleProbeMonitor(webContents);
  }

  const permissionGate = new MicrophonePermissionGate({
    expectedWebContents: webContents,
    expectedDocumentUrl: rendererDocumentUrl,
    expectedOrigin: rendererPermissionOrigin,
  });
  microphonePermissionGate = permissionGate;
  webContents.setWindowOpenHandler(() => {
    permissionGate.revoke();
    return { action: "deny" };
  });
  webContents.on("will-frame-navigate", (event) => {
    permissionGate.revoke();
    if (event.isMainFrame) {
      revokeAudioStreamOwner(webContentsId, frameOwnership(event.frame));
    }
    if (!isAllowedAppNavigation(rendererDocumentUrl, event.url, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  webContents.on("will-redirect", (event) => {
    permissionGate.revoke();
    if (event.isMainFrame) {
      revokeAudioStreamOwner(webContentsId, frameOwnership(event.frame));
    }
    if (!isAllowedAppNavigation(rendererDocumentUrl, event.url, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  webContents.on("did-start-navigation", (event) => {
    if (event.isMainFrame && !event.isSameDocument) {
      revokeAudioStreamOwner(webContentsId);
    }
  });
  webContents.on("render-process-gone", () => {
    permissionGate.revoke();
    revokeAudioStreamOwner(webContentsId);
  });
  webContents.on("destroyed", () => {
    revokeAudioStreamOwner(webContentsId);
    if (mainWebContents === webContents) {
      mainWebContents = null;
    }
  });
  window.on("closed", () => {
    permissionGate.revoke();
    revokeAudioStreamOwner(webContentsId);
    if (mainWindow === window) {
      mainWindow = null;
      if (mainWebContents === webContents) {
        mainWebContents = null;
      }
      microphonePermissionGate = null;
    }
  });

  void webContents.loadURL(rendererDocumentUrl);
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });
  if (process.env.DEMO_SMOKE_AND_EXIT === "1") {
    webContents.once("did-finish-load", () => {
      setTimeout(() => app.quit(), 5000);
    });
  }
  if (microphonePermissionProbeEnabled) {
    webContents.once("did-finish-load", () => {
      void runMicrophonePermissionProbe(webContents);
    });
  }
  if (rendererResetProbeEnabled) {
    webContents.once("did-finish-load", () => {
      void runRendererResetProbe(window, webContents);
    });
  }
  if (streamOwnerProbeEnabled) {
    webContents.once("did-finish-load", () => {
      void runStreamOwnerProbe(window, webContents);
    });
  }
  if (process.env.DEMO_OPEN_DEVTOOLS === "1") {
    webContents.openDevTools({ mode: "detach" });
  }

  const capturePath = process.env.DEMO_CAPTURE_PATH?.trim();
  if (capturePath) {
    webContents.once("did-finish-load", async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (webContents.isDestroyed()) {
          throw new Error("The renderer was destroyed before the UI capture completed.");
        }
        const image = await webContents.capturePage();
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
  ipcMain.handle(ipcChannels.prepareOffline, (event) => {
    const renderer = assertTrustedRendererIpc(event);
    return controller.prepareOffline((progress) => {
      sendToFrame(renderer.frame, ipcChannels.progress, progress);
    });
  });
  ipcMain.handle(ipcChannels.prepareAudio, (event, request: PrepareAudioRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    return controller.prepareAudio(request, (progress) => {
      sendToFrame(renderer.frame, ipcChannels.progress, progress);
    });
  });
  ipcMain.handle(ipcChannels.startAudioStream, async (event, request: AudioStreamStartRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    const lease = audioStreamOwnership.begin(renderer.owner);
    const probeLease: RendererLifecycleProbeLease | null = rendererLifecycleProbeEnabled
      ? {
          lease,
          streamId: null,
          activated: false,
          chunkCount: 0,
          totalBytes: 0,
        }
      : null;
    if (probeLease !== null) {
      rendererLifecycleProbeLeases.push(probeLease);
    }
    try {
      const response = await controller.startAudioStream(request, (partial) => {
        if (!audioStreamOwnership.canRoute(lease, partial.streamId)) {
          return;
        }
        if (!sendToFrame(renderer.frame, ipcChannels.audioPartial, partial)) {
          revokeAudioStreamOwner(renderer.owner.webContentsId, renderer.owner);
        }
      });
      if (!(await audioStreamOwnership.activate(lease, response.streamId))) {
        throw new Error("The renderer frame was replaced before the audio stream became active.");
      }
      if (probeLease !== null) {
        probeLease.streamId = response.streamId;
        probeLease.activated = true;
      }
      return response;
    } catch (error) {
      audioStreamOwnership.release(lease);
      throw error;
    }
  });
  ipcMain.handle(ipcChannels.appendAudioChunk, (event, request: AudioStreamChunkRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    audioStreamOwnership.assertOwned(renderer.owner, request.streamId);
    const response = controller.appendAudioStreamChunk(request);
    if (rendererLifecycleProbeEnabled) {
      const probeLease = rendererLifecycleProbeLeases.find(
        (candidate) => candidate.streamId === request.streamId,
      );
      if (probeLease !== undefined) {
        probeLease.chunkCount += 1;
        probeLease.totalBytes = response.totalBytes;
      }
    }
    return response;
  });
  ipcMain.handle(ipcChannels.finishAudioStream, async (event, request: AudioStreamFinishRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    audioStreamOwnership.assertOwned(renderer.owner, request.streamId);
    try {
      return await controller.finishAudioStream(request, (progress) => {
        sendToFrame(renderer.frame, ipcChannels.progress, progress);
      });
    } finally {
      audioStreamOwnership.complete(renderer.owner, request.streamId);
    }
  });
  ipcMain.handle(ipcChannels.cancelAudioStream, async (event, request: AudioStreamCancelRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    audioStreamOwnership.assertOwned(renderer.owner, request.streamId);
    try {
      await controller.cancelAudioStream(request);
    } finally {
      audioStreamOwnership.complete(renderer.owner, request.streamId);
    }
  });
  ipcMain.handle(ipcChannels.authorizeMicrophone, (event, request: MicrophoneAuthorizationRequest) => {
    const window = mainWindow;
    const webContents = mainWebContents;
    const gate = microphonePermissionGate;
    const frame = event.senderFrame;
    if (
      window === null ||
      window.isDestroyed() ||
      webContents === null ||
      webContents.isDestroyed() ||
      event.sender !== webContents ||
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
    const renderer = assertTrustedRendererIpc(event);
    return controller.transcribeAudio(request, (progress) => {
      sendToFrame(renderer.frame, ipcChannels.progress, progress);
    });
  });
  ipcMain.handle(ipcChannels.runTurn, (event, request: RunTurnRequest) => {
    const renderer = assertTrustedRendererIpc(event);
    return controller.runTurn(request, (progress) => {
      sendToFrame(renderer.frame, ipcChannels.progress, progress);
    });
  });
  ipcMain.handle(ipcChannels.applyManualPlacement, (event, request: ManualPlacementRequest) => {
    assertTrustedRendererIpc(event);
    return controller.applyManualPlacement(request);
  });
  ipcMain.handle(
    ipcChannels.resetConversation,
    createResetConversationHandler(
      assertTrustedRendererIpc,
      audioStreamOwnership,
      () => controller.reset(),
      (error) => {
        console.error(
          "Active audio cancellation failed during Reset; continuing with controller reset:",
          error,
        );
      },
    ),
  );
}

function assertTrustedRendererIpc(event: IpcMainInvokeEvent): {
  readonly webContents: WebContents;
  readonly frame: WebFrameMain;
  readonly owner: AudioStreamOwnerIdentity;
} {
  const window = mainWindow;
  const webContents = mainWebContents;
  const frame = event.senderFrame;
  if (
    window === null ||
    window.isDestroyed() ||
    webContents === null ||
    webContents.isDestroyed() ||
    event.sender.isDestroyed() ||
    event.sender !== webContents ||
    frame === null ||
    frame !== event.sender.mainFrame ||
    event.sender.getURL() !== rendererDocumentUrl ||
    frame.url !== rendererDocumentUrl
  ) {
    throw new Error("Audio IPC is restricted to the active application main frame.");
  }
  return {
    webContents: event.sender,
    frame,
    owner: {
      webContentsId: event.sender.id,
      processId: event.processId,
      frameId: event.frameId,
      frameTreeNodeId: frame.frameTreeNodeId,
      frameToken: frame.frameToken,
    },
  };
}

function sendToFrame(frame: WebFrameMain, channel: string, payload: unknown): boolean {
  try {
    if (frame.isDestroyed() || frame.detached) {
      return false;
    }
    frame.send(channel, payload);
    return true;
  } catch (error) {
    recordRendererLifecycleProbeError(error);
    console.error(`Failed to send ${channel} to the owning renderer frame:`, error);
    return false;
  }
}

function revokeAudioStreamOwner(
  webContentsId: number,
  frame?: Pick<AudioStreamOwnerIdentity, "frameTreeNodeId" | "frameToken">,
): void {
  void audioStreamOwnership.revokeOwner(webContentsId, frame).catch((error: unknown) => {
    recordRendererLifecycleProbeError(error);
    console.error("Failed to cancel the renderer-owned audio stream:", error);
  });
}

function frameOwnership(
  frame: WebFrameMain | null,
): Pick<AudioStreamOwnerIdentity, "frameTreeNodeId" | "frameToken"> | undefined {
  if (frame === null) {
    return undefined;
  }
  try {
    if (frame.isDestroyed()) {
      return undefined;
    }
    return {
      frameTreeNodeId: frame.frameTreeNodeId,
      frameToken: frame.frameToken,
    };
  } catch (error) {
    recordRendererLifecycleProbeError(error);
    console.error("Failed to capture renderer frame ownership during navigation:", error);
    return undefined;
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

async function runMicrophonePermissionProbe(webContents: WebContents): Promise<void> {
  try {
    const rendererResult = (await webContents.executeJavaScript(
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

interface RendererMediaCaptureSnapshot {
  readonly id: string;
  readonly stopCalls: number;
  readonly trackCount: number;
  readonly readyStates: readonly string[];
}

interface RendererMediaProbeSnapshot {
  readonly captureCount: number;
  readonly captures: readonly RendererMediaCaptureSnapshot[];
}

interface RendererResetUiSnapshot {
  readonly stateText: string;
  readonly promptValue: string;
  readonly suggestionHidden: boolean;
  readonly liveTranscriptHidden: boolean;
  readonly resetDisabled: boolean;
}

async function runRendererResetProbe(window: BrowserWindow, webContents: WebContents): Promise<void> {
  try {
    window.show();
    window.focus();
    await rendererLifecycleProbeMonitorReady;
    assertNoRendererLifecycleProbeErrors();
    await waitForRendererControls(webContents);
    await installRendererMediaProbe(webContents, "reset");
    await prepareRendererRecordingPipeline(webContents);

    const firstLease = await startRendererRecording(webContents, 0);
    const firstMedia = await readRendererMediaProbe(webContents);
    assertActiveMediaCapture(firstMedia, 0);
    const firstGeneration = controller.bootstrap().conversationGeneration + 1;

    await clickRendererButton(webContents, "#resetButton");
    const firstReset = await waitForRendererReset(webContents, firstLease, 0, firstGeneration);

    await prepareRendererRecordingPipeline(webContents);
    const secondLease = await startRendererRecording(webContents, 1);
    if (secondLease.lease.sessionId === firstLease.lease.sessionId) {
      throw new Error("The post-reset recording reused the revoked audio ownership lease.");
    }
    const secondMedia = await readRendererMediaProbe(webContents);
    assertActiveMediaCapture(secondMedia, 1);

    const secondGeneration = controller.bootstrap().conversationGeneration + 1;
    await clickRendererButton(webContents, "#resetButton");
    const secondReset = await waitForRendererReset(webContents, secondLease, 1, secondGeneration);
    assertNoRendererLifecycleProbeErrors();

    console.log(
      `ELECTRON_RENDERER_RESET_PROBE_OK ${JSON.stringify({
        path: "real renderer Start recording -> production IPC/controller/owner -> real Nemotron AudioSession",
        fakeCapture: "tests/fixtures/queen-desk.wav through Chromium fake MediaStream device",
        firstSessionId: firstLease.lease.sessionId,
        secondSessionId: secondLease.lease.sessionId,
        firstStreamChunks: firstLease.chunkCount,
        secondStreamChunks: secondLease.chunkCount,
        firstCancellationMs: firstReset.cancellationMs,
        secondCancellationMs: secondReset.cancellationMs,
        mediaTracksStopped: true,
        ownershipReleased: true,
        uiStateVersion: secondReset.version,
        freshRecordingLeaseSucceeded: true,
      })}`,
    );
  } catch (error) {
    process.exitCode = 1;
    console.error("ELECTRON_RENDERER_RESET_PROBE_FAILED", error);
  } finally {
    rendererResetProbeTerminating = true;
    try {
      await controller.shutdown();
    } catch (error) {
      process.exitCode = 1;
      console.error("ELECTRON_RENDERER_RESET_PROBE_SHUTDOWN_FAILED", error);
    }
    app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
  }
}

async function waitForRendererControls(webContents: WebContents): Promise<void> {
  await waitForProbeState(
    async () =>
      (await webContents.executeJavaScript(
        `document.readyState === "complete" && document.querySelector("#resetButton") !== null`,
        true,
      )) === true,
    "renderer controls to load",
  );
}

async function runStreamOwnerProbe(window: BrowserWindow, webContents: WebContents): Promise<void> {
  try {
    window.show();
    window.focus();
    await rendererLifecycleProbeMonitorReady;
    assertNoRendererLifecycleProbeErrors();
    await waitForRendererControls(webContents);
    const rejectionSelfTestChannels = await verifyRendererUnhandledRejectionDetection(webContents);
    await installRendererMediaProbe(webContents, "reload");
    await prepareRendererRecordingPipeline(webContents);

    const reloadLease = await startRendererRecording(webContents, 0);
    const reloadMedia = await readRendererMediaProbe(webContents);
    assertActiveMediaCapture(reloadMedia, 0);
    const reloadCapture = reloadMedia.captures[0];
    if (reloadCapture === undefined || reloadLease.streamId === null) {
      throw new Error("The reload lifecycle did not create an observable renderer recording.");
    }

    await reloadRenderer(webContents);
    const reloadCancellationMs = await waitForLifecycleCancellation(reloadLease, "reload navigation");
    await waitForRendererTrackStops(reloadCapture);
    const staleReloadRoutable = audioStreamOwnership.canRoute(reloadLease.lease, reloadLease.streamId);
    if (staleReloadRoutable) {
      throw new Error("Reload navigation left the stale audio stream routable.");
    }

    await waitForRendererControls(webContents);
    await installRendererMediaProbe(webContents, "close");
    await prepareRendererRecordingPipeline(webContents);
    const closeLease = await startRendererRecording(webContents, 1);
    if (closeLease.streamId === null || closeLease.lease.sessionId <= reloadLease.lease.sessionId) {
      throw new Error("Reload did not advance to a fresh audio ownership session.");
    }
    const closeMedia = await readRendererMediaProbe(webContents);
    assertActiveMediaCapture(closeMedia, 0);
    const closeCapture = closeMedia.captures[0];
    if (closeCapture === undefined) {
      throw new Error("The close lifecycle did not create an observable renderer recording.");
    }

    await closeRendererWindow(window);
    const closeCancellationMs = await waitForLifecycleCancellation(closeLease, "window close");
    await waitForRendererTrackStops(closeCapture);
    const staleCloseRoutable = audioStreamOwnership.canRoute(closeLease.lease, closeLease.streamId);
    if (staleCloseRoutable) {
      throw new Error("Window close left the stale audio stream routable.");
    }
    assertNoRendererLifecycleProbeErrors();

    console.log(
      `ELECTRON_STREAM_OWNER_PROBE_OK ${JSON.stringify({
        path: "real renderer Start recording -> reload navigation -> real renderer Start recording -> window close",
        fakeCapture: "tests/fixtures/queen-desk.wav through Chromium fake MediaStream device",
        reloadSessionId: reloadLease.lease.sessionId,
        closeSessionId: closeLease.lease.sessionId,
        reloadStreamChunks: reloadLease.chunkCount,
        closeStreamChunks: closeLease.chunkCount,
        reloadCancellationMs,
        closeCancellationMs,
        reloadTracksStopped: reloadCapture.trackCount,
        closeTracksStopped: closeCapture.trackCount,
        ownershipSessionAdvanced: true,
        stalePartialRoutable: false,
        destroyedObjectErrors: 0,
        unhandledErrors: 0,
        rendererRejectionSelfTest: {
          caught: true,
          channels: rejectionSelfTestChannels,
        },
      })}`,
    );
  } catch (error) {
    process.exitCode = 1;
    console.error("ELECTRON_STREAM_OWNER_PROBE_FAILED", error);
  } finally {
    streamOwnerProbeTerminating = true;
    try {
      await controller.shutdown();
    } catch (error) {
      process.exitCode = 1;
      console.error("ELECTRON_STREAM_OWNER_PROBE_SHUTDOWN_FAILED", error);
    }
    app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
  }
}

async function installRendererMediaProbe(webContents: WebContents, captureGroup: string): Promise<void> {
  const installed = (await webContents.executeJavaScript(
    `(() => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
        return false;
      }
      if (window.__rendererLifecycleProbeMedia?.group === ${JSON.stringify(captureGroup)}) {
        return true;
      }
      const state = { group: ${JSON.stringify(captureGroup)}, captures: [] };
      const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      Object.defineProperty(mediaDevices, "getUserMedia", {
        configurable: true,
        value: async (...args) => {
          const stream = await originalGetUserMedia(...args);
          const capture = {
            id: state.group + ":" + state.captures.length,
            stream,
            tracks: stream.getTracks(),
            stopCalls: 0
          };
          for (const [trackIndex, track] of capture.tracks.entries()) {
            const originalStop = track.stop.bind(track);
            Object.defineProperty(track, "stop", {
              configurable: true,
              value: () => {
                capture.stopCalls += 1;
                console.info(
                  ${JSON.stringify(rendererTrackStopMarker)} +
                    JSON.stringify({ captureId: capture.id, trackIndex })
                );
                originalStop();
              }
            });
          }
          state.captures.push(capture);
          return stream;
        }
      });
      window.__rendererLifecycleProbeMedia = state;
      return true;
    })()`,
    true,
  )) as boolean;
  if (!installed) {
    throw new Error("The renderer MediaStream observer could not be installed.");
  }
}

async function prepareRendererRecordingPipeline(webContents: WebContents): Promise<void> {
  if (!controller.bootstrap().readiness.localInferenceReady) {
    await waitForRendererButton(webContents, "#prepareButton");
    await clickRendererButton(webContents, "#prepareButton");
    await waitForProbeState(
      () => controller.bootstrap().readiness.localInferenceReady,
      "the real layout model to become ready",
      180_000,
    );
  }
  if (!controller.bootstrap().audioReadiness.localAudioReady) {
    await waitForRendererButton(webContents, "#audioPrepareButton");
    await clickRendererButton(webContents, "#audioPrepareButton");
    await waitForProbeState(
      () => controller.bootstrap().audioReadiness.localAudioReady,
      "the real Nemotron audio model to become ready",
      180_000,
    );
  }
  await waitForRendererButton(webContents, "#recordButton");
}

async function startRendererRecording(
  webContents: WebContents,
  leaseIndex: number,
): Promise<RendererLifecycleProbeLease> {
  await clickRendererButton(webContents, "#recordButton");
  await waitForProbeState(
    async () =>
      (await webContents.executeJavaScript(
        `document.querySelector("#recordButton")?.textContent === "Stop"`,
        true,
      )) === true,
    `renderer recording ${leaseIndex + 1} to enter the active UI state`,
  );
  await waitForProbeState(
    () => {
      const lease = rendererLifecycleProbeLeases[leaseIndex];
      return lease?.activated === true && lease.streamId !== null && lease.chunkCount > 0;
    },
    `renderer recording ${leaseIndex + 1} to create a native owned stream and PCM chunk`,
  );
  const lease = rendererLifecycleProbeLeases[leaseIndex];
  if (lease === undefined || lease.streamId === null) {
    throw new Error(`Renderer recording ${leaseIndex + 1} did not create an owned stream.`);
  }
  return lease;
}

async function waitForRendererReset(
  webContents: WebContents,
  lease: RendererLifecycleProbeLease,
  mediaCaptureIndex: number,
  conversationGeneration: number,
): Promise<{
  readonly cancellationMs: number;
  readonly version: number;
}> {
  if (lease.streamId === null) {
    throw new Error("Cannot verify reset without an activated native stream.");
  }
  const cancellation = await waitForProbeValue(
    () =>
      rendererLifecycleProbeCancellations.find(
        (candidate) =>
          candidate.streamId === lease.streamId &&
          (candidate.completedAt !== null || candidate.failure !== null),
      ),
    (value): value is RendererLifecycleProbeCancellation => value !== undefined,
    "controller.cancelAudioStream to finish bounded native cancellation",
  );
  if (cancellation.failure !== null || cancellation.completedAt === null) {
    throw new Error(`Native audio cancellation failed: ${cancellation.failure ?? "unknown failure"}.`);
  }

  const media = await waitForProbeValue(
    () => readRendererMediaProbe(webContents),
    (value) => {
      const capture = value.captures[mediaCaptureIndex];
      return (
        capture !== undefined &&
        capture.stopCalls >= capture.trackCount &&
        capture.readyStates.every((state) => state === "ended")
      );
    },
    "renderer MediaStream tracks to stop",
  );
  const capture = media.captures[mediaCaptureIndex];
  if (capture === undefined || capture.trackCount < 1) {
    throw new Error("The renderer reset probe did not observe an audio MediaStream track.");
  }

  const ui = await waitForProbeValue(
    () => readRendererResetUi(webContents),
    (value) =>
      value.stateText === "State v0" &&
      value.promptValue === "" &&
      value.suggestionHidden &&
      value.liveTranscriptHidden &&
      !value.resetDisabled,
    "renderer UI to settle at state v0",
  );
  const bootstrap = await waitForProbeValue(
    () => controller.bootstrap(),
    (value) =>
      value.conversationGeneration === conversationGeneration &&
      value.state.version === 0 &&
      value.state.stateRef === "layout-state-v0" &&
      value.selectedLayout === null &&
      value.lastToolResult === null &&
      value.trace.length === 0 &&
      value.readiness.status !== "recovering" &&
      value.readiness.status !== "recovery_required",
    "controller reset and any bounded native recovery to settle at the same v0 generation",
  );
  if (audioStreamOwnership.canRoute(lease.lease, lease.streamId)) {
    throw new Error(
      `Reset did not preserve authoritative v0 or release ownership: ${JSON.stringify({
        conversationGeneration: bootstrap.conversationGeneration,
        expectedConversationGeneration: conversationGeneration,
        version: bootstrap.state.version,
        stateRef: bootstrap.state.stateRef,
        selectedLayout: bootstrap.selectedLayout?.id ?? null,
        lastToolResult: bootstrap.lastToolResult?.status ?? null,
        traceLength: bootstrap.trace.length,
        ui,
      })}`,
    );
  }

  return {
    cancellationMs: Math.round(cancellation.completedAt - cancellation.startedAt),
    version: bootstrap.state.version,
  };
}

function assertActiveMediaCapture(snapshot: RendererMediaProbeSnapshot, index: number): void {
  const capture = snapshot.captures[index];
  if (
    capture === undefined ||
    capture.trackCount < 1 ||
    capture.stopCalls !== 0 ||
    capture.readyStates.some((state) => state !== "live")
  ) {
    throw new Error(
      `Renderer recording ${index + 1} did not retain a live controlled MediaStream: ${JSON.stringify(
        snapshot,
      )}`,
    );
  }
}

async function readRendererMediaProbe(webContents: WebContents): Promise<RendererMediaProbeSnapshot> {
  return (await webContents.executeJavaScript(
    `(() => {
      const state = window.__rendererLifecycleProbeMedia;
      return {
        captureCount: state?.captures.length ?? 0,
        captures: (state?.captures ?? []).map((capture) => ({
          id: capture.id,
          stopCalls: capture.stopCalls,
          trackCount: capture.tracks.length,
          readyStates: capture.tracks.map((track) => track.readyState)
        }))
      };
    })()`,
    true,
  )) as RendererMediaProbeSnapshot;
}

async function readRendererResetUi(webContents: WebContents): Promise<RendererResetUiSnapshot> {
  return (await webContents.executeJavaScript(
    `(() => ({
      stateText: document.querySelector("#turnCounter")?.textContent ?? "",
      promptValue: document.querySelector("#promptInput")?.value ?? "",
      suggestionHidden: document.querySelector("#speechSuggestionPanel")?.hidden === true,
      liveTranscriptHidden: document.querySelector("#liveTranscriptPanel")?.hidden === true,
      resetDisabled: document.querySelector("#resetButton")?.disabled === true
    }))()`,
    true,
  )) as RendererResetUiSnapshot;
}

async function reloadRenderer(webContents: WebContents): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      webContents.removeListener("did-finish-load", finish);
      reject(new Error("Timed out waiting for the real renderer reload navigation."));
    }, 30_000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    webContents.once("did-finish-load", finish);
    try {
      webContents.reload();
    } catch (error) {
      clearTimeout(timeout);
      webContents.removeListener("did-finish-load", finish);
      reject(error);
    }
  });
}

async function closeRendererWindow(window: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeListener("closed", finish);
      reject(new Error("Timed out waiting for the real renderer window to close."));
    }, 30_000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    window.once("closed", finish);
    try {
      window.close();
    } catch (error) {
      clearTimeout(timeout);
      window.removeListener("closed", finish);
      reject(error);
    }
  });
}

async function waitForLifecycleCancellation(
  lease: RendererLifecycleProbeLease,
  lifecycle: string,
): Promise<number> {
  if (lease.streamId === null) {
    throw new Error(`Cannot verify ${lifecycle} without an activated native stream.`);
  }
  const cancellation = await waitForProbeValue(
    () =>
      rendererLifecycleProbeCancellations.find(
        (candidate) =>
          candidate.streamId === lease.streamId &&
          (candidate.completedAt !== null || candidate.failure !== null),
      ),
    (value): value is RendererLifecycleProbeCancellation => value !== undefined,
    `${lifecycle} to cancel the native renderer-owned stream`,
  );
  if (cancellation.failure !== null || cancellation.completedAt === null) {
    throw new Error(
      `${lifecycle} native audio cancellation failed: ${cancellation.failure ?? "unknown failure"}.`,
    );
  }
  return Math.round(cancellation.completedAt - cancellation.startedAt);
}

async function waitForRendererTrackStops(capture: RendererMediaCaptureSnapshot): Promise<void> {
  if (capture.trackCount < 1) {
    throw new Error(`Renderer capture ${capture.id} did not expose a MediaStream track.`);
  }
  await waitForProbeState(
    () =>
      Array.from({ length: capture.trackCount }, (_, trackIndex) =>
        rendererLifecycleProbeTrackStops.has(mediaTrackStopKey(capture.id, trackIndex)),
      ).every(Boolean),
    `renderer MediaStream tracks for ${capture.id} to stop`,
    30_000,
  );
}

function mediaTrackStopKey(captureId: string, trackIndex: number): string {
  return `${captureId}:${trackIndex}`;
}

async function attachRendererLifecycleProbeMonitor(webContents: WebContents): Promise<void> {
  const debuggerSession = webContents.debugger;
  if (!debuggerSession.isAttached()) {
    debuggerSession.attach("1.3");
  }
  debuggerSession.on("message", (_event, method, params) => {
    if (method === "Runtime.exceptionThrown") {
      rendererLifecycleErrorMonitor.recordRuntimeException(params);
    }
  });
  await debuggerSession.sendCommand("Runtime.enable");
}

function recordRendererLifecycleProbeMessage(level: string, message: string): void {
  if (message.startsWith(rendererTrackStopMarker)) {
    try {
      const payload = JSON.parse(message.slice(rendererTrackStopMarker.length)) as {
        readonly captureId?: unknown;
        readonly trackIndex?: unknown;
      };
      if (
        typeof payload.captureId !== "string" ||
        !Number.isInteger(payload.trackIndex) ||
        (payload.trackIndex as number) < 0
      ) {
        throw new Error(`Invalid renderer track-stop payload: ${message}`);
      }
      rendererLifecycleProbeTrackStops.add(
        mediaTrackStopKey(payload.captureId, payload.trackIndex as number),
      );
    } catch (error) {
      rendererLifecycleErrorMonitor.recordProbeHarnessError(error);
    }
    return;
  }
  rendererLifecycleErrorMonitor.recordConsole(level, message);
}

function recordRendererLifecycleProbeError(error: unknown): void {
  if (!rendererLifecycleProbeEnabled) {
    return;
  }
  rendererLifecycleErrorMonitor.recordMainLifecycleError(error);
}

function assertNoRendererLifecycleProbeErrors(): void {
  rendererLifecycleErrorMonitor.assertNone();
}

async function verifyRendererUnhandledRejectionDetection(
  webContents: WebContents,
): Promise<readonly string[]> {
  const marker = `renderer-probe-rejection-${Date.now()}`;
  await webContents.executeJavaScript(
    `(() => {
      Promise.reject(new Error(${JSON.stringify(marker)}));
      return true;
    })()`,
    true,
  );
  await waitForProbeState(
    () =>
      rendererLifecycleErrorMonitor
        .snapshot()
        .some((error) => error.channel === "runtime.exceptionThrown" && error.message.includes(marker)),
    "the renderer rejection negative self-test to reach Runtime.exceptionThrown",
    10_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));

  const detectedErrors = rendererLifecycleErrorMonitor
    .snapshot()
    .filter((error) => error.message.includes(marker));
  const unexpectedErrors = rendererLifecycleErrorMonitor
    .snapshot()
    .filter((error) => !error.message.includes(marker));
  if (unexpectedErrors.length > 0) {
    throw new Error(
      `The renderer rejection self-test observed unrelated lifecycle errors: ${JSON.stringify(
        unexpectedErrors,
      )}`,
    );
  }
  let assertionFailed = false;
  try {
    assertNoRendererLifecycleProbeErrors();
  } catch (error) {
    assertionFailed = true;
    if (!(error instanceof Error) || !error.message.includes(marker)) {
      throw error;
    }
  }
  if (!assertionFailed) {
    throw new Error("The renderer rejection negative self-test did not fail the lifecycle harness.");
  }
  rendererLifecycleErrorMonitor.clear();
  assertNoRendererLifecycleProbeErrors();
  return [...new Set(detectedErrors.map((error) => error.channel))];
}

async function waitForRendererButton(webContents: WebContents, selector: string): Promise<void> {
  await waitForProbeState(
    async () =>
      (await webContents.executeJavaScript(
        `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          return element instanceof HTMLButtonElement && !element.disabled && !element.hidden;
        })()`,
        true,
      )) === true,
    `${selector} to become enabled`,
    180_000,
  );
}

async function clickRendererButton(webContents: WebContents, selector: string): Promise<void> {
  const point = (await webContents.executeJavaScript(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLButtonElement) || element.disabled || element.hidden) {
        return null;
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    })()`,
    true,
  )) as { readonly x: number; readonly y: number } | null;
  if (point === null) {
    throw new Error(`Renderer button ${selector} is not available for a real input click.`);
  }
  webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  webContents.sendInputEvent({
    type: "mouseDown",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  webContents.sendInputEvent({
    type: "mouseUp",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

async function waitForProbeState(
  check: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 120_000,
): Promise<void> {
  await waitForProbeValue(check, (value) => value, description, timeoutMs);
}

async function waitForProbeValue<T, U extends T>(
  read: () => T | Promise<T>,
  accept: (value: T) => value is U,
  description: string,
  timeoutMs?: number,
): Promise<U>;
async function waitForProbeValue<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  description: string,
  timeoutMs?: number,
): Promise<T>;
async function waitForProbeValue<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  description: string,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T;
  while (true) {
    lastValue = await read();
    if (accept(lastValue)) {
      return lastValue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function failRendererResetProbe(kind: string, error: unknown): void {
  if (rendererResetProbeTerminating) {
    return;
  }
  rendererResetProbeTerminating = true;
  process.exitCode = 1;
  console.error(`ELECTRON_RENDERER_RESET_PROBE_${kind}`, error);
  app.exit(1);
}

function failStreamOwnerProbe(kind: string, error: unknown): void {
  if (streamOwnerProbeTerminating) {
    return;
  }
  streamOwnerProbeTerminating = true;
  process.exitCode = 1;
  console.error(`ELECTRON_STREAM_OWNER_PROBE_${kind}`, error);
  app.exit(1);
}

app.on("window-all-closed", () => {
  if (rendererLifecycleProbeEnabled) {
    return;
  }
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
