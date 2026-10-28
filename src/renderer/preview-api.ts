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

  return {
    roomPlan,
    state,
    readiness,
    stageTurns,
    selectedLayout,
    lastToolResult: turnC,
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
        payload: turnCInput,
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
        payload: turnC,
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
