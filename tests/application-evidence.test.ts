import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";
import { renderApplicationEvidence } from "../src/foundry/foundry-service";
import { stageTurns } from "../src/foundry/prompt";

function expectConclusionOnly(text: string, prompt: string): void {
  expect(text).not.toContain(prompt);
  expect(text).not.toContain("User request");
  expect(text).not.toContain("Preference interpreted");
  expect(text).not.toContain("Application evidence");
}

describe("application evidence copy", () => {
  it("renders only the deterministic feasible conclusion", () => {
    const state = createInitialDemoState();
    const prompt = stageTurns[0]?.prompt ?? "";
    const result = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: prompt,
      }),
      state,
    );

    const text = renderApplicationEvidence(result, null);

    expect(text).toBe("Queen + rotated standard desk passes every locked deterministic check.");
    expectConclusionOnly(text, prompt);
  });

  it("renders only the deterministic rejected conclusion while preserving accepted state", () => {
    let state = createInitialDemoState();
    const accepted = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: stageTurns[0]?.prompt ?? "",
      }),
      state,
    );
    const acceptedLayout =
      accepted.feasibleOptions.find((option) => option.id === accepted.selectedOptionId) ?? null;
    state = applyToolResult(state, accepted);
    const prompt = stageTurns[1]?.prompt ?? "";
    const rejected = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
        changedPreference: prompt,
      }),
      state,
      acceptedLayout,
    );

    const text = renderApplicationEvidence(rejected, acceptedLayout);

    expect(text).toMatch(/^No feasible known option\./);
    expect(text).toContain("Which preference may change:");
    expect(text).not.toContain("baby bed");
    expectConclusionOnly(text, prompt);
  });

  it("keeps clarification evidence conclusion-only", () => {
    const state = createInitialDemoState();
    const prompt = "Please add a sofa.";
    const result = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: prompt,
        unknowns: ["unsupported furniture: sofa"],
        clarificationNeeded: true,
      }),
      state,
    );

    const text = renderApplicationEvidence(result, null);

    expect(text).toBe("Geometry did not run. Missing verified facts: unsupported furniture: sofa.");
    expectConclusionOnly(text, prompt);
  });
});
