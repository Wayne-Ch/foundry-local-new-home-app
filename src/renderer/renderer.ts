import {
  applyPartialTranscriptEvent,
  audioDurationMsFromPcmBytes,
  createTranscriptDraftUpdate,
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
import type {
  CheckedRoomState,
  EvaluatedLayoutOption,
  LayoutConflict,
  LayoutToolResult,
  Rectangle,
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
import { createLayoutPresentation } from "./layout-presentation";
import { RendererOperationBarrier } from "./operation-barrier";
import { createPreviewApi } from "./preview-api";
import {
  isAudioPreparationActive,
  resetAfterStartingCleanup,
  SingleFlightOperation,
} from "./renderer-lifecycle";
import { runtimeBadgeLabel } from "./runtime-presentation";
import "./styles.css";

const svgNamespace = "http://www.w3.org/2000/svg";
const previewMode = new URLSearchParams(window.location.search).get("preview") === "1";
const demoApi = window.demoApi ?? (previewMode ? createPreviewApi() : null);

let viewState: BootstrapPayload;
let latestToolResult: LayoutToolResult | null = null;
let isBusy = false;
let runtimeStartupPending = true;
let audioRecorderState: AudioRecorderState = { status: "idle", elapsedMs: 0, detail: "" };
let audioNotice = "Editable draft only; click Send to submit.";
let voiceOperation: VoiceCaptureOperation | null = null;
let liveTranscriptDraft: LiveTranscriptDraft = {
  streamId: null,
  sequence: -1,
  text: "",
  isFinal: false,
};
const operationBarrier = new RendererOperationBarrier();
const audioPreparation = new SingleFlightOperation();
let audioOperationId = 0;
let resetRecoveryMonitor: Promise<void> | null = null;

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
const liveTranscriptText = requiredElement("liveTranscriptText");
const traceToggle = requiredButton("traceToggle");
const traceClose = requiredButton("traceClose");
const resetButton = requiredButton("resetButton");
const nextTurnButton = requiredButton("nextTurnButton");
const messagesElement = requiredElement("messages");
const promptForm = requiredForm("promptForm");
const promptInput = requiredTextArea("promptInput");
const sendButton = requiredButton("sendButton");
const stageSteps = requiredElement("stageSteps");
const turnCounter = requiredElement("turnCounter");
const resultBadge = requiredElement("resultBadge");
const layoutTitle = requiredElement("layoutTitle");
const layoutNotice = requiredElement("layoutNotice");
const roomSvg = requiredSvg("roomSvg");
const verdictTitle = requiredElement("verdictTitle");
const verdictSummary = requiredElement("verdictSummary");
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

interface VoiceCaptureOperation {
  readonly operationId: number;
  readonly lifecycleGeneration: number;
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
  viewState = {
    ...viewState,
    audioReadiness: {
      ...viewState.audioReadiness,
      status: "checking",
      detail: "Inspecting the local speech model.",
    },
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
  setBusy(true);
  try {
    const bootstrap = await resetAfterStartingCleanup(
      () => discardRecording(false),
      () => api.resetConversation(),
    );
    if (!operationBarrier.isCurrentReset(resetGeneration)) {
      return;
    }
    viewState = bootstrap;
    latestToolResult = null;
    audioNotice = "Editable draft only; click Send to submit.";
    renderAll();
  } catch (error) {
    if (!operationBarrier.isCurrentReset(resetGeneration)) {
      return;
    }
    try {
      const bootstrap = await demoApi.getBootstrap();
      if (operationBarrier.isCurrentReset(resetGeneration)) {
        viewState = bootstrap;
        latestToolResult = bootstrap.lastToolResult;
        renderAll();
      }
    } catch {
      // Keep the last rendered state and surface the reset failure below.
    }
    if (operationBarrier.failReset(resetGeneration)) {
      runtimeStartupPending = false;
      setBusy(false);
      showResetError(error);
      startResetRecoveryMonitor();
    }
    return;
  }
  if (operationBarrier.finishReset(resetGeneration)) {
    runtimeStartupPending = false;
    setBusy(false);
  }
});

nextTurnButton.addEventListener("click", () => {
  const index = Math.min(viewState.state.version, viewState.stageTurns.length - 1);
  const turn = viewState.stageTurns[index];
  if (turn !== undefined) {
    void runTurn(turn.prompt, turn.id);
  }
});

promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (isAudioBusy()) {
    return;
  }
  const prompt = promptInput.value.trim();
  if (!prompt) {
    return;
  }
  promptInput.value = "";
  void runTurn(prompt);
});

async function runTurn(prompt: string, scriptedTurnId?: StageTurnId): Promise<void> {
  if (
    isBusy ||
    operationBarrier.operationsBlocked ||
    isAudioBusy() ||
    !viewState.readiness.localInferenceReady
  ) {
    return;
  }
  const lifecycleGeneration = operationBarrier.beginOperation();
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
    applyTurnResponse(response);
  } catch (error) {
    if (!operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      return;
    }
    progressBar.hidden = true;
    showRuntimeError(error);
    viewState = await demoApi.getBootstrap();
    renderAll();
  } finally {
    if (operationBarrier.isCurrentOperation(lifecycleGeneration)) {
      setBusy(false);
    }
  }
}

function applyTurnResponse(response: RunTurnResponse): void {
  latestToolResult = response.toolResult;
  viewState = {
    ...viewState,
    state: response.state,
    selectedLayout: response.selectedLayout,
    messages: response.messages,
    trace: response.trace,
    readiness: response.readiness,
  };
  renderAll();
}

function renderAll(): void {
  renderRuntime(viewState.readiness);
  renderAudio();
  renderStageSteps(viewState.stageTurns);
  renderMessages(viewState.messages);
  renderLayout();
  renderTrace();
  turnCounter.textContent = `State v${viewState.state.version}`;
  const nextIndex = viewState.state.version;
  nextTurnButton.textContent =
    nextIndex < viewState.stageTurns.length
      ? `Run next: ${viewState.stageTurns[nextIndex]?.label ?? "scripted turn"}`
      : "Scripted story complete";
  nextTurnButton.disabled =
    isBusy ||
    operationBarrier.operationsBlocked ||
    !viewState.readiness.localInferenceReady ||
    nextIndex >= viewState.stageTurns.length;
}

function renderRuntime(readiness: RuntimeReadiness): void {
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
    isBusy || operationBarrier.operationsBlocked || isAudioBusy() || !readiness.localInferenceReady;
  promptInput.disabled =
    isBusy ||
    operationBarrier.operationsBlocked ||
    audioRecorderState.status === "transcribing" ||
    !readiness.localInferenceReady;
  renderTrace();
}

function renderAudio(): void {
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
  liveTranscriptText.textContent = liveTranscriptDraft.text || "Listening…";
}

function renderStageSteps(turns: readonly StageTurnDefinition[]): void {
  stageSteps.replaceChildren();
  turns.forEach((turn, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stage-step";
    if (index < viewState.state.version) {
      button.classList.add("is-complete");
    } else if (index === viewState.state.version) {
      button.classList.add("is-current");
    }
    button.innerHTML = `<span>${index + 1}</span><strong>${escapeHtml(turn.label)}</strong>`;
    button.disabled = isBusy || isAudioBusy() || !viewState.readiness.localInferenceReady;
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

function renderLayout(): void {
  const presentation = createLayoutPresentation(latestToolResult, viewState.selectedLayout);
  renderRoomSvg(presentation.displayLayout, presentation.conflicts);
  resultBadge.className = presentation.resultBadgeClass;
  resultBadge.textContent = presentation.resultBadgeText;
  layoutTitle.textContent = presentation.layoutTitle;
  layoutNotice.textContent = presentation.layoutNotice;
  verdictTitle.textContent = presentation.verdictTitle;
  verdictSummary.textContent = latestToolResult?.summary ?? "The model has not proposed a tool call yet.";
  checksLabel.textContent = presentation.checksLabel;
  conflictsLabel.textContent = presentation.conflictsLabel;
  renderChecks(presentation.checks);
  renderConflicts(presentation.conflicts);
}

function renderRoomSvg(layout: EvaluatedLayoutOption | null, conflicts: readonly LayoutConflict[]): void {
  roomSvg.replaceChildren();
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
      width: String(viewState.roomPlan.widthMm),
      height: String(viewState.roomPlan.depthMm),
      rx: "30",
      fill: "#0D1B2A",
      stroke: "#C7D2E3",
      "stroke-width": "34",
    }),
  );

  for (const zone of viewState.roomPlan.reservedZones) {
    roomSvg.append(
      svgElement("rect", {
        x: String(zone.rect.xMm),
        y: String(zone.rect.yMm),
        width: String(zone.rect.widthMm),
        height: String(zone.rect.depthMm),
        fill: zone.kind === "closet-access" ? "url(#reservedPattern)" : "#2D9CDB33",
        stroke: zone.kind === "closet-access" ? "#F5A524" : "#56CCF2",
        "stroke-width": "24",
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

  roomSvg.append(
    svgElement("path", {
      d: "M 0 3600 L 0 2700 A 900 900 0 0 1 900 3600 Z",
      fill: "#EB575733",
      stroke: "#EB5757",
      "stroke-width": "24",
      "stroke-dasharray": "40 25",
    }),
  );
  appendSvgLabel("Door swing", 430, 3290, "#FFD6D6");

  const conflictObjects = new Set(conflicts.flatMap((conflict) => conflict.objectIds));
  for (const placement of layout?.placements ?? []) {
    const conflicted = conflictObjects.has(placement.instanceId);
    roomSvg.append(
      svgElement("rect", {
        x: String(placement.rect.xMm),
        y: String(placement.rect.yMm),
        width: String(placement.rect.widthMm),
        height: String(placement.rect.depthMm),
        rx: "38",
        fill: conflicted ? "#D92D3B99" : placement.color,
        stroke: conflicted ? "#FF4054" : "#F8FAFC",
        "stroke-width": conflicted ? "34" : "22",
      }),
    );
    appendSvgLabel(
      `${placement.label}\n${placement.rect.widthMm} x ${placement.rect.depthMm} mm`,
      placement.rect.xMm + placement.rect.widthMm / 2,
      placement.rect.yMm + placement.rect.depthMm / 2,
      "#FFFFFF",
    );
  }

  appendSvgLabel(`${viewState.roomPlan.widthMm} mm`, viewState.roomPlan.widthMm / 2, -110, "#DCE7F7");
  const depth = svgElement("text", {
    x: "-90",
    y: String(viewState.roomPlan.depthMm / 2),
    fill: "#DCE7F7",
    "font-size": "120",
    "font-weight": "700",
    "text-anchor": "middle",
    transform: `rotate(-90 -90 ${viewState.roomPlan.depthMm / 2})`,
  });
  depth.textContent = `${viewState.roomPlan.depthMm} mm`;
  roomSvg.append(depth);
}

function renderChecks(checks: readonly CheckedRoomState[]): void {
  constraintChecks.replaceChildren();
  const fallback = viewState.state.requiredRoomStates.map((id) => ({
    id,
    label: id.replaceAll("-", " "),
    passed: false,
    evidence: "Not evaluated yet.",
  }));
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
    currentState: viewState.state,
  });
  audioTrace.textContent = pretty(lastTracePayload("audio-transcription") ?? "No speech transcript yet.");
  toolTrace.textContent = pretty(lastTracePayload("model-tool-call") ?? "No tool call yet.");
  geometryTrace.textContent = pretty({
    validation: lastTracePayload("validation") ?? "No validation yet.",
    geometry: lastTracePayload("geometry") ?? "No geometry result yet.",
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
  audioNotice = `Live Nemotron draft · first partial ${event.firstPartialMs} ms · not sent`;
  renderAudio();
}

function setBusy(value: boolean): void {
  isBusy = value;
  sendButton.disabled =
    value || operationBarrier.operationsBlocked || isAudioBusy() || !viewState.readiness.localInferenceReady;
  promptInput.disabled =
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
    viewState = {
      ...viewState,
      audioReadiness: response.audioReadiness,
      trace: response.trace,
    };
    const draft = createTranscriptDraftUpdate(promptInput.value, response.result.transcript);
    promptInput.value = draft.value;
    promptInput.focus();
    audioRecorderState = reduceAudioRecorderState(audioRecorderState, { type: "COMPLETE" });
    liveTranscriptDraft = {
      streamId: operation.streamId,
      sequence: Number.MAX_SAFE_INTEGER,
      text: response.result.transcript,
      isFinal: true,
    };
    audioNotice = `${
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

function startResetRecoveryMonitor(): void {
  if (resetRecoveryMonitor !== null) {
    return;
  }
  let trackedPromise: Promise<void>;
  trackedPromise = monitorResetRecovery().finally(() => {
    if (resetRecoveryMonitor === trackedPromise) {
      resetRecoveryMonitor = null;
    }
  });
  resetRecoveryMonitor = trackedPromise;
}

async function monitorResetRecovery(): Promise<void> {
  while (operationBarrier.resetQuarantined) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (demoApi === null || !operationBarrier.resetQuarantined) {
      return;
    }
    try {
      const bootstrap = await demoApi.getBootstrap();
      viewState = bootstrap;
      latestToolResult = bootstrap.lastToolResult;
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
