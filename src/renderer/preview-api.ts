import {
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_MAX_DURATION_MS,
  type AudioReadiness,
  NEMOTRON_AUDIO_MODEL_ALIAS,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../audio/audio-types";
import { applyToolResult, createInitialDemoState } from "../domain/demo-state";
import { roomPlan } from "../domain/fixture";
import { compareKnownLayoutOptions } from "../domain/layout-engine";
import { evaluateManualPlacement } from "../domain/manual-placement";
import { createToolInputForTests, preferredLayoutIntentDelta } from "../domain/tool-contract";
import type { DemoState, RuntimeReadiness } from "../domain/types";
import { stageTurns } from "../foundry/prompt";
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

function buildPreview(): BootstrapPayload {
  const recoveryOnly = new URLSearchParams(window.location.search).get("step") === "recovery";
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
  const afterBState = state;

  const turnCInput = createToolInputForTests({
    state,
    candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
    retainFurnitureIds: ["bed-queen"],
    changedPreference: stageTurns[2]?.prompt ?? "",
  });
  const turnC = compareKnownLayoutOptions(turnCInput, state);
  state = applyToolResult(state, turnC);
  const recoveryState = state;
  const selectedLayout = turnC.feasibleOptions.find((option) => option.id === turnC.selectedOptionId) ?? null;
  const failureInput = createToolInputForTests({
    state,
    candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    retainFurnitureIds: ["desk-compact", "crib-standard"],
    changedPreference: stageTurns[3]?.prompt ?? "",
  });
  const controlledFailure = compareKnownLayoutOptions(failureInput, state);
  const failureState = applyToolResult(state, controlledFailure);
  const evidenceInput = recoveryOnly ? turnCInput : failureInput;
  const evidenceResult = recoveryOnly ? turnC : controlledFailure;
  const evidencePrompt = stageTurns[recoveryOnly ? 2 : 3]?.prompt ?? "";

  return {
    roomPlan,
    state: recoveryOnly ? recoveryState : failureState,
    readiness,
    audioReadiness,
    stageTurns,
    completedStageTurnIds: recoveryOnly ? ["turn-a", "turn-b", "turn-c"] : stageTurns.map((turn) => turn.id),
    lastInteraction: "turn",
    selectedLayout,
    lastToolResult: evidenceResult,
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
        id: "preview-user-b",
        role: "user",
        text: stageTurns[1]?.prompt ?? "",
      },
      {
        id: "preview-app-b",
        role: "application",
        text: "Application evidence: the King + desk option conflicts with closet access. Which preference may change: bed size, desk footprint or orientation, baby bed requirement?",
      },
      {
        id: "preview-user-c",
        role: "user",
        text: stageTurns[2]?.prompt ?? "",
      },
      {
        id: "preview-app-c",
        role: "application",
        text: "Application evidence: Queen + baby bed + rotated compact desk passes every locked deterministic check.",
      },
      ...(recoveryOnly
        ? []
        : [
            {
              id: "preview-user-failure",
              role: "user" as const,
              text: stageTurns[3]?.prompt ?? "",
            },
            {
              id: "preview-app-failure",
              role: "application" as const,
              text: "Application evidence: no feasible known option. The preview shows one rejected option with only its own checks and conflicts; aggregate reasons across both alternatives remain labeled in Developer trace.",
            },
          ]),
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
        title: "Schema-guided model intent delta",
        payload: preferredLayoutIntentDelta(recoveryOnly ? afterBState : recoveryState, evidencePrompt),
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
    runTurn: async (): Promise<RunTurnResponse> => ({
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
      const outcome = evaluateManualPlacement(state, bootstrap.selectedLayout, request);
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
        outcome,
        completedStageTurnIds: bootstrap.completedStageTurnIds,
        lastInteraction: bootstrap.lastInteraction,
        messages: bootstrap.messages,
        trace: bootstrap.trace,
      };
    },
    resetConversation: async () => {
      bootstrap = buildPreview();
      return bootstrap;
    },
    onProgress: () => () => {},
    onAudioPartial: () => () => {},
  };
}
