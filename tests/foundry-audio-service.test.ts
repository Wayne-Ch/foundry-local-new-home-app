import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DeviceType,
  type EpDownloadResult,
  type FoundryLocalConfig,
  type IModel,
  type ModelInfo,
  type Request,
  type RequestPreflightResult,
  type Response,
} from "foundry-local-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIO_MODEL_ALIAS, AUDIO_MODEL_ID, type ValidatedAudioCapture } from "../src/audio/audio-types";
import { TempAudioStore } from "../src/audio/temp-audio-store";
import { FoundryLayoutService } from "../src/foundry/foundry-service";
import { VALIDATED_EXECUTION_PROVIDER, VALIDATED_MODEL_ID } from "../src/foundry/runtime-config";

const tempRoots: string[] = [];

class FakeModel implements IModel {
  loaded = false;
  loadCalls = 0;
  unloadCalls = 0;
  loadGate: Promise<void> | null = null;

  constructor(
    readonly id: string,
    readonly alias: string,
    readonly task: string,
    readonly provider: string,
    readonly supportsTools: boolean,
    readonly sizeMb: number,
  ) {}

  get info(): ModelInfo {
    return {
      id: this.id,
      name: this.id.split(":")[0] ?? this.id,
      version: 1,
      alias: this.alias,
      uri: `fake://${this.id}`,
      deviceType: this.provider === "CPUExecutionProvider" ? DeviceType.CPU : DeviceType.GPU,
      executionProvider: this.provider,
      providerType: "fake",
      cached: true,
      task: this.task,
      runtime: {
        deviceType: this.provider === "CPUExecutionProvider" ? DeviceType.CPU : DeviceType.GPU,
        executionProvider: this.provider,
      },
      supportsToolCalling: this.supportsTools,
      fileSizeMb: this.sizeMb,
      createdAtUnix: 0,
      isTestModel: true,
      getStringProperty: () => undefined,
      getIntProperty: (_key, defaultValue = 0) => defaultValue,
    };
  }

  getStringProperty(): string | undefined {
    return undefined;
  }

  getIntProperty(_key: string, defaultValue = 0): number {
    return defaultValue;
  }

  get isCached(): boolean {
    return true;
  }

  async isLoaded(): Promise<boolean> {
    return this.loaded;
  }

  get path(): string {
    return `C:\\fake\\${this.id}`;
  }

  get variants(): IModel[] {
    return [];
  }

  get contextLength(): number | null {
    return 4096;
  }

  get inputModalities(): string | null {
    return this.task === "automatic-speech-recognition" ? "audio" : "text";
  }

  get outputModalities(): string | null {
    return "text";
  }

  get capabilities(): string | null {
    return null;
  }

  get supportsToolCalling(): boolean | null {
    return this.supportsTools;
  }

  async load(): Promise<void> {
    this.loadCalls += 1;
    await this.loadGate;
    this.loaded = true;
  }

  async unload(): Promise<void> {
    this.unloadCalls += 1;
    this.loaded = false;
  }

  async download(): Promise<void> {}

  removeFromCache(): void {}

  selectVariant(): void {}

  createChatClient(): never {
    throw new Error("Unused.");
  }

  createAudioClient(): never {
    throw new Error("Unused.");
  }

  createEmbeddingClient(): never {
    throw new Error("Unused.");
  }
}

class FakeManager {
  readonly catalog;

  constructor(
    readonly chatModel: FakeModel,
    readonly audioModel: FakeModel,
  ) {
    this.catalog = {
      getModelVariant: async (id: string) => {
        const model = [chatModel, audioModel].find((candidate) => candidate.id === id);
        if (model === undefined) {
          throw new Error(`Unknown model ${id}`);
        }
        return model;
      },
      getCachedModels: async () => [chatModel, audioModel],
    };
  }

  discoverEps() {
    return [{ name: "WebGpuExecutionProvider", isRegistered: true }];
  }

  async downloadAndRegisterEps(): Promise<EpDownloadResult> {
    return {
      success: true,
      status: "registered",
      registeredEps: [],
      failedEps: [],
    };
  }

  dispose(): void {}
}

class FakeChatSession {
  readonly turnCount = 0;
  async preflightRequest(_request: Request): Promise<RequestPreflightResult> {
    throw new Error("Unused.");
  }
  async processRequest(_request: Request): Promise<Response> {
    throw new Error("Unused.");
  }
  undoTurns(): void {}
  dispose(): void {}
}

class FakeAudioSession {
  constructor(readonly error: Error | null) {}

  async processRequest(_request: Request): Promise<Response> {
    if (this.error !== null) {
      throw this.error;
    }
    return {
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 1, totalTokens: 1 },
      output: [
        {
          type: "speechResult",
          text: "Can a queen size bed and a desk fit here?",
          segments: [],
        },
      ],
    };
  }

  dispose(): void {}
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture(audioError: Error | null = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), "foundry-audio-service-"));
  tempRoots.push(root);
  const store = new TempAudioStore(root);
  const chatModel = new FakeModel(
    VALIDATED_MODEL_ID,
    "qwen2.5-1.5b",
    "chat-completion",
    VALIDATED_EXECUTION_PROVIDER,
    true,
    1546,
  );
  const audioModel = new FakeModel(
    AUDIO_MODEL_ID,
    AUDIO_MODEL_ALIAS,
    "automatic-speech-recognition",
    "CPUExecutionProvider",
    false,
    131,
  );
  const manager = new FakeManager(chatModel, audioModel);
  const service = new FoundryLayoutService({
    resolvePaths: async () => ({
      appDataDir: root,
      logsDir: root,
      modelCacheDir: root,
      audioTempDir: root,
    }),
    createManager: (_config: FoundryLocalConfig) => manager,
    createSession: () => new FakeChatSession(),
    createAudioSession: () => new FakeAudioSession(audioError),
    audioTempStore: store,
  });
  return { service, store, audioModel };
}

const capture: ValidatedAudioCapture = {
  format: "pcm_s16le",
  sampleRate: 16_000,
  channels: 1,
  durationMs: 1000,
  pcmBytes: new Uint8Array(32_000),
};

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("Foundry audio service cleanup", () => {
  it("transcribes with the exact audio model and deletes the temporary WAV", async () => {
    const { service, store } = await createFixture();
    const readiness = await service.prepareAudioOffline();
    expect(readiness).toMatchObject({
      localAudioReady: true,
      model: {
        id: AUDIO_MODEL_ID,
        executionProvider: "CPUExecutionProvider",
      },
    });

    const result = await service.transcribeAudio(capture);
    expect(result.transcript).toContain("queen size bed");
    expect(result.externalEndpointUsed).toBe(false);
    expect(store.activeCount).toBe(0);
    await service.shutdown();
  });

  it("deletes the temporary WAV when native transcription fails", async () => {
    const { service, store } = await createFixture(new Error("native ASR failure"));
    await service.prepareAudioOffline();
    await expect(service.transcribeAudio(capture)).rejects.toThrow("native ASR failure");
    expect(store.activeCount).toBe(0);
    await service.shutdown();
  });

  it("unloads the audio model and removes tracked captures on reset", async () => {
    const { service, store, audioModel } = await createFixture();
    await service.prepareAudioOffline();
    await store.createWav(new Uint8Array([0, 0]));
    expect(audioModel.loaded).toBe(true);
    expect(store.activeCount).toBe(1);

    await service.resetAudio();

    expect(audioModel.loaded).toBe(false);
    expect(store.activeCount).toBe(0);
    expect(service.audioReadiness.status).toBe("not_initialized");
    await service.shutdown();
  });

  it("single-flights preparation and makes reset await then unload an in-flight load", async () => {
    const { service, audioModel } = await createFixture();
    const loadGate = deferred();
    audioModel.loadGate = loadGate.promise;

    const firstPreparation = service.prepareAudioOffline();
    const secondPreparation = service.prepareAudioOffline();
    expect(secondPreparation).toBe(firstPreparation);
    const preparationOutcomes = Promise.allSettled([firstPreparation, secondPreparation]);

    await vi.waitFor(() => expect(audioModel.loadCalls).toBe(1));
    const reset = service.resetAudio();
    loadGate.resolve();

    const outcomes = await preparationOutcomes;
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
    await reset;

    expect(audioModel.loadCalls).toBe(1);
    expect(audioModel.unloadCalls).toBe(1);
    expect(audioModel.loaded).toBe(false);
    expect(service.audioReadiness.status).toBe("not_initialized");
    await service.shutdown();
  });

  it("makes shutdown await and unload an in-flight audio preparation", async () => {
    const { service, audioModel } = await createFixture();
    const loadGate = deferred();
    audioModel.loadGate = loadGate.promise;

    const preparation = service.prepareAudioOffline();
    const preparationOutcome = Promise.allSettled([preparation]);
    await vi.waitFor(() => expect(audioModel.loadCalls).toBe(1));

    const shutdown = service.shutdown();
    loadGate.resolve();

    expect((await preparationOutcome)[0]?.status).toBe("rejected");
    await shutdown;
    expect(audioModel.unloadCalls).toBe(1);
    expect(audioModel.loaded).toBe(false);
    expect(service.audioReadiness.status).toBe("not_initialized");
  });
});
