import {
  DeviceType,
  type EpDownloadResult,
  type IModel,
  type ModelInfo,
  type Request,
  type Response,
} from "foundry-local-sdk";
import { describe, expect, it } from "vitest";
import { FLOOR_PLAN_VISION_MODEL_ID, parseFloorPlanRecognition } from "../src/domain/floor-plan-import";
import { FoundryLayoutService, type FoundryRuntimeError } from "../src/foundry/foundry-service";
import {
  VALIDATED_EXECUTION_PROVIDER,
  VALIDATED_MODEL_ALIAS,
  VALIDATED_MODEL_ID,
} from "../src/foundry/runtime-config";

const validRecognition =
  '{"schema":"single-room-v1","room":{"shape":"rectangle","aspectPermille":1390},"doors":[{"wall":"north","startPermille":170,"endPermille":300,"hinge":"west","swing":"inward","quadrant":"south-east"},{"wall":"east","startPermille":150,"endPermille":320,"hinge":"south","swing":"inward","quadrant":"north-west"}],"window":{"wall":"east","startPermille":500,"endPermille":690},"fixedObstruction":{"kind":"none"},"movableFurnitureSymbols":"present"}';

const fakePaths = {
  rootDir: "C:\\foundry-test",
  appDataDir: "C:\\foundry-test\\app",
  modelCacheDir: "C:\\foundry-test\\models",
  logsDir: "C:\\foundry-test\\logs",
  audioTempDir: "C:\\foundry-test\\audio-temp",
};

class FakeModel implements IModel {
  loaded = false;
  downloadCalls = 0;
  loadCalls = 0;

  constructor(
    readonly id: string,
    readonly alias: string,
    readonly provider: string,
    readonly task: string,
    readonly inputModalities: string,
    readonly supportsTools: boolean,
    public cached = true,
  ) {}

  get info(): ModelInfo {
    return {
      id: this.id,
      name: this.id,
      version: 1,
      alias: this.alias,
      uri: `fake://${this.id}`,
      deviceType: this.provider === "CPUExecutionProvider" ? DeviceType.CPU : DeviceType.GPU,
      executionProvider: this.provider,
      providerType: "fake",
      cached: this.cached,
      task: this.task,
      runtime: {
        deviceType: this.provider === "CPUExecutionProvider" ? DeviceType.CPU : DeviceType.GPU,
        executionProvider: this.provider,
      },
      supportsToolCalling: this.supportsTools,
      inputModalities: this.inputModalities,
      outputModalities: "text",
      fileSizeMb: 100,
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
    return this.cached;
  }

  async isLoaded(): Promise<boolean> {
    return this.loaded;
  }

  get contextLength(): number | null {
    return 4096;
  }

  get outputModalities(): string | null {
    return "text";
  }

  get capabilities(): string | null {
    return this.task;
  }

  get supportsToolCalling(): boolean | null {
    return this.supportsTools;
  }

  async download(
    progressOrSignal?: ((progress: number) => void) | AbortSignal,
    _signal?: AbortSignal,
  ): Promise<void> {
    this.downloadCalls += 1;
    if (typeof progressOrSignal === "function") {
      progressOrSignal(100);
    }
    this.cached = true;
  }

  get path(): string {
    return `C:\\foundry-test\\models\\${this.id}`;
  }

  async load(): Promise<void> {
    this.loadCalls += 1;
    this.loaded = true;
  }

  removeFromCache(): void {
    this.cached = false;
  }

  async unload(): Promise<void> {
    this.loaded = false;
  }

  createChatClient(): never {
    throw new Error("Not used.");
  }

  createAudioClient(): never {
    throw new Error("Not used.");
  }

  createEmbeddingClient(): never {
    throw new Error("Not used.");
  }

  get variants(): IModel[] {
    return [];
  }

  selectVariant(): void {}
}

class FakeManager {
  readonly lookups: string[] = [];
  disposeCalls = 0;
  readonly catalog: {
    readonly getModelVariant: (id: string) => Promise<IModel>;
    readonly getCachedModels: () => Promise<IModel[]>;
  };

  constructor(readonly models: readonly FakeModel[]) {
    this.catalog = {
      getModelVariant: async (id) => {
        this.lookups.push(id);
        const model = this.models.find((candidate) => candidate.id === id);
        if (model === undefined) {
          throw new Error(`Unknown model ${id}`);
        }
        return model;
      },
      getCachedModels: async () => this.models.filter((model) => model.isCached),
    };
  }

  discoverEps() {
    return [{ name: VALIDATED_EXECUTION_PROVIDER, isRegistered: true }];
  }

  async downloadAndRegisterEps(): Promise<EpDownloadResult> {
    return { success: true, status: "registered", registeredEps: [], failedEps: [] };
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

class VisionSession {
  turnCount = 0;
  disposeCalls = 0;
  capturedImage: Uint8Array | null = null;

  constructor(
    readonly gate: Promise<void> = Promise.resolve(),
    readonly onProcess: () => void = () => {},
    readonly output = validRecognition,
    readonly finishReason: Response["finishReason"] = "stop",
  ) {}

  async preflightRequest(): Promise<{
    fits: true;
    promptTokens: number;
    outputReserveTokens: number;
    requiredTokens: number;
    contextLimitTokens: number;
    deficitTokens: number;
  }> {
    return {
      fits: true,
      promptTokens: 100,
      outputReserveTokens: 320,
      requiredTokens: 420,
      contextLimitTokens: 4096,
      deficitTokens: 0,
    };
  }

  async processRequest(request: Request): Promise<Response> {
    const message = request.getItem(1);
    if (message.type !== "message") {
      throw new Error("Expected multimodal user message.");
    }
    const image = message.parts?.find((part) => part.type === "image");
    if (image?.type !== "image" || image.data === undefined) {
      throw new Error("Expected in-memory image bytes.");
    }
    this.capturedImage = image.data;
    this.onProcess();
    await this.gate;
    this.turnCount += 1;
    return {
      finishReason: this.finishReason,
      output: [{ type: "text", text: this.output }],
      usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
    };
  }

  undoTurns(count: number): void {
    this.turnCount = Math.max(0, this.turnCount - count);
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

function models() {
  return {
    layout: new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      "chat-completion",
      "text",
      true,
    ),
    vision: new FakeModel(
      FLOOR_PLAN_VISION_MODEL_ID,
      "qwen3.5-0.8b",
      "CPUExecutionProvider",
      "vision-language-chat",
      "text,image",
      false,
    ),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("Foundry floor-plan vision slot", () => {
  it("shares one manager, uses exact CPU VLM bytes, zero-fills the request copy, and reports no endpoint", async () => {
    const { layout, vision } = models();
    const manager = new FakeManager([layout, vision]);
    const session = new VisionSession();
    const zeroedBuffers: Uint8Array[] = [];
    let managerCreates = 0;
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => {
        managerCreates += 1;
        return manager;
      },
      createVisionSession: () => session,
      onVisionBufferZeroed: (bytes) => {
        zeroedBuffers.push(bytes);
      },
    });
    const input = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Uint8Array(64).fill(7)]);

    const outcome = await service.analyzeFloorPlan("png", input);

    expect(managerCreates).toBe(1);
    expect(manager.lookups).toEqual([VALIDATED_MODEL_ID, FLOOR_PLAN_VISION_MODEL_ID]);
    const parsed = parseFloorPlanRecognition(validRecognition);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    expect(outcome.recognition).toEqual(parsed.value);
    expect(outcome.model).toMatchObject({
      id: FLOOR_PLAN_VISION_MODEL_ID,
      executionProvider: "CPUExecutionProvider",
    });
    expect(service.visionReadiness).toMatchObject({
      localInferenceReady: true,
      externalEndpointUsed: false,
      status: "ready",
    });
    expect(outcome.attempts).toEqual([
      expect.objectContaining({ attempt: 1, error: null, finishReason: "stop" }),
    ]);
    expect(zeroedBuffers[0]?.every((value) => value === 0)).toBe(true);
    expect(input.some((value) => value !== 0)).toBe(true);

    await service.shutdown();
    expect(manager.disposeCalls).toBe(1);
    expect(vision.loaded).toBe(false);
  });

  it("fails closed when the exact VLM is absent and never substitutes another model", async () => {
    const { layout } = models();
    const alternate = new FakeModel(
      "alternate-vision-generic-cpu:1",
      "alternate",
      "CPUExecutionProvider",
      "vision-language-chat",
      "text,image",
      false,
    );
    const manager = new FakeManager([layout, alternate]);
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => manager,
      createVisionSession: () => new VisionSession(),
    });

    await expect(service.prepareFloorPlanVision()).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "MODEL_UNAVAILABLE",
    });
    expect(manager.lookups).toEqual([VALIDATED_MODEL_ID, FLOOR_PLAN_VISION_MODEL_ID]);
    expect(alternate.loadCalls).toBe(0);
    expect(service.visionReadiness.externalEndpointUsed).toBe(false);
    await service.shutdown();
  });

  it("cancels stale analysis, disposes its session, and zero-fills bytes before returning", async () => {
    const { layout, vision } = models();
    const manager = new FakeManager([layout, vision]);
    const gate = deferred();
    const started = deferred();
    const session = new VisionSession(gate.promise, started.resolve);
    const zeroedBuffers: Uint8Array[] = [];
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => manager,
      createVisionSession: () => session,
      onVisionBufferZeroed: (bytes) => {
        zeroedBuffers.push(bytes);
      },
    });
    const input = new Uint8Array(128).fill(9);

    const analysis = service.analyzeFloorPlan("png", input);
    await started.promise;
    const cancellation = service.cancelFloorPlanAnalysis();
    gate.resolve();

    await expect(analysis).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "RUNTIME_NOT_READY",
      message: expect.stringContaining("superseded"),
    });
    await cancellation;
    expect(session.disposeCalls).toBe(1);
    expect(zeroedBuffers[0]?.every((value) => value === 0)).toBe(true);
    await service.shutdown();
  });

  it("uses one bounded correction attempt without increasing output tokens", async () => {
    const { layout, vision } = models();
    const manager = new FakeManager([layout, vision]);
    const sessions = [
      new VisionSession(Promise.resolve(), () => {}, `\`\`\`json\n${validRecognition}\n\`\`\``),
      new VisionSession(),
    ];
    const zeroedBuffers: Uint8Array[] = [];
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => manager,
      createVisionSession: () => {
        const session = sessions.shift();
        if (session === undefined) {
          throw new Error("Unexpected extra vision attempt.");
        }
        return session;
      },
      onVisionBufferZeroed: (bytes) => zeroedBuffers.push(bytes),
    });

    const outcome = await service.analyzeFloorPlan("png", new Uint8Array(128).fill(5));

    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.attempts[0]).toMatchObject({
      attempt: 1,
      rawOutput: expect.stringContaining("```json"),
      error: { code: "INVALID_OUTPUT" },
    });
    expect(outcome.attempts[1]).toMatchObject({ attempt: 2, error: null });
    expect(zeroedBuffers).toHaveLength(2);
    expect(zeroedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
    await service.shutdown();
  });
});
