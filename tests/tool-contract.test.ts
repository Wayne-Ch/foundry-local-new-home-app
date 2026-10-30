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

function expectBuiltToolInput(
  intent: Parameters<typeof buildCompareLayoutOptionsInput>[0],
  state: Parameters<typeof buildCompareLayoutOptionsInput>[1],
) {
  const result = buildCompareLayoutOptionsInput(intent, state);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) {
    throw new Error(result.error.details.join(" "));
  }
  return result.value;
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

describe("final review exact-source adversarial matrix", () => {
  const activeCribState = () => ({
    ...stateWithQueenDesk(),
    activeFurnitureIds: ["bed-queen", "desk-standard", "crib-standard"] as const,
  });

  it.each([
    {
      name: "neither list across bare comma actions",
      prompt: "Neither replace the Queen with a King, take the crib out, nor change anything else.",
      state: activeCribState,
      clarification: "none",
      preferred: { bed: "keep", desk: "keep", crib: "keep" },
    },
    {
      name: "polite insertion before a bed action",
      prompt: "Do not, please, choose a King bed.",
      state: stateWithQueenDesk,
      clarification: "none",
      preferred: { bed: "keep", desk: "keep", crib: "keep" },
    },
    {
      name: "adverbial phrase before a crib action",
      prompt: "Do not, under any circumstances, add a crib.",
      state: stateWithQueenDesk,
      clarification: "none",
      preferred: { bed: "keep", desk: "keep", crib: "keep" },
    },
    {
      name: "polite insertion before a desk action",
      prompt: "Do not, please, choose a compact desk.",
      state: stateWithQueenDesk,
      clarification: "none",
      preferred: { bed: "keep", desk: "keep", crib: "keep" },
    },
    {
      name: "adverbial phrase before crib removal",
      prompt: "Do not, under any circumstances, take the crib out.",
      state: activeCribState,
      clarification: "none",
      preferred: { bed: "keep", desk: "keep", crib: "keep" },
    },
    {
      name: "affirmative comma-separated controls",
      prompt: "Replace the Queen with a King, take the crib out, and change anything else.",
      state: activeCribState,
      clarification: "none",
      preferred: { bed: "king", desk: "keep", crib: "remove" },
    },
    {
      name: "affirmative polite bed control",
      prompt: "Please choose a King bed.",
      state: stateWithQueenDesk,
      clarification: "none",
      preferred: { bed: "king", desk: "keep", crib: "keep" },
    },
    {
      name: "affirmative adverbial crib control",
      prompt: "Under any circumstances, add a crib.",
      state: stateWithQueenDesk,
      clarification: "none",
      preferred: { bed: "keep", crib: "add" },
    },
    {
      name: "unknown comma scope fails closed",
      prompt: "Do not replace the Queen with a King, choose a compact desk.",
      state: stateWithQueenDesk,
      clarification: "required",
      preferred: { bed: "keep", desk: "keep", crib: "keep" },
    },
    {
      name: "strong punctuation ends negation scope",
      prompt: "Do not replace the Queen with a King; choose a compact desk.",
      state: stateWithQueenDesk,
      clarification: "none",
      preferred: { bed: "keep", desk: "compact", crib: "keep" },
    },
  ])("$name", ({ prompt, state, clarification, preferred }) => {
    expect(analyzeLayoutPrompt(state(), prompt)).toMatchObject({
      clarification,
      preferred,
    });
  });

  it.each([
    {
      name: "coordinated plural chair",
      prompt: "Use a Queen bed with two chairs.",
      unsupported: ["chair"],
      clarification: "required",
      preferred: { bed: "queen" },
    },
    {
      name: "coordinated plural table",
      prompt: "Use a Queen bed and two tables.",
      unsupported: ["table"],
      clarification: "required",
      preferred: { bed: "queen" },
    },
    {
      name: "multiple coordinated plural furniture",
      prompt: "I want a Queen bed, a standard desk, multiple lamps, and two tables.",
      unsupported: ["lamp", "table"],
      clarification: "required",
      preferred: { bed: "queen", desk: "standard" },
    },
    {
      name: "negated plural furniture control",
      prompt: "Use a Queen bed without any chairs.",
      unsupported: [],
      clarification: "none",
      preferred: { bed: "queen" },
    },
    {
      name: "negated action with plural furniture control",
      prompt: "Do not add two chairs.",
      unsupported: [],
      clarification: "none",
      preferred: { bed: "keep" },
    },
    {
      name: "presentation-format plural table control",
      prompt: "Use a Queen bed and return the comparison in two tables.",
      unsupported: [],
      clarification: "none",
      preferred: { bed: "queen" },
    },
    {
      name: "known furniture control",
      prompt: "Use a Queen bed and a standard desk.",
      unsupported: [],
      clarification: "none",
      preferred: { bed: "queen", desk: "standard" },
    },
  ])("$name", ({ prompt, unsupported, clarification, preferred }) => {
    const state = stateWithQueenDesk();
    expect(detectUnsupportedCatalogTerms(prompt)).toEqual(unsupported);
    const analysis = analyzeLayoutPrompt(state, prompt);
    expect(analysis).toMatchObject({
      clarification,
      preferred,
    });
    for (const term of unsupported) {
      expect(analysis.unknowns).toContain(`Missing verified catalog dimensions for ${term}.`);
    }
  });

  const sharedRackPrefix = "ornate modular powder-coated adjustable narrow bedroom ".repeat(4);
  const longRackDescription = (index: number) => `${sharedRackPrefix}series ${index} rack`;
  const rackPrompt = (indices: readonly number[]) =>
    indices.map((index) => `Add a ${longRackDescription(index)}.`).join(" ");

  it.each([
    {
      name: "nine distinct long rack descriptions",
      prompt: rackPrompt([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      expectedCount: 8,
      omittedCount: 2,
    },
    {
      name: "duplicate long rack descriptions",
      prompt: rackPrompt([1, 1, 1]),
      expectedCount: 1,
      omittedCount: 0,
    },
    {
      name: "eight distinct long rack descriptions",
      prompt: rackPrompt([1, 2, 3, 4, 5, 6, 7, 8]),
      expectedCount: 8,
      omittedCount: 0,
    },
  ])("$name", ({ prompt, expectedCount, omittedCount }) => {
    const state = stateWithQueenDesk();
    const analysis = analyzeLayoutPrompt(state, prompt);
    expect(analysis.clarification).toBe("required");
    expect(analysis.unknowns).toHaveLength(expectedCount);
    expect(new Set(analysis.unknowns).size).toBe(expectedCount);
    expect(analysis.unknowns.every((unknown) => unknown.length <= 160)).toBe(true);
    if (omittedCount > 0) {
      expect(analysis.unknowns.at(-1)).toBe(
        `Additional clarification evidence omitted: ${omittedCount} more items.`,
      );
    } else {
      expect(analysis.unknowns).not.toContainEqual(
        expect.stringContaining("Additional clarification evidence omitted:"),
      );
    }
    expect(buildCompareLayoutOptionsInput(preferredLayoutIntentDelta(state, prompt), state)).toMatchObject({
      ok: true,
      value: {
        unknowns: analysis.unknowns,
        clarificationNeeded: true,
      },
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
    expect(properties.changedPreference).toBeUndefined();
    expect(schema.required).not.toContain("changedPreference");
  });

  it("injects and preserves submitted prompts beyond the former 240-character cap", () => {
    const state = stateWithQueenDesk();
    const prompt = `Keep the Queen bed and standard desk. ${"Keep the layout clear. ".repeat(16)}`.trim();
    expect(prompt.length).toBeGreaterThan(240);
    const preferred = preferredLayoutIntentDelta(state, prompt);
    const validation = parseAndValidateIntentDelta(
      JSON.stringify({
        bed: preferred.bed,
        desk: preferred.desk,
        crib: preferred.crib,
        clarification: preferred.clarification,
      }),
      state,
      prompt,
    );
    expect(validation).toMatchObject({
      ok: true,
      value: {
        intentDelta: {
          changedPreference: prompt,
        },
        toolInput: {
          changedPreference: prompt,
        },
      },
    });
  });

  it("bounds application-generated unknowns and returns validation results instead of throwing", () => {
    const state = stateWithQueenDesk();
    const longTerm = `${"ornate ".repeat(40)}hammock`;
    const prompt = `We need a ${longTerm} beside the desk.`;
    const preferred = preferredLayoutIntentDelta(state, prompt);
    const built = buildCompareLayoutOptionsInput(preferred, state);
    expect(built).toMatchObject({
      ok: true,
      value: {
        clarificationNeeded: true,
      },
    });
    if (built.ok) {
      expect(built.value.unknowns).toHaveLength(1);
      expect(built.value.unknowns[0]?.length).toBeLessThanOrEqual(160);
    }

    const malformed = {
      ...preferred,
      bed: "california-king",
      changedPreference: "",
    } as unknown as Parameters<typeof buildCompareLayoutOptionsInput>[0];
    let malformedResult: ReturnType<typeof buildCompareLayoutOptionsInput> | undefined;
    expect(() => {
      malformedResult = buildCompareLayoutOptionsInput(malformed, state);
    }).not.toThrow();
    expect(malformedResult).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
      },
    });

    const oversizedUnknownInput = createToolInputForTests({
      state,
      candidateFurnitureIds: ["bed-queen", "desk-standard"],
      retainFurnitureIds: ["bed-queen", "desk-standard"],
      changedPreference: "keep the accepted layout",
      unknowns: ["x".repeat(161)],
      clarificationNeeded: true,
    });
    expect(() => parseAndValidateToolInput(JSON.stringify(oversizedUnknownInput), state)).not.toThrow();
    expect(parseAndValidateToolInput(JSON.stringify(oversizedUnknownInput), state)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_SCHEMA",
      },
    });
  });

  it("caps derived unknown evidence deterministically at the schema maximum", () => {
    const state = stateWithQueenDesk();
    const eightPrompt =
      "Add an armchair, cabinet, bassinet, night stand, moon pod, sofa, bench, and stool beside the desk.";
    const ninePrompt =
      "Add an armchair, cabinet, bassinet, night stand, moon pod, sofa, bench, stool, and dresser beside the desk.";
    const expectedFirstSeven = [
      "Missing verified catalog dimensions for armchair.",
      "Missing verified catalog dimensions for cabinet.",
      "Missing verified catalog dimensions for bassinet.",
      "Missing verified catalog dimensions for night stand.",
      "Missing verified catalog dimensions for moon pod.",
      "Missing verified catalog dimensions for sofa.",
      "Missing verified catalog dimensions for bench.",
    ];

    const eightUnknowns = analyzeLayoutPrompt(state, eightPrompt).unknowns;
    expect(eightUnknowns).toHaveLength(8);
    expect(
      buildCompareLayoutOptionsInput(preferredLayoutIntentDelta(state, eightPrompt), state),
    ).toMatchObject({
      ok: true,
      value: {
        unknowns: eightUnknowns,
        clarificationNeeded: true,
      },
    });

    const nineUnknowns = analyzeLayoutPrompt(state, ninePrompt).unknowns;
    expect(nineUnknowns).toEqual([
      ...expectedFirstSeven,
      "Additional clarification evidence omitted: 2 more items.",
    ]);
    expect(analyzeLayoutPrompt(state, ninePrompt).unknowns).toEqual(nineUnknowns);

    const built = buildCompareLayoutOptionsInput(preferredLayoutIntentDelta(state, ninePrompt), state);
    expect(built).toMatchObject({
      ok: true,
      value: {
        unknowns: nineUnknowns,
        clarificationNeeded: true,
      },
    });
    expect(
      parseAndValidateIntentDelta(
        JSON.stringify(preferredLayoutIntentDelta(state, ninePrompt)),
        state,
        ninePrompt,
      ),
    ).toMatchObject({ ok: true });

    expect(
      analyzeLayoutPrompt(state, "Add an armchair, another armchair, a cabinet, and another cabinet.")
        .unknowns,
    ).toEqual([
      "Missing verified catalog dimensions for armchair.",
      "Missing verified catalog dimensions for cabinet.",
    ]);
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

    const derived = expectBuiltToolInput(valid, state);
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
    expect(expectBuiltToolInput(intent, state)).toMatchObject({
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
    "Neither replace the Queen with a King, nor replace the standard desk with a compact desk.",
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

  it("continues coordinated negation across transition and removal action types", () => {
    const state = {
      ...stateWithQueenDesk(),
      activeFurnitureIds: ["bed-queen", "desk-standard", "crib-standard"] as const,
    };
    const prompt = "Do not replace the Queen with a King nor take the crib out.";
    expect(analyzeLayoutPrompt(state, prompt)).toMatchObject({
      clarification: "none",
      preferred: {
        bed: "keep",
        desk: "keep",
        crib: "keep",
      },
      allowed: {
        bed: ["keep"],
        desk: ["keep", "standard"],
        crib: ["keep"],
      },
    });
    expect(
      parseAndValidateIntentDelta(
        JSON.stringify({
          bed: "king",
          desk: "keep",
          crib: "remove",
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

    expect(analyzeLayoutPrompt(state, "Nor replace the Queen with a King.")).toMatchObject({
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

  it("routes direct bed, desk, and crib actions through fail-closed negation scope", () => {
    const state = stateWithQueenDesk();
    const coordinated = "Neither choose a compact desk, nor add a crib.";
    expect(analyzeLayoutPrompt(state, coordinated)).toMatchObject({
      clarification: "none",
      preferred: {
        bed: "keep",
        desk: "keep",
        crib: "keep",
      },
    });
    expect(preferredCandidateFurnitureIds(state, coordinated)).toEqual({
      bed: "bed-queen",
      desk: "desk-standard",
      crib: null,
    });
    expect(
      parseAndValidateIntentDelta(
        JSON.stringify({
          bed: "keep",
          desk: "compact",
          crib: "add",
          clarification: "none",
        }),
        state,
        coordinated,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "DROPPED_CONSTRAINT",
      },
    });

    for (const prompt of ["Nor choose a King bed.", "Nor choose a compact desk."]) {
      expect(analyzeLayoutPrompt(state, prompt)).toMatchObject({
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
    }

    for (const prompt of ["Do not now choose a King bed.", "Do not now choose a compact desk."]) {
      expect(analyzeLayoutPrompt(state, prompt)).toMatchObject({
        clarification: "none",
        preferred: {
          bed: "keep",
          desk: "keep",
          crib: "keep",
        },
      });
    }

    const cribState = stateWithKingCompactCrib();
    expect(analyzeLayoutPrompt(cribState, "Do not now take the crib out.")).toMatchObject({
      clarification: "none",
      preferred: {
        bed: "keep",
        desk: "keep",
        crib: "keep",
      },
    });
    expect(preferredCandidateFurnitureIds(cribState, "Do not now take the crib out.").crib).toBe(
      "crib-standard",
    );
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
    expect(analyzeLayoutPrompt(state, "Take out the crib.")).toMatchObject({
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
      "Do not ever take the crib out.",
      "Do not ever take out the crib.",
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

  it("preserves affirmative and across transition and removal actions", () => {
    const state = {
      ...stateWithQueenDesk(),
      activeFurnitureIds: ["bed-queen", "desk-standard", "crib-standard"] as const,
    };
    expect(analyzeLayoutPrompt(state, "Replace the Queen with a King and take the crib out.")).toMatchObject({
      clarification: "none",
      preferred: {
        bed: "king",
        desk: "keep",
        crib: "remove",
      },
      allowed: {
        bed: ["king"],
        crib: ["remove"],
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

  it("fails closed for unsupported furniture requested with need or want", () => {
    const state = stateWithQueenDesk();
    for (const prompt of [
      "We need a hammock beside the desk.",
      "We want a hammock beside the desk.",
      "I want a moon pod near the bed.",
    ]) {
      const term = prompt.includes("moon pod") ? "moon pod" : "hammock";
      expect(detectUnsupportedCatalogTerms(prompt)).toEqual([term]);
      const analysis = analyzeLayoutPrompt(state, prompt);
      expect(analysis.clarification).toBe("required");
      expect(analysis.unknowns).toContain(`Missing verified catalog dimensions for ${term}.`);
      const built = expectBuiltToolInput(preferredLayoutIntentDelta(state, prompt), state);
      expect(built).toMatchObject({
        candidateFurnitureIds: {
          bed: "bed-queen",
          desk: "desk-standard",
          crib: null,
        },
        clarificationNeeded: true,
      });
      expect(built.unknowns).toContain(`Missing verified catalog dimensions for ${term}.`);
    }
  });

  it.each([
    ["We need one chair beside the desk.", "chair"],
    ["We need two chairs beside the desk.", "chair"],
    ["Add multiple lamps beside the bed.", "lamp"],
    ["Could several benches fit near the wall?", "bench"],
    ["Place 3 stools beside the desk.", "stool"],
  ] as const)("normalizes quantified or plural unsupported furniture in %s", (prompt, term) => {
    const state = stateWithQueenDesk();
    expect(detectUnsupportedCatalogTerms(prompt)).toEqual([term]);
    const analysis = analyzeLayoutPrompt(state, prompt);
    expect(analysis.clarification).toBe("required");
    expect(analysis.unknowns).toContain(`Missing verified catalog dimensions for ${term}.`);
    const built = expectBuiltToolInput(preferredLayoutIntentDelta(state, prompt), state);
    expect(built.clarificationNeeded).toBe(true);
    expect(built.unknowns).toContain(`Missing verified catalog dimensions for ${term}.`);
  });

  it.each([
    "We do not need two chairs beside the desk.",
    "Do not add multiple lamps beside the bed.",
    "We no longer need several benches.",
    "Keep the Queen bed without any chairs.",
  ])("ignores negated quantified or plural furniture requests: %s", (prompt) => {
    expect(detectUnsupportedCatalogTerms(prompt)).toEqual([]);
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
    expect(expectBuiltToolInput(preferred, state)).toMatchObject({
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
    expect(detectUnsupportedCatalogTerms("We do not need or want a hammock beside the desk.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We no longer need a chair.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We do not need a chair, nor do we want a lamp.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We want the result in a table.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We need a clear answer beside the desk.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We need two clear answers beside the desk.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We need multiple layout options in a summary table.")).toEqual([]);
    expect(detectUnsupportedCatalogTerms("We want the layout to stay flexible.")).toEqual([]);
  });

  it.each([
    "Return a table of results.",
    "Use a summary table for the comparison.",
    "Provide table output for the layout options.",
    "Format the answer as a comparison table.",
    "Put the findings into a results table.",
  ])("does not classify presentation-format table prose as furniture: %s", (prompt) => {
    expect(detectUnsupportedCatalogTerms(prompt)).toEqual([]);
  });

  it.each([
    "Use two tables for the results.",
    "Use two tables for the comparison.",
    "Use tables to summarize the results.",
    "Use two tables for output.",
    "Use tables to display the comparison.",
    "Use tables to format the results.",
    "Use two tables—for the results!",
    "Use tables—to summarize the comparison?",
    "Do not use two tables for the results.",
    "Don't use tables to summarize the comparison.",
  ])("keeps plural presentation tables out of the furniture catalog: %s", (prompt) => {
    const state = stateWithQueenDesk();
    expect(detectUnsupportedCatalogTerms(prompt)).toEqual([]);
    expect(analyzeLayoutPrompt(state, prompt)).toMatchObject({
      clarification: "none",
      unknowns: [],
    });
  });

  it.each([
    "Add a table beside the bed.",
    "Add a 1200 mm table beside the bed.",
    "Could a table fit near the wall?",
    "Add two tables beside the bed.",
    "Put tables near the window.",
    "Add two tables, beside the bed!",
    "Put tables near the window?",
    "Use a Queen bed, and two tables.",
    "Add two tables for the display beside the bed.",
    "Use two tables to display lamps near the window.",
  ])("keeps physical table requests fail-closed: %s", (prompt) => {
    const state = stateWithQueenDesk();
    expect(detectUnsupportedCatalogTerms(prompt)).toContain("table");
    const analysis = analyzeLayoutPrompt(state, prompt);
    expect(analysis.clarification).toBe("required");
    expect(analysis.unknowns).toContain("Missing verified catalog dimensions for table.");
  });

  it.each([
    "Do not add two tables beside the bed.",
    "Do not put tables near the window.",
    "Use a Queen bed without any tables.",
  ])("ignores negated physical plural table requests: %s", (prompt) => {
    expect(detectUnsupportedCatalogTerms(prompt)).toEqual([]);
  });
});
