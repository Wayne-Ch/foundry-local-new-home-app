import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";

describe("bounded layout tool", () => {
  it("runs the complete planned fixture sequence", () => {
    let state = createInitialDemoState();

    const turnA = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: "initial Queen and desk request",
      }),
      state,
    );
    expect(turnA.status).toBe("feasible");
    expect(turnA.selectedOptionId).toBe("queen-desk-standard-v1");
    state = applyToolResult(state, turnA);

    const turnB = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
        changedPreference: "replace Queen with King",
      }),
      state,
    );
    expect(turnB.status).toBe("no_feasible_option");
    expect(turnB.summary).toContain("the prior accepted layout remains active");
    expect(turnB.conflicts).toHaveLength(1);
    expect(turnB.conflicts[0]?.zoneId).toBe("closet-access-zone");
    const acceptedAfterFailure = state.currentLayoutId;
    state = applyToolResult(state, turnB);
    expect(state.currentLayoutId).toBe(acceptedAfterFailure);

    const turnC = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["bed-queen"],
        changedPreference: "keep Queen and add crib with revised desk",
      }),
      state,
    );
    expect(turnC.status).toBe("feasible");
    expect(turnC.selectedOptionId).toBe("queen-crib-compact-v1");
    state = applyToolResult(state, turnC);

    const controlledFailure = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["desk-compact", "crib-standard"],
        changedPreference: "replace Queen with King while retaining desk and crib",
      }),
      state,
    );
    expect(controlledFailure.status).toBe("no_feasible_option");
    expect(controlledFailure.rejectedOptions).toHaveLength(2);
    expect(controlledFailure.noResultReason?.code).toBe("NO_KNOWN_FEASIBLE_OPTION");
    expect(controlledFailure.feasibleOptions).toEqual([]);
    const previewOption = controlledFailure.rejectedOptions.find(
      (option) => option.id === controlledFailure.evidenceOptionId,
    );
    expect(previewOption?.id).toBe("king-crib-compact-east-v1");
    expect(controlledFailure.conflicts).toEqual(previewOption?.conflicts);
    expect(controlledFailure.checkedStates).toEqual(previewOption?.checkedStates);
    expect(controlledFailure.conflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP")).toBe(
      false,
    );
    expect(
      controlledFailure.aggregateConflicts.some((conflict) => conflict.code === "DOOR_SWING_OVERLAP"),
    ).toBe(true);
  });

  it("returns an honest no-known-set result instead of fabricating geometry", () => {
    const state = createInitialDemoState();
    const result = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-compact"],
        changedPreference: "unsupported exact combination",
      }),
      state,
    );
    expect(result.status).toBe("no_feasible_option");
    expect(result.noResultReason?.code).toBe("NO_KNOWN_OPTION_SET");
    expect(result.provenance.evaluatedLayoutIds).toEqual([]);
    expect(result.rejectedOptions).toEqual([]);
    expect(result.evidenceOptionId).toBeNull();
    expect(result.conflicts).toEqual([]);
    expect(result.aggregateConflicts).toEqual([]);
    expect(result.checkedStates).toEqual([]);
    expect(result.summary).toContain("no layout has been accepted");
  });

  it("states that no layout was accepted when the first request has only rejected options", () => {
    const state = createInitialDemoState();
    const result = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        changedPreference: "initial King and desk request",
      }),
      state,
    );

    expect(result.status).toBe("no_feasible_option");
    expect(result.rejectedOptions.length).toBeGreaterThan(0);
    expect(result.summary).toContain("no layout has been accepted");
    expect(result.summary).not.toContain("prior accepted layout");
  });
});
