import {
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MODEL_ALIAS,
  AUDIO_MODEL_ID,
  type AudioReadiness,
} from "../audio/audio-types";
import { applyToolResult, createInitialDemoState } from "../domain/demo-state";
import { roomPlan } from "../domain/fixture";
import { compareKnownLayoutOptions } from "../domain/layout-engine";
import { createToolInputForTests } from "../domain/tool-contract";
import type { DemoState, RuntimeReadiness } from "../domain/types";
import { stageTurns } from "../foundry/prompt";
import type { BootstrapPayload, DemoApi, PrepareOfflineResponse, RunTurnResponse } from "../shared/contracts";

const readiness: RuntimeReadiness = {
  sdkVersion: "2.2.1",
  provider: "Foundry Local in-process SDK",
  planningMode: "Runtime-guided JSON schema -> app tool invocation",
  responseMode: "Application-rendered typed evidence",
  target: {
    modelId: "qwen2.5-1.5b-instruct-generic-gpu:4",
    executionProvider: "WebGPUExecutionProvider",
    source: "built_in_default",
    stageValidated: true,
  },
  model: {
    alias: "qwen2.5-1.5b",
    id: "qwen2.5-1.5b-instruct-generic-gpu:4",
    deviceType: "GPU",
    executionProvider: "WebGPUExecutionProvider",
    supportsToolCalling: true,
    fileSizeMb: 1546,
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
    alias: AUDIO_MODEL_ALIAS,
    id: AUDIO_MODEL_ID,
    deviceType: "CPU",
    executionProvider: AUDIO_EXECUTION_PROVIDER,
    fileSizeMb: 131,
    language: "en",
    inputMode: "temporary PCM WAV file URI",
  },
  modelCached: true,
  localAudioReady: true,
  externalEndpointUsed: false,
  maxDurationMs: AUDIO_MAX_DURATION_MS,
  inputFormat: "PCM16LE · 16 kHz · mono",
  status: "ready",
  detail: "Visual preview of the validated local speech model.",
  lastTranscriptionMs: 169,
};

function buildPreview(): BootstrapPayload {
  let state: DemoState = createInitialDemoState();
  const turnAInput = createToolInputForTests({
    state,
    candidateFurnitureIds: ["bed-queen", "desk-standard"],
    changedPreference: stageTurns[0]?.prompt ?? "",
  });
  const turnA = compareKnownLayoutOptions(turnAInput, state);
  state = applyToolResult(state, turnA);

  const turnBInput = createToolInputForTests({
    state,
    candidateFurnitureIds: ["bed-king", "desk-standard"],
    retainFurnitureIds: ["desk-standard"],
    changedPreference: stageTurns[1]?.prompt ?? "",
  });
  const turnB = compareKnownLayoutOptions(turnBInput, state);
  state = applyToolResult(state, turnB);

  const turnCInput = createToolInputForTests({
    state,
    candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
    retainFurnitureIds: ["bed-queen"],
    changedPreference: stageTurns[2]?.prompt ?? "",
  });
  const turnC = compareKnownLayoutOptions(turnCInput, state);
  state = applyToolResult(state, turnC);
  const selectedLayout = turnC.feasibleOptions.find((option) => option.id === turnC.selectedOptionId) ?? null;
  const failureInput = createToolInputForTests({
    state,
    candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    retainFurnitureIds: ["desk-compact", "crib-standard"],
    changedPreference: stageTurns[3]?.prompt ?? "",
  });
  const controlledFailure = compareKnownLayoutOptions(failureInput, state);
  state = applyToolResult(state, controlledFailure);

  return {
    roomPlan,
    state,
    readiness,
    audioReadiness,
    stageTurns,
    selectedLayout,
    lastToolResult: controlledFailure,
    messages: [
      {
        id: "preview-system",
        role: "system",
        text: "Verified room plan loaded. Geometry remains application-owned.",
      },
      {
        id: "preview-user-a",
        role: "user",
        text: stageTurns[0]?.prompt ?? "",
      },
      {
        id: "preview-app-a",
        role: "application",
        text: "Application evidence: Queen + rotated standard desk passes every locked deterministic check.",
      },
      {
        id: "preview-user-c",
        role: "user",
        text: stageTurns[2]?.prompt ?? "",
      },
      {
        id: "preview-app-c",
        role: "application",
        text: "Application evidence: Queen + crib + rotated compact desk passes every locked deterministic check.",
      },
      {
        id: "preview-user-failure",
        role: "user",
        text: stageTurns[3]?.prompt ?? "",
      },
      {
        id: "preview-app-failure",
        role: "application",
        text: "Application evidence: no feasible known option. The preview shows one rejected option with only its own checks and conflicts; aggregate reasons across both alternatives remain labeled in Developer trace.",
      },
    ],
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
        title: "Schema-guided model plan",
        payload: failureInput,
      },
      {
        id: "preview-validation",
        timestamp: new Date().toISOString(),
        kind: "validation",
        title: "Application validation accepted",
        payload: { accepted: true, attempts: 2 },
      },
      {
        id: "preview-geometry",
        timestamp: new Date().toISOString(),
        kind: "geometry",
        title: "Deterministic geometry result",
        payload: controlledFailure,
      },
    ],
  };
}

export function createPreviewApi(): DemoApi {
  let bootstrap = buildPreview();
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
    runTurn: async (): Promise<RunTurnResponse> => ({
      state: bootstrap.state,
      toolResult: bootstrap.lastToolResult,
      selectedLayout: bootstrap.selectedLayout,
      assistantText: bootstrap.messages.at(-1)?.text ?? "",
      messages: bootstrap.messages,
      trace: bootstrap.trace,
      readiness,
    }),
    resetConversation: async () => {
      bootstrap = buildPreview();
      return bootstrap;
    },
    onProgress: () => () => {},
  };
}
