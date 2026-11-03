import { describe, expect, it, vi } from "vitest";
import {
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_MAX_DURATION_MS,
  type AudioReadiness,
  NEMOTRON_AUDIO_MODEL_ALIAS,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import type { FloorPlanVisionReadiness, RuntimeReadiness } from "../src/domain/types";
import { DemoController, type DemoControllerOptions } from "../src/main/demo-controller";

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
  cachePath: "<test-cache>",
  appDataPath: "<test-app-data>",
  status: "ready",
  detail: "Ready.",
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
  detail: "Ready.",
  lastTranscriptionMs: null,
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
  detail: "Not prepared.",
};

function unused(): never {
  throw new Error("Not used by this reset test.");
}

type TestFoundry = NonNullable<DemoControllerOptions["foundry"]>;

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createFoundry(overrides: Partial<TestFoundry> = {}): TestFoundry {
  return {
    readiness,
    audioReadiness,
    visionReadiness,
    initialize: async () => readiness,
    prepareOffline: async () => unused(),
    prepareAudioOffline: async () => unused(),
    transcribeAudio: async () => unused(),
    startAudioStream: async () => unused(),
    appendAudioStreamChunk: () => unused(),
    finishAudioStream: async () => unused(),
    cancelAudioStream: async () => unused(),
    prepareFloorPlanVision: async () => unused(),
    analyzeFloorPlan: async () => unused(),
    cancelFloorPlanAnalysis: async () => {},
    runTurn: async () => unused(),
    reset: async () => {},
    shutdown: async () => {},
    ...overrides,
  };
}

describe("main reset response", () => {
  it("publishes one trace-free no-room generation before native reset settles", async () => {
    const resetGate = deferred<void>();
    const reset = vi.fn(() => resetGate.promise);
    const foundry = createFoundry({ reset });
    const controller = new DemoController({ foundry });

    await controller.initializeRuntime();
    expect(controller.bootstrap().trace).toHaveLength(1);

    const resetPromise = controller.reset();
    expect(controller.bootstrap()).toMatchObject({
      conversationGeneration: 1,
      roomMode: "none",
      roomPlan: null,
      state: null,
      stageTurns: [],
      completedStageTurnIds: [],
      lastInteraction: null,
      selectedLayout: null,
      lastToolResult: null,
      trace: [],
    });
    expect(controller.bootstrap().messages[0]?.text).toContain("Load or choose a floor plan");

    resetGate.resolve();
    const response = await resetPromise;

    expect(reset).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      conversationGeneration: 1,
      roomMode: "none",
      roomPlan: null,
      state: null,
      stageTurns: [],
      completedStageTurnIds: [],
      lastInteraction: null,
      selectedLayout: null,
      lastToolResult: null,
      trace: [],
    });
    expect(response.messages).toHaveLength(1);
    expect(response.messages[0]?.text).toContain("Load or choose a floor plan");
  });

  it("keeps the same no-room generation through a timeout and late readiness recovery", async () => {
    let currentReadiness = readiness;
    const resetGate = deferred<void>();
    const foundry = createFoundry({
      reset: () => resetGate.promise,
    });
    Object.defineProperty(foundry, "readiness", {
      get: () => currentReadiness,
    });
    const controller = new DemoController({ foundry });

    const reset = controller.reset();
    currentReadiness = {
      ...readiness,
      localInferenceReady: false,
      status: "recovering",
      detail: "Native reset timed out; runtime recovery is in progress.",
    };
    resetGate.reject(new Error("Native reset could not safely stop active native operations."));

    await expect(reset).rejects.toThrow("could not safely stop");
    expect(controller.bootstrap()).toMatchObject({
      conversationGeneration: 1,
      roomMode: "none",
      roomPlan: null,
      state: null,
      readiness: { status: "recovering", localInferenceReady: false },
      selectedLayout: null,
      lastToolResult: null,
      trace: [],
    });

    currentReadiness = readiness;
    expect(controller.bootstrap()).toMatchObject({
      conversationGeneration: 1,
      roomMode: "none",
      roomPlan: null,
      state: null,
      readiness: { status: "ready", localInferenceReady: true },
      selectedLayout: null,
      lastToolResult: null,
      trace: [],
    });
  });

  it("single-flights repeated reset and advances only for a later reset attempt", async () => {
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const reset = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstGate.promise)
      .mockImplementationOnce(() => secondGate.promise);
    const controller = new DemoController({ foundry: createFoundry({ reset }) });

    const first = controller.reset();
    const repeated = controller.reset();
    expect(repeated).toBe(first);
    expect(controller.bootstrap().conversationGeneration).toBe(1);

    firstGate.resolve();
    await first;

    const second = controller.reset();
    expect(controller.bootstrap()).toMatchObject({
      conversationGeneration: 2,
      roomMode: "none",
      roomPlan: null,
      state: null,
      trace: [],
    });
    secondGate.resolve();
    await expect(second).resolves.toMatchObject({ conversationGeneration: 2 });
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale async result without restoring pre-reset trace", async () => {
    const initializeGate = deferred<RuntimeReadiness>();
    const controller = new DemoController({
      foundry: createFoundry({
        initialize: () => initializeGate.promise,
      }),
    });

    const initialize = controller.initializeRuntime();
    await controller.reset();
    initializeGate.resolve(readiness);

    await expect(initialize).rejects.toThrow("superseded by conversation reset");
    expect(controller.bootstrap()).toMatchObject({
      conversationGeneration: 1,
      roomMode: "none",
      roomPlan: null,
      state: null,
      trace: [],
    });
  });
});
