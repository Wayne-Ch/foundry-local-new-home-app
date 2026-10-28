import { createTranscriptDraftUpdate, reduceAudioRecorderState } from "../audio/audio-contract";
import { AUDIO_MAX_DURATION_MS, type AudioRecorderState } from "../audio/audio-types";
import type {
  CheckedRoomState,
  EvaluatedLayoutOption,
  LayoutConflict,
  LayoutToolResult,
  Rectangle,
  RuntimeReadiness,
} from "../domain/types";
import type {
  BootstrapPayload,
  ConversationMessage,
  ProgressEvent,
  RunTurnResponse,
  StageTurnDefinition,
  StageTurnId,
  TraceEntry,
} from "../shared/contracts";
import {
  type AudioRecorderOperation,
  type AudioRecorderOperationRef,
  chooseRecordingMimeType,
  cleanupRecorderOperation,
  isCurrentRecorderOperation,
  recordedBlobToAudioPayload,
  releaseMediaStream,
} from "./audio-capture";
import { createLayoutPresentation } from "./layout-presentation";
import { createPreviewApi } from "./preview-api";
import { runtimeBadgeLabel } from "./runtime-presentation";
import "./styles.css";

const svgNamespace = "http://www.w3.org/2000/svg";
const previewMode = new URLSearchParams(window.location.search).get("preview") === "1";
const demoApi = window.demoApi ?? (previewMode ? createPreviewApi() : null);

let viewState: BootstrapPayload;
let latestToolResult: LayoutToolResult | null = null;
let isBusy = false;
let audioRecorderState: AudioRecorderState = { status: "idle", elapsedMs: 0, detail: "" };
let audioNotice = "Editable draft only; click Send to submit.";
const recorderOperationRef: AudioRecorderOperationRef = { current: null };
let audioOperationId = 0;

const runtimeBadge = requiredElement("runtimeBadge");
const runtimeLabel = requiredElement("runtimeLabel");
const prepareButton = requiredButton("prepareButton");
const audioBadge = requiredElement("audioBadge");
const audioLabel = requiredElement("audioLabel");
const audioPrepareButton = requiredButton("audioPrepareButton");
const recordButton = requiredButton("recordButton");
const audioStatus = requiredElement("audioStatus");
const recordingIndicator = requiredElement("recordingIndicator");
const recordingTimer = requiredElement("recordingTimer");
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

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize(): Promise<void> {
  if (demoApi === null) {
    throw new Error("Electron preload API is unavailable. Use ?preview=1 only for visual inspection.");
  }
  previewBanner.hidden = !previewMode;
  viewState = await demoApi.getBootstrap();
  latestToolResult = viewState.lastToolResult;
  renderAll();
  demoApi.onProgress(renderProgress);
  try {
    const readiness = await demoApi.initializeRuntime();
    viewState = { ...viewState, readiness };
  } catch (error) {
    viewState = {
      ...viewState,
      readiness: {
        ...viewState.readiness,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  renderRuntime(viewState.readiness);
}

prepareButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    if (demoApi === null) {
      return;
    }
    const response = await demoApi.prepareOffline();
    viewState = { ...viewState, readiness: response.readiness };
    renderRuntime(response.readiness);
  } catch (error) {
    showRuntimeError(error);
  } finally {
    setBusy(false);
  }
});

audioPrepareButton.addEventListener("click", async () => {
  if (demoApi === null || previewMode || isAudioBusy()) {
    return;
  }
  const operationId = ++audioOperationId;
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
    const response = await demoApi.prepareAudio();
    if (operationId !== audioOperationId) {
      return;
    }
    viewState = { ...viewState, audioReadiness: response.readiness };
    audioNotice = "Microphone model is ready. Press Start recording.";
  } catch (error) {
    if (operationId !== audioOperationId) {
      return;
    }
    await refreshRuntimeState();
    showAudioError(error);
  }
  renderAudio();
});

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
  if (isBusy) {
    return;
  }
  if (demoApi === null) {
    return;
  }
  await discardRecording();
  const operationId = audioOperationId;
  const bootstrap = await demoApi.resetConversation();
  if (operationId !== audioOperationId) {
    return;
  }
  viewState = bootstrap;
  latestToolResult = null;
  audioNotice = "Editable draft only; click Send to submit.";
  renderAll();
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
  if (isBusy || isAudioBusy() || !viewState.readiness.localInferenceReady) {
    return;
  }
  setBusy(true);
  try {
    if (demoApi === null) {
      return;
    }
    const response = await demoApi.runTurn({
      prompt,
      ...(scriptedTurnId ? { scriptedTurnId } : {}),
    });
    applyTurnResponse(response);
  } catch (error) {
    progressBar.hidden = true;
    showRuntimeError(error);
    viewState = await demoApi.getBootstrap();
    renderAll();
  } finally {
    setBusy(false);
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
    isBusy || !viewState.readiness.localInferenceReady || nextIndex >= viewState.stageTurns.length;
}

function renderRuntime(readiness: RuntimeReadiness): void {
  runtimeBadge.className = "runtime-badge";
  if (readiness.status === "configuration_invalid") {
    runtimeBadge.classList.add("is-error");
    runtimeLabel.textContent = runtimeBadgeLabel(readiness);
    prepareButton.textContent = "Fix environment override";
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
    prepareButton.disabled = isBusy;
  } else {
    runtimeBadge.classList.add("is-checking");
    runtimeLabel.textContent = `${runtimeBadgeLabel(readiness)} · ${readiness.status.replaceAll("_", " ")}`;
    prepareButton.textContent = readiness.modelCached ? "Load local model" : "Prepare offline";
    prepareButton.disabled = isBusy;
  }

  sendButton.disabled = isBusy || isAudioBusy() || !readiness.localInferenceReady;
  promptInput.disabled =
    isBusy || audioRecorderState.status === "transcribing" || !readiness.localInferenceReady;
  renderTrace();
}

function renderAudio(): void {
  const readiness = viewState.audioReadiness;
  const pipelineReady = readiness.localAudioReady && viewState.readiness.localInferenceReady;
  audioBadge.className = "audio-badge";
  if (audioRecorderState.status === "error" || readiness.status === "error") {
    audioBadge.classList.add("is-error");
    audioLabel.textContent = "Voice input error";
  } else if (isAudioBusy() || ["checking", "loading", "transcribing"].includes(readiness.status)) {
    audioBadge.classList.add("is-busy");
    audioLabel.textContent =
      audioRecorderState.status === "recording"
        ? "Recording locally"
        : audioRecorderState.status === "transcribing"
          ? "Transcribing locally"
          : "Preparing voice input";
  } else if (pipelineReady) {
    audioBadge.classList.add("is-ready");
    audioLabel.textContent = `${readiness.model?.alias ?? "Local ASR"} · ${readiness.model?.deviceType ?? ""}`;
  } else if (readiness.localAudioReady) {
    audioBadge.classList.add("is-busy");
    audioLabel.textContent = "ASR ready · load layout model";
  } else {
    audioBadge.classList.add("is-idle");
    audioLabel.textContent = "Voice input not ready";
  }

  audioPrepareButton.disabled =
    previewMode ||
    isBusy ||
    isAudioBusy() ||
    ["checking", "loading"].includes(readiness.status) ||
    readiness.localAudioReady;
  audioPrepareButton.textContent = readiness.localAudioReady ? "ASR model ready" : "Prepare microphone";
  recordButton.disabled =
    previewMode ||
    isBusy ||
    audioRecorderState.status === "requesting_permission" ||
    audioRecorderState.status === "transcribing" ||
    (!pipelineReady && audioRecorderState.status !== "recording");
  recordButton.classList.toggle("is-recording", audioRecorderState.status === "recording");
  recordButton.setAttribute("aria-pressed", String(audioRecorderState.status === "recording"));
  recordButton.textContent =
    audioRecorderState.status === "recording" ? "Stop & transcribe" : "Start recording";
  recordingIndicator.hidden = audioRecorderState.status !== "recording";
  recordingTimer.textContent = formatElapsedTime(audioRecorderState.elapsedMs);
  audioStatus.textContent = audioRecorderState.detail || audioNotice || readiness.detail;
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

function setBusy(value: boolean): void {
  isBusy = value;
  sendButton.disabled = value || isAudioBusy() || !viewState.readiness.localInferenceReady;
  promptInput.disabled =
    value || audioRecorderState.status === "transcribing" || !viewState.readiness.localInferenceReady;
  prepareButton.disabled = value || viewState.readiness.localInferenceReady;
  resetButton.disabled = value;
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
    isAudioBusy()
  ) {
    return;
  }

  const operationId = ++audioOperationId;
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, {
    type: "REQUEST_PERMISSION",
  });
  audioNotice = "Allow microphone access to record locally.";
  renderAudio();

  let pendingStream: MediaStream | null = null;
  try {
    await demoApi.authorizeMicrophone();
    if (operationId !== audioOperationId) {
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
    if (operationId !== audioOperationId) {
      releaseMediaStream(pendingStream);
      pendingStream = null;
      return;
    }

    const mimeType = chooseRecordingMimeType();
    const recorder = new MediaRecorder(pendingStream, mimeType ? { mimeType } : undefined);
    const operation: AudioRecorderOperation = {
      operationId,
      recorder,
      stream: pendingStream,
      chunks: [],
      startedAt: performance.now(),
      recordingTimerId: null,
      recordingLimitId: null,
    };
    recorderOperationRef.current = operation;
    pendingStream = null;
    recorder.addEventListener("dataavailable", (event) => {
      if (isCurrentRecorderOperation(recorderOperationRef, operation) && event.data.size > 0) {
        operation.chunks.push(event.data);
      }
    });
    recorder.addEventListener("error", (event) => handleRecorderError(operation, event));
    recorder.start(250);
    audioRecorderState = reduceAudioRecorderState(audioRecorderState, { type: "START" });
    audioNotice = `Recording is capped at ${AUDIO_MAX_DURATION_MS / 1000} seconds.`;
    operation.recordingTimerId = window.setInterval(() => updateRecordingTimer(operation), 100);
    operation.recordingLimitId = window.setTimeout(() => {
      if (isCurrentRecorderOperation(recorderOperationRef, operation)) {
        void stopAndTranscribe(operation);
      }
    }, AUDIO_MAX_DURATION_MS);
    renderAll();
  } catch (error) {
    const operation = recorderOperationRef.current;
    if (operation?.operationId === operationId) {
      cleanupActiveRecorder(operation, true);
    }
    releaseMediaStream(pendingStream);
    if (operationId === audioOperationId) {
      showAudioError(error, microphoneErrorMessage(error));
    }
  }
}

async function stopAndTranscribe(
  operation: AudioRecorderOperation | null = recorderOperationRef.current,
): Promise<void> {
  if (
    operation === null ||
    !isCurrentRecorderOperation(recorderOperationRef, operation) ||
    operation.recorder.state === "inactive"
  ) {
    return;
  }
  const { operationId, recorder } = operation;
  clearRecordingTimers(operation);
  updateRecordingTimer(operation);
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, { type: "TRANSCRIBE" });
  audioNotice = "Converting the local capture to 16 kHz mono PCM.";
  renderAll();

  try {
    const blob = await stopRecorder(recorder, operation.chunks);
    cleanupActiveRecorder(operation, false);
    const payload = await recordedBlobToAudioPayload(blob);
    if (operationId !== audioOperationId || demoApi === null) {
      return;
    }
    audioNotice = "Foundry Local is transcribing on device.";
    renderAudio();
    const response = await demoApi.transcribeAudio(payload);
    if (operationId !== audioOperationId) {
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
    audioNotice = `Transcript added in ${response.result.transcriptionMs} ms. Review it, then click Send.`;
    renderAll();
  } catch (error) {
    if (operationId === audioOperationId) {
      await refreshRuntimeState();
      showAudioError(error);
    }
  } finally {
    cleanupActiveRecorder(operation, false);
  }
}

async function discardRecording(): Promise<void> {
  const operation = recorderOperationRef.current;
  if (operation !== null) {
    cleanupActiveRecorder(operation, true);
  }
  audioOperationId += 1;
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, { type: "RESET" });
}

function stopRecorder(recorder: MediaRecorder, chunks: readonly Blob[]): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const handleStop = () => {
      recorder.removeEventListener("error", handleError);
      resolve(new Blob([...chunks], { type: recorder.mimeType || "audio/webm" }));
    };
    const handleError = () => {
      recorder.removeEventListener("stop", handleStop);
      reject(new Error("Microphone recording failed before transcription."));
    };
    recorder.addEventListener("stop", handleStop, { once: true });
    recorder.addEventListener("error", handleError, { once: true });
    recorder.stop();
  });
}

function handleRecorderError(operation: AudioRecorderOperation, event: Event): void {
  if (!cleanupActiveRecorder(operation, false)) {
    return;
  }
  const message =
    "error" in event && event.error instanceof Error
      ? event.error.message
      : "The browser recorder reported an error.";
  audioRecorderState = reduceAudioRecorderState(audioRecorderState, {
    type: "FAIL",
    detail: message,
  });
  audioNotice = message;
  renderAudio();
}

function updateRecordingTimer(operation: AudioRecorderOperation): void {
  if (
    audioRecorderState.status !== "recording" ||
    !isCurrentRecorderOperation(recorderOperationRef, operation)
  ) {
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

function clearRecordingTimers(operation: AudioRecorderOperation): void {
  if (operation.recordingTimerId !== null) {
    window.clearInterval(operation.recordingTimerId);
    operation.recordingTimerId = null;
  }
  if (operation.recordingLimitId !== null) {
    window.clearTimeout(operation.recordingLimitId);
    operation.recordingLimitId = null;
  }
}

function cleanupActiveRecorder(operation: AudioRecorderOperation, stopRecorder: boolean): boolean {
  return cleanupRecorderOperation(recorderOperationRef, operation, {
    stopRecorder,
    clearInterval: (timerId) => window.clearInterval(timerId),
    clearTimeout: (timerId) => window.clearTimeout(timerId),
    releaseStream: releaseMediaStream,
  });
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
  void discardRecording();
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
