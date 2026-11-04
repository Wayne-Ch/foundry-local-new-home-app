import {
  DeviceType,
  type EpDownloadResult,
  type IModel,
  type ModelInfo,
  type Request,
  type RequestPreflightResult,
  type Response,
} from "foundry-local-sdk";
import { describe, expect, it, vi } from "vitest";
import { createInitialDemoState } from "../src/domain/demo-state";
import { preferredLayoutIntentDelta } from "../src/domain/tool-contract";
import { FoundryLayoutService, type FoundryRuntimeError } from "../src/foundry/foundry-service";
import {
  resolveRuntimeTarget,
  VALIDATED_EXECUTION_PROVIDER,
  VALIDATED_MODEL_ALIAS,
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
    readonly task = "chat-completion",
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
      task: this.task,
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
  disposeCalls = 0;

  async preflightRequest(_request: Request): Promise<RequestPreflightResult> {
    throw new Error("Not used by these tests.");
  }

  async processRequest(_request: Request): Promise<Response> {
    throw new Error("Not used by these tests.");
  }

  undoTurns(_count: number): void {}

  dispose(): void {
    this.disposeCalls += 1;
    this.disposed = true;
  }
}

class GatedSession {
  turnCount = 0;
  disposed = false;
  disposeCalls = 0;
  processCalls = 0;

  constructor(
    readonly toolInput: unknown,
    readonly processGate: Promise<void>,
    readonly processStarted: () => void,
    readonly finishReason: Response["finishReason"] = "stop",
  ) {}

  async preflightRequest(_request: Request): Promise<RequestPreflightResult> {
    return {
      fits: true,
      promptTokens: 50,
      outputReserveTokens: 50,
      requiredTokens: 100,
      contextLimitTokens: 4096,
      deficitTokens: 0,
    };
  }

  async processRequest(_request: Request): Promise<Response> {
    this.processStarted();
    await this.processGate;
    this.processCalls += 1;
    this.turnCount += 1;
    return {
      finishReason: this.finishReason,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      output: [{ type: "text", text: JSON.stringify(this.toolInput) }],
    };
  }

  undoTurns(count: number): void {
    this.turnCount = Math.max(0, this.turnCount - count);
  }

  dispose(): void {
    this.disposeCalls += 1;
    this.disposed = true;
  }
}

class FakeManager {
  readonly catalogLookupIds: string[] = [];
  readonly registrationRequests: string[][] = [];
  providerRegistered: boolean;
  disposed = false;
  disposeCalls = 0;
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
    this.disposeCalls += 1;
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
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
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
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
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
  it("never executes JSON returned with a truncated length finish reason", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
    const manager = new FakeManager(model, true);
    const state = createInitialDemoState();
    const prompt = "Can a Queen bed and a standard desk fit?";
    const session = new GatedSession(
      preferredLayoutIntentDelta(state, prompt),
      Promise.resolve(),
      () => {},
      "length",
    );
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => manager,
      createSession: () => session,
    });
    await service.prepareOffline();

    await expect(service.runTurn(prompt, state)).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "INVALID_TOOL_CALL",
      message: expect.stringContaining("partial JSON is never executed"),
    });
    expect(session.processCalls).toBe(3);
    expect(session.turnCount).toBe(0);
    await service.shutdown();
  });

  it("rolls back the final rejected intent delta before reporting bounded failure", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
    const manager = new FakeManager(model, true);
    const state = createInitialDemoState();
    const prompt = "Can a Queen bed and a standard desk fit?";
    const session = new GatedSession(
      {
        ...preferredLayoutIntentDelta(state, prompt),
        bed: "king",
      },
      Promise.resolve(),
      () => {},
    );
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => manager,
      createSession: () => session,
    });
    await service.prepareOffline();

    await expect(service.runTurn(prompt, state)).rejects.toMatchObject<Partial<FoundryRuntimeError>>({
      code: "INVALID_TOOL_CALL",
    });
    expect(session.processCalls).toBe(3);
    expect(session.turnCount).toBe(0);
    await service.shutdown();
  });

  it("single-flights concurrent initialization and disposes the manager once", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
    const manager = new FakeManager(model);
    const pathsGate = deferred();
    let managerCreateCalls = 0;
    const service = new FoundryLayoutService({
      resolvePaths: async () => {
        await pathsGate.promise;
        return fakePaths;
      },
      createManager: () => {
        managerCreateCalls += 1;
        return manager;
      },
      createSession: () => new FakeSession(),
    });

    const first = service.initialize();
    const second = service.initialize();
    expect(second).toBe(first);
    pathsGate.resolve();

    await Promise.all([first, second]);
    expect(managerCreateCalls).toBe(1);

    await Promise.all([service.shutdown(), service.shutdown()]);
    expect(manager.disposeCalls).toBe(1);
  });

  it("clears a failed initialization flight so a later retry can succeed", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
    const manager = new FakeManager(model);
    let managerCreateCalls = 0;
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => {
        managerCreateCalls += 1;
        if (managerCreateCalls === 1) {
          throw new Error("manager startup failed");
        }
        return manager;
      },
      createSession: () => new FakeSession(),
    });

    const first = service.initialize();
    const second = service.initialize();
    expect(second).toBe(first);
    const failures = await Promise.allSettled([first, second]);
    expect(failures.every((outcome) => outcome.status === "rejected")).toBe(true);
    expect(managerCreateCalls).toBe(1);

    await expect(service.initialize()).resolves.toMatchObject({
      model: { id: VALIDATED_MODEL_ID },
    });
    expect(managerCreateCalls).toBe(2);
    await service.shutdown();
    expect(manager.disposeCalls).toBe(1);
  });

  it("resolves the full catalog and downloads the exact default from an empty cache", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      false,
    );
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
      VALIDATED_MODEL_ALIAS,
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
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
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
    const model = new FakeModel(VALIDATED_MODEL_ID, VALIDATED_MODEL_ALIAS, "CPUExecutionProvider", true);
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

  it("accepts a text-capable coding override after JSON-schema compatibility", async () => {
    const model = new FakeModel(
      "qwen3.5-0.8b-generic-gpu:2",
      "qwen3.5-0.8b",
      VALIDATED_EXECUTION_PROVIDER,
      true,
      null,
      "coding",
    );
    const service = createService(new FakeManager(model, true), {
      FOUNDRY_MODEL_ID: model.id,
      FOUNDRY_EXECUTION_PROVIDER: VALIDATED_EXECUTION_PROVIDER,
    });

    await expect(service.prepareOffline()).resolves.toMatchObject({
      localInferenceReady: true,
      model: {
        id: model.id,
        executionProvider: VALIDATED_EXECUTION_PROVIDER,
      },
      target: {
        source: "environment_override",
        stageValidated: false,
      },
    });
    await service.shutdown();
  });

  it("waits for an active layout request before replacing its native session", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
    const manager = new FakeManager(model, true);
    const state = createInitialDemoState();
    const prompt = "Can a Queen bed and a standard desk fit?";
    const processGate = deferred();
    const processStarted = deferred();
    const sessions: Array<GatedSession | FakeSession> = [];
    const gatedSession = new GatedSession(
      preferredLayoutIntentDelta(state, prompt),
      processGate.promise,
      processStarted.resolve,
    );
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => manager,
      createSession: () => {
        const session = sessions.length === 0 ? gatedSession : new FakeSession();
        sessions.push(session);
        return session;
      },
      operationDrainTimeoutMs: 1_000,
    });
    await service.prepareOffline();

    const turn = service.runTurn(prompt, state);
    const turnOutcome = Promise.allSettled([turn]);
    await processStarted.promise;
    const reset = service.reset();
    await Promise.resolve();
    expect(gatedSession.disposed).toBe(false);

    processGate.resolve();
    expect((await turnOutcome)[0]?.status).toBe("rejected");
    await reset;

    expect(gatedSession.disposeCalls).toBe(1);
    expect(sessions).toHaveLength(2);
    await service.shutdown();
    expect(manager.disposeCalls).toBe(1);
  });

  it("quarantines a timed-out reset until the late turn is rolled back and the session is replaced", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
    const manager = new FakeManager(model, true);
    const state = createInitialDemoState();
    const prompt = "Can a Queen bed and a standard desk fit?";
    const processGate = deferred();
    const processStarted = deferred();
    const gatedSession = new GatedSession(
      preferredLayoutIntentDelta(state, prompt),
      processGate.promise,
      processStarted.resolve,
    );
    const sessions: Array<GatedSession | FakeSession> = [];
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => manager,
      createSession: () => {
        const session = sessions.length === 0 ? gatedSession : new FakeSession();
        sessions.push(session);
        return session;
      },
      operationDrainTimeoutMs: 20,
    });
    await service.prepareOffline();

    const turnOutcome = Promise.allSettled([service.runTurn(prompt, state)]);
    await processStarted.promise;
    await expect(service.reset()).rejects.toThrow("could not safely stop active native operations");
    expect(gatedSession.disposed).toBe(false);
    expect(service.readiness).toMatchObject({
      localInferenceReady: false,
      status: "recovering",
    });
    expect(() => service.runTurn(prompt, state)).toThrow("runtime is quarantined");
    expect(sessions).toHaveLength(1);

    processGate.resolve();
    expect((await turnOutcome)[0]?.status).toBe("rejected");
    await vi.waitFor(() => expect(sessions).toHaveLength(2));
    expect(gatedSession.turnCount).toBe(0);
    expect(gatedSession.disposeCalls).toBe(1);
    expect(service.readiness).toMatchObject({
      localInferenceReady: true,
      status: "ready",
    });
    await service.shutdown();
    expect(manager.disposeCalls).toBe(1);
  });

  it("keeps the runtime quarantined when automatic session replacement fails and recovers on reset", async () => {
    const model = new FakeModel(
      VALIDATED_MODEL_ID,
      VALIDATED_MODEL_ALIAS,
      VALIDATED_EXECUTION_PROVIDER,
      true,
    );
    const manager = new FakeManager(model, true);
    const state = createInitialDemoState();
    const prompt = "Can a Queen bed and a standard desk fit?";
    const processGate = deferred();
    const processStarted = deferred();
    const gatedSession = new GatedSession(
      preferredLayoutIntentDelta(state, prompt),
      processGate.promise,
      processStarted.resolve,
    );
    let sessionCreateCalls = 0;
    const service = new FoundryLayoutService({
      resolvePaths: async () => fakePaths,
      createManager: () => manager,
      createSession: () => {
        sessionCreateCalls += 1;
        if (sessionCreateCalls === 1) {
          return gatedSession;
        }
        if (sessionCreateCalls === 2) {
          throw new Error("replacement session failed");
        }
        return new FakeSession();
      },
      operationDrainTimeoutMs: 20,
    });
    await service.prepareOffline();

    const turnOutcome = Promise.allSettled([service.runTurn(prompt, state)]);
    await processStarted.promise;
    await expect(service.reset()).rejects.toThrow("could not safely stop active native operations");
    processGate.resolve();
    expect((await turnOutcome)[0]?.status).toBe("rejected");

    await vi.waitFor(() =>
      expect(service.readiness).toMatchObject({
        localInferenceReady: false,
        status: "recovery_required",
      }),
    );
    expect(service.readiness.detail).toContain("replacement session failed");
    expect(gatedSession.turnCount).toBe(0);
    expect(gatedSession.disposeCalls).toBe(1);
    expect(() => service.runTurn(prompt, state)).toThrow("No new turns are accepted");

    await Promise.resolve();
    await service.reset();
    expect(sessionCreateCalls).toBe(3);
    expect(service.readiness).toMatchObject({
      localInferenceReady: true,
      status: "ready",
    });
    await service.shutdown();
  });
});
