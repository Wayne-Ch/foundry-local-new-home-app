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

  it.each([
    ["Do not replace the Queen with a King.", stateWithQueenDesk(), "bed", "king"],
    ["Do not move from King to Queen!", stateWithKingCompactCrib(), "bed", "queen"],
    ["Do not replace the standard desk with a compact desk.", stateWithQueenDesk(), "desk", "compact"],
    ["Do not move from compact desk to standard desk.", stateWithKingCompactCrib(), "desk", "standard"],
  ] as const)(
    "keeps the accepted item for a clearly negated transition: %s",
    (prompt, state, field, prohibitedTarget) => {
      const analysis = analyzeLayoutPrompt(state, prompt);
      expect(analysis).toMatchObject({
        clarification: "none",
        preferred: {
          [field]: "keep",
        },
        allowed: {
          [field]: ["keep"],
        },
      });

      const accepted = {
        bed: "keep" as const,
        desk: "keep" as const,
        crib: "keep" as const,
        changedPreference: prompt,
        clarification: "none" as const,
      };
      expect(parseAndValidateIntentDelta(JSON.stringify(accepted), state, prompt)).toMatchObject({
        ok: true,
        value: {
          intentDelta: accepted,
        },
      });
      expect(
        parseAndValidateIntentDelta(
          JSON.stringify({ ...accepted, [field]: prohibitedTarget }),
          state,
          prompt,
        ),
      ).toMatchObject({
        ok: false,
        error: {
          code: "DROPPED_CONSTRAINT",
        },
      });
    },
  );

  it("scopes negated transitions across punctuation and fails closed on ambiguous conjunctions", () => {
    const state = stateWithQueenDesk();
    const punctuated = "Do not replace the Queen with a King; replace the standard desk with a compact desk.";
    expect(analyzeLayoutPrompt(state, punctuated)).toMatchObject({
      clarification: "none",
      preferred: {
        bed: "keep",
        desk: "compact",
      },
      allowed: {
        bed: ["keep"],
        desk: ["compact"],
      },
    });

    const repeatedNegation =
      "Do not replace the Queen with a King, and do not replace the standard desk with a compact desk.";
    expect(analyzeLayoutPrompt(state, repeatedNegation)).toMatchObject({
      clarification: "none",
      preferred: {
        bed: "keep",
        desk: "keep",
      },
      allowed: {
        bed: ["keep"],
        desk: ["keep"],
      },
    });

    const ambiguous =
      "Do not replace the Queen with a King and replace the standard desk with a compact desk.";
    const analysis = analyzeLayoutPrompt(state, ambiguous);
    expect(analysis).toMatchObject({
      clarification: "required",
      preferred: {
        bed: "keep",
        desk: "keep",
      },
      allowed: {
        bed: ["keep"],
        desk: ["keep"],
      },
    });
    expect(
      parseAndValidateIntentDelta(
        JSON.stringify({
          bed: "keep",
          desk: "compact",
          crib: "keep",
          changedPreference: ambiguous,
          clarification: "required",
        }),
        state,
        ambiguous,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "DROPPED_CONSTRAINT",
      },
    });

    const ambiguousCrib = "Do not replace the Queen with a King and add a crib.";
    expect(analyzeLayoutPrompt(state, ambiguousCrib)).toMatchObject({
      clarification: "required",
      preferred: {
        bed: "keep",
        desk: "keep",
        crib: "keep",
      },
      allowed: {
        bed: ["keep"],
        desk: ["keep"],
        crib: ["keep"],
      },
    });
  });

  it.each([
    "Do not replace the Queen with a King nor replace the standard desk with a compact desk.",
    "Neither replace the Queen with a King nor replace the standard desk with a compact desk.",
  ])("continues transition negation across nor: %s", (prompt) => {
    expect(analyzeLayoutPrompt(stateWithQueenDesk(), prompt)).toMatchObject({
      clarification: "none",
      preferred: {
        bed: "keep",
        desk: "keep",
        crib: "keep",
      },
      allowed: {
        bed: ["keep"],
        desk: ["keep"],
        crib: ["keep"],
      },
    });
  });

  it("keeps affirmative transition conjunctions and fails closed on an unpaired nor", () => {
    const state = stateWithQueenDesk();
    expect(
      analyzeLayoutPrompt(
        state,
        "Replace the Queen with a King and replace the standard desk with a compact desk.",
      ),
    ).toMatchObject({
      clarification: "none",
      preferred: {
        bed: "king",
        desk: "compact",
        crib: "keep",
      },
      allowed: {
        bed: ["king"],
        desk: ["compact"],
        crib: ["keep"],
      },
    });

    expect(
      analyzeLayoutPrompt(
        state,
        "Replace the Queen with a King nor replace the standard desk with a compact desk.",
      ),
    ).toMatchObject({
      clarification: "required",
      preferred: {
        bed: "keep",
        desk: "keep",
        crib: "keep",
      },
      allowed: {
        bed: ["keep"],
        desk: ["keep"],
        crib: ["keep"],
      },
    });
  });

  it.each([
    [
      "Replace the standard desk with a compact desk.",
      stateWithQueenDesk(),
      { bed: "keep", desk: "compact", crib: "keep" },
    ],
    [
      "Move from compact desk to standard desk.",
      stateWithKingCompactCrib(),
      { bed: "keep", desk: "standard", crib: "keep" },
    ],
  ] as const)("keeps affirmative desk transition %s", (prompt, state, expected) => {
    expect(preferredLayoutIntentDelta(state, prompt)).toMatchObject({
      ...expected,
      clarification: "none",
    });
  });

  it("recognizes object-first crib removal and its negated forms", () => {
    const state = stateWithKingCompactCrib();
    expect(analyzeLayoutPrompt(state, "Take the crib out.")).toMatchObject({
      clarification: "none",
      preferred: {
        crib: "remove",
      },
      allowed: {
        crib: ["remove"],
      },
    });

    for (const prompt of [
      "Do not take the crib out.",
      "Don't take the crib out.",
      "Never take the crib out.",
    ]) {
      expect(analyzeLayoutPrompt(state, prompt)).toMatchObject({
        clarification: "none",
        preferred: {
          crib: "keep",
        },
        allowed: {
          crib: ["keep"],
        },
      });
    }
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

  it("fails closed for unsupported furniture requested with need or want", () => {
    const state = stateWithQueenDesk();
    for (const prompt of ["We need a hammock beside the desk.", "We want a hammock beside the desk."]) {
      expect(detectUnsupportedCatalogTerms(prompt)).toEqual(["hammock"]);
      expect(analyzeLayoutPrompt(state, prompt)).toMatchObject({
        clarification: "required",
        unknowns: ["Missing verified catalog dimensions for hammock."],
      });
      expect(buildCompareLayoutOptionsInput(preferredLayoutIntentDelta(state, prompt), state)).toMatchObject({
        candidateFurnitureIds: {
          bed: "bed-queen",
          desk: "desk-standard",
          crib: null,
        },
        unknowns: ["Missing verified catalog dimensions for hammock."],
        clarificationNeeded: true,
      });
    }
  });

  it.each([
    ["Use a California King.", "california king"],
    ["Put a California King bed against the wall.", "california king"],
    ["Add a twin.", "twin bed"],
    ["Could a twin bed fit?", "twin bed"],
    ["Use a moon pod beside the desk.", "moon pod"],
    ["Add a bean bag.", "bean bag"],
    ["Use an easel.", "easel"],
    ["Replace the Queen with a platform bed.", "platform bed"],
    ["Could we fit a rocker?", "rocker"],
    ["Put a lamp beside the desk.", "lamp"],
  ] as const)("extracts unsupported action object from %s", (prompt, term) => {
    expect(detectUnsupportedCatalogTerms(prompt)).toContain(term);
  });

  it.each([
    "Use a California King.",
    "Put a California King bed against the wall.",
    "Add a twin.",
    "Could a twin bed fit?",
  ])("does not map unsupported bed variant to a supported bed: %s", (prompt) => {
    const state = stateWithQueenDesk();
    expect(analyzeLayoutPrompt(state, prompt)).toMatchObject({
      clarification: "required",
      preferred: {
        bed: "keep",
      },
    });
    const preferred = preferredLayoutIntentDelta(state, prompt);
    expect(preferred).toMatchObject({
      bed: "keep",
      clarification: "required",
    });
    expect(buildCompareLayoutOptionsInput(preferred, state)).toMatchObject({
      candidateFurnitureIds: {
        bed: "bed-queen",
      },
      clarificationNeeded: true,
    });
    expect(
      parseAndValidateIntentDelta(JSON.stringify({ ...preferred, bed: "king" }), state, prompt),
    ).toMatchObject({
      ok: false,
      error: {
        code: "DROPPED_CONSTRAINT",
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
    expect(detectUnsupportedCatalogTerms("Keep the layout clear beside the Queen bed.")).toEqual([]);
    expect(
      detectUnsupportedCatalogTerms(
        "Use the layout result, add warmth, and put the clearance note beside the plan.",
      ),
    ).toEqual([]);
    expect(detectUnsupportedCatalogTerms("Use a Queen bed and do not add an armchair beside it.")).toEqual(
      [],
    );
    expect(detectUnsupportedCatalogTerms("Use a Queen bed without an armchair.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We do not need a hammock beside the desk.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We don't want a hammock beside the desk.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We need a clear answer beside the desk.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We want the layout to stay flexible.")).toEqual([]);
  });
});
