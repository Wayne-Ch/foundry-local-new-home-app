import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";
import { createLayoutPresentation } from "../src/renderer/layout-presentation";

describe("layout evidence presentation", () => {
  it("keeps the multi-rejected King, compact desk, and crib preview internally consistent", () => {
    let state = createInitialDemoState();
    const acceptedResult = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
        changedPreference: "accepted Queen, compact desk, and crib",
      }),
      state,
    );
    const acceptedLayout =
      acceptedResult.feasibleOptions.find((option) => option.id === acceptedResult.selectedOptionId) ?? null;
    state = applyToolResult(state, acceptedResult);

    const rejectedResult = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["desk-compact", "crib-standard"],
        changedPreference: "replace Queen with King while retaining desk and crib",
      }),
      state,
    );
    const presentation = createLayoutPresentation(rejectedResult, acceptedLayout);

    expect(presentation.mode).toBe("rejected_option");
    expect(presentation.displayLayout?.id).toBe(rejectedResult.evidenceOptionId);
    expect(presentation.conflicts).toEqual(presentation.displayLayout?.conflicts);
    expect(presentation.checks).toEqual(presentation.displayLayout?.checkedStates);
    expect(presentation.conflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(false);
    expect(presentation.checks.find((check) => check.id === "door-open")?.passed).toBe(true);
    expect(rejectedResult.aggregateConflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(
      true,
    );
    expect(presentation.conflictsLabel).toBe("Preview option conflicts");
    expect(presentation.layoutNotice).toContain("Aggregate reasons across 2 rejected options");
  });

  it("labels the prior layout as retained when no option was evaluated", () => {
    let state = createInitialDemoState();
    const acceptedResult = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-compact"],
        changedPreference: "accepted Queen and compact desk",
      }),
      state,
    );
    const acceptedLayout =
      acceptedResult.feasibleOptions.find((option) => option.id === acceptedResult.selectedOptionId) ?? null;
    state = applyToolResult(state, acceptedResult);

    const unknownResult = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-compact"],
        changedPreference: "unsupported exact combination",
      }),
      state,
    );
    const presentation = createLayoutPresentation(unknownResult, acceptedLayout);

    expect(unknownResult.noResultReason?.code).toBe("NO_KNOWN_OPTION_SET");
    expect(unknownResult.rejectedOptions).toEqual([]);
    expect(presentation.mode).toBe("retained_accepted");
    expect(presentation.displayLayout).toBe(acceptedLayout);
    expect(presentation.layoutTitle).toContain("retained accepted layout");
    expect(presentation.layoutNotice).toContain("not a rejected preview");
    expect(presentation.checks).toEqual(acceptedLayout?.checkedStates);
    expect(presentation.conflicts).toEqual([]);
  });
});
