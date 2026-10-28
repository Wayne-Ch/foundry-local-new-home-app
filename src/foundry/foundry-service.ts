import type { IModel, ModelInfo } from "foundry-local-sdk";
import {
  ChatSession,
  FoundryLocalManager,
  Item,
  Request,
  type RequestPreflightResult,
  type Response,
} from "foundry-local-sdk";
import { compareKnownLayoutOptions } from "../domain/layout-engine";
import {
  type CompareLayoutOptionsInput,
  createPlannerJsonSchema,
  parseAndValidateToolInput,
  type ToolValidationError,
} from "../domain/tool-contract";
import type { DemoStateSnapshot, LayoutToolResult, ModelIdentity, RuntimeReadiness } from "../domain/types";
import { type FoundryPaths, resolveFoundryPaths } from "./paths";
import { formatTurnPrompt, systemPrompt } from "./prompt";

const DEFAULT_MODEL_ALIASES = ["qwen2.5-1.5b", "qwen3-1.7b", "qwen3-0.6b", "qwen2.5-0.5b"] as const;
const MAX_TOOL_ATTEMPTS = 3;

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
      | "PROVIDER_UNAVAILABLE"
      | "MODEL_LOAD_FAILED"
      | "INVALID_TOOL_CALL"
      | "MODEL_RESPONSE_INVALID"
      | "CONTEXT_LIMIT"
      | "RUNTIME_NOT_READY",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FoundryRuntimeError";
  }
}

function executionProvider(model: IModel): string {
  return model.info.runtime?.executionProvider ?? model.info.executionProvider ?? "CPUExecutionProvider";
}

function isCpuModel(model: IModel): boolean {
  return (
    model.info.deviceType.toLowerCase() === "cpu" ||
    model.info.runtime?.deviceType.toLowerCase() === "cpu" ||
    executionProvider(model).toLowerCase() === "cpuexecutionprovider"
  );
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

function normalizedProviderName(name: string): string {
  return name.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
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

function compareModelVariants(left: IModel, right: IModel): number {
  const deviceOrder = { GPU: 0, NPU: 1, CPU: 2, Invalid: 3 } as const;
  const leftDevice = left.info.runtime?.deviceType ?? left.info.deviceType;
  const rightDevice = right.info.runtime?.deviceType ?? right.info.deviceType;
  const deviceDifference = deviceOrder[leftDevice] - deviceOrder[rightDevice];
  if (deviceDifference !== 0) {
    return deviceDifference;
  }
  return (
    (left.info.fileSizeMb ?? Number.POSITIVE_INFINITY) - (right.info.fileSizeMb ?? Number.POSITIVE_INFINITY)
  );
}

function selectCachedModel(models: readonly IModel[]): IModel | null {
  const requestedId = process.env.FOUNDRY_MODEL_ID?.trim();
  if (requestedId) {
    return models.find((model) => model.id === requestedId && model.supportsToolCalling === true) ?? null;
  }

  const requestedAlias = process.env.FOUNDRY_MODEL_ALIAS?.trim();
  const aliases = requestedAlias ? [requestedAlias] : [...DEFAULT_MODEL_ALIASES];
  for (const alias of aliases) {
    const candidates = models
      .filter(
        (model) =>
          model.alias === alias &&
          model.isCached &&
          model.supportsToolCalling === true &&
          ["chat-completion", "coding"].includes(model.info.task?.toLowerCase() ?? ""),
      )
      .sort(compareModelVariants);
    const selected = candidates[0];
    if (selected !== undefined) {
      return selected;
    }
  }
  return null;
}

export class FoundryLayoutService {
  #paths: FoundryPaths | null = null;
  #manager: FoundryLocalManager | null = null;
  #model: IModel | null = null;
  #session: ChatSession | null = null;
  #systemPromptPending = true;
  #readiness: RuntimeReadiness = {
    sdkVersion: "2.2.1",
    provider: "Foundry Local in-process SDK",
    planningMode: "Runtime-guided JSON schema -> app tool invocation",
    responseMode: "Application-rendered typed evidence",
    model: null,
    modelCached: false,
    executionProviderRegistered: false,
    localInferenceReady: false,
    externalEndpointUsed: false,
    nonessentialTelemetryDisabled: true,
    cachePath: "",
    appDataPath: "",
    status: "not_initialized",
    detail: "Foundry Local has not been initialized.",
  };

  get readiness(): RuntimeReadiness {
    return this.#readiness;
  }

  async initialize(): Promise<RuntimeReadiness> {
    if (this.#manager !== null && this.#model !== null) {
      return this.#refreshReadiness();
    }

    this.#readiness = {
      ...this.#readiness,
      status: "checking",
      detail: "Inspecting the local SDK catalog and execution providers.",
    };

    this.#paths = await resolveFoundryPaths();
    this.#manager = FoundryLocalManager.create({
      appName: "FoundryLocalNewHomeLayoutDemo",
      appDataDir: this.#paths.appDataDir,
      modelCacheDir: this.#paths.modelCacheDir,
      logsDir: this.#paths.logsDir,
      logLevel: "info",
      disableNonessentialTelemetry: true,
    });

    const cachedModels = await this.#manager.catalog.getCachedModels();
    this.#model = selectCachedModel(cachedModels);
    if (this.#model === null) {
      this.#readiness = {
        ...this.#readiness,
        cachePath: this.#paths.modelCacheDir,
        appDataPath: this.#paths.appDataDir,
        status: "model_unavailable",
        detail:
          "No cached, tool-capable candidate model was found. Set FOUNDRY_MODEL_ALIAS or cache a supported model.",
      };
      return this.#readiness;
    }

    return this.#refreshReadiness();
  }

  async prepareOffline(onProgress?: (detail: string) => void): Promise<RuntimeReadiness> {
    await this.initialize();
    const manager = this.#requireManager();
    const model = this.#requireModel();

    if (!model.isCached) {
      onProgress?.(`Downloading ${model.alias} for offline use.`);
      await model.download((percent) => onProgress?.(`Model download ${percent.toFixed(1)}%`));
    }

    const providerInfo = this.#findProviderInfo(model);
    if (!isCpuModel(model) && providerInfo?.isRegistered !== true) {
      if (providerInfo === undefined) {
        this.#readiness = {
          ...this.#readiness,
          status: "provider_unavailable",
          detail: `Execution provider ${executionProvider(model)} is not discoverable on this device.`,
        };
        throw new FoundryRuntimeError(this.#readiness.detail, "PROVIDER_UNAVAILABLE");
      }

      onProgress?.(`Registering ${providerInfo.name} for offline inference.`);
      const result = await manager.downloadAndRegisterEps([providerInfo.name], (name, percent) => {
        onProgress?.(`${name} ${percent.toFixed(1)}%`);
      });
      if (!result.success || result.failedEps.length > 0) {
        throw new FoundryRuntimeError(
          `Execution provider registration failed: ${result.status}`,
          "PROVIDER_UNAVAILABLE",
        );
      }
    }

    await this.#loadModel();
    return this.#refreshReadiness();
  }

  async runTurn(
    userPrompt: string,
    state: DemoStateSnapshot,
    onPhase?: (phase: string, detail: string) => void,
  ): Promise<FoundryTurnOutcome> {
    await this.initialize();
    if (!this.#readiness.localInferenceReady) {
      await this.prepareOffline((detail) => onPhase?.("runtime", detail));
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

      planningPreflight = await session.preflightRequest(request);
      if (!planningPreflight.fits) {
        throw new FoundryRuntimeError(
          `Request needs ${planningPreflight.requiredTokens} tokens but the context limit is ${planningPreflight.contextLimitTokens}.`,
          "CONTEXT_LIMIT",
        );
      }

      try {
        planningResponse = await session.processRequest(request);
      } catch (error) {
        validationErrors.push({
          code: "INVALID_SCHEMA",
          message: "The native runtime rejected the generated tool call before execution.",
          details: [error instanceof Error ? error.message : String(error)],
        });
        if (session.turnCount > turnCountBeforeAttempt) {
          session.undoTurns(session.turnCount - turnCountBeforeAttempt);
        }
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

  resetConversation(): void {
    this.#session?.dispose();
    this.#session = null;
    this.#systemPromptPending = true;
    if (this.#model !== null && this.#readiness.localInferenceReady) {
      this.#createSession();
    }
  }

  async shutdown(): Promise<void> {
    this.#session?.dispose();
    this.#session = null;
    if (this.#model !== null) {
      if (await this.#model.isLoaded()) {
        await this.#model.unload();
      }
      this.#model = null;
    }
    this.#manager?.dispose();
    this.#manager = null;
    this.#readiness = {
      ...this.#readiness,
      localInferenceReady: false,
      status: "not_initialized",
      detail: "Foundry Local was shut down.",
    };
  }

  async #loadModel(): Promise<void> {
    const model = this.#requireModel();
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

  #createSession(): void {
    const model = this.#requireModel();
    this.#session?.dispose();
    this.#session = new ChatSession(model);
    this.#systemPromptPending = true;
  }

  #findProviderInfo(model: IModel) {
    const manager = this.#requireManager();
    const expected = normalizedProviderName(executionProvider(model));
    return manager.discoverEps().find((provider) => normalizedProviderName(provider.name) === expected);
  }

  async #refreshReadiness(): Promise<RuntimeReadiness> {
    const paths = this.#paths;
    const model = this.#model;
    if (paths === null || model === null) {
      return this.#readiness;
    }

    const providerRegistered = isCpuModel(model) || this.#findProviderInfo(model)?.isRegistered === true;
    const loaded = await model.isLoaded();
    const ready = model.isCached && providerRegistered && loaded && this.#session !== null;
    this.#readiness = {
      sdkVersion: "2.2.1",
      provider: "Foundry Local in-process SDK",
      planningMode: "Runtime-guided JSON schema -> app tool invocation",
      responseMode: "Application-rendered typed evidence",
      model: modelIdentity(model),
      modelCached: model.isCached,
      executionProviderRegistered: providerRegistered,
      localInferenceReady: ready,
      externalEndpointUsed: false,
      nonessentialTelemetryDisabled: true,
      cachePath: paths.modelCacheDir,
      appDataPath: paths.appDataDir,
      status: ready
        ? "ready"
        : model.isCached
          ? providerRegistered
            ? "loading"
            : "provider_unavailable"
          : "model_unavailable",
      detail: ready
        ? `${model.id} is loaded through ${executionProvider(model)} with no external inference endpoint.`
        : !model.isCached
          ? `${model.id} is not cached.`
          : !providerRegistered
            ? `${executionProvider(model)} must be registered before offline inference.`
            : `${model.id} is cached and ready to load.`,
    };
    return this.#readiness;
  }

  #requireManager(): FoundryLocalManager {
    if (this.#manager === null) {
      throw new FoundryRuntimeError("Foundry Local manager is not initialized.", "RUNTIME_NOT_READY");
    }
    return this.#manager;
  }

  #requireModel(): IModel {
    if (this.#model === null) {
      throw new FoundryRuntimeError("No compatible local model is selected.", "MODEL_UNAVAILABLE");
    }
    return this.#model;
  }

  #requireSession(): ChatSession {
    if (this.#session === null) {
      throw new FoundryRuntimeError("Foundry Local chat session is not ready.", "RUNTIME_NOT_READY");
    }
    return this.#session;
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
  const conflictText =
    result.conflicts.length > 0
      ? result.conflicts.map((conflict) => conflict.message).join(" ")
      : (result.noResultReason?.message ?? "No bounded known option is feasible.");
  const choices = result.noResultReason?.preferencesThatMayChange.join(", ") ?? "a locked preference";
  return `Application evidence: no feasible known option. ${conflictText} Which preference may change: ${choices}?`;
}

export function summarizeModelInfo(info: ModelInfo): string {
  return `${info.alias} · ${info.deviceType} · ${info.runtime?.executionProvider ?? info.executionProvider ?? "unknown EP"}`;
}
