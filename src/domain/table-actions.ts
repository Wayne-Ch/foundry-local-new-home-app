export type TableActionIntentSemantics = "ambiguous" | "content-sensitive" | "physical";
export type TableActionObjectCandidateSemantics = "direct" | "none" | "replacement";

export interface TableActionDefinition {
  readonly id: string;
  readonly forms: readonly [string, ...string[]];
  readonly directObjectIntent: TableActionIntentSemantics;
  readonly purposeIntent: TableActionIntentSemantics;
  readonly objectCandidate: TableActionObjectCandidateSemantics;
  readonly allowsTransitionRelations: boolean;
  readonly requestsTableEvidence: boolean;
}

export const tableActionRegistry = [
  {
    id: "add",
    forms: ["add"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "bring",
    forms: ["bring in", "bring"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "carry",
    forms: ["carry"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "change",
    forms: ["change"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "choose",
    forms: ["choose"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "compare",
    forms: ["compare"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "display",
    forms: ["display"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "drop",
    forms: ["drop"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "fit",
    forms: ["fit"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "format",
    forms: ["format"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "get",
    forms: ["get rid of", "get"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "go",
    forms: ["go"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "hold",
    forms: ["hold"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "include",
    forms: ["include"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "keep",
    forms: ["keep"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "leave",
    forms: ["leave"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "mount",
    forms: ["mount"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "move",
    forms: ["move"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "need",
    forms: ["need"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "organize",
    forms: ["organize"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "output",
    forms: ["output"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "place",
    forms: ["place"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "position",
    forms: ["position"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "prefer",
    forms: ["prefer"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "present",
    forms: ["present"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "provide",
    forms: ["provide"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "put",
    forms: ["put"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "render",
    forms: ["render"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "remove",
    forms: ["remove"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "replace",
    forms: ["replace"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "replacement",
    allowsTransitionRelations: true,
    requestsTableEvidence: true,
  },
  {
    id: "retain",
    forms: ["retain"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "return",
    forms: ["return"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "select",
    forms: ["select"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "set",
    forms: ["set"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "show",
    forms: ["show"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "store",
    forms: ["store"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "summarize",
    forms: ["summarize"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "support",
    forms: ["support"],
    directObjectIntent: "physical",
    purposeIntent: "physical",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "swap",
    forms: ["swap out", "swap"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "switch",
    forms: ["switch"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "tabulate",
    forms: ["tabulate"],
    directObjectIntent: "content-sensitive",
    purposeIntent: "content-sensitive",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "take",
    forms: ["take out", "take"],
    directObjectIntent: "physical",
    purposeIntent: "ambiguous",
    objectCandidate: "none",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "try",
    forms: ["try"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "use",
    forms: ["use"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
  {
    id: "want",
    forms: ["want"],
    directObjectIntent: "ambiguous",
    purposeIntent: "ambiguous",
    objectCandidate: "direct",
    allowsTransitionRelations: false,
    requestsTableEvidence: true,
  },
] as const satisfies readonly TableActionDefinition[];

export type TableActionId = (typeof tableActionRegistry)[number]["id"];
export type RegisteredTableAction = (typeof tableActionRegistry)[number];

export interface TableActionMatch {
  readonly id: TableActionId;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function actionFormSource(form: string): string {
  return form.split(/\s+/).map(escapeRegex).join("\\s+");
}

function actionSource(definitions: readonly RegisteredTableAction[]): string {
  return definitions
    .flatMap((definition) => definition.forms)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(actionFormSource)
    .join("|");
}

function normalizedActionText(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

const definitionsById = new Map<TableActionId, RegisteredTableAction>();
const definitionsByForm = new Map<string, RegisteredTableAction>();
for (const definition of tableActionRegistry) {
  definitionsById.set(definition.id, definition);
  for (const form of definition.forms) {
    definitionsByForm.set(normalizedActionText(form), definition);
  }
}

export const tableActionSource = actionSource(tableActionRegistry);
export const directObjectCandidateActionSource = actionSource(
  tableActionRegistry.filter((definition) => definition.objectCandidate === "direct"),
);
export const replacementObjectCandidateActionSource = actionSource(
  tableActionRegistry.filter((definition) => definition.objectCandidate === "replacement"),
);
export const objectCandidateActionSource = actionSource(
  tableActionRegistry.filter((definition) => definition.objectCandidate !== "none"),
);
export const tableActionLeadWords: ReadonlySet<string> = new Set(
  tableActionRegistry.flatMap((definition) =>
    definition.forms.map((form) => normalizedActionText(form).split(" ")[0] ?? ""),
  ),
);

export function getTableActionDefinition(id: TableActionId): RegisteredTableAction {
  const definition = definitionsById.get(id);
  if (definition === undefined) {
    throw new Error(`Unknown table action: ${id}`);
  }
  return definition;
}

export function tableActionDefinitionForText(value: string): RegisteredTableAction | null {
  return definitionsByForm.get(normalizedActionText(value)) ?? null;
}

export function findTableActionMatches(value: string): readonly TableActionMatch[] {
  return [...value.matchAll(new RegExp(`\\b(?:${tableActionSource})\\b`, "gi"))].flatMap((match) => {
    const definition = tableActionDefinitionForText(match[0]);
    return definition === null
      ? []
      : [
          {
            id: definition.id,
            start: match.index,
            end: match.index + match[0].length,
            text: match[0],
          },
        ];
  });
}

export function matchTableActionAtStart(value: string): TableActionMatch | null {
  const match = new RegExp(`^(?:${tableActionSource})\\b`, "i").exec(value);
  if (match === null) {
    return null;
  }
  const definition = tableActionDefinitionForText(match[0]);
  return definition === null
    ? null
    : {
        id: definition.id,
        start: 0,
        end: match[0].length,
        text: match[0],
      };
}
