import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ChatSession,
  FoundryLocalManager,
  type IModel,
  Item,
  Request,
  type RequestPreflightResult,
  type Response,
} from "foundry-local-sdk";
import {
  benchmarkGateFailures,
  type ExpectedLayoutIntent,
  evaluateScenarioQuality,
} from "../src/domain/benchmark-quality";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import {
  buildCompareLayoutOptionsInput,
  createIntentDeltaJsonSchema,
  expandCandidateFurnitureIds,
  formatIntentValidationCorrection,
  type LayoutIntentDelta,
  parseAndValidateIntentDelta,
  parseAndValidateToolInput,
  type ToolValidationError,
} from "../src/domain/tool-contract";
import type { DemoState, DemoStateSnapshot, FurnitureId, LayoutToolStatus } from "../src/domain/types";
import { resolveFoundryPaths } from "../src/foundry/paths";
import { formatTurnPrompt, stageTurns, systemPrompt } from "../src/foundry/prompt";
import { canonicalExecutionProvider } from "../src/foundry/runtime-config";

const SDK_VERSION = "2.2.1";
const MAX_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 256;
const DEFAULT_MODEL_ID = "qwen3-0.6b-generic-gpu:2";

const candidates = [
  {
    id: "qwen2.5-0.5b-instruct-vitis-npu:3",
    executionProvider: "VitisAIExecutionProvider",
  },
  {
    id: "qwen3-0.6b-generic-gpu:2",
    executionProvider: "WebGPUExecutionProvider",
  },
  {
    id: "qwen3.5-0.8b-generic-gpu:2",
    executionProvider: "WebGPUExecutionProvider",
  },
  {
    id: "qwen3.5-2b-generic-gpu:2",
    executionProvider: "WebGPUExecutionProvider",
  },
  {
    id: "qwen3.5-4b-generic-gpu:2",
    executionProvider: "WebGPUExecutionProvider",
  },
  {
    id: "qwen3-1.7b-generic-gpu:2",
    executionProvider: "WebGPUExecutionProvider",
  },
  {
    id: "qwen2.5-1.5b-instruct-generic-gpu:4",
    executionProvider: "WebGPUExecutionProvider",
  },
] as const;

interface ScenarioDefinition {
  readonly id: string;
  readonly prompt: string;
  readonly state: DemoState;
  readonly expectedIntent: ExpectedLayoutIntent;
  readonly expectedFurniture: readonly FurnitureId[];
  readonly expectedStatus: LayoutToolStatus;
  readonly expectedSelectedOptionId?: string | null;
  readonly group: "staged" | "clarification" | "paraphrase";
}

interface AttemptEvidence {
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
  readonly rawOutput: string;
  readonly error: ToolValidationError | { readonly message: string } | null;
}

interface ScenarioEvidence {
  readonly id: string;
  readonly group: ScenarioDefinition["group"];
  readonly prompt: string;
  readonly passed: boolean;
  readonly attempts: number;
  readonly totalMs: number;
  readonly generationMs: number;
  readonly validationMs: number;
  readonly expectedIntent: ExpectedLayoutIntent;
  readonly actualIntent: LayoutIntentDelta | null;
  readonly expectedFurniture: readonly FurnitureId[];
  readonly actualFurniture: readonly FurnitureId[] | null;
  readonly expectedStatus: LayoutToolStatus;
  readonly actualStatus: LayoutToolStatus | null;
  readonly expectedSelectedOptionId: string | null | undefined;
  readonly actualSelectedOptionId: string | null;
  readonly attemptEvidence: readonly AttemptEvidence[];
  readonly failure: string | null;
}

function responseText(response: Response): string {
  return response.output
    .flatMap((item) => {
      if (item.type === "text" && (item.textType ?? "default") === "default") {
        return item.text;
      }
      if (item.type === "message") {
        if (typeof item.content === "string") {
          return item.content;
        }
        return (item.parts ?? [])
          .map((part) =>
            part.type === "text" && (part.textType ?? "default") === "default" ? part.text : "",
          )
          .join("");
      }
      return "";
    })
    .join("")
    .trim();
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return sorted.length % 2 === 0 && left !== undefined && right !== undefined
    ? (left + right) / 2
    : (right ?? null);
}

function authoredTurn(
  state: DemoState,
  intent: LayoutIntentDelta,
): {
  readonly state: DemoState;
  readonly status: LayoutToolStatus;
  readonly selectedOptionId: string | null;
} {
  const input = buildCompareLayoutOptionsInput(intent, state);
  const result = compareKnownLayoutOptions(input, state);
  return {
    state: applyToolResult(state, result),
    status: result.status,
    selectedOptionId: result.selectedOptionId,
  };
}

function buildScenarios(): readonly ScenarioDefinition[] {
  const initial = createInitialDemoState();
  const afterA = authoredTurn(initial, {
    bed: "queen",
    desk: "flexible",
    crib: "keep",
    changedPreference: stageTurns[0]?.prompt ?? "",
    clarification: "none",
  });
  const afterB = authoredTurn(afterA.state, {
    bed: "king",
    desk: "keep",
    crib: "keep",
    changedPreference: stageTurns[1]?.prompt ?? "",
    clarification: "none",
  });
  const afterC = authoredTurn(afterB.state, {
    bed: "queen",
    desk: "flexible",
    crib: "add",
    changedPreference: stageTurns[2]?.prompt ?? "",
    clarification: "none",
  });
  const afterFailure = authoredTurn(afterC.state, {
    bed: "king",
    desk: "keep",
    crib: "keep",
    changedPreference: stageTurns[3]?.prompt ?? "",
    clarification: "none",
  });
  const correctionPrompt =
    "Correction: keep the Queen bed and compact desk. Remove the crib. Do not switch to a King.";
  const afterCorrection = authoredTurn(afterFailure.state, {
    bed: "queen",
    desk: "compact",
    crib: "remove",
    changedPreference: correctionPrompt,
    clarification: "none",
  });
  const kingCompactCribState: DemoState = {
    ...afterC.state,
    stateRef: "layout-state-v50",
    version: 50,
    currentLayoutId: "benchmark-king-compact-crib",
    activeFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
  };

  return [
    {
      id: "turn-a",
      prompt: stageTurns[0]?.prompt ?? "",
      state: initial,
      expectedIntent: {
        bed: ["queen"],
        desk: ["flexible", "standard"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-standard"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-desk-standard-v1",
      group: "staged",
    },
    {
      id: "turn-b",
      prompt: stageTurns[1]?.prompt ?? "",
      state: afterA.state,
      expectedIntent: {
        bed: ["king"],
        desk: ["keep", "standard"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-king", "desk-standard"],
      expectedStatus: "no_feasible_option",
      expectedSelectedOptionId: null,
      group: "staged",
    },
    {
      id: "turn-c",
      prompt: stageTurns[2]?.prompt ?? "",
      state: afterB.state,
      expectedIntent: {
        bed: ["queen", "keep"],
        desk: ["flexible"],
        crib: ["add"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-compact", "crib-standard"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-crib-compact-v1",
      group: "staged",
    },
    {
      id: "controlled-failure",
      prompt: stageTurns[3]?.prompt ?? "",
      state: afterC.state,
      expectedIntent: {
        bed: ["king"],
        desk: ["keep", "compact"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-king", "desk-compact", "crib-standard"],
      expectedStatus: "no_feasible_option",
      expectedSelectedOptionId: null,
      group: "staged",
    },
    {
      id: "correction",
      prompt: correctionPrompt,
      state: afterFailure.state,
      expectedIntent: {
        bed: ["queen", "keep"],
        desk: ["compact", "keep"],
        crib: ["remove"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-compact"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-compact-desk-v1",
      group: "staged",
    },
    {
      id: "unsupported-dresser",
      prompt: "Keep the current layout and add a dresser beside the bed.",
      state: afterCorrection.state,
      expectedIntent: {
        bed: ["keep", "queen"],
        desk: ["keep", "compact"],
        crib: ["keep"],
        clarification: ["required"],
      },
      expectedFurniture: ["bed-queen", "desk-compact"],
      expectedStatus: "clarification_required",
      expectedSelectedOptionId: null,
      group: "clarification",
    },
    {
      id: "negated-bed-desk-transitions",
      prompt: "Do not replace the Queen with a King; do not replace the standard desk with a compact desk.",
      state: afterA.state,
      expectedIntent: {
        bed: ["keep"],
        desk: ["keep"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-standard"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-desk-standard-v1",
      group: "paraphrase",
    },
    {
      id: "unsupported-california-king",
      prompt: "Use a California King instead.",
      state: afterA.state,
      expectedIntent: {
        bed: ["keep", "queen"],
        desk: ["keep", "standard"],
        crib: ["keep"],
        clarification: ["required"],
      },
      expectedFurniture: ["bed-queen", "desk-standard"],
      expectedStatus: "clarification_required",
      expectedSelectedOptionId: null,
      group: "clarification",
    },
    {
      id: "unsupported-twin-moon-pod",
      prompt: "Use a twin bed with a moon pod beside it.",
      state: afterA.state,
      expectedIntent: {
        bed: ["keep", "queen"],
        desk: ["keep", "standard"],
        crib: ["keep"],
        clarification: ["required"],
      },
      expectedFurniture: ["bed-queen", "desk-standard"],
      expectedStatus: "clarification_required",
      expectedSelectedOptionId: null,
      group: "clarification",
    },
    {
      id: "paraphrase-queen-regular-desk",
      prompt: "Please check a queen bed with a regular-size desk.",
      state: initial,
      expectedIntent: {
        bed: ["queen"],
        desk: ["standard"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-standard"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-desk-standard-v1",
      group: "paraphrase",
    },
    {
      id: "paraphrase-king-keep-desk",
      prompt: "Swap only the bed for a king; leave the desk alone.",
      state: afterA.state,
      expectedIntent: {
        bed: ["king"],
        desk: ["keep", "standard"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-king", "desk-standard"],
      expectedStatus: "no_feasible_option",
      expectedSelectedOptionId: null,
      group: "paraphrase",
    },
    {
      id: "paraphrase-crib-flexible-desk",
      prompt: "Retain the queen, bring in the crib, and let the desk size adjust.",
      state: afterA.state,
      expectedIntent: {
        bed: ["queen", "keep"],
        desk: ["flexible"],
        crib: ["add"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-compact", "crib-standard"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-crib-compact-v1",
      group: "paraphrase",
    },
    {
      id: "paraphrase-replace-king-with-queen",
      prompt: "Replace the King with a Queen.",
      state: kingCompactCribState,
      expectedIntent: {
        bed: ["queen"],
        desk: ["keep", "compact"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-compact", "crib-standard"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-crib-compact-v1",
      group: "paraphrase",
    },
    {
      id: "paraphrase-from-king-to-queen",
      prompt: "Move from King to Queen and keep the crib.",
      state: kingCompactCribState,
      expectedIntent: {
        bed: ["queen"],
        desk: ["keep", "compact"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-compact", "crib-standard"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-crib-compact-v1",
      group: "paraphrase",
    },
    {
      id: "paraphrase-scoped-negation",
      prompt: "Do not keep the King; use the Queen and do not remove the crib.",
      state: kingCompactCribState,
      expectedIntent: {
        bed: ["queen"],
        desk: ["keep", "compact"],
        crib: ["keep"],
        clarification: ["none"],
      },
      expectedFurniture: ["bed-queen", "desk-compact", "crib-standard"],
      expectedStatus: "feasible",
      expectedSelectedOptionId: "queen-crib-compact-v1",
      group: "paraphrase",
    },
    {
      id: "unsupported-armchair-mixed",
      prompt: "Use a Queen bed with an armchair beside it.",
      state: kingCompactCribState,
      expectedIntent: {
        bed: ["queen"],
        desk: ["keep", "compact"],
        crib: ["keep"],
        clarification: ["required"],
      },
      expectedFurniture: ["bed-queen", "desk-compact", "crib-standard"],
      expectedStatus: "clarification_required",
      expectedSelectedOptionId: null,
      group: "clarification",
    },
  ];
}

function requestFor(
  model: IModel,
  state: DemoStateSnapshot,
  prompt: string,
  correction: ToolValidationError | null,
  includeSystem: boolean,
): {
  readonly request: Request;
  readonly promptText: string;
  readonly schemaText: string;
} {
  const request = new Request();
  if (includeSystem) {
    request.addItem(Item.systemMessage(systemPrompt));
  }
  const correctionText =
    correction === null ? "" : formatIntentValidationCorrection(correction, state, prompt);
  const promptText = `${formatTurnPrompt(prompt, state)}${correctionText}`;
  const schemaText = JSON.stringify(createIntentDeltaJsonSchema(state, prompt));
  request.addItem(Item.userMessage(promptText)).setOptions({
    search: {
      doSample: false,
      temperature: 0,
      seed: 42,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
    toolChoice: "none",
    additionalOptions: {
      parallel_tool_calls: false,
      guidance_type: "json_schema",
      guidance_data: schemaText,
      ...(model.info.supportsReasoning === true
        ? { chat_template_kwargs: JSON.stringify({ enable_thinking: false }) }
        : {}),
    },
  });
  return { request, promptText, schemaText };
}

async function runScenario(
  model: IModel,
  session: ChatSession,
  scenario: ScenarioDefinition,
): Promise<ScenarioEvidence> {
  const scenarioStarted = performance.now();
  const attemptEvidence: AttemptEvidence[] = [];
  let priorError: ToolValidationError | null = null;
  let actualIntent: LayoutIntentDelta | null = null;
  let actualFurniture: FurnitureId[] | null = null;
  let actualStatus: LayoutToolStatus | null = null;
  let actualSelectedOptionId: string | null = null;
  let failure: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const turnCountBefore = session.turnCount;
    const { request, promptText, schemaText } = requestFor(
      model,
      scenario.state,
      scenario.prompt,
      priorError,
      session.turnCount === 0,
    );
    const preflightStarted = performance.now();
    const preflight: RequestPreflightResult = await session.preflightRequest(request);
    const preflightMs = performance.now() - preflightStarted;
    if (!preflight.fits) {
      failure = `Context limit: ${preflight.requiredTokens}/${preflight.contextLimitTokens}.`;
      attemptEvidence.push({
        attempt,
        promptBytes: bytes(promptText),
        schemaBytes: bytes(schemaText),
        outputBytes: 0,
        preflightMs: roundMs(preflightMs),
        generationMs: 0,
        validationMs: 0,
        promptTokens: preflight.promptTokens ?? null,
        completionTokens: null,
        finishReason: "runtime_error",
        rawOutput: "",
        error: { message: failure },
      });
      break;
    }

    let response: Response;
    const generationStarted = performance.now();
    try {
      response = await session.processRequest(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (session.turnCount > turnCountBefore) {
        session.undoTurns(session.turnCount - turnCountBefore);
      }
      attemptEvidence.push({
        attempt,
        promptBytes: bytes(promptText),
        schemaBytes: bytes(schemaText),
        outputBytes: 0,
        preflightMs: roundMs(preflightMs),
        generationMs: roundMs(performance.now() - generationStarted),
        validationMs: 0,
        promptTokens: preflight.promptTokens ?? null,
        completionTokens: null,
        finishReason: "runtime_error",
        rawOutput: "",
        error: { message },
      });
      priorError = {
        code: "INVALID_SCHEMA",
        message: "The native runtime rejected the intent delta.",
        details: [message],
      };
      failure = message;
      continue;
    }
    const generationMs = performance.now() - generationStarted;
    const rawOutput = responseText(response);
    const validationStarted = performance.now();
    const validation =
      response.finishReason === "stop"
        ? parseAndValidateIntentDelta(rawOutput, scenario.state, scenario.prompt)
        : {
            ok: false as const,
            error: {
              code: "INVALID_SCHEMA" as const,
              message: `Unexpected finish reason ${response.finishReason}.`,
              details: [response.finishReason],
            },
          };
    const validationMs = performance.now() - validationStarted;
    attemptEvidence.push({
      attempt,
      promptBytes: bytes(promptText),
      schemaBytes: bytes(schemaText),
      outputBytes: bytes(rawOutput),
      preflightMs: roundMs(preflightMs),
      generationMs: roundMs(generationMs),
      validationMs: roundMs(validationMs),
      promptTokens: response.usage?.promptTokens ?? preflight.promptTokens ?? null,
      completionTokens: response.usage?.completionTokens ?? null,
      finishReason: response.finishReason,
      rawOutput,
      error: validation.ok ? null : validation.error,
    });
    if (!validation.ok) {
      priorError = validation.error;
      failure = `${validation.error.code}: ${validation.error.details.join(" ")}`;
      if (session.turnCount > turnCountBefore) {
        session.undoTurns(session.turnCount - turnCountBefore);
      }
      continue;
    }

    actualIntent = validation.value.intentDelta;
    actualFurniture = expandCandidateFurnitureIds(validation.value.toolInput.candidateFurnitureIds);
    const result = compareKnownLayoutOptions(validation.value.toolInput, scenario.state);
    actualStatus = result.status;
    actualSelectedOptionId = result.selectedOptionId;
    const quality = evaluateScenarioQuality({
      actualIntent,
      expectedIntent: scenario.expectedIntent,
      actualFurniture,
      expectedFurniture: scenario.expectedFurniture,
      actualStatus,
      expectedStatus: scenario.expectedStatus,
      actualSelectedOptionId,
      expectedSelectedOptionId: scenario.expectedSelectedOptionId,
    });
    failure = quality.passed ? null : quality.failures.join("; ");
    break;
  }

  const generationMs = attemptEvidence.reduce((sum, attempt) => sum + attempt.generationMs, 0);
  const validationMs = attemptEvidence.reduce((sum, attempt) => sum + attempt.validationMs, 0);
  return {
    id: scenario.id,
    group: scenario.group,
    prompt: scenario.prompt,
    passed: failure === null,
    attempts: attemptEvidence.length,
    totalMs: roundMs(performance.now() - scenarioStarted),
    generationMs: roundMs(generationMs),
    validationMs: roundMs(validationMs),
    expectedIntent: scenario.expectedIntent,
    actualIntent,
    expectedFurniture: scenario.expectedFurniture,
    actualFurniture,
    expectedStatus: scenario.expectedStatus,
    actualStatus,
    expectedSelectedOptionId: scenario.expectedSelectedOptionId,
    actualSelectedOptionId,
    attemptEvidence,
    failure,
  };
}

function protectionEvidence(): Record<string, unknown> {
  const state = createInitialDemoState();
  const prompt = stageTurns[0]?.prompt ?? "";
  const intent: LayoutIntentDelta = {
    bed: "queen",
    desk: "flexible",
    crib: "keep",
    changedPreference: prompt,
    clarification: "none",
  };
  const extraGeometry = parseAndValidateIntentDelta(
    JSON.stringify({ ...intent, status: "feasible", widthMm: 9999 }),
    state,
    prompt,
  );
  const toolInput = buildCompareLayoutOptionsInput(intent, state);
  const stale = parseAndValidateToolInput(
    JSON.stringify({ ...toolInput, priorStateRef: "layout-state-v999" }),
    state,
    prompt,
  );
  const invented = parseAndValidateToolInput(
    JSON.stringify({
      ...toolInput,
      candidateFurnitureIds: {
        ...toolInput.candidateFurnitureIds,
        desk: "desk-invented",
      },
    }),
    state,
    prompt,
  );
  return {
    strictDeltaRejectsGeometry: !extraGeometry.ok && extraGeometry.error.code === "INVALID_SCHEMA",
    staleStateRejected: !stale.ok && stale.error.code === "STALE_STATE",
    inventedCatalogIdRejected: !invented.ok && invented.error.code === "INVALID_SCHEMA",
    passed: !extraGeometry.ok && !stale.ok && !invented.ok,
  };
}

async function ensureProvider(
  manager: ReturnType<typeof FoundryLocalManager.create>,
  providerName: string,
): Promise<{ readonly discoverable: boolean; readonly registered: boolean; readonly detail: string }> {
  if (providerName === "CPUExecutionProvider") {
    return { discoverable: true, registered: true, detail: "CPU provider is built in." };
  }
  const provider = manager
    .discoverEps()
    .find((candidate) => canonicalExecutionProvider(candidate.name) === providerName);
  if (provider === undefined) {
    return { discoverable: false, registered: false, detail: `${providerName} was not discovered.` };
  }
  if (provider.isRegistered) {
    return { discoverable: true, registered: true, detail: `${provider.name} was already registered.` };
  }
  const result = await manager.downloadAndRegisterEps([provider.name]);
  return {
    discoverable: true,
    registered: result.success && result.failedEps.length === 0,
    detail: result.status,
  };
}

async function benchmarkCandidate(
  manager: ReturnType<typeof FoundryLocalManager.create>,
  target: (typeof candidates)[number],
  scenarios: readonly ScenarioDefinition[],
): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    id: target.id,
    expectedExecutionProvider: target.executionProvider,
    compatibility: "not_tested",
    passed: false,
    scenarios: [],
  };
  let model: IModel | null = null;
  let loaded = false;
  const rssBeforeLoadMb = rssMb();
  let peakRssMb = rssBeforeLoadMb;

  try {
    model = await manager.catalog.getModelVariant(target.id);
    const actualProvider = canonicalExecutionProvider(
      model.info.runtime?.executionProvider ?? model.info.executionProvider ?? "CPUExecutionProvider",
    );
    Object.assign(report, {
      alias: model.alias,
      exactId: model.id,
      task: model.info.task ?? null,
      cached: model.isCached,
      supportsToolCalling: model.supportsToolCalling,
      supportsReasoning: model.info.supportsReasoning === true,
      deviceType: model.info.runtime?.deviceType ?? model.info.deviceType,
      executionProvider: actualProvider,
      fileSizeMb: model.info.fileSizeMb ?? null,
      rssBeforeLoadMb,
    });
    if (model.id !== target.id) {
      throw new Error(`Catalog returned ${model.id}; expected exact ID ${target.id}.`);
    }
    if (!model.isCached) {
      throw new Error("Exact candidate is not cached; model download is forbidden for this benchmark.");
    }
    if (actualProvider !== target.executionProvider) {
      throw new Error(`Execution provider ${actualProvider}; expected ${target.executionProvider}.`);
    }
    const provider = await ensureProvider(manager, target.executionProvider);
    report.provider = provider;
    if (!provider.registered) {
      throw new Error(provider.detail);
    }

    const loadStarted = performance.now();
    await model.load();
    loaded = true;
    const loadMs = performance.now() - loadStarted;
    peakRssMb = Math.max(peakRssMb, rssMb());
    Object.assign(report, {
      loadMs: roundMs(loadMs),
      rssAfterLoadMb: rssMb(),
      compatibility: "model_loaded",
    });

    const warmupSession = new ChatSession(model);
    let warmup: ScenarioEvidence;
    try {
      warmup = await runScenario(model, warmupSession, scenarios[0] as ScenarioDefinition);
    } finally {
      warmupSession.dispose();
    }
    report.warmup = warmup;
    peakRssMb = Math.max(peakRssMb, rssMb());
    if (warmup.attemptEvidence.every((attempt) => attempt.finishReason === "runtime_error")) {
      throw new Error(`ChatSession JSON schema warmup failed: ${warmup.failure ?? "unknown error"}`);
    }
    report.compatibility = "chat_session_json_schema";

    const primarySession = new ChatSession(model);
    const scenarioEvidence: ScenarioEvidence[] = [];
    try {
      for (const scenario of scenarios.filter((candidate) => candidate.group === "staged")) {
        const evidence = await runScenario(model, primarySession, scenario);
        scenarioEvidence.push(evidence);
        peakRssMb = Math.max(peakRssMb, rssMb());
        console.log(
          `${target.id} ${scenario.id}: ${evidence.passed ? "PASS" : "FAIL"} ` +
            `${Math.round(evidence.totalMs)} ms, ${evidence.attempts} attempt(s)`,
        );
      }
    } finally {
      primarySession.dispose();
    }

    for (const scenario of scenarios.filter((candidate) => candidate.group !== "staged")) {
      const session = new ChatSession(model);
      try {
        const evidence = await runScenario(model, session, scenario);
        scenarioEvidence.push(evidence);
        peakRssMb = Math.max(peakRssMb, rssMb());
        console.log(
          `${target.id} ${scenario.id}: ${evidence.passed ? "PASS" : "FAIL"} ` +
            `${Math.round(evidence.totalMs)} ms, ${evidence.attempts} attempt(s)`,
        );
      } finally {
        session.dispose();
      }
    }

    const protection = protectionEvidence();
    const totalTimes = scenarioEvidence.map((scenario) => scenario.totalMs);
    const generationTimes = scenarioEvidence.map((scenario) => scenario.generationMs);
    const attempts = scenarioEvidence.map((scenario) => scenario.attempts);
    const failures = scenarioEvidence.filter((scenario) => !scenario.passed);
    const passed =
      failures.length === 0 && protection.passed === true && scenarioEvidence.length === scenarios.length;
    Object.assign(report, {
      scenarios: scenarioEvidence,
      protection,
      passed,
      failures: failures.map((failure) => ({ id: failure.id, reason: failure.failure })),
      scenarioCount: scenarioEvidence.length,
      totalAttempts: attempts.reduce((sum, value) => sum + value, 0),
      maxAttempts: Math.max(...attempts),
      warmTurnMedianMs: roundMs(median(totalTimes) ?? 0),
      warmTurnMaxMs: roundMs(Math.max(...totalTimes)),
      generationMedianMs: roundMs(median(generationTimes) ?? 0),
      generationMaxMs: roundMs(Math.max(...generationTimes)),
      peakRssMb,
      rssDeltaFromBeforeLoadMb: roundMs(peakRssMb - rssBeforeLoadMb),
    });
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    report.peakRssMb = peakRssMb;
  } finally {
    if (model !== null && loaded) {
      try {
        await model.unload();
      } catch (error) {
        report.unloadError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  return report;
}

const requestedIds = process.env.LAYOUT_BENCHMARK_MODELS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const selectedCandidates =
  requestedIds && requestedIds.length > 0
    ? candidates.filter((candidate) => requestedIds.includes(candidate.id))
    : candidates;
if (selectedCandidates.length === 0) {
  throw new Error("LAYOUT_BENCHMARK_MODELS did not match a declared exact candidate.");
}

const paths = await resolveFoundryPaths();
const manager = FoundryLocalManager.create({
  appName: "FoundryLocalNewHomeLayoutModelBenchmark",
  appDataDir: paths.appDataDir,
  modelCacheDir: paths.modelCacheDir,
  logsDir: paths.logsDir,
  logLevel: "warn",
  disableNonessentialTelemetry: true,
});
const scenarios = buildScenarios();
const report: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  sdkVersion: SDK_VERSION,
  nodeVersion: process.version,
  platform: `${process.platform}-${process.arch}`,
  contract: {
    name: "layout-intent-delta",
    semanticSchema: "unrestricted compact intent enums",
    qualityOracle: "independently authored expected intents, candidates, status, and selection",
    maxAttempts: MAX_ATTEMPTS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    systemPromptBytes: bytes(systemPrompt),
    scenarioCount: scenarios.length,
  },
  noModelDownloads: true,
  selectionRule:
    "Keep the stage-validated built-in default when it passes every required scenario; otherwise use lowest warm maximum, median, then load.",
  excluded: [
    {
      family: "Qwen 9B",
      reason:
        "Explicitly excluded by task; it is not cached and its larger footprint conflicts with the latency objective.",
    },
  ],
  candidates: [],
};

try {
  const candidateReports: Record<string, unknown>[] = [];
  for (const candidate of selectedCandidates) {
    console.log(`\nBenchmarking ${candidate.id}...`);
    candidateReports.push(await benchmarkCandidate(manager, candidate, scenarios));
  }
  report.candidates = candidateReports;
  const passing = candidateReports
    .filter((candidate) => candidate.passed === true)
    .sort((left, right) => {
      if (left.exactId === DEFAULT_MODEL_ID && right.exactId !== DEFAULT_MODEL_ID) {
        return -1;
      }
      if (right.exactId === DEFAULT_MODEL_ID && left.exactId !== DEFAULT_MODEL_ID) {
        return 1;
      }
      const maxDifference =
        Number(left.warmTurnMaxMs ?? Number.MAX_SAFE_INTEGER) -
        Number(right.warmTurnMaxMs ?? Number.MAX_SAFE_INTEGER);
      if (maxDifference !== 0) {
        return maxDifference;
      }
      const medianDifference =
        Number(left.warmTurnMedianMs ?? Number.MAX_SAFE_INTEGER) -
        Number(right.warmTurnMedianMs ?? Number.MAX_SAFE_INTEGER);
      return medianDifference !== 0
        ? medianDifference
        : Number(left.loadMs ?? Number.MAX_SAFE_INTEGER) - Number(right.loadMs ?? Number.MAX_SAFE_INTEGER);
    });
  const selected = passing[0]
    ? {
        id: passing[0].exactId,
        executionProvider: passing[0].executionProvider,
        warmTurnMedianMs: passing[0].warmTurnMedianMs,
        warmTurnMaxMs: passing[0].warmTurnMaxMs,
      }
    : null;
  report.selected = selected;
  const requiredModelIds = selectedCandidates.map((candidate) => candidate.id);
  const gateFailures = benchmarkGateFailures(candidateReports, requiredModelIds, selected);
  report.gate = {
    passed: gateFailures.length === 0,
    requiredModelIds,
    failures: gateFailures,
  };
} finally {
  manager.dispose();
}

await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
const outputName = process.env.LAYOUT_BENCHMARK_OUTPUT?.trim() || "layout-model-benchmark.json";
const outputPath = path.join(process.cwd(), "artifacts", outputName);
await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
console.log(`\nWrote ${outputPath}`);
console.log(
  JSON.stringify(
    {
      selected: report.selected,
      candidates: (report.candidates as Record<string, unknown>[]).map((candidate) => ({
        id: candidate.exactId ?? candidate.id,
        task: candidate.task ?? null,
        compatibility: candidate.compatibility,
        passed: candidate.passed,
        loadMs: candidate.loadMs ?? null,
        warmTurnMedianMs: candidate.warmTurnMedianMs ?? null,
        warmTurnMaxMs: candidate.warmTurnMaxMs ?? null,
        failure: candidate.failure ?? null,
        failures: candidate.failures ?? [],
      })),
    },
    null,
    2,
  ),
);
const gate = report.gate as { readonly passed?: boolean; readonly failures?: readonly string[] } | undefined;
if (gate?.passed !== true) {
  console.error(`Benchmark quality gate failed: ${(gate?.failures ?? ["Unknown gate failure."]).join(" ")}`);
  process.exitCode = 1;
}
