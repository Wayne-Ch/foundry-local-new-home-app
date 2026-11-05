import {
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_MAX_DURATION_MS,
  type AudioReadiness,
  NEMOTRON_AUDIO_MODEL_ALIAS,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../audio/audio-types";
import { applyToolResult, createInitialDemoState } from "../domain/demo-state";
import { defaultPlanningFixture } from "../domain/fixture";
import {
  createImportedPlanningFixture,
  FLOOR_PLAN_SAMPLE_ASSET_PATH,
  type FloorPlanRecognition,
} from "../domain/floor-plan-import";
import { compareKnownLayoutOptions } from "../domain/layout-engine";
import { evaluateManualPlacement } from "../domain/manual-placement";
import { ROOM_INTAKE_MESSAGE } from "../domain/room-session";
import { createToolInputForTests, preferredLayoutIntentDelta } from "../domain/tool-contract";
import type { DemoState, FloorPlanVisionReadiness, PlanningFixture, RuntimeReadiness } from "../domain/types";
import { deriveCoreModelReadiness, OFFLINE_CORE_READY_TEXT } from "../foundry/core-model-readiness";
import { stageTurnsForMode } from "../foundry/prompt";
import type { BootstrapPayload, DemoApi, PrepareOfflineResponse, RunTurnResponse } from "../shared/contracts";

const readiness: RuntimeReadiness = {
  sdkVersion: "2.2.1",
  provider: "Foundry Local in-process SDK",
  planningMode: "Runtime-guided intent-delta JSON schema -> app-derived tool invocation",
  responseMode: "Application-rendered typed evidence",
  target: {
    modelId: "qwen3-0.6b-generic-gpu:2",
    executionProvider: "WebGPUExecutionProvider",
    source: "built_in_default",
    stageValidated: true,
  },
  model: {
    alias: "qwen3-0.6b",
    id: "qwen3-0.6b-generic-gpu:2",
    deviceType: "GPU",
    executionProvider: "WebGPUExecutionProvider",
    supportsToolCalling: true,
    fileSizeMb: 529,
  },
  modelCached: true,
  executionProviderRegistered: true,
  localInferenceReady: true,
  externalEndpointUsed: false,
  nonessentialTelemetryDisabled: true,
  cachePath: "<local model cache>",
  appDataPath: "<local app data>",
  status: "ready",
  detail: "Visual preview of the validated Windows configuration.",
};

const audioReadiness: AudioReadiness = {
  sdkVersion: "2.2.1",
  provider: "Foundry Local in-process SDK",
  model: {
    alias: NEMOTRON_AUDIO_MODEL_ALIAS,
    id: NEMOTRON_AUDIO_MODEL_ID,
    deviceType: "CPU",
    executionProvider: AUDIO_EXECUTION_PROVIDER,
    fileSizeMb: 696,
    language: "en",
    inputMode: "streaming PCM ItemQueue",
  },
  preferredModelId: NEMOTRON_AUDIO_MODEL_ID,
  fallbackModelId: WHISPER_AUDIO_MODEL_ID,
  activeMode: "nemotron_streaming",
  fallbackAvailable: true,
  fallbackReason: null,
  modelCached: true,
  localAudioReady: true,
  externalEndpointUsed: false,
  maxDurationMs: AUDIO_MAX_DURATION_MS,
  inputFormat: "PCM16LE · 16 kHz · mono",
  status: "ready",
  detail: "Visual preview of the validated Nemotron live caption model.",
  lastTranscriptionMs: 6183,
};

const visionReadiness: FloorPlanVisionReadiness = {
  sdkVersion: "2.2.1",
  provider: "Foundry Local in-process SDK",
  target: {
    modelId: "qwen3.5-0.8b-generic-cpu:3",
    executionProvider: "CPUExecutionProvider",
    task: "vision-language-chat",
    stageValidated: true,
  },
  model: null,
  modelCached: false,
  localInferenceReady: false,
  externalEndpointUsed: false,
  status: "not_initialized",
  detail: "Visual preview only; no vision inference is running.",
};

const readyVisionReadiness: FloorPlanVisionReadiness = {
  ...visionReadiness,
  model: {
    alias: "qwen3.5-0.8b",
    id: "qwen3.5-0.8b-generic-cpu:3",
    deviceType: "CPU",
    executionProvider: "CPUExecutionProvider",
    supportsToolCalling: false,
    fileSizeMb: 900,
  },
  modelCached: true,
  localInferenceReady: true,
  status: "ready",
  detail: "Visual preview of the prepared exact floor-plan vision model.",
};

const previewRecognition: FloorPlanRecognition = {
  schema: "single-room-topology-v1",
  roomShape: "rectangle",
  roomLabel: "present",
  doorOpening: "present",
  windowOpening: "present",
};

type PreviewStep = "queen" | "conflict" | "request" | "failure";

const sampleFloorPlanPreview: NonNullable<BootstrapPayload["floorPlanImport"]["preview"]> = {
  source: "sample",
  displayName: "Packaged NARA master-bedroom crop",
  dataUrl: `./${FLOOR_PLAN_SAMPLE_ASSET_PATH}`,
  format: "png",
  mimeType: "image/png",
  width: 1020,
  height: 1080,
  byteLength: 194_686,
  pixelCount: 1020 * 1080,
  sourceFormat: "png",
  sourceByteLength: 194_686,
  inferenceFormat: "png",
  inferenceWidth: 1020,
  inferenceHeight: 1080,
  inferenceByteLength: 194_686,
};

function requestedPreviewStep(): PreviewStep {
  const step = new URLSearchParams(window.location.search).get("step");
  return step === "queen" || step === "conflict" || step === "request" ? step : "failure";
}

function requestedPlanningFixture(): PlanningFixture | null {
  const parameters = new URLSearchParams(window.location.search);
  const storyRequested =
    parameters.has("step") || parameters.has("room") || parameters.get("scenario") === "imported-retained";
  if (!storyRequested) {
    return null;
  }
  return parameters.get("room") === "imported" || parameters.get("scenario") === "imported-retained"
    ? createImportedPlanningFixture(previewRecognition)
    : defaultPlanningFixture;
}

function isFlowProbeScenario(): boolean {
  return new URLSearchParams(window.location.search).get("scenario") === "flow-probe";
}

function buildInactivePreview(
  conversationGeneration: number,
  floorPlanImport: BootstrapPayload["floorPlanImport"] = {
    status: "idle",
    preview: null,
    recognition: null,
    recognizedFacts: [],
    error: null,
  },
): BootstrapPayload {
  return {
    conversationGeneration,
    roomMode: "none",
    roomPlan: null,
    state: null,
    readiness,
    audioReadiness,
    visionReadiness,
    floorPlanImport,
    stageTurns: [],
    completedStageTurnIds: [],
    lastInteraction: null,
    selectedLayout: null,
    lastToolResult: null,
    messages: [
      {
        id: `preview-intake-${conversationGeneration}`,
        role: "system",
        text: ROOM_INTAKE_MESSAGE,
      },
    ],
    trace: [],
  };
}

function previewFloorPlanImport(planningFixture: PlanningFixture): BootstrapPayload["floorPlanImport"] {
  if (planningFixture.mode === "default") {
    return {
      status: "idle",
      preview: null,
      recognition: null,
      recognizedFacts: [],
      error: null,
    };
  }
  return {
    status: "imported",
    preview: sampleFloorPlanPreview,
    recognition: previewRecognition,
    recognizedFacts: [
      "Room shape: rectangle.",
      "Room label: present.",
      "Door opening: present.",
      "Window opening: present.",
      "The VLM recognized visible topology only; the app applied the documented NARA fixture scale and canonical door/window/closet geometry.",
    ],
    error: null,
  };
}

function buildPreview(conversationGeneration: number, planningFixture: PlanningFixture): BootstrapPayload {
  const previewStep = requestedPreviewStep();
  const stageTurns = stageTurnsForMode(planningFixture.mode);
  const initialState = createInitialDemoState(planningFixture.roomPlan);
  let state: DemoState = initialState;
  const turnAInput = createToolInputForTests({
    state,
    planningFixture,
    candidateFurnitureIds: ["bed-queen", "desk-standard"],
    changedPreference: stageTurns[0]?.prompt ?? "",
  });
  const turnA = compareKnownLayoutOptions(turnAInput, state, null, planningFixture);
  state = applyToolResult(state, turnA);
  const queenState = state;
  const queenLayout = turnA.feasibleOptions.find((option) => option.id === turnA.selectedOptionId) ?? null;

  const turnBInput = createToolInputForTests({
    state,
    planningFixture,
    candidateFurnitureIds: ["bed-king", "desk-standard"],
    retainFurnitureIds: ["desk-standard"],
    changedPreference: stageTurns[1]?.prompt ?? "",
  });
  const turnB = compareKnownLayoutOptions(turnBInput, state, queenLayout, planningFixture);
  state = applyToolResult(state, turnB);
  const afterBState = state;

  const turnCInput = createToolInputForTests({
    state,
    planningFixture,
    candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
    retainFurnitureIds: ["bed-queen"],
    changedPreference: stageTurns[2]?.prompt ?? "",
  });
  const turnC = compareKnownLayoutOptions(turnCInput, state, queenLayout, planningFixture);
  state = applyToolResult(state, turnC);
  const turnCState = state;
  const turnCLayout = turnC.feasibleOptions.find((option) => option.id === turnC.selectedOptionId) ?? null;
  const failureInput = createToolInputForTests({
    state,
    planningFixture,
    candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    retainFurnitureIds: ["desk-compact", "crib-standard"],
    changedPreference: stageTurns[3]?.prompt ?? "",
  });
  const controlledFailure = compareKnownLayoutOptions(failureInput, state, turnCLayout, planningFixture);
  const failureState = applyToolResult(state, controlledFailure);
  const evidenceInput =
    previewStep === "queen"
      ? turnAInput
      : previewStep === "conflict"
        ? turnBInput
        : previewStep === "request"
          ? turnCInput
          : failureInput;
  const evidenceResult =
    previewStep === "queen"
      ? turnA
      : previewStep === "conflict"
        ? turnB
        : previewStep === "request"
          ? turnC
          : controlledFailure;
  const evidencePrompt =
    stageTurns[
      previewStep === "queen" ? 0 : previewStep === "conflict" ? 1 : previewStep === "request" ? 2 : 3
    ]?.prompt ?? "";
  const evidencePriorState =
    previewStep === "queen"
      ? initialState
      : previewStep === "conflict"
        ? queenState
        : previewStep === "request"
          ? afterBState
          : turnCState;
  const messages = [
    {
      id: "preview-system",
      role: "system" as const,
      text: "Verified room plan loaded. Geometry remains application-owned.",
    },
    {
      id: "preview-user-a",
      role: "user" as const,
      text: stageTurns[0]?.prompt ?? "",
    },
    {
      id: "preview-app-a",
      role: "application" as const,
      text: "Queen + rotated standard desk passes every locked deterministic check.",
    },
    {
      id: "preview-user-b",
      role: "user" as const,
      text: stageTurns[1]?.prompt ?? "",
    },
    {
      id: "preview-app-b",
      role: "application" as const,
      text: "The King + desk option conflicts with closet access. Which preference may change: bed size, desk footprint or orientation?",
    },
    {
      id: "preview-user-c",
      role: "user" as const,
      text: stageTurns[2]?.prompt ?? "",
    },
    {
      id: "preview-app-c",
      role: "application" as const,
      text: "Queen + baby bed + rotated compact desk passes every locked deterministic check.",
    },
    {
      id: "preview-user-failure",
      role: "user" as const,
      text: stageTurns[3]?.prompt ?? "",
    },
    {
      id: "preview-app-failure",
      role: "application" as const,
      text: "No feasible known option. The prior accepted layout remains active on the main canvas. Exact rejected-option evidence remains visible, and Inspect rejected option opens its preview without accepting it.",
    },
  ];
  const messageCount =
    previewStep === "queen"
      ? 3
      : previewStep === "conflict"
        ? 5
        : previewStep === "request"
          ? 7
          : messages.length;

  return {
    conversationGeneration,
    roomMode: planningFixture.mode,
    roomPlan: planningFixture.roomPlan,
    state:
      previewStep === "queen"
        ? queenState
        : previewStep === "conflict"
          ? afterBState
          : previewStep === "request"
            ? turnCState
            : failureState,
    readiness,
    audioReadiness,
    visionReadiness,
    floorPlanImport: previewFloorPlanImport(planningFixture),
    stageTurns,
    completedStageTurnIds:
      previewStep === "queen"
        ? ["turn-a"]
        : previewStep === "conflict"
          ? ["turn-a", "turn-b"]
          : previewStep === "request"
            ? ["turn-a", "turn-b", "turn-c"]
            : stageTurns.map((turn) => turn.id),
    lastInteraction: "turn",
    selectedLayout: previewStep === "queen" || previewStep === "conflict" ? queenLayout : turnCLayout,
    lastToolResult: evidenceResult,
    messages: messages.slice(0, messageCount),
    trace: [
      {
        id: "preview-runtime",
        timestamp: new Date().toISOString(),
        kind: "runtime",
        title: "Validated runtime identity",
        payload: readiness,
      },
      {
        id: "preview-tool",
        timestamp: new Date().toISOString(),
        kind: "model-tool-call",
        title: "Schema-guided model intent delta",
        payload: preferredLayoutIntentDelta(evidencePriorState, evidencePrompt),
      },
      {
        id: "preview-validation",
        timestamp: new Date().toISOString(),
        kind: "validation",
        title: "Application-derived tool input accepted",
        payload: { accepted: true, attempts: 1, input: evidenceInput },
      },
      {
        id: "preview-geometry",
        timestamp: new Date().toISOString(),
        kind: "geometry",
        title: "Deterministic geometry result",
        payload: evidenceResult,
      },
    ],
  };
}

function buildActiveRoomResetPreview(
  conversationGeneration: number,
  planningFixture: PlanningFixture,
  preview: BootstrapPayload["floorPlanImport"]["preview"] = null,
): BootstrapPayload {
  const imported = planningFixture.mode === "imported";
  return {
    conversationGeneration,
    roomMode: planningFixture.mode,
    roomPlan: planningFixture.roomPlan,
    state: createInitialDemoState(planningFixture.roomPlan),
    readiness,
    audioReadiness,
    visionReadiness,
    floorPlanImport: {
      status: imported ? "imported" : "idle",
      preview,
      recognition: imported ? previewRecognition : null,
      recognizedFacts: imported
        ? [
            "Room shape: rectangle.",
            "Room label: present.",
            "Door opening: present.",
            "Window opening: present.",
            "The VLM recognized visible topology only; the app applied the documented NARA fixture scale and canonical door/window/closet geometry.",
          ]
        : [],
      error: null,
    },
    stageTurns: stageTurnsForMode(planningFixture.mode),
    completedStageTurnIds: [],
    lastInteraction: null,
    selectedLayout: null,
    lastToolResult: null,
    messages: [
      {
        id: "preview-reset-system",
        role: "system",
        text:
          planningFixture.mode === "imported"
            ? "Imported room geometry is active."
            : "Verified default room is active.",
      },
    ],
    trace: [],
  };
}

export function createPreviewApi(): DemoApi {
  let planningFixture = requestedPlanningFixture();
  let currentVisionReadiness = planningFixture?.mode === "imported" ? readyVisionReadiness : visionReadiness;
  const withCurrentCoreReadiness = (next: BootstrapPayload): BootstrapPayload => ({
    ...next,
    visionReadiness: currentVisionReadiness,
  });
  let bootstrap = withCurrentCoreReadiness(
    planningFixture === null ? buildInactivePreview(0) : buildPreview(0, planningFixture),
  );
  let analysisAttempts = 0;
  const flowProbe = isFlowProbeScenario();
  return {
    getBootstrap: async () => bootstrap,
    initializeRuntime: async () => readiness,
    prepareOffline: async (): Promise<PrepareOfflineResponse> => {
      currentVisionReadiness = readyVisionReadiness;
      bootstrap = withCurrentCoreReadiness(bootstrap);
      return {
        readiness,
        visionReadiness: currentVisionReadiness,
        model: readiness.model,
      };
    },
    prepareAudio: async () => ({ readiness: audioReadiness }),
    authorizeMicrophone: async () => {
      throw new Error("Microphone capture is unavailable in the visual-only browser preview.");
    },
    transcribeAudio: async () => {
      throw new Error("Microphone transcription is unavailable in the visual-only browser preview.");
    },
    startAudioStream: async () => {
      throw new Error("Live microphone streaming is unavailable in the visual-only browser preview.");
    },
    appendAudioChunk: async () => {
      throw new Error("Live microphone streaming is unavailable in the visual-only browser preview.");
    },
    finishAudioStream: async () => {
      throw new Error("Live microphone streaming is unavailable in the visual-only browser preview.");
    },
    cancelAudioStream: async () => {},
    loadSampleFloorPlan: async () => {
      planningFixture = null;
      bootstrap = withCurrentCoreReadiness(
        buildInactivePreview(bootstrap.conversationGeneration + 1, {
          status: "image_ready",
          preview: sampleFloorPlanPreview,
          recognition: null,
          recognizedFacts: [],
          error: null,
        }),
      );
      return { cancelled: false, bootstrap };
    },
    chooseFloorPlan: async () => ({ cancelled: true, bootstrap }),
    analyzeFloorPlan: async () => {
      const preview = bootstrap.floorPlanImport.preview;
      if (preview === null) {
        throw new Error("Load the packaged sample before analysis.");
      }
      if (!deriveCoreModelReadiness(readiness, currentVisionReadiness).allReady) {
        throw new Error(`Use the setup control and wait for ${OFFLINE_CORE_READY_TEXT}.`);
      }
      analysisAttempts += 1;
      if (flowProbe && analysisAttempts > 1) {
        const detail = "Probe-forced vision analysis failure.";
        planningFixture = null;
        bootstrap = withCurrentCoreReadiness(
          buildInactivePreview(bootstrap.conversationGeneration, {
            status: "error",
            preview,
            recognition: null,
            recognizedFacts: [],
            error: detail,
          }),
        );
        throw new Error(detail);
      }
      planningFixture = createImportedPlanningFixture(previewRecognition);
      bootstrap = withCurrentCoreReadiness(
        buildActiveRoomResetPreview(bootstrap.conversationGeneration + 1, planningFixture, preview),
      );
      return bootstrap;
    },
    useDefaultRoom: async () => {
      planningFixture = defaultPlanningFixture;
      bootstrap = withCurrentCoreReadiness(
        buildActiveRoomResetPreview(bootstrap.conversationGeneration + 1, planningFixture),
      );
      return bootstrap;
    },
    runTurn: async (): Promise<RunTurnResponse> => {
      if (bootstrap.roomMode === "none") {
        throw new Error("A room must be active before a preview turn can run.");
      }
      return {
        conversationGeneration: bootstrap.conversationGeneration,
        state: bootstrap.state,
        toolResult: bootstrap.lastToolResult,
        selectedLayout: bootstrap.selectedLayout,
        completedStageTurnIds: bootstrap.completedStageTurnIds,
        lastInteraction: "turn",
        assistantText: bootstrap.messages.at(-1)?.text ?? "",
        messages: bootstrap.messages,
        trace: bootstrap.trace,
        readiness,
      };
    },
    applyManualPlacement: async (request) => {
      if (planningFixture === null || bootstrap.roomMode === "none") {
        throw new Error("A room must be active before manual placement can run.");
      }
      const state: DemoState = {
        ...bootstrap.state,
        lastToolResult: bootstrap.lastToolResult,
      };
      const outcome = evaluateManualPlacement(
        state,
        bootstrap.selectedLayout,
        request,
        planningFixture.roomPlan,
      );
      if (outcome.accepted) {
        bootstrap = {
          ...bootstrap,
          state: outcome.state,
          selectedLayout: outcome.selectedLayout,
          lastInteraction: "manual",
          messages: [
            ...bootstrap.messages,
            {
              id: `preview-manual-${outcome.state.version}`,
              role: "application",
              text: `App-owned manual placement accepted: ${outcome.reason}`,
            },
          ],
          trace: [
            ...bootstrap.trace,
            {
              id: `preview-manual-trace-${outcome.state.version}`,
              timestamp: new Date().toISOString(),
              kind: "manual-placement",
              title: "Application-owned manual placement",
              payload: outcome,
            },
          ],
        };
      }
      return {
        conversationGeneration: bootstrap.conversationGeneration,
        outcome,
        completedStageTurnIds: bootstrap.completedStageTurnIds,
        lastInteraction: bootstrap.lastInteraction,
        messages: bootstrap.messages,
        trace: bootstrap.trace,
      };
    },
    resetConversation: async () => {
      planningFixture = null;
      currentVisionReadiness = visionReadiness;
      bootstrap = withCurrentCoreReadiness(buildInactivePreview(bootstrap.conversationGeneration + 1));
      return bootstrap;
    },
    onProgress: () => () => {},
    onAudioPartial: () => () => {},
  };
}
