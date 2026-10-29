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
  analyzeLayoutPrompt,
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

function stateWithKingCompactCrib() {
  return {
    ...stateWithQueenDesk(),
    stateRef: "layout-state-v7",
    version: 7,
    activeFurnitureIds: ["bed-king", "desk-compact", "crib-standard"] as const,
  };
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
        "Correction: keep the Queen bed and compact desk. Remove the crib. Do not switch to a King.",
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

  it("rejects semantically wrong delta words even when they derive the same candidate set", () => {
    const state = createInitialDemoState();
    const prompt = "Can a Queen-size bed and a desk fit here without blocking the closet or the door?";
    expect(
      parseAndValidateIntentDelta(
        JSON.stringify({
          bed: "queen",
          desk: "standard",
          crib: "remove",
          changedPreference: prompt,
          clarification: "none",
        }),
        state,
        prompt,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "DROPPED_CONSTRAINT",
      },
    });

    const validation = parseAndValidateIntentDelta(
      JSON.stringify({
        bed: "queen",
        desk: "flexible",
        crib: "keep",
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

  it("keeps every compact semantic enum unrestricted at runtime", () => {
    const state = stateWithQueenDesk();
    const schema = createIntentDeltaJsonSchema(
      state,
      "Keep the Queen bed, add a crib, and let the desk change if needed.",
    );
    const properties = schema.properties as Record<string, { readonly enum?: readonly unknown[] }>;

    expect(properties.bed?.enum).toEqual(["keep", "queen", "king"]);
    expect(properties.desk?.enum).toEqual(["keep", "flexible", "standard", "compact"]);
    expect(properties.crib?.enum).toEqual(["keep", "add", "remove"]);
    expect(properties.clarification?.enum).toEqual(["none", "required"]);
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
      "Correction: keep the Queen bed and compact desk. Remove the crib. Do not switch to a King.";
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

  it.each([
    ["Replace the King with a Queen", { bed: "queen", desk: "keep", crib: "keep" }],
    ["Move from King to Queen", { bed: "queen", desk: "keep", crib: "keep" }],
    [
      "Do not keep the King; use the Queen and do not remove the crib",
      { bed: "queen", desk: "keep", crib: "keep" },
    ],
  ])("validates transition-aware correction %s", (prompt, expected) => {
    const state = stateWithKingCompactCrib();
    const intent = {
      ...expected,
      changedPreference: prompt,
      clarification: "none" as const,
    };
    expect(parseAndValidateIntentDelta(JSON.stringify(intent), state, prompt)).toMatchObject({
      ok: true,
      value: {
        intentDelta: expected,
        toolInput: {
          candidateFurnitureIds: {
            bed: "bed-queen",
            desk: "desk-compact",
            crib: "crib-standard",
          },
        },
      },
    });
    expect(
      parseAndValidateIntentDelta(JSON.stringify({ ...intent, bed: "king" }), state, prompt),
    ).toMatchObject({
      ok: false,
      error: {
        code: "DROPPED_CONSTRAINT",
      },
    });
  });

  it("requires clarification for conflicting or transition-inconsistent wording", () => {
    const state = stateWithKingCompactCrib();
    for (const prompt of [
      "Use either a King or Queen bed.",
      "Keep the King but replace the King with a Queen.",
      "Remove the crib, but do not remove the crib.",
      "Do not switch to a King and remove the crib.",
    ]) {
      const analysis = analyzeLayoutPrompt(state, prompt);
      expect(analysis.clarification).toBe("required");
      expect(analysis.preferred).toMatchObject({
        bed: "keep",
        crib: "keep",
      });
      expect(
        parseAndValidateIntentDelta(
          JSON.stringify({
            bed: "keep",
            desk: "keep",
            crib: "keep",
            changedPreference: prompt,
            clarification: "none",
          }),
          state,
          prompt,
        ),
      ).toMatchObject({
        ok: false,
        error: {
          code: "INCONSISTENT_CLARIFICATION",
        },
      });
    }

    const sourceMismatch = "Replace the King with a Queen.";
    expect(analyzeLayoutPrompt(stateWithQueenDesk(), sourceMismatch)).toMatchObject({
      clarification: "required",
      preferred: {
        bed: "keep",
      },
    });
  });
});

describe("missing verified dimensions", () => {
  it("recognizes unsupported furniture fail-closed while preserving known intent", () => {
    const state = createInitialDemoState();
    const prompt = "Use a Queen bed with an armchair beside it.";
    const schema = createIntentDeltaJsonSchema(state, prompt);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.clarification?.enum).toEqual(["none", "required"]);
    expect(
      detectUnsupportedCatalogTerms(
        "Add an armchair, cabinet, bassinet, night stand, and moon pod beside the Queen.",
      ).sort(),
    ).toEqual(["armchair", "bassinet", "cabinet", "moon pod", "night stand"]);
    for (const [promptText, term] of [
      ["Put an armchair beside the Queen.", "armchair"],
      ["Add a cabinet.", "cabinet"],
      ["Could a bassinet fit?", "bassinet"],
      ["Place a night stand near the King bed.", "night stand"],
    ] as const) {
      expect(detectUnsupportedCatalogTerms(promptText)).toContain(term);
    }
    const validation = parseAndValidateIntentDelta(
      JSON.stringify(preferredLayoutIntentDelta(state, prompt)),
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
          unknowns: ["Missing verified catalog dimensions for armchair."],
          clarificationNeeded: true,
        },
      },
    });
  });

  it("does not mistake supported-only requests or ordinary prose for furniture", () => {
    expect(
      detectUnsupportedCatalogTerms(
        "Can a Queen bed and compact desk fit while the crib remains and the door stays clear?",
      ),
    ).toEqual([]);
    expect(
      detectUnsupportedCatalogTerms(
        "Keep the layout flexible, explain the result clearly, and do not block the door or closet.",
      ),
    ).toEqual([]);
  });
});
