import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";

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
});
