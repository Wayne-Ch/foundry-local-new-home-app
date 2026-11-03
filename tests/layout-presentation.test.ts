import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { createImportedPlanningFixture } from "../src/domain/floor-plan-import";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";
import { importedStageTurns } from "../src/foundry/prompt";
import { createLayoutPresentation } from "../src/renderer/layout-presentation";

describe("layout evidence presentation", () => {
  it("defaults B after A to the rejected preview while preserving exact A state and B evidence", () => {
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
    const rejectedPreview = createLayoutPresentation(turnB, turnALayout);

    expect(state.currentLayoutId).toBe("imported-queen-desk-standard-v1");
    expect(rejectedPreview.mode).toBe("rejected_option");
    expect(rejectedPreview.activeView).toBe("rejected");
    expect(rejectedPreview.displayLayout?.id).toBe("imported-king-desk-standard-v1");
    expect(rejectedPreview.evidenceLayout).toBe(rejectedPreview.displayLayout);
    expect(rejectedPreview.roomConflicts).toEqual(rejectedPreview.displayLayout?.conflicts);
    expect(rejectedPreview.resultBadgeText).toBe("Rejected preview · not accepted");
    expect(rejectedPreview.layoutTitle).toContain("Rejected preview");
    expect(rejectedPreview.layoutNotice).toContain(
      "Accepted layout preserved: Imported room · Queen + rotated standard desk (imported-queen-desk-standard-v1)",
    );
    expect(
      rejectedPreview.evidenceLayout?.measurements.map((measurement) => [
        measurement.actualDistanceMm,
        measurement.requiredDistanceMm,
      ]),
    ).toEqual([[70, 250]]);

    const acceptedLayout = createLayoutPresentation(turnB, turnALayout, "accepted");
    expect(acceptedLayout.mode).toBe("accepted_after_rejection");
    expect(acceptedLayout.activeView).toBe("accepted");
    expect(acceptedLayout.displayLayout?.id).toBe("imported-queen-desk-standard-v1");
    expect(acceptedLayout.evidenceLayout?.id).toBe("imported-king-desk-standard-v1");
    expect(acceptedLayout.roomConflicts).toEqual([]);
    expect(acceptedLayout.layoutTitle).toContain("accepted layout preserved");
    expect(acceptedLayout.layoutNotice).toContain('Select "Inspect rejected option"');
  });

  it("defaults E after recovery C to the rejected preview while preserving exact C state and E evidence", () => {
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
    const rejectedPreview = createLayoutPresentation(turnE, acceptedLayout);

    expect(state.currentLayoutId).toBe("imported-queen-crib-compact-v1");
    expect(rejectedPreview.mode).toBe("rejected_option");
    expect(rejectedPreview.activeView).toBe("rejected");
    expect(rejectedPreview.displayLayout?.id).toBe("imported-king-crib-compact-east-v1");
    expect(rejectedPreview.evidenceLayout).toBe(rejectedPreview.displayLayout);
    expect(rejectedPreview.roomConflicts).toEqual(rejectedPreview.displayLayout?.conflicts);
    expect(rejectedPreview.conflicts).toEqual(rejectedPreview.evidenceLayout?.conflicts);
    expect(rejectedPreview.checks).toEqual(rejectedPreview.evidenceLayout?.checkedStates);
    expect(rejectedPreview.canShowAcceptedLayout).toBe(true);
    expect(rejectedPreview.canShowRejectedOption).toBe(true);
    expect(rejectedPreview.conflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(false);
    expect(rejectedPreview.checks.find((check) => check.id === "door-open")?.passed).toBe(true);
    expect(turnE.aggregateConflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(true);
    expect(rejectedPreview.conflictsLabel).toBe("Rejected preview conflicts");
    expect(rejectedPreview.layoutTitle).toContain("Rejected preview");
    expect(rejectedPreview.layoutNotice).toContain("Aggregate reasons across 2 rejected options");
    expect(rejectedPreview.layoutNotice).toContain(
      "Accepted layout preserved: Imported room · Queen + baby bed + compact desk (imported-queen-crib-compact-v1)",
    );
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

    const acceptedPresentation = createLayoutPresentation(turnE, acceptedLayout, "accepted");
    expect(acceptedPresentation.mode).toBe("accepted_after_rejection");
    expect(acceptedPresentation.activeView).toBe("accepted");
    expect(acceptedPresentation.displayLayout?.id).toBe("imported-queen-crib-compact-v1");
    expect(acceptedPresentation.evidenceLayout?.id).toBe("imported-king-crib-compact-east-v1");
    expect(acceptedPresentation.roomConflicts).toEqual([]);
    expect(acceptedPresentation.conflicts).toEqual(acceptedPresentation.evidenceLayout?.conflicts);
    expect(acceptedPresentation.layoutTitle).toContain("accepted layout preserved");
    expect(acceptedPresentation.layoutNotice).toContain('Select "Inspect rejected option"');
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
