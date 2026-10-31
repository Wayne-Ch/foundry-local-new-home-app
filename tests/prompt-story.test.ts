import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests, preferredCandidateFurnitureIds } from "../src/domain/tool-contract";
import { stageTurns } from "../src/foundry/prompt";

describe("hands-on recovery story", () => {
  it("makes the King conflict, preference choice, and feasible recovery explicit", () => {
    expect(stageTurns.map((turn) => turn.label)).toEqual([
      "A · Queen + desk",
      "B · King conflict",
      "C · Choose Queen + baby bed",
      "E · King controlled failure",
    ]);
    expect(stageTurns[2]?.prompt).toBe(
      "Keep the Queen bed. Add a baby bed. Use a compact desk if needed. Keep the closet clear.",
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
      "baby bed requirement",
    ]);
    expect(preferredCandidateFurnitureIds(afterB, stageTurns[2]?.prompt ?? "")).toEqual({
      bed: "bed-queen",
      desk: "desk-compact",
      crib: "crib-standard",
    });

    const recovery = compareKnownLayoutOptions(
      createToolInputForTests({
        state: afterB,
        candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["bed-queen"],
        changedPreference: stageTurns[2]?.prompt ?? "",
      }),
      afterB,
    );
    expect(recovery.status).toBe("feasible");
    expect(recovery.selectedOptionId).toBe("queen-crib-compact-v1");
    expect(recovery.changedPreference).toContain("Keep the Queen bed");
    expect(afterB.lockedConstraints).toEqual(initial.lockedConstraints);
  });
});
