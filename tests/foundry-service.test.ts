import {
  DeviceType,
  type EpDownloadResult,
  type IModel,
  type ModelInfo,
  type Request,
  type RequestPreflightResult,
  type Response,
} from "foundry-local-sdk";
import { describe, expect, it } from "vitest";
import { FoundryLayoutService, type FoundryRuntimeError } from "../src/foundry/foundry-service";
import {
  resolveRuntimeTarget,
  VALIDATED_EXECUTION_PROVIDER,
  VALIDATED_MODEL_ID,
} from "../src/foundry/runtime-config";
import { runtimeBadgeLabel } from "../src/renderer/runtime-presentation";

const fakePaths = {
  rootDir: "C:\\foundry-test",
  appDataDir: "C:\\foundry-test\\app",
  modelCacheDir: "C:\\foundry-test\\models",
  logsDir: "C:\\foundry-test\\logs",
  audioTempDir: "C:\\foundry-test\\audio-temp",
};

class FakeModel implements IModel {
  cached: boolean;
  loaded = false;
  downloadCalls = 0;
  loadCalls = 0;

  constructor(
    readonly id: string,
    readonly alias: string,
    readonly provider: string,
    cached: boolean,
    readonly downloadError: Error | null = null,
  ) {
    this.cached = cached;
  }

  get info(): ModelInfo {
    return {
      id: this.id,
      name: this.id.split(":")[0] ?? this.id,
      version: 1,
      alias: this.alias,
      uri: `fake://${this.id}`,
      deviceType: isCpuProvider(this.provider) ? DeviceType.CPU : DeviceType.GPU,
      executionProvider: this.provider,
      providerType: "fake",
      cached: this.cached,
      task: "chat-completion",
      runtime: {
        deviceType: isCpuProvider(this.provider) ? DeviceType.CPU : DeviceType.GPU,
        executionProvider: this.provider,
      },
      supportsToolCalling: true,
      fileSizeMb: 123,
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

  get inputModalities(): string | null {
    return "text";
  }

  get outputModalities(): string | null {
    return "text";
  }

  get capabilities(): string | null {
    return "chat";
  }

  get supportsToolCalling(): boolean | null {
    return true;
  }

  async download(_signal?: AbortSignal): Promise<void>;
  async download(progressCallback?: (progress: number) => void, _signal?: AbortSignal): Promise<void>;
  async download(
    progressOrSignal?: ((progress: number) => void) | AbortSignal,
    _signal?: AbortSignal,
  ): Promise<void> {
    this.downloadCalls += 1;
    if (this.downloadError !== null) {
      throw this.downloadError;
    }
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
    throw new Error("Not used by these tests.");
  }

  createAudioClient(): never {
    throw new Error("Not used by these tests.");
  }

  createEmbeddingClient(): never {
    throw new Error("Not used by these tests.");
  }

  get variants(): IModel[] {
    return [];
  }

  selectVariant(): void {}
}

class FakeSession {
  readonly turnCount = 0;
  disposed = false;

  async preflightRequest(_request: Request): Promise<RequestPreflightResult> {
    throw new Error("Not used by these tests.");
  }

  async processRequest(_request: Request): Promise<Response> {
    throw new Error("Not used by these tests.");
  }

  undoTurns(_count: number): void {}

  dispose(): void {
    this.disposed = true;
  }
}

class FakeManager {
  readonly catalogLookupIds: string[] = [];
  readonly registrationRequests: string[][] = [];
  providerRegistered: boolean;
  disposed = false;
  readonly catalog: {
    readonly getModelVariant: (modelId: string) => Promise<IModel>;
    readonly getCachedModels: () => Promise<IModel[]>;
  };

  constructor(
    readonly model: FakeModel,
    providerRegistered = false,
    readonly providerDiscoverable = true,
  ) {
    this.providerRegistered = providerRegistered;
    this.catalog = {
      getModelVariant: async (modelId) => {
        this.catalogLookupIds.push(modelId);
        if (modelId !== this.model.id) {
          throw new Error(`Unknown model ${modelId}`);
        }
        return this.model;
      },
      getCachedModels: async () => (this.model.isCached ? [this.model] : []),
    };
  }

  discoverEps() {
    return this.providerDiscoverable
      ? [{ name: "WebGpuExecutionProvider", isRegistered: this.providerRegistered }]
      : [];
  }

  async downloadAndRegisterEps(
    names: string[],
    progressCallback: (epName: string, percent: number) => void,
  ): Promise<EpDownloadResult> {
    this.registrationRequests.push(names);
    for (const name of names) {
      progressCallback(name, 100);
    }
    this.providerRegistered = true;
    return {
      success: true,
      status: "registered",
      registeredEps: names,
      failedEps: [],
    };
  }

  dispose(): void {
    this.disposed = true;
  }
}

function isCpuProvider(provider: string): boolean {
  return provider === "CPUExecutionProvider";
}

function createService(
  manager: FakeManager,
  environment: Readonly<Record<string, string | undefined>> = {},
): FoundryLayoutService {
  return new FoundryLayoutService({
    environment,
    resolvePaths: async () => fakePaths,
    createManager: () => manager,
    createSession: () => new FakeSession(),
  });
}

describe("Foundry runtime target configuration", () => {
  it("uses the exact validated model and WebGPU provider by default", () => {
    expect(resolveRuntimeTarget({})).toEqual({
      modelId: VALIDATED_MODEL_ID,
      executionProvider: VALIDATED_EXECUTION_PROVIDER,
      source: "built_in_default",
      stageValidated: true,
    });
  });

  it("requires exact paired overrides and rejects alias selection", () => {
    expect(() => resolveRuntimeTarget({ FOUNDRY_MODEL_ALIAS: "qwen3-1.7b" })).toThrow(
      "does not identify an exact model variant",
    );
    expect(() => resolveRuntimeTarget({ FOUNDRY_MODEL_ID: "alternate:1" })).toThrow("must be set together");
    expect(
      resolveRuntimeTarget({
        FOUNDRY_MODEL_ID: "alternate-generic-cpu:1",
        FOUNDRY_EXECUTION_PROVIDER: "CPUExecutionProvider",
      }),
    ).toEqual({
      modelId: "alternate-generic-cpu:1",
      executionProvider: "CPUExecutionProvider",
      source: "environment_override",
      stageValidated: false,
    });
  });

  it("reports an incomplete exact override as invalid without loading the default model", async () => {
    const model = new FakeModel(VALIDATED_MODEL_ID, "qwen2.5-1.5b", VALIDATED_EXECUTION_PROVIDER, true);
    const manager = new FakeManager(model);
    const service = createService(manager, { FOUNDRY_MODEL_ID: "alternate:1" });

    const readiness = await service.initialize();

    expect(readiness.status).toBe("configuration_invalid");
    expect(readiness.target).toEqual({
      modelId: "alternate:1",
      executionProvider: "<unset>",
      source: "invalid_environment_override",
      stageValidated: false,
    });
    expect(readiness.detail).toContain("must be set together");
    expect(runtimeBadgeLabel(readiness)).toBe("Invalid environment override");
    expect(manager.catalogLookupIds).toEqual([]);
    expect(model.downloadCalls).toBe(0);
    expect(model.loadCalls).toBe(0);
    await expect(service.prepareOffline()).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "CONFIGURATION_INVALID",
    });
    expect(manager.catalogLookupIds).toEqual([]);
    expect(model.loadCalls).toBe(0);
    await service.shutdown();
  });

  it("reports a rejected alias override as invalid without loading the default model", async () => {
    const model = new FakeModel(VALIDATED_MODEL_ID, "qwen2.5-1.5b", VALIDATED_EXECUTION_PROVIDER, true);
    const manager = new FakeManager(model);
    const service = createService(manager, { FOUNDRY_MODEL_ALIAS: "qwen3-1.7b" });

    const readiness = await service.initialize();

    expect(readiness.status).toBe("configuration_invalid");
    expect(readiness.target).toEqual({
      modelId: "<unset>",
      executionProvider: "<unset>",
      source: "invalid_environment_override",
      stageValidated: false,
    });
    expect(readiness.detail).toContain("FOUNDRY_MODEL_ALIAS is not supported");
    expect(runtimeBadgeLabel(readiness)).toBe("Invalid environment override");
    expect(manager.catalogLookupIds).toEqual([]);
    expect(model.downloadCalls).toBe(0);
    expect(model.loadCalls).toBe(0);
    await expect(service.prepareOffline()).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "CONFIGURATION_INVALID",
    });
    expect(manager.catalogLookupIds).toEqual([]);
    expect(model.loadCalls).toBe(0);
    await service.shutdown();
  });
});

describe("Foundry offline preparation", () => {
  it("resolves the full catalog and downloads the exact default from an empty cache", async () => {
    const model = new FakeModel(VALIDATED_MODEL_ID, "qwen2.5-1.5b", VALIDATED_EXECUTION_PROVIDER, false);
    const manager = new FakeManager(model);
    const service = createService(manager);

    const initial = await service.initialize();
    expect(manager.catalogLookupIds).toEqual([VALIDATED_MODEL_ID]);
    expect(initial.status).toBe("preparation_required");
    expect(initial.model?.id).toBe(VALIDATED_MODEL_ID);
    expect(initial.modelCached).toBe(false);

    const readiness = await service.prepareOffline();
    expect(model.downloadCalls).toBe(1);
    expect(model.loadCalls).toBe(1);
    expect(manager.registrationRequests).toEqual([["WebGpuExecutionProvider"]]);
    expect(readiness.localInferenceReady).toBe(true);
    expect(readiness.model?.id).toBe(VALIDATED_MODEL_ID);
    expect(readiness.model?.executionProvider).toBe(VALIDATED_EXECUTION_PROVIDER);
    expect(readiness.target.stageValidated).toBe(true);
    await service.shutdown();
  });

  it("reports an explicit model download failure", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      "qwen2.5-1.5b",
      VALIDATED_EXECUTION_PROVIDER,
      false,
      new Error("network unavailable"),
    );
    const service = createService(new FakeManager(model));

    await expect(service.prepareOffline()).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "MODEL_DOWNLOAD_FAILED",
    });
    expect(service.readiness.detail).toContain(`Failed to download exact model ${VALIDATED_MODEL_ID}`);
    await service.shutdown();
  });

  it("reports the exact configured model when it is absent from catalog and cache", async () => {
    const model = new FakeModel(
      "different-model-generic-gpu:1",
      "different-model",
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
    const service = createService(new FakeManager(model));

    const readiness = await service.initialize();
    expect(readiness.status).toBe("model_unavailable");
    expect(readiness.detail).toContain(VALIDATED_MODEL_ID);
    await expect(service.prepareOffline()).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "MODEL_UNAVAILABLE",
    });
    await service.shutdown();
  });

  it("reports the exact provider when it is not discoverable", async () => {
    const model = new FakeModel(VALIDATED_MODEL_ID, "qwen2.5-1.5b", VALIDATED_EXECUTION_PROVIDER, true);
    const service = createService(new FakeManager(model, false, false));

    const readiness = await service.initialize();
    expect(readiness.status).toBe("provider_unavailable");
    expect(readiness.detail).toContain(VALIDATED_EXECUTION_PROVIDER);
    await expect(service.prepareOffline()).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "PROVIDER_UNAVAILABLE",
    });
    await service.shutdown();
  });

  it("refuses a configured model whose catalog provider does not match", async () => {
    const model = new FakeModel(VALIDATED_MODEL_ID, "qwen2.5-1.5b", "CPUExecutionProvider", true);
    const service = createService(new FakeManager(model, true));

    const readiness = await service.initialize();
    expect(readiness.status).toBe("provider_unavailable");
    expect(readiness.localInferenceReady).toBe(false);
    await expect(service.prepareOffline()).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "PROVIDER_UNAVAILABLE",
    });
    await service.shutdown();
  });

  it("marks an alternate exact model and provider as an unvalidated override", async () => {
    const model = new FakeModel("alternate-generic-cpu:1", "alternate", "CPUExecutionProvider", true);
    const service = createService(new FakeManager(model), {
      FOUNDRY_MODEL_ID: model.id,
      FOUNDRY_EXECUTION_PROVIDER: "CPUExecutionProvider",
    });

    const readiness = await service.prepareOffline();
    expect(readiness.localInferenceReady).toBe(true);
    expect(readiness.target).toEqual({
      modelId: model.id,
      executionProvider: "CPUExecutionProvider",
      source: "environment_override",
      stageValidated: false,
    });
    expect(runtimeBadgeLabel(readiness)).toContain("Override (not stage-validated)");
    await service.shutdown();
  });
});
