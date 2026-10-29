import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import {
  CLEARANCE_RULE_SET_ID,
  CLEARANCE_RULE_SET_VERSION,
  LOCKED_CONSTRAINT_SET_ID,
  REQUIRED_ROOM_STATE_SET_ID,
  ROOM_PLAN_ID,
  ROOM_PLAN_VERSION,
} from "../src/domain/fixture";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import {
  buildCompareLayoutOptionsInput,
  createIntentDeltaJsonSchema,
  createToolInputForTests,
  detectUnsupportedCatalogTerms,
  parseAndValidateIntentDelta,
  parseAndValidateToolInput,
  preferredCandidateFurnitureIds,
  preferredLayoutIntentDelta,
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

describe("compact intent-delta contract", () => {
  it("derives every fixed tool field and retained ID in application code", () => {
    const state = stateWithQueenDesk();
    const prompt = "What changes if we use a King-size bed instead?";
    const raw = JSON.stringify({
      bed: "king",
      desk: "keep",
      crib: "keep",
      changedPreference: prompt,
      clarification: "none",
    });

    const validation = parseAndValidateIntentDelta(raw, state, prompt);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }
    expect(validation.value.toolInput).toEqual({
      roomPlanId: ROOM_PLAN_ID,
      planVersion: ROOM_PLAN_VERSION,
      priorStateRef: state.stateRef,
      clearanceRuleSetId: CLEARANCE_RULE_SET_ID,
      clearanceRuleSetVersion: CLEARANCE_RULE_SET_VERSION,
      requiredRoomStateSetId: REQUIRED_ROOM_STATE_SET_ID,
      lockedConstraintSetId: LOCKED_CONSTRAINT_SET_ID,
      unit: "mm",
      candidateFurnitureIds: {
        bed: "bed-king",
        desk: "desk-standard",
        crib: null,
      },
      retainFurnitureIds: ["desk-standard"],
      changedPreference: prompt,
      unknowns: [],
      clarificationNeeded: false,
    });
  });

  it("accepts delta words that derive the same exact candidate set", () => {
    const state = createInitialDemoState();
    const prompt = "Can a Queen-size bed and a desk fit here without blocking the closet or the door?";
    const validation = parseAndValidateIntentDelta(
      JSON.stringify({
        bed: "queen",
        desk: "standard",
        crib: "remove",
        changedPreference: prompt,
        clarification: "none",
      }),
      state,
      prompt,
    );
    expect(validation).toMatchObject({
      ok: true,
      value: {
        toolInput: {
          candidateFurnitureIds: {
            bed: "bed-queen",
            desk: "desk-standard",
            crib: null,
          },
        },
      },
    });
  });

  it("guides only intent words that preserve the application-derived candidate set", () => {
    const state = stateWithQueenDesk();
    const schema = createIntentDeltaJsonSchema(
      state,
      "Keep the Queen bed, add a crib, and let the desk change if needed.",
    );
    const properties = schema.properties as Record<string, { readonly enum?: readonly unknown[] }>;

    expect(properties.bed?.enum).toEqual(["queen", "keep"]);
    expect(properties.desk?.enum).toEqual(["flexible", "compact"]);
    expect(properties.crib?.enum).toEqual(["add"]);
  });

  it("rejects invented IDs, dimensions, geometry, verdicts, and changed state references", () => {
    const state = createInitialDemoState();
    const prompt = "Can a Queen bed and a standard desk fit?";
    const valid = preferredLayoutIntentDelta(state, prompt);
    for (const extra of [
      { furnitureId: "bed-invented" },
      { widthMm: 9999 },
      { placement: { xMm: 1, yMm: 2 } },
      { status: "feasible" },
      { priorStateRef: "layout-state-v99" },
    ]) {
      expect(
        parseAndValidateIntentDelta(JSON.stringify({ ...valid, ...extra }), state, prompt),
      ).toMatchObject({ ok: false, error: { code: "INVALID_SCHEMA" } });
    }

    const derived = buildCompareLayoutOptionsInput(valid, state);
    expect(
      parseAndValidateToolInput(
        JSON.stringify({ ...derived, priorStateRef: "layout-state-v99" }),
        state,
        prompt,
      ),
    ).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
    expect(
      parseAndValidateToolInput(
        JSON.stringify({
          ...derived,
          candidateFurnitureIds: { ...derived.candidateFurnitureIds, bed: "bed-invented" },
        }),
        state,
        prompt,
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_SCHEMA" } });
  });

  it("keeps retained state authoritative across failure and correction", () => {
    const state = {
      ...stateWithQueenDesk(),
      activeFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"] as const,
      stateRef: "layout-state-v4",
      version: 4,
    };
    const prompt =
      "Correction: do not switch to a King and remove the crib. Keep the Queen bed and compact desk.";
    const intent = preferredLayoutIntentDelta(state, prompt);
    expect(intent).toMatchObject({
      bed: "queen",
      desk: "compact",
      crib: "remove",
    });
    expect(buildCompareLayoutOptionsInput(intent, state)).toMatchObject({
      priorStateRef: "layout-state-v4",
      candidateFurnitureIds: {
        bed: "bed-queen",
        desk: "desk-compact",
        crib: null,
      },
      retainFurnitureIds: ["bed-queen", "desk-compact"],
    });
  });

  it.each([
    ["Please check a queen bed with a regular-size desk.", { bed: "queen", desk: "standard", crib: "keep" }],
    ["Swap only the bed for a king; leave the desk alone.", { bed: "king", desk: "keep", crib: "keep" }],
    [
      "Retain the queen, bring in the crib, and let the desk size adjust.",
      { bed: "queen", desk: "flexible", crib: "add" },
    ],
  ])("interprets paraphrase %s", (prompt, expected) => {
    expect(preferredLayoutIntentDelta(stateWithQueenDesk(), prompt)).toMatchObject(expected);
  });
});

describe("missing verified dimensions", () => {
  it("forces clarification for unsupported catalog furniture", () => {
    const state = createInitialDemoState();
    const prompt = "Can we add a dresser?";
    const schema = createIntentDeltaJsonSchema(state, prompt);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.clarification?.enum).toEqual(["required"]);
    expect(detectUnsupportedCatalogTerms("Add a dresser and nightstand")).toEqual(["dresser", "nightstand"]);
    const validation = parseAndValidateIntentDelta(
      JSON.stringify(preferredLayoutIntentDelta(state, prompt)),
      state,
      prompt,
    );
    expect(validation).toMatchObject({
      ok: true,
      value: {
        toolInput: {
          unknowns: ["Missing verified catalog dimensions for dresser."],
          clarificationNeeded: true,
        },
      },
    });
  });
});
