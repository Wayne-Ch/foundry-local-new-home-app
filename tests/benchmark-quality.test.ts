import { describe, expect, it } from "vitest";
import {
  benchmarkGateFailures,
  type ExpectedLayoutIntent,
  evaluateScenarioQuality,
} from "../src/domain/benchmark-quality";
import type { LayoutIntentDelta } from "../src/domain/tool-contract";

const expectedIntent: ExpectedLayoutIntent = {
  bed: ["queen"],
  desk: ["flexible"],
  crib: ["keep"],
  clarification: ["none"],
};

describe("layout benchmark semantic gate", () => {
  it("fails a trivial model that always chooses the first unrestricted enum value", () => {
    const trivialFirstEnumIntent: LayoutIntentDelta = {
      bed: "keep",
      desk: "keep",
      crib: "keep",
      changedPreference: "Can a Queen bed and a desk fit?",
      clarification: "none",
    };
    const quality = evaluateScenarioQuality({
      actualIntent: trivialFirstEnumIntent,
      expectedIntent,
      actualFurniture: ["bed-queen", "desk-standard"],
      expectedFurniture: ["bed-queen", "desk-standard"],
      actualStatus: "feasible",
      expectedStatus: "feasible",
      actualSelectedOptionId: "queen-desk-standard-v1",
      expectedSelectedOptionId: "queen-desk-standard-v1",
    });

    expect(quality).toMatchObject({
      passed: false,
    });
    expect(quality.failures.join(" ")).toContain("intent.bed=keep");
    expect(quality.failures.join(" ")).toContain("intent.desk=keep");

    expect(
      benchmarkGateFailures(
        [{ exactId: "trivial-first-enum:1", passed: quality.passed }],
        ["trivial-first-enum:1"],
        null,
      ),
    ).toEqual([
      "Required candidate trivial-first-enum:1 failed one or more quality scenarios.",
      "No passing model was selected.",
    ]);
  });

  it("requires every designated candidate and a selected passing result", () => {
    expect(
      benchmarkGateFailures(
        [
          { exactId: "default:1", passed: true },
          { exactId: "baseline:1", passed: false },
        ],
        ["default:1", "baseline:1"],
        { id: "default:1" },
      ),
    ).toEqual(["Required candidate baseline:1 failed one or more quality scenarios."]);

    expect(
      benchmarkGateFailures(
        [
          { exactId: "default:1", passed: true },
          { exactId: "baseline:1", passed: true },
        ],
        ["default:1", "baseline:1"],
        { id: "default:1" },
      ),
    ).toEqual([]);
  });
});
