import { describe, expect, it } from "vitest";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { evaluateManualPlacement, type ManualPlacementRequest } from "../src/domain/manual-placement";
import { createToolInputForTests } from "../src/domain/tool-contract";
import type { DemoState, EvaluatedLayoutOption } from "../src/domain/types";
import {
  clientPointToRoomPoint,
  keyboardPlacementOrigin,
  snappedPlacementOrigin,
} from "../src/renderer/placement-interaction";

function acceptedQueenDesk(): {
  readonly state: DemoState;
  readonly layout: EvaluatedLayoutOption;
} {
  const initial = createInitialDemoState();
  const result = compareKnownLayoutOptions(
    createToolInputForTests({
      state: initial,
      candidateFurnitureIds: ["bed-queen", "desk-standard"],
      changedPreference: "Queen and desk",
    }),
    initial,
  );
  const layout = result.feasibleOptions.find((option) => option.id === result.selectedOptionId);
  if (layout === undefined) {
    throw new Error("Missing accepted Queen layout");
  }
  return { state: applyToolResult(initial, result), layout };
}

function request(
  state: DemoState,
  layout: EvaluatedLayoutOption,
  overrides: Partial<ManualPlacementRequest> = {},
): ManualPlacementRequest {
  return {
    priorStateRef: state.stateRef,
    sourceLayoutId: layout.id,
    instanceId: "desk-main",
    xMm: 2350,
    yMm: 500,
    ...overrides,
  };
}

describe("manual placement coordinate conversion", () => {
  it("accounts for letterboxing when converting client pixels into SVG room coordinates", () => {
    expect(
      clientPointToRoomPoint(
        { x: 100, y: 100 },
        { left: 0, top: 0, width: 200, height: 200 },
        { x: 0, y: 0, width: 100, height: 50 },
      ),
    ).toEqual({ xMm: 50, yMm: 25 });
  });

  it("snaps and bounds pointer movement to the room", () => {
    expect(
      snappedPlacementOrigin(
        { xMm: 4188, yMm: -20 },
        { xMm: 100, yMm: 100 },
        { widthMm: 600, depthMm: 1200 },
        { widthMm: 4200, depthMm: 3600 },
      ),
    ).toEqual({ xMm: 3600, yMm: 0 });
  });

  it("quantizes non-grid footprint bounds down to the nearest valid grid origin", () => {
    expect(
      snappedPlacementOrigin(
        { xMm: 5000, yMm: 5000 },
        { xMm: 0, yMm: 0 },
        { widthMm: 1524, depthMm: 2032 },
        { widthMm: 4200, depthMm: 3600 },
      ),
    ).toEqual({ xMm: 2650, yMm: 1550 });
  });

  it("supports deterministic keyboard adjustment", () => {
    expect(
      keyboardPlacementOrigin({ xMm: 2400, yMm: 500, widthMm: 600, depthMm: 1200 }, "ArrowLeft", {
        widthMm: 4200,
        depthMm: 3600,
      }),
    ).toEqual({ xMm: 2350, yMm: 500 });
  });
});

describe("manual placement validation and commit", () => {
  it("commits a valid snapped adjustment as a new manual application layout version", () => {
    const { state, layout } = acceptedQueenDesk();
    const outcome = evaluateManualPlacement(state, layout, request(state, layout));

    expect(outcome.accepted).toBe(true);
    expect(outcome.preview?.status).toBe("feasible");
    expect(outcome.preview?.placementSource).toBe("manual-adjustment");
    expect(outcome.state.stateRef).toBe("layout-state-v2");
    expect(outcome.state.currentLayoutId).toBe("manual-layout-v2");
    expect(outcome.state.currentLayoutSource).toBe("manual-adjustment");
    expect(outcome.state.lastToolResult).toBe(state.lastToolResult);
    expect(outcome.selectedLayout?.placements.find((item) => item.instanceId === "desk-main")).toMatchObject({
      xMm: 2350,
      yMm: 500,
    });
  });

  it("preserves accepted manual coordinates on a retain-only conversational turn", () => {
    const { state, layout } = acceptedQueenDesk();
    const manual = evaluateManualPlacement(state, layout, request(state, layout));
    if (!manual.accepted || manual.selectedLayout === null) {
      throw new Error("Expected a valid manual layout");
    }
    const retained = compareKnownLayoutOptions(
      createToolInputForTests({
        state: manual.state,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
        retainFurnitureIds: ["bed-queen", "desk-standard"],
        changedPreference: "Keep the Queen bed and standard desk where they are.",
      }),
      manual.state,
      manual.selectedLayout,
    );

    expect(retained.selectedOptionId).toBe(manual.selectedLayout.id);
    expect(retained.feasibleOptions[0]?.placementSource).toBe("manual-adjustment");
    expect(
      retained.feasibleOptions[0]?.placements.find((placement) => placement.instanceId === "desk-main"),
    ).toMatchObject({
      xMm: 2350,
      yMm: 500,
    });
  });

  it.each([
    ["bounds", { xMm: 3650, yMm: 500 }, "OUT_OF_BOUNDS"],
    ["collision", { xMm: 1800, yMm: 650 }, "FURNITURE_COLLISION"],
    ["clearance", { xMm: 2050, yMm: 650 }, "FURNITURE_CLEARANCE"],
    ["closet zone", { xMm: 2650, yMm: 500 }, "RESERVED_ZONE_OVERLAP"],
    ["door swing", { xMm: 0, yMm: 2400 }, "DOOR_SWING_OVERLAP"],
  ] as const)("rejects an invalid %s preview without changing accepted state", (_label, origin, code) => {
    const { state, layout } = acceptedQueenDesk();
    const outcome = evaluateManualPlacement(
      state,
      layout,
      request(state, layout, { xMm: origin.xMm, yMm: origin.yMm }),
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.rejectionCode).toBe("INVALID_PLACEMENT");
    expect(outcome.preview?.conflicts.some((conflict) => conflict.code === code)).toBe(true);
    expect(outcome.state).toBe(state);
    expect(outcome.selectedLayout).toBe(layout);
  });

  it("rejects stale and off-grid requests before geometry can replace state", () => {
    const { state, layout } = acceptedQueenDesk();
    expect(
      evaluateManualPlacement(state, layout, request(state, layout, { priorStateRef: "layout-state-v0" }))
        .rejectionCode,
    ).toBe("STALE_STATE");
    expect(evaluateManualPlacement(state, layout, request(state, layout, { xMm: 2375 })).rejectionCode).toBe(
      "INVALID_COORDINATES",
    );
  });
});
