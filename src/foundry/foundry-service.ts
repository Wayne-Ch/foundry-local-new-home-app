import { randomUUID } from "node:crypto";
import type { EpDownloadResult, EpInfo, FoundryLocalConfig, IModel, ModelInfo } from "foundry-local-sdk";
import {
  AudioSession,
  ChatSession,
  FoundryLocalManager,
  Item,
  ItemQueue,
  Request,
  type RequestPreflightResult,
  type Response,
  type StreamingResponse,
} from "foundry-local-sdk";
import { audioDurationMsFromPcmBytes, StreamingTranscriptAccumulator } from "../audio/audio-contract";
import {
  AUDIO_BYTES_PER_SAMPLE,
  AUDIO_CHANNELS,
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_LANGUAGE,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MAX_PCM_BYTES,
  AUDIO_MIN_DURATION_MS,
  AUDIO_SAMPLE_RATE,
  AUDIO_STREAM_CHUNK_BYTES,
  AUDIO_STREAM_MAX_CHUNKS,
  AUDIO_STREAM_MAX_QUEUED_CHUNKS,
  type AudioMode,
  type AudioModelIdentity,
  type AudioPartialTranscriptEvent,
  type AudioReadiness,
  type AudioStreamChunkResponse,
  type AudioStreamFinishRequest,
  type AudioStreamStartResponse,
  type AudioTranscriptionResult,
  NEMOTRON_AUDIO_MODEL_ALIAS,
  NEMOTRON_AUDIO_MODEL_ID,
  type ValidatedAudioCapture,
  WHISPER_AUDIO_MODEL_ALIAS,
  WHISPER_AUDIO_MODEL_ID,
} from "../audio/audio-types";
import { TempAudioStore, withTemporaryWav } from "../audio/temp-audio-store";
import { compareKnownLayoutOptions } from "../domain/layout-engine";
import {
  type CompareLayoutOptionsInput,
  createIntentDeltaJsonSchema,
  type LayoutIntentDelta,
  parseAndValidateIntentDelta,
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
const MAX_INTENT_OUTPUT_TOKENS = 256;
const DEFAULT_OPERATION_DRAIN_TIMEOUT_MS = 10_000;
const SUPPORTED_LAYOUT_TASKS = new Set(["chat-completion", "coding", "vision-language-chat"]);

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
  processStreamingRequest(request: Request, options?: { readonly signal?: AbortSignal }): StreamingResponse;
  dispose(): void;
}

interface ActiveAudioStream {
  readonly id: string;
  readonly generation: number;
  readonly model: IModel;
  readonly session: FoundryAudioSessionHandle;
  readonly queue: ItemQueue;
  readonly request: Request;
  readonly abortController: AbortController;
  readonly stream: StreamingResponse;
  readonly accumulator: StreamingTranscriptAccumulator;
  readonly startedAt: number;
  readonly onPartial: (event: AudioPartialTranscriptEvent) => void;
  consumePromise: Promise<void>;
  nextSequence: number;
  partialSequence: number;
  totalBytes: number;
  firstPartialMs: number | null;
  stopRequestedAt: number | null;
  streamError: unknown | null;
  cancellationPromise: Promise<void> | null;
  cleanedUp: boolean;
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
  readonly modelIntent: {
    readonly callId: string;
    readonly name: "interpret_layout_intent";
    readonly arguments: string;
    readonly parsed: LayoutIntentDelta;
  };
  readonly toolCall: {
    readonly callId: string;
    readonly name: "compare_layout_options";
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
  readonly performance: {
    readonly totalMs: number;
    readonly geometryMs: number;
    readonly attempts: readonly {
      readonly attempt: number;
      readonly promptBytes: number;
      readonly schemaBytes: number;
      readonly outputBytes: number;
      readonly preflightMs: number;
      readonly generationMs: number;
      readonly validationMs: number;
      readonly promptTokens: number | null;
      readonly completionTokens: number | null;
      readonly finishReason: Response["finishReason"] | "runtime_error";
      readonly accepted: boolean;
    }[];
  };
  readonly planningMode: "json-schema-intent-delta";
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

function supportsLayoutTask(model: IModel): boolean {
  return SUPPORTED_LAYOUT_TASKS.has(model.info.task?.toLowerCase() ?? "");
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
  const streaming = model.id === NEMOTRON_AUDIO_MODEL_ID;
  return {
    alias: model.alias,
    id: model.id,
    deviceType: model.info.runtime?.deviceType ?? model.info.deviceType,
    executionProvider: executionProvider(model),
    fileSizeMb: model.info.fileSizeMb ?? null,
    language: AUDIO_LANGUAGE,
    inputMode: streaming ? "streaming PCM ItemQueue" : "temporary PCM WAV file URI",
  };
}

function audioTarget(mode: AudioMode): {
  readonly id: string;
  readonly alias: string;
} {
  return mode === "nemotron_streaming"
    ? { id: NEMOTRON_AUDIO_MODEL_ID, alias: NEMOTRON_AUDIO_MODEL_ALIAS }
    : { id: WHISPER_AUDIO_MODEL_ID, alias: WHISPER_AUDIO_MODEL_ALIAS };
}

function isSameAudioNativeModel(
  current: IModel,
  currentMode: AudioMode | null,
  candidate: IModel,
  candidateMode: AudioMode,
): boolean {
  if (currentMode !== candidateMode || current.id !== candidate.id) {
    return false;
  }
  return (
    current === candidate ||
    (current.alias === candidate.alias &&
      current.path === candidate.path &&
      executionProvider(current) === executionProvider(candidate))
  );
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
    planningMode: "Runtime-guided intent-delta JSON schema -> app-derived tool invocation",
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
    preferredModelId: NEMOTRON_AUDIO_MODEL_ID,
    fallbackModelId: WHISPER_AUDIO_MODEL_ID,
    activeMode: null,
    fallbackAvailable: true,
    fallbackReason: null,
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
  #audioMode: AudioMode | null = null;
  #activeAudioRequest: Request | null = null;
  #activeAudioStream: ActiveAudioStream | null = null;
  #audioPreparePromise: Promise<AudioReadiness> | null = null;
  #audioPrepareMode: AudioMode | null = null;
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

  prepareAudioOffline(
    mode: AudioMode = "nemotron_streaming",
    onProgress?: (detail: string) => void,
  ): Promise<AudioReadiness> {
    this.#assertAudioLifecycleAvailable();
    if (this.#audioPreparePromise !== null) {
      if (this.#audioPrepareMode !== mode) {
        throw new FoundryAudioError(
          `Audio preparation for ${this.#audioPrepareMode} is already running.`,
          "AUDIO_BUSY",
        );
      }
      if (onProgress !== undefined) {
        this.#audioPrepareProgressListeners.add(onProgress);
      }
      return this.#audioPreparePromise;
    }
    if (this.#audioTranscriptionPromise !== null || this.#activeAudioStream !== null) {
      throw new FoundryAudioError("A local transcription is already running.", "AUDIO_BUSY");
    }
    if (onProgress !== undefined) {
      this.#audioPrepareProgressListeners.add(onProgress);
    }

    const generation = this.#audioGeneration;
    let trackedPromise: Promise<AudioReadiness>;
    this.#audioPrepareMode = mode;
    trackedPromise = this.#prepareAudioOffline(generation, mode).finally(() => {
      if (this.#audioPreparePromise === trackedPromise) {
        this.#audioPreparePromise = null;
        this.#audioPrepareMode = null;
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

    if (this.#audioMode !== "whisper_file") {
      throw new FoundryAudioError(
        "Whisper file transcription is not the active audio mode.",
        "AUDIO_NOT_READY",
      );
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

  async startAudioStream(
    onPartial: (event: AudioPartialTranscriptEvent) => void,
  ): Promise<AudioStreamStartResponse> {
    this.#assertAudioLifecycleAvailable();
    if (this.#activeAudioStream !== null || this.#audioTranscriptionPromise !== null) {
      throw new FoundryAudioError("A local transcription is already running.", "AUDIO_BUSY");
    }
    if (!this.#audioReadiness.localAudioReady || this.#audioMode !== "nemotron_streaming") {
      throw new FoundryAudioError(
        "Prepare the exact Nemotron live model before starting a microphone stream.",
        "AUDIO_NOT_READY",
      );
    }

    const generation = this.#audioGeneration;
    this.#assertAudioOperationCurrent(generation);
    const model = this.#requireAudioModel();
    this.#assertAudioModel(model, "nemotron_streaming");

    let session: FoundryAudioSessionHandle | null = null;
    let queue: ItemQueue | null = null;
    try {
      session = this.#audioSessionFactory(model);
      queue = new ItemQueue();
      const request = new Request()
        .addItem(Item.audioDescriptor("pcm", AUDIO_SAMPLE_RATE, AUDIO_CHANNELS))
        .addItem(queue);
      const abortController = new AbortController();
      const stream = session.processStreamingRequest(request, { signal: abortController.signal });
      const active: ActiveAudioStream = {
        id: randomUUID(),
        generation,
        model,
        session,
        queue,
        request,
        abortController,
        stream,
        accumulator: new StreamingTranscriptAccumulator(),
        startedAt: performance.now(),
        onPartial,
        consumePromise: Promise.resolve(),
        nextSequence: 0,
        partialSequence: 0,
        totalBytes: 0,
        firstPartialMs: null,
        stopRequestedAt: null,
        streamError: null,
        cancellationPromise: null,
        cleanedUp: false,
      };
      active.consumePromise = this.#consumeAudioStream(active);
      this.#activeAudioStream = active;
      this.#activeAudioRequest = request;
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "streaming",
        localAudioReady: false,
        detail: "Nemotron live captions are receiving local PCM audio.",
      };
      return {
        streamId: active.id,
        model: audioModelIdentity(model),
        mode: "nemotron_streaming",
      };
    } catch (error) {
      try {
        queue?.dispose();
      } finally {
        session?.dispose();
      }
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "error",
        localAudioReady: false,
        fallbackAvailable: true,
        fallbackReason: `Nemotron live stream failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`,
        detail: `Nemotron live stream failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      throw new FoundryAudioError(this.#audioReadiness.detail, "AUDIO_TRANSCRIPTION_FAILED", {
        cause: error,
      });
    }
  }

  appendAudioStreamChunk(streamId: string, sequence: number, pcmBytes: Uint8Array): AudioStreamChunkResponse {
    const active = this.#requireAudioStream(streamId);
    this.#assertAudioOperationCurrent(active.generation);
    if (active.stopRequestedAt !== null || active.queue.finished) {
      throw new FoundryAudioError(
        "The live audio stream no longer accepts chunks.",
        "AUDIO_TRANSCRIPTION_FAILED",
      );
    }
    if (sequence !== active.nextSequence) {
      throw new FoundryAudioError(
        `Expected audio chunk ${active.nextSequence}, received ${sequence}.`,
        "AUDIO_TRANSCRIPTION_FAILED",
      );
    }
    if (active.nextSequence >= AUDIO_STREAM_MAX_CHUNKS) {
      throw new FoundryAudioError(
        "Audio stream exceeded the maximum number of stage chunks.",
        "AUDIO_TRANSCRIPTION_FAILED",
      );
    }
    if (active.streamError !== null) {
      throw new FoundryAudioError(
        `The native live audio stream has already failed: ${
          active.streamError instanceof Error ? active.streamError.message : String(active.streamError)
        }`,
        "AUDIO_TRANSCRIPTION_FAILED",
        { cause: active.streamError },
      );
    }
    if (
      pcmBytes.byteLength === 0 ||
      pcmBytes.byteLength > AUDIO_STREAM_CHUNK_BYTES ||
      pcmBytes.byteLength % AUDIO_BYTES_PER_SAMPLE !== 0
    ) {
      throw new FoundryAudioError(
        `Audio chunks must contain 1-${AUDIO_STREAM_CHUNK_BYTES} complete PCM bytes.`,
        "AUDIO_TRANSCRIPTION_FAILED",
      );
    }
    if (active.totalBytes + pcmBytes.byteLength > AUDIO_MAX_PCM_BYTES) {
      throw new FoundryAudioError(
        "Audio stream exceeded the maximum stage duration.",
        "AUDIO_TRANSCRIPTION_FAILED",
      );
    }
    if (active.queue.size >= AUDIO_STREAM_MAX_QUEUED_CHUNKS) {
      throw new FoundryAudioError(
        "Audio stream backpressure capacity was exceeded.",
        "AUDIO_TRANSCRIPTION_FAILED",
      );
    }
    active.queue.push(Item.bytes(pcmBytes.slice()));
    active.totalBytes += pcmBytes.byteLength;
    active.nextSequence += 1;
    return {
      acceptedSequence: sequence,
      totalBytes: active.totalBytes,
    };
  }

  async finishAudioStream(input: AudioStreamFinishRequest): Promise<AudioTranscriptionResult> {
    const active = this.#requireAudioStream(input.streamId);
    this.#assertAudioOperationCurrent(active.generation);
    active.stopRequestedAt = performance.now();
    try {
      if (input.lastSequence !== active.nextSequence - 1) {
        throw new Error(
          `Expected final audio sequence ${active.nextSequence - 1}, received ${input.lastSequence}.`,
        );
      }
      const measuredDuration = audioDurationMsFromPcmBytes(active.totalBytes);
      if (measuredDuration < AUDIO_MIN_DURATION_MS || measuredDuration > AUDIO_MAX_DURATION_MS) {
        throw new Error(`Stream contains ${measuredDuration} ms of PCM audio, outside the stage bounds.`);
      }
      if (measuredDuration !== input.audioDurationMs) {
        throw new Error(
          `Stream duration ${input.audioDurationMs} ms does not match ${active.totalBytes} PCM bytes.`,
        );
      }

      if (!active.queue.finished) {
        active.queue.markFinished();
      }
      await active.consumePromise;
      if (active.streamError !== null) {
        throw active.streamError;
      }
      const response = await active.stream.response;
      this.#assertAudioOperationCurrent(active.generation);
      const result = response.output.find((item) => item.type === "speechResult");
      if (result?.type !== "speechResult" || !result.text.trim()) {
        throw new Error("Nemotron returned no final speech transcript.");
      }
      const transcript = active.accumulator.finalize(result.text.trim()).trim();
      const completedAt = performance.now();
      const transcriptionMs = Math.round(completedAt - active.startedAt);
      const finalizationMs = Math.round(completedAt - active.stopRequestedAt);
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "ready",
        localAudioReady: true,
        detail: `${active.model.id} is ready for live local captions.`,
        lastTranscriptionMs: transcriptionMs,
      };
      return {
        transcript,
        transcriptionMs,
        audioDurationMs: measuredDuration,
        model: audioModelIdentity(active.model),
        mode: "nemotron_streaming",
        transcriptSource: "live_stream_final",
        firstPartialMs: active.firstPartialMs,
        finalizationMs,
        externalEndpointUsed: false,
      };
    } catch (error) {
      await this.#settleAudioStream(active);
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "error",
        localAudioReady: false,
        fallbackAvailable: true,
        fallbackReason: `Nemotron live stream failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        detail: `Nemotron live stream failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      throw new FoundryAudioError(this.#audioReadiness.detail, "AUDIO_TRANSCRIPTION_FAILED", {
        cause: error,
      });
    } finally {
      await this.#cleanupAudioStream(active);
    }
  }

  async cancelAudioStream(streamId: string): Promise<void> {
    const active = this.#activeAudioStream;
    if (active === null || active.id !== streamId) {
      return;
    }
    const cancellation = this.#cancelActiveAudioStream(active);
    try {
      await this.#waitForOperationDrain("audio cancellation", cancellation);
    } catch (error) {
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "error",
        localAudioReady: false,
        fallbackAvailable: true,
        fallbackReason: `Nemotron cancellation did not settle: ${
          error instanceof Error ? error.message : String(error)
        }`,
        detail: `Nemotron cancellation did not settle. Select Reset before starting another voice operation. ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      throw error;
    }
    if (
      active.generation === this.#audioGeneration &&
      !this.#shuttingDown &&
      this.#resetPromise === null &&
      this.#audioResetPromise === null &&
      this.#audioModel === active.model
    ) {
      this.#audioReadiness = {
        ...this.#audioReadiness,
        status: "ready",
        localAudioReady: true,
        detail: `${active.model.id} is ready for live local captions.`,
      };
    }
  }

  async #consumeAudioStream(active: ActiveAudioStream): Promise<void> {
    try {
      for await (const item of active.stream) {
        this.#assertAudioOperationCurrent(active.generation);
        if (item.type !== "speechSegment") {
          continue;
        }
        const text = active.accumulator.push({ kind: item.kind, text: item.text });
        if (!text.trim()) {
          continue;
        }
        if (active.firstPartialMs === null) {
          active.firstPartialMs = Math.round(performance.now() - active.startedAt);
        }
        active.onPartial({
          streamId: active.id,
          sequence: active.partialSequence,
          text,
          firstPartialMs: active.firstPartialMs,
          model: audioModelIdentity(active.model),
          mode: "nemotron_streaming",
          externalEndpointUsed: false,
        });
        active.partialSequence += 1;
      }
    } catch (error) {
      active.streamError = error;
    }
  }

  async #settleAudioStream(active: ActiveAudioStream): Promise<void> {
    if (active.cleanedUp) {
      return;
    }
    active.abortController.abort();
    active.request.cancel();
    if (!active.queue.finished) {
      active.queue.markFinished();
    }
    await Promise.allSettled([active.consumePromise, active.stream.response]);
  }

  #cancelActiveAudioStream(active: ActiveAudioStream): Promise<void> {
    if (active.cleanedUp) {
      return Promise.resolve();
    }
    if (active.cancellationPromise !== null) {
      return active.cancellationPromise;
    }

    let trackedPromise: Promise<void>;
    trackedPromise = (async () => {
      await this.#settleAudioStream(active);
      await this.#cleanupAudioStream(active);
    })().finally(() => {
      if (active.cancellationPromise === trackedPromise) {
        active.cancellationPromise = null;
      }
    });
    active.cancellationPromise = trackedPromise;
    return trackedPromise;
  }

  async #initializeAudio(generation: number, mode: AudioMode): Promise<IModel> {
    this.#assertAudioOperationCurrent(generation);
    const previousFallbackReason = this.#audioReadiness.fallbackReason;
    this.#audioReadiness = {
      ...this.#audioReadiness,
      model: null,
      activeMode: mode,
      fallbackAvailable: true,
      fallbackReason: mode === "whisper_file" ? previousFallbackReason : null,
      modelCached: false,
      localAudioReady: false,
      status: "checking",
      detail: "Inspecting the exact local speech model.",
    };

    try {
      await this.initialize();
      this.#assertAudioOperationCurrent(generation);
      const manager = this.#requireManager();
      const target = audioTarget(mode);
      let candidate: IModel | null = null;
      let publicCatalogError = "";
      try {
        candidate = await manager.catalog.getModelVariant(target.id);
      } catch (error) {
        publicCatalogError = error instanceof Error ? error.message : String(error);
        candidate = (await manager.catalog.getCachedModels()).find((model) => model.id === target.id) ?? null;
      }
      this.#assertAudioOperationCurrent(generation);
      if (candidate === null) {
        const detail = `Exact audio model ${target.id} is unavailable. ${
          publicCatalogError || "It was not returned by the public or cached catalog."
        }`;
        this.#audioReadiness = {
          ...this.#audioReadiness,
          model: null,
          activeMode: mode,
          modelCached: false,
          localAudioReady: false,
          status: "model_unavailable",
          fallbackReason:
            mode === "nemotron_streaming"
              ? `Nemotron is unavailable: ${publicCatalogError || "model not found"}`
              : previousFallbackReason,
          detail,
        };
        throw new FoundryAudioError(detail, "AUDIO_MODEL_UNAVAILABLE");
      }

      this.#audioReadiness = {
        ...this.#audioReadiness,
        model: audioModelIdentity(candidate),
        activeMode: mode,
        modelCached: candidate.isCached,
        localAudioReady: false,
        status: candidate.isCached ? "loading" : "preparation_required",
        detail: candidate.isCached
          ? `${candidate.id} is cached and ready to load.`
          : `${candidate.id} is available but must be downloaded before offline speech input.`,
      };
      this.#assertAudioModel(candidate, mode);
      return candidate;
    } catch (error) {
      if (error instanceof FoundryAudioError && error.code === "AUDIO_NOT_READY") {
        throw error;
      }
      if (error instanceof FoundryAudioError && this.#audioReadiness.status === "model_unavailable") {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      this.#audioReadiness = {
        ...this.#audioReadiness,
        activeMode: mode,
        localAudioReady: false,
        status: "error",
        fallbackAvailable: true,
        fallbackReason:
          mode === "nemotron_streaming" ? `Nemotron preparation failed: ${detail}` : previousFallbackReason,
        detail,
      };
      if (error instanceof FoundryAudioError) {
        throw error;
      }
      throw new FoundryAudioError(detail, "AUDIO_MODEL_UNAVAILABLE", { cause: error });
    }
  }

  async #prepareAudioOffline(generation: number, mode: AudioMode): Promise<AudioReadiness> {
    const candidate = await this.#initializeAudio(generation, mode);
    const model = this.#activeAudioModelFor(mode, candidate) ?? candidate;
    try {
      this.#assertAudioOperationCurrent(generation);
      if (!model.isCached) {
        const sizeMb = model.info.fileSizeMb ?? Number.POSITIVE_INFINITY;
        const autoDownloadLimitMb = mode === "nemotron_streaming" ? 800 : 256;
        if (sizeMb > autoDownloadLimitMb) {
          this.#audioReadiness = {
            ...this.#audioReadiness,
            activeMode: mode,
            localAudioReady: false,
            status: "error",
            fallbackAvailable: true,
            fallbackReason:
              mode === "nemotron_streaming"
                ? `Nemotron download was refused because ${sizeMb} MB exceeds the bounded policy.`
                : this.#audioReadiness.fallbackReason,
            detail: `Refusing to automatically download ${model.id} (${sizeMb} MB).`,
          };
          throw new FoundryAudioError(this.#audioReadiness.detail, "AUDIO_MODEL_DOWNLOAD_FAILED");
        }
        this.#reportAudioPrepareProgress(
          `Downloading ${audioTarget(mode).alias} (${sizeMb} MB) for offline speech input.`,
        );
        try {
          await model.download((percent) =>
            this.#reportAudioPrepareProgress(`Audio model download ${percent.toFixed(1)}%`),
          );
        } catch (error) {
          this.#audioReadiness = {
            ...this.#audioReadiness,
            activeMode: mode,
            localAudioReady: false,
            status: "error",
            fallbackAvailable: true,
            fallbackReason:
              mode === "nemotron_streaming"
                ? `Nemotron download failed: ${error instanceof Error ? error.message : String(error)}`
                : this.#audioReadiness.fallbackReason,
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
        activeMode: mode,
        modelCached: model.isCached,
        localAudioReady: false,
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
          activeMode: mode,
          localAudioReady: false,
          status: "error",
          fallbackAvailable: true,
          fallbackReason:
            mode === "nemotron_streaming"
              ? `Nemotron load failed: ${error instanceof Error ? error.message : String(error)}`
              : this.#audioReadiness.fallbackReason,
          detail: `Failed to load ${model.id}: ${error instanceof Error ? error.message : String(error)}`,
        };
        throw new FoundryAudioError(this.#audioReadiness.detail, "AUDIO_MODEL_LOAD_FAILED", {
          cause: error,
        });
      }

      await this.#activateAudioModel(generation, mode, model);
      const readiness = await this.#refreshAudioReadiness();
      this.#assertAudioOperationCurrent(generation);
      return readiness;
    } catch (error) {
      if (this.#activeAudioModelFor(mode, model) === null) {
        try {
          await this.#discardAudioCandidate(mode, model);
        } catch (cleanupError) {
          const detail = `Audio preparation failed and ${model.id} could not be unloaded: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`;
          this.#audioReadiness = {
            ...this.#audioReadiness,
            activeMode: mode,
            localAudioReady: false,
            status: "error",
            detail,
          };
          throw new FoundryAudioError(detail, "AUDIO_MODEL_LOAD_FAILED", {
            cause: new AggregateError([error, cleanupError]),
          });
        }
      }
      throw error;
    }
  }

  async #activateAudioModel(generation: number, mode: AudioMode, model: IModel): Promise<void> {
    this.#assertAudioOperationCurrent(generation);
    const previous = this.#audioModel;
    const retainPrevious =
      previous !== null && isSameAudioNativeModel(previous, this.#audioMode, model, mode);
    if (previous !== null && !retainPrevious) {
      try {
        if (await previous.isLoaded()) {
          await previous.unload();
        }
      } catch (error) {
        const detail = `Failed to switch to ${model.id} because ${previous.id} could not be unloaded: ${
          error instanceof Error ? error.message : String(error)
        }`;
        this.#audioReadiness = {
          ...this.#audioReadiness,
          activeMode: mode,
          localAudioReady: false,
          status: "error",
          detail,
        };
        throw new FoundryAudioError(detail, "AUDIO_MODEL_LOAD_FAILED", { cause: error });
      }
    }
    this.#assertAudioOperationCurrent(generation);
    this.#audioModel = retainPrevious ? previous : model;
    this.#audioMode = mode;
  }

  #activeAudioModelFor(mode: AudioMode, candidate: IModel): IModel | null {
    const active = this.#audioModel;
    if (active === null || !isSameAudioNativeModel(active, this.#audioMode, candidate, mode)) {
      return null;
    }
    return active;
  }

  async #discardAudioCandidate(mode: AudioMode, model: IModel): Promise<void> {
    if (this.#activeAudioModelFor(mode, model) === null && (await model.isLoaded())) {
      await model.unload();
    }
  }

  async #transcribeAudio(
    capture: ValidatedAudioCapture,
    generation: number,
  ): Promise<AudioTranscriptionResult> {
    if (!this.#audioReadiness.localAudioReady) {
      await this.prepareAudioOffline("whisper_file");
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
        mode: "whisper_file",
        transcriptSource: "whisper_file_final",
        firstPartialMs: null,
        finalizationMs: transcriptionMs,
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
    const turnStarted = performance.now();
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
    let intentDelta: LayoutIntentDelta | null = null;
    let validatedInput: CompareLayoutOptionsInput | null = null;
    const attemptPerformance: FoundryTurnOutcome["performance"]["attempts"][number][] = [];

    for (let attempt = 1; attempt <= MAX_TOOL_ATTEMPTS; attempt += 1) {
      const turnCountBeforeAttempt = session.turnCount;
      onPhase?.("model-planning", `Foundry Local is extracting the intent delta (attempt ${attempt}).`);
      const request = new Request();
      if (this.#systemPromptPending) {
        request.addItem(Item.systemMessage(systemPrompt));
      }
      const correction =
        validationErrors.length === 0
          ? ""
          : `\nREJECTED_DELTA: ${JSON.stringify(validationErrors.at(-1))}\nReturn corrected intent JSON only.`;
      const prompt = `${formatTurnPrompt(userPrompt, state)}${correction}`;
      const schema = JSON.stringify(createIntentDeltaJsonSchema(state, userPrompt));
      request.addItem(Item.userMessage(prompt)).setOptions({
        search: {
          doSample: false,
          temperature: 0,
          seed: 42,
          maxOutputTokens: MAX_INTENT_OUTPUT_TOKENS,
        },
        toolChoice: "none",
        additionalOptions: {
          ...structuredTurnOptions,
          guidance_type: "json_schema",
          guidance_data: schema,
        },
      });

      const preflightStarted = performance.now();
      planningPreflight = await this.#executeLayoutRequest(request, generation, () =>
        session.preflightRequest(request),
      );
      const preflightMs = performance.now() - preflightStarted;
      if (!planningPreflight.fits) {
        throw new FoundryRuntimeError(
          `Request needs ${planningPreflight.requiredTokens} tokens but the context limit is ${planningPreflight.contextLimitTokens}.`,
          "CONTEXT_LIMIT",
        );
      }

      const generationStarted = performance.now();
      let generationMs = 0;
      try {
        planningResponse = await this.#executeLayoutRequest(request, generation, () =>
          session.processRequest(request),
        );
        generationMs = performance.now() - generationStarted;
      } catch (error) {
        generationMs = performance.now() - generationStarted;
        this.#rollbackSessionTurns(session, turnCountBeforeAttempt);
        this.#assertLayoutOperationCurrent(generation);
        const validationError: ToolValidationError = {
          code: "INVALID_SCHEMA",
          message: "The native runtime rejected the generated intent delta before execution.",
          details: [error instanceof Error ? error.message : String(error)],
        };
        validationErrors.push(validationError);
        attemptPerformance.push({
          attempt,
          promptBytes: Buffer.byteLength(prompt, "utf8"),
          schemaBytes: Buffer.byteLength(schema, "utf8"),
          outputBytes: 0,
          preflightMs,
          generationMs,
          validationMs: 0,
          promptTokens: planningPreflight.promptTokens ?? null,
          completionTokens: null,
          finishReason: "runtime_error",
          accepted: false,
        });
        this.#systemPromptPending = state.version === 0;
        if (attempt < MAX_TOOL_ATTEMPTS) {
          continue;
        }
        throw new FoundryRuntimeError(
          `The model produced a runtime-rejected intent delta after ${MAX_TOOL_ATTEMPTS} bounded attempts.`,
          "INVALID_TOOL_CALL",
          { cause: error },
        );
      }
      this.#assertLayoutOperationCurrent(generation);
      this.#systemPromptPending = false;
      if (planningResponse.finishReason !== "stop") {
        const partialArguments = extractDefaultText(planningResponse);
        validationErrors.push({
          code: "INVALID_SCHEMA",
          message:
            planningResponse.finishReason === "length"
              ? "The schema-guided planner hit its output limit; partial JSON is never executed."
              : "The schema-guided planner returned an unexpected finish reason.",
          details: [planningResponse.finishReason],
        });
        attemptPerformance.push({
          attempt,
          promptBytes: Buffer.byteLength(prompt, "utf8"),
          schemaBytes: Buffer.byteLength(schema, "utf8"),
          outputBytes: Buffer.byteLength(partialArguments, "utf8"),
          preflightMs,
          generationMs,
          validationMs: 0,
          promptTokens: planningResponse.usage?.promptTokens ?? planningPreflight.promptTokens ?? null,
          completionTokens: planningResponse.usage?.completionTokens ?? null,
          finishReason: planningResponse.finishReason,
          accepted: false,
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
        attemptPerformance.push({
          attempt,
          promptBytes: Buffer.byteLength(prompt, "utf8"),
          schemaBytes: Buffer.byteLength(schema, "utf8"),
          outputBytes: 0,
          preflightMs,
          generationMs,
          validationMs: 0,
          promptTokens: planningResponse.usage?.promptTokens ?? planningPreflight.promptTokens ?? null,
          completionTokens: planningResponse.usage?.completionTokens ?? null,
          finishReason: planningResponse.finishReason,
          accepted: false,
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
        "The application is validating intent and deriving IDs, state, units, and locked constraints.",
      );
      const validationStarted = performance.now();
      const validation = parseAndValidateIntentDelta(rawArguments, state, userPrompt);
      const validationMs = performance.now() - validationStarted;
      attemptPerformance.push({
        attempt,
        promptBytes: Buffer.byteLength(prompt, "utf8"),
        schemaBytes: Buffer.byteLength(schema, "utf8"),
        outputBytes: Buffer.byteLength(rawArguments, "utf8"),
        preflightMs,
        generationMs,
        validationMs,
        promptTokens: planningResponse.usage?.promptTokens ?? planningPreflight.promptTokens ?? null,
        completionTokens: planningResponse.usage?.completionTokens ?? null,
        finishReason: planningResponse.finishReason,
        accepted: validation.ok,
      });
      if (validation.ok) {
        intentDelta = validation.value.intentDelta;
        validatedInput = validation.value.toolInput;
        break;
      }

      if (process.env.DEBUG_TOOL_CALLS === "1") {
        console.error(
          "Rejected tool call:",
          JSON.stringify({ arguments: rawArguments, error: validation.error }, null, 2),
        );
      }
      validationErrors.push(validation.error);
      if (session.turnCount > turnCountBeforeAttempt) {
        session.undoTurns(session.turnCount - turnCountBeforeAttempt);
      }
      this.#systemPromptPending = state.version === 0;
      if (attempt < MAX_TOOL_ATTEMPTS) {
      }
    }

    this.#assertLayoutOperationCurrent(generation);
    if (
      planningResponse === null ||
      planningPreflight === null ||
      rawArguments === null ||
      intentDelta === null ||
      validatedInput === null
    ) {
      const diagnostics = validationErrors
        .map((error) => `${error.code}: ${error.message} (${error.details.join("; ")})`)
        .join(" | ");
      throw new FoundryRuntimeError(
        `The model did not produce a valid intent delta after ${MAX_TOOL_ATTEMPTS} bounded attempts. ${diagnostics}`,
        "INVALID_TOOL_CALL",
      );
    }

    onPhase?.("geometry-running", "Running deterministic bounded geometry checks.");
    this.#assertLayoutOperationCurrent(generation);
    const geometryStarted = performance.now();
    const toolResult = compareKnownLayoutOptions(validatedInput, state);
    const geometryMs = performance.now() - geometryStarted;
    onPhase?.("model-summarizing", "Rendering an application-evidence response from the typed result.");
    const assistantText = renderApplicationEvidence(toolResult);

    return {
      modelIntent: {
        callId: `layout-intent-${state.version + 1}`,
        name: "interpret_layout_intent",
        arguments: rawArguments,
        parsed: intentDelta,
      },
      toolCall: {
        callId: `layout-plan-${state.version + 1}`,
        name: "compare_layout_options",
        arguments: JSON.stringify(validatedInput),
      },
      validatedInput,
      toolResult,
      assistantText,
      planningPreflight,
      planningResponse,
      summaryResponse: null,
      validationAttempts: attemptPerformance.length,
      validationErrors,
      performance: {
        totalMs: performance.now() - turnStarted,
        geometryMs,
        attempts: attemptPerformance,
      },
      planningMode: "json-schema-intent-delta",
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
    const streamCancellation =
      this.#activeAudioStream === null ? null : this.#cancelActiveAudioStream(this.#activeAudioStream);
    const operations = [
      this.#initializePromise,
      this.#preparePromise,
      this.#turnPromise,
      this.#audioPreparePromise,
      this.#audioTranscriptionPromise,
      streamCancellation,
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
    const streamCancellation =
      this.#activeAudioStream === null ? null : this.#cancelActiveAudioStream(this.#activeAudioStream);
    const operations = [this.#audioPreparePromise, this.#audioTranscriptionPromise, streamCancellation];
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
    if (this.#activeAudioStream !== null) {
      await this.#cancelActiveAudioStream(this.#activeAudioStream);
    }
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
        detail: `Failed to unload ${model?.id ?? this.#audioReadiness.model?.id ?? "audio model"}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      throw error;
    }

    if (this.#audioModel === model) {
      this.#audioModel = null;
    }
    this.#audioMode = null;
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
    if (!supportsLayoutTask(model)) {
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

  #assertAudioModel(model: IModel, mode: AudioMode): void {
    const target = audioTarget(mode);
    if (model.id !== target.id || model.alias !== target.alias) {
      throw new FoundryAudioError(
        `Resolved audio model ${model.id} does not match ${target.id}.`,
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
    const taskSupported = supportsLayoutTask(model);
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
      planningMode: "Runtime-guided intent-delta JSON schema -> app-derived tool invocation",
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
      preferredModelId: NEMOTRON_AUDIO_MODEL_ID,
      fallbackModelId: WHISPER_AUDIO_MODEL_ID,
      activeMode: this.#audioMode,
      fallbackAvailable: true,
      fallbackReason: this.#audioReadiness.fallbackReason,
      modelCached: model.isCached,
      localAudioReady: ready,
      externalEndpointUsed: false,
      maxDurationMs: AUDIO_MAX_DURATION_MS,
      inputFormat: "PCM16LE · 16 kHz · mono",
      status: ready ? "ready" : model.isCached ? "loading" : "preparation_required",
      detail: ready
        ? `${model.id} is loaded through ${AUDIO_EXECUTION_PROVIDER} for ${
            this.#audioMode === "nemotron_streaming" ? "live English captions" : "English speech-to-text"
          }.`
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

  #requireAudioStream(streamId: string): ActiveAudioStream {
    const active = this.#activeAudioStream;
    if (active === null || active.id !== streamId || active.cleanedUp) {
      throw new FoundryAudioError("The live audio stream is not active.", "AUDIO_NOT_READY");
    }
    return active;
  }

  async #cleanupAudioStream(active: ActiveAudioStream): Promise<void> {
    if (active.cleanedUp) {
      return;
    }
    active.cleanedUp = true;
    if (this.#activeAudioStream === active) {
      this.#activeAudioStream = null;
    }
    if (this.#activeAudioRequest === active.request) {
      this.#activeAudioRequest = null;
    }
    try {
      active.queue.dispose();
    } finally {
      active.session.dispose();
    }
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
