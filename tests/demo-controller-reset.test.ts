import { describe, expect, it, vi } from "vitest";
import {
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_MAX_DURATION_MS,
  type AudioReadiness,
  NEMOTRON_AUDIO_MODEL_ALIAS,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import type { RuntimeReadiness } from "../src/domain/types";
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

function unused(): never {
  throw new Error("Not used by this reset test.");
}

describe("main reset response", () => {
  it("returns one trace-free v0 bootstrap after prior main-process evidence", async () => {
    const reset = vi.fn(async () => {});
    const foundry: NonNullable<DemoControllerOptions["foundry"]> = {
      readiness,
      audioReadiness,
      initialize: async () => readiness,
      prepareOffline: async () => unused(),
      prepareAudioOffline: async () => unused(),
      transcribeAudio: async () => unused(),
      startAudioStream: async () => unused(),
      appendAudioStreamChunk: () => unused(),
      finishAudioStream: async () => unused(),
      cancelAudioStream: async () => unused(),
      runTurn: async () => unused(),
      reset,
      shutdown: async () => {},
    };
    const controller = new DemoController({ foundry });

    await controller.initializeRuntime();
    expect(controller.bootstrap().trace).toHaveLength(1);

    const response = await controller.reset();

    expect(reset).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      state: {
        version: 0,
        stateRef: "layout-state-v0",
        currentLayoutId: null,
        lastToolResult: null,
      },
      completedStageTurnIds: [],
      lastInteraction: null,
      selectedLayout: null,
      lastToolResult: null,
      trace: [],
    });
    expect(response.messages).toHaveLength(1);
    expect(response.messages[0]?.text).toContain("Conversation reset");
  });
});
