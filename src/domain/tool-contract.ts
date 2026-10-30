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
const maxUnknownCount = 8;
const maxUnknownLength = 160;

export const layoutIntentDeltaSchema = z
  .object({
    bed: z.enum(bedIntentValues),
    desk: z.enum(deskIntentValues),
    crib: z.enum(cribIntentValues),
    changedPreference: z.string().min(1),
    clarification: z.enum(["none", "required"]),
  })
  .strict();

export type LayoutIntentDelta = z.infer<typeof layoutIntentDeltaSchema>;

const generatedLayoutIntentDeltaSchema = z
  .object({
    bed: z.enum(bedIntentValues),
    desk: z.enum(deskIntentValues),
    crib: z.enum(cribIntentValues),
    changedPreference: z.string().min(1).optional(),
    clarification: z.enum(["none", "required"]),
  })
  .strict();

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
    changedPreference: z.string(),
    unknowns: z.array(z.string().min(1).max(maxUnknownLength)).max(maxUnknownCount),
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
      description: "Exact submitted request preserved by the application.",
    },
    unknowns: {
      type: "array",
      maxItems: maxUnknownCount,
      items: { type: "string", maxLength: maxUnknownLength },
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
    clarification: {
      type: "string",
      enum: ["none", "required"],
      description:
        "Use none for supported unambiguous requests. Use required only for unsupported furniture, conflicting choices, or a missing required choice.",
    },
  },
  required: ["bed", "desk", "crib", "clarification"],
} as const;

export function createIntentDeltaJsonSchema(
  _state: DemoStateSnapshot,
  _prompt: string,
): Record<string, unknown> {
  return structuredClone(layoutIntentDeltaJsonSchema) as Record<string, unknown>;
}

const supportedFurniturePatterns = [
  /^queen(?:[-\s]?size(?:d)?)?(?:\s+bed)?$/,
  /^king(?:[-\s]?size(?:d)?)?(?:\s+bed)?$/,
  /^(?:standard|regular(?:[-\s]?size(?:d)?)?|full[-\s]?size(?:d)?|compact|small|smaller|flexible)?\s*(?:desk|workstation)$/,
  /^crib$/,
] as const;

interface UnsupportedFurnitureLexiconEntry {
  readonly canonical: string;
  readonly source: string;
}

const unsupportedFurnitureLexicon: readonly UnsupportedFurnitureLexiconEntry[] = [
  { canonical: "california king", source: "\\bcalifornia\\s+king(?:\\s+bed)?\\b" },
  { canonical: "chest of drawers", source: "\\bchest\\s+of\\s+drawers\\b" },
  { canonical: "entertainment center", source: "\\bentertainment\\s+center\\b" },
  { canonical: "changing table", source: "\\bchanging\\s+table\\b" },
  { canonical: "filing cabinet", source: "\\bfiling\\s+cabinet\\b" },
  { canonical: "bedside table", source: "\\bbedside\\s+table\\b" },
  { canonical: "console table", source: "\\bconsole\\s+table\\b" },
  { canonical: "rocking chair", source: "\\brocking\\s+chair\\b" },
  { canonical: "chaise lounge", source: "\\bchaise\\s+lounge\\b" },
  { canonical: "shelving unit", source: "\\bshelving\\s+unit\\b" },
  { canonical: "coffee table", source: "\\bcoffee\\s+table\\b" },
  { canonical: "dining table", source: "\\bdining\\s+table\\b" },
  { canonical: "accent chair", source: "\\baccent\\s+chair\\b" },
  { canonical: "room divider", source: "\\broom\\s+divider\\b" },
  { canonical: "murphy bed", source: "\\bmurphy\\s+bed\\b" },
  { canonical: "double bed", source: "\\bdouble\\s+bed\\b" },
  { canonical: "twin bed", source: "\\btwin\\s+bed\\b" },
  { canonical: "full bed", source: "\\bfull\\s+bed\\b" },
  { canonical: "bunk bed", source: "\\bbunk\\s+bed\\b" },
  { canonical: "night stand", source: "\\bnight\\s+stand\\b" },
  { canonical: "side table", source: "\\bside\\s+table\\b" },
  { canonical: "book shelf", source: "\\bbook\\s+shelf\\b" },
  { canonical: "moon pod", source: "\\bmoon\\s+pod\\b" },
  { canonical: "day bed", source: "\\bday\\s+bed\\b" },
  { canonical: "end table", source: "\\bend\\s+table\\b" },
  { canonical: "nightstand", source: "\\bnightstand\\b" },
  { canonical: "armchair", source: "\\barmchair\\b" },
  { canonical: "bassinet", source: "\\bbassinet\\b" },
  { canonical: "cabinet", source: "\\bcabinet\\b" },
  { canonical: "dresser", source: "\\bdresser\\b" },
  { canonical: "wardrobe", source: "\\bwardrobe\\b" },
  { canonical: "armoire", source: "\\barmoire\\b" },
  { canonical: "bookshelf", source: "\\bbookshelf\\b" },
  { canonical: "bookcase", source: "\\bbookcase\\b" },
  { canonical: "recliner", source: "\\brecliner\\b" },
  { canonical: "loveseat", source: "\\bloveseat\\b" },
  { canonical: "ottoman", source: "\\b(?:ottoman)\\b" },
  { canonical: "credenza", source: "\\bcredenza\\b" },
  { canonical: "sideboard", source: "\\bsideboard\\b" },
  { canonical: "headboard", source: "\\bheadboard\\b" },
  { canonical: "footboard", source: "\\bfootboard\\b" },
  { canonical: "cradle", source: "\\bcradle\\b" },
  { canonical: "daybed", source: "\\bdaybed\\b" },
  { canonical: "futon", source: "\\bfuton\\b" },
  { canonical: "vanity", source: "\\bvanity\\b" },
  { canonical: "hutch", source: "\\bhutch\\b" },
  { canonical: "locker", source: "\\b(?:locker)\\b" },
  { canonical: "trunk", source: "\\btrunk\\b" },
  { canonical: "bench", source: "\\bbench\\b" },
  { canonical: "stool", source: "\\bstool\\b" },
  { canonical: "couch", source: "\\bcouch\\b" },
  { canonical: "chair", source: "\\bchair\\b" },
  { canonical: "table", source: "\\btable\\b" },
  { canonical: "shelf", source: "\\bshelf\\b" },
  { canonical: "sofa", source: "\\bsofa\\b" },
  { canonical: "pouf", source: "\\bpouf\\b" },
  { canonical: "cot", source: "\\bcot\\b" },
] as const;

const ordinaryNonFurnitureTerms = new Set([
  "access",
  "answer",
  "area",
  "change",
  "clear",
  "clearance",
  "closet",
  "color",
  "comfort",
  "comment",
  "context",
  "dimension",
  "discussion",
  "door",
  "explanation",
  "finding",
  "finish",
  "floor",
  "format",
  "guidance",
  "idea",
  "language",
  "layout",
  "lighting",
  "measurement",
  "message",
  "note",
  "option",
  "output",
  "path",
  "plan",
  "preference",
  "report",
  "result",
  "room",
  "route",
  "style",
  "space",
  "summary",
  "text",
  "tone",
  "wall",
  "warmth",
  "window",
]);

const likelyFurnitureHeads = new Set([
  "bag",
  "bed",
  "bench",
  "cabinet",
  "chair",
  "chest",
  "cot",
  "couch",
  "easel",
  "furniture",
  "lamp",
  "pod",
  "rack",
  "rocker",
  "seat",
  "shelf",
  "sofa",
  "stand",
  "stool",
  "storage",
  "table",
  "unit",
]);

const furnitureQualifierSource =
  "(?:a\\s+(?:couple|pair)\\s+of|a|an|the|my|our|current|another|some|any|one|two|three|four|five|six|seven|eight|nine|ten|several|multiple|many|few|both|(?:couple|pair)\\s+of|\\d+)";

const pluralFurnitureHeads = new Map<string, string>([
  ["armchairs", "armchair"],
  ["armoires", "armoire"],
  ["bassinets", "bassinet"],
  ["beds", "bed"],
  ["benches", "bench"],
  ["bookcases", "bookcase"],
  ["bookshelves", "bookshelf"],
  ["cabinets", "cabinet"],
  ["chairs", "chair"],
  ["chests", "chest"],
  ["cots", "cot"],
  ["couches", "couch"],
  ["cradles", "cradle"],
  ["credenzas", "credenza"],
  ["daybeds", "daybed"],
  ["desks", "desk"],
  ["dressers", "dresser"],
  ["easels", "easel"],
  ["footboards", "footboard"],
  ["futons", "futon"],
  ["headboards", "headboard"],
  ["hutches", "hutch"],
  ["lamps", "lamp"],
  ["lockers", "locker"],
  ["loveseats", "loveseat"],
  ["ottomans", "ottoman"],
  ["pods", "pod"],
  ["poufs", "pouf"],
  ["racks", "rack"],
  ["recliners", "recliner"],
  ["rockers", "rocker"],
  ["seats", "seat"],
  ["shelves", "shelf"],
  ["sideboards", "sideboard"],
  ["sofas", "sofa"],
  ["stands", "stand"],
  ["stools", "stool"],
  ["tables", "table"],
  ["trunks", "trunk"],
  ["units", "unit"],
  ["vanities", "vanity"],
  ["wardrobes", "wardrobe"],
  ["workstations", "workstation"],
]);

export type TableReferenceIntent = "presentation" | "physical" | "ambiguous";

type TableContentKind = "abstract" | "physical" | "unknown";

const abstractTableContentHeads = new Set([
  "analysis",
  "answer",
  "comparison",
  "content",
  "data",
  "detail",
  "finding",
  "format",
  "formatted",
  "formatting",
  "information",
  "markdown",
  "metric",
  "option",
  "output",
  "presentation",
  "recommendation",
  "report",
  "result",
  "statistic",
  "summary",
  "text",
  "value",
  "view",
]);

const physicalTableContentHeads = new Set([
  "board",
  "device",
  "equipment",
  "furniture",
  "hardware",
  "item",
  "material",
  "monitor",
  "object",
  "screen",
  "thing",
]);

const tableAbstractOperationVerbs = new Set([
  "compare",
  "format",
  "organize",
  "output",
  "render",
  "summarize",
  "tabulate",
]);
const tableDisplayVerbs = new Set(["display", "present", "show"]);
const tablePhysicalSupportVerbs = new Set(["carry", "hold", "mount", "place", "store", "support"]);
const tableAdditionalActionSource =
  "(?:compare|display|format|organize|present|provide|render|return|show|summarize|tabulate)";
const tableHeadStopWords = new Set([
  "a",
  "an",
  "another",
  "any",
  "both",
  "few",
  "many",
  "multiple",
  "my",
  "one",
  "our",
  "several",
  "some",
  "the",
  "these",
  "this",
  "those",
  "three",
  "two",
]);
const tablePlacementActionSource = "(?:add|bring\\s+in|fit|move|place|position|put|set)";
const tablePlacementActionPattern = new RegExp(`^${tablePlacementActionSource}$`);
const tablePhysicalLocationPattern = new RegExp(
  `\\b(?:beside|near|by|against|next\\s+to|in\\s+front\\s+of|behind|between|along|alongside)\\s+(?:${furnitureQualifierSource}\\s+)?(?:[a-z0-9.-]+\\s+){0,2}(?:beds?|desks?|cribs?|walls?|windows?|doors?|closets?|corners?|floors?|rooms?)\\b`,
);
const tablePhysicalPrepositionPattern = new RegExp(
  `\\b(?:on|onto|upon|under|beneath|beside|near|by|against|next\\s+to|in\\s+front\\s+of)\\s+(?:${furnitureQualifierSource}\\s+)?(?:[a-z0-9.-]+\\s+){0,3}$`,
);
const tableRepresentationPrepositionPattern = new RegExp(
  `\\b(?:in|into|as)\\s+(?:${furnitureQualifierSource}\\s+)?$`,
);
const tableDimensionPattern = /\b\d+(?:\.\d+)?\s*(?:mm|cm|m|inch|inches|ft|foot|feet)\b/;

function normalizePromptText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[’‘]/g, "'")
    .replaceAll(/[–—]/g, "-")
    .replaceAll(/[()[\]{}]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

interface TableReferenceContext {
  readonly clause: string;
  readonly localStart: number;
  readonly tableEnd: number;
  readonly before: string;
  readonly after: string;
}

function normalizedTableHead(word: string): string {
  if (word === "analyses") {
    return "analysis";
  }
  if (word.endsWith("ies") && word.length > 3) {
    return `${word.slice(0, -3)}y`;
  }
  if (
    word.length > 3 &&
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("is") &&
    word !== "data"
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function tableSemanticHead(value: string): string | null {
  const words = value.match(/[a-z]+/g);
  if (words === null) {
    return null;
  }
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word !== undefined && !tableHeadStopWords.has(word)) {
      return normalizedTableHead(word);
    }
  }
  return null;
}

function tableContentKind(value: string): TableContentKind {
  const head = tableSemanticHead(value);
  if (head === null) {
    return "unknown";
  }
  if (abstractTableContentHeads.has(head)) {
    return "abstract";
  }
  if (
    physicalTableContentHeads.has(head) ||
    likelyFurnitureHeads.has(head) ||
    head === "crib" ||
    head === "desk" ||
    head === "workstation"
  ) {
    return "physical";
  }
  return "unknown";
}

function tableReferenceContext(normalized: string, tableStart: number): TableReferenceContext | null {
  const clauseRange = promptClauseRanges(normalized).find(
    (range) => tableStart >= range.start && tableStart < range.end,
  );
  if (clauseRange === undefined) {
    return null;
  }
  const clause = normalized.slice(clauseRange.start, clauseRange.end);
  const localStart = tableStart - clauseRange.start;
  const tableMatch = /^tables?\b/.exec(clause.slice(localStart));
  if (tableMatch === null) {
    return null;
  }
  const tableEnd = localStart + tableMatch[0].length;
  return {
    clause,
    localStart,
    tableEnd,
    before: clause.slice(0, localStart),
    after: clause.slice(tableEnd),
  };
}

function tableContextActions(value: string): RegExpMatchArray[] {
  return [
    ...value.matchAll(new RegExp(`\\b(?:${semanticActionSource}|${tableAdditionalActionSource})\\b`, "g")),
  ];
}

function localTableAfter(value: string): string {
  const normalized = value.replace(/^[\s,:-]+/, "");
  const actionSource = `(?:${semanticActionSource}|${tableAdditionalActionSource})`;
  if (new RegExp(`^(?:and|then)\\s+${actionSource}\\b`).test(normalized)) {
    return "";
  }
  return normalized.split(new RegExp(`[,;]|\\b(?:and|then)\\s+(?=${actionSource}\\b)`), 1)[0] ?? "";
}

function leadingTableRelationPhrase(value: string): string {
  return (
    value
      .replace(/^[\s,:-]+/, "")
      .split(
        /[,;]|\b(?:beside|near|by|against|next\s+to|in\s+front\s+of|behind|between|along|alongside|under|beneath|while|where|because)\b/,
        1,
      )[0]
      ?.trim() ?? ""
  );
}

function tableIntentForContent(kind: TableContentKind): TableReferenceIntent {
  if (kind === "abstract") {
    return "presentation";
  }
  return kind === "physical" ? "physical" : "ambiguous";
}

function classifyTableAfterReference(after: string): TableReferenceIntent | null {
  const normalizedAfter = after.replace(/^[\s,:-]+/, "");
  const relation = /^(of|for|as)\b\s*(.*)$/.exec(normalizedAfter);
  if (relation !== null) {
    const kind = tableContentKind(leadingTableRelationPhrase(relation[2] ?? ""));
    if (relation[1] === "of" && kind === "physical") {
      return "ambiguous";
    }
    return tableIntentForContent(kind);
  }

  const purpose = /^to\s+([a-z]+)\b\s*(.*)$/.exec(normalizedAfter);
  if (purpose !== null) {
    const verb = purpose[1] ?? "";
    if (tablePhysicalSupportVerbs.has(verb)) {
      return "physical";
    }
    if (tableAbstractOperationVerbs.has(verb)) {
      return "presentation";
    }
    if (tableDisplayVerbs.has(verb)) {
      return tableIntentForContent(tableContentKind(leadingTableRelationPhrase(purpose[2] ?? "")));
    }
    return "ambiguous";
  }

  const postfix = leadingTableRelationPhrase(normalizedAfter)
    .split(/\b(?:for|of|to)\b/, 1)[0]
    ?.trim();
  if (!postfix) {
    return null;
  }
  const kind = tableContentKind(postfix);
  return kind === "unknown" ? null : tableIntentForContent(kind);
}

function classifyTableModifier(before: string): TableReferenceIntent | null {
  const modifier = /\b([a-z]+)\s*$/.exec(before)?.[1];
  if (modifier === undefined || tableHeadStopWords.has(modifier)) {
    return null;
  }
  const kind = tableContentKind(modifier);
  return kind === "unknown" ? null : tableIntentForContent(kind);
}

function classifyTableRepresentationObject(context: TableReferenceContext): TableReferenceIntent | null {
  const preposition = tableRepresentationPrepositionPattern.exec(context.before);
  if (preposition === null) {
    return null;
  }
  return tableIntentForContent(tableContentKind(context.before.slice(0, preposition.index)));
}

function tableIsPlacementObject(context: TableReferenceContext, after: string): boolean {
  const action = tableContextActions(context.before).at(-1);
  if (action?.index === undefined) {
    return /^fit\b/.test(after);
  }
  if (!tablePlacementActionPattern.test(action[0])) {
    return false;
  }
  const between = context.before.slice(action.index + action[0].length);
  return !/\b(?:about|as|beside|near|against|by|while|without|into|onto|in|on|under|between|for|from|of|to|with)\b/.test(
    between,
  );
}

function tableHasLayoutCoordination(context: TableReferenceContext, after: string): boolean {
  const beforeCoordination = new RegExp(
    `(?:,\\s*)?(?:and|or|with)\\s+(?:${furnitureQualifierSource}\\s+)?$`,
  ).exec(context.before);
  if (
    beforeCoordination !== null &&
    tableContentKind(context.before.slice(0, beforeCoordination.index)) === "physical"
  ) {
    return true;
  }

  const afterCoordination = new RegExp(
    `^[\\s,:-]*(?:and|or|with)\\s+(?:${furnitureQualifierSource}\\s+)?([^,;]{1,60})`,
  ).exec(after);
  return (
    afterCoordination !== null &&
    tableContentKind(leadingTableRelationPhrase(afterCoordination[1] ?? "")) === "physical"
  );
}

function classifyNormalizedTableReference(normalized: string, tableStart: number): TableReferenceIntent {
  const context = tableReferenceContext(normalized, tableStart);
  if (context === null) {
    return "ambiguous";
  }

  const after = localTableAfter(context.after);
  const nearbyDimensionText = `${context.before.slice(-32)} table ${after.slice(0, 24)}`;
  if (
    tablePhysicalLocationPattern.test(after.slice(0, 120)) ||
    tablePhysicalPrepositionPattern.test(context.before) ||
    tableDimensionPattern.test(nearbyDimensionText) ||
    tableIsPlacementObject(context, after) ||
    tableHasLayoutCoordination(context, after)
  ) {
    return "physical";
  }

  const signals = [
    classifyTableAfterReference(after),
    classifyTableModifier(context.before),
    classifyTableRepresentationObject(context),
  ].filter((signal): signal is TableReferenceIntent => signal !== null);
  if (signals.includes("physical")) {
    return "physical";
  }
  if (signals.includes("ambiguous")) {
    return "ambiguous";
  }
  return signals.includes("presentation") ? "presentation" : "ambiguous";
}

export function classifyTableReference(prompt: string, occurrence = 0): TableReferenceIntent | null {
  if (!Number.isInteger(occurrence) || occurrence < 0) {
    return null;
  }
  const normalized = normalizePromptText(prompt);
  const match = [...normalized.matchAll(/\btables?\b/g)][occurrence];
  return match?.index === undefined ? null : classifyNormalizedTableReference(normalized, match.index);
}

function singularizeFurnitureHead(phrase: string): string {
  const words = phrase.split(" ");
  const head = words.at(-1);
  if (head === undefined) {
    return phrase;
  }
  const singular = pluralFurnitureHeads.get(head);
  if (singular === undefined) {
    return phrase;
  }
  words[words.length - 1] = singular;
  return words.join(" ");
}

function isOrdinaryNonFurnitureWord(word: string): boolean {
  if (ordinaryNonFurnitureTerms.has(word)) {
    return true;
  }
  if (word.endsWith("ies") && ordinaryNonFurnitureTerms.has(`${word.slice(0, -3)}y`)) {
    return true;
  }
  return word.endsWith("s") && ordinaryNonFurnitureTerms.has(word.slice(0, -1));
}

type ActionNegationScope = "none" | "clear" | "ambiguous";

const semanticActionSource =
  "(?:replace|swap(?:\\s+out)?|change|switch|move|go|use|choose|select|try|prefer|want|need|keep|retain|leave|add|include|bring\\s+in|place|put|fit|remove|take\\s+out|drop|get\\s+rid\\s+of)";
const coordinatedActionWrapperSource =
  "(?:(?:do|did|would|could|should)\\s+(?:i|we|you|they|he|she|it)\\s+)?";
const actionModifierPhraseSource =
  "(?:[a-z]+ly|also|at\\s+all|even|ever|in\\s+any\\s+case|just|now|please|still|then|under\\s+any\\s+circumstances)";
const actionModifierSequencePattern = new RegExp(`^(?:(?:${actionModifierPhraseSource})(?:\\s+|$))*$`);

function hasOnlyActionModifiers(value: string): boolean {
  const segments = value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.every((segment) => actionModifierSequencePattern.test(segment));
}

function hasOnlyNegationLead(value: string): boolean {
  const withoutIntentWrapper = value.replace(/\b(?:try|want|need|plan|intend|prefer)\s+to\s*$/, "");
  return hasOnlyActionModifiers(withoutIntentWrapper);
}

function hasDirectActionNegation(prefix: string): boolean {
  const marker = [...prefix.matchAll(/\b(?:do\s+not|don't|never|no\s+longer|neither|not(?:\s+to)?)\b/g)].at(
    -1,
  );
  return marker !== undefined && hasOnlyNegationLead(prefix.slice(marker.index + marker[0].length));
}

function hasLeadingUnpairedNor(prefix: string): boolean {
  const marker = /^\s*,?\s*nor\b/.exec(prefix);
  return marker !== null && hasOnlyActionModifiers(prefix.slice(marker[0].length));
}

function hasPotentialActionNegation(prefix: string): boolean {
  return (
    /\b(?:do\s+not|don't|never|no\s+longer|neither)\b[^.!?;]*$/.test(prefix) ||
    /\bnot(?:\s+to)?\b[^.!?;]*$/.test(prefix) ||
    /\bnor\b[^.!?;]*$/.test(prefix)
  );
}

function hasOnlyKnownActionLead(value: string): boolean {
  const wrapper = new RegExp(`^${coordinatedActionWrapperSource}`).exec(value);
  return wrapper !== null && hasOnlyActionModifiers(value.slice(wrapper[0].length));
}

function hasClearNeitherListScope(clause: string, actionStart: number): boolean {
  const prefix = clause.slice(0, actionStart);
  const lastComma = prefix.lastIndexOf(",");
  if (lastComma < 0 || !hasOnlyKnownActionLead(prefix.slice(lastComma + 1))) {
    return false;
  }
  const beforeComma = prefix.slice(0, lastComma);
  const neither = [...beforeComma.matchAll(/\bneither\b/g)].at(-1);
  if (neither === undefined) {
    return false;
  }
  const firstAction = new RegExp(`\\b${semanticActionSource}\\b`).exec(beforeComma.slice(neither.index));
  if (firstAction === null) {
    return false;
  }
  const firstActionStart = neither.index + firstAction.index;
  if (!hasDirectActionNegation(beforeComma.slice(0, firstActionStart))) {
    return false;
  }
  return new RegExp(`(?:,\\s*|\\s+)nor\\b[^.!?;]*\\b${semanticActionSource}\\b`).test(
    clause.slice(actionStart),
  );
}

function actionNegationScope(clause: string, actionStart: number): ActionNegationScope {
  const prefix = clause.slice(0, actionStart);
  if (hasDirectActionNegation(prefix)) {
    return "clear";
  }
  if (hasClearNeitherListScope(clause, actionStart)) {
    return "clear";
  }

  const conjunction = [...prefix.matchAll(/(?:,\s*|\s+)(and|or|nor)\s+/g)].at(-1);
  if (conjunction === undefined) {
    if (hasLeadingUnpairedNor(prefix) || hasPotentialActionNegation(prefix)) {
      return "ambiguous";
    }
    return "none";
  }
  const word = conjunction[1];
  const beforeConjunction = prefix.slice(0, conjunction.index);
  const afterConjunction = prefix.slice(conjunction.index + conjunction[0].length);
  const precedingNegatedAction = new RegExp(
    `\\b(?:do\\s+not|don't|never|no\\s+longer|not\\s+to|neither)\\b[^.!?;]*\\b${semanticActionSource}\\b`,
  ).test(beforeConjunction);
  if (word === "nor") {
    return precedingNegatedAction && hasOnlyKnownActionLead(afterConjunction) ? "clear" : "ambiguous";
  }
  if (!precedingNegatedAction) {
    return hasPotentialActionNegation(prefix) ? "ambiguous" : "none";
  }
  const coordinatedVerbChain = new RegExp(
    `\\b(?:do\\s+not|don't|never|no\\s+longer|not\\s+to|neither)\\b[^.!?;]*\\b${semanticActionSource}\\s*$`,
  ).test(beforeConjunction);
  return coordinatedVerbChain && hasOnlyKnownActionLead(afterConjunction) ? "clear" : "ambiguous";
}

function targetNegationScope(clause: string, targetStart: number): ActionNegationScope {
  const prefix = clause.slice(0, targetStart);
  if (/\b(?:not|no|without)\s+(?:(?:a|an|the|my|our|any)\s+)?$/.test(prefix)) {
    return "clear";
  }
  const nearestAction = [...prefix.matchAll(new RegExp(`\\b${semanticActionSource}\\b`, "g"))].at(-1);
  return actionNegationScope(clause, nearestAction?.index ?? targetStart);
}

function isSupportedFurniturePhrase(phrase: string): boolean {
  return supportedFurniturePatterns.some((pattern) => pattern.test(phrase));
}

function lexiconMatches(value: string): readonly { readonly term: string; readonly start: number }[] {
  const occupied: { readonly start: number; readonly end: number }[] = [];
  const matches: { readonly term: string; readonly start: number }[] = [];
  for (const entry of unsupportedFurnitureLexicon) {
    for (const match of value.matchAll(new RegExp(entry.source, "g"))) {
      const start = match.index;
      const end = start + match[0].length;
      if (occupied.some((range) => start < range.end && end > range.start)) {
        continue;
      }
      occupied.push({ start, end });
      matches.push({ term: entry.canonical, start });
    }
  }
  return matches;
}

function canonicalUnsupportedFurniturePhrase(phrase: string): string | null {
  const trimmed = phrase.trim();
  const qualifier = new RegExp(`^(?:(?:and|or)\\s+)?${furnitureQualifierSource}\\s+`).exec(trimmed);
  const hasDeterminer = qualifier !== null;
  const normalized = singularizeFurnitureHead(
    trimmed
      .slice(qualifier?.[0].length ?? 0)
      .replace(/\s+(?:fit|here|there|instead|together)$/g, "")
      .replace(/[-,:]+\s*$/g, "")
      .trim(),
  );
  if (normalized.length === 0 || isSupportedFurniturePhrase(normalized)) {
    return null;
  }
  if (normalized === "twin") {
    return "twin bed";
  }
  const [lexiconMatch] = lexiconMatches(normalized);
  if (lexiconMatch !== undefined) {
    return lexiconMatch.term;
  }
  const words = normalized.split(" ");
  const head = words.at(-1);
  if (
    head === undefined ||
    words.some(isOrdinaryNonFurnitureWord) ||
    (!hasDeterminer && !likelyFurnitureHeads.has(head))
  ) {
    return null;
  }
  return normalized;
}

function pluralFurnitureMatches(value: string): readonly { readonly term: string; readonly start: number }[] {
  const matches: { readonly term: string; readonly start: number }[] = [];
  for (const [plural, singular] of pluralFurnitureHeads) {
    if (singular === "bed" || singular === "desk" || singular === "workstation") {
      continue;
    }
    for (const match of value.matchAll(new RegExp(`\\b${escapeRegex(plural)}\\b`, "g"))) {
      matches.push({
        term: canonicalUnsupportedFurniturePhrase(`two ${plural}`) ?? singular,
        start: match.index,
      });
    }
  }
  return matches;
}

interface PromptRange {
  readonly start: number;
  readonly end: number;
}

function promptClauseRanges(normalized: string): PromptRange[] {
  const ranges: PromptRange[] = [];
  const boundary = /[.!?;]+|\bbut\b/g;
  let start = 0;
  for (const match of normalized.matchAll(boundary)) {
    if (match.index > start) {
      ranges.push({ start, end: match.index });
    }
    start = match.index + match[0].length;
  }
  if (start < normalized.length) {
    ranges.push({ start, end: normalized.length });
  }
  return ranges;
}

function requestObjectContainsTerm(clause: string, action: RegExpMatchArray, termStart: number): boolean {
  if (action.index === undefined) {
    return false;
  }
  const between = clause.slice(action.index + action[0].length, termStart);
  if (
    /\b(?:about|as|beside|near|against|by|while|without|where|because|into|onto|in|on|under|between|instead|here|there)\b/.test(
      between,
    )
  ) {
    return false;
  }
  if (action[0] !== "replace" && /\b(?:for|from|of|to)\b/.test(between)) {
    return false;
  }
  return !between
    .split(/[^a-z]+/)
    .filter(Boolean)
    .some((word) => ordinaryNonFurnitureTerms.has(word));
}

function lexiconMatchIsRequested(normalized: string, matchStart: number): boolean {
  const clauseRange = promptClauseRanges(normalized).find(
    (range) => matchStart >= range.start && matchStart < range.end,
  );
  if (clauseRange === undefined) {
    return false;
  }
  const clause = normalized.slice(clauseRange.start, clauseRange.end);
  const localStart = matchStart - clauseRange.start;
  const termPrefix = clause.slice(Math.max(0, localStart - 24), localStart);
  if (/\b(?:without|no|not)\s+(?:(?:a|an|the)\s+)?$/.test(termPrefix)) {
    return false;
  }
  const actions = [
    ...clause
      .slice(0, localStart)
      .matchAll(/\b(?:add|use|include|bring\s+in|place|put|fit|choose|select|try|need|want|replace)\b/g),
  ];
  const nearestAction = actions.at(-1);
  if (nearestAction !== undefined) {
    return (
      actionNegationScope(clause, nearestAction.index) === "none" &&
      requestObjectContainsTerm(clause, nearestAction, localStart)
    );
  }
  const modalObjectFitPattern = new RegExp(
    `\\b(?:can|could|will|would|might)\\s+(?:${furnitureQualifierSource}\\s+)?[^.!?;]{1,80}?\\s+fit\\b`,
    "g",
  );
  return [...clause.matchAll(modalObjectFitPattern)].some(
    (match) => match.index <= localStart && localStart < match.index + match[0].length,
  );
}

function tableComplementIsRequested(normalized: string, tableStart: number): boolean {
  const context = tableReferenceContext(normalized, tableStart);
  if (
    context === null ||
    (!tablePhysicalPrepositionPattern.test(context.before) &&
      !tableRepresentationPrepositionPattern.test(context.before))
  ) {
    return false;
  }
  const nearestAction = tableContextActions(context.before).at(-1);
  return (
    nearestAction?.index !== undefined && actionNegationScope(context.clause, nearestAction.index) === "none"
  );
}

function leadingObjectPhrase(value: string): string | null {
  const trimmed = value.trimStart();
  const delimiter =
    /[,;.!?]|\b(?:and|or|nor|with|for|to|from|beside|next\s+to|near|against|by|while|without|where|because|into|onto|in|on|under|between|instead|here|there)\b/;
  const delimiterMatch = delimiter.exec(trimmed);
  const phrase = trimmed.slice(0, delimiterMatch?.index ?? trimmed.length).trim();
  return phrase.length > 0 ? phrase : null;
}

function actionObjectCandidates(
  normalized: string,
): readonly { readonly phrase: string; readonly start: number }[] {
  const candidates: { readonly phrase: string; readonly start: number }[] = [];
  const directActionPattern = /\b(?:add|use|include|bring\s+in|place|put|fit|choose|select|try|need|want)\b/g;
  const replacePattern = /\breplace\b/g;
  const modalObjectFitPattern = new RegExp(
    `\\b(?:can|could|will|would|might)\\s+(?<object>(?:${furnitureQualifierSource}\\s+)?[^.!?;]{1,80}?)\\s+fit\\b`,
    "g",
  );
  for (const clauseRange of promptClauseRanges(normalized)) {
    const clause = normalized.slice(clauseRange.start, clauseRange.end);
    for (const match of clause.matchAll(directActionPattern)) {
      if (actionNegationScope(clause, match.index) !== "none") {
        continue;
      }
      const phrase = leadingObjectPhrase(clause.slice(match.index + match[0].length));
      if (phrase !== null) {
        candidates.push({
          phrase,
          start: clauseRange.start + match.index + match[0].length,
        });
      }
    }
    for (const match of clause.matchAll(replacePattern)) {
      if (actionNegationScope(clause, match.index) !== "none") {
        continue;
      }
      const restStart = match.index + match[0].length;
      const rest = clause.slice(restStart);
      const separator = /\b(?:with|for|to)\b/.exec(rest);
      const sourcePhrase = leadingObjectPhrase(rest.slice(0, separator?.index ?? rest.length));
      if (sourcePhrase !== null) {
        candidates.push({
          phrase: sourcePhrase,
          start: clauseRange.start + restStart,
        });
      }
      if (separator !== null) {
        const targetStart = restStart + separator.index + separator[0].length;
        const targetPhrase = leadingObjectPhrase(clause.slice(targetStart));
        if (targetPhrase !== null) {
          candidates.push({
            phrase: targetPhrase,
            start: clauseRange.start + targetStart,
          });
        }
      }
    }
    for (const match of clause.matchAll(modalObjectFitPattern)) {
      const phrase = match.groups?.object;
      if (phrase !== undefined) {
        candidates.push({
          phrase: leadingObjectPhrase(phrase) ?? phrase,
          start: clauseRange.start + match.index,
        });
      }
    }
  }
  return candidates;
}

function findUnsupportedCatalogTerms(normalized: string): string[] {
  const matches: { readonly term: string; readonly start: number }[] = [];
  for (const match of [...lexiconMatches(normalized), ...pluralFurnitureMatches(normalized)]) {
    const tableIntent =
      match.term === "table" ? classifyNormalizedTableReference(normalized, match.start) : null;
    const requested =
      lexiconMatchIsRequested(normalized, match.start) ||
      (match.term === "table" && tableComplementIsRequested(normalized, match.start));
    if (tableIntent !== "presentation" && requested) {
      matches.push(match);
    }
  }
  for (const candidate of actionObjectCandidates(normalized)) {
    const term = canonicalUnsupportedFurniturePhrase(candidate.phrase);
    const candidateWindow = normalized.slice(candidate.start, candidate.start + candidate.phrase.length + 32);
    const localTableStart = candidateWindow.search(/\btables?\b/);
    const tableIntent =
      term === "table" && localTableStart >= 0
        ? classifyNormalizedTableReference(normalized, candidate.start + localTableStart)
        : null;
    if (term !== null && tableIntent !== "presentation") {
      matches.push({ term, start: candidate.start });
    }
  }
  const terms = matches
    .sort((left, right) => left.start - right.start || left.term.localeCompare(right.term))
    .map((match) => match.term);
  return unique(terms);
}

function maskUnsupportedCatalogTerms(normalized: string, terms: readonly string[]): string {
  let masked = normalized;
  for (const term of terms) {
    const lexiconSources = unsupportedFurnitureLexicon
      .filter((entry) => entry.canonical === term)
      .map((entry) => entry.source);
    const pluralSources = [...pluralFurnitureHeads]
      .filter(([, singular]) => singular === term)
      .map(([plural]) => `\\b${escapeRegex(plural)}\\b`);
    const sources =
      term === "twin bed"
        ? ["\\btwin(?:\\s+bed)?\\b"]
        : lexiconSources.length + pluralSources.length > 0
          ? [...lexiconSources, ...pluralSources]
          : [`\\b${term.split(" ").map(escapeRegex).join("\\s+")}\\b`];
    for (const source of sources) {
      masked = masked.replace(new RegExp(source, "g"), (match) => " ".repeat(match.length));
    }
  }
  return masked;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectUnsupportedCatalogTerms(prompt: string): string[] {
  const normalized = normalizePromptText(prompt);
  const matches = findUnsupportedCatalogTerms(normalized);
  if (
    matches.length === 0 &&
    /\b(?:missing|unknown|unverified)\b[^.!?]{0,40}\b(?:dimension|measurement)/.test(normalized)
  ) {
    return ["requested item"];
  }
  return matches;
}

const unsupportedUnknownPrefix = "Missing verified catalog dimensions for ";
const unsupportedUnknownSuffix = ".";

function boundedUnknown(value: string): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= maxUnknownLength
    ? normalized
    : `${normalized.slice(0, maxUnknownLength - 3).trimEnd()}...`;
}

function boundedUnknowns(values: readonly string[]): string[] {
  const distinct = unique(values.map((value) => value.replaceAll(/\s+/g, " ").trim()).filter(Boolean));
  const initiallyBounded = distinct.map(boundedUnknown);
  const boundedCounts = new Map<string, number>();
  for (const value of initiallyBounded) {
    boundedCounts.set(value, (boundedCounts.get(value) ?? 0) + 1);
  }
  const bounded = distinct.map((value, index) => {
    const initial = initiallyBounded[index];
    if (initial === undefined || boundedCounts.get(initial) === 1) {
      return initial ?? "";
    }
    const suffix = ` [source ${index + 1}]`;
    const availablePrefixLength = maxUnknownLength - suffix.length - 3;
    return `${value.slice(0, availablePrefixLength).trimEnd()}...${suffix}`;
  });
  const informative = bounded.filter(Boolean);
  if (informative.length <= maxUnknownCount) {
    return informative;
  }
  const retained = informative.slice(0, maxUnknownCount - 1);
  const omittedCount = informative.length - retained.length;
  return [
    ...retained,
    `Additional clarification evidence omitted: ${omittedCount} more item${omittedCount === 1 ? "" : "s"}.`,
  ];
}

function unsupportedFurnitureUnknown(term: string): string {
  const normalized = term.replaceAll(/\s+/g, " ").trim() || "requested item";
  return `${unsupportedUnknownPrefix}${normalized}${unsupportedUnknownSuffix}`;
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
    .split(/\s*(?:[.!?;]+|\bbut\b)\s*/)
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

const ambiguousActionNegationIssue = "Clarify which actions are covered by the negation.";

interface ParsedTransition<T extends string> {
  readonly source: T;
  readonly target: T;
  readonly negation: ActionNegationScope;
  readonly start: number;
  readonly end: number;
}

function transitionNegationScope(
  clause: string,
  transitionStart: number,
  transitionEnd: number,
): ActionNegationScope {
  const suffix = clause.slice(transitionEnd);
  const prefixScope = actionNegationScope(clause, transitionStart);
  if (prefixScope === "ambiguous") {
    return "ambiguous";
  }
  const conjunction = /^\s*,?\s*(and|or|nor)\b/.exec(suffix);
  const coordinatedAction =
    conjunction === null
      ? null
      : new RegExp(`\\b${semanticActionSource}\\b`).exec(suffix.slice(conjunction[0].length));
  if (prefixScope === "clear") {
    if (conjunction === null || coordinatedAction === null || conjunction[1] === "nor") {
      return "clear";
    }
    const coordinatedText = suffix.slice(conjunction[0].length);
    return actionNegationScope(coordinatedText, coordinatedAction.index) === "clear" ? "clear" : "ambiguous";
  }

  if (conjunction?.[1] === "nor" && coordinatedAction !== null) {
    return "ambiguous";
  }
  return "none";
}

function parseTransitions<T extends string>(
  clause: string,
  patterns: readonly RegExp[],
  toVariant: (value: string) => T,
): { readonly transitions: readonly ParsedTransition<T>[]; readonly rest: string } {
  const candidates: Omit<ParsedTransition<T>, "negation">[] = [];
  for (const pattern of patterns) {
    for (const match of clause.matchAll(pattern)) {
      const source = match.groups?.source;
      const target = match.groups?.target;
      if (source !== undefined && target !== undefined) {
        candidates.push({
          source: toVariant(source),
          target: toVariant(target),
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
  }
  const transitions: ParsedTransition<T>[] = [];
  for (const candidate of candidates.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )) {
    if (
      transitions.some((transition) => candidate.start < transition.end && candidate.end > transition.start)
    ) {
      continue;
    }
    transitions.push({
      ...candidate,
      negation: transitionNegationScope(clause, candidate.start, candidate.end),
    });
  }
  const rest = clause.split("");
  for (const transition of transitions) {
    rest.fill(" ", transition.start, transition.end);
  }
  return { transitions, rest: rest.join("") };
}

function bedTransition(clause: string): {
  readonly transitions: readonly ParsedTransition<BedVariant>[];
  readonly rest: string;
} {
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
  return parseTransitions(clause, patterns, (value) => value as BedVariant);
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
  let preserveOnly = false;

  for (const clause of intentClauses(normalized)) {
    const transition = bedTransition(clause);
    for (const parsed of transition.transitions) {
      mentioned = true;
      if (parsed.negation !== "none") {
        preserveOnly = true;
        keepRequested = true;
        excluded.add(parsed.target);
        if (parsed.negation === "ambiguous") {
          issues.push(ambiguousActionNegationIssue);
        }
        continue;
      }
      if (parsed.source === parsed.target) {
        issues.push(`Clarify the bed transition because both sides name ${parsed.target}.`);
      } else {
        targets.add(parsed.target);
      }
      if (current === null || parsed.source !== current) {
        issues.push(
          `The request says to replace ${parsed.source}, but the current accepted bed is ${current ?? "not set"}.`,
        );
      }
    }

    const rest = transition.rest;
    const variantPattern = /\b(?<variant>queen|king)(?:[-\s]?size(?:d)?)?(?:\s+bed)?\b/g;
    for (const match of rest.matchAll(variantPattern)) {
      const variant = match.groups?.variant as BedVariant | undefined;
      if (variant === undefined) {
        continue;
      }
      mentioned = true;
      const scope = targetNegationScope(rest, match.index);
      if (scope !== "none") {
        excluded.add(variant);
        keepRequested = true;
        if (scope === "ambiguous") {
          issues.push(ambiguousActionNegationIssue);
        }
      } else {
        targets.add(variant);
      }
    }

    const keepScopes = actionScopesForPatterns(clause, [
      /\b(?:keep|retain|leave)\b[^.!?]{0,30}\b(?:queen|king|bed)\b/g,
    ]);
    if (keepScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (
      keepScopes.includes("none") ||
      /\b(?:queen|king|bed)\b[^.!?]{0,20}\b(?:stays?|remains?|unchanged|alone)\b/.test(clause)
    ) {
      keepRequested = true;
      mentioned = true;
    }
    const changeScopes = actionScopesForPatterns(clause, [
      /\b(?:change|replace|switch)\b[^.!?]{0,20}\bbed\b/g,
    ]);
    if (changeScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (changeScopes.includes("clear")) {
      keepRequested = true;
      mentioned = true;
    }
    const removalScopes = actionScopesForPatterns(clause, [
      /\b(?:remove|take\s+out|get\s+rid\s+of)\b[^.!?]{0,20}\bbed\b/g,
    ]);
    if (removalScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (removalScopes.includes("none") || /\b(?:without|no)\s+(?:a\s+|the\s+)?bed\b/.test(clause)) {
      issues.push("Removing the bed is outside the supported Queen/King layout choices.");
      mentioned = true;
    }
    if (removalScopes.includes("clear")) {
      keepRequested = true;
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
      allowed: preserveOnly ? ["keep"] : preservingBedValues(state),
      preferred: "keep",
      issues: unique(issues),
      mentioned,
    };
  }

  if (preserveOnly) {
    return {
      allowed: ["keep"],
      preferred: "keep",
      issues: [],
      mentioned: true,
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

const deskModeSource =
  "(?:standard|regular(?:[-\\s]?size(?:d)?)?|full[-\\s]?size(?:d)?|compact|small|smaller)";

function deskTransition(clause: string): {
  readonly transitions: readonly ParsedTransition<DeskVariant>[];
  readonly rest: string;
} {
  const patterns = [
    new RegExp(
      `\\b(?:replace|swap(?:\\s+out)?|change)\\s+(?:a\\s+|the\\s+)?(?<source>${deskModeSource})(?:\\s+(?:desk|workstation))?\\s+(?:with|for|to)\\s+(?:a\\s+|the\\s+)?(?<target>${deskModeSource})(?:\\s+(?:desk|workstation))?`,
      "g",
    ),
    new RegExp(
      `\\b(?:switch|change|move|go)\\s+from\\s+(?:a\\s+|the\\s+)?(?<source>${deskModeSource})(?:\\s+(?:desk|workstation))?\\s+to\\s+(?:a\\s+|the\\s+)?(?<target>${deskModeSource})(?:\\s+(?:desk|workstation))?`,
      "g",
    ),
    new RegExp(
      `\\bfrom\\s+(?:a\\s+|the\\s+)?(?<source>${deskModeSource})(?:\\s+(?:desk|workstation))?\\s+to\\s+(?:a\\s+|the\\s+)?(?<target>${deskModeSource})(?:\\s+(?:desk|workstation))?`,
      "g",
    ),
  ] as const;
  return parseTransitions(clause, patterns, deskVariantFromWord);
}

function deskVariantMentions(
  clause: string,
): readonly { readonly variant: DeskVariant; readonly start: number; readonly end: number }[] {
  const candidates: { readonly variant: DeskVariant; readonly start: number; readonly end: number }[] = [];
  const patterns = [
    new RegExp(`\\b(?<mode>${deskModeSource})\\b[^.!?]{0,24}?\\b(?:desk|workstation)\\b`, "g"),
    new RegExp(`\\b(?:desk|workstation)\\b[^.!?]{0,24}?\\b(?<mode>${deskModeSource})\\b`, "g"),
  ] as const;
  for (const pattern of patterns) {
    for (const match of clause.matchAll(pattern)) {
      const mode = match.groups?.mode;
      if (mode !== undefined) {
        candidates.push({
          variant: deskVariantFromWord(mode),
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
  }
  const mentions: typeof candidates = [];
  for (const candidate of candidates.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )) {
    if (mentions.some((mention) => candidate.start < mention.end && candidate.end > mention.start)) {
      continue;
    }
    mentions.push(candidate);
  }
  return mentions;
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
  let preserveOnly = false;

  for (const clause of intentClauses(normalized)) {
    const transition = deskTransition(clause);
    for (const parsed of transition.transitions) {
      mentioned = true;
      if (parsed.negation !== "none") {
        preserveOnly = true;
        keepRequested = true;
        excluded.add(parsed.target);
        if (parsed.negation === "ambiguous") {
          issues.push(ambiguousActionNegationIssue);
        }
        continue;
      }
      targets.add(parsed.target);
      if (current === null || parsed.source !== current) {
        issues.push(
          `The request says to replace the ${parsed.source} desk, but the current accepted desk is ${current ?? "not set"}.`,
        );
      }
    }
    const rest = transition.rest;
    const variantMentions = deskVariantMentions(rest);
    for (const mention of variantMentions) {
      mentioned = true;
      const scope = targetNegationScope(rest, mention.start);
      if (scope !== "none") {
        excluded.add(mention.variant);
        keepRequested = true;
        if (scope === "ambiguous") {
          issues.push(ambiguousActionNegationIssue);
        }
      } else {
        targets.add(mention.variant);
      }
    }

    const keepScopes = actionScopesForPatterns(clause, [
      /\b(?:keep|retain|leave)\b[^.!?]{0,30}\b(?:desk|workstation)\b/g,
    ]);
    if (keepScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (
      keepScopes.includes("none") ||
      /\b(?:desk|workstation)\b[^.!?]{0,20}\b(?:stays?|remains?|unchanged|alone|same)\b/.test(clause)
    ) {
      keepRequested = true;
      mentioned = true;
    }

    const changeScopes = actionScopesForPatterns(clause, [
      /\b(?:change|replace|switch)\b[^.!?]{0,20}\b(?:desk|workstation)\b/g,
    ]);
    if (changeScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (changeScopes.includes("clear")) {
      keepRequested = true;
      mentioned = true;
    }

    const flexibleScopes = [
      ...targetScopesForPatterns(clause, [
        /\b(?:flexible|adjustable)\b[^.!?]{0,20}\b(?:desk|workstation)\b/g,
        /\b(?:desk|workstation)\b[^.!?]{0,20}\b(?:flexible|adjustable)\b/g,
        /\bwhatever\b[^.!?]{0,12}\b(?:desk|workstation)\b/g,
      ]),
      ...actionScopesForPatterns(clause, [
        /\b(?:let|allow)\b[^.!?]{0,24}\b(?:desk|workstation)\b[^.!?]{0,24}\b(?:change|adjust|vary)\b/g,
        /\b(?:desk|workstation)\b[^.!?]{0,24}\b(?:may|can|could)\b[^.!?]{0,12}\b(?:change|adjust|vary)\b/g,
      ]),
    ];
    if (flexibleScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (flexibleScopes.length > 0) {
      mentioned = true;
    }
    if (flexibleScopes.includes("clear")) {
      keepRequested = true;
    }
    if (flexibleScopes.includes("none")) {
      flexibleRequested = true;
    }

    const removalScopes = actionScopesForPatterns(clause, [
      /\b(?:remove|take\s+out|get\s+rid\s+of)\b[^.!?]{0,20}\b(?:desk|workstation)\b/g,
    ]);
    if (removalScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (
      removalScopes.includes("none") ||
      /\b(?:without|no)\s+(?:a\s+|the\s+)?(?:desk|workstation)\b/.test(clause) ||
      (keepScopes.includes("clear") && variantMentions.length === 0)
    ) {
      issues.push("Removing the desk is outside the supported standard/compact layout choices.");
      mentioned = true;
    }
    if (removalScopes.includes("clear")) {
      keepRequested = true;
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
      allowed: preserveOnly ? ["keep"] : preservingDeskValues(state),
      preferred: "keep",
      issues: unique(issues),
      mentioned,
    };
  }
  if (preserveOnly) {
    return {
      allowed: ["keep"],
      preferred: "keep",
      issues: [],
      mentioned: true,
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

function actionScopesForPatterns(
  clause: string,
  patterns: readonly RegExp[],
): readonly ActionNegationScope[] {
  const starts = new Set<number>();
  for (const pattern of patterns) {
    for (const match of clause.matchAll(pattern)) {
      starts.add(match.index);
    }
  }
  return [...starts].map((start) => actionNegationScope(clause, start));
}

function targetScopesForPatterns(
  clause: string,
  patterns: readonly RegExp[],
): readonly ActionNegationScope[] {
  const starts = new Set<number>();
  for (const pattern of patterns) {
    for (const match of clause.matchAll(pattern)) {
      starts.add(match.index);
    }
  }
  return [...starts].map((start) => targetNegationScope(clause, start));
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
    const removalScopes = actionScopesForPatterns(clause, [
      /\b(?:remove|take\s+out|drop|get\s+rid\s+of)\b[^.!?]{0,24}\bcrib\b/g,
      /\btake\s+(?:the\s+)?crib\s+out\b/g,
    ]);
    if (removalScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (removalScopes.includes("clear")) {
      actions.add("keep");
    }
    if (removalScopes.includes("none") || /\b(?:without|no)\s+(?:a\s+|the\s+)?crib\b/.test(clause)) {
      actions.add("remove");
    }

    const addScopes = actionScopesForPatterns(clause, [
      /\b(?:add|include|bring\s+in|place|use|need|want|choose|select|try|prefer)\b[^.!?]{0,24}\bcrib\b/g,
    ]);
    if (addScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (addScopes.includes("clear")) {
      preserveRequested = true;
    }
    if (addScopes.includes("none") || /\bcrib\b[^.!?]{0,20}\b(?:added|included|brought in)\b/.test(clause)) {
      actions.add("add");
    }

    const keepScopes = actionScopesForPatterns(clause, [
      /\b(?:keep|retain|leave)\s+(?:the\s+)?crib\b/g,
      /\b(?:keep|retain|leave)\b[^.!?]{0,20}\b(?:desk|bed)\s+and\s+(?:the\s+)?crib\b/g,
    ]);
    if (keepScopes.includes("ambiguous")) {
      issues.push(ambiguousActionNegationIssue);
    }
    if (keepScopes.includes("clear")) {
      actions.add("remove");
    }
    if (keepScopes.includes("none") || /\bcrib\b[^.!?]{0,20}\b(?:stays?|remains?|unchanged)\b/.test(clause)) {
      actions.add("keep");
    }
    if (removalScopes.length + addScopes.length + keepScopes.length === 0) {
      const directTargetScopes = targetScopesForPatterns(clause, [/\bcrib\b/g]);
      if (directTargetScopes.includes("ambiguous")) {
        issues.push(ambiguousActionNegationIssue);
      }
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
      issues: unique(issues),
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
  const supportedIntentText = maskUnsupportedCatalogTerms(normalized, unsupportedTerms);
  const crib = analyzeCribIntent(state, supportedIntentText);
  const bed = analyzeBedIntent(state, supportedIntentText);
  const desk = analyzeDeskIntent(state, supportedIntentText, crib);
  const ambiguousTransitionScope =
    bed.issues.includes(ambiguousActionNegationIssue) ||
    desk.issues.includes(ambiguousActionNegationIssue) ||
    crib.issues.includes(ambiguousActionNegationIssue);
  const unknowns = boundedUnknowns([
    ...unsupportedTerms.map(unsupportedFurnitureUnknown),
    ...bed.issues,
    ...desk.issues,
    ...crib.issues,
  ]);
  return {
    allowed: {
      bed: ambiguousTransitionScope ? ["keep"] : bed.allowed,
      desk: ambiguousTransitionScope ? ["keep"] : desk.allowed,
      crib: ambiguousTransitionScope ? ["keep"] : crib.allowed,
    },
    preferred: {
      bed: ambiguousTransitionScope ? "keep" : bed.preferred,
      desk: ambiguousTransitionScope ? "keep" : desk.preferred,
      crib: ambiguousTransitionScope ? "keep" : crib.preferred,
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
  const generatedSchemaResult = generatedLayoutIntentDeltaSchema.safeParse(parsed.value);
  if (!generatedSchemaResult.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
        message: "The model intent delta did not match the strict semantic schema.",
        details: generatedSchemaResult.error.issues.map(
          (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        ),
      },
    };
  }

  const intentSchemaResult = layoutIntentDeltaSchema.safeParse({
    ...generatedSchemaResult.data,
    changedPreference: prompt,
  });
  if (!intentSchemaResult.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
        message: "The submitted request could not be preserved in the semantic delta.",
        details: intentSchemaResult.error.issues.map(
          (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        ),
      },
    };
  }

  const intentDelta = intentSchemaResult.data;
  const analysis = analyzeLayoutPrompt(state, prompt);
  const toolInputResult = buildCompareLayoutOptionsInput(intentDelta, state);
  if (!toolInputResult.ok) {
    return toolInputResult;
  }
  const toolInput = toolInputResult.value;
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
  if (
    generatedSchemaResult.data.changedPreference !== undefined &&
    generatedSchemaResult.data.changedPreference !== prompt
  ) {
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
): ToolValidationResult {
  const intentSchemaResult = layoutIntentDeltaSchema.safeParse(intentDelta);
  if (!intentSchemaResult.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
        message: "The application could not derive tool input from an invalid semantic delta.",
        details: intentSchemaResult.error.issues.map(
          (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        ),
      },
    };
  }

  const validIntentDelta = intentSchemaResult.data;
  const candidateFurnitureIds = resolveCandidateFurnitureIds(validIntentDelta, state);
  const candidateIds = new Set(expandCandidateFurnitureIds(candidateFurnitureIds));
  const analysis = analyzeLayoutPrompt(state, validIntentDelta.changedPreference);
  const schemaResult = compareLayoutOptionsInputSchema.safeParse({
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
    changedPreference: validIntentDelta.changedPreference,
    unknowns: analysis.unknowns,
    clarificationNeeded: analysis.clarification === "required",
  });
  if (!schemaResult.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
        message: "The application-derived tool input did not match the strict schema.",
        details: schemaResult.error.issues.map(
          (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        ),
      },
    };
  }
  return { ok: true, value: schemaResult.data };
}
