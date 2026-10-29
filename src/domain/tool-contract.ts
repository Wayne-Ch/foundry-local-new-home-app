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
const deskIntentValues = ["keep", "flexible", "standard", "compact"] as const;
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
      description:
        "Use queen or king when the request selects that resulting bed, including the target of replace/from-to wording. Use keep only when the bed is unchanged.",
    },
    desk: {
      type: "string",
      enum: deskIntentValues,
      description:
        "Use standard or compact when named, flexible when a desk size is unspecified or may adjust, and keep only when the desk is unchanged.",
    },
    crib: {
      type: "string",
      enum: cribIntentValues,
      description:
        "Use add when the request adds or brings in a crib, remove when it removes one, and keep when unmentioned, retained, or explicitly not removed.",
    },
    changedPreference: {
      type: "string",
    },
    clarification: {
      type: "string",
      enum: ["none", "required"],
      description:
        "Use none for supported unambiguous requests. Use required only for unsupported furniture, conflicting choices, or a missing required choice.",
    },
  },
  required: ["bed", "desk", "crib", "changedPreference", "clarification"],
} as const;

export function createIntentDeltaJsonSchema(
  _state: DemoStateSnapshot,
  prompt: string,
): Record<string, unknown> {
  const schema = structuredClone(layoutIntentDeltaJsonSchema) as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  properties.changedPreference = {
    ...properties.changedPreference,
    enum: [prompt],
  };
  return schema;
}

const supportedFurniturePatterns = [
  /\bqueen(?:[-\s]?size(?:d)?)?(?:\s+bed)?\b/,
  /\bking(?:[-\s]?size(?:d)?)?(?:\s+bed)?\b/,
  /\b(?:standard|regular(?:[-\s]?size(?:d)?)?|full[-\s]?size(?:d)?|compact|small|smaller|flexible)?\s*(?:desk|workstation)\b/,
  /\bcrib\b/,
] as const;

const unsupportedFurnitureAliases = [
  "chest of drawers",
  "california king bed",
  "changing table",
  "entertainment center",
  "filing cabinet",
  "murphy bed",
  "bedside table",
  "coffee table",
  "dining table",
  "console table",
  "accent chair",
  "rocking chair",
  "chaise lounge",
  "room divider",
  "shelving unit",
  "bunk bed",
  "twin bed",
  "double bed",
  "full bed",
  "day bed",
  "night stand",
  "side table",
  "end table",
  "book shelf",
  "armchair",
  "nightstand",
  "bassinet",
  "cabinet",
  "dresser",
  "wardrobe",
  "armoire",
  "bookshelf",
  "bookcase",
  "recliner",
  "loveseat",
  "ottoman",
  "credenza",
  "sideboard",
  "headboard",
  "footboard",
  "cradle",
  "daybed",
  "futon",
  "vanity",
  "hutch",
  "locker",
  "trunk",
  "bench",
  "stool",
  "couch",
  "sofa",
  "chair",
  "table",
  "shelf",
  "pouf",
  "cot",
] as const;

const ordinaryNonFurnitureTerms = new Set([
  "access",
  "answer",
  "change",
  "clearance",
  "closet",
  "color",
  "dimension",
  "discussion",
  "door",
  "explanation",
  "floor",
  "layout",
  "lighting",
  "measurement",
  "note",
  "option",
  "path",
  "plan",
  "preference",
  "result",
  "room",
  "space",
  "wall",
  "warmth",
  "window",
]);

function normalizePromptText(value: string): string {
  return value.toLowerCase().replaceAll(/[’‘]/g, "'").replaceAll(/[–—]/g, "-").replaceAll(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSupportedFurniturePhrase(phrase: string): boolean {
  return supportedFurniturePatterns.some((pattern) => pattern.test(phrase));
}

function canonicalUnsupportedFurniturePhrase(phrase: string): string | null {
  const normalized = phrase
    .replace(/^(?:(?:and|or)\s+)?(?:a|an|the|my|our|current)?\s*/, "")
    .replace(/\s+(?:fit|here|there|instead|together)$/g, "")
    .trim();
  if (
    normalized.length === 0 ||
    isSupportedFurniturePhrase(normalized) ||
    ordinaryNonFurnitureTerms.has(normalized)
  ) {
    return null;
  }
  const alias = unsupportedFurnitureAliases.find((candidate) =>
    new RegExp(`\\b${escapeRegex(candidate)}\\b`).test(normalized),
  );
  if (alias !== undefined) {
    return alias;
  }
  const words = normalized.split(" ");
  const head = words.at(-1);
  if (head === undefined || ordinaryNonFurnitureTerms.has(head)) {
    return null;
  }
  return normalized;
}

export function detectUnsupportedCatalogTerms(prompt: string): string[] {
  const normalized = normalizePromptText(prompt);
  const matches = new Set<string>();
  for (const alias of unsupportedFurnitureAliases) {
    if (new RegExp(`\\b${escapeRegex(alias)}\\b`).test(normalized)) {
      matches.add(alias);
    }
  }

  const relationalPatterns = [
    /\b(?:(?:a|an|the)\s+)?([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})\s+(?:beside|next to|near|against)\s+(?:(?:a|an|the)\s+)?(?:queen|king|bed|desk|crib)\b/g,
    /\b(?:can|could|will|would)\s+(?:a|an|the)\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})\s+fit\b/g,
  ] as const;
  for (const pattern of relationalPatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const candidate = match[1] ? canonicalUnsupportedFurniturePhrase(match[1]) : null;
      if (candidate !== null) {
        matches.add(candidate);
      }
    }
  }

  if (
    matches.size === 0 &&
    /\b(?:missing|unknown|unverified)\b[^.!?]{0,40}\b(?:dimension|measurement)/.test(normalized)
  ) {
    return ["requested item"];
  }
  return [...matches];
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

export function formatIntentValidationCorrection(
  error: ToolValidationError,
  state: DemoStateSnapshot,
  prompt: string,
): string {
  const analysis = analyzeLayoutPrompt(state, prompt);
  const requiredExactValues = {
    ...(analysis.allowed.bed.length === 1 ? { bed: analysis.allowed.bed[0] } : {}),
    ...(analysis.allowed.desk.length === 1 ? { desk: analysis.allowed.desk[0] } : {}),
    ...(analysis.allowed.crib.length === 1 ? { crib: analysis.allowed.crib[0] } : {}),
    changedPreference: prompt,
    clarification: analysis.clarification,
  };
  return [
    "",
    "APPLICATION_VALIDATION_REJECTED:",
    ...error.details.map((detail) => `- ${detail}`),
    `REQUIRED_EXACT_VALUES: ${JSON.stringify(requiredExactValues)}`,
    `ALLOWED_VALUES_FOR_THIS_REQUEST: ${JSON.stringify({
      bed: analysis.allowed.bed,
      desk: analysis.allowed.desk,
      crib: analysis.allowed.crib,
      changedPreference: [prompt],
      clarification: [analysis.clarification],
    })}`,
    "Return a new complete JSON object, choosing one value from each allowed array.",
  ].join("\n");
}

interface PromptIntentAnalysis {
  readonly allowed: {
    readonly bed: readonly LayoutIntentDelta["bed"][];
    readonly desk: readonly LayoutIntentDelta["desk"][];
    readonly crib: readonly LayoutIntentDelta["crib"][];
  };
  readonly preferred: {
    readonly bed: LayoutIntentDelta["bed"];
    readonly desk: LayoutIntentDelta["desk"];
    readonly crib: LayoutIntentDelta["crib"];
  };
  readonly clarification: LayoutIntentDelta["clarification"];
  readonly unknowns: readonly string[];
}

interface FieldIntentAnalysis<T extends string> {
  readonly allowed: readonly T[];
  readonly preferred: T;
  readonly issues: readonly string[];
  readonly mentioned: boolean;
}

type BedVariant = "queen" | "king";
type DeskVariant = "standard" | "compact";

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function intentClauses(normalized: string): string[] {
  return normalized
    .split(/\s*(?:[.!?;]+|,\s*|\bbut\b)\s*/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function currentBedVariant(state: DemoStateSnapshot): BedVariant | null {
  const bed = currentBed(state);
  return bed === "bed-king" ? "king" : bed === "bed-queen" ? "queen" : null;
}

function currentDeskVariant(state: DemoStateSnapshot): DeskVariant | null {
  const desk = currentDesk(state);
  return desk === "desk-compact" ? "compact" : desk === "desk-standard" ? "standard" : null;
}

function preservingBedValues(state: DemoStateSnapshot): readonly LayoutIntentDelta["bed"][] {
  return currentBedVariant(state) === "king" ? ["keep", "king"] : ["keep", "queen"];
}

function preservingDeskValues(state: DemoStateSnapshot): readonly LayoutIntentDelta["desk"][] {
  const current = currentDeskVariant(state);
  return current === null ? ["keep", "standard"] : ["keep", current];
}

function bedTransition(clause: string): {
  readonly sources: readonly BedVariant[];
  readonly targets: readonly BedVariant[];
  readonly rest: string;
} {
  const sources: BedVariant[] = [];
  const targets: BedVariant[] = [];
  const suffix = "(?:[-\\s]?size(?:d)?)?(?:\\s+bed)?";
  const patterns = [
    new RegExp(
      `\\b(?:replace|swap(?:\\s+out)?|change)\\s+(?:a\\s+|the\\s+)?(?<source>queen|king)${suffix}\\s+(?:with|for|to)\\s+(?:a\\s+|the\\s+)?(?<target>queen|king)${suffix}`,
      "g",
    ),
    new RegExp(
      `\\b(?:switch|change|move|go)\\s+from\\s+(?:a\\s+|the\\s+)?(?<source>queen|king)${suffix}\\s+to\\s+(?:a\\s+|the\\s+)?(?<target>queen|king)${suffix}`,
      "g",
    ),
    new RegExp(
      `\\bfrom\\s+(?:a\\s+|the\\s+)?(?<source>queen|king)${suffix}\\s+to\\s+(?:a\\s+|the\\s+)?(?<target>queen|king)${suffix}`,
      "g",
    ),
    new RegExp(
      `\\b(?:a\\s+|the\\s+)?(?<target>queen|king)${suffix}\\s+(?:instead|rather\\s+than)\\s+(?:of\\s+)?(?:a\\s+|the\\s+)?(?<source>queen|king)${suffix}`,
      "g",
    ),
  ] as const;
  let rest = clause;
  for (const pattern of patterns) {
    rest = rest.replace(pattern, (...args: unknown[]) => {
      const groups = args.at(-1) as { readonly source?: BedVariant; readonly target?: BedVariant };
      if (groups.source !== undefined && groups.target !== undefined) {
        sources.push(groups.source);
        targets.push(groups.target);
      }
      return " ";
    });
  }
  return { sources, targets, rest };
}

function clauseNegatesBedVariant(clause: string, variant: BedVariant): boolean {
  const term = `${variant}(?:[-\\s]?size(?:d)?)?(?:\\s+bed)?`;
  return (
    new RegExp(
      `\\b(?:do not|don't|never)\\s+(?:(?:keep|use|choose|select|try|prefer|want|need|switch|change|move|go)(?:\\s+the\\s+bed)?(?:\\s+to)?\\s+)(?:a\\s+|the\\s+)?${term}\\b`,
    ).test(clause) || new RegExp(`\\b(?:not|no|without)\\s+(?:a\\s+|the\\s+)?${term}\\b`).test(clause)
  );
}

function analyzeBedIntent(
  state: DemoStateSnapshot,
  normalized: string,
): FieldIntentAnalysis<LayoutIntentDelta["bed"]> {
  const current = currentBedVariant(state);
  const targets = new Set<BedVariant>();
  const excluded = new Set<BedVariant>();
  const issues: string[] = [];
  let mentioned = false;
  let keepRequested = false;
  let genericBedMention = false;

  for (const clause of intentClauses(normalized)) {
    const transition = bedTransition(clause);
    for (let index = 0; index < transition.targets.length; index += 1) {
      const source = transition.sources[index];
      const target = transition.targets[index];
      if (source !== undefined && target !== undefined) {
        mentioned = true;
        if (source === target) {
          issues.push(`Clarify the bed transition because both sides name ${target}.`);
        } else {
          targets.add(target);
        }
        if (current === null || source !== current) {
          issues.push(
            `The request says to replace ${source}, but the current accepted bed is ${current ?? "not set"}.`,
          );
        }
      }
    }

    const rest = transition.rest;
    for (const variant of ["queen", "king"] as const) {
      const pattern = new RegExp(`\\b${variant}(?:[-\\s]?size(?:d)?)?(?:\\s+bed)?\\b`);
      if (!pattern.test(rest)) {
        continue;
      }
      mentioned = true;
      if (clauseNegatesBedVariant(rest, variant)) {
        excluded.add(variant);
      } else {
        targets.add(variant);
      }
    }

    if (
      /\b(?:keep|retain|leave)\b[^.!?]{0,30}\b(?:queen|king|bed)\b/.test(clause) ||
      /\b(?:queen|king|bed)\b[^.!?]{0,20}\b(?:stays?|remains?|unchanged|alone)\b/.test(clause) ||
      /\b(?:do not|don't|never)\s+(?:change|replace|switch)\b[^.!?]{0,20}\bbed\b/.test(clause)
    ) {
      keepRequested = true;
      mentioned = true;
    }
    if (
      /\b(?:remove|take out|get rid of)\b[^.!?]{0,20}\bbed\b/.test(clause) ||
      /\b(?:without|no)\s+(?:a\s+|the\s+)?bed\b/.test(clause)
    ) {
      issues.push("Removing the bed is outside the supported Queen/King layout choices.");
      mentioned = true;
    }
    if (/\bbed\b/.test(clause) && !/\b(?:queen|king)\b/.test(clause)) {
      genericBedMention = true;
      mentioned = true;
    }
  }

  for (const target of targets) {
    if (excluded.has(target)) {
      issues.push(`The request both selects and rejects the ${target} bed.`);
    }
  }
  if (targets.size > 1) {
    issues.push("Clarify whether the resulting bed should be Queen or King.");
  }
  if (targets.size === 0 && genericBedMention && !keepRequested) {
    issues.push("Clarify whether the requested bed should be Queen or King.");
  }
  if (targets.size === 0 && current !== null && excluded.has(current)) {
    issues.push(`The request rejects the current ${current} bed without choosing its replacement.`);
  }

  if (issues.length > 0) {
    return {
      allowed: preservingBedValues(state),
      preferred: "keep",
      issues: unique(issues),
      mentioned,
    };
  }

  const [target] = [...targets];
  if (target !== undefined) {
    return {
      allowed: unique([target, ...(keepRequested && current === target ? (["keep"] as const) : [])]),
      preferred: target,
      issues: [],
      mentioned: true,
    };
  }

  return {
    allowed: preservingBedValues(state),
    preferred: "keep",
    issues: [],
    mentioned,
  };
}

function deskVariantFromWord(value: string): DeskVariant {
  return /compact|small/.test(value) ? "compact" : "standard";
}

function deskTransition(clause: string): {
  readonly sources: readonly DeskVariant[];
  readonly targets: readonly DeskVariant[];
  readonly rest: string;
} {
  const sources: DeskVariant[] = [];
  const targets: DeskVariant[] = [];
  const mode = "(?:standard|regular(?:[-\\s]?size(?:d)?)?|full[-\\s]?size(?:d)?|compact|small|smaller)";
  const patterns = [
    new RegExp(
      `\\b(?:replace|swap(?:\\s+out)?|change)\\s+(?:a\\s+|the\\s+)?(?<source>${mode})(?:\\s+(?:desk|workstation))?\\s+(?:with|for|to)\\s+(?:a\\s+|the\\s+)?(?<target>${mode})(?:\\s+(?:desk|workstation))?`,
      "g",
    ),
    new RegExp(
      `\\bfrom\\s+(?:a\\s+|the\\s+)?(?<source>${mode})(?:\\s+(?:desk|workstation))?\\s+to\\s+(?:a\\s+|the\\s+)?(?<target>${mode})(?:\\s+(?:desk|workstation))?`,
      "g",
    ),
  ] as const;
  let rest = clause;
  for (const pattern of patterns) {
    rest = rest.replace(pattern, (...args: unknown[]) => {
      const groups = args.at(-1) as { readonly source?: string; readonly target?: string };
      if (groups.source !== undefined && groups.target !== undefined) {
        sources.push(deskVariantFromWord(groups.source));
        targets.push(deskVariantFromWord(groups.target));
      }
      return " ";
    });
  }
  return { sources, targets, rest };
}

function analyzeDeskIntent(
  state: DemoStateSnapshot,
  normalized: string,
  crib: FieldIntentAnalysis<LayoutIntentDelta["crib"]>,
): FieldIntentAnalysis<LayoutIntentDelta["desk"]> {
  const current = currentDeskVariant(state);
  const targets = new Set<DeskVariant>();
  const excluded = new Set<DeskVariant>();
  const issues: string[] = [];
  let mentioned = false;
  let keepRequested = false;
  let flexibleRequested = false;
  let genericDeskMention = false;

  for (const clause of intentClauses(normalized)) {
    const transition = deskTransition(clause);
    for (let index = 0; index < transition.targets.length; index += 1) {
      const source = transition.sources[index];
      const target = transition.targets[index];
      if (source !== undefined && target !== undefined) {
        mentioned = true;
        targets.add(target);
        if (current === null || source !== current) {
          issues.push(
            `The request says to replace the ${source} desk, but the current accepted desk is ${current ?? "not set"}.`,
          );
        }
      }
    }
    const rest = transition.rest;
    const compactMention =
      /\b(?:compact|small|smaller)\b[^.!?]{0,24}\b(?:desk|workstation)\b/.test(rest) ||
      /\b(?:desk|workstation)\b[^.!?]{0,24}\b(?:compact|small|smaller)\b/.test(rest);
    const standardMention =
      /\b(?:standard|regular(?:[-\s]?size(?:d)?)?|full[-\s]?size(?:d)?)\b[^.!?]{0,24}\b(?:desk|workstation)\b/.test(
        rest,
      ) ||
      /\b(?:desk|workstation)\b[^.!?]{0,24}\b(?:standard|regular(?:[-\s]?size(?:d)?)?|full[-\s]?size(?:d)?)\b/.test(
        rest,
      );
    if (compactMention) {
      mentioned = true;
      if (/\b(?:do not|don't|never|not|no)\b[^.!?]{0,18}\b(?:compact|small|smaller)\b/.test(rest)) {
        excluded.add("compact");
      } else {
        targets.add("compact");
      }
    }
    if (standardMention) {
      mentioned = true;
      if (/\b(?:do not|don't|never|not|no)\b[^.!?]{0,18}\b(?:standard|regular|full[-\s]?size)\b/.test(rest)) {
        excluded.add("standard");
      } else {
        targets.add("standard");
      }
    }
    if (
      /\b(?:keep|retain|leave)\b[^.!?]{0,30}\b(?:desk|workstation)\b/.test(clause) ||
      /\b(?:desk|workstation)\b[^.!?]{0,20}\b(?:stays?|remains?|unchanged|alone|same)\b/.test(clause) ||
      /\b(?:do not|don't|never)\s+(?:change|replace|switch)\b[^.!?]{0,20}\b(?:desk|workstation)\b/.test(
        clause,
      )
    ) {
      keepRequested = true;
      mentioned = true;
    }
    if (
      /\b(?:flexible|adjustable)\b[^.!?]{0,20}\b(?:desk|workstation)\b/.test(clause) ||
      /\b(?:let|allow)\b[^.!?]{0,24}\b(?:desk|workstation)\b[^.!?]{0,24}\b(?:change|adjust|vary)\b/.test(
        clause,
      ) ||
      /\b(?:desk|workstation)\b[^.!?]{0,24}\b(?:may|can|could)\b[^.!?]{0,12}\b(?:change|adjust|vary)\b/.test(
        clause,
      ) ||
      /\bwhatever\b[^.!?]{0,12}\b(?:desk|workstation)\b/.test(clause)
    ) {
      flexibleRequested = true;
      mentioned = true;
    }
    if (
      /\b(?:remove|take out|get rid of)\b[^.!?]{0,20}\b(?:desk|workstation)\b/.test(clause) ||
      /\b(?:without|no)\s+(?:a\s+|the\s+)?(?:desk|workstation)\b/.test(clause) ||
      /\b(?:do not|don't|never)\s+keep\b[^.!?]{0,20}\b(?:desk|workstation)\b/.test(clause)
    ) {
      issues.push("Removing the desk is outside the supported standard/compact layout choices.");
      mentioned = true;
    }
    if (/\b(?:desk|workstation)\b/.test(clause)) {
      genericDeskMention = true;
      mentioned = true;
    }
  }

  for (const target of targets) {
    if (excluded.has(target)) {
      issues.push(`The request both selects and rejects the ${target} desk.`);
    }
  }
  if (targets.size > 1 || (targets.size > 0 && flexibleRequested)) {
    issues.push("Clarify whether the desk should be standard, compact, or flexible.");
  }
  if (targets.size === 0 && current !== null && excluded.has(current)) {
    issues.push(`The request rejects the current ${current} desk without choosing its replacement.`);
  }

  if (issues.length > 0) {
    return {
      allowed: preservingDeskValues(state),
      preferred: "keep",
      issues: unique(issues),
      mentioned,
    };
  }
  const [target] = [...targets];
  if (target !== undefined) {
    return {
      allowed: unique([target, ...(keepRequested && current === target ? (["keep"] as const) : [])]),
      preferred: target,
      issues: [],
      mentioned: true,
    };
  }
  if (flexibleRequested || (!mentioned && crib.preferred === "add")) {
    return {
      allowed: ["flexible"],
      preferred: "flexible",
      issues: [],
      mentioned: genericDeskMention || flexibleRequested,
    };
  }
  if (genericDeskMention && !keepRequested) {
    return {
      allowed: unique(["flexible", current ?? "standard"]),
      preferred: "flexible",
      issues: [],
      mentioned: true,
    };
  }
  return {
    allowed: preservingDeskValues(state),
    preferred: "keep",
    issues: [],
    mentioned,
  };
}

function analyzeCribIntent(
  state: DemoStateSnapshot,
  normalized: string,
): FieldIntentAnalysis<LayoutIntentDelta["crib"]> {
  const active = state.activeFurnitureIds.includes("crib-standard");
  const actions = new Set<"add" | "remove" | "keep">();
  const issues: string[] = [];
  let mentioned = false;
  let preserveRequested = false;

  for (const clause of intentClauses(normalized)) {
    if (!/\bcrib\b/.test(clause)) {
      continue;
    }
    mentioned = true;
    const doNotRemove =
      /\b(?:do not|don't|never)\s+(?:remove|take out|drop|get rid of)\b[^.!?]{0,20}\bcrib\b/.test(clause);
    const doNotKeep = /\b(?:do not|don't|never)\s+keep\b[^.!?]{0,20}\bcrib\b/.test(clause);
    const doNotAdd = /\b(?:do not|don't|never)\s+(?:add|include|bring in|use)\b[^.!?]{0,20}\bcrib\b/.test(
      clause,
    );
    if (doNotRemove) {
      actions.add("keep");
    }
    if (doNotKeep) {
      actions.add("remove");
    }
    if (doNotAdd) {
      preserveRequested = true;
    }
    if (
      !doNotRemove &&
      (/\b(?:remove|take out|drop|get rid of)\b[^.!?]{0,24}\bcrib\b/.test(clause) ||
        /\b(?:without|no)\s+(?:a\s+|the\s+)?crib\b/.test(clause))
    ) {
      actions.add("remove");
    }
    if (
      /\b(?:do not|don't|never)\b[^.!?]{0,40}\band\s+(?:remove|take out|drop|get rid of)\b[^.!?]{0,20}\bcrib\b/.test(
        clause,
      )
    ) {
      issues.push("Clarify whether the negation also applies to removing the crib.");
    }
    if (
      !doNotAdd &&
      (/\b(?:add|include|bring in|place|use|need|want)\b[^.!?]{0,24}\bcrib\b/.test(clause) ||
        /\bcrib\b[^.!?]{0,20}\b(?:added|included|brought in)\b/.test(clause))
    ) {
      actions.add("add");
    }
    if (
      !doNotKeep &&
      (/\b(?:keep|retain|leave)\s+(?:the\s+)?crib\b/.test(clause) ||
        /\b(?:keep|retain|leave)\b[^.!?]{0,20}\b(?:desk|bed)\s+and\s+(?:the\s+)?crib\b/.test(clause) ||
        /\bcrib\b[^.!?]{0,20}\b(?:stays?|remains?|unchanged)\b/.test(clause))
    ) {
      actions.add("keep");
    }
  }

  if (actions.size > 1) {
    issues.push("Clarify whether the crib should be added, kept, or removed.");
  }
  if (actions.size === 1 && actions.has("keep") && !active && !preserveRequested) {
    issues.push("The request says to keep the crib, but no crib is active in the accepted layout.");
  }

  if (issues.length > 0) {
    return {
      allowed: ["keep"],
      preferred: "keep",
      issues,
      mentioned,
    };
  }
  const [action] = [...actions];
  if (action !== undefined) {
    return {
      allowed: [action],
      preferred: action,
      issues: [],
      mentioned: true,
    };
  }
  if (preserveRequested) {
    return {
      allowed: ["keep"],
      preferred: "keep",
      issues: [],
      mentioned: true,
    };
  }
  if (mentioned) {
    return {
      allowed: [active ? "keep" : "add"],
      preferred: active ? "keep" : "add",
      issues: [],
      mentioned: true,
    };
  }
  return {
    allowed: ["keep"],
    preferred: "keep",
    issues: [],
    mentioned: false,
  };
}

export function analyzeLayoutPrompt(state: DemoStateSnapshot, prompt: string): PromptIntentAnalysis {
  const normalized = normalizePromptText(prompt);
  const unsupportedTerms = detectUnsupportedCatalogTerms(prompt);
  const crib = analyzeCribIntent(state, normalized);
  const bed = analyzeBedIntent(state, normalized);
  const desk = analyzeDeskIntent(state, normalized, crib);
  const unknowns = unique([
    ...unsupportedTerms.map((term) => `Missing verified catalog dimensions for ${term}.`),
    ...bed.issues,
    ...desk.issues,
    ...crib.issues,
  ]);
  return {
    allowed: {
      bed: bed.allowed,
      desk: desk.allowed,
      crib: crib.allowed,
    },
    preferred: {
      bed: bed.preferred,
      desk: desk.preferred,
      crib: crib.preferred,
    },
    clarification: unknowns.length > 0 ? "required" : "none",
    unknowns,
  };
}

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
  const analysis = analyzeLayoutPrompt(state, prompt);
  const toolInput = buildCompareLayoutOptionsInput(intentDelta, state);
  const details: string[] = [];
  if (!analysis.allowed.bed.includes(intentDelta.bed)) {
    details.push(
      `bed must be one of ${analysis.allowed.bed.join(", ")} for USER_REQUEST; received ${intentDelta.bed}.`,
    );
  }
  if (!analysis.allowed.desk.includes(intentDelta.desk)) {
    details.push(
      `desk must be one of ${analysis.allowed.desk.join(", ")} for USER_REQUEST; received ${intentDelta.desk}.`,
    );
  }
  if (!analysis.allowed.crib.includes(intentDelta.crib)) {
    details.push(
      `crib must be one of ${analysis.allowed.crib.join(", ")} for USER_REQUEST; received ${intentDelta.crib}.`,
    );
  }
  if (intentDelta.changedPreference !== prompt) {
    details.push("changedPreference must reproduce USER_REQUEST exactly.");
  }
  if (intentDelta.clarification !== analysis.clarification) {
    details.push(`clarification must be ${analysis.clarification}.`);
  }
  if (details.length > 0) {
    return {
      ok: false,
      error: {
        code:
          intentDelta.clarification !== analysis.clarification
            ? "INCONSISTENT_CLARIFICATION"
            : "DROPPED_CONSTRAINT",
        message: "The semantic delta conflicts with explicit prompt intent or accepted state.",
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

  if (!prompt) {
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
          details: incorrectlyUnknown.map(
            (unknown) => `${unknown} is already covered by verified input data.`,
          ),
        },
      };
    }
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
  const analysis = analyzeLayoutPrompt(state, prompt);
  const details: string[] = [];
  const allowedCandidates: CompareLayoutOptionsInput["candidateFurnitureIds"][] = [];
  for (const bed of analysis.allowed.bed) {
    for (const desk of analysis.allowed.desk) {
      for (const crib of analysis.allowed.crib) {
        allowedCandidates.push(
          resolveCandidateFurnitureIds(
            {
              bed,
              desk,
              crib,
              changedPreference: prompt,
              clarification: analysis.clarification,
            },
            state,
          ),
        );
      }
    }
  }
  if (
    !allowedCandidates.some(
      (candidate) =>
        candidate.bed === input.candidateFurnitureIds.bed &&
        candidate.desk === input.candidateFurnitureIds.desk &&
        candidate.crib === input.candidateFurnitureIds.crib,
    )
  ) {
    details.push(
      `USER_REQUEST allows candidateFurnitureIds=${unique(
        allowedCandidates.map((candidate) => JSON.stringify(candidate)),
      ).join(" or ")}.`,
    );
  }

  const expectedCandidateIds = new Set(expandCandidateFurnitureIds(input.candidateFurnitureIds));
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

  const expectedUnknowns = new Set(analysis.unknowns);
  const actualUnknowns = new Set(input.unknowns);
  for (const unknown of expectedUnknowns) {
    if (!actualUnknowns.has(unknown)) {
      details.push(`unknowns must include ${JSON.stringify(unknown)}.`);
    }
  }
  for (const unknown of actualUnknowns) {
    if (!expectedUnknowns.has(unknown)) {
      details.push(`unknowns contains unsupported evidence ${JSON.stringify(unknown)}.`);
    }
  }
  if (input.clarificationNeeded !== (analysis.clarification === "required")) {
    details.push(`clarificationNeeded must be ${analysis.clarification === "required"}.`);
  }

  return details.length === 0
    ? null
    : {
        code:
          input.clarificationNeeded !== (analysis.clarification === "required") ||
          expectedUnknowns.size !== actualUnknowns.size
            ? "INCONSISTENT_CLARIFICATION"
            : "DROPPED_CONSTRAINT",
        message: "The structured proposal conflicts with explicit user wording or retained state.",
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

export function preferredLayoutIntentDelta(state: DemoStateSnapshot, prompt: string): LayoutIntentDelta {
  const analysis = analyzeLayoutPrompt(state, prompt);
  return {
    bed: analysis.preferred.bed,
    desk: analysis.preferred.desk,
    crib: analysis.preferred.crib,
    changedPreference: prompt,
    clarification: analysis.clarification,
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
  const analysis = analyzeLayoutPrompt(state, intentDelta.changedPreference);
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
    unknowns: analysis.unknowns,
    clarificationNeeded: analysis.clarification === "required",
  });
}
