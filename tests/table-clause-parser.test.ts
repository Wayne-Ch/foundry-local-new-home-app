import { describe, expect, it } from "vitest";
import { parseCoordinatedPhrase, parseTableClauseOccurrences } from "../src/domain/table-clause-parser";

function occurrenceSlices(value: string) {
  return parseTableClauseOccurrences(value).map((occurrence) => ({
    index: occurrence.index,
    table: value.slice(occurrence.table.start, occurrence.table.end),
    tableStart: occurrence.table.start,
    clause: value.slice(occurrence.clause.start, occurrence.clause.end),
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
