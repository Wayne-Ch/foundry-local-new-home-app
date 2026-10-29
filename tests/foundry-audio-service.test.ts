import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
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
  type StreamingResponse,
} from "foundry-local-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_STREAM_CHUNK_BYTES,
  AUDIO_STREAM_MAX_QUEUED_CHUNKS,
  NEMOTRON_AUDIO_MODEL_ALIAS,
  NEMOTRON_AUDIO_MODEL_ID,
  type ValidatedAudioCapture,
  WHISPER_AUDIO_MODEL_ALIAS,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import { TempAudioStore } from "../src/audio/temp-audio-store";
import { FoundryLayoutService } from "../src/foundry/foundry-service";
import {
  VALIDATED_EXECUTION_PROVIDER,
  VALIDATED_MODEL_ALIAS,
  VALIDATED_MODEL_ID,
} from "../src/foundry/runtime-config";

const tempRoots: string[] = [];

interface FakeModelState {
  loaded: boolean;
  loadCalls: number;
  unloadCalls: number;
  loadGate: Promise<void> | null;
  loadError: Error | null;
}

class FakeModel implements IModel {
  readonly #state: FakeModelState;

  constructor(
    readonly id: string,
    readonly alias: string,
    readonly task: string,
    readonly provider: string,
    readonly supportsTools: boolean,
    readonly sizeMb: number,
    state?: FakeModelState,
  ) {
    this.#state = state ?? {
      loaded: false,
      loadCalls: 0,
      unloadCalls: 0,
      loadGate: null,
      loadError: null,
    };
  }

  get loaded(): boolean {
    return this.#state.loaded;
  }

  set loaded(value: boolean) {
    this.#state.loaded = value;
  }

  get loadCalls(): number {
    return this.#state.loadCalls;
  }

  get unloadCalls(): number {
    return this.#state.unloadCalls;
  }

  get loadGate(): Promise<void> | null {
    return this.#state.loadGate;
  }

  set loadGate(value: Promise<void> | null) {
    this.#state.loadGate = value;
  }

  get loadError(): Error | null {
    return this.#state.loadError;
  }

  set loadError(value: Error | null) {
    this.#state.loadError = value;
  }

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
    this.#state.loadCalls += 1;
    await this.loadGate;
    if (this.loadError !== null) {
      throw this.loadError;
    }
    this.loaded = true;
  }

  async unload(): Promise<void> {
    this.#state.unloadCalls += 1;
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

  freshWrapper(): FakeModel {
    return new FakeModel(
      this.id,
      this.alias,
      this.task,
      this.provider,
      this.supportsTools,
      this.sizeMb,
      this.#state,
    );
  }
}

class FakeManager {
  readonly catalog;
  disposeCalls = 0;
  readonly unavailableAudioModelIds = new Set<string>();

  constructor(
    readonly chatModel: FakeModel,
    readonly audioModels: readonly FakeModel[],
    readonly freshAudioModelWrappers = false,
  ) {
    this.catalog = {
      getModelVariant: async (id: string) => {
        const model = [chatModel, ...audioModels].find((candidate) => candidate.id === id);
        if (model === undefined || this.unavailableAudioModelIds.has(id)) {
          throw new Error(`Unknown model ${id}`);
        }
        return this.freshAudioModelWrappers && model.task === "automatic-speech-recognition"
          ? model.freshWrapper()
          : model;
      },
      getCachedModels: async () =>
        [chatModel, ...audioModels].filter((model) => !this.unavailableAudioModelIds.has(model.id)),
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

  dispose(): void {
    this.disposeCalls += 1;
  }
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

function speechResponse(): Response {
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

class FakeAudioSession {
  disposed = false;
  disposeCalls = 0;

  constructor(
    readonly error: Error | null,
    readonly processGate: Promise<void> | null = null,
    readonly processStarted: (() => void) | null = null,
  ) {}

  async processRequest(_request: Request): Promise<Response> {
    this.processStarted?.();
    await this.processGate;
    if (this.error !== null) {
      throw this.error;
    }

    return speechResponse();
  }

  processStreamingRequest(): StreamingResponse {
    const response = Promise.resolve(speechResponse());
    return {
      response,
      async *[Symbol.asyncIterator]() {
        yield {
          type: "speechSegment",
          kind: "partial",
          text: "Can a queen",
          utteranceStart: true,
          words: [],
        } as const;
        yield {
          type: "speechSegment",
          kind: "partial",
          text: "Can a queen size bed",
          utteranceStart: false,
          words: [],
        } as const;
      },
    };
  }

  dispose(): void {
    this.disposeCalls += 1;
    this.disposed = true;
  }
}

class GatedStreamingAudioSession extends FakeAudioSession {
  constructor(
    readonly streamGate: Promise<void>,
    readonly streamStarted: (() => void) | null = null,
  ) {
    super(null);
  }

  override processStreamingRequest(): StreamingResponse {
    this.streamStarted?.();
    const gate = this.streamGate;
    return {
      response: gate.then(() => speechResponse()),
      async *[Symbol.asyncIterator]() {
        await gate;
        yield { type: "text", text: "" } as const;
      },
    };
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface FixtureOptions {
  readonly audioError?: Error | null;
  readonly audioSession?: FakeAudioSession;
  readonly createStore?: (root: string) => TempAudioStore;
  readonly resolvePathsGate?: Promise<void>;
  readonly onCreateManager?: () => void;
  readonly operationDrainTimeoutMs?: number;
  readonly prepareRoot?: (root: string) => Promise<void>;
  readonly freshAudioModelWrappers?: boolean;
}

async function createFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "foundry-audio-service-"));
  tempRoots.push(root);
  await options.prepareRoot?.(root);
  const store = options.createStore?.(root) ?? new TempAudioStore(root);
  const chatModel = new FakeModel(
    VALIDATED_MODEL_ID,
    VALIDATED_MODEL_ALIAS,
    "chat-completion",
    VALIDATED_EXECUTION_PROVIDER,
    true,
    529,
  );
  const audioModel = new FakeModel(
    WHISPER_AUDIO_MODEL_ID,
    WHISPER_AUDIO_MODEL_ALIAS,
    "automatic-speech-recognition",
    "CPUExecutionProvider",
    false,
    131,
  );
  const nemotronModel = new FakeModel(
    NEMOTRON_AUDIO_MODEL_ID,
    NEMOTRON_AUDIO_MODEL_ALIAS,
    "automatic-speech-recognition",
    "CPUExecutionProvider",
    false,
    696,
  );
  const manager = new FakeManager(chatModel, [audioModel, nemotronModel], options.freshAudioModelWrappers);
  const audioSession = options.audioSession ?? new FakeAudioSession(options.audioError ?? null);
  const service = new FoundryLayoutService({
    resolvePaths: async () => {
      await options.resolvePathsGate;
      return {
        appDataDir: root,
        logsDir: root,
        modelCacheDir: root,
        audioTempDir: root,
      };
    },
    createManager: (_config: FoundryLocalConfig) => {
      options.onCreateManager?.();
      return manager;
    },
    createSession: () => new FakeChatSession(),
    createAudioSession: () => audioSession,
    audioTempStore: store,
    ...(options.operationDrainTimeoutMs === undefined
      ? {}
      : { operationDrainTimeoutMs: options.operationDrainTimeoutMs }),
  });
  return { service, store, audioModel, nemotronModel, audioSession, manager, root };
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
  it("purges owned startup orphans without touching unrelated files", async () => {
    let orphanPath = "";
    let unrelatedPath = "";
    const { service } = await createFixture({
      prepareRoot: async (root) => {
        orphanPath = path.join(root, "capture-startup-orphan.wav");
        unrelatedPath = path.join(root, "meeting.wav");
        await Promise.all([
          writeFile(orphanPath, new Uint8Array([1])),
          writeFile(unrelatedPath, new Uint8Array([2])),
        ]);
      },
    });

    await service.initialize();

    await expect(readFile(orphanPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect([...(await readFile(unrelatedPath))]).toEqual([2]);
    await service.shutdown();
  });

  it("transcribes with the exact audio model and deletes the temporary WAV", async () => {
    const { service, store } = await createFixture();
    const readiness = await service.prepareAudioOffline("whisper_file");
    expect(readiness).toMatchObject({
      localAudioReady: true,
      model: {
        id: WHISPER_AUDIO_MODEL_ID,
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
    const { service, store } = await createFixture({
      audioError: new Error("native ASR failure"),
    });
    await service.prepareAudioOffline("whisper_file");
    await expect(service.transcribeAudio(capture)).rejects.toThrow("native ASR failure");
    expect(store.activeCount).toBe(0);
    await service.shutdown();
  });

  it("unloads the audio model and removes tracked captures on reset", async () => {
    const { service, store, audioModel } = await createFixture();
    await service.prepareAudioOffline("whisper_file");
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

    const firstPreparation = service.prepareAudioOffline("whisper_file");
    const secondPreparation = service.prepareAudioOffline("whisper_file");
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

    const preparation = service.prepareAudioOffline("whisper_file");
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

  it("shares manager initialization between runtime startup and audio preparation", async () => {
    const pathsGate = deferred();
    let managerCreateCalls = 0;
    const { service, manager } = await createFixture({
      resolvePathsGate: pathsGate.promise,
      onCreateManager: () => {
        managerCreateCalls += 1;
      },
    });

    const startup = service.initialize();
    const audioPreparation = service.prepareAudioOffline("whisper_file");
    pathsGate.resolve();

    await Promise.all([startup, audioPreparation]);
    expect(managerCreateCalls).toBe(1);
    await service.shutdown();
    expect(manager.disposeCalls).toBe(1);
  });

  it("does not dispose an audio session while reset is waiting for its request", async () => {
    const processGate = deferred();
    const processStarted = deferred();
    const audioSession = new FakeAudioSession(null, processGate.promise, processStarted.resolve);
    const { service, store, audioModel } = await createFixture({
      audioSession,
      operationDrainTimeoutMs: 1_000,
    });
    await service.prepareAudioOffline("whisper_file");

    const transcriptionOutcome = Promise.allSettled([service.transcribeAudio(capture)]);
    await processStarted.promise;
    await vi.waitFor(() => expect(store.activeCount).toBe(1));
    const reset = service.reset();
    await Promise.resolve();
    expect(audioSession.disposed).toBe(false);

    processGate.resolve();
    expect((await transcriptionOutcome)[0]?.status).toBe("rejected");
    await reset;

    expect(audioSession.disposeCalls).toBe(1);
    expect(store.activeCount).toBe(0);
    expect(audioModel.unloadCalls).toBe(1);
    await service.shutdown();
  });

  it("keeps failed reset cleanup tracked and succeeds on retry", async () => {
    let blockRemoval = true;
    const { service, store, audioModel } = await createFixture({
      createStore: (root) =>
        new TempAudioStore(root, {
          remove: async (filePath) => {
            if (blockRemoval) {
              throw Object.assign(new Error("file is busy"), { code: "EPERM" });
            }
            await unlink(filePath);
          },
        }),
    });
    await service.prepareAudioOffline("whisper_file");
    await store.createWav(new Uint8Array([0, 0]));

    await expect(service.reset()).rejects.toMatchObject({ code: "EPERM" });
    expect(store.activeCount).toBe(1);
    expect(audioModel.loaded).toBe(true);

    blockRemoval = false;
    await service.reset();
    expect(store.activeCount).toBe(0);
    expect(audioModel.loaded).toBe(false);
    await service.shutdown();
  });

  it("reports a shutdown-time capture obligation and lets the next store purge the orphan", async () => {
    const processGate = deferred();
    const processStarted = deferred();
    const audioSession = new FakeAudioSession(null, processGate.promise, processStarted.resolve);
    let blockRemoval = true;
    const { service, store, root } = await createFixture({
      audioSession,
      operationDrainTimeoutMs: 20,
      createStore: (directory) =>
        new TempAudioStore(directory, {
          remove: async (filePath) => {
            if (blockRemoval) {
              throw Object.assign(new Error("capture is locked"), { code: "EBUSY" });
            }
            await unlink(filePath);
          },
        }),
    });
    await service.prepareAudioOffline("whisper_file");

    const transcriptionOutcome = Promise.allSettled([service.transcribeAudio(capture)]);
    await processStarted.promise;
    await vi.waitFor(() => expect(store.activeCount).toBe(1));

    await expect(service.shutdown()).rejects.toThrow(
      "owned temporary audio capture remains for next-launch recovery",
    );
    expect(store.activeCount).toBe(1);
    expect((await readdir(root)).filter((fileName) => fileName.startsWith("capture-"))).toHaveLength(1);

    const nextStore = new TempAudioStore(root);
    const recovery = await nextStore.recoverOwnedCaptures();
    expect(recovery).toEqual({ discovered: 1, removed: 1, retained: 0 });
    expect((await readdir(root)).filter((fileName) => fileName.startsWith("capture-"))).toHaveLength(0);

    blockRemoval = false;
    processGate.resolve();
    expect((await transcriptionOutcome)[0]?.status).toBe("rejected");
    await vi.waitFor(() => expect(store.activeCount).toBe(0));
    await service.shutdown();
  });
});

describe("Nemotron streaming audio service", () => {
  it("requires explicit Nemotron preparation before a live microphone stream", async () => {
    const { service, nemotronModel } = await createFixture();

    await expect(service.startAudioStream(() => {})).rejects.toMatchObject({
      code: "AUDIO_NOT_READY",
    });
    expect(nemotronModel.loadCalls).toBe(0);
    await service.shutdown();
  });

  it("uses the exact English Nemotron CPU model as the default audio mode", async () => {
    const { service, nemotronModel, audioModel } = await createFixture();

    const readiness = await service.prepareAudioOffline();

    expect(readiness).toMatchObject({
      activeMode: "nemotron_streaming",
      localAudioReady: true,
      model: {
        id: NEMOTRON_AUDIO_MODEL_ID,
        executionProvider: "CPUExecutionProvider",
        language: "en",
      },
    });
    expect(nemotronModel.loadCalls).toBe(1);
    expect(audioModel.loadCalls).toBe(0);
    await service.shutdown();
  });

  it("emits replaced partials and a final reviewed transcript", async () => {
    const { service } = await createFixture();
    const readiness = await service.prepareAudioOffline("nemotron_streaming");
    expect(readiness).toMatchObject({
      activeMode: "nemotron_streaming",
      localAudioReady: true,
      model: { id: NEMOTRON_AUDIO_MODEL_ID },
    });

    const partials: string[] = [];
    const stream = await service.startAudioStream((event) => partials.push(event.text));
    for (let sequence = 0; sequence < 3; sequence += 1) {
      expect(service.appendAudioStreamChunk(stream.streamId, sequence, new Uint8Array(3200))).toMatchObject({
        acceptedSequence: sequence,
      });
    }
    const result = await service.finishAudioStream({
      streamId: stream.streamId,
      lastSequence: 2,
      audioDurationMs: 300,
    });

    expect(partials).toEqual(["Can a queen", "Can a queen size bed"]);
    expect(result).toMatchObject({
      transcript: "Can a queen size bed and a desk fit here?",
      mode: "nemotron_streaming",
      transcriptSource: "live_stream_final",
      model: { id: NEMOTRON_AUDIO_MODEL_ID },
      externalEndpointUsed: false,
    });
    expect(result.firstPartialMs).not.toBeNull();
    await service.shutdown();
  });

  it("enforces chunk shape and a bounded native input queue", async () => {
    const { service } = await createFixture();
    await service.prepareAudioOffline("nemotron_streaming");
    const stream = await service.startAudioStream(() => {});

    expect(() =>
      service.appendAudioStreamChunk(stream.streamId, 0, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES + 2)),
    ).toThrow("complete PCM bytes");

    for (let sequence = 0; sequence < AUDIO_STREAM_MAX_QUEUED_CHUNKS; sequence += 1) {
      expect(
        service.appendAudioStreamChunk(stream.streamId, sequence, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES)),
      ).toMatchObject({ acceptedSequence: sequence });
    }
    expect(() =>
      service.appendAudioStreamChunk(
        stream.streamId,
        AUDIO_STREAM_MAX_QUEUED_CHUNKS,
        new Uint8Array(AUDIO_STREAM_CHUNK_BYTES),
      ),
    ).toThrow("backpressure capacity");

    await service.cancelAudioStream(stream.streamId);
    await service.shutdown();
  });

  it("cancels and disposes a stream when finalization input is invalid", async () => {
    const { service, audioSession } = await createFixture();
    await service.prepareAudioOffline("nemotron_streaming");
    const stream = await service.startAudioStream(() => {});
    for (let sequence = 0; sequence < 3; sequence += 1) {
      service.appendAudioStreamChunk(stream.streamId, sequence, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    }

    await expect(
      service.finishAudioStream({
        streamId: stream.streamId,
        lastSequence: 1,
        audioDurationMs: 300,
      }),
    ).rejects.toThrow("Expected final audio sequence 2");

    expect(audioSession.disposed).toBe(true);
    expect(() =>
      service.appendAudioStreamChunk(stream.streamId, 3, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES)),
    ).toThrow("not active");
    await service.shutdown();
  });

  it("derives stream duration from accepted PCM bytes instead of trusting the renderer", async () => {
    const { service } = await createFixture();
    await service.prepareAudioOffline("nemotron_streaming");
    const stream = await service.startAudioStream(() => {});
    for (let sequence = 0; sequence < 3; sequence += 1) {
      service.appendAudioStreamChunk(stream.streamId, sequence, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    }

    await expect(
      service.finishAudioStream({
        streamId: stream.streamId,
        lastSequence: 2,
        audioDurationMs: 301,
      }),
    ).rejects.toThrow("does not match");
    await service.shutdown();
  });

  it("rejects stale chunks as soon as finalization starts", async () => {
    const streamGate = deferred();
    const audioSession = new GatedStreamingAudioSession(streamGate.promise);
    const { service } = await createFixture({ audioSession });
    await service.prepareAudioOffline("nemotron_streaming");
    const stream = await service.startAudioStream(() => {});
    for (let sequence = 0; sequence < 3; sequence += 1) {
      service.appendAudioStreamChunk(stream.streamId, sequence, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES));
    }

    const finalization = service.finishAudioStream({
      streamId: stream.streamId,
      lastSequence: 2,
      audioDurationMs: 300,
    });
    expect(() =>
      service.appendAudioStreamChunk(stream.streamId, 3, new Uint8Array(AUDIO_STREAM_CHUNK_BYTES)),
    ).toThrow("no longer accepts chunks");

    streamGate.resolve();
    await expect(finalization).resolves.toMatchObject({
      transcriptSource: "live_stream_final",
    });
    await service.shutdown();
  });

  it("waits for native stream settlement before explicit cancellation cleanup", async () => {
    const streamGate = deferred();
    const audioSession = new GatedStreamingAudioSession(streamGate.promise);
    const { service } = await createFixture({
      audioSession,
      operationDrainTimeoutMs: 1_000,
    });
    await service.prepareAudioOffline("nemotron_streaming");
    const stream = await service.startAudioStream(() => {});

    const cancellation = service.cancelAudioStream(stream.streamId);
    await Promise.resolve();
    expect(audioSession.disposed).toBe(false);

    streamGate.resolve();
    await cancellation;
    expect(audioSession.disposed).toBe(true);
    expect(service.audioReadiness).toMatchObject({
      status: "ready",
      localAudioReady: true,
      activeMode: "nemotron_streaming",
    });
    await service.shutdown();
  });

  it("bounds explicit cancellation and leaves the stream for reset recovery", async () => {
    const streamGate = deferred();
    const audioSession = new GatedStreamingAudioSession(streamGate.promise);
    const { service } = await createFixture({
      audioSession,
      operationDrainTimeoutMs: 5,
    });
    await service.prepareAudioOffline("nemotron_streaming");
    const stream = await service.startAudioStream(() => {});

    await expect(service.cancelAudioStream(stream.streamId)).rejects.toThrow(
      "audio cancellation could not safely stop active native operations",
    );
    expect(service.audioReadiness).toMatchObject({
      status: "error",
      localAudioReady: false,
    });
    expect(service.audioReadiness.fallbackReason).toContain("cancellation");
    expect(audioSession.disposed).toBe(false);

    streamGate.resolve();
    await vi.waitFor(() => expect(audioSession.disposed).toBe(true));
    await service.shutdown();
  });

  it("bounds a stalled stream reset and recovers after native settlement", async () => {
    const streamGate = deferred();
    const audioSession = new GatedStreamingAudioSession(streamGate.promise);
    const { service, nemotronModel } = await createFixture({
      audioSession,
      operationDrainTimeoutMs: 20,
    });
    await service.prepareAudioOffline("nemotron_streaming");
    await service.startAudioStream(() => {});

    await expect(service.reset()).rejects.toThrow("could not safely stop active native operations");
    expect(audioSession.disposed).toBe(false);
    expect(service.readiness.status).toBe("recovering");

    streamGate.resolve();
    await vi.waitFor(() => {
      expect(audioSession.disposed).toBe(true);
      expect(nemotronModel.loaded).toBe(false);
      expect(service.audioReadiness.status).toBe("not_initialized");
      expect(service.readiness.status).not.toBe("recovering");
    });
    await service.shutdown();
  });

  it.each(["reset", "shutdown"] as const)(
    "waits for native stream settlement during %s",
    async (lifecycle) => {
      const streamGate = deferred();
      const audioSession = new GatedStreamingAudioSession(streamGate.promise);
      const { service, nemotronModel } = await createFixture({
        audioSession,
        operationDrainTimeoutMs: 1_000,
      });
      await service.prepareAudioOffline("nemotron_streaming");
      await service.startAudioStream(() => {});

      const cleanup = lifecycle === "reset" ? service.resetAudio() : service.shutdown();
      await Promise.resolve();
      expect(audioSession.disposed).toBe(false);

      streamGate.resolve();
      await cleanup;
      expect(audioSession.disposed).toBe(true);
      expect(nemotronModel.loaded).toBe(false);
      if (lifecycle === "reset") {
        await service.shutdown();
      }
    },
  );

  it("rejects out-of-order chunks and cancels safely on reset", async () => {
    const { service, audioSession, nemotronModel } = await createFixture();
    await service.prepareAudioOffline("nemotron_streaming");
    const stream = await service.startAudioStream(() => {});
    expect(() => service.appendAudioStreamChunk(stream.streamId, 1, new Uint8Array(3200))).toThrow(
      "Expected audio chunk 0",
    );

    await service.resetAudio();

    expect(nemotronModel.loaded).toBe(false);
    expect(audioSession.disposed).toBe(true);
    expect(service.audioReadiness.status).toBe("not_initialized");
    await service.shutdown();
  });

  it("labels Nemotron failure and switches only after explicit Whisper preparation", async () => {
    const { service, nemotronModel, audioModel } = await createFixture();
    nemotronModel.loadError = new Error("Nemotron load failed");

    await expect(service.prepareAudioOffline("nemotron_streaming")).rejects.toThrow("Nemotron load failed");
    expect(service.audioReadiness).toMatchObject({
      status: "error",
      fallbackAvailable: true,
    });
    expect(service.audioReadiness.fallbackReason).toContain("Nemotron");
    expect(audioModel.loadCalls).toBe(0);

    const fallback = await service.prepareAudioOffline("whisper_file");
    expect(fallback).toMatchObject({
      activeMode: "whisper_file",
      localAudioReady: true,
      model: { id: WHISPER_AUDIO_MODEL_ID },
    });
    expect(fallback.fallbackReason).toContain("Nemotron");
    await service.shutdown();
  });

  it("keeps Nemotron loaded until a distinct Whisper wrapper finishes loading", async () => {
    const { service, nemotronModel, audioModel } = await createFixture({
      freshAudioModelWrappers: true,
    });
    await service.prepareAudioOffline("nemotron_streaming");
    const whisperLoad = deferred();
    audioModel.loadGate = whisperLoad.promise;

    const switchPreparation = service.prepareAudioOffline("whisper_file");
    await vi.waitFor(() => expect(audioModel.loadCalls).toBe(1));
    expect(nemotronModel.loaded).toBe(true);
    expect(nemotronModel.unloadCalls).toBe(0);

    whisperLoad.resolve();
    await expect(switchPreparation).resolves.toMatchObject({
      activeMode: "whisper_file",
      localAudioReady: true,
      model: { id: WHISPER_AUDIO_MODEL_ID },
    });
    expect(audioModel.loaded).toBe(true);
    expect(nemotronModel.loaded).toBe(false);
    expect(nemotronModel.unloadCalls).toBe(1);
    await service.shutdown();
  });

  it("recovers ready Nemotron through fresh wrappers after an unavailable Whisper switch", async () => {
    const { service, nemotronModel, audioModel, manager } = await createFixture({
      freshAudioModelWrappers: true,
    });
    await service.prepareAudioOffline("nemotron_streaming");
    manager.unavailableAudioModelIds.add(WHISPER_AUDIO_MODEL_ID);

    await expect(service.prepareAudioOffline("whisper_file")).rejects.toMatchObject({
      code: "AUDIO_MODEL_UNAVAILABLE",
    });

    expect(service.audioReadiness).toMatchObject({
      activeMode: "whisper_file",
      localAudioReady: false,
      model: null,
      status: "model_unavailable",
    });
    expect(nemotronModel.loaded).toBe(true);
    expect(nemotronModel.unloadCalls).toBe(0);
    expect(audioModel.loadCalls).toBe(0);

    manager.unavailableAudioModelIds.delete(WHISPER_AUDIO_MODEL_ID);
    const recovered = await service.prepareAudioOffline("nemotron_streaming");
    expect(recovered).toMatchObject({
      activeMode: "nemotron_streaming",
      localAudioReady: true,
      model: { id: NEMOTRON_AUDIO_MODEL_ID },
    });
    expect(nemotronModel.loaded).toBe(true);
    expect(nemotronModel.unloadCalls).toBe(0);

    const stream = await service.startAudioStream(() => {});
    await service.cancelAudioStream(stream.streamId);
    await service.shutdown();
  });

  it("recovers ready Whisper through fresh wrappers after an unavailable Nemotron switch", async () => {
    const { service, nemotronModel, audioModel, manager } = await createFixture({
      freshAudioModelWrappers: true,
    });
    await service.prepareAudioOffline("whisper_file");
    manager.unavailableAudioModelIds.add(NEMOTRON_AUDIO_MODEL_ID);

    await expect(service.prepareAudioOffline("nemotron_streaming")).rejects.toMatchObject({
      code: "AUDIO_MODEL_UNAVAILABLE",
    });

    expect(service.audioReadiness).toMatchObject({
      activeMode: "nemotron_streaming",
      fallbackAvailable: true,
      localAudioReady: false,
      model: null,
      status: "model_unavailable",
    });
    expect(audioModel.loaded).toBe(true);
    expect(audioModel.unloadCalls).toBe(0);
    expect(nemotronModel.loadCalls).toBe(0);

    manager.unavailableAudioModelIds.delete(NEMOTRON_AUDIO_MODEL_ID);
    const recovered = await service.prepareAudioOffline("whisper_file");
    expect(recovered).toMatchObject({
      activeMode: "whisper_file",
      localAudioReady: true,
      model: { id: WHISPER_AUDIO_MODEL_ID },
    });
    expect(audioModel.loaded).toBe(true);
    expect(audioModel.unloadCalls).toBe(0);

    await expect(service.transcribeAudio(capture)).resolves.toMatchObject({
      mode: "whisper_file",
      model: { id: WHISPER_AUDIO_MODEL_ID },
    });
    await service.shutdown();
  });
});
