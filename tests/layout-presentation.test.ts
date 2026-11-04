import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";
import { stageTurns } from "../src/foundry/prompt";
import { createLayoutPresentation } from "../src/renderer/layout-presentation";

function selectedLayout(result: ReturnType<typeof compareKnownLayoutOptions>) {
  return result.feasibleOptions.find((option) => option.id === result.selectedOptionId) ?? null;
}

describe("layout evidence presentation", () => {
  it("defaults B after A to the rejected preview while preserving exact A state and evidence", () => {
    let state = createInitialDemoState();
    const turnA = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: stageTurns[0]?.prompt ?? "",
      }),
      state,
    );
    const turnALayout = selectedLayout(turnA);
    state = applyToolResult(state, turnA);

    const turnB = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
        changedPreference: stageTurns[1]?.prompt ?? "",
      }),
      state,
      turnALayout,
    );
    state = applyToolResult(state, turnB);
    const rejectedPreview = createLayoutPresentation(turnB, turnALayout);

    expect(state.currentLayoutId).toBe("queen-desk-standard-v1");
    expect(rejectedPreview.mode).toBe("rejected_option");
    expect(rejectedPreview.activeView).toBe("rejected");
    expect(rejectedPreview.displayLayout?.id).toBe("king-desk-standard-v1");
    expect(rejectedPreview.evidenceLayout).toBe(rejectedPreview.displayLayout);
    expect(rejectedPreview.roomConflicts).toEqual(rejectedPreview.displayLayout?.conflicts);
    expect(rejectedPreview.resultBadgeText).toBe("Rejected preview · not accepted");
    expect(rejectedPreview.layoutTitle).toContain("Rejected preview");
    expect(rejectedPreview.layoutNotice).toContain(
      "Accepted layout preserved: Queen + rotated standard desk (queen-desk-standard-v1)",
    );
    expect(
      rejectedPreview.evidenceLayout?.measurements.map((measurement) => [
        measurement.actualDistanceMm,
        measurement.requiredDistanceMm,
      ]),
    ).toEqual([[470, 250]]);

    const acceptedLayout = createLayoutPresentation(turnB, turnALayout, "accepted");
    expect(acceptedLayout.mode).toBe("accepted_after_rejection");
    expect(acceptedLayout.activeView).toBe("accepted");
    expect(acceptedLayout.displayLayout?.id).toBe("queen-desk-standard-v1");
    expect(acceptedLayout.evidenceLayout?.id).toBe("king-desk-standard-v1");
    expect(acceptedLayout.roomConflicts).toEqual([]);
    expect(acceptedLayout.layoutTitle).toContain("accepted layout preserved");
    expect(acceptedLayout.layoutNotice).toContain('Select "Inspect rejected option"');
  });

  it("defaults E after C to the rejected preview while preserving exact C state and evidence", () => {
    let state = createInitialDemoState();
    const turnA = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: stageTurns[0]?.prompt ?? "",
      }),
      state,
    );
    const turnALayout = selectedLayout(turnA);
    state = applyToolResult(state, turnA);
    const turnB = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
        changedPreference: stageTurns[1]?.prompt ?? "",
      }),
      state,
      turnALayout,
    );
    state = applyToolResult(state, turnB);
    const turnC = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["bed-queen"],
        changedPreference: stageTurns[2]?.prompt ?? "",
      }),
      state,
      turnALayout,
    );
    const turnCLayout = selectedLayout(turnC);
    state = applyToolResult(state, turnC);
    const turnE = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["desk-compact", "crib-standard"],
        changedPreference: stageTurns[3]?.prompt ?? "",
      }),
      state,
      turnCLayout,
    );
    state = applyToolResult(state, turnE);
    const rejectedPreview = createLayoutPresentation(turnE, turnCLayout);

    expect(state.currentLayoutId).toBe("queen-crib-compact-v1");
    expect(rejectedPreview.mode).toBe("rejected_option");
    expect(rejectedPreview.displayLayout?.id).toBe("king-crib-compact-east-v1");
    expect(rejectedPreview.conflicts).toEqual(rejectedPreview.evidenceLayout?.conflicts);
    expect(rejectedPreview.checks).toEqual(rejectedPreview.evidenceLayout?.checkedStates);
    expect(rejectedPreview.canShowAcceptedLayout).toBe(true);
    expect(rejectedPreview.canShowRejectedOption).toBe(true);
    expect(rejectedPreview.conflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(false);
    expect(turnE.aggregateConflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(true);
    expect(rejectedPreview.layoutNotice).toContain("Aggregate reasons across 2 rejected options");
    expect(rejectedPreview.layoutNotice).toContain(
      "Accepted layout preserved: Queen + baby bed + rotated compact desk (queen-crib-compact-v1)",
    );

    const acceptedPresentation = createLayoutPresentation(turnE, turnCLayout, "accepted");
    expect(acceptedPresentation.mode).toBe("accepted_after_rejection");
    expect(acceptedPresentation.displayLayout?.id).toBe("queen-crib-compact-v1");
    expect(acceptedPresentation.evidenceLayout?.id).toBe("king-crib-compact-east-v1");
    expect(acceptedPresentation.roomConflicts).toEqual([]);
  });

  it("states that no layout was accepted for a first-turn rejected option preview", () => {
    const state = createInitialDemoState();
    const rejectedResult = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        changedPreference: "initial King and desk request",
      }),
      state,
    );
    const presentation = createLayoutPresentation(rejectedResult, null);

    expect(presentation.mode).toBe("rejected_option");
    expect(presentation.displayLayout?.id).toBe(rejectedResult.evidenceOptionId);
    expect(presentation.layoutNotice).toContain("No layout has been accepted");
    expect(presentation.canShowAcceptedLayout).toBe(false);
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
    const acceptedLayout = selectedLayout(acceptedResult);
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
    expect(presentation.mode).toBe("retained_accepted");
    expect(presentation.displayLayout).toBe(acceptedLayout);
    expect(presentation.layoutNotice).toContain("not a rejected preview");
  });
});
