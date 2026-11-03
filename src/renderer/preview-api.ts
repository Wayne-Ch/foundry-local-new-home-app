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
import { createToolInputForTests, preferredLayoutIntentDelta } from "../domain/tool-contract";
import type { DemoState, FloorPlanVisionReadiness, PlanningFixture, RuntimeReadiness } from "../domain/types";
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

const previewRecognition: FloorPlanRecognition = {
  schema: "single-room-topology-v1",
  roomShape: "rectangle",
  roomLabel: "present",
  doorOpening: "present",
  windowOpening: "present",
};

type PreviewStep = "queen" | "conflict" | "recovery" | "failure";

function requestedPreviewStep(): PreviewStep {
  const step = new URLSearchParams(window.location.search).get("step");
  return step === "queen" || step === "conflict" || step === "recovery" ? step : "failure";
}

function requestedPlanningFixture(): PlanningFixture {
  const parameters = new URLSearchParams(window.location.search);
  return parameters.get("room") === "imported" || parameters.get("scenario") === "imported-retained"
    ? createImportedPlanningFixture(previewRecognition)
    : defaultPlanningFixture;
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
    preview: {
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
    },
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
  const recoveryState = state;
  const recoveryLayout = turnC.feasibleOptions.find((option) => option.id === turnC.selectedOptionId) ?? null;
  const failureInput = createToolInputForTests({
    state,
    planningFixture,
    candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    retainFurnitureIds: ["desk-compact", "crib-standard"],
    changedPreference: stageTurns[3]?.prompt ?? "",
  });
  const controlledFailure = compareKnownLayoutOptions(failureInput, state, recoveryLayout, planningFixture);
  const failureState = applyToolResult(state, controlledFailure);
  const evidenceInput =
    previewStep === "queen"
      ? turnAInput
      : previewStep === "conflict"
        ? turnBInput
        : previewStep === "recovery"
          ? turnCInput
          : failureInput;
  const evidenceResult =
    previewStep === "queen"
      ? turnA
      : previewStep === "conflict"
        ? turnB
        : previewStep === "recovery"
          ? turnC
          : controlledFailure;
  const evidencePrompt =
    stageTurns[
      previewStep === "queen" ? 0 : previewStep === "conflict" ? 1 : previewStep === "recovery" ? 2 : 3
    ]?.prompt ?? "";
  const evidencePriorState =
    previewStep === "queen"
      ? initialState
      : previewStep === "conflict"
        ? queenState
        : previewStep === "recovery"
          ? afterBState
          : recoveryState;
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
      text: `Queen + rotated standard desk passes every locked deterministic check. User request: ${stageTurns[0]?.prompt ?? ""}`,
    },
    {
      id: "preview-user-b",
      role: "user" as const,
      text: stageTurns[1]?.prompt ?? "",
    },
    {
      id: "preview-app-b",
      role: "application" as const,
      text: `The King + desk option conflicts with closet access. Which preference may change: bed size, desk footprint or orientation, baby bed requirement? User request: ${stageTurns[1]?.prompt ?? ""}`,
    },
    {
      id: "preview-user-c",
      role: "user" as const,
      text: stageTurns[2]?.prompt ?? "",
    },
    {
      id: "preview-app-c",
      role: "application" as const,
      text: `Queen + baby bed + rotated compact desk passes every locked deterministic check. User request: ${stageTurns[2]?.prompt ?? ""}`,
    },
    {
      id: "preview-user-failure",
      role: "user" as const,
      text: stageTurns[3]?.prompt ?? "",
    },
    {
      id: "preview-app-failure",
      role: "application" as const,
      text: `No feasible known option. The prior accepted layout remains active on the main canvas. Exact rejected-option evidence remains visible, and Inspect rejected option opens its preview without accepting it. User request: ${stageTurns[3]?.prompt ?? ""}`,
    },
  ];
  const messageCount =
    previewStep === "queen"
      ? 3
      : previewStep === "conflict"
        ? 5
        : previewStep === "recovery"
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
          : previewStep === "recovery"
            ? recoveryState
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
          : previewStep === "recovery"
            ? ["turn-a", "turn-b", "turn-c"]
            : stageTurns.map((turn) => turn.id),
    lastInteraction: "turn",
    selectedLayout: previewStep === "queen" || previewStep === "conflict" ? queenLayout : recoveryLayout,
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

function buildResetPreview(
  conversationGeneration: number,
  planningFixture: PlanningFixture,
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
      preview: null,
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
        text: "Conversation reset. Verified dimensions and locked room constraints remain loaded.",
      },
    ],
    trace: [],
  };
}

export function createPreviewApi(): DemoApi {
  let planningFixture: PlanningFixture = requestedPlanningFixture();
  let bootstrap = buildPreview(0, planningFixture);
  return {
    getBootstrap: async () => bootstrap,
    initializeRuntime: async () => readiness,
    prepareOffline: async (): Promise<PrepareOfflineResponse> => ({
      readiness,
      model: readiness.model,
    }),
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
      planningFixture = defaultPlanningFixture;
      bootstrap = {
        ...buildResetPreview(bootstrap.conversationGeneration + 1, planningFixture),
        floorPlanImport: {
          status: "image_ready",
          preview: {
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
          },
          recognition: null,
          recognizedFacts: [],
          error: null,
        },
      };
      return { cancelled: false, bootstrap };
    },
    chooseFloorPlan: async () => ({ cancelled: true, bootstrap }),
    analyzeFloorPlan: async () => {
      planningFixture = createImportedPlanningFixture(previewRecognition);
      bootstrap = {
        ...buildResetPreview(bootstrap.conversationGeneration + 1, planningFixture),
        roomMode: "imported",
        roomPlan: planningFixture.roomPlan,
        state: createInitialDemoState(planningFixture.roomPlan),
        floorPlanImport: {
          status: "imported",
          preview: bootstrap.floorPlanImport.preview,
          recognition: previewRecognition,
          recognizedFacts: [
            "Room shape: rectangle.",
            "Room label: present.",
            "Door opening: present.",
            "Window opening: present.",
            "The VLM recognized visible topology only; the app applied the documented NARA fixture scale and canonical door/window/closet geometry.",
          ],
          error: null,
        },
      };
      return bootstrap;
    },
    useDefaultRoom: async () => {
      planningFixture = defaultPlanningFixture;
      bootstrap = buildResetPreview(bootstrap.conversationGeneration + 1, planningFixture);
      return bootstrap;
    },
    runTurn: async (): Promise<RunTurnResponse> => ({
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
    }),
    applyManualPlacement: async (request) => {
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
      bootstrap = buildResetPreview(bootstrap.conversationGeneration + 1, planningFixture);
      return bootstrap;
    },
    onProgress: () => () => {},
    onAudioPartial: () => () => {},
  };
}
