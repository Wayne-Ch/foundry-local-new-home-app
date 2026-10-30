import { describe, expect, it } from "vitest";
import { tableActionRegistry } from "../src/domain/table-actions";
import { parseCoordinatedPhrase, parseTableClauseOccurrences } from "../src/domain/table-clause-parser";

const tableActionForms = tableActionRegistry.flatMap((definition) =>
  definition.forms.map((form) => ({
    id: definition.id,
    form,
  })),
);

function occurrenceSlices(value: string) {
  return parseTableClauseOccurrences(value).map((occurrence) => ({
    index: occurrence.index,
    table: value.slice(occurrence.table.start, occurrence.table.end),
    tableStart: occurrence.table.start,
    clause: value.slice(occurrence.clause.start, occurrence.clause.end),
    coordinator:
      occurrence.coordinator === null
        ? null
        : value.slice(occurrence.coordinator.start, occurrence.coordinator.end),
    action:
      occurrence.actionContext === null
        ? null
        : value.slice(occurrence.actionContext.action.start, occurrence.actionContext.action.end),
    actionStart: occurrence.actionContext?.action.start ?? null,
    actionId: occurrence.actionContext?.id ?? null,
    actionSource: occurrence.actionContext?.source ?? null,
    actionScope:
      occurrence.actionContext === null
        ? null
        : value.slice(occurrence.actionContext.scope.start, occurrence.actionContext.scope.end),
    scope: value.slice(occurrence.scope.start, occurrence.scope.end),
  }));
}

describe("table clause parser", () => {
  it.each([
    [
      "show results in one table and findings in another table.",
      ["show results in one table", "findings in another table"],
    ],
    [
      "show results in one table, and findings in another table.",
      ["show results in one table", "findings in another table"],
    ],
    [
      "show results in one table, findings in another table, and recommendations in a third table.",
      ["show results in one table", "findings in another table", "recommendations in a third table"],
    ],
    [
      "show results in one table and findings, recommendations, and notes in another table.",
      ["show results in one table", "findings, recommendations, and notes in another table"],
    ],
    [
      "use one table to compare results, lamps, and chairs, and show findings in another table.",
      ["use one table to compare results, lamps, and chairs", "show findings in another table"],
    ],
    [
      "show results in one table. show findings in another table.",
      ["show results in one table", "show findings in another table"],
    ],
    [
      "show results in one table and place lamps on another table near the wall.",
      ["show results in one table", "place lamps on another table near the wall"],
    ],
  ] as const)("assigns independent spans in %s", (value, expectedClauses) => {
    const occurrences = occurrenceSlices(value);
    expect(occurrences.map((occurrence) => occurrence.clause)).toEqual(expectedClauses);
    expect(occurrences.map((occurrence) => occurrence.index)).toEqual(
      expectedClauses.map((_, index) => index),
    );
    expect(occurrences.map((occurrence) => occurrence.table)).toEqual(expectedClauses.map(() => "table"));
    expect(occurrences.map((occurrence) => occurrence.tableStart)).toEqual(
      [...value.matchAll(/\btable\b/g)].map((match) => match.index),
    );
  });

  it("assigns the leading action to coordinated occurrences without rewriting their spans", () => {
    const value = "Show results in one table and lamps on another table near the wall.";
    const occurrences = occurrenceSlices(value);
    expect(occurrences).toMatchObject([
      {
        clause: "Show results in one table",
        coordinator: null,
        action: "Show",
        actionSource: "local",
        scope: "Show results in one table and lamps on another table near the wall",
      },
      {
        clause: "lamps on another table near the wall",
        coordinator: "and",
        action: "Show",
        actionSource: "inherited",
        scope: "Show results in one table and lamps on another table near the wall",
      },
    ]);
    expect(occurrences[1]?.actionStart).toBe(occurrences[0]?.actionStart);
  });

  it("preserves comma coordination and updates the inherited action after a local override", () => {
    const value = "Show results in one table, place lamps on another table, and chairs on a third table.";
    expect(
      occurrenceSlices(value).map(({ clause, coordinator, action, actionSource }) => ({
        clause,
        coordinator,
        action,
        actionSource,
      })),
    ).toEqual([
      {
        clause: "Show results in one table",
        coordinator: null,
        action: "Show",
        actionSource: "local",
      },
      {
        clause: "place lamps on another table",
        coordinator: ",",
        action: "place",
        actionSource: "local",
      },
      {
        clause: "chairs on a third table",
        coordinator: ", and",
        action: "place",
        actionSource: "inherited",
      },
    ]);
  });

  it("does not inherit actions across sentence boundaries", () => {
    const value = "Show results in one table. Lamps on another table near the wall.";
    expect(
      occurrenceSlices(value).map(({ clause, coordinator, action, actionSource, scope }) => ({
        clause,
        coordinator,
        action,
        actionSource,
        scope,
      })),
    ).toEqual([
      {
        clause: "Show results in one table",
        coordinator: null,
        action: "Show",
        actionSource: "local",
        scope: "Show results in one table",
      },
      {
        clause: "Lamps on another table near the wall",
        coordinator: null,
        action: null,
        actionSource: null,
        scope: "Lamps on another table near the wall",
      },
    ]);
  });

  it("inherits the negated governing action span without treating it as a new local verb", () => {
    const value = "Do not place lamps on one table and chairs on another table.";
    const occurrences = occurrenceSlices(value);
    expect(
      occurrences.map(({ action, actionSource }) => ({
        action,
        actionSource,
      })),
    ).toEqual([
      { action: "place", actionSource: "local" },
      { action: "place", actionSource: "inherited" },
    ]);
    expect(occurrences[1]?.actionStart).toBe(occurrences[0]?.actionStart);
    expect(occurrences.map((occurrence) => occurrence.actionScope)).toEqual([
      "Do not place lamps on one table",
      "Do not place lamps on one table",
    ]);
  });

  it("keeps the complete declared table-action vocabulary in one registry", () => {
    expect(tableActionRegistry.map((definition) => definition.id)).toEqual([
      "add",
      "bring",
      "carry",
      "change",
      "choose",
      "compare",
      "display",
      "drop",
      "fit",
      "format",
      "get",
      "go",
      "hold",
      "include",
      "keep",
      "leave",
      "mount",
      "move",
      "need",
      "organize",
      "output",
      "place",
      "position",
      "prefer",
      "present",
      "provide",
      "put",
      "render",
      "remove",
      "replace",
      "retain",
      "return",
      "select",
      "set",
      "show",
      "store",
      "summarize",
      "support",
      "swap",
      "switch",
      "tabulate",
      "take",
      "try",
      "use",
      "want",
    ]);
  });

  it.each(tableActionForms)(
    "uses $id action form '$form' for explicit, inherited, and repeated occurrences",
    ({ id, form }) => {
      const inherited = occurrenceSlices(`${form} one table and another table.`);
      expect(
        inherited.map(({ actionId, actionSource }) => ({
          actionId,
          actionSource,
        })),
      ).toEqual([
        { actionId: id, actionSource: "local" },
        { actionId: id, actionSource: "inherited" },
      ]);

      const repeated = occurrenceSlices(`${form} one table and ${form} another table.`);
      expect(
        repeated.map(({ actionId, actionSource }) => ({
          actionId,
          actionSource,
        })),
      ).toEqual([
        { actionId: id, actionSource: "local" },
        { actionId: id, actionSource: "local" },
      ]);
    },
  );

  it.each([
    "Do not show results in one table, then place lamps on another table near the wall.",
    "Do not show results in one table then place lamps on another table near the wall.",
    "Do not show results in one table, place lamps on another table near the wall.",
    "Do not show results in one table, but place lamps on another table near the wall.",
    "Do not show results in one table; place lamps on another table near the wall.",
    "Do not show results in one table. Place lamps on another table near the wall.",
    "Do not show results in one table and place lamps on another table near the wall.",
  ])("gives a later explicit action its own local negation scope: %s", (value) => {
    const occurrences = occurrenceSlices(value);
    expect(
      occurrences.map(({ actionId, actionSource }) => ({
        actionId,
        actionSource,
      })),
    ).toEqual([
      { actionId: "show", actionSource: "local" },
      { actionId: "place", actionSource: "local" },
    ]);
    expect(occurrences[1]?.actionScope?.toLowerCase()).toBe("place lamps on another table near the wall");
  });

  it.each([
    ["Do not show results, then place one table near the wall.", "place one table near the wall"],
    [
      "Do not show results, then do not place one table near the wall.",
      "do not place one table near the wall",
    ],
    ["Do not want to place one table near the wall.", "do not want to place one table near the wall"],
  ] as const)("derives the local action scope without requiring an earlier table: %s", (value, scope) => {
    const [occurrence] = occurrenceSlices(value);
    expect(occurrence).toMatchObject({
      actionId: "place",
      actionSource: "local",
    });
    expect(occurrence?.actionScope?.toLowerCase()).toBe(scope);
  });

  it("preserves original spans while matching table tokens case-insensitively", () => {
    const value = "Show results in one Table and findings in another TABLE.";
    const occurrences = parseTableClauseOccurrences(value);
    expect(
      occurrences.map((occurrence) => value.slice(occurrence.table.start, occurrence.table.end)),
    ).toEqual(["Table", "TABLE"]);
  });

  it.each([
    ["results, lamps, and chairs", ["results", "lamps", "chairs"]],
    ["results, and lamps", ["results", "lamps"]],
    ["lamps plus results", ["lamps", "results"]],
    ["results or findings", ["results", "findings"]],
    ["results + findings", ["results", "findings"]],
  ] as const)("parses every coordinated component in %s", (value, expected) => {
    const parsed = parseCoordinatedPhrase(value);
    expect(parsed.complete).toBe(true);
    expect(parsed.components.map((span) => value.slice(span.start, span.end))).toEqual(expected);
  });

  it.each(["", "results and", "and results", "results and or findings"])(
    "marks incomplete coordination as unresolved: %s",
    (value) => {
      expect(parseCoordinatedPhrase(value).complete).toBe(false);
    },
  );
});
