import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { createImportedPlanningFixture } from "../src/domain/floor-plan-import";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";
import type { EvaluatedLayoutOption } from "../src/domain/types";
import { importedStageTurns } from "../src/foundry/prompt";

describe("demo state transitions", () => {
  it("increments state references and keeps the accepted layout on failed comparisons", () => {
    const initial = createInitialDemoState();
    const feasible = compareKnownLayoutOptions(
      createToolInputForTests({
        state: initial,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
      }),
      initial,
    );
    const accepted = applyToolResult(initial, feasible);
    expect(accepted.stateRef).toBe("layout-state-v1");
    expect(accepted.currentLayoutId).toBe("queen-desk-standard-v1");

    const failed = compareKnownLayoutOptions(
      createToolInputForTests({
        state: accepted,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
      }),
      accepted,
    );
    const afterFailure = applyToolResult(accepted, failed);
    expect(afterFailure.stateRef).toBe("layout-state-v2");
    expect(afterFailure.currentLayoutId).toBe("queen-desk-standard-v1");
    expect(afterFailure.activeFurnitureIds).toEqual(["bed-queen", "desk-standard"]);
    expect(afterFailure.lastResultStatus).toBe("no_feasible_option");
  });

  it("preserves imported buyer-request C as the accepted domain state after A->B->C->E", () => {
    const fixture = createImportedPlanningFixture({
      schema: "single-room-topology-v1",
      roomShape: "rectangle",
      roomLabel: "present",
      doorOpening: "present",
      windowOpening: "present",
    });
    let state = createInitialDemoState(fixture.roomPlan);
    let acceptedLayout: EvaluatedLayoutOption | null = null;
    const turns = [
      {
        candidateFurnitureIds: ["bed-queen", "desk-standard"] as const,
        retainFurnitureIds: [] as const,
      },
      {
        candidateFurnitureIds: ["bed-king", "desk-standard"] as const,
        retainFurnitureIds: ["desk-standard"] as const,
      },
      {
        candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"] as const,
        retainFurnitureIds: ["bed-queen"] as const,
      },
      {
        candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"] as const,
        retainFurnitureIds: ["desk-compact", "crib-standard"] as const,
      },
    ];

    for (const [index, turn] of turns.entries()) {
      const result = compareKnownLayoutOptions(
        createToolInputForTests({
          state,
          candidateFurnitureIds: turn.candidateFurnitureIds,
          retainFurnitureIds: turn.retainFurnitureIds,
          changedPreference: importedStageTurns[index]?.prompt ?? "",
        }),
        state,
        acceptedLayout,
        fixture,
      );
      state = applyToolResult(state, result);
      if (result.status === "feasible") {
        acceptedLayout =
          result.feasibleOptions.find((option) => option.id === result.selectedOptionId) ?? null;
      }
    }

    expect(state).toMatchObject({
      stateRef: "layout-state-v4",
      version: 4,
      currentLayoutId: "imported-queen-crib-compact-v1",
      currentLayoutSource: "known-option",
      activeFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
      lastResultStatus: "no_feasible_option",
      lastToolResult: {
        stateRef: "layout-state-v3",
        selectedOptionId: null,
        evidenceOptionId: "imported-king-crib-compact-east-v1",
      },
    });
  });
});
