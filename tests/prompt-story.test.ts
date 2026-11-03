import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests, preferredCandidateFurnitureIds } from "../src/domain/tool-contract";
import { nextPendingStageTurnIndex, stageTurns } from "../src/foundry/prompt";

describe("hands-on buyer request story", () => {
  it("makes the King conflict and the new Queen, desk, and baby-bed request explicit", () => {
    expect(stageTurns.map((turn) => turn.label)).toEqual([
      "A · Queen + desk",
      "B · King conflict",
      "C · Queen + desk + baby bed",
      "E · King controlled failure",
    ]);
    expect(stageTurns[2]?.prompt).toBe(
      "Can we do a Queen bed and a desk, and also add a baby bed? A compact desk is fine if needed. Keep the door, closet, and window clear, and leave the 250 mm furniture-clearance rule locked.",
    );
    expect(nextPendingStageTurnIndex(stageTurns, [])).toBe(0);
    expect(nextPendingStageTurnIndex(stageTurns, ["turn-a"])).toBe(1);
    expect(nextPendingStageTurnIndex(stageTurns, ["turn-a", "turn-b"])).toBe(2);
    expect(nextPendingStageTurnIndex(stageTurns, ["turn-a", "turn-b", "turn-c"])).toBe(3);
    expect(nextPendingStageTurnIndex(stageTurns, ["turn-a", "turn-b", "turn-c", "controlled-failure"])).toBe(
      -1,
    );

    const initial = createInitialDemoState();
    const turnA = compareKnownLayoutOptions(
      createToolInputForTests({
        state: initial,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: stageTurns[0]?.prompt ?? "",
      }),
      initial,
    );
    const afterA = applyToolResult(initial, turnA);
    const turnB = compareKnownLayoutOptions(
      createToolInputForTests({
        state: afterA,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
        changedPreference: stageTurns[1]?.prompt ?? "",
      }),
      afterA,
    );
    const afterB = applyToolResult(afterA, turnB);
    expect(turnB.status).toBe("no_feasible_option");
    expect(turnB.noResultReason?.preferencesThatMayChange).toEqual([
      "bed size",
      "desk footprint or orientation",
    ]);
    expect(preferredCandidateFurnitureIds(afterB, stageTurns[2]?.prompt ?? "")).toEqual({
      bed: "bed-queen",
      desk: "desk-compact",
      crib: "crib-standard",
    });

    const turnC = compareKnownLayoutOptions(
      createToolInputForTests({
        state: afterB,
        candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["bed-queen"],
        changedPreference: stageTurns[2]?.prompt ?? "",
      }),
      afterB,
    );
    expect(turnC.status).toBe("feasible");
    expect(turnC.selectedOptionId).toBe("queen-crib-compact-v1");
    expect(turnC.changedPreference).toContain("also add a baby bed");
    expect(afterB.lockedConstraints).toEqual(initial.lockedConstraints);

    const afterC = applyToolResult(afterB, turnC);
    const acceptedTurnC =
      turnC.feasibleOptions.find((option) => option.id === turnC.selectedOptionId) ?? null;
    const turnE = compareKnownLayoutOptions(
      createToolInputForTests({
        state: afterC,
        candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["desk-compact", "crib-standard"],
        changedPreference: stageTurns[3]?.prompt ?? "",
      }),
      afterC,
      acceptedTurnC,
    );
    expect(turnE.status).toBe("no_feasible_option");
    expect(turnE.noResultReason?.preferencesThatMayChange).toEqual([
      "bed size",
      "desk footprint or orientation",
      "baby bed requirement",
    ]);
  });
});
