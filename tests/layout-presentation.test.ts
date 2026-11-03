import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { createImportedPlanningFixture } from "../src/domain/floor-plan-import";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";
import { importedStageTurns } from "../src/foundry/prompt";
import { createLayoutPresentation } from "../src/renderer/layout-presentation";

describe("layout evidence presentation", () => {
  it("defaults A->B->C->E to the retained C layout while keeping exact E evidence available", () => {
    const fixture = createImportedPlanningFixture({
      schema: "single-room-topology-v1",
      roomShape: "rectangle",
      roomLabel: "present",
      doorOpening: "present",
      windowOpening: "present",
    });
    let state = createInitialDemoState(fixture.roomPlan);
    const turnA = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: importedStageTurns[0]?.prompt ?? "",
      }),
      state,
      null,
      fixture,
    );
    const turnALayout = turnA.feasibleOptions.find((option) => option.id === turnA.selectedOptionId) ?? null;
    state = applyToolResult(state, turnA);

    const turnB = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
        changedPreference: importedStageTurns[1]?.prompt ?? "",
      }),
      state,
      turnALayout,
      fixture,
    );
    state = applyToolResult(state, turnB);

    const turnC = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["bed-queen"],
        changedPreference: importedStageTurns[2]?.prompt ?? "",
      }),
      state,
      turnALayout,
      fixture,
    );
    const acceptedLayout =
      turnC.feasibleOptions.find((option) => option.id === turnC.selectedOptionId) ?? null;
    state = applyToolResult(state, turnC);

    const turnE = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["desk-compact", "crib-standard"],
        changedPreference: importedStageTurns[3]?.prompt ?? "",
      }),
      state,
      acceptedLayout,
      fixture,
    );
    state = applyToolResult(state, turnE);
    const presentation = createLayoutPresentation(turnE, acceptedLayout);

    expect(state.currentLayoutId).toBe("imported-queen-crib-compact-v1");
    expect(presentation.mode).toBe("accepted_after_rejection");
    expect(presentation.activeView).toBe("accepted");
    expect(presentation.displayLayout?.id).toBe("imported-queen-crib-compact-v1");
    expect(presentation.evidenceLayout?.id).toBe("imported-king-crib-compact-east-v1");
    expect(presentation.roomConflicts).toEqual([]);
    expect(presentation.conflicts).toEqual(presentation.evidenceLayout?.conflicts);
    expect(presentation.checks).toEqual(presentation.evidenceLayout?.checkedStates);
    expect(presentation.canShowAcceptedLayout).toBe(true);
    expect(presentation.canShowRejectedOption).toBe(true);
    expect(presentation.conflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(false);
    expect(presentation.checks.find((check) => check.id === "door-open")?.passed).toBe(true);
    expect(turnE.aggregateConflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(true);
    expect(presentation.conflictsLabel).toBe("Rejected option conflicts");
    expect(presentation.layoutTitle).toContain("accepted layout retained");
    expect(presentation.layoutNotice).toContain("did not replace it");

    const rejectedPreview = createLayoutPresentation(turnE, acceptedLayout, "rejected");
    expect(rejectedPreview.mode).toBe("rejected_option");
    expect(rejectedPreview.activeView).toBe("rejected");
    expect(rejectedPreview.displayLayout?.id).toBe(turnE.evidenceOptionId);
    expect(rejectedPreview.roomConflicts).toEqual(rejectedPreview.displayLayout?.conflicts);
    expect(rejectedPreview.layoutNotice).toContain("Aggregate reasons across 2 rejected options");
    expect(rejectedPreview.layoutNotice).toContain('select "Show accepted layout"');
    expect(
      rejectedPreview.evidenceLayout?.measurements.map((measurement) => [
        measurement.actualDistanceMm,
        measurement.requiredDistanceMm,
      ]),
    ).toEqual([
      [70, 250],
      [170, 250],
      [350, 250],
    ]);
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

    expect(rejectedResult.status).toBe("no_feasible_option");
    expect(rejectedResult.rejectedOptions.length).toBeGreaterThan(0);
    expect(presentation.mode).toBe("rejected_option");
    expect(presentation.displayLayout?.id).toBe(rejectedResult.evidenceOptionId);
    expect(presentation.conflicts).toEqual(presentation.displayLayout?.conflicts);
    expect(presentation.checks).toEqual(presentation.displayLayout?.checkedStates);
    expect(presentation.layoutNotice).toContain("No layout has been accepted");
    expect(presentation.layoutNotice).not.toContain("prior accepted layout");
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
