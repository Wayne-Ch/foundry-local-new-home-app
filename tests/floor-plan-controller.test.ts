import { readFileSync } from "node:fs";
import type { Response } from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import type { AudioReadiness } from "../src/audio/audio-types";
import type { FloorPlanRecognition } from "../src/domain/floor-plan-import";
import type { FloorPlanVisionReadiness, RuntimeReadiness } from "../src/domain/types";
import { type FoundryFloorPlanOutcome, FoundryFloorPlanVisionError } from "../src/foundry/foundry-service";
import { DemoController, type DemoControllerOptions } from "../src/main/demo-controller";
import { FloorPlanImageStore } from "../src/main/floor-plan-image-store";

const sample = readFileSync(
  new URL("../public/assets/floor-plan/sample-master-bedroom.png", import.meta.url),
);

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
  model: null,
  modelCached: false,
  executionProviderRegistered: true,
  localInferenceReady: false,
  externalEndpointUsed: false,
  nonessentialTelemetryDisabled: true,
  cachePath: "<test>",
  appDataPath: "<test>",
  status: "preparation_required",
  detail: "Not loaded.",
};

const audioReadiness: AudioReadiness = {
  sdkVersion: "2.2.1",
  provider: "Foundry Local in-process SDK",
  model: null,
  preferredModelId: "nemotron-speech-streaming-en-0.6b-generic-cpu:3",
  fallbackModelId: "openai-whisper-tiny-generic-cpu:4",
  activeMode: null,
  fallbackAvailable: true,
  fallbackReason: null,
  modelCached: false,
  localAudioReady: false,
  externalEndpointUsed: false,
  maxDurationMs: 20_000,
  inputFormat: "PCM16LE · 16 kHz · mono",
  status: "not_initialized",
  detail: "Not loaded.",
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

const recognition: FloorPlanRecognition = {
  schema: "single-room-topology-v1",
  roomShape: "rectangle",
  roomLabel: "present",
  doorOpening: "present",
  windowOpening: "present",
  movableFurniture: "absent",
};

const response: Response = {
  finishReason: "stop",
  output: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
};

function outcome(): FoundryFloorPlanOutcome {
  return {
    recognition,
    rawOutput: "{}",
    preflight: {
      fits: true,
      promptTokens: 10,
      outputReserveTokens: 10,
      requiredTokens: 20,
      contextLimitTokens: 4096,
      deficitTokens: 0,
    },
    response,
    model: {
      alias: "qwen3.5-0.8b",
      id: "qwen3.5-0.8b-generic-cpu:3",
      deviceType: "CPU",
      executionProvider: "CPUExecutionProvider",
      supportsToolCalling: false,
      fileSizeMb: 900,
    },
    attempts: [{ attempt: 1, rawOutput: "{}", finishReason: "stop", error: null }],
    performance: { totalMs: 100, preflightMs: 5, generationMs: 95, outputBytes: 400 },
  };
}

function unused(): never {
  throw new Error("Not used.");
}

type TestFoundry = NonNullable<DemoControllerOptions["foundry"]>;

function createFoundry(overrides: Partial<TestFoundry> = {}): TestFoundry {
  return {
    readiness,
    audioReadiness,
    visionReadiness,
    initialize: async () => readiness,
    prepareOffline: async () => readiness,
    prepareAudioOffline: async () => unused(),
    transcribeAudio: async () => unused(),
    startAudioStream: async () => unused(),
    appendAudioStreamChunk: () => unused(),
    finishAudioStream: async () => unused(),
    cancelAudioStream: async () => unused(),
    runTurn: async () => unused(),
    prepareFloorPlanVision: async () => visionReadiness,
    analyzeFloorPlan: async () => outcome(),
    cancelFloorPlanAnalysis: async () => {},
    reset: async () => {},
    shutdown: async () => {},
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("floor-plan controller lifecycle", () => {
  it("stages secure bytes, imports recognized geometry, then zero-fills inference ownership", async () => {
    const store = new FloorPlanImageStore();
    const analyzeFloorPlan = vi.fn(async () => outcome());
    const controller = new DemoController({
      foundry: createFoundry({ analyzeFloorPlan }),
      floorPlanImages: store,
    });

    const staged = await controller.loadFloorPlanImage(sample, "sample", "sample");
    const owned = store.borrowBytes();
    expect(staged).toMatchObject({
      roomMode: "default",
      floorPlanImport: {
        status: "image_ready",
        preview: { format: "png", width: 1020, height: 1080 },
      },
    });
    expect(staged.floorPlanImport.preview).not.toHaveProperty("path");

    const imported = await controller.analyzeFloorPlan();

    expect(analyzeFloorPlan).toHaveBeenCalledOnce();
    expect(imported).toMatchObject({
      conversationGeneration: 2,
      roomMode: "imported",
      roomPlan: { id: "imported-nara-master-bedroom", doorSwings: [{}] },
      state: {
        version: 0,
        roomPlanId: "imported-nara-master-bedroom",
        currentLayoutId: null,
      },
      floorPlanImport: {
        status: "imported",
        recognition,
        error: null,
      },
    });
    expect(imported.floorPlanImport.recognizedFacts).toHaveLength(6);
    expect(owned.every((value) => value === 0)).toBe(true);
    expect(() => store.borrowBytes()).toThrow("No floor-plan image is loaded");
  });

  it("restores the default room and clears preview ownership without unloading stable main", async () => {
    const store = new FloorPlanImageStore();
    const controller = new DemoController({
      foundry: createFoundry(),
      floorPlanImages: store,
    });
    await controller.loadFloorPlanImage(sample, "sample", "sample");
    await controller.analyzeFloorPlan();

    const restored = await controller.useDefaultRoom();

    expect(restored).toMatchObject({
      roomMode: "default",
      roomPlan: { id: "ignite-bedroom-a" },
      state: { roomPlanId: "ignite-bedroom-a", version: 0 },
      floorPlanImport: { status: "idle", preview: null, recognition: null },
    });
    expect(store.preview).toBeNull();
  });

  it("rejects a late analysis result after reload/default cleanup", async () => {
    const analysis = deferred<FoundryFloorPlanOutcome>();
    const cancelFloorPlanAnalysis = vi.fn(async () => {});
    const controller = new DemoController({
      foundry: createFoundry({
        analyzeFloorPlan: () => analysis.promise,
        cancelFloorPlanAnalysis,
      }),
    });
    await controller.loadFloorPlanImage(sample, "sample", "sample");

    const pending = controller.analyzeFloorPlan();
    await Promise.resolve();
    const restored = await controller.useDefaultRoom();
    analysis.resolve(outcome());

    await expect(pending).rejects.toThrow("superseded");
    expect(cancelFloorPlanAnalysis).toHaveBeenCalledTimes(2);
    expect(restored.roomMode).toBe("default");
    expect(controller.bootstrap()).toMatchObject({
      roomMode: "default",
      floorPlanImport: { status: "idle", preview: null },
      state: { version: 0, roomPlanId: "ignite-bedroom-a" },
    });
  });

  it("Reset clears staged bytes before native reset settles", async () => {
    const resetGate = deferred<void>();
    const store = new FloorPlanImageStore();
    const controller = new DemoController({
      foundry: createFoundry({ reset: () => resetGate.promise }),
      floorPlanImages: store,
    });
    await controller.loadFloorPlanImage(sample, "sample", "sample");
    const owned = store.borrowBytes();

    const reset = controller.reset();

    expect(owned.every((value) => value === 0)).toBe(true);
    expect(controller.bootstrap()).toMatchObject({
      roomMode: "default",
      floorPlanImport: { status: "idle", preview: null },
      state: { version: 0, roomPlanId: "ignite-bedroom-a" },
    });
    resetGate.resolve();
    await reset;
  });

  it("retains bounded redacted raw VLM output in Developer Trace when parsing fails", async () => {
    const rawOutput = '{"schema":"single-room-topology-v1","roomShape":"uncertain"}';
    const controller = new DemoController({
      foundry: createFoundry({
        analyzeFloorPlan: async () => {
          throw new FoundryFloorPlanVisionError("Strict contract rejected.", [
            {
              attempt: 1,
              rawOutput,
              finishReason: "stop",
              error: { code: "INVALID_OUTPUT", message: "Missing required keys." },
            },
          ]);
        },
      }),
    });
    await controller.loadFloorPlanImage(sample, "sample", "sample");

    await expect(controller.analyzeFloorPlan()).rejects.toThrow("Strict contract rejected");

    expect(controller.bootstrap().trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "floor-plan-vision",
          payload: expect.objectContaining({
            attempts: [
              expect.objectContaining({
                rawOutput,
                error: expect.objectContaining({ code: "INVALID_OUTPUT" }),
              }),
            ],
          }),
        }),
      ]),
    );
  });

  it("single-flights duplicate reload/close cleanup", async () => {
    const cancelFloorPlanAnalysis = vi.fn(async () => {});
    const controller = new DemoController({
      foundry: createFoundry({ cancelFloorPlanAnalysis }),
    });
    await controller.loadFloorPlanImage(sample, "sample", "sample");
    cancelFloorPlanAnalysis.mockClear();

    const first = controller.releaseFloorPlanImage();
    const duplicate = controller.releaseFloorPlanImage();

    expect(duplicate).toBe(first);
    await first;
    expect(cancelFloorPlanAnalysis).toHaveBeenCalledOnce();
    expect(controller.bootstrap()).toMatchObject({
      roomMode: "default",
      floorPlanImport: { status: "idle", preview: null },
    });
  });
});
