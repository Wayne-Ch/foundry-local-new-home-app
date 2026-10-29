import { z } from "zod";
import {
  CLEARANCE_RULE_SET_ID,
  CLEARANCE_RULE_SET_VERSION,
  furnitureCatalog,
  LOCKED_CONSTRAINT_SET_ID,
  REQUIRED_ROOM_STATE_SET_ID,
  ROOM_PLAN_ID,
  ROOM_PLAN_VERSION,
} from "./fixture";
import { type DemoStateSnapshot, type FurnitureId, furnitureIds } from "./types";

const bedIds = ["bed-queen", "bed-king"] as const;
const deskIds = ["desk-standard", "desk-compact"] as const;
const bedIntentValues = ["keep", "queen", "king"] as const;
const deskIntentValues = ["keep", "standard", "compact", "flexible"] as const;
const cribIntentValues = ["keep", "add", "remove"] as const;

export const layoutIntentDeltaSchema = z
  .object({
    bed: z.enum(bedIntentValues),
    desk: z.enum(deskIntentValues),
    crib: z.enum(cribIntentValues),
    changedPreference: z.string().min(1).max(240),
    clarification: z.enum(["none", "required"]),
  })
  .strict();

export type LayoutIntentDelta = z.infer<typeof layoutIntentDeltaSchema>;

export const compareLayoutOptionsInputSchema = z
  .object({
    roomPlanId: z.literal(ROOM_PLAN_ID),
    planVersion: z.literal(ROOM_PLAN_VERSION),
    priorStateRef: z.string().min(1),
    clearanceRuleSetId: z.literal(CLEARANCE_RULE_SET_ID),
    clearanceRuleSetVersion: z.literal(CLEARANCE_RULE_SET_VERSION),
    requiredRoomStateSetId: z.literal(REQUIRED_ROOM_STATE_SET_ID),
    lockedConstraintSetId: z.literal(LOCKED_CONSTRAINT_SET_ID),
    unit: z.literal("mm"),
    candidateFurnitureIds: z
      .object({
        bed: z.enum(bedIds),
        desk: z.enum(deskIds),
        crib: z.literal("crib-standard").nullable(),
      })
      .strict(),
    retainFurnitureIds: z
      .array(z.enum(furnitureIds))
      .max(5)
      .superRefine((ids, context) => {
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: "custom",
            message: "retainFurnitureIds must not contain duplicates",
          });
        }
      }),
    changedPreference: z.string().max(240),
    unknowns: z.array(z.string().min(1).max(160)).max(8),
    clarificationNeeded: z.boolean(),
  })
  .strict();

export type CompareLayoutOptionsInput = z.infer<typeof compareLayoutOptionsInputSchema>;

export const compareLayoutOptionsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    roomPlanId: {
      type: "string",
      enum: [ROOM_PLAN_ID],
    },
    planVersion: {
      type: "string",
      enum: [ROOM_PLAN_VERSION],
    },
    priorStateRef: {
      type: "string",
    },
    clearanceRuleSetId: {
      type: "string",
      enum: [CLEARANCE_RULE_SET_ID],
    },
    clearanceRuleSetVersion: {
      type: "string",
      enum: [CLEARANCE_RULE_SET_VERSION],
    },
    requiredRoomStateSetId: {
      type: "string",
      enum: [REQUIRED_ROOM_STATE_SET_ID],
    },
    lockedConstraintSetId: {
      type: "string",
      enum: [LOCKED_CONSTRAINT_SET_ID],
    },
    unit: {
      type: "string",
      enum: ["mm"],
    },
    candidateFurnitureIds: {
      type: "object",
      additionalProperties: false,
      properties: {
        bed: {
          type: "string",
          enum: bedIds,
        },
        desk: {
          type: "string",
          enum: deskIds,
        },
        crib: {
          type: ["string", "null"],
          enum: ["crib-standard", null],
        },
      },
      required: ["bed", "desk", "crib"],
      description: "Exact catalog IDs for the requested resulting bed, desk, and optional crib.",
    },
    retainFurnitureIds: {
      type: "array",
      maxItems: 5,
      uniqueItems: true,
      items: {
        type: "string",
        enum: furnitureIds,
      },
      description: "Active catalog IDs the user explicitly keeps.",
    },
    changedPreference: {
      type: "string",
      description: "Briefly state what the user changed from the prior accepted layout.",
    },
    unknowns: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
      description: "List missing verified facts. Never infer measurements.",
    },
    clarificationNeeded: {
      type: "boolean",
      description: "True when missing verified facts prevent comparison.",
    },
  },
  required: [
    "roomPlanId",
    "planVersion",
    "priorStateRef",
    "clearanceRuleSetId",
    "clearanceRuleSetVersion",
    "requiredRoomStateSetId",
    "lockedConstraintSetId",
    "unit",
    "candidateFurnitureIds",
    "retainFurnitureIds",
    "changedPreference",
    "unknowns",
    "clarificationNeeded",
  ],
} as const;

export const layoutIntentDeltaJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    bed: {
      type: "string",
      enum: bedIntentValues,
    },
    desk: {
      type: "string",
      enum: deskIntentValues,
    },
    crib: {
      type: "string",
      enum: cribIntentValues,
    },
    changedPreference: {
      type: "string",
    },
    clarification: {
      type: "string",
      enum: ["none", "required"],
    },
  },
  required: ["bed", "desk", "crib", "changedPreference", "clarification"],
} as const;

function preferredFirst<T extends string>(preferred: T, values: readonly T[]): T[] {
  return [preferred, ...values.filter((value) => value !== preferred)];
}

function sameCandidates(
  left: CompareLayoutOptionsInput["candidateFurnitureIds"],
  right: CompareLayoutOptionsInput["candidateFurnitureIds"],
): boolean {
  return left.bed === right.bed && left.desk === right.desk && left.crib === right.crib;
}

function compatibleIntentValues<Key extends "bed" | "desk" | "crib">(
  key: Key,
  values: readonly LayoutIntentDelta[Key][],
  preferred: LayoutIntentDelta,
  state: DemoStateSnapshot,
): LayoutIntentDelta[Key][] {
  const expectedCandidates = resolveCandidateFurnitureIds(preferred, state);
  return preferredFirst(preferred[key], values).filter((value) =>
    sameCandidates(resolveCandidateFurnitureIds({ ...preferred, [key]: value }, state), expectedCandidates),
  );
}

export function createIntentDeltaJsonSchema(
  state: DemoStateSnapshot,
  prompt: string,
): Record<string, unknown> {
  const schema = structuredClone(layoutIntentDeltaJsonSchema) as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const preferred = preferredLayoutIntentDelta(state, prompt);
  properties.bed = {
    ...properties.bed,
    enum: compatibleIntentValues("bed", bedIntentValues, preferred, state),
  };
  properties.desk = {
    ...properties.desk,
    enum: compatibleIntentValues("desk", deskIntentValues, preferred, state),
  };
  properties.crib = {
    ...properties.crib,
    enum: compatibleIntentValues("crib", cribIntentValues, preferred, state),
  };
  properties.changedPreference = {
    ...properties.changedPreference,
    enum: [prompt],
  };
  properties.clarification = {
    ...properties.clarification,
    enum: [preferred.clarification],
  };
  return schema;
}

export function detectUnsupportedCatalogTerms(prompt: string): string[] {
  const normalized = prompt.toLowerCase();
  const terms = ["dresser", "nightstand", "bookshelf", "sofa", "bunk bed", "wardrobe", "changing table"];
  const matches = terms.filter((term) => normalized.includes(term));
  if (
    matches.length === 0 &&
    /\b(?:missing|unknown|unverified)\b[^.!?]{0,40}\b(?:dimension|measurement)/.test(normalized)
  ) {
    return ["requested item"];
  }
  return matches;
}

export interface ToolValidationError {
  readonly code:
    | "INVALID_JSON"
    | "INVALID_SCHEMA"
    | "STALE_STATE"
    | "DROPPED_CONSTRAINT"
    | "INVALID_RETAINED_ITEM"
    | "INCONSISTENT_CLARIFICATION";
  readonly message: string;
  readonly details: readonly string[];
}

export type ToolValidationResult =
  | { readonly ok: true; readonly value: CompareLayoutOptionsInput }
  | { readonly ok: false; readonly error: ToolValidationError };

export interface ValidatedLayoutIntent {
  readonly intentDelta: LayoutIntentDelta;
  readonly toolInput: CompareLayoutOptionsInput;
}

export type LayoutIntentValidationResult =
  | { readonly ok: true; readonly value: ValidatedLayoutIntent }
  | { readonly ok: false; readonly error: ToolValidationError };

function parseJson(rawArguments: string):
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: ToolValidationError;
    } {
  try {
    return { ok: true, value: JSON.parse(rawArguments) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "The model returned invalid JSON intent arguments.",
        details: [error instanceof Error ? error.message : String(error)],
      },
    };
  }
}

export function parseAndValidateIntentDelta(
  rawArguments: string,
  state: DemoStateSnapshot,
  prompt: string,
): LayoutIntentValidationResult {
  const parsed = parseJson(rawArguments);
  if (!parsed.ok) {
    return parsed;
  }
  const schemaResult = layoutIntentDeltaSchema.safeParse(parsed.value);
  if (!schemaResult.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
        message: "The model intent delta did not match the strict semantic schema.",
        details: schemaResult.error.issues.map(
          (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        ),
      },
    };
  }

  const intentDelta = schemaResult.data;
  const expected = preferredLayoutIntentDelta(state, prompt);
  const toolInput = buildCompareLayoutOptionsInput(intentDelta, state);
  const expectedToolInput = buildCompareLayoutOptionsInput(expected, state);
  const details: string[] = [];
  if (
    JSON.stringify(toolInput.candidateFurnitureIds) !==
    JSON.stringify(expectedToolInput.candidateFurnitureIds)
  ) {
    details.push(
      `USER_REQUEST requires candidateFurnitureIds=${JSON.stringify(expectedToolInput.candidateFurnitureIds)}.`,
    );
  }
  if (intentDelta.changedPreference !== prompt) {
    details.push("changedPreference must reproduce USER_REQUEST exactly.");
  }
  if (intentDelta.clarification !== expected.clarification) {
    details.push(`clarification must be ${expected.clarification}.`);
  }
  if (details.length > 0) {
    return {
      ok: false,
      error: {
        code:
          intentDelta.clarification !== expected.clarification
            ? "INCONSISTENT_CLARIFICATION"
            : "DROPPED_CONSTRAINT",
        message: "The semantic delta dropped or changed explicit prompt intent.",
        details,
      },
    };
  }

  const toolValidation = parseAndValidateToolInput(JSON.stringify(toolInput), state, prompt);
  if (!toolValidation.ok) {
    return toolValidation;
  }

  return {
    ok: true,
    value: {
      intentDelta,
      toolInput: toolValidation.value,
    },
  };
}

export function parseAndValidateToolInput(
  rawArguments: string,
  state: DemoStateSnapshot,
  prompt?: string,
): ToolValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "The model returned invalid JSON tool arguments.",
        details: [error instanceof Error ? error.message : String(error)],
      },
    };
  }

  const schemaResult = compareLayoutOptionsInputSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
        message: "The model tool call did not match the strict application schema.",
        details: schemaResult.error.issues.map(
          (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        ),
      },
    };
  }

  const parsedInput = schemaResult.data;
  const input =
    state.version === 0 && parsedInput.changedPreference.trim().length === 0
      ? { ...parsedInput, changedPreference: "initial layout request" }
      : parsedInput;
  if (state.version > 0 && input.changedPreference.trim().length < 3) {
    return {
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
        message: "changedPreference must describe the requested change after the initial turn.",
        details: ["The model returned an empty or too-short changedPreference."],
      },
    };
  }

  if (input.priorStateRef !== state.stateRef) {
    return {
      ok: false,
      error: {
        code: "STALE_STATE",
        message: `Expected priorStateRef ${state.stateRef}, received ${input.priorStateRef}.`,
        details: ["The application will not execute a tool call against stale conversation state."],
      },
    };
  }

  if (prompt) {
    const intentError = validateExplicitPromptConstraints(input, state, prompt);
    if (intentError !== null) {
      return { ok: false, error: intentError };
    }
  }

  const candidates = new Set<FurnitureId>(expandCandidateFurnitureIds(input.candidateFurnitureIds));
  const active = new Set<FurnitureId>(state.activeFurnitureIds);
  const invalidRetained = input.retainFurnitureIds.filter((id) => !candidates.has(id) || !active.has(id));
  if (invalidRetained.length > 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_RETAINED_ITEM",
        message: "Retained furniture must be active in the prior state and included in the candidate set.",
        details: invalidRetained,
      },
    };
  }
  if (
    (input.clarificationNeeded && input.unknowns.length === 0) ||
    (!input.clarificationNeeded && input.unknowns.length > 0)
  ) {
    return {
      ok: false,
      error: {
        code: "INCONSISTENT_CLARIFICATION",
        message: "clarificationNeeded and unknowns must agree.",
        details: ["Set clarificationNeeded=true only when unknowns contains missing verified facts."],
      },
    };
  }

  const verifiedFactTerms = [
    "room",
    "door",
    "closet",
    "window",
    "clearance",
    "queen",
    "king",
    "desk",
    "crib",
  ];
  const promptUnknowns = new Set(
    prompt
      ? detectUnsupportedCatalogTerms(prompt).map(
          (term) => `Missing verified catalog dimensions for ${term}.`,
        )
      : [],
  );
  const incorrectlyUnknown = input.unknowns.filter((unknown) => {
    if (promptUnknowns.has(unknown)) {
      return false;
    }
    const normalized = unknown.toLowerCase();
    return verifiedFactTerms.some((term) => normalized.includes(term));
  });
  if (incorrectlyUnknown.length > 0) {
    return {
      ok: false,
      error: {
        code: "INCONSISTENT_CLARIFICATION",
        message: "The tool call marked facts from the verified room plan or furniture catalog as unknown.",
        details: incorrectlyUnknown.map((unknown) => `${unknown} is already covered by verified input data.`),
      },
    };
  }

  return { ok: true, value: input };
}

export function createToolInputForTests(overrides: {
  readonly state: DemoStateSnapshot;
  readonly candidateFurnitureIds: readonly FurnitureId[];
  readonly retainFurnitureIds?: readonly FurnitureId[];
  readonly changedPreference?: string;
  readonly unknowns?: readonly string[];
  readonly clarificationNeeded?: boolean;
}): CompareLayoutOptionsInput {
  const bed = overrides.candidateFurnitureIds.find((id) => furnitureCatalog[id].category === "bed");
  const desk = overrides.candidateFurnitureIds.find((id) => furnitureCatalog[id].category === "desk");
  const crib = overrides.candidateFurnitureIds.find((id) => furnitureCatalog[id].category === "crib");
  if ((bed !== "bed-queen" && bed !== "bed-king") || (desk !== "desk-standard" && desk !== "desk-compact")) {
    throw new Error("Test tool input requires one known bed and one known desk.");
  }
  return {
    roomPlanId: ROOM_PLAN_ID,
    planVersion: ROOM_PLAN_VERSION,
    priorStateRef: overrides.state.stateRef,
    clearanceRuleSetId: CLEARANCE_RULE_SET_ID,
    clearanceRuleSetVersion: CLEARANCE_RULE_SET_VERSION,
    requiredRoomStateSetId: REQUIRED_ROOM_STATE_SET_ID,
    lockedConstraintSetId: LOCKED_CONSTRAINT_SET_ID,
    unit: "mm",
    candidateFurnitureIds: {
      bed,
      desk,
      crib: crib === "crib-standard" ? crib : null,
    },
    retainFurnitureIds: [...(overrides.retainFurnitureIds ?? [])],
    changedPreference: overrides.changedPreference ?? "test preference change",
    unknowns: [...(overrides.unknowns ?? [])],
    clarificationNeeded: overrides.clarificationNeeded ?? false,
  };
}

export function expandCandidateFurnitureIds(
  candidates: CompareLayoutOptionsInput["candidateFurnitureIds"],
): FurnitureId[] {
  return [candidates.bed, candidates.desk, ...(candidates.crib ? [candidates.crib] : [])];
}

export function validateExplicitPromptConstraints(
  input: CompareLayoutOptionsInput,
  state: DemoStateSnapshot,
  prompt: string,
): ToolValidationError | null {
  const expected = preferredCandidateFurnitureIds(state, prompt);
  const details: string[] = [];

  if (input.candidateFurnitureIds.bed !== expected.bed) {
    details.push(`USER_REQUEST requires candidateFurnitureIds.bed=${expected.bed}.`);
  }
  if (input.candidateFurnitureIds.desk !== expected.desk) {
    details.push(`USER_REQUEST requires candidateFurnitureIds.desk=${expected.desk}.`);
  }
  if (input.candidateFurnitureIds.crib !== expected.crib) {
    details.push(`USER_REQUEST requires candidateFurnitureIds.crib=${expected.crib ?? "null"}.`);
  }

  const expectedCandidateIds = new Set(expandCandidateFurnitureIds(expected));
  const expectedRetained = state.activeFurnitureIds.filter((id) => expectedCandidateIds.has(id));
  const actualRetained = new Set(input.retainFurnitureIds);
  for (const id of expectedRetained) {
    if (!actualRetained.has(id)) {
      details.push(`${id} remains active and must be listed in retainFurnitureIds.`);
    }
  }
  for (const id of input.retainFurnitureIds) {
    if (!expectedRetained.includes(id)) {
      details.push(`${id} is replaced or removed and must not be retained.`);
    }
  }

  return details.length === 0
    ? null
    : {
        code: "DROPPED_CONSTRAINT",
        message: "The structured proposal dropped an explicit user or retained-state constraint.",
        details,
      };
}

export function preferredCandidateFurnitureIds(
  state: DemoStateSnapshot,
  prompt: string,
): CompareLayoutOptionsInput["candidateFurnitureIds"] {
  return resolveCandidateFurnitureIds(preferredLayoutIntentDelta(state, prompt), state);
}

function currentBed(
  state: DemoStateSnapshot,
): CompareLayoutOptionsInput["candidateFurnitureIds"]["bed"] | undefined {
  return state.activeFurnitureIds.find(
    (id): id is "bed-queen" | "bed-king" => id === "bed-queen" || id === "bed-king",
  );
}

function currentDesk(
  state: DemoStateSnapshot,
): CompareLayoutOptionsInput["candidateFurnitureIds"]["desk"] | undefined {
  return state.activeFurnitureIds.find(
    (id): id is "desk-standard" | "desk-compact" => id === "desk-standard" || id === "desk-compact",
  );
}

function isNegated(normalized: string, term: string, distance = 40): boolean {
  return new RegExp(`\\b(?:do not|don't|not|no|without)\\b[^.!?]{0,${distance}}\\b${term}\\b`).test(
    normalized,
  );
}

export function preferredLayoutIntentDelta(state: DemoStateSnapshot, prompt: string): LayoutIntentDelta {
  const normalized = prompt.toLowerCase();
  const mentionsKing = /\bking(?:-size)?\b/.test(normalized);
  const mentionsQueen = /\bqueen(?:-size)?\b/.test(normalized);
  const mentionsCrib = /\bcrib\b/.test(normalized);
  const kingNegated = isNegated(normalized, "king");
  const queenNegated = isNegated(normalized, "queen");
  let bed: LayoutIntentDelta["bed"] = "keep";
  if (mentionsKing && !kingNegated) {
    bed = "king";
  } else if (mentionsQueen && !queenNegated) {
    bed = "queen";
  }

  const removeCrib =
    /\b(?:remove|without|no)\b[^.!?]{0,30}\bcrib\b/.test(normalized) ||
    /\b(?:do not|don't)\b[^.!?]{0,30}\b(?:add|keep|use)?\s*(?:the\s+)?crib\b/.test(normalized);
  const keepCrib =
    /\b(?:keep|retain|leave)\s+(?:the\s+)?crib\b/.test(normalized) ||
    /\b(?:keep|retain|leave)\s+(?:the\s+)?(?:desk|bed)\s+and\s+(?:the\s+)?crib\b/.test(normalized) ||
    /\bcrib\b[^.!?]{0,30}\b(?:stays?|remain|unchanged)\b/.test(normalized);
  let crib: LayoutIntentDelta["crib"] = "keep";
  if (removeCrib) {
    crib = "remove";
  } else if (mentionsCrib) {
    crib = keepCrib || state.activeFurnitureIds.includes("crib-standard") ? "keep" : "add";
  }

  const compactMention =
    /\b(?:compact|smaller|small)\b[^.!?]{0,20}\b(?:desk|workstation)\b/.test(normalized) ||
    /\b(?:desk|workstation)\b[^.!?]{0,20}\b(?:compact|smaller|small)\b/.test(normalized);
  const standardMention =
    /\b(?:standard|regular|full-size)\b[^.!?]{0,20}\b(?:desk|workstation)\b/.test(normalized) ||
    /\b(?:desk|workstation)\b[^.!?]{0,20}\b(?:standard|regular|full-size)\b/.test(normalized);
  const compactNegated = isNegated(normalized, "(?:compact|smaller|small)");
  const standardNegated = isNegated(normalized, "(?:standard|regular|full-size)");
  const keepDesk =
    /\b(?:keep|retain|leave)\s+(?:the\s+)?(?:current\s+)?(?:desk|workstation)\b/.test(normalized) ||
    /\b(?:keep|retain|leave)\s+(?:the\s+)?(?:bed|crib)\s+and\s+(?:the\s+)?(?:desk|workstation)\b/.test(
      normalized,
    ) ||
    /\b(?:desk|workstation)\b[^.!?]{0,35}\b(?:stays?|remain|unchanged|alone)\b/.test(normalized);
  const mentionsDesk = /\b(?:desk|workstation)\b/.test(normalized);
  let desk: LayoutIntentDelta["desk"];
  if (compactMention && !compactNegated) {
    desk = "compact";
  } else if (standardMention && !standardNegated) {
    desk = "standard";
  } else if (keepDesk) {
    desk = "keep";
  } else if (mentionsDesk || crib === "add") {
    desk = "flexible";
  } else {
    desk = "keep";
  }

  const unknownTerms = detectUnsupportedCatalogTerms(prompt);
  return {
    bed,
    desk,
    crib,
    changedPreference: prompt,
    clarification: unknownTerms.length > 0 ? "required" : "none",
  };
}

export function resolveCandidateFurnitureIds(
  intentDelta: LayoutIntentDelta,
  state: DemoStateSnapshot,
): CompareLayoutOptionsInput["candidateFurnitureIds"] {
  const activeBed = currentBed(state);
  const activeDesk = currentDesk(state);
  const bed =
    intentDelta.bed === "queen"
      ? "bed-queen"
      : intentDelta.bed === "king"
        ? "bed-king"
        : (activeBed ?? "bed-queen");
  const crib =
    intentDelta.crib === "add"
      ? "crib-standard"
      : intentDelta.crib === "remove"
        ? null
        : state.activeFurnitureIds.includes("crib-standard")
          ? "crib-standard"
          : null;
  const desk =
    intentDelta.desk === "standard"
      ? "desk-standard"
      : intentDelta.desk === "compact"
        ? "desk-compact"
        : intentDelta.desk === "keep"
          ? (activeDesk ?? (crib === "crib-standard" ? "desk-compact" : "desk-standard"))
          : crib === "crib-standard"
            ? "desk-compact"
            : (activeDesk ?? "desk-standard");
  return { bed, desk, crib };
}

export function buildCompareLayoutOptionsInput(
  intentDelta: LayoutIntentDelta,
  state: DemoStateSnapshot,
): CompareLayoutOptionsInput {
  const candidateFurnitureIds = resolveCandidateFurnitureIds(intentDelta, state);
  const candidateIds = new Set(expandCandidateFurnitureIds(candidateFurnitureIds));
  const unknowns = detectUnsupportedCatalogTerms(intentDelta.changedPreference).map(
    (term) => `Missing verified catalog dimensions for ${term}.`,
  );
  return compareLayoutOptionsInputSchema.parse({
    roomPlanId: ROOM_PLAN_ID,
    planVersion: ROOM_PLAN_VERSION,
    priorStateRef: state.stateRef,
    clearanceRuleSetId: CLEARANCE_RULE_SET_ID,
    clearanceRuleSetVersion: CLEARANCE_RULE_SET_VERSION,
    requiredRoomStateSetId: REQUIRED_ROOM_STATE_SET_ID,
    lockedConstraintSetId: LOCKED_CONSTRAINT_SET_ID,
    unit: "mm",
    candidateFurnitureIds,
    retainFurnitureIds: state.activeFurnitureIds.filter((id) => candidateIds.has(id)),
    changedPreference: intentDelta.changedPreference,
    unknowns,
    clarificationNeeded: intentDelta.clarification === "required",
  });
}
