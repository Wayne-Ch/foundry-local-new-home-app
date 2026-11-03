import {
  applyPartialTranscriptEvent,
  audioDurationMsFromPcmBytes,
  reduceAudioRecorderState,
} from "../audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MAX_PCM_BYTES,
  AUDIO_MIN_DURATION_MS,
  AUDIO_SAMPLE_RATE,
  type AudioMode,
  type AudioPartialTranscriptEvent,
  type AudioRecorderState,
  type LiveTranscriptDraft,
} from "../audio/audio-types";
import { clearanceRuleSet, furnitureCatalog } from "../domain/fixture";
import { rectangleSeparation } from "../domain/geometry";
import {
  evaluateManualPlacement,
  MANUAL_PLACEMENT_GRID_MM,
  type ManualPlacementOutcome,
  type ManualPlacementRequest,
} from "../domain/manual-placement";
import type {
  CheckedRoomState,
  DemoState,
  DemoStateSnapshot,
  DoorSwing,
  EvaluatedLayoutOption,
  LayoutConflict,
  LayoutToolResult,
  Point,
  Rectangle,
  ResolvedPlacement,
  RuntimeReadiness,
} from "../domain/types";
import type {
  AudioTranscriptionResponse,
  BootstrapPayload,
  ConversationMessage,
  ProgressEvent,
  RunTurnResponse,
  StageTurnDefinition,
  StageTurnId,
  TraceEntry,
} from "../shared/contracts";
import {
  audioModeDisplay,
  BoundedAudioChunkPump,
  LivePcmCapture,
  releaseMediaStream,
  shouldOfferWhisperFallback,
} from "./audio-capture";
import {
  createLayoutPresentation,
  defaultLayoutEvidenceView,
  type LayoutEvidenceView,
} from "./layout-presentation";
import { RendererOperationBarrier } from "./operation-barrier";
import {
  clientPointToRoomPoint,
  keyboardPlacementOrigin,
  snappedPlacementOrigin,
} from "./placement-interaction";
import { createPreviewApi } from "./preview-api";
import {
  beginAudioModePreparation,
  isAudioPreparationActive,
  resetAfterStartingCleanup,
  SingleFlightOperation,
  submitTranscriptDraft,
} from "./renderer-lifecycle";
import {
  createAuthoritativeResetBootstrap,
  DEFAULT_AUDIO_NOTICE,
  isAuthoritativeResetBootstrap,
  isCurrentConversationResult,
  resetRendererTransientState,
} from "./reset-state";
import { type ActiveRoomView, getActiveRoomView } from "./room-state";
import { runtimeBadgeLabel } from "./runtime-presentation";
import { applySpeechCorrectionSuggestions } from "./speech-correction";
import {
  applySpeechSuggestion,
  createSpeechSuggestionDraft,
  dismissSpeechSuggestion,
  reconcileSpeechSuggestionEdit,
  type SpeechCorrectionProvenance,
  type SpeechSuggestionState,
  undoSpeechSuggestion,
} from "./speech-suggestion-state";
import "./styles.css";

const svgNamespace = "http://www.w3.org/2000/svg";
const previewParameters = new URLSearchParams(window.location.search);
const previewMode = previewParameters.get("preview") === "1";
const demoApi = previewMode ? createPreviewApi() : (window.demoApi ?? null);

let viewState: BootstrapPayload;
let latestToolResult: LayoutToolResult | null = null;
let isBusy = false;
let runtimeStartupPending = true;
let audioRecorderState: AudioRecorderState = { status: "idle", elapsedMs: 0, detail: "" };
let audioNotice = DEFAULT_AUDIO_NOTICE;
let voiceOperation: VoiceCaptureOperation | null = null;
let liveTranscriptDraft: LiveTranscriptDraft = {
  streamId: null,
  sequence: -1,
  text: "",
  isFinal: false,
};
let liveTranscriptPhase: "draft" | "submitted" = "draft";
const operationBarrier = new RendererOperationBarrier();
const audioPreparation = new SingleFlightOperation();
let audioOperationId = 0;
let resetRecoveryMonitor: {
  readonly conversationGeneration: number;
  readonly promise: Promise<void>;
} | null = null;
let manualPreview: ManualPlacementOutcome | null = null;
let manualPreviewOrigin: { readonly instanceId: string; readonly rect: Rectangle } | null = null;
let layoutEvidenceView: LayoutEvidenceView = "accepted";
let focusedPlacementInstanceId: string | null = null;
let speechCorrection: SpeechSuggestionState | null = null;
let speechCorrectionProvenance: SpeechCorrectionProvenance | null = null;

interface PlacementDragState {
  readonly pointerId: number;
  readonly instanceId: string;
  readonly grabOffset: Point;
  readonly originRect: Rectangle;
}

let placementDrag: PlacementDragState | null = null;

const runtimeBadge = requiredElement("runtimeBadge");
const runtimeLabel = requiredElement("runtimeLabel");
const prepareButton = requiredButton("prepareButton");
const audioBadge = requiredElement("audioBadge");
const audioLabel = requiredElement("audioLabel");
const audioPrepareButton = requiredButton("audioPrepareButton");
const audioFallbackButton = requiredButton("audioFallbackButton");
const recordButton = requiredButton("recordButton");
const audioStatus = requiredElement("audioStatus");
const recordingIndicator = requiredElement("recordingIndicator");
const recordingTimer = requiredElement("recordingTimer");
const liveTranscriptPanel = requiredElement("liveTranscriptPanel");
const liveTranscriptLabel = requiredElement("liveTranscriptLabel");
const liveTranscriptText = requiredElement("liveTranscriptText");
const speechSuggestionPanel = requiredElement("speechSuggestionPanel");
const speechSuggestionTitle = requiredElement("speechSuggestionTitle");
const speechSuggestionText = requiredElement("speechSuggestionText");
const speechApplyButton = requiredButton("speechApplyButton");
const speechDismissButton = requiredButton("speechDismissButton");
const speechUndoButton = requiredButton("speechUndoButton");
const traceToggle = requiredButton("traceToggle");
const traceClose = requiredButton("traceClose");
const resetButton = requiredButton("resetButton");
const nextTurnButton = requiredButton("nextTurnButton");
const recoveryActions = requiredElement("recoveryActions");
const recoveryPrimaryButton = requiredButton("recoveryPrimaryButton");
const messagesElement = requiredElement("messages");
const promptForm = requiredForm("promptForm");
const promptInput = requiredTextArea("promptInput");
const sendButton = requiredButton("sendButton");
const stageSteps = requiredElement("stageSteps");
const turnCounter = requiredElement("turnCounter");
const resultBadge = requiredElement("resultBadge");
const layoutTitle = requiredElement("layoutTitle");
const roomCard = requiredElement("roomCard");
const layoutNotice = requiredElement("layoutNotice");
const layoutViewActions = requiredElement("layoutViewActions");
const layoutViewStatus = requiredElement("layoutViewStatus");
const showAcceptedLayoutButton = requiredButton("showAcceptedLayoutButton");
const showRejectedLayoutButton = requiredButton("showRejectedLayoutButton");
const roomEmptyState = requiredElement("roomEmptyState");
const roomSvg = requiredSvg("roomSvg");
const verdictTitle = requiredElement("verdictTitle");
const verdictSummary = requiredElement("verdictSummary");
const requirementsCard = requiredElement("requirementsCard");
const requirementSummary = requiredElement("requirementSummary");
const measurementList = requiredElement("measurementList");
const manualPlacementCard = requiredElement("manualPlacementCard");
const manualPlacementStatus = requiredElement("manualPlacementStatus");
const manualApplyButton = requiredButton("manualApplyButton");
const manualRevertButton = requiredButton("manualRevertButton");
const checksLabel = requiredElement("checksLabel");
const constraintChecks = requiredElement("constraintChecks");
const conflictsLabel = requiredElement("conflictsLabel");
const conflictList = requiredElement("conflictList");
const progressBar = requiredElement("progressBar");
const progressPhase = requiredElement("progressPhase");
const progressDetail = requiredElement("progressDetail");
const tracePanel = requiredElement("tracePanel");
const runtimeTrace = requiredElement("runtimeTrace");
const audioTrace = requiredElement("audioTrace");
const toolTrace = requiredElement("toolTrace");
const geometryTrace = requiredElement("geometryTrace");
const previewBanner = requiredElement("previewBanner");
const loadSampleFloorPlanButton = requiredButton("loadSampleFloorPlanButton");
const chooseFloorPlanButton = requiredButton("chooseFloorPlanButton");
const analyzeFloorPlanButton = requiredButton("analyzeFloorPlanButton");
const useDefaultRoomButton = requiredButton("useDefaultRoomButton");
const floorPlanImportStatus = requiredElement("floorPlanImportStatus");
const floorPlanFacts = requiredElement("floorPlanFacts");
const floorPlanPreviewFrame = requiredElement("floorPlanPreviewFrame");
const floorPlanPreview = requiredImage("floorPlanPreview");
const floorPlanPreviewCaption = requiredElement("floorPlanPreviewCaption");

interface VoiceCaptureOperation {
  readonly operationId: number;
  readonly lifecycleGeneration: number;
  readonly conversationGeneration: number;
  readonly mode: AudioMode;
  readonly stream: MediaStream;
  readonly startedAt: number;
  capture: LivePcmCapture | null;
  pump: BoundedAudioChunkPump | null;
  streamId: string | null;
  chunks: Uint8Array[];
  totalBytes: number;
  recordingTimerId: number | null;
  recordingLimitId: number | null;
  stopped: boolean;
}

function activeRoomView(): ActiveRoomView | null {
  return getActiveRoomView(viewState);
}

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  if (demoApi === null) {
    throw new Error("Electron preload API is unavailable. Use ?preview=1 only for visual inspection.");
  }
  const lifecycleGeneration = operationBarrier.beginOperation();
  previewBanner.hidden = !previewMode;
  viewState = await demoApi.getBootstrap();
  latestToolResult = viewState.lastToolResult;
  layoutEvidenceView = initialLayoutEvidenceView(latestToolResult);
  renderAll();
  demoApi.onProgress(renderProgress);
  demoApi.onAudioPartial(handleAudioPartial);
  try {
    const readiness = await demoApi.initializeRuntime();
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      viewState = { ...viewState, readiness };
    }
  } catch (error) {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      viewState = {
        ...viewState,
        readiness: {
          ...viewState.readiness,
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
  } finally {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      runtimeStartupPending = false;
      renderRuntime(viewState.readiness);
      renderAudio();
    }
  }
}

function initialLayoutEvidenceView(result: LayoutToolResult | null): LayoutEvidenceView {
  const requestedView = previewMode ? previewParameters.get("layoutView") : null;
  if (requestedView === "accepted" || requestedView === "rejected") {
    return requestedView;
  }
  return defaultLayoutEvidenceView(result);
}

prepareButton.addEventListener("click", async () => {
  if (operationBarrier.operationsBlocked) {
    return;
  }
  const lifecycleGeneration = operationBarrier.beginOperation();
  setBusy(true);
  try {
    if (demoApi === null) {
      return;
    }
    const response = await demoApi.prepareOffline();
    if (!operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    viewState = { ...viewState, readiness: response.readiness };
    renderRuntime(response.readiness);
  } catch (error) {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      showRuntimeError(error);
    }
  } finally {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      setBusy(false);
    }
  }
});

loadSampleFloorPlanButton.addEventListener("click", () => {
  void loadFloorPlanImage(() => demoApi?.loadSampleFloorPlan());
});

chooseFloorPlanButton.addEventListener("click", () => {
  void loadFloorPlanImage(() => demoApi?.chooseFloorPlan());
});

analyzeFloorPlanButton.addEventListener("click", async () => {
  if (demoApi === null || isBusy || operationBarrier.operationsBlocked) {
    return;
  }
  const lifecycleGeneration = operationBarrier.beginOperation();
  setBusy(true);
  try {
    const bootstrap = await demoApi.analyzeFloorPlan();
    if (!operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    applyBootstrap(bootstrap);
  } catch (error) {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      showImportError(error);
      const bootstrap = await demoApi.getBootstrap();
      if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
        applyBootstrap(bootstrap);
      }
    }
  } finally {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      setBusy(false);
    }
  }
});

useDefaultRoomButton.addEventListener("click", async () => {
  if (demoApi === null || isBusy || operationBarrier.operationsBlocked) {
    return;
  }
  const lifecycleGeneration = operationBarrier.beginOperation();
  setBusy(true);
  try {
    const bootstrap = await demoApi.useDefaultRoom();
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      applyBootstrap(bootstrap);
    }
  } catch (error) {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      showImportError(error);
    }
  } finally {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      setBusy(false);
    }
  }
});

async function loadFloorPlanImage(
  load: () => ReturnType<NonNullable<typeof demoApi>["loadSampleFloorPlan"]> | undefined,
): Promise<void> {
  if (demoApi === null || isBusy || operationBarrier.operationsBlocked) {
    return;
  }
  const lifecycleGeneration = operationBarrier.beginOperation();
  setBusy(true);
  try {
    const response = await load();
    if (
      response === undefined ||
      response.cancelled ||
      !operationBarrier.isCurrentOperation(lifecycleGeneration)
    ) {
      return;
    }
    applyBootstrap(response.bootstrap);
  } catch (error) {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      showImportError(error);
    }
  } finally {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      setBusy(false);
    }
  }
}

audioPrepareButton.addEventListener("click", async () => {
  await prepareAudioMode("nemotron_streaming");
});

audioFallbackButton.addEventListener("click", async () => {
  await prepareAudioMode("whisper_file");
});

async function prepareAudioMode(mode: AudioMode): Promise<void> {
  const api = demoApi;
  if (
    api === null ||
    previewMode ||
    runtimeStartupPending ||
    operationBarrier.operationsBlocked ||
    isAudioBusy()
  ) {
    return;
  }

  await audioPreparation
    .run(() => runAudioPreparation(api, mode))
    .finally(() => {
      renderAudio();
    });
}

async function runAudioPreparation(api: NonNullable<typeof demoApi>, mode: AudioMode): Promise<void> {
  const lifecycleGeneration = operationBarrier.beginOperation();
  const operationId = ++audioOperationId;
  liveTranscriptDraft = emptyLiveTranscriptDraft();
  liveTranscriptPhase = "draft";
  viewState = {
    ...viewState,
    audioReadiness: beginAudioModePreparation(viewState.audioReadiness, mode),
  };
  audioNotice = "Preparing local speech-to-text.";
  renderAudio();
  try {
    const response = await api.prepareAudio({ mode });
    if (operationId !== audioOperationId || !operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    viewState = { ...viewState, audioReadiness: response.readiness };
    audioNotice =
      mode === "nemotron_streaming"
        ? "Nemotron live captions are ready. Press Start recording."
        : "Whisper fallback is ready. Press Start recording.";
  } catch (error) {
    if (operationId !== audioOperationId || !operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    await refreshRuntimeState();
    showAudioError(error);
  }
  renderAudio();
}

recordButton.addEventListener("click", () => {
  if (audioRecorderState.status === "recording") {
    void stopAndTranscribe();
  } else {
    void startRecording();
  }
});

traceToggle.addEventListener("click", () => setTraceOpen(!tracePanel.classList.contains("is-open")));
traceClose.addEventListener("click", () => setTraceOpen(false));

resetButton.addEventListener("click", async () => {
  const api = demoApi;
  if (api === null || operationBarrier.resetInFlight) {
    return;
  }
  const resetGeneration = operationBarrier.beginReset();
  const conversationGeneration = viewState.conversationGeneration + 1;
  resetRecoveryMonitor = null;
  viewState = createAuthoritativeResetBootstrap(viewState, conversationGeneration);
  latestToolResult = null;
  layoutEvidenceView = "accepted";
  resetRendererTransientUi();
  renderAll();
  setBusy(true);
  try {
    const bootstrap = await resetAfterStartingCleanup(
      () => discardRecording(false),
      () => api.resetConversation(),
    );
    if (!operationBarrier.isCurrentReset(resetGeneration)) {
      return;
    }
    if (!isAuthoritativeResetBootstrap(bootstrap, conversationGeneration)) {
      throw new Error("Reset returned a stale or non-v0 conversation generation.");
    }
    viewState = bootstrap;
    latestToolResult = bootstrap.lastToolResult;
    layoutEvidenceView = "accepted";
    resetRendererTransientUi();
    renderAll();
  } catch (error) {
    if (!operationBarrier.isCurrentReset(resetGeneration)) {
      return;
    }
    try {
      const bootstrap = await api.getBootstrap();
      if (
        operationBarrier.isCurrentReset(resetGeneration) &&
        isAuthoritativeResetBootstrap(bootstrap, conversationGeneration)
      ) {
        viewState = bootstrap;
        latestToolResult = bootstrap.lastToolResult;
        layoutEvidenceView = defaultLayoutEvidenceView(bootstrap.lastToolResult);
        renderAll();
      }
    } catch {
      // Keep the last rendered state and surface the reset failure below.
    }
    if (operationBarrier.failReset(resetGeneration)) {
      runtimeStartupPending = false;
      setBusy(false);
      showResetError(error);
      startResetRecoveryMonitor(conversationGeneration);
    }
    return;
  }
  if (operationBarrier.finishReset(resetGeneration)) {
    resetRecoveryMonitor = null;
    runtimeStartupPending = false;
    setBusy(false);
    resetButton.focus({ preventScroll: true });
  }
});

nextTurnButton.addEventListener("click", () => {
  const index = nextStageTurnIndex();
  const turn = viewState.stageTurns[index];
  if (turn !== undefined) {
    void runTurn(turn.prompt, turn.id);
  }
});

recoveryPrimaryButton.addEventListener("click", () => {
  const recoveryTurn = viewState.stageTurns.find((turn) => turn.id === "turn-c");
  if (recoveryTurn !== undefined) {
    void runTurn(recoveryTurn.prompt, recoveryTurn.id);
  }
});

speechApplyButton.addEventListener("click", () => {
  if (speechCorrection === null) {
    return;
  }
  const applied = applySpeechSuggestion(speechCorrection, promptInput.value);
  promptInput.value = applied.promptValue;
  speechCorrection = applied.suggestion;
  speechCorrectionProvenance = applied.provenance;
  audioNotice =
    applied.provenance === null
      ? "The editable prompt changed, so the stale suggestion was cleared."
      : "Furniture corrections applied by explicit user action. Review or undo before Send.";
  promptInput.focus();
  renderSpeechSuggestion();
  renderAudio();
  renderTrace();
});

speechDismissButton.addEventListener("click", () => {
  if (speechCorrection === null) {
    return;
  }
  const dismissed = dismissSpeechSuggestion(speechCorrection);
  promptInput.value = dismissed.promptValue;
  speechCorrection = dismissed.suggestion;
  speechCorrectionProvenance = dismissed.provenance;
  audioNotice = "Furniture correction suggestion dismissed. The raw transcript remains editable.";
  promptInput.focus();
  renderSpeechSuggestion();
  renderAudio();
  renderTrace();
});

speechUndoButton.addEventListener("click", () => {
  if (speechCorrection === null) {
    return;
  }
  const undone = undoSpeechSuggestion(speechCorrection, promptInput.value);
  promptInput.value = undone.promptValue;
  speechCorrection = undone.suggestion;
  speechCorrectionProvenance = undone.provenance;
  audioNotice = "Furniture corrections undone. The raw transcript is restored.";
  promptInput.focus();
  renderSpeechSuggestion();
  renderAudio();
  renderTrace();
});

showAcceptedLayoutButton.addEventListener("click", () => {
  layoutEvidenceView = "accepted";
  renderLayout();
});

showRejectedLayoutButton.addEventListener("click", () => {
  layoutEvidenceView = "rejected";
  renderLayout();
});

promptInput.addEventListener("input", () => {
  if (speechCorrection !== null) {
    const reconciled = reconcileSpeechSuggestionEdit(speechCorrection, promptInput.value);
    if (reconciled === null) {
      speechCorrection = null;
      speechCorrectionProvenance = null;
    }
    renderSpeechSuggestion();
    renderTrace();
  }
});

manualApplyButton.addEventListener("click", () => {
  void applyManualPreview();
});

manualRevertButton.addEventListener("click", () => {
  revertManualPreview();
});

document.addEventListener("focusin", (event) => {
  const target = event.target;
  focusedPlacementInstanceId =
    target instanceof Element
      ? (target.closest<SVGElement>("[data-placement-id]")?.dataset.placementId ?? null)
      : null;
});

roomSvg.addEventListener("pointermove", (event) => {
  updatePlacementDrag(event);
});

roomSvg.addEventListener("pointerup", (event) => {
  finishPlacementDrag(event);
});

roomSvg.addEventListener("pointercancel", (event) => {
  finishPlacementDrag(event);
});

promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (
    activeRoomView() === null ||
    isBusy ||
    operationBarrier.operationsBlocked ||
    isAudioBusy() ||
    !viewState.readiness.localInferenceReady
  ) {
    return;
  }
  const prompt = promptInput.value.trim();
  if (!prompt) {
    return;
  }
  const transcriptSubmission = submitTranscriptDraft(liveTranscriptDraft, prompt);
  liveTranscriptDraft = transcriptSubmission.draft;
  liveTranscriptPhase = transcriptSubmission.phase;
  if (transcriptSubmission.notice !== null) {
    audioNotice = transcriptSubmission.notice;
  }
  speechCorrection = null;
  promptInput.value = "";
  void runTurn(prompt);
});

async function runTurn(prompt: string, scriptedTurnId?: StageTurnId): Promise<void> {
  if (
    activeRoomView() === null ||
    isBusy ||
    operationBarrier.operationsBlocked ||
    isAudioBusy() ||
    !viewState.readiness.localInferenceReady
  ) {
    return;
  }
  const lifecycleGeneration = operationBarrier.beginOperation();
  const conversationGeneration = viewState.conversationGeneration;
  releasePlacementDrag();
  focusedPlacementInstanceId = null;
  manualPreview = null;
  manualPreviewOrigin = null;
  setBusy(true);
  try {
    if (demoApi === null) {
      return;
    }
    const response = await demoApi.runTurn({
      prompt,
      ...(scriptedTurnId ? { scriptedTurnId } : {}),
    });
    if (!operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    if (!isCurrentConversationResult(response, conversationGeneration)) {
      throw new Error("Discarded a stale turn result from an earlier conversation generation.");
    }
    applyTurnResponse(response);
  } catch (error) {
    if (!operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    progressBar.hidden = true;
    showRuntimeError(error);
    const bootstrap = await demoApi.getBootstrap();
    if (
      operationBarrier.isCurrentOperation(lifecycleGeneration) &&
      bootstrap.conversationGeneration === conversationGeneration
    ) {
      viewState = bootstrap;
      latestToolResult = bootstrap.lastToolResult;
      layoutEvidenceView = "accepted";
      renderAll();
    }
  } finally {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      setBusy(false);
    }
  }
}

function applyTurnResponse(response: RunTurnResponse): void {
  if (viewState.roomMode === "none") {
    throw new Error("Cannot apply a layout turn without an active room.");
  }
  latestToolResult = response.toolResult;
  layoutEvidenceView = defaultLayoutEvidenceView(response.toolResult);
  viewState = {
    ...viewState,
    state: response.state,
    selectedLayout: response.selectedLayout,
    completedStageTurnIds: response.completedStageTurnIds,
    lastInteraction: response.lastInteraction,
    messages: response.messages,
    trace: response.trace,
    readiness: response.readiness,
  };
  renderAll();
}

function applyBootstrap(bootstrap: BootstrapPayload): void {
  releasePlacementDrag();
  focusedPlacementInstanceId = null;
  viewState = bootstrap;
  latestToolResult = bootstrap.lastToolResult;
  layoutEvidenceView = defaultLayoutEvidenceView(bootstrap.lastToolResult);
  manualPreview = null;
  manualPreviewOrigin = null;
  renderAll();
}

function renderAll(): void {
  const activeRoom = activeRoomView();
  renderRuntime(viewState.readiness);
  renderAudio();
  renderStageSteps(viewState.stageTurns);
  renderMessages(viewState.messages);
  renderRecoveryActions();
  renderFloorPlanImport();
  renderLayout();
  renderSpeechSuggestion();
  renderTrace();
  turnCounter.textContent = activeRoom === null ? "No room loaded" : `State v${activeRoom.state.version}`;
  promptInput.placeholder =
    activeRoom === null
      ? "Choose a room before asking a layout question..."
      : "Ask a follow-up using the verified room and catalog...";
  const nextIndex = nextStageTurnIndex();
  nextTurnButton.textContent =
    activeRoom === null
      ? "Choose a room to begin"
      : nextIndex >= 0
        ? `Run next: ${viewState.stageTurns[nextIndex]?.label ?? "scripted turn"}`
        : "Scripted story complete";
  nextTurnButton.disabled =
    activeRoom === null ||
    isBusy ||
    operationBarrier.operationsBlocked ||
    !viewState.readiness.localInferenceReady ||
    nextIndex < 0;
}

function renderFloorPlanImport(): void {
  const imported = viewState.floorPlanImport;
  const preview = imported.preview;
  floorPlanPreviewFrame.hidden = preview === null;
  if (preview !== null) {
    floorPlanPreview.src = preview.dataUrl;
    floorPlanPreviewCaption.textContent = `${preview.displayName} · preview ${preview.width} x ${preview.height} · inference ${preview.inferenceWidth} x ${preview.inferenceHeight} ${preview.inferenceFormat.toUpperCase()}`;
  } else {
    floorPlanPreview.removeAttribute("src");
    floorPlanPreviewCaption.textContent = "";
  }

  floorPlanFacts.replaceChildren();
  for (const fact of imported.recognizedFacts) {
    const item = document.createElement("span");
    item.className = "floor-plan-fact";
    item.textContent = fact;
    floorPlanFacts.append(item);
  }

  const vision = viewState.visionReadiness;
  if (imported.status === "idle") {
    floorPlanImportStatus.textContent =
      viewState.roomMode === "default"
        ? "Verified default room is active. Load the packaged NARA PNG to begin a new import."
        : "No room is active. Load the packaged NARA PNG or choose an exact byte-for-byte copy, then Analyze layout; Use default room is an explicit fallback.";
  } else if (imported.status === "image_ready") {
    floorPlanImportStatus.textContent =
      "Preview only: exact NARA fixture identity passed PNG, 1020 x 1080, byte-length, and SHA-256 checks. No room geometry is active until Analyze layout succeeds.";
  } else if (imported.status === "analyzing") {
    floorPlanImportStatus.textContent = `Analyzing locally with ${vision.target.modelId}; no cloud endpoint or canned fallback.`;
  } else if (imported.status === "imported") {
    floorPlanImportStatus.textContent =
      "VLM visible-topology recognition passed. The app applied documented NARA scale plus canonical door, window, closet, and clearance geometry.";
  } else {
    const detail = (imported.error ?? "unknown error").replace(/[.\s]+$/u, "");
    floorPlanImportStatus.textContent = `Import failed closed: ${detail}. No room geometry was activated; retry Analyze layout or explicitly select Use default room.`;
  }

  const controlsBlocked = isBusy || operationBarrier.operationsBlocked;
  loadSampleFloorPlanButton.disabled = controlsBlocked;
  chooseFloorPlanButton.disabled = controlsBlocked;
  analyzeFloorPlanButton.disabled =
    controlsBlocked || preview === null || !["image_ready", "error"].includes(imported.status);
  useDefaultRoomButton.disabled = controlsBlocked || (viewState.roomMode === "default" && preview === null);
}

function nextStageTurnIndex(): number {
  return viewState.stageTurns.findIndex((turn) => !viewState.completedStageTurnIds.includes(turn.id));
}

function renderRuntime(readiness: RuntimeReadiness): void {
  const roomActive = activeRoomView() !== null;
  runtimeBadge.className = "runtime-badge";
  if (readiness.status === "configuration_invalid") {
    runtimeBadge.classList.add("is-error");
    runtimeLabel.textContent = runtimeBadgeLabel(readiness);
    prepareButton.textContent = "Fix environment override";
    prepareButton.disabled = true;
  } else if (readiness.status === "recovering" || readiness.status === "recovery_required") {
    runtimeBadge.classList.add(readiness.status === "recovering" ? "is-checking" : "is-error");
    runtimeLabel.textContent =
      readiness.status === "recovering" ? "Reset recovery in progress" : "Reset recovery required";
    prepareButton.textContent = "Runtime quarantined";
    prepareButton.disabled = true;
  } else if (readiness.localInferenceReady) {
    runtimeBadge.classList.add("is-ready");
    if (!readiness.target.stageValidated) {
      runtimeBadge.classList.add("is-override");
    }
    runtimeLabel.textContent = runtimeBadgeLabel(readiness);
    prepareButton.textContent = readiness.target.stageValidated ? "Local model ready" : "Override ready";
    prepareButton.disabled = true;
  } else if (readiness.status === "error" || readiness.status === "model_unavailable") {
    runtimeBadge.classList.add("is-error");
    runtimeLabel.textContent = readiness.target.stageValidated
      ? "Configured local model unavailable"
      : "Runtime override unavailable";
    prepareButton.textContent = "Retry local setup";
    prepareButton.disabled = isBusy || operationBarrier.operationsBlocked;
  } else {
    runtimeBadge.classList.add("is-checking");
    runtimeLabel.textContent = `${runtimeBadgeLabel(readiness)} · ${readiness.status.replaceAll("_", " ")}`;
    prepareButton.textContent = readiness.modelCached ? "Load local model" : "Prepare offline";
    prepareButton.disabled = isBusy || operationBarrier.operationsBlocked;
  }

  sendButton.disabled =
    !roomActive ||
    isBusy ||
    operationBarrier.operationsBlocked ||
    isAudioBusy() ||
    !readiness.localInferenceReady;
  promptInput.disabled =
    !roomActive ||
    isBusy ||
    operationBarrier.operationsBlocked ||
    audioRecorderState.status === "transcribing" ||
    !readiness.localInferenceReady;
  renderTrace();
}

function renderAudio(): void {
  const roomActive = activeRoomView() !== null;
  const readiness = viewState.audioReadiness;
  const pipelineReady = readiness.localAudioReady && viewState.readiness.localInferenceReady;
  const preparationActive = isAudioPreparationActive(audioPreparation.active, readiness.status);
  const modeControlsBlocked =
    previewMode ||
    runtimeStartupPending ||
    operationBarrier.operationsBlocked ||
    isBusy ||
    isAudioBusy() ||
    preparationActive;
  const modeDisplay = audioModeDisplay(readiness);
  audioBadge.className = "audio-badge";
  audioBadge.title = `${modeDisplay}. ${readiness.detail}`;
  if (audioRecorderState.status === "error" || readiness.status === "error") {
    audioBadge.classList.add("is-error");
    audioLabel.textContent = `${modeDisplay} · error`;
  } else if (
    isAudioBusy() ||
    ["checking", "loading", "streaming", "transcribing"].includes(readiness.status)
  ) {
    audioBadge.classList.add("is-busy");
    const activity =
      audioRecorderState.status === "recording"
        ? "recording locally"
        : audioRecorderState.status === "transcribing"
          ? "finalizing locally"
          : "preparing";
    audioLabel.textContent = `${modeDisplay} · ${activity}`;
  } else if (pipelineReady) {
    audioBadge.classList.add("is-ready");
    audioLabel.textContent = modeDisplay;
  } else if (readiness.localAudioReady) {
    audioBadge.classList.add("is-busy");
    audioLabel.textContent = `${modeDisplay} · load layout model`;
  } else {
    audioBadge.classList.add("is-idle");
    audioLabel.textContent = `${modeDisplay} · not ready`;
  }

  audioPrepareButton.disabled =
    modeControlsBlocked ||
    readiness.status === "streaming" ||
    (readiness.localAudioReady && readiness.activeMode === "nemotron_streaming");
  audioPrepareButton.textContent =
    readiness.localAudioReady && readiness.activeMode === "nemotron_streaming"
      ? "Nemotron ready"
      : "Prepare Nemotron live";
  audioFallbackButton.hidden = !shouldOfferWhisperFallback(readiness);
  audioFallbackButton.disabled = modeControlsBlocked;
  recordButton.disabled =
    previewMode ||
    !roomActive ||
    isBusy ||
    operationBarrier.operationsBlocked ||
    audioRecorderState.status === "requesting_permission" ||
    audioRecorderState.status === "transcribing" ||
    (!pipelineReady && audioRecorderState.status !== "recording");
  recordButton.classList.toggle("is-recording", audioRecorderState.status === "recording");
  recordButton.setAttribute("aria-pressed", String(audioRecorderState.status === "recording"));
  recordButton.textContent = audioRecorderState.status === "recording" ? "Stop" : "Start recording";
  recordingIndicator.hidden = audioRecorderState.status !== "recording";
  recordingTimer.textContent = formatElapsedTime(audioRecorderState.elapsedMs);
  audioStatus.textContent = audioRecorderState.detail || audioNotice || readiness.detail;
  liveTranscriptPanel.hidden =
    readiness.activeMode !== "nemotron_streaming" ||
    (!liveTranscriptDraft.text && audioRecorderState.status !== "recording");
  liveTranscriptLabel.textContent =
    liveTranscriptPhase === "submitted"
      ? isBusy
        ? "Submitted prompt — processing"
        : "Submitted prompt"
      : "Live draft — not sent";
  liveTranscriptText.textContent = liveTranscriptDraft.text || "Listening…";
}

function renderStageSteps(turns: readonly StageTurnDefinition[]): void {
  const roomActive = activeRoomView() !== null;
  stageSteps.replaceChildren();
  const nextIndex = nextStageTurnIndex();
  turns.forEach((turn, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-step";
    if (viewState.completedStageTurnIds.includes(turn.id)) {
      button.classList.add("is-complete");
    } else if (index === nextIndex) {
      button.classList.add("is-current");
    }
    button.innerHTML = `<span>${index + 1}</span><strong>${escapeHtml(turn.label)}</strong>`;
    button.disabled =
      !roomActive ||
      isBusy ||
      isAudioBusy() ||
      operationBarrier.operationsBlocked ||
      !viewState.readiness.localInferenceReady;
    button.addEventListener("click", () => void runTurn(turn.prompt, turn.id));
    stageSteps.append(button);
  });
}

function renderMessages(messages: readonly ConversationMessage[]): void {
  messagesElement.replaceChildren();
  for (const item of messages) {
    const article = document.createElement("article");
    article.className = `message message-${item.role}`;
    if (item.status) {
      article.classList.add(`is-${item.status}`);
    }
    const role = document.createElement("span");
    role.className = "message-role";
    role.textContent =
      item.role === "user"
        ? "Buyer"
        : item.role === "assistant"
          ? "Local assistant"
          : item.role === "application"
            ? "Application evidence"
            : "Application";
    const text = document.createElement("p");
    text.textContent = item.text;
    article.append(role, text);
    messagesElement.append(article);
  }
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function renderRecoveryActions(): void {
  const roomActive = activeRoomView() !== null;
  const recoveryPending =
    latestToolResult?.status === "no_feasible_option" &&
    viewState.completedStageTurnIds.includes("turn-b") &&
    !viewState.completedStageTurnIds.includes("turn-c");
  recoveryActions.hidden = !recoveryPending;
  recoveryPrimaryButton.disabled =
    !roomActive ||
    !recoveryPending ||
    isBusy ||
    isAudioBusy() ||
    operationBarrier.operationsBlocked ||
    !viewState.readiness.localInferenceReady;
}

function renderSpeechSuggestion(): void {
  speechSuggestionPanel.hidden = speechCorrection === null;
  if (speechCorrection === null) {
    speechSuggestionTitle.textContent = "";
    speechSuggestionText.textContent = "";
    return;
  }
  const applied = speechCorrection.status === "applied";
  speechSuggestionTitle.textContent = applied
    ? "Furniture corrections applied by you"
    : "Furniture correction suggestions";
  speechSuggestionText.textContent = speechCorrection.corrections
    .map((correction) => `“${correction.original}” → “${correction.replacement}”`)
    .join(" · ");
  speechApplyButton.hidden = applied;
  speechDismissButton.hidden = applied;
  speechUndoButton.hidden = !applied;
}

function resetRendererTransientUi(): void {
  const resetState = resetRendererTransientState({
    promptValue: promptInput.value,
    liveTranscriptDraft,
    liveTranscriptPhase,
    audioRecorderState,
    audioNotice,
    speechCorrection,
    speechCorrectionProvenance,
    trace: viewState.trace,
    manualPreview,
    manualPreviewOrigin,
    placementDrag,
  });
  releasePlacementDrag();
  focusedPlacementInstanceId = null;
  promptInput.blur();
  promptInput.value = resetState.promptValue;
  liveTranscriptDraft = resetState.liveTranscriptDraft;
  liveTranscriptPhase = resetState.liveTranscriptPhase;
  audioRecorderState = resetState.audioRecorderState;
  audioNotice = resetState.audioNotice;
  speechCorrection = resetState.speechCorrection;
  speechCorrectionProvenance = resetState.speechCorrectionProvenance;
  viewState = { ...viewState, trace: resetState.trace };
  manualPreview = resetState.manualPreview;
  manualPreviewOrigin = resetState.manualPreviewOrigin;
  placementDrag = resetState.placementDrag;
}

function renderLayout(): void {
  const activeRoom = activeRoomView();
  if (activeRoom === null) {
    renderInactiveRoomLayout();
    return;
  }
  const base = createLayoutPresentation(latestToolResult, viewState.selectedLayout, layoutEvidenceView);
  let displayLayout = base.displayLayout;
  let evidenceLayout = base.evidenceLayout;
  let roomConflicts = base.roomConflicts;
  let evidenceConflicts = base.conflicts;
  let evidenceChecks = base.checks;
  let badgeClass = base.resultBadgeClass;
  let badgeText = base.resultBadgeText;
  let title = base.layoutTitle;
  let notice = base.layoutNotice;
  let verdict = base.verdictTitle;
  let summary = latestToolResult?.summary ?? "The model has not proposed a tool call yet.";
  let displayChecksLabel = base.checksLabel;
  let displayConflictsLabel = base.conflictsLabel;

  if (manualPreview?.preview !== null && manualPreview?.preview !== undefined) {
    displayLayout = manualPreview.preview;
    evidenceLayout = manualPreview.preview;
    roomConflicts = manualPreview.preview.conflicts;
    evidenceConflicts = manualPreview.preview.conflicts;
    evidenceChecks = manualPreview.preview.checkedStates;
    badgeClass = manualPreview.accepted ? "result-badge is-success" : "result-badge is-error";
    badgeText = manualPreview.accepted ? "Valid manual preview" : "Rejected manual preview";
    title = `${manualPreview.preview.label} · ${manualPreview.accepted ? "ready to apply" : "rejected"}`;
    notice = manualPreview.accepted
      ? "App-owned preview passes every locked check. Apply creates a new accepted application layout version; Revert preserves the prior layout."
      : "App-owned preview failed deterministic validation and has not replaced the accepted layout. Revert to discard it.";
    verdict = manualPreview.accepted ? "Manual placement is valid" : "Manual placement rejected";
    summary = manualPreview.reason;
    displayChecksLabel = "Manual preview checks";
    displayConflictsLabel = "Manual preview conflicts";
  } else if (viewState.lastInteraction === "manual" && viewState.selectedLayout !== null) {
    displayLayout = viewState.selectedLayout;
    evidenceLayout = viewState.selectedLayout;
    roomConflicts = viewState.selectedLayout.conflicts;
    evidenceConflicts = viewState.selectedLayout.conflicts;
    evidenceChecks = viewState.selectedLayout.checkedStates;
    badgeClass = "result-badge is-success";
    badgeText = "Manual adjustment accepted";
    title = viewState.selectedLayout.label;
    notice =
      "This accepted layout version came from app-owned direct manipulation and was revalidated without model-generated geometry.";
    verdict = "All locked checks pass";
    summary = activeRoom.state.lastChangedPreference ?? "Manual placement accepted.";
    displayChecksLabel = "Accepted manual checks";
    displayConflictsLabel = "Accepted manual conflicts";
  }

  const layoutViewSwitchVisible =
    manualPreview === null &&
    viewState.lastInteraction === "turn" &&
    base.canShowAcceptedLayout &&
    base.canShowRejectedOption;
  const showingRejectedResultPreview =
    manualPreview === null && base.mode === "rejected_option" && base.activeView === "rejected";
  layoutViewActions.hidden = !layoutViewSwitchVisible;
  layoutViewActions.classList.toggle(
    "is-rejected-preview",
    layoutViewSwitchVisible && base.activeView === "rejected",
  );
  layoutViewActions.classList.toggle(
    "is-accepted-preserved",
    layoutViewSwitchVisible && base.activeView === "accepted",
  );
  if (layoutViewSwitchVisible && viewState.selectedLayout !== null) {
    const acceptedIdentity = `${viewState.selectedLayout.label} (${viewState.selectedLayout.id})`;
    layoutViewStatus.textContent =
      base.activeView === "rejected"
        ? `Rejected preview is displayed and is not accepted. Accepted layout preserved: ${acceptedIdentity}.`
        : `Accepted layout preserved: ${acceptedIdentity}. The rejected preview remains available without rerunning inference.`;
  } else {
    layoutViewStatus.textContent = "";
  }
  showAcceptedLayoutButton.hidden = !layoutViewSwitchVisible || base.activeView !== "rejected";
  showRejectedLayoutButton.hidden = !layoutViewSwitchVisible || base.activeView !== "accepted";
  showAcceptedLayoutButton.disabled = isBusy || operationBarrier.operationsBlocked;
  showRejectedLayoutButton.disabled = isBusy || operationBarrier.operationsBlocked;
  showAcceptedLayoutButton.setAttribute(
    "aria-pressed",
    String(layoutViewSwitchVisible && base.activeView === "accepted"),
  );
  showRejectedLayoutButton.setAttribute(
    "aria-pressed",
    String(layoutViewSwitchVisible && base.activeView === "rejected"),
  );

  roomCard.setAttribute(
    "aria-label",
    showingRejectedResultPreview
      ? "Rejected bedroom layout preview. Furniture is not accepted and cannot be adjusted."
      : "Interactive accepted bedroom layout diagram. Accepted furniture can be adjusted with arrow keys.",
  );
  roomCard.classList.remove("is-empty");
  roomCard.dataset.roomMode = activeRoom.roomMode;
  roomCard.dataset.roomPlanId = activeRoom.roomPlan.id;
  roomEmptyState.hidden = true;
  roomSvg.removeAttribute("hidden");
  roomSvg.classList.toggle("is-rejected-preview", showingRejectedResultPreview);
  renderRoomSvg(activeRoom, displayLayout, roomConflicts, manualPreview !== null);
  resultBadge.className = badgeClass;
  resultBadge.textContent = badgeText;
  layoutTitle.textContent = title;
  layoutNotice.textContent = notice;
  verdictTitle.textContent = verdict;
  verdictSummary.textContent = summary;
  checksLabel.textContent = displayChecksLabel;
  conflictsLabel.textContent = displayConflictsLabel;
  renderRequirements(activeRoom, displayLayout, evidenceLayout);
  renderManualPlacement(activeRoom.state);
  renderChecks(evidenceChecks, activeRoom.state.requiredRoomStates);
  renderConflicts(evidenceConflicts);
}

function renderInactiveRoomLayout(): void {
  layoutViewActions.hidden = true;
  layoutViewStatus.textContent = "";
  showAcceptedLayoutButton.hidden = true;
  showRejectedLayoutButton.hidden = true;
  roomCard.classList.add("is-empty");
  roomCard.dataset.roomMode = "none";
  delete roomCard.dataset.roomPlanId;
  roomCard.setAttribute(
    "aria-label",
    "No room loaded. Load or choose a floor plan to begin, or explicitly use the default room.",
  );
  roomEmptyState.hidden = false;
  roomSvg.setAttribute("hidden", "");
  roomSvg.classList.remove("is-rejected-preview");
  roomSvg.replaceChildren();
  resultBadge.className = "result-badge is-neutral";
  resultBadge.textContent = "Room required";
  layoutTitle.textContent = "Choose a room to begin";
  layoutNotice.textContent =
    "Analyze the selected floor plan to activate imported geometry, or explicitly select Use default room.";
  verdictTitle.textContent = "No room geometry active";
  verdictSummary.textContent =
    "The application is waiting for floor-plan intake. No walls, reserved zones, or furniture are rendered.";
  requirementsCard.classList.remove("is-rejected-evidence");
  requirementSummary.replaceChildren();
  const requirement = document.createElement("div");
  requirement.className = "requirement-item";
  requirement.textContent = "Room measurements and locked constraints appear only after a room is active.";
  requirementSummary.append(requirement);
  measurementList.replaceChildren();
  const measurement = document.createElement("div");
  measurement.className = "measurement-item";
  measurement.textContent = "No room measurements yet.";
  measurementList.append(measurement);
  manualPlacementCard.classList.remove("is-valid", "is-invalid");
  manualPlacementStatus.textContent = "Choose a room before using direct manipulation.";
  manualApplyButton.disabled = true;
  manualRevertButton.disabled = true;
  checksLabel.textContent = "Locked checks";
  conflictsLabel.textContent = "Visible conflicts";
  renderChecks([], []);
  renderConflicts([]);
}

function renderRoomSvg(
  activeRoom: ActiveRoomView,
  layout: EvaluatedLayoutOption | null,
  conflicts: readonly LayoutConflict[],
  isManualPreview: boolean,
): void {
  const roomPlan = activeRoom.roomPlan;
  roomSvg.replaceChildren();
  roomSvg.setAttribute("viewBox", `-180 -260 ${roomPlan.widthMm + 360} ${roomPlan.depthMm + 540}`);
  const title = svgElement("title");
  title.textContent = "Interactive bedroom layout";
  roomSvg.append(title);
  const defs = svgElement("defs");
  const pattern = svgElement("pattern", {
    id: "reservedPattern",
    width: "80",
    height: "80",
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  pattern.append(
    svgElement("line", {
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "80",
      stroke: "#F5A524",
      "stroke-width": "28",
      opacity: "0.45",
    }),
  );
  defs.append(pattern);
  roomSvg.append(defs);

  roomSvg.append(
    svgElement("rect", {
      x: "0",
      y: "0",
      width: String(roomPlan.widthMm),
      height: String(roomPlan.depthMm),
      rx: "30",
      fill: "#0D1B2A",
      stroke: "#C7D2E3",
      "stroke-width": "34",
    }),
  );

  const conflictZoneIds = new Set(
    conflicts.flatMap((conflict) => (conflict.zoneId === undefined ? [] : [conflict.zoneId])),
  );
  for (const zone of roomPlan.reservedZones) {
    const conflicted = conflictZoneIds.has(zone.id);
    roomSvg.append(
      svgElement("rect", {
        x: String(zone.rect.xMm),
        y: String(zone.rect.yMm),
        width: String(zone.rect.widthMm),
        height: String(zone.rect.depthMm),
        fill: conflicted
          ? "#D92D3B66"
          : zone.kind === "closet-access"
            ? "url(#reservedPattern)"
            : "#2D9CDB33",
        stroke: conflicted ? "#FF4054" : zone.kind === "closet-access" ? "#F5A524" : "#56CCF2",
        "stroke-width": conflicted ? "34" : "24",
        "stroke-dasharray": "45 28",
      }),
    );
    appendSvgLabel(
      zone.label,
      zone.rect.xMm + zone.rect.widthMm / 2,
      zone.rect.yMm + zone.rect.depthMm / 2,
      "#F8FAFC",
    );
  }

  for (const swing of roomPlan.doorSwings) {
    const doorConflicted = conflictZoneIds.has(swing.id);
    roomSvg.append(
      svgElement("path", {
        d: doorSwingPath(swing),
        fill: doorConflicted ? "#D92D3B66" : "#EB575733",
        stroke: doorConflicted ? "#FF4054" : "#EB5757",
        "stroke-width": doorConflicted ? "34" : "24",
        "stroke-dasharray": "40 25",
      }),
    );
    const label = doorSwingLabelPoint(swing);
    appendSvgLabel(swing.label, label.xMm, label.yMm, "#FFD6D6");
  }

  renderSvgMeasurements(layout);

  if (isManualPreview && manualPreviewOrigin !== null) {
    roomSvg.append(
      svgElement("rect", {
        x: String(manualPreviewOrigin.rect.xMm),
        y: String(manualPreviewOrigin.rect.yMm),
        width: String(manualPreviewOrigin.rect.widthMm),
        height: String(manualPreviewOrigin.rect.depthMm),
        rx: "38",
        fill: "#6EA8FE1A",
        stroke: "#6EA8FE",
        "stroke-width": "18",
        "stroke-dasharray": "35 24",
        "pointer-events": "none",
      }),
    );
  }

  const conflictObjects = new Set(conflicts.flatMap((conflict) => conflict.objectIds));
  for (const placement of layout?.placements ?? []) {
    const conflicted = conflictObjects.has(placement.instanceId);
    const placementRect = svgElement("rect", {
      x: String(placement.rect.xMm),
      y: String(placement.rect.yMm),
      width: String(placement.rect.widthMm),
      height: String(placement.rect.depthMm),
      rx: "38",
      fill: conflicted ? "#D92D3B99" : placement.color,
      stroke: conflicted ? "#FF4054" : "#F8FAFC",
      "stroke-width": conflicted ? "34" : "22",
      opacity: isManualPreview ? "0.82" : "1",
    });
    const adjustable = placementIsAdjustable(layout, placement);
    placementRect.classList.add("furniture-placement");
    placementRect.setAttribute("data-rendered-placement-id", placement.instanceId);
    placementRect.setAttribute("data-layout-status", layout?.status ?? "unknown");
    placementRect.setAttribute("data-interactive", String(adjustable));
    if (adjustable) {
      placementRect.classList.add("draggable-placement");
      if (placementDrag?.instanceId === placement.instanceId) {
        placementRect.classList.add("is-dragging");
      }
      placementRect.setAttribute("tabindex", "0");
      placementRect.setAttribute("focusable", "true");
      placementRect.setAttribute("role", "button");
      placementRect.setAttribute("data-placement-id", placement.instanceId);
      placementRect.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape");
      placementRect.setAttribute(
        "aria-label",
        `${placement.label}, draggable. Use arrow keys for ${MANUAL_PLACEMENT_GRID_MM} millimetre adjustments.`,
      );
      placementRect.addEventListener("pointerdown", (event) => {
        beginPlacementDrag(event, placement);
      });
      placementRect.addEventListener("keydown", (event) => {
        handlePlacementKey(event, placement);
      });
    }
    roomSvg.append(placementRect);
    appendSvgLabel(
      `${placement.label}\n${placement.rect.widthMm} x ${placement.rect.depthMm} mm`,
      placement.rect.xMm + placement.rect.widthMm / 2,
      placement.rect.yMm + placement.rect.depthMm / 2,
      "#FFFFFF",
    );
  }

  appendSvgLabel(`${roomPlan.widthMm} mm`, roomPlan.widthMm / 2, -110, "#DCE7F7");
  const depth = svgElement("text", {
    x: "-90",
    y: String(roomPlan.depthMm / 2),
    fill: "#DCE7F7",
    "font-size": "120",
    "font-weight": "700",
    "text-anchor": "middle",
    transform: `rotate(-90 -90 ${roomPlan.depthMm / 2})`,
  });
  depth.textContent = `${roomPlan.depthMm} mm`;
  roomSvg.append(depth);
  focusPlacement(focusedPlacementInstanceId);
}

function renderSvgMeasurements(layout: EvaluatedLayoutOption | null): void {
  if (layout === null) {
    return;
  }
  const placements = new Map(layout.placements.map((placement) => [placement.instanceId, placement]));
  for (const measurement of layout.measurements) {
    const left = placements.get(measurement.objectIds[0]);
    const right = placements.get(measurement.objectIds[1]);
    if (left === undefined || right === undefined) {
      continue;
    }
    const separation = rectangleSeparation(left.rect, right.rect);
    let from = separation.from;
    let to = separation.to;
    if (from.xMm === to.xMm && from.yMm === to.yMm) {
      from = placementCenter(left);
      to = placementCenter(right);
    }
    const color = measurement.passed ? "#35C68A" : "#FF5263";
    roomSvg.append(
      svgElement("line", {
        x1: String(from.xMm),
        y1: String(from.yMm),
        x2: String(to.xMm),
        y2: String(to.yMm),
        stroke: color,
        "stroke-width": measurement.passed ? "16" : "28",
        "stroke-dasharray": measurement.passed ? "24 18" : "none",
      }),
    );
    for (const point of [from, to]) {
      roomSvg.append(
        svgElement("circle", {
          cx: String(point.xMm),
          cy: String(point.yMm),
          r: measurement.passed ? "24" : "32",
          fill: color,
        }),
      );
    }
    const shortfall = Math.max(0, measurement.requiredDistanceMm - measurement.actualDistanceMm);
    appendSvgCallout(
      `${measurement.actualDistanceMm} / ${measurement.requiredDistanceMm} mm${
        shortfall > 0 ? ` · ${shortfall} short` : ""
      }`,
      (from.xMm + to.xMm) / 2,
      (from.yMm + to.yMm) / 2 - 46,
      color,
    );
  }
}

function placementCenter(placement: ResolvedPlacement): Point {
  return {
    xMm: placement.rect.xMm + placement.rect.widthMm / 2,
    yMm: placement.rect.yMm + placement.rect.depthMm / 2,
  };
}

function renderRequirements(
  activeRoom: ActiveRoomView,
  layout: EvaluatedLayoutOption | null,
  evidenceLayout: EvaluatedLayoutOption | null,
): void {
  const { roomPlan, state } = activeRoom;
  requirementsCard.classList.toggle("is-rejected-evidence", evidenceLayout?.status === "rejected");
  requirementSummary.replaceChildren();
  const acceptedFurniture = state.activeFurnitureIds.map((id) => furnitureCatalog[id].label).join(", ");
  const displayFurniture = layout?.placements.map((placement) => placement.label).join(", ") ?? "None";
  const evidenceFurniture =
    evidenceLayout?.placements.map((placement) => placement.label).join(", ") ?? "None";
  const closet = roomPlan.reservedZones.find((zone) => zone.kind === "closet-access");
  const windowZone = roomPlan.reservedZones.find((zone) => zone.kind === "window-clearance");
  const requirements = [
    `<strong>Furniture clearance:</strong> ${clearanceRuleSet.minimumFurnitureGapMm} mm minimum`,
    `<strong>Door swings:</strong> keep ${roomPlan.doorSwings
      .map((swing) => `${swing.radiusMm} mm`)
      .join(" + ")} clear`,
    closet === undefined
      ? "<strong>Fixed obstruction:</strong> none recognized in the imported fixture"
      : `<strong>Closet access:</strong> keep ${closet.rect.widthMm} x ${closet.rect.depthMm} mm zone clear`,
    `<strong>Window clearance:</strong> keep ${windowZone?.rect.widthMm ?? 0} x ${windowZone?.rect.depthMm ?? 0} mm zone clear`,
    `<strong>Accepted state:</strong> ${escapeHtml(acceptedFurniture || "No furniture accepted yet")}`,
    `<strong>${layout?.status === "rejected" ? "Preview" : "Displayed"} furniture:</strong> ${escapeHtml(displayFurniture)}`,
  ];
  if (state.currentLayoutId !== null) {
    requirements.push(
      `<strong>Accepted provenance:</strong> ${escapeHtml(
        state.currentLayoutSource?.replaceAll("-", " ") ?? "unknown source",
      )} · ${escapeHtml(state.currentLayoutId)}`,
    );
  }
  if (evidenceLayout?.status === "rejected") {
    requirements.push(
      `<strong>Rejected option:</strong> ${escapeHtml(evidenceLayout.label)} · ${escapeHtml(evidenceLayout.id)}`,
      `<strong>Rejected option furniture:</strong> ${escapeHtml(evidenceFurniture)}`,
      `<strong>Rejected provenance:</strong> deterministic ${escapeHtml(
        evidenceLayout.placementSource.replaceAll("-", " "),
      )}; not accepted`,
    );
  }
  const changedPreference =
    viewState.lastInteraction === "manual"
      ? state.lastChangedPreference
      : (latestToolResult?.changedPreference ?? state.lastChangedPreference);
  if (changedPreference !== null && changedPreference !== undefined) {
    requirements.push(`<strong>Changed this turn:</strong> ${escapeHtml(changedPreference)}`);
  }
  for (const value of requirements) {
    const item = document.createElement("div");
    item.className = "requirement-item";
    item.innerHTML = value;
    requirementSummary.append(item);
  }

  measurementList.replaceChildren();
  const measurementLayout = evidenceLayout ?? layout;
  if (measurementLayout === null || measurementLayout.measurements.length === 0) {
    const empty = document.createElement("div");
    empty.className = "measurement-item";
    empty.textContent = "No furniture-pair measurements yet.";
    measurementList.append(empty);
    return;
  }
  for (const measurement of measurementLayout.measurements) {
    const item = document.createElement("div");
    item.className = `measurement-item ${measurement.passed ? "is-pass" : "is-fail"}`;
    const shortfall = Math.max(0, measurement.requiredDistanceMm - measurement.actualDistanceMm);
    const evidencePrefix = measurementLayout.status === "rejected" ? "Rejected evidence · " : "";
    item.innerHTML = `<strong>${evidencePrefix}${escapeHtml(measurement.labels[0])} ↔ ${escapeHtml(
      measurement.labels[1],
    )}:</strong> ${measurement.actualDistanceMm} mm / required ${measurement.requiredDistanceMm} mm${
      shortfall > 0 ? ` · ${shortfall} mm short` : ""
    }`;
    measurementList.append(item);
  }
}

function renderManualPlacement(state: DemoStateSnapshot): void {
  manualPlacementCard.classList.remove("is-valid", "is-invalid");
  if (manualPreview !== null) {
    manualPlacementCard.classList.add(manualPreview.accepted ? "is-valid" : "is-invalid");
    manualPlacementStatus.textContent = manualPreview.accepted
      ? `${manualPreview.reason} Apply to create a new accepted application layout version, or Revert.`
      : `${manualPreview.reason} This rejected preview has not changed the accepted layout.`;
  } else if (viewState.lastInteraction === "manual") {
    manualPlacementCard.classList.add("is-valid");
    manualPlacementStatus.textContent =
      state.lastChangedPreference ?? "The accepted manual placement passes all locked checks.";
  } else if (viewState.selectedLayout === null) {
    manualPlacementStatus.textContent = "Accept a feasible layout before using direct manipulation.";
  } else if (latestToolResult?.status === "no_feasible_option" && layoutEvidenceView === "rejected") {
    manualPlacementStatus.textContent =
      'Rejected preview is displayed and cannot be edited or applied. Select "Show accepted layout" to return to the preserved active layout.';
  } else if (latestToolResult?.status === "no_feasible_option") {
    manualPlacementCard.classList.add("is-valid");
    manualPlacementStatus.textContent =
      "The accepted layout remains active after the rejected request. Drag it, or focus furniture and use the arrow keys.";
  } else {
    manualPlacementStatus.textContent =
      "Drag accepted furniture, or focus it and use the arrow keys. Movement snaps to a 50 mm grid.";
  }
  manualApplyButton.disabled =
    manualPreview?.accepted !== true || isBusy || operationBarrier.operationsBlocked;
  manualRevertButton.disabled = manualPreview === null || isBusy || operationBarrier.operationsBlocked;
}

function placementIsAdjustable(layout: EvaluatedLayoutOption | null, placement: ResolvedPlacement): boolean {
  if (
    layout === null ||
    viewState.selectedLayout === null ||
    isBusy ||
    isAudioBusy() ||
    operationBarrier.operationsBlocked ||
    !viewState.readiness.localInferenceReady
  ) {
    return false;
  }
  const displaysAcceptedLayout = layout.id === viewState.selectedLayout.id;
  const displaysManualPreview = manualPreview?.preview?.id === layout.id;
  if (layout.status === "rejected" && !displaysManualPreview) {
    return false;
  }
  if (!displaysAcceptedLayout && !displaysManualPreview) {
    return false;
  }
  return viewState.selectedLayout.placements.some(
    (candidate) => candidate.instanceId === placement.instanceId,
  );
}

function currentDemoState(): DemoState {
  const activeRoom = activeRoomView();
  if (activeRoom === null) {
    throw new Error("Cannot create demo state without an active room.");
  }
  return {
    ...activeRoom.state,
    lastToolResult: latestToolResult,
  };
}

function manualRequest(instanceId: string, origin: Point): ManualPlacementRequest | null {
  const activeRoom = activeRoomView();
  if (activeRoom === null || viewState.selectedLayout === null) {
    return null;
  }
  return {
    priorStateRef: activeRoom.state.stateRef,
    sourceLayoutId: viewState.selectedLayout.id,
    instanceId,
    xMm: origin.xMm,
    yMm: origin.yMm,
  };
}

function evaluateManualPreview(request: ManualPlacementRequest): void {
  const activeRoom = activeRoomView();
  if (activeRoom === null) {
    return;
  }
  focusedPlacementInstanceId = request.instanceId;
  manualPreview = evaluateManualPlacement(
    currentDemoState(),
    viewState.selectedLayout,
    request,
    activeRoom.roomPlan,
  );
  renderLayout();
}

function focusPlacement(instanceId: string | null): void {
  if (instanceId === null) {
    return;
  }
  const placement = [...roomSvg.querySelectorAll<SVGRectElement>("[data-placement-id]")].find(
    (element) => element.dataset.placementId === instanceId,
  );
  placement?.focus({ preventScroll: true });
}

function beginPlacementDrag(event: PointerEvent, placement: ResolvedPlacement): void {
  if (!placementIsAdjustable(manualPreview?.preview ?? viewState.selectedLayout, placement)) {
    return;
  }
  const point = pointerRoomPoint(event);
  const acceptedPlacement = viewState.selectedLayout?.placements.find(
    (candidate) => candidate.instanceId === placement.instanceId,
  );
  if (acceptedPlacement === undefined) {
    return;
  }
  event.preventDefault();
  focusedPlacementInstanceId = placement.instanceId;
  if (event.currentTarget instanceof SVGElement) {
    event.currentTarget.focus({ preventScroll: true });
  }
  releasePlacementDrag();
  placementDrag = {
    pointerId: event.pointerId,
    instanceId: placement.instanceId,
    grabOffset: {
      xMm: point.xMm - placement.rect.xMm,
      yMm: point.yMm - placement.rect.yMm,
    },
    originRect: acceptedPlacement.rect,
  };
  roomSvg.setPointerCapture(event.pointerId);
  renderLayout();
}

function updatePlacementDrag(event: PointerEvent): void {
  const drag = placementDrag;
  const activeRoom = activeRoomView();
  if (
    activeRoom === null ||
    drag === null ||
    drag.pointerId !== event.pointerId ||
    viewState.selectedLayout === null
  ) {
    return;
  }
  const placement = viewState.selectedLayout.placements.find(
    (candidate) => candidate.instanceId === drag.instanceId,
  );
  if (placement === undefined) {
    return;
  }
  event.preventDefault();
  const origin = snappedPlacementOrigin(
    pointerRoomPoint(event),
    drag.grabOffset,
    placement.rect,
    activeRoom.roomPlan,
  );
  const request = manualRequest(drag.instanceId, origin);
  if (request !== null) {
    manualPreviewOrigin = {
      instanceId: drag.instanceId,
      rect: drag.originRect,
    };
    evaluateManualPreview(request);
  }
}

function finishPlacementDrag(event: PointerEvent): void {
  if (placementDrag?.pointerId !== event.pointerId) {
    return;
  }
  releasePlacementDrag(event.pointerId);
  if (manualPreview === null) {
    manualPreviewOrigin = null;
  }
  renderLayout();
}

function releasePlacementDrag(pointerId?: number): void {
  const drag = placementDrag;
  if (drag === null || (pointerId !== undefined && drag.pointerId !== pointerId)) {
    return;
  }
  if (roomSvg.hasPointerCapture(drag.pointerId)) {
    roomSvg.releasePointerCapture(drag.pointerId);
  }
  placementDrag = null;
}

function pointerRoomPoint(event: PointerEvent): Point {
  const clientRect = roomSvg.getBoundingClientRect();
  const viewBox = roomSvg.viewBox.baseVal;
  return clientPointToRoomPoint(
    { x: event.clientX, y: event.clientY },
    {
      left: clientRect.left,
      top: clientRect.top,
      width: clientRect.width,
      height: clientRect.height,
    },
    {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width,
      height: viewBox.height,
    },
  );
}

function handlePlacementKey(event: KeyboardEvent, placement: ResolvedPlacement): void {
  if (event.key === "Escape") {
    event.preventDefault();
    revertManualPreview();
    return;
  }
  if (event.key === "Enter" && manualPreview?.accepted === true) {
    event.preventDefault();
    void applyManualPreview();
    return;
  }
  if (
    event.key !== "ArrowUp" &&
    event.key !== "ArrowDown" &&
    event.key !== "ArrowLeft" &&
    event.key !== "ArrowRight"
  ) {
    return;
  }
  const acceptedPlacement = viewState.selectedLayout?.placements.find(
    (candidate) => candidate.instanceId === placement.instanceId,
  );
  if (acceptedPlacement === undefined) {
    return;
  }
  const activeRoom = activeRoomView();
  if (activeRoom === null) {
    return;
  }
  event.preventDefault();
  focusedPlacementInstanceId = placement.instanceId;
  manualPreviewOrigin = {
    instanceId: placement.instanceId,
    rect: acceptedPlacement.rect,
  };
  const origin = keyboardPlacementOrigin(
    placement.rect,
    event.key,
    activeRoom.roomPlan,
    MANUAL_PLACEMENT_GRID_MM,
  );
  const request = manualRequest(placement.instanceId, origin);
  if (request !== null) {
    evaluateManualPreview(request);
  }
}

async function applyManualPreview(): Promise<void> {
  if (manualPreview?.accepted !== true || demoApi === null || isBusy || operationBarrier.operationsBlocked) {
    return;
  }
  const lifecycleGeneration = operationBarrier.beginOperation();
  const conversationGeneration = viewState.conversationGeneration;
  setBusy(true);
  try {
    const response = await demoApi.applyManualPlacement(manualPreview.request);
    if (!operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    if (!isCurrentConversationResult(response, conversationGeneration)) {
      throw new Error("Discarded a stale manual placement result from an earlier conversation generation.");
    }
    if (viewState.roomMode === "none") {
      throw new Error("Cannot apply manual placement without an active room.");
    }
    manualPreview = response.outcome.accepted ? null : response.outcome;
    manualPreviewOrigin = response.outcome.accepted ? null : manualPreviewOrigin;
    viewState = {
      ...viewState,
      state: response.outcome.state,
      selectedLayout: response.outcome.selectedLayout,
      completedStageTurnIds: response.completedStageTurnIds,
      lastInteraction: response.lastInteraction,
      messages: response.messages,
      trace: response.trace,
    };
    renderAll();
  } catch (error) {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      showRuntimeError(error);
    }
  } finally {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      setBusy(false);
    }
  }
}

function revertManualPreview(): void {
  releasePlacementDrag();
  manualPreview = null;
  manualPreviewOrigin = null;
  renderLayout();
}

function renderChecks(
  checks: readonly CheckedRoomState[],
  requiredRoomStates: DemoStateSnapshot["requiredRoomStates"],
): void {
  constraintChecks.replaceChildren();
  const fallback = requiredRoomStates.map((id) => ({
    id,
    label: id.replaceAll("-", " "),
    passed: false,
    evidence: "Not evaluated yet.",
  }));
  if (checks.length === 0 && fallback.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No room checks are active.";
    constraintChecks.append(empty);
    return;
  }
  for (const check of checks.length > 0 ? checks : fallback) {
    const row = document.createElement("div");
    row.className = `constraint-row ${checks.length === 0 ? "is-pending" : check.passed ? "is-pass" : "is-fail"}`;
    const indicator = document.createElement("span");
    indicator.textContent = checks.length === 0 ? "-" : check.passed ? "PASS" : "FAIL";
    const label = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = check.label;
    const evidence = document.createElement("small");
    evidence.textContent = check.evidence;
    label.append(strong, evidence);
    row.append(indicator, label);
    constraintChecks.append(row);
  }
}

function renderConflicts(conflicts: readonly LayoutConflict[]): void {
  conflictList.replaceChildren();
  if (conflicts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent =
      latestToolResult?.status === "feasible" ? "No deterministic conflicts." : "No conflicts to display.";
    conflictList.append(empty);
    return;
  }
  for (const conflict of conflicts) {
    const card = document.createElement("div");
    card.className = "conflict-item";
    const code = document.createElement("strong");
    code.textContent = conflict.code.replaceAll("_", " ");
    const text = document.createElement("p");
    text.textContent = conflict.message;
    card.append(code, text);
    conflictList.append(card);
  }
}

function renderTrace(): void {
  if (!viewState) {
    return;
  }
  runtimeTrace.textContent = pretty({
    readiness: viewState.readiness,
    audioReadiness: viewState.audioReadiness,
    visionReadiness: viewState.visionReadiness,
    floorPlanVision: lastTracePayload("floor-plan-vision") ?? "No floor-plan image has been analyzed.",
    currentState: viewState.state,
  });
  audioTrace.textContent = pretty({
    rawTranscript: lastTracePayload("audio-transcription") ?? "No speech transcript yet.",
    appliedSuggestion: speechCorrectionProvenance ?? "No furniture correction suggestion has been applied.",
  });
  toolTrace.textContent = pretty(lastTracePayload("model-tool-call") ?? "No tool call yet.");
  geometryTrace.textContent = pretty({
    validation: lastTracePayload("validation") ?? "No validation yet.",
    geometry: lastTracePayload("geometry") ?? "No geometry result yet.",
    manualPlacement: lastTracePayload("manual-placement") ?? "No manual placement yet.",
  });
}

function lastTracePayload(kind: TraceEntry["kind"]): unknown {
  for (let index = viewState.trace.length - 1; index >= 0; index -= 1) {
    const entry = viewState.trace[index];
    if (entry?.kind === kind) {
      return entry.payload;
    }
  }
  return null;
}

function renderProgress(event: ProgressEvent): void {
  if (event.phase === "complete") {
    progressBar.hidden = true;
    return;
  }
  progressBar.hidden = false;
  progressPhase.textContent = event.phase.replaceAll("-", " ");
  progressDetail.textContent = event.detail;
  if (event.phase === "error") {
    progressBar.classList.add("is-error");
  } else {
    progressBar.classList.remove("is-error");
  }
}

function handleAudioPartial(event: AudioPartialTranscriptEvent): void {
  const operation = voiceOperation;
  if (
    operation === null ||
    operation.mode !== "nemotron_streaming" ||
    operation.streamId !== event.streamId ||
    !operationBarrier.isCurrentOperation(operation.lifecycleGeneration)
  ) {
    return;
  }
  liveTranscriptDraft = applyPartialTranscriptEvent(liveTranscriptDraft, event);
  liveTranscriptPhase = "draft";
  audioNotice = `Live Nemotron draft · first partial ${event.firstPartialMs} ms · not sent`;
  renderAudio();
}

function setBusy(value: boolean): void {
  const roomActive = activeRoomView() !== null;
  isBusy = value;
  sendButton.disabled =
    !roomActive ||
    value ||
    operationBarrier.operationsBlocked ||
    isAudioBusy() ||
    !viewState.readiness.localInferenceReady;
  promptInput.disabled =
    !roomActive ||
    value ||
    operationBarrier.operationsBlocked ||
    audioRecorderState.status === "transcribing" ||
    !viewState.readiness.localInferenceReady;
  prepareButton.disabled =
    value || operationBarrier.operationsBlocked || viewState.readiness.localInferenceReady;
  resetButton.disabled = operationBarrier.resetInFlight;
  traceToggle.disabled = operationBarrier.operationsBlocked;
  traceClose.disabled = operationBarrier.operationsBlocked;
  if (!value) {
    progressBar.hidden = true;
  }
  renderStageSteps(viewState.stageTurns);
  renderAll();
}

function setTraceOpen(open: boolean): void {
  tracePanel.classList.toggle("is-open", open);
  tracePanel.setAttribute("aria-hidden", String(!open));
  traceToggle.setAttribute("aria-expanded", String(open));
}

function showRuntimeError(error: unknown): void {
  runtimeBadge.className = "runtime-badge is-error";
  runtimeLabel.textContent = "Local runtime error";
  viewState = {
    ...viewState,
    readiness: {
      ...viewState.readiness,
      status: "error",
      localInferenceReady: false,
      detail: error instanceof Error ? error.message : String(error),
    },
  };
  renderRuntime(viewState.readiness);
}

async function startRecording(): Promise<void> {
  if (
    previewMode ||
    activeRoomView() === null ||
    !viewState.audioReadiness.localAudioReady ||
    !viewState.readiness.localInferenceReady ||
    isBusy ||
    operationBarrier.operationsBlocked ||
    isAudioBusy()
  ) {
    return;
  }

  const mode = viewState.audioReadiness.activeMode;
  if (mode === null) {
    showAudioError(new Error("Prepare a voice model before recording."));
    return;
  }

  const lifecycleGeneration = operationBarrier.beginOperation();
  const operationId = ++audioOperationId;
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, {
    type: "REQUEST_PERMISSION",
  });
  audioNotice = "Allow microphone access to record locally.";
  renderAudio();

  let pendingStream: MediaStream | null = null;
  let pendingStreamId: string | null = null;
  try {
    await demoApi.authorizeMicrophone();
    if (operationId !== audioOperationId || !operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    pendingStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (operationId !== audioOperationId || !operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      releaseMediaStream(pendingStream);
      pendingStream = null;
      return;
    }

    if (mode === "nemotron_streaming") {
      const start = await demoApi.startAudioStream({
        format: AUDIO_FORMAT,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        maxDurationMs: AUDIO_MAX_DURATION_MS,
      });
      pendingStreamId = start.streamId;
    }

    const operation: VoiceCaptureOperation = {
      operationId,
      lifecycleGeneration,
      conversationGeneration: viewState.conversationGeneration,
      mode,
      stream: pendingStream,
      capture: null,
      pump: null,
      streamId: pendingStreamId,
      chunks: [],
      totalBytes: 0,
      startedAt: performance.now(),
      recordingTimerId: null,
      recordingLimitId: null,
      stopped: false,
    };
    if (pendingStreamId !== null) {
      const streamId = pendingStreamId;
      operation.pump = new BoundedAudioChunkPump(
        (sequence, data) =>
          demoApi.appendAudioChunk({
            streamId,
            sequence,
            data,
          }),
        (error) => {
          if (!operation.stopped) {
            void handleVoiceCaptureError(operation, error);
          }
        },
      );
    }
    voiceOperation = operation;
    pendingStream = null;
    pendingStreamId = null;
    const capture = await LivePcmCapture.start(
      operation.stream,
      (chunk) => handlePcmChunk(operation, chunk),
      (error) => {
        void handleVoiceCaptureError(operation, error);
      },
    );
    if (
      voiceOperation !== operation ||
      operationId !== audioOperationId ||
      !operationBarrier.isCurrentOperation(lifecycleGeneration)
    ) {
      await capture.stop().catch(() => []);
      releaseMediaStream(operation.stream);
      return;
    }
    operation.capture = capture;
    audioRecorderState = reduceAudioRecorderState(audioRecorderState, { type: "START" });
    liveTranscriptDraft = {
      streamId: operation.streamId,
      sequence: -1,
      text: "",
      isFinal: false,
    };
    liveTranscriptPhase = "draft";
    audioNotice =
      mode === "nemotron_streaming"
        ? `Live captions are local and capped at ${AUDIO_MAX_DURATION_MS / 1000} seconds.`
        : `Whisper fallback records locally for up to ${AUDIO_MAX_DURATION_MS / 1000} seconds.`;
    operation.recordingTimerId = window.setInterval(() => updateRecordingTimer(operation), 100);
    operation.recordingLimitId = window.setTimeout(() => {
      if (voiceOperation === operation) {
        void stopAndTranscribe(operation);
      }
    }, AUDIO_MAX_DURATION_MS);
    renderAll();
  } catch (error) {
    const operation = voiceOperation;
    if (operation?.operationId === operationId) {
      await cleanupVoiceOperation(operation, true);
    }
    releaseMediaStream(pendingStream);
    if (pendingStreamId !== null) {
      await demoApi.cancelAudioStream({ streamId: pendingStreamId }).catch(() => undefined);
    }
    if (operationId === audioOperationId && operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      showAudioError(error, microphoneErrorMessage(error));
    }
  }
}

async function stopAndTranscribe(operation: VoiceCaptureOperation | null = voiceOperation): Promise<void> {
  if (operation === null || voiceOperation !== operation || operation.stopped) {
    return;
  }
  const { operationId } = operation;
  operation.stopped = true;
  clearRecordingTimers(operation);
  updateRecordingTimer(operation);
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, { type: "TRANSCRIBE" });
  audioNotice =
    operation.mode === "nemotron_streaming"
      ? "Finalizing the local live transcript."
      : "Transcribing the local Whisper fallback recording.";
  renderAll();

  let completed = false;
  try {
    for (const chunk of (await operation.capture?.stop()) ?? []) {
      appendPcmChunk(operation, chunk);
    }
    releaseMediaStream(operation.stream);
    if (
      operationId !== audioOperationId ||
      !operationBarrier.isCurrentOperation(operation.lifecycleGeneration) ||
      demoApi === null
    ) {
      return;
    }

    const audioDurationMs = audioDurationMsFromPcmBytes(operation.totalBytes);
    if (audioDurationMs < AUDIO_MIN_DURATION_MS) {
      throw new Error(`Record at least ${AUDIO_MIN_DURATION_MS / 1000} seconds before stopping.`);
    }

    let response: AudioTranscriptionResponse;
    if (operation.mode === "nemotron_streaming") {
      await operation.pump?.flush();
      if (operation.streamId === null || operation.pump === null) {
        throw new Error("Nemotron stream state is incomplete.");
      }
      response = await demoApi.finishAudioStream({
        streamId: operation.streamId,
        lastSequence: operation.pump.lastSequence,
        audioDurationMs,
      });
    } else {
      const pcm = concatenatePcmChunks(operation.chunks, operation.totalBytes);
      const data = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
      response = await demoApi.transcribeAudio({
        format: AUDIO_FORMAT,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        durationMs: audioDurationMs,
        data,
      });
    }
    if (
      operationId !== audioOperationId ||
      !operationBarrier.isCurrentOperation(operation.lifecycleGeneration)
    ) {
      return;
    }
    if (!isCurrentConversationResult(response, operation.conversationGeneration)) {
      throw new Error("Discarded a stale audio result from an earlier conversation generation.");
    }
    viewState = {
      ...viewState,
      audioReadiness: response.audioReadiness,
      trace: response.trace,
    };
    const correction = applySpeechCorrectionSuggestions(response.result.transcript);
    const suggestionDraft = createSpeechSuggestionDraft(promptInput.value, correction);
    promptInput.value = suggestionDraft.promptValue;
    speechCorrection = suggestionDraft.suggestion;
    speechCorrectionProvenance = null;
    promptInput.focus();
    audioRecorderState = reduceAudioRecorderState(audioRecorderState, { type: "COMPLETE" });
    liveTranscriptDraft = {
      streamId: operation.streamId,
      sequence: Number.MAX_SAFE_INTEGER,
      text: response.result.transcript,
      isFinal: true,
    };
    liveTranscriptPhase = "draft";
    audioNotice =
      correction.corrections.length > 0
        ? "Furniture correction suggestions are available. Apply or dismiss them before Send."
        : `${
            response.result.mode === "nemotron_streaming" ? "Nemotron final" : "Whisper fallback"
          } transcript added. Review it, then click Send.`;
    completed = true;
    renderAll();
  } catch (error) {
    if (
      operationId === audioOperationId &&
      operationBarrier.isCurrentOperation(operation.lifecycleGeneration)
    ) {
      await refreshRuntimeState();
      showAudioError(error);
    }
  } finally {
    await cleanupVoiceOperation(operation, !completed);
  }
}

async function discardRecording(cancelRemote = true): Promise<void> {
  const operation = voiceOperation;
  const cleanupPromise = operation === null ? null : cleanupVoiceOperation(operation, cancelRemote);
  audioOperationId += 1;
  liveTranscriptDraft = emptyLiveTranscriptDraft();
  liveTranscriptPhase = "draft";
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, { type: "RESET" });
  await cleanupPromise;
}

function handlePcmChunk(operation: VoiceCaptureOperation, chunk: Uint8Array): void {
  if (
    voiceOperation !== operation ||
    operation.stopped ||
    !operationBarrier.isCurrentOperation(operation.lifecycleGeneration)
  ) {
    return;
  }
  appendPcmChunk(operation, chunk);
}

function appendPcmChunk(operation: VoiceCaptureOperation, chunk: Uint8Array): void {
  const remaining = AUDIO_MAX_PCM_BYTES - operation.totalBytes;
  if (remaining <= 0) {
    return;
  }
  const bounded = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
  operation.totalBytes += bounded.byteLength;
  if (operation.mode === "nemotron_streaming") {
    operation.pump?.enqueue(bounded);
  } else {
    operation.chunks.push(bounded.slice());
  }
}

async function handleVoiceCaptureError(operation: VoiceCaptureOperation, error: unknown): Promise<void> {
  if (voiceOperation !== operation || !operationBarrier.isCurrentOperation(operation.lifecycleGeneration)) {
    return;
  }
  await cleanupVoiceOperation(operation, true);
  showAudioError(error);
}

function updateRecordingTimer(operation: VoiceCaptureOperation): void {
  if (audioRecorderState.status !== "recording" || voiceOperation !== operation) {
    return;
  }
  const elapsedMs = Math.min(
    AUDIO_MAX_DURATION_MS,
    Math.max(0, Math.round(performance.now() - operation.startedAt)),
  );
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, {
    type: "TICK",
    elapsedMs,
  });
  recordingTimer.textContent = formatElapsedTime(elapsedMs);
}

function clearRecordingTimers(operation: VoiceCaptureOperation): void {
  if (operation.recordingTimerId !== null) {
    window.clearInterval(operation.recordingTimerId);
    operation.recordingTimerId = null;
  }
  if (operation.recordingLimitId !== null) {
    window.clearTimeout(operation.recordingLimitId);
    operation.recordingLimitId = null;
  }
}

async function cleanupVoiceOperation(operation: VoiceCaptureOperation, cancelRemote: boolean): Promise<void> {
  if (voiceOperation !== operation) {
    return;
  }
  voiceOperation = null;
  clearRecordingTimers(operation);
  operation.pump?.cancel();
  const captureCleanup = operation.capture?.stop().catch(() => []) ?? Promise.resolve([]);
  releaseMediaStream(operation.stream);
  operation.chunks.length = 0;
  await captureCleanup;
  if (cancelRemote && operation.streamId !== null && demoApi !== null) {
    await demoApi.cancelAudioStream({ streamId: operation.streamId }).catch(() => undefined);
  }
}

function concatenatePcmChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function emptyLiveTranscriptDraft(): LiveTranscriptDraft {
  return {
    streamId: null,
    sequence: -1,
    text: "",
    isFinal: false,
  };
}

function isAudioBusy(): boolean {
  return ["requesting_permission", "recording", "transcribing"].includes(audioRecorderState.status);
}

function showAudioError(error: unknown, override?: string): void {
  const detail = override ?? (error instanceof Error ? error.message : String(error));
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, {
    type: "FAIL",
    detail,
  });
  audioNotice = detail;
  renderAll();
}

function showResetError(error: unknown): void {
  renderProgress({
    phase: "error",
    detail: `Reset failed: ${error instanceof Error ? error.message : String(error)}`,
  });
}

function showImportError(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  viewState = {
    ...viewState,
    floorPlanImport: {
      ...viewState.floorPlanImport,
      status: "error",
      error: detail,
    },
  };
  renderProgress({ phase: "error", detail: `Floor-plan import failed: ${detail}` });
  renderFloorPlanImport();
}

function startResetRecoveryMonitor(conversationGeneration: number): void {
  if (resetRecoveryMonitor?.conversationGeneration === conversationGeneration) {
    return;
  }
  let trackedPromise: Promise<void>;
  trackedPromise = monitorResetRecovery(conversationGeneration).finally(() => {
    if (resetRecoveryMonitor?.promise === trackedPromise) {
      resetRecoveryMonitor = null;
    }
  });
  resetRecoveryMonitor = {
    conversationGeneration,
    promise: trackedPromise,
  };
}

async function monitorResetRecovery(conversationGeneration: number): Promise<void> {
  await Promise.resolve();
  while (
    operationBarrier.resetQuarantined &&
    resetRecoveryMonitor?.conversationGeneration === conversationGeneration
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (
      demoApi === null ||
      !operationBarrier.resetQuarantined ||
      resetRecoveryMonitor?.conversationGeneration !== conversationGeneration
    ) {
      return;
    }
    try {
      const bootstrap = await demoApi.getBootstrap();
      if (
        resetRecoveryMonitor?.conversationGeneration !== conversationGeneration ||
        !operationBarrier.resetQuarantined ||
        !isAuthoritativeResetBootstrap(bootstrap, conversationGeneration)
      ) {
        continue;
      }
      viewState = bootstrap;
      latestToolResult = bootstrap.lastToolResult;
      layoutEvidenceView = "accepted";
      renderAll();
      if (
        bootstrap.readiness.status !== "recovering" &&
        bootstrap.readiness.status !== "recovery_required" &&
        operationBarrier.releaseResetQuarantine()
      ) {
        resetButton.disabled = false;
        traceToggle.disabled = false;
        traceClose.disabled = false;
        renderAll();
      }
    } catch {
      // Keep the quarantine and retry while the main process remains unavailable.
    }
  }
}

async function refreshRuntimeState(): Promise<void> {
  if (demoApi === null) {
    return;
  }
  try {
    const bootstrap = await demoApi.getBootstrap();
    if (bootstrap.conversationGeneration !== viewState.conversationGeneration) {
      return;
    }
    viewState = {
      ...viewState,
      readiness: bootstrap.readiness,
      audioReadiness: bootstrap.audioReadiness,
      trace: bootstrap.trace,
    };
  } catch {
    // Preserve the last known state when the main process is unavailable.
  }
}

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied. Typed input remains available.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found. Typed input remains available.";
    }
    if (error.name === "NotReadableError") {
      return "The microphone is busy or unavailable. Typed input remains available.";
    }
  }
  return error instanceof Error ? error.message : "Microphone capture failed.";
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

window.addEventListener("beforeunload", () => {
  void discardRecording(false);
});

function appendSvgCallout(text: string, x: number, y: number, color: string): void {
  const label = svgElement("text", {
    x: String(x),
    y: String(y),
    fill: color,
    "font-size": "82",
    "font-weight": "800",
    "text-anchor": "middle",
    "dominant-baseline": "middle",
    style: "paint-order:stroke;stroke:#07111f;stroke-width:18px;stroke-linejoin:round",
  });
  label.textContent = text;
  roomSvg.append(label);
}

function doorSwingPath(swing: DoorSwing): string {
  const east = swing.quadrant.endsWith("east");
  const south = swing.quadrant.startsWith("south");
  const start = {
    xMm: swing.hingeXmm,
    yMm: swing.hingeYmm + (south ? swing.radiusMm : -swing.radiusMm),
  };
  const end = {
    xMm: swing.hingeXmm + (east ? swing.radiusMm : -swing.radiusMm),
    yMm: swing.hingeYmm,
  };
  const sweep = east !== south ? 1 : 0;
  return `M ${swing.hingeXmm} ${swing.hingeYmm} L ${start.xMm} ${start.yMm} A ${swing.radiusMm} ${swing.radiusMm} 0 0 ${sweep} ${end.xMm} ${end.yMm} Z`;
}

function doorSwingLabelPoint(swing: DoorSwing): Point {
  const east = swing.quadrant.endsWith("east");
  const south = swing.quadrant.startsWith("south");
  return {
    xMm: swing.hingeXmm + (east ? swing.radiusMm * 0.48 : -swing.radiusMm * 0.48),
    yMm: swing.hingeYmm + (south ? swing.radiusMm * 0.48 : -swing.radiusMm * 0.48),
  };
}

function appendSvgLabel(text: string, x: number, y: number, color: string): void {
  const label = svgElement("text", {
    x: String(x),
    y: String(y),
    fill: color,
    "font-size": "118",
    "font-weight": "700",
    "text-anchor": "middle",
    "dominant-baseline": "middle",
    style: "paint-order:stroke;stroke:#07111f;stroke-width:16px;stroke-linejoin:round",
  });
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const span = svgElement("tspan", {
      x: String(x),
      dy: index === 0 ? "0" : "135",
    });
    span.textContent = line;
    label.append(span);
  });
  roomSvg.append(label);
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Readonly<Record<string, string>> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function pretty(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`#${id} is not a button`);
  }
  return element;
}

function requiredTextArea(id: string): HTMLTextAreaElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`#${id} is not a textarea`);
  }
  return element;
}

function requiredForm(id: string): HTMLFormElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLFormElement)) {
    throw new Error(`#${id} is not a form`);
  }
  return element;
}

function requiredImage(id: string): HTMLImageElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLImageElement)) {
    throw new Error(`#${id} is not an image`);
  }
  return element;
}

function requiredSvg(id: string): SVGSVGElement {
  const element = document.getElementById(id);
  if (!(element instanceof SVGSVGElement)) {
    throw new Error(`#${id} is not an SVG element`);
  }
  return element;
}

function rectDescription(rect: Rectangle): string {
  return `${rect.widthMm} x ${rect.depthMm} mm at (${rect.xMm}, ${rect.yMm})`;
}

void rectDescription;
