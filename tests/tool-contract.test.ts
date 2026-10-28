import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import {
  createPlannerJsonSchema,
  createToolInputForTests,
  detectUnsupportedCatalogTerms,
  parseAndValidateToolInput,
  preferredCandidateFurnitureIds,
} from "../src/domain/tool-contract";

function stateWithQueenDesk() {
  const initial = createInitialDemoState();
  const result = compareKnownLayoutOptions(
    createToolInputForTests({
      state: initial,
      candidateFurnitureIds: ["bed-queen", "desk-standard"],
      changedPreference: "initial layout",
    }),
    initial,
  );
  return applyToolResult(initial, result);
}

describe("strict tool-call validation", () => {
  it("accepts a current, millimetre-based, known-ID call", () => {
    const state = createInitialDemoState();
    const input = createToolInputForTests({
      state,
      candidateFurnitureIds: ["bed-queen", "desk-standard"],
    });
    expect(
      parseAndValidateToolInput(JSON.stringify(input), state, "Can a Queen-size bed and desk fit?"),
    ).toEqual({ ok: true, value: input });
  });

  it("rejects stale state, unsupported units, and invented IDs", () => {
    const state = createInitialDemoState();
    const base = createToolInputForTests({
      state,
      candidateFurnitureIds: ["bed-queen", "desk-standard"],
    });

    expect(
      parseAndValidateToolInput(JSON.stringify({ ...base, priorStateRef: "layout-state-v99" }), state),
    ).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
    expect(parseAndValidateToolInput(JSON.stringify({ ...base, unit: "in" }), state)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SCHEMA" },
    });
    expect(
      parseAndValidateToolInput(
        JSON.stringify({
          ...base,
          candidateFurnitureIds: { ...base.candidateFurnitureIds, desk: "desk-invented" },
        }),
        state,
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_SCHEMA" } });
  });

  it("rejects duplicate or invalid retained objects", () => {
    const state = stateWithQueenDesk();
    const input = createToolInputForTests({
      state,
      candidateFurnitureIds: ["bed-king", "desk-standard"],
      retainFurnitureIds: ["desk-standard"],
      changedPreference: "King instead",
    });
    expect(
      parseAndValidateToolInput(
        JSON.stringify({ ...input, retainFurnitureIds: ["desk-standard", "desk-standard"] }),
        state,
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_SCHEMA" } });
    expect(
      parseAndValidateToolInput(JSON.stringify({ ...input, retainFurnitureIds: ["bed-queen"] }), state),
    ).toMatchObject({ ok: false, error: { code: "INVALID_RETAINED_ITEM" } });
  });

  it("catches dropped explicit replacements and retained constraints", () => {
    const state = stateWithQueenDesk();
    const wrong = createToolInputForTests({
      state,
      candidateFurnitureIds: ["bed-queen", "desk-standard"],
      retainFurnitureIds: ["bed-queen", "desk-standard"],
      changedPreference: "King instead",
    });
    const validation = parseAndValidateToolInput(
      JSON.stringify(wrong),
      state,
      "What changes if we use a King-size bed instead?",
    );
    expect(validation).toMatchObject({
      ok: false,
      error: {
        code: "DROPPED_CONSTRAINT",
      },
    });
    if (!validation.ok) {
      expect(validation.error.details.join(" ")).toContain("bed-king");
      expect(validation.error.details.join(" ")).toContain("bed-queen");
    }
  });
});

describe("adversarial semantic guards", () => {
  it("handles negation and correction without treating 'blocking' as King", () => {
    const state = {
      ...stateWithQueenDesk(),
      activeFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"] as const,
    };
    expect(
      preferredCandidateFurnitureIds(
        state,
        "Correction: do not switch to a King and remove the crib. Keep the Queen bed and compact desk.",
      ),
    ).toEqual({
      bed: "bed-queen",
      desk: "desk-compact",
      crib: null,
    });
    expect(
      preferredCandidateFurnitureIds(
        createInitialDemoState(),
        "Can a Queen bed fit without blocking the door?",
      ).bed,
    ).toBe("bed-queen");
  });

  it("requires compact desk when adding the known crib option", () => {
    expect(
      preferredCandidateFurnitureIds(
        stateWithQueenDesk(),
        "Keep the Queen and add a crib without blocking the closet.",
      ),
    ).toEqual({
      bed: "bed-queen",
      desk: "desk-compact",
      crib: "crib-standard",
    });
  });
});

describe("missing verified dimensions", () => {
  it("forces clarification for unsupported catalog furniture", () => {
    const state = createInitialDemoState();
    const schema = createPlannerJsonSchema(state, {
      prompt: "Can we add a dresser?",
    });
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.clarificationNeeded?.enum).toEqual([true]);
    expect(properties.unknowns?.minItems).toBe(1);
    expect(detectUnsupportedCatalogTerms("Add a dresser and nightstand")).toEqual(["dresser", "nightstand"]);
  });
});
