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

export const compareLayoutPlannerJsonSchema = JSON.parse(
  JSON.stringify(compareLayoutOptionsJsonSchema, (key, value) => (key === "uniqueItems" ? undefined : value)),
) as Record<string, unknown>;

export function createPlannerJsonSchema(
  state: DemoStateSnapshot,
  options: { readonly allowClarification?: boolean; readonly prompt?: string } = {},
): Record<string, unknown> {
  const schema = structuredClone(compareLayoutPlannerJsonSchema);
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const retained = properties.retainFurnitureIds;
  if (retained !== undefined) {
    retained.maxItems = state.activeFurnitureIds.length;
    if (state.activeFurnitureIds.length > 0) {
      retained.items = {
        type: "string",
        enum: state.activeFurnitureIds,
      };
    }
  }
  const unsupportedTerms = options.prompt ? detectUnsupportedCatalogTerms(options.prompt) : [];
  if (unsupportedTerms.length > 0) {
    const unknowns = properties.unknowns;
    if (unknowns !== undefined) {
      const requiredUnknowns = unsupportedTerms.map(
        (term) => `Missing verified catalog dimensions for ${term}.`,
      );
      unknowns.minItems = requiredUnknowns.length;
      unknowns.maxItems = requiredUnknowns.length;
      unknowns.items = {
        type: "string",
        enum: requiredUnknowns,
      };
    }
    const clarification = properties.clarificationNeeded;
    if (clarification !== undefined) {
      clarification.enum = [true];
    }
  } else if (options.allowClarification !== true) {
    const unknowns = properties.unknowns;
    if (unknowns !== undefined) {
      unknowns.maxItems = 0;
    }
    const clarification = properties.clarificationNeeded;
    if (clarification !== undefined) {
      clarification.enum = [false];
    }
  }
  if (options.prompt) {
    const preferred = preferredCandidateFurnitureIds(state, options.prompt);
    const preferredIds = new Set(expandCandidateFurnitureIds(preferred));
    const expectedRetained = state.activeFurnitureIds.filter((id) => preferredIds.has(id));
    const candidate = properties.candidateFurnitureIds;
    const candidateProperties = candidate?.properties as Record<string, Record<string, unknown>> | undefined;
    if (candidateProperties !== undefined) {
      candidateProperties.bed = {
        ...candidateProperties.bed,
        enum: preferred.bed === "bed-king" ? ["bed-king", "bed-queen"] : ["bed-queen", "bed-king"],
      };
      candidateProperties.desk = {
        ...candidateProperties.desk,
        enum:
          preferred.desk === "desk-compact"
            ? ["desk-compact", "desk-standard"]
            : ["desk-standard", "desk-compact"],
      };
      candidateProperties.crib = {
        ...candidateProperties.crib,
        enum: preferred.crib === "crib-standard" ? ["crib-standard", null] : [null, "crib-standard"],
      };
    }
    if (retained !== undefined) {
      retained.minItems = expectedRetained.length;
      retained.maxItems = expectedRetained.length;
      if (expectedRetained.length > 0) {
        retained.items = {
          type: "string",
          enum: expectedRetained,
        };
      }
    }
  }
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
  const incorrectlyUnknown = input.unknowns.filter((unknown) => {
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
  const normalized = prompt.toLowerCase();
  const currentBed = state.activeFurnitureIds.find(
    (id): id is "bed-queen" | "bed-king" => id === "bed-queen" || id === "bed-king",
  );
  const currentDesk = state.activeFurnitureIds.find(
    (id): id is "desk-standard" | "desk-compact" => id === "desk-standard" || id === "desk-compact",
  );
  const expected: CompareLayoutOptionsInput["candidateFurnitureIds"] = {
    bed: currentBed ?? "bed-queen",
    desk: currentDesk ?? "desk-standard",
    crib: state.activeFurnitureIds.includes("crib-standard") ? "crib-standard" : null,
  };
  const mentionsKing = /\bking(?:-size)?\b/.test(normalized);
  const mentionsQueen = /\bqueen(?:-size)?\b/.test(normalized);
  const mentionsCrib = /\bcrib\b/.test(normalized);

  const kingNegated = /\b(?:do not|don't|not|no)\b[^.!?]{0,40}\bking\b/.test(normalized);
  const queenNegated = /\b(?:do not|don't|not|no)\b[^.!?]{0,40}\bqueen\b/.test(normalized);
  if (mentionsKing && !kingNegated) {
    expected.bed = "bed-king";
  } else if (mentionsQueen && !queenNegated) {
    expected.bed = "bed-queen";
  }

  if (normalized.includes("compact desk") || normalized.includes("smaller desk")) {
    expected.desk = "desk-compact";
  } else if (normalized.includes("standard desk")) {
    expected.desk = "desk-standard";
  }

  const removeCrib =
    /\b(?:remove|without|no)\b[^.!?]{0,30}\bcrib\b/.test(normalized) ||
    /\b(?:do not|don't)\b[^.!?]{0,30}\b(?:add|keep|use)?\s*(?:the\s+)?crib\b/.test(normalized);
  if (removeCrib) {
    expected.crib = null;
  } else if (mentionsCrib) {
    expected.crib = "crib-standard";
    if (!normalized.includes("standard desk")) {
      expected.desk = "desk-compact";
    }
  }
  return expected;
}
