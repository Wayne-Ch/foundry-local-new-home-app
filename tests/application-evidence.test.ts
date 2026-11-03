import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { defaultPlanningFixture } from "../src/domain/fixture";
import { createImportedPlanningFixture } from "../src/domain/floor-plan-import";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createToolInputForTests } from "../src/domain/tool-contract";
import type { EvaluatedLayoutOption, PlanningFixture } from "../src/domain/types";
import { renderApplicationEvidence } from "../src/foundry/foundry-service";
import { defaultStageTurns, importedStageTurns } from "../src/foundry/prompt";
import type { StageTurnDefinition } from "../src/shared/contracts";

const importedFixture = createImportedPlanningFixture({
  schema: "single-room-topology-v1",
  roomShape: "rectangle",
  roomLabel: "present",
  doorOpening: "present",
  windowOpening: "present",
});

const scenarios: readonly {
  readonly label: string;
  readonly fixture: PlanningFixture;
  readonly turns: readonly StageTurnDefinition[];
}[] = [
  { label: "default room", fixture: defaultPlanningFixture, turns: defaultStageTurns },
  { label: "imported room", fixture: importedFixture, turns: importedStageTurns },
];

function selectedLayout(result: ReturnType<typeof compareKnownLayoutOptions>): EvaluatedLayoutOption | null {
  return result.feasibleOptions.find((option) => option.id === result.selectedOptionId) ?? null;
}

describe.each(scenarios)("application evidence copy for $label", ({ fixture, turns }) => {
  it("keeps the deterministic feasible verdict first and labels the exact user request", () => {
    const state = createInitialDemoState(fixture.roomPlan);
    const prompt = turns[0]?.prompt ?? "";
    const result = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        planningFixture: fixture,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: prompt,
      }),
      state,
      null,
      fixture,
    );

    const text = renderApplicationEvidence(result, null);

    expect(text).toBe(
      `${selectedLayout(result)?.label} passes every locked deterministic check. User request: ${prompt}`,
    );
    expect(text).not.toContain("Application evidence:");
    expect(text).not.toContain("Preference interpreted:");
  });

  it("keeps the deterministic rejected verdict first and labels the exact user request", () => {
    let state = createInitialDemoState(fixture.roomPlan);
    const accepted = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        planningFixture: fixture,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: turns[0]?.prompt ?? "",
      }),
      state,
      null,
      fixture,
    );
    const acceptedLayout = selectedLayout(accepted);
    state = applyToolResult(state, accepted);
    const prompt = turns[1]?.prompt ?? "";
    const rejected = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        planningFixture: fixture,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
        changedPreference: prompt,
      }),
      state,
      acceptedLayout,
      fixture,
    );

    const text = renderApplicationEvidence(rejected, acceptedLayout);

    expect(text).toMatch(/^No feasible known option\./);
    expect(text).toContain(`User request: ${prompt}`);
    expect(text.endsWith(`User request: ${prompt}`)).toBe(true);
    expect(text).not.toContain("Application evidence:");
    expect(text).not.toContain("Preference interpreted:");
  });
});
