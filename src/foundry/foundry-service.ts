import type { EpDownloadResult, EpInfo, FoundryLocalConfig, IModel, ModelInfo } from "foundry-local-sdk";
import {
  AudioSession,
  ChatSession,
  FoundryLocalManager,
  Item,
  Request,
  type RequestPreflightResult,
  type Response,
} from "foundry-local-sdk";
import {
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_LANGUAGE,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MODEL_ALIAS,
  AUDIO_MODEL_ID,
  type AudioModelIdentity,
  type AudioReadiness,
  type AudioTranscriptionResult,
  type ValidatedAudioCapture,
} from "../audio/audio-types";
import { TempAudioStore, withTemporaryWav } from "../audio/temp-audio-store";
import { compareKnownLayoutOptions } from "../domain/layout-engine";
import {
  type CompareLayoutOptionsInput,
  createPlannerJsonSchema,
  parseAndValidateToolInput,
  type ToolValidationError,
} from "../domain/tool-contract";
import type {
  DemoStateSnapshot,
  LayoutToolResult,
  ModelIdentity,
  RuntimeReadiness,
  RuntimeTargetIdentity,
} from "../domain/types";
import { type FoundryPaths, resolveFoundryPaths } from "./paths";
import { formatTurnPrompt, systemPrompt } from "./prompt";
import {
  canonicalExecutionProvider,
  invalidRuntimeTarget,
  RuntimeConfigurationError,
  resolveRuntimeTarget,
  VALIDATED_EXECUTION_PROVIDER,
  VALIDATED_MODEL_ID,
} from "./runtime-config";

const MAX_TOOL_ATTEMPTS = 3;
const DEFAULT_OPERATION_DRAIN_TIMEOUT_MS = 10_000;

interface FoundryCatalogHandle {
  getCachedModels(): Promise<IModel[]>;
  getModelVariant(modelId: string): Promise<IModel>;
}

interface FoundryManagerHandle {
  readonly catalog: FoundryCatalogHandle;
  discoverEps(): EpInfo[];
  downloadAndRegisterEps(
    names: string[],
    progressCallback: (epName: string, percent: number) => void,
  ): Promise<EpDownloadResult>;
  dispose(): void;
}

interface FoundrySessionHandle {
  readonly turnCount: number;
  preflightRequest(request: Request): Promise<RequestPreflightResult>;
  processRequest(request: Request): Promise<Response>;
  undoTurns(count: number): void;
  dispose(): void;
}

interface FoundryAudioSessionHandle {
  processRequest(request: Request): Promise<Response>;
  dispose(): void;
}

export interface FoundryLayoutServiceOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly resolvePaths?: () => Promise<FoundryPaths>;
  readonly createManager?: (config: FoundryLocalConfig) => FoundryManagerHandle;
  readonly createSession?: (model: IModel) => FoundrySessionHandle;
  readonly createAudioSession?: (model: IModel) => FoundryAudioSessionHandle;
  readonly audioTempStore?: TempAudioStore;
  readonly operationDrainTimeoutMs?: number;
}

export interface FoundryTurnOutcome {
  readonly toolCall: {
    readonly callId: string;
    readonly name: string;
    readonly arguments: string;
  };
  readonly validatedInput: CompareLayoutOptionsInput;
  readonly toolResult: LayoutToolResult;
  readonly assistantText: string;
  readonly planningPreflight: RequestPreflightResult;
  readonly planningResponse: Response;
  readonly summaryResponse: Response | null;
  readonly validationAttempts: number;
  readonly validationErrors: readonly ToolValidationError[];
  readonly planningMode: "json-schema-tool-plan";
}

export class FoundryRuntimeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MODEL_UNAVAILABLE"
      | "MODEL_DOWNLOAD_FAILED"
      | "PROVIDER_UNAVAILABLE"
      | "PROVIDER_REGISTRATION_FAILED"
      | "MODEL_LOAD_FAILED"
      | "INVALID_TOOL_CALL"
      | "MODEL_RESPONSE_INVALID"
      | "CONTEXT_LIMIT"
      | "RUNTIME_NOT_READY"
      | "CONFIGURATION_INVALID",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FoundryRuntimeError";
  }
}

class OperationDrainTimeoutError extends FoundryRuntimeError {
  constructor(message: string) {
    super(message, "RUNTIME_NOT_READY");
    this.name = "OperationDrainTimeoutError";
  }
}

export class FoundryAudioError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AUDIO_MODEL_UNAVAILABLE"
      | "AUDIO_MODEL_DOWNLOAD_FAILED"
      | "AUDIO_MODEL_LOAD_FAILED"
      | "AUDIO_NOT_READY"
      | "AUDIO_BUSY"
      | "AUDIO_TRANSCRIPTION_FAILED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FoundryAudioError";
  }
}

function executionProvider(model: IModel): string {
  return canonicalExecutionProvider(
    model.info.runtime?.executionProvider ?? model.info.executionProvider ?? "CPUExecutionProvider",
  );
}

function isCpuExecutionProvider(name: string): boolean {
  return canonicalExecutionProvider(name) === "CPUExecutionProvider";
}

function modelIdentity(model: IModel): ModelIdentity {
  return {
    alias: model.alias,
    id: model.id,
    deviceType: model.info.runtime?.deviceType ?? model.info.deviceType,
    executionProvider: executionProvider(model),
    supportsToolCalling: model.supportsToolCalling === true,
    fileSizeMb: model.info.fileSizeMb ?? null,
  };
}

function audioModelIdentity(model: IModel): AudioModelIdentity {
  return {
    alias: model.alias,
    id: model.id,
    deviceType: model.info.runtime?.deviceType ?? model.info.deviceType,
    executionProvider: executionProvider(model),
    fileSizeMb: model.info.fileSizeMb ?? null,
    language: AUDIO_LANGUAGE,
    inputMode: "temporary PCM WAV file URI",
  };
}

function extractDefaultText(response: Response): string {
  const parts: string[] = [];
  for (const item of response.output) {
    if (item.type === "text" && (item.textType ?? "default") === "default") {
      parts.push(item.text);
      continue;
    }
    if (item.type === "message") {
      if (typeof item.content === "string") {
        parts.push(item.content);
      } else {
        for (const part of item.parts ?? []) {
          if (part.type === "text" && (part.textType ?? "default") === "default") {
            parts.push(part.text);
          }
        }
      }
    }
  }
  return parts.join("").trim();
}

function defaultRuntimeTarget(): RuntimeTargetIdentity {
  return {
    modelId: VALIDATED_MODEL_ID,
    executionProvider: VALIDATED_EXECUTION_PROVIDER,
    source: "built_in_default",
    stageValidated: true,
  };
}

function initialReadiness(
  target: RuntimeTargetIdentity,
  configurationError: string | null,
): RuntimeReadiness {
  return {
    sdkVersion: "2.2.1",
    provider: "Foundry Local in-process SDK",
    planningMode: "Runtime-guided JSON schema -> app tool invocation",
    responseMode: "Application-rendered typed evidence",
    target,
    model: null,
    modelCached: false,
    executionProviderRegistered: false,
    localInferenceReady: false,
    externalEndpointUsed: false,
    nonessentialTelemetryDisabled: true,
    cachePath: "",
    appDataPath: "",
    status: configurationError === null ? "not_initialized" : "configuration_invalid",
    detail: configurationError ?? "Foundry Local has not been initialized.",
  };
}

function initialAudioReadiness(): AudioReadiness {
  return {
    sdkVersion: "2.2.1",
    provider: "Foundry Local in-process SDK",
    model: null,
    modelCached: false,
    localAudioReady: false,
    externalEndpointUsed: false,
    maxDurationMs: AUDIO_MAX_DURATION_MS,
    inputFormat: "PCM16LE · 16 kHz · mono",
    status: "not_initialized",
    detail: "Local speech-to-text has not been initialized.",
    lastTranscriptionMs: null,
  };
}

export class FoundryLayoutService {
  readonly #target: RuntimeTargetIdentity;
  readonly #configurationError: string | null;
  readonly #resolvePaths: () => Promise<FoundryPaths>;
  readonly #createManager: (config: FoundryLocalConfig) => FoundryManagerHandle;
  readonly #sessionFactory: (model: IModel) => FoundrySessionHandle;
  readonly #audioSessionFactory: (model: IModel) => FoundryAudioSessionHandle;
  readonly #operationDrainTimeoutMs: number;
  #audioTempStore: TempAudioStore | null;
  #paths: FoundryPaths | null = null;
  #manager: FoundryManagerHandle | null = null;
  #model: IModel | null = null;
  #session: FoundrySessionHandle | null = null;
  #initializePromise: Promise<RuntimeReadiness> | null = null;
  #preparePromise: Promise<RuntimeReadiness> | null = null;
  #turnPromise: Promise<FoundryTurnOutcome> | null = null;
  #activeLayoutRequest: Request | null = null;
  #layoutResetPromise: Promise<void> | null = null;
  #resetPromise: Promise<void> | null = null;
  #audioModel: IModel | null = null;
  #activeAudioRequest: Request | null = null;
  #audioPreparePromise: Promise<AudioReadiness> | null = null;
  #audioTranscriptionPromise: Promise<AudioTranscriptionResult> | null = null;
  #audioResetPromise: Promise<void> | null = null;
  #shutdownPromise: Promise<void> | null = null;
  #runtimeRecoveryPromise: Promise<void> | null = null;
  #runtimeRecoveryBaseline: RuntimeReadiness | null = null;
  readonly #audioPrepareProgressListeners = new Set<(detail: string) => void>();
  #layoutGeneration = 0;
  #audioGeneration = 0;
  #shuttingDown = false;
  #systemPromptPending = true;
  #readiness: RuntimeReadiness;
  #audioReadiness = initialAudioReadiness();

  constructor(options: FoundryLayoutServiceOptions = {}) {
    const environment = options.environment ?? process.env;
    let target = defaultRuntimeTarget();
    let configurationError: string | null = null;
    try {
      target = resolveRuntimeTarget(environment);
    } catch (error) {
      target = error instanceof RuntimeConfigurationError ? error.target : invalidRuntimeTarget(environment);
      configurationError =
        error instanceof RuntimeConfigurationError
          ? error.message
          : `Invalid Foundry runtime configuration: ${error instanceof Error ? error.message : String(error)}`;
    }

    this.#target = target;
    this.#configurationError = configurationError;
    this.#resolvePaths = options.resolvePaths ?? resolveFoundryPaths;
    this.#createManager = options.createManager ?? ((config) => FoundryLocalManager.create(config));
    this.#sessionFactory = options.createSession ?? ((model) => new ChatSession(model));
    this.#audioSessionFactory = options.createAudioSession ?? ((model) => new AudioSession(model));
    this.#operationDrainTimeoutMs = Math.max(
      1,
      options.operationDrainTimeoutMs ?? DEFAULT_OPERATION_DRAIN_TIMEOUT_MS,
    );
    this.#audioTempStore = options.audioTempStore ?? null;
    this.#readiness = initialReadiness(target, configurationError);
  }

  get readiness(): RuntimeReadiness {
    return this.#readiness;
  }

  get audioReadiness(): AudioReadiness {
    return this.#audioReadiness;
  }

  initialize(): Promise<RuntimeReadiness> {
    if (this.#configurationError !== null) {
      return Promise.resolve(this.#readiness);
    }
    this.#assertRuntimeLifecycleAvailable();
    if (this.#initializePromise !== null) {
      return this.#initializePromise;
    }

    let trackedPromise: Promise<RuntimeReadiness>;
    trackedPromise = this.#initialize().finally(() => {
      if (this.#initializePromise === trackedPromise) {
        this.#initializePromise = null;
      }
    });
    this.#initializePromise = trackedPromise;
    return trackedPromise;
  }

  async #initialize(): Promise<RuntimeReadiness> {
    if (this.#manager !== null) {
      if (this.#model !== null) {
        return this.#refreshReadiness();
      }
      const retryResolution = await this.#resolveConfiguredModel();
      this.#model = retryResolution.model;
      if (this.#model === null) {
        this.#readiness = {
          ...this.#readiness,
          status: "model_unavailable",
          detail: retryResolution.detail,
        };
        return this.#readiness;
      }
      return this.#refreshReadiness();
    }

    this.#readiness = {
      ...this.#readiness,
      status: "checking",
      detail: "Inspecting the local SDK catalog and execution providers.",
    };

    this.#paths = await this.#resolvePaths();
    this.#audioTempStore ??= new TempAudioStore(this.#paths.audioTempDir);
    const audioRecovery = await this.#audioTempStore.recoverOwnedCaptures();
    if (audioRecovery.retained > 0) {
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "error",
        detail: `${audioRecovery.retained} owned temporary audio capture${
          audioRecovery.retained === 1 ? "" : "s"
        } could not be removed at startup and will be retried during cleanup.`,
      };
    }
    try {
      this.#manager = this.#createManager({
        appName: "FoundryLocalNewHomeLayoutDemo",
        appDataDir: this.#paths.appDataDir,
        modelCacheDir: this.#paths.modelCacheDir,
        logsDir: this.#paths.logsDir,
        logLevel: "info",
        disableNonessentialTelemetry: true,
      });
    } catch (error) {
      this.#readiness = {
        ...this.#readiness,
        cachePath: this.#paths.modelCacheDir,
        appDataPath: this.#paths.appDataDir,
        status: "error",
        detail: `Foundry Local manager initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      throw new FoundryRuntimeError(this.#readiness.detail, "RUNTIME_NOT_READY", { cause: error });
    }

    const resolution = await this.#resolveConfiguredModel();
    this.#model = resolution.model;
    if (this.#model === null) {
      this.#readiness = {
        ...this.#readiness,
        cachePath: this.#paths.modelCacheDir,
        appDataPath: this.#paths.appDataDir,
        status: "model_unavailable",
        detail: resolution.detail,
      };
      return this.#readiness;
    }

    return this.#refreshReadiness();
  }

  prepareOffline(onProgress?: (detail: string) => void): Promise<RuntimeReadiness> {
    this.#assertRuntimeLifecycleAvailable();
    if (this.#preparePromise !== null) {
      return this.#preparePromise;
    }

    let trackedPromise: Promise<RuntimeReadiness>;
    trackedPromise = this.#prepareOffline(onProgress).finally(() => {
      if (this.#preparePromise === trackedPromise) {
        this.#preparePromise = null;
      }
    });
    this.#preparePromise = trackedPromise;
    return trackedPromise;
  }

  async #prepareOffline(onProgress?: (detail: string) => void): Promise<RuntimeReadiness> {
    await this.initialize();
    if (this.#configurationError !== null) {
      throw new FoundryRuntimeError(this.#configurationError, "CONFIGURATION_INVALID");
    }
    const manager = this.#requireManager();
    const model = this.#requireModel();
    this.#assertModelMatchesTarget(model);

    if (!model.isCached) {
      onProgress?.(`Downloading exact model ${this.#target.modelId} for offline use.`);
      try {
        await model.download((percent) => onProgress?.(`Model download ${percent.toFixed(1)}%`));
      } catch (error) {
        this.#readiness = {
          ...this.#readiness,
          status: "error",
          detail: `Failed to download exact model ${this.#target.modelId}: ${error instanceof Error ? error.message : String(error)}`,
        };
        throw new FoundryRuntimeError(this.#readiness.detail, "MODEL_DOWNLOAD_FAILED", {
          cause: error,
        });
      }
      if (!model.isCached) {
        this.#readiness = {
          ...this.#readiness,
          status: "error",
          detail: `Model download completed without caching exact model ${this.#target.modelId}.`,
        };
        throw new FoundryRuntimeError(this.#readiness.detail, "MODEL_DOWNLOAD_FAILED");
      }
    }

    const providerInfo = this.#findProviderInfo();
    if (!isCpuExecutionProvider(this.#target.executionProvider) && providerInfo?.isRegistered !== true) {
      if (providerInfo === undefined) {
        this.#readiness = {
          ...this.#readiness,
          status: "provider_unavailable",
          detail: `Configured execution provider ${this.#target.executionProvider} is not discoverable on this device.`,
        };
        throw new FoundryRuntimeError(this.#readiness.detail, "PROVIDER_UNAVAILABLE");
      }

      onProgress?.(`Registering ${providerInfo.name} for offline inference.`);
      let result: EpDownloadResult;
      try {
        result = await manager.downloadAndRegisterEps([providerInfo.name], (name, percent) => {
          onProgress?.(`${name} ${percent.toFixed(1)}%`);
        });
      } catch (error) {
        this.#readiness = {
          ...this.#readiness,
          status: "provider_unavailable",
          detail: `Execution provider ${this.#target.executionProvider} registration failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        throw new FoundryRuntimeError(this.#readiness.detail, "PROVIDER_REGISTRATION_FAILED", {
          cause: error,
        });
      }
      if (!result.success || result.failedEps.length > 0) {
        this.#readiness = {
          ...this.#readiness,
          status: "provider_unavailable",
          detail: `Execution provider ${this.#target.executionProvider} registration failed: ${result.status}`,
        };
        throw new FoundryRuntimeError(this.#readiness.detail, "PROVIDER_REGISTRATION_FAILED");
      }
    }

    await this.#loadModel();
    const readiness = await this.#refreshReadiness();
    if (!readiness.localInferenceReady) {
      throw new FoundryRuntimeError(
        `Configured runtime did not become ready: ${readiness.detail}`,
        "RUNTIME_NOT_READY",
      );
    }
    return readiness;
  }

  prepareAudioOffline(onProgress?: (detail: string) => void): Promise<AudioReadiness> {
    this.#assertAudioLifecycleAvailable();
    if (this.#audioPreparePromise !== null) {
      if (onProgress !== undefined) {
        this.#audioPrepareProgressListeners.add(onProgress);
      }
      return this.#audioPreparePromise;
    }
    if (this.#audioTranscriptionPromise !== null) {
      throw new FoundryAudioError("A local transcription is already running.", "AUDIO_BUSY");
    }
    if (onProgress !== undefined) {
      this.#audioPrepareProgressListeners.add(onProgress);
    }

    const generation = this.#audioGeneration;
    let trackedPromise: Promise<AudioReadiness>;
    trackedPromise = this.#prepareAudioOffline(generation).finally(() => {
      if (this.#audioPreparePromise === trackedPromise) {
        this.#audioPreparePromise = null;
        this.#audioPrepareProgressListeners.clear();
      }
    });
    this.#audioPreparePromise = trackedPromise;
    return trackedPromise;
  }

  async transcribeAudio(capture: ValidatedAudioCapture): Promise<AudioTranscriptionResult> {
    this.#assertAudioLifecycleAvailable();
    if (this.#audioTranscriptionPromise !== null) {
      throw new FoundryAudioError("A local transcription is already running.", "AUDIO_BUSY");
    }

    const generation = this.#audioGeneration;
    const operation = this.#transcribeAudio(capture, generation);
    this.#audioTranscriptionPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.#audioTranscriptionPromise === operation) {
        this.#audioTranscriptionPromise = null;
      }
    }
  }

  async #initializeAudio(generation: number): Promise<AudioReadiness> {
    this.#assertAudioOperationCurrent(generation);
    this.#audioReadiness = {
      ...this.#audioReadiness,
      status: "checking",
      detail: "Inspecting the exact local speech model.",
    };

    try {
      await this.initialize();
      this.#assertAudioOperationCurrent(generation);
      const manager = this.#requireManager();
      if (this.#audioModel === null) {
        let publicCatalogError = "";
        try {
          this.#audioModel = await manager.catalog.getModelVariant(AUDIO_MODEL_ID);
        } catch (error) {
          publicCatalogError = error instanceof Error ? error.message : String(error);
          this.#audioModel =
            (await manager.catalog.getCachedModels()).find((model) => model.id === AUDIO_MODEL_ID) ?? null;
        }
        this.#assertAudioOperationCurrent(generation);
        if (this.#audioModel === null) {
          this.#audioReadiness = {
            ...this.#audioReadiness,
            status: "model_unavailable",
            detail: `Exact audio model ${AUDIO_MODEL_ID} is unavailable. ${publicCatalogError}`,
          };
          return this.#audioReadiness;
        }
      }
      this.#assertAudioModel(this.#audioModel);
      this.#assertAudioOperationCurrent(generation);
      const readiness = await this.#refreshAudioReadiness();
      this.#assertAudioOperationCurrent(generation);
      return readiness;
    } catch (error) {
      if (error instanceof FoundryAudioError && error.code === "AUDIO_NOT_READY") {
        throw error;
      }
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      };
      return this.#audioReadiness;
    }
  }

  async #prepareAudioOffline(generation: number): Promise<AudioReadiness> {
    await this.#initializeAudio(generation);
    this.#assertAudioOperationCurrent(generation);
    const model = this.#requireAudioModel();
    this.#assertAudioModel(model);

    if (!model.isCached) {
      const sizeMb = model.info.fileSizeMb ?? Number.POSITIVE_INFINITY;
      if (sizeMb > 256) {
        throw new FoundryAudioError(
          `Refusing to automatically download ${model.id} (${sizeMb} MB).`,
          "AUDIO_MODEL_DOWNLOAD_FAILED",
        );
      }
      this.#reportAudioPrepareProgress(
        `Downloading ${AUDIO_MODEL_ALIAS} (${sizeMb} MB) for offline speech input.`,
      );
      try {
        await model.download((percent) =>
          this.#reportAudioPrepareProgress(`Audio model download ${percent.toFixed(1)}%`),
        );
      } catch (error) {
        this.#audioReadiness = {
          ...this.#audioReadiness,
          status: "error",
          detail: `Failed to download ${model.id}: ${error instanceof Error ? error.message : String(error)}`,
        };
        throw new FoundryAudioError(this.#audioReadiness.detail, "AUDIO_MODEL_DOWNLOAD_FAILED", {
          cause: error,
        });
      }
      this.#assertAudioOperationCurrent(generation);
    }

    this.#audioReadiness = {
      ...this.#audioReadiness,
      status: "loading",
      detail: `Loading ${model.id} in-process.`,
    };
    try {
      if (!(await model.isLoaded())) {
        await model.load();
      }
      this.#assertAudioOperationCurrent(generation);
    } catch (error) {
      if (error instanceof FoundryAudioError && error.code === "AUDIO_NOT_READY") {
        throw error;
      }
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "error",
        detail: `Failed to load ${model.id}: ${error instanceof Error ? error.message : String(error)}`,
      };
      throw new FoundryAudioError(this.#audioReadiness.detail, "AUDIO_MODEL_LOAD_FAILED", {
        cause: error,
      });
    }

    this.#assertAudioOperationCurrent(generation);
    const readiness = await this.#refreshAudioReadiness();
    this.#assertAudioOperationCurrent(generation);
    return readiness;
  }

  async #transcribeAudio(
    capture: ValidatedAudioCapture,
    generation: number,
  ): Promise<AudioTranscriptionResult> {
    if (!this.#audioReadiness.localAudioReady) {
      await this.prepareAudioOffline();
    }
    this.#assertAudioOperationCurrent(generation);
    if (this.#activeAudioRequest !== null) {
      throw new FoundryAudioError("A local transcription is already running.", "AUDIO_BUSY");
    }

    const model = this.#requireAudioModel();
    const store = this.#requireAudioTempStore();
    const request = new Request();
    this.#activeAudioRequest = request;
    this.#audioReadiness = {
      ...this.#audioReadiness,
      status: "transcribing",
      localAudioReady: false,
      detail: "Transcribing the reviewed microphone capture locally.",
    };

    const started = performance.now();
    try {
      const transcript = await withTemporaryWav(store, capture.pcmBytes, async (filePath) => {
        const session = this.#audioSessionFactory(model);
        try {
          request
            .addItem(Item.audioFromUri(filePath))
            .setOptions({ search: { temperature: 0 }, additionalOptions: { language: AUDIO_LANGUAGE } });
          const response = await session.processRequest(request);
          this.#assertAudioOperationCurrent(generation);
          const result = response.output.find((item) => item.type === "speechResult");
          if (result?.type !== "speechResult" || !result.text.trim()) {
            throw new Error("Foundry Local returned no speech transcript.");
          }
          return result.text.trim();
        } finally {
          session.dispose();
        }
      });
      const transcriptionMs = Math.round(performance.now() - started);
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "ready",
        localAudioReady: true,
        detail: `${model.id} is ready for local microphone transcription.`,
        lastTranscriptionMs: transcriptionMs,
      };
      return {
        transcript,
        transcriptionMs,
        audioDurationMs: capture.durationMs,
        model: audioModelIdentity(model),
        externalEndpointUsed: false,
      };
    } catch (error) {
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "error",
        localAudioReady: false,
        detail: `Local transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      throw new FoundryAudioError(this.#audioReadiness.detail, "AUDIO_TRANSCRIPTION_FAILED", {
        cause: error,
      });
    } finally {
      this.#activeAudioRequest = null;
    }
  }

  runTurn(
    userPrompt: string,
    state: DemoStateSnapshot,
    onPhase?: (phase: string, detail: string) => void,
  ): Promise<FoundryTurnOutcome> {
    this.#assertRuntimeLifecycleAvailable();
    if (this.#turnPromise !== null) {
      return Promise.reject(
        new FoundryRuntimeError("A layout inference request is already running.", "RUNTIME_NOT_READY"),
      );
    }

    const generation = this.#layoutGeneration;
    let trackedPromise: Promise<FoundryTurnOutcome>;
    trackedPromise = this.#runTurn(userPrompt, state, generation, onPhase).finally(() => {
      if (this.#turnPromise === trackedPromise) {
        this.#turnPromise = null;
      }
    });
    this.#turnPromise = trackedPromise;
    return trackedPromise;
  }

  async #runTurn(
    userPrompt: string,
    state: DemoStateSnapshot,
    generation: number,
    onPhase?: (phase: string, detail: string) => void,
  ): Promise<FoundryTurnOutcome> {
    await this.initialize();
    this.#assertLayoutOperationCurrent(generation);
    if (!this.#readiness.localInferenceReady) {
      await this.prepareOffline((detail) => onPhase?.("runtime", detail));
      this.#assertLayoutOperationCurrent(generation);
    }

    const session = this.#requireSession();
    const model = this.#requireModel();
    const structuredTurnOptions = {
      parallel_tool_calls: false,
      ...(model.info.supportsReasoning === true
        ? { chat_template_kwargs: JSON.stringify({ enable_thinking: false }) }
        : {}),
    };
    const validationErrors: ToolValidationError[] = [];
    let planningResponse: Response | null = null;
    let planningPreflight: RequestPreflightResult | null = null;
    let rawArguments: string | null = null;
    let validatedInput: CompareLayoutOptionsInput | null = null;

    for (let attempt = 1; attempt <= MAX_TOOL_ATTEMPTS; attempt += 1) {
      const turnCountBeforeAttempt = session.turnCount;
      onPhase?.("model-planning", `Foundry Local is planning the structured tool call (attempt ${attempt}).`);
      const request = new Request();
      if (this.#systemPromptPending) {
        request.addItem(Item.systemMessage(systemPrompt));
      }
      const correction =
        validationErrors.length === 0
          ? ""
          : `\nPRIOR_TOOL_CALL_REJECTED: ${JSON.stringify(validationErrors.at(-1))}\nReturn a corrected tool call only.`;
      request.addItem(Item.userMessage(`${formatTurnPrompt(userPrompt, state)}${correction}`)).setOptions({
        search: {
          doSample: false,
          temperature: 0,
          seed: 42,
          maxOutputTokens: 1800,
        },
        toolChoice: "none",
        additionalOptions: {
          ...structuredTurnOptions,
          guidance_type: "json_schema",
          guidance_data: JSON.stringify(createPlannerJsonSchema(state, { prompt: userPrompt })),
        },
      });

      planningPreflight = await this.#executeLayoutRequest(request, generation, () =>
        session.preflightRequest(request),
      );
      if (!planningPreflight.fits) {
        throw new FoundryRuntimeError(
          `Request needs ${planningPreflight.requiredTokens} tokens but the context limit is ${planningPreflight.contextLimitTokens}.`,
          "CONTEXT_LIMIT",
        );
      }

      try {
        planningResponse = await this.#executeLayoutRequest(request, generation, () =>
          session.processRequest(request),
        );
      } catch (error) {
        this.#rollbackSessionTurns(session, turnCountBeforeAttempt);
        this.#assertLayoutOperationCurrent(generation);
        validationErrors.push({
          code: "INVALID_SCHEMA",
          message: "The native runtime rejected the generated tool call before execution.",
          details: [error instanceof Error ? error.message : String(error)],
        });
        this.#systemPromptPending = state.version === 0;
        if (attempt < MAX_TOOL_ATTEMPTS) {
          continue;
        }
        throw new FoundryRuntimeError(
          `The model produced a runtime-rejected tool call after ${MAX_TOOL_ATTEMPTS} bounded attempts.`,
          "INVALID_TOOL_CALL",
          { cause: error },
        );
      }
      this.#assertLayoutOperationCurrent(generation);
      this.#systemPromptPending = false;
      if (!["stop", "length"].includes(planningResponse.finishReason)) {
        validationErrors.push({
          code: "INVALID_SCHEMA",
          message: "The schema-guided planner returned an unexpected finish reason.",
          details: [planningResponse.finishReason],
        });
        if (session.turnCount > turnCountBeforeAttempt) {
          session.undoTurns(session.turnCount - turnCountBeforeAttempt);
        }
        this.#systemPromptPending = state.version === 0;
        if (attempt < MAX_TOOL_ATTEMPTS) {
          continue;
        }
        break;
      }
      rawArguments = extractDefaultText(planningResponse);
      if (!rawArguments) {
        validationErrors.push({
          code: "INVALID_SCHEMA",
          message: "The schema-guided planner returned no structured text.",
          details: [],
        });
        if (session.turnCount > turnCountBeforeAttempt) {
          session.undoTurns(session.turnCount - turnCountBeforeAttempt);
        }
        this.#systemPromptPending = state.version === 0;
        if (attempt < MAX_TOOL_ATTEMPTS) {
          continue;
        }
        break;
      }
      onPhase?.(
        "tool-validating",
        "The application is validating IDs, units, state, and locked constraints.",
      );
      const validation = parseAndValidateToolInput(rawArguments, state, userPrompt);
      if (validation.ok) {
        validatedInput = validation.value;
        break;
      }

      if (process.env.DEBUG_TOOL_CALLS === "1") {
        console.error(
          "Rejected tool call:",
          JSON.stringify({ arguments: rawArguments, error: validation.error }, null, 2),
        );
      }
      validationErrors.push(validation.error);
      if (attempt < MAX_TOOL_ATTEMPTS) {
        session.undoTurns(1);
        this.#systemPromptPending = state.version === 0;
      }
    }

    this.#assertLayoutOperationCurrent(generation);
    if (
      planningResponse === null ||
      planningPreflight === null ||
      rawArguments === null ||
      validatedInput === null
    ) {
      const diagnostics = validationErrors
        .map((error) => `${error.code}: ${error.message} (${error.details.join("; ")})`)
        .join(" | ");
      throw new FoundryRuntimeError(
        `The model did not produce a valid tool call after ${MAX_TOOL_ATTEMPTS} bounded attempts. ${diagnostics}`,
        "INVALID_TOOL_CALL",
      );
    }

    onPhase?.("geometry-running", "Running deterministic bounded geometry checks.");
    this.#assertLayoutOperationCurrent(generation);
    const toolResult = compareKnownLayoutOptions(validatedInput, state);
    onPhase?.("model-summarizing", "Rendering an application-evidence response from the typed result.");
    const assistantText = renderApplicationEvidence(toolResult);

    return {
      toolCall: {
        callId: `layout-plan-${state.version + 1}`,
        name: "compare_layout_options",
        arguments: rawArguments,
      },
      validatedInput,
      toolResult,
      assistantText,
      planningPreflight,
      planningResponse,
      summaryResponse: null,
      validationAttempts: validationErrors.length + 1,
      validationErrors,
      planningMode: "json-schema-tool-plan",
    };
  }

  reset(): Promise<void> {
    if (this.#resetPromise !== null) {
      return this.#resetPromise;
    }
    if (this.#runtimeRecoveryPromise !== null) {
      return this.#runtimeRecoveryPromise;
    }
    if (this.#shuttingDown && this.#shutdownPromise !== null) {
      return this.#shutdownPromise;
    }
    return this.#startReset();
  }

  resetConversation(): Promise<void> {
    if (this.#resetPromise !== null) {
      return this.#resetPromise;
    }
    if (this.#layoutResetPromise !== null) {
      return this.#layoutResetPromise;
    }
    if (this.#runtimeRecoveryPromise !== null) {
      return this.#runtimeRecoveryPromise;
    }
    if (this.#shuttingDown && this.#shutdownPromise !== null) {
      return this.#shutdownPromise;
    }

    this.#layoutGeneration += 1;
    this.#activeLayoutRequest?.cancel();
    const operations = [this.#initializePromise, this.#preparePromise, this.#turnPromise];
    let trackedPromise: Promise<void>;
    trackedPromise = this.#resetConversation(operations).finally(() => {
      if (this.#layoutResetPromise === trackedPromise) {
        this.#layoutResetPromise = null;
      }
    });
    this.#layoutResetPromise = trackedPromise;
    return trackedPromise;
  }

  resetAudio(): Promise<void> {
    if (this.#resetPromise !== null) {
      return this.#resetPromise;
    }
    if (this.#audioResetPromise !== null) {
      return this.#audioResetPromise;
    }
    if (this.#runtimeRecoveryPromise !== null) {
      return this.#runtimeRecoveryPromise;
    }
    if (this.#shuttingDown && this.#shutdownPromise !== null) {
      return this.#shutdownPromise;
    }
    return this.#startAudioReset();
  }

  #startReset(): Promise<void> {
    this.#layoutGeneration += 1;
    this.#audioGeneration += 1;
    this.#activeLayoutRequest?.cancel();
    this.#activeAudioRequest?.cancel();
    const operations = [
      this.#initializePromise,
      this.#preparePromise,
      this.#turnPromise,
      this.#audioPreparePromise,
      this.#audioTranscriptionPromise,
      this.#layoutResetPromise,
      this.#audioResetPromise,
    ];
    let trackedPromise: Promise<void>;
    trackedPromise = this.#resetAll(operations).finally(() => {
      if (this.#resetPromise === trackedPromise) {
        this.#resetPromise = null;
      }
    });
    this.#resetPromise = trackedPromise;
    return trackedPromise;
  }

  #startAudioReset(): Promise<void> {
    this.#audioGeneration += 1;
    this.#activeAudioRequest?.cancel();
    const operations = [this.#audioPreparePromise, this.#audioTranscriptionPromise];
    let trackedPromise: Promise<void>;
    trackedPromise = this.#resetAudio(operations).finally(() => {
      if (this.#audioResetPromise === trackedPromise) {
        this.#audioResetPromise = null;
      }
    });
    this.#audioResetPromise = trackedPromise;
    return trackedPromise;
  }

  async shutdown(): Promise<void> {
    if (this.#shutdownPromise !== null) {
      return this.#shutdownPromise;
    }

    this.#shuttingDown = true;
    const operation = this.#shutdown();
    this.#shutdownPromise = operation;
    try {
      await operation;
    } catch (error) {
      if (this.#shutdownPromise === operation) {
        this.#shutdownPromise = null;
      }
      throw error;
    }
  }

  async #resetAll(operations: readonly (Promise<unknown> | null)[]): Promise<void> {
    const drain = this.#captureOperationDrain(operations);
    try {
      await this.#waitForOperationDrain("reset", drain);
    } catch (error) {
      if (error instanceof OperationDrainTimeoutError && drain !== null) {
        this.#startAutomaticRuntimeRecovery(error, drain, async () => {
          await this.#resetAudioResources();
          this.#resetConversationResources();
        });
      }
      throw error;
    }
    try {
      await this.#resetAudioResources();
      this.#resetConversationResources();
      this.#completeRuntimeRecovery();
    } catch (error) {
      this.#markRuntimeRecoveryFailure(error);
      throw error;
    }
  }

  async #resetConversation(operations: readonly (Promise<unknown> | null)[]): Promise<void> {
    const drain = this.#captureOperationDrain(operations);
    try {
      await this.#waitForOperationDrain("conversation reset", drain);
    } catch (error) {
      if (error instanceof OperationDrainTimeoutError && drain !== null) {
        this.#startAutomaticRuntimeRecovery(error, drain, () => {
          this.#resetConversationResources();
        });
      }
      throw error;
    }
    try {
      this.#resetConversationResources();
      this.#completeRuntimeRecovery();
    } catch (error) {
      this.#markRuntimeRecoveryFailure(error);
      throw error;
    }
  }

  async #resetAudio(operations: readonly (Promise<unknown> | null)[]): Promise<void> {
    await this.#waitForOperationDrain("audio reset", this.#captureOperationDrain(operations));
    await this.#resetAudioResources();
  }

  async #resetAudioResources(): Promise<void> {
    this.#activeAudioRequest?.cancel();
    await this.#audioTempStore?.cleanupAll();

    const model = this.#audioModel;
    try {
      if (model !== null && (await model.isLoaded())) {
        await model.unload();
      }
    } catch (error) {
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "error",
        localAudioReady: false,
        detail: `Failed to unload ${model?.id ?? AUDIO_MODEL_ID}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      throw error;
    }

    if (this.#audioModel === model) {
      this.#audioModel = null;
    }
    this.#audioReadiness = initialAudioReadiness();
  }

  async #shutdown(): Promise<void> {
    try {
      await (this.#runtimeRecoveryPromise ?? this.#resetPromise ?? this.#startReset());
    } catch (error) {
      await this.#reportShutdownFailure(error);
    }
    this.#disposeConversationSession();
    if (this.#model !== null) {
      if (await this.#model.isLoaded()) {
        await this.#model.unload();
      }
      this.#model = null;
    }
    const manager = this.#manager;
    this.#manager = null;
    manager?.dispose();
    this.#readiness = {
      ...this.#readiness,
      localInferenceReady: false,
      status: this.#configurationError === null ? "not_initialized" : "configuration_invalid",
      detail: this.#configurationError ?? "Foundry Local was shut down.",
    };
  }

  async #resolveConfiguredModel(): Promise<{
    readonly model: IModel | null;
    readonly detail: string;
  }> {
    const manager = this.#requireManager();
    let publicCatalogError = "";
    try {
      const model = await manager.catalog.getModelVariant(this.#target.modelId);
      return {
        model,
        detail: `Resolved exact configured model ${this.#target.modelId} from the public catalog.`,
      };
    } catch (error) {
      publicCatalogError = error instanceof Error ? error.message : String(error);
    }

    try {
      const cachedModel = (await manager.catalog.getCachedModels()).find(
        (model) => model.id === this.#target.modelId,
      );
      if (cachedModel !== undefined) {
        return {
          model: cachedModel,
          detail: `Resolved exact configured model ${this.#target.modelId} from the local cache after the public catalog lookup failed.`,
        };
      }
    } catch (error) {
      return {
        model: null,
        detail: `Exact configured model ${this.#target.modelId} could not be resolved. Public catalog error: ${publicCatalogError}. Local cache error: ${error instanceof Error ? error.message : String(error)}.`,
      };
    }

    return {
      model: null,
      detail: `Exact configured model ${this.#target.modelId} is absent from both the public catalog and local cache. Public catalog error: ${publicCatalogError}.`,
    };
  }

  #assertModelMatchesTarget(model: IModel): void {
    if (model.id !== this.#target.modelId) {
      throw new FoundryRuntimeError(
        `Resolved model ${model.id} does not match configured exact model ${this.#target.modelId}.`,
        "MODEL_UNAVAILABLE",
      );
    }
    if (model.supportsToolCalling !== true) {
      throw new FoundryRuntimeError(
        `Configured exact model ${model.id} does not advertise tool calling.`,
        "MODEL_UNAVAILABLE",
      );
    }
    if (!["chat-completion", "coding"].includes(model.info.task?.toLowerCase() ?? "")) {
      throw new FoundryRuntimeError(
        `Configured exact model ${model.id} does not expose a supported chat task.`,
        "MODEL_UNAVAILABLE",
      );
    }
    const actualProvider = executionProvider(model);
    if (actualProvider !== this.#target.executionProvider) {
      throw new FoundryRuntimeError(
        `Configured exact model ${model.id} uses ${actualProvider}; expected ${this.#target.executionProvider}.`,
        "PROVIDER_UNAVAILABLE",
      );
    }
  }

  #assertAudioModel(model: IModel): void {
    if (model.id !== AUDIO_MODEL_ID || model.alias !== AUDIO_MODEL_ALIAS) {
      throw new FoundryAudioError(
        `Resolved audio model ${model.id} does not match ${AUDIO_MODEL_ID}.`,
        "AUDIO_MODEL_UNAVAILABLE",
      );
    }
    if (executionProvider(model) !== AUDIO_EXECUTION_PROVIDER) {
      throw new FoundryAudioError(
        `Audio model ${model.id} must use ${AUDIO_EXECUTION_PROVIDER}.`,
        "AUDIO_MODEL_UNAVAILABLE",
      );
    }
    if (model.info.task?.toLowerCase() !== "automatic-speech-recognition") {
      throw new FoundryAudioError(
        `Audio model ${model.id} is not an automatic-speech-recognition model.`,
        "AUDIO_MODEL_UNAVAILABLE",
      );
    }
  }

  async #loadModel(): Promise<void> {
    const model = this.#requireModel();
    this.#assertModelMatchesTarget(model);
    this.#readiness = {
      ...this.#readiness,
      status: "loading",
      detail: `Loading ${model.id} in-process.`,
    };
    try {
      if (!(await model.isLoaded())) {
        await model.load();
      }
      this.#createSession();
    } catch (error) {
      this.#readiness = {
        ...this.#readiness,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      };
      throw new FoundryRuntimeError(`Failed to load ${model.id}.`, "MODEL_LOAD_FAILED", { cause: error });
    }
  }

  async #executeLayoutRequest<T>(
    request: Request,
    generation: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.#assertLayoutOperationCurrent(generation);
    this.#activeLayoutRequest = request;
    try {
      const result = await operation();
      this.#assertLayoutOperationCurrent(generation);
      return result;
    } finally {
      if (this.#activeLayoutRequest === request) {
        this.#activeLayoutRequest = null;
      }
    }
  }

  #createSession(): void {
    const model = this.#requireModel();
    this.#disposeConversationSession();
    this.#session = this.#sessionFactory(model);
    this.#systemPromptPending = true;
  }

  #resetConversationResources(): void {
    this.#disposeConversationSession();
    this.#systemPromptPending = true;
    const readiness = this.#runtimeRecoveryBaseline ?? this.#readiness;
    if (!this.#shuttingDown && this.#model !== null && readiness.localInferenceReady) {
      this.#session = this.#sessionFactory(this.#model);
    }
  }

  #disposeConversationSession(): void {
    const session = this.#session;
    this.#session = null;
    session?.dispose();
  }

  #captureOperationDrain(operations: readonly (Promise<unknown> | null)[]): Promise<void> | null {
    const activeOperations = operations.filter(
      (operation): operation is Promise<unknown> => operation !== null,
    );
    if (activeOperations.length === 0) {
      return null;
    }
    return Promise.allSettled(activeOperations).then(() => undefined);
  }

  async #waitForOperationDrain(label: string, drain: Promise<void> | null): Promise<void> {
    if (drain === null) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new OperationDrainTimeoutError(
            `${label} could not safely stop active native operations within ${this.#operationDrainTimeoutMs} ms.`,
          ),
        );
      }, this.#operationDrainTimeoutMs);
    });

    try {
      await Promise.race([drain, timedOut]);
    } finally {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
    }
  }

  #startAutomaticRuntimeRecovery(
    timeoutError: OperationDrainTimeoutError,
    drain: Promise<void>,
    resetResources: () => Promise<void> | void,
  ): void {
    this.#enterRuntimeRecovery(timeoutError);
    if (this.#runtimeRecoveryPromise !== null) {
      return;
    }

    let trackedPromise: Promise<void>;
    trackedPromise = drain
      .then(async () => {
        await resetResources();
        this.#completeRuntimeRecovery();
      })
      .catch((error: unknown) => {
        this.#markRuntimeRecoveryFailure(error);
        throw error;
      })
      .finally(() => {
        if (this.#runtimeRecoveryPromise === trackedPromise) {
          this.#runtimeRecoveryPromise = null;
        }
      });
    this.#runtimeRecoveryPromise = trackedPromise;
    void trackedPromise.catch(() => undefined);
  }

  #enterRuntimeRecovery(error: OperationDrainTimeoutError): void {
    this.#runtimeRecoveryBaseline ??= this.#readiness;
    this.#readiness = {
      ...this.#readiness,
      localInferenceReady: false,
      status: "recovering",
      detail: `${error.message} The runtime is quarantined until the captured operation settles and the chat session is replaced.`,
    };
  }

  #completeRuntimeRecovery(): void {
    if (this.#runtimeRecoveryBaseline === null) {
      return;
    }
    this.#readiness = this.#runtimeRecoveryBaseline;
    this.#runtimeRecoveryBaseline = null;
  }

  #markRuntimeRecoveryFailure(error: unknown): void {
    if (this.#runtimeRecoveryBaseline === null) {
      return;
    }
    this.#readiness = {
      ...this.#readiness,
      localInferenceReady: false,
      status: "recovery_required",
      detail: `Automatic reset recovery failed: ${
        error instanceof Error ? error.message : String(error)
      }. No new turns are accepted; select Reset to retry session replacement.`,
    };
  }

  async #reportShutdownFailure(error: unknown): Promise<never> {
    let cleanupError: unknown = null;
    try {
      await this.#audioTempStore?.cleanupAll();
    } catch (failure) {
      cleanupError = failure;
    }

    const pendingCaptures = this.#audioTempStore?.activeCount ?? 0;
    if (pendingCaptures > 0 || cleanupError !== null) {
      const detail = `${pendingCaptures} owned temporary audio ${
        pendingCaptures === 1 ? "capture remains" : "captures remain"
      } for next-launch recovery in the dedicated audio temp directory.`;
      this.#audioReadiness = {
        ...this.#audioReadiness,
        localAudioReady: false,
        status: "error",
        detail: `Foundry Local shutdown was not clean. ${detail}`,
      };
      throw new AggregateError(
        cleanupError === null ? [error] : [error, cleanupError],
        `Foundry Local shutdown was not clean. ${detail}`,
      );
    }
    throw error;
  }

  #findProviderInfo(): EpInfo | undefined {
    const manager = this.#requireManager();
    return manager
      .discoverEps()
      .find((provider) => canonicalExecutionProvider(provider.name) === this.#target.executionProvider);
  }

  async #refreshReadiness(): Promise<RuntimeReadiness> {
    const paths = this.#paths;
    const model = this.#model;
    if (paths === null || model === null) {
      return this.#readiness;
    }

    const actualProvider = executionProvider(model);
    const idMatches = model.id === this.#target.modelId;
    const providerMatches = actualProvider === this.#target.executionProvider;
    const toolCapable = model.supportsToolCalling === true;
    const taskSupported = ["chat-completion", "coding"].includes(model.info.task?.toLowerCase() ?? "");
    const cpuProvider = isCpuExecutionProvider(this.#target.executionProvider);
    const providerInfo = cpuProvider ? undefined : this.#findProviderInfo();
    const providerDiscoverable = cpuProvider || providerInfo !== undefined;
    const providerRegistered = cpuProvider || providerInfo?.isRegistered === true;
    const loaded = await model.isLoaded();
    const ready =
      idMatches &&
      providerMatches &&
      toolCapable &&
      taskSupported &&
      model.isCached &&
      providerRegistered &&
      loaded &&
      this.#session !== null;

    let status: RuntimeReadiness["status"];
    let detail: string;
    if (!idMatches) {
      status = "model_unavailable";
      detail = `Resolved model ${model.id} does not match configured exact model ${this.#target.modelId}.`;
    } else if (!toolCapable) {
      status = "model_unavailable";
      detail = `Configured exact model ${model.id} does not advertise tool calling.`;
    } else if (!taskSupported) {
      status = "model_unavailable";
      detail = `Configured exact model ${model.id} does not expose a supported chat task.`;
    } else if (!providerMatches) {
      status = "provider_unavailable";
      detail = `Configured exact model ${model.id} uses ${actualProvider}; expected ${this.#target.executionProvider}.`;
    } else if (!providerDiscoverable) {
      status = "provider_unavailable";
      detail = `Configured execution provider ${this.#target.executionProvider} is not discoverable on this device.`;
    } else if (!model.isCached) {
      status = "preparation_required";
      detail = `Exact model ${model.id} is available in the public catalog but is not cached. Prepare offline to download it once.`;
    } else if (!providerRegistered) {
      status = "preparation_required";
      detail = `${this.#target.executionProvider} is discoverable but must be registered before offline inference.`;
    } else if (!loaded || this.#session === null) {
      status = "loading";
      detail = `${model.id} is cached with ${this.#target.executionProvider} registered and is ready to load.`;
    } else {
      status = "ready";
      detail = `${model.id} is loaded through ${actualProvider} with no external inference endpoint. Runtime target: ${
        this.#target.stageValidated
          ? "stage-validated configuration"
          : "explicit environment override, not stage-validated"
      }.`;
    }

    this.#readiness = {
      sdkVersion: "2.2.1",
      provider: "Foundry Local in-process SDK",
      planningMode: "Runtime-guided JSON schema -> app tool invocation",
      responseMode: "Application-rendered typed evidence",
      target: this.#target,
      model: modelIdentity(model),
      modelCached: model.isCached,
      executionProviderRegistered: providerRegistered,
      localInferenceReady: ready,
      externalEndpointUsed: false,
      nonessentialTelemetryDisabled: true,
      cachePath: paths.modelCacheDir,
      appDataPath: paths.appDataDir,
      status,
      detail,
    };
    return this.#readiness;
  }

  async #refreshAudioReadiness(): Promise<AudioReadiness> {
    const model = this.#audioModel;
    if (model === null) {
      return this.#audioReadiness;
    }
    const loaded = await model.isLoaded();
    const ready = model.isCached && loaded;
    this.#audioReadiness = {
      sdkVersion: "2.2.1",
      provider: "Foundry Local in-process SDK",
      model: audioModelIdentity(model),
      modelCached: model.isCached,
      localAudioReady: ready,
      externalEndpointUsed: false,
      maxDurationMs: AUDIO_MAX_DURATION_MS,
      inputFormat: "PCM16LE · 16 kHz · mono",
      status: ready ? "ready" : model.isCached ? "loading" : "preparation_required",
      detail: ready
        ? `${model.id} is loaded through ${AUDIO_EXECUTION_PROVIDER} for English speech-to-text.`
        : model.isCached
          ? `${model.id} is cached and ready to load.`
          : `${model.id} is available but must be downloaded before offline speech input.`,
      lastTranscriptionMs: this.#audioReadiness.lastTranscriptionMs,
    };
    return this.#audioReadiness;
  }

  #reportAudioPrepareProgress(detail: string): void {
    for (const listener of this.#audioPrepareProgressListeners) {
      listener(detail);
    }
  }

  #assertAudioLifecycleAvailable(): void {
    if (this.#shuttingDown) {
      throw new FoundryAudioError("Audio runtime shutdown is in progress.", "AUDIO_NOT_READY");
    }
    if (
      this.#resetPromise !== null ||
      this.#audioResetPromise !== null ||
      this.#runtimeRecoveryBaseline !== null
    ) {
      throw new FoundryAudioError("Audio runtime reset is in progress.", "AUDIO_NOT_READY");
    }
  }

  #assertAudioOperationCurrent(generation: number): void {
    if (
      generation !== this.#audioGeneration ||
      this.#resetPromise !== null ||
      this.#audioResetPromise !== null ||
      this.#runtimeRecoveryBaseline !== null ||
      this.#shuttingDown
    ) {
      throw new FoundryAudioError("Audio operation was superseded by reset or shutdown.", "AUDIO_NOT_READY");
    }
  }

  #assertRuntimeLifecycleAvailable(): void {
    if (this.#shuttingDown) {
      throw new FoundryRuntimeError("Foundry Local shutdown is in progress.", "RUNTIME_NOT_READY");
    }
    if (
      this.#resetPromise !== null ||
      this.#layoutResetPromise !== null ||
      this.#runtimeRecoveryBaseline !== null
    ) {
      throw new FoundryRuntimeError(
        this.#runtimeRecoveryBaseline === null
          ? "Foundry Local reset is in progress."
          : this.#readiness.detail,
        "RUNTIME_NOT_READY",
      );
    }
  }

  #assertLayoutOperationCurrent(generation: number): void {
    if (!this.#isLayoutOperationCurrent(generation)) {
      throw new FoundryRuntimeError(
        "Layout operation was superseded by reset or shutdown.",
        "RUNTIME_NOT_READY",
      );
    }
  }

  #isLayoutOperationCurrent(generation: number): boolean {
    return !(
      generation !== this.#layoutGeneration ||
      this.#resetPromise !== null ||
      this.#layoutResetPromise !== null ||
      this.#runtimeRecoveryBaseline !== null ||
      this.#shuttingDown
    );
  }

  #rollbackSessionTurns(session: FoundrySessionHandle, turnCountBeforeAttempt: number): void {
    if (session.turnCount > turnCountBeforeAttempt) {
      session.undoTurns(session.turnCount - turnCountBeforeAttempt);
    }
  }

  #requireManager(): FoundryManagerHandle {
    if (this.#manager === null) {
      throw new FoundryRuntimeError("Foundry Local manager is not initialized.", "RUNTIME_NOT_READY");
    }
    return this.#manager;
  }

  #requireModel(): IModel {
    if (this.#model === null) {
      throw new FoundryRuntimeError(this.#readiness.detail, "MODEL_UNAVAILABLE");
    }
    return this.#model;
  }

  #requireSession(): FoundrySessionHandle {
    if (this.#session === null) {
      throw new FoundryRuntimeError("Foundry Local chat session is not ready.", "RUNTIME_NOT_READY");
    }
    return this.#session;
  }

  #requireAudioModel(): IModel {
    if (this.#audioModel === null) {
      throw new FoundryAudioError(this.#audioReadiness.detail, "AUDIO_MODEL_UNAVAILABLE");
    }
    return this.#audioModel;
  }

  #requireAudioTempStore(): TempAudioStore {
    if (this.#audioTempStore === null) {
      throw new FoundryAudioError("Audio temporary storage is not initialized.", "AUDIO_NOT_READY");
    }
    return this.#audioTempStore;
  }
}

function renderApplicationEvidence(result: LayoutToolResult): string {
  if (result.status === "feasible") {
    const selected = result.feasibleOptions.find((option) => option.id === result.selectedOptionId);
    return [
      "Application evidence:",
      selected?.label ?? "The selected known option",
      "passes every locked deterministic check.",
      `Preference interpreted: ${result.changedPreference}`,
    ].join(" ");
  }
  if (result.status === "clarification_required") {
    return `Application evidence: geometry did not run. Missing verified facts: ${result.unknowns.join(", ")}.`;
  }
  const evidenceOption = result.rejectedOptions.find((option) => option.id === result.evidenceOptionId);
  const conflictText =
    result.aggregateConflicts.length > 0
      ? `Across the ${result.rejectedOptions.length} evaluated rejected option${
          result.rejectedOptions.length === 1 ? "" : "s"
        }, deterministic reasons included: ${result.aggregateConflicts
          .map((conflict) => conflict.message)
          .join(" ")} ${
          evidenceOption === undefined
            ? ""
            : `The UI preview is ${evidenceOption.label} and shows only that option's checks and conflicts.`
        }`
      : (result.noResultReason?.message ?? "No bounded known option is feasible.");
  const choices = result.noResultReason?.preferencesThatMayChange.join(", ") ?? "a locked preference";
  return `Application evidence: no feasible known option. ${conflictText} Which preference may change: ${choices}?`;
}

export function summarizeModelInfo(info: ModelInfo): string {
  return `${info.alias} · ${info.deviceType} · ${canonicalExecutionProvider(
    info.runtime?.executionProvider ?? info.executionProvider ?? "unknown EP",
  )}`;
}
