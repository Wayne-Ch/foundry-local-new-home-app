import { describe, expect, it } from "vitest";
import { createInitialDemoState } from "../src/domain/demo-state";
import {
  createImportedPlanningFixture,
  parseFloorPlanRecognition,
} from "../src/domain/floor-plan-import";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { evaluateManualPlacement } from "../src/domain/manual-placement";
import { createToolInputForTests } from "../src/domain/tool-contract";

const validRecognition =
  '{"schema":"single-room-v1","room":{"shape":"rectangle","aspectPermille":1390},"doors":[{"wall":"north","startPermille":170,"endPermille":300,"hinge":"west","swing":"inward","quadrant":"south-east"},{"wall":"east","startPermille":150,"endPermille":320,"hinge":"south","swing":"inward","quadrant":"north-west"}],"window":{"wall":"east","startPermille":500,"endPermille":690},"fixedObstruction":{"kind":"none"},"movableFurnitureSymbols":"present"}';

function importedFixture() {
  const parsed = parseFloorPlanRecognition(validRecognition);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return createImportedPlanningFixture(parsed.value);
}

describe("strict floor-plan recognition contract", () => {
  it("accepts the bounded ordered two-door fixture and converts it to app geometry", () => {
    const parsed = parseFloorPlanRecognition(validRecognition);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const fixture = createImportedPlanningFixture(parsed.value);
    expect(fixture.mode).toBe("imported");
    expect(fixture.roomPlan).toMatchObject({
      id: "imported-sample-family-room",
      widthMm: 5000,
      depthMm: 3600,
      doorSwings: [
        {
          hingeXmm: 850,
          hingeYmm: 0,
          radiusMm: 650,
          quadrant: "south-east",
        },
        {
          hingeXmm: 5000,
          hingeYmm: 1150,
          radiusMm: 600,
          quadrant: "north-west",
        },
      ],
      reservedZones: [
        {
          kind: "window-clearance",
          rect: { xMm: 4550, yMm: 1800, widthMm: 450, depthMm: 700 },
        },
      ],
    });
  });

  it.each([
    ["reordered keys", validRecognition.replace('"schema":"single-room-v1",', "") + '"schema":"single-room-v1"}'],
    [
      "duplicate field",
      validRecognition.replace(
        '"aspectPermille":1390',
        '"aspectPermille":1390,"aspectPermille":1390',
      ),
    ],
    ["missing window", validRecognition.replace(/,"window":\{[^}]+\}/, "")],
    [
      "reversed door span",
      validRecognition.replace('"startPermille":170,"endPermille":300', '"startPermille":300,"endPermille":170'),
    ],
    [
      "overlapping east door and window",
      validRecognition
        .replace('"startPermille":150,"endPermille":320', '"startPermille":300,"endPermille":520')
        .replace('"startPermille":500,"endPermille":690', '"startPermille":540,"endPermille":690'),
    ],
    ["wrong fixture topology", validRecognition.replace('"aspectPermille":1390', '"aspectPermille":1900')],
    ["extra prose", `${validRecognition}\nThe room is rectangular.`],
  ])("rejects %s", (_case, raw) => {
    expect(parseFloorPlanRecognition(raw).ok).toBe(false);
  });

  it("rejects infinite-style repetition without increasing output bounds", () => {
    const repeated = `${validRecognition.slice(0, -1)}${'"window":{}'.repeat(100)}}`;
    const parsed = parseFloorPlanRecognition(repeated);
    expect(parsed).toMatchObject({ ok: false });
  });
});

describe("imported deterministic planning chain", () => {
  it("runs Queen success, King conflict, recovery, and app-owned manual placement", () => {
    const fixture = importedFixture();
    let state = createInitialDemoState(fixture.roomPlan);

    const queen = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        planningFixture: fixture,
        candidateFurnitureIds: ["bed-queen", "desk-standard"],
      }),
      state,
      null,
      fixture,
    );
    expect(queen.status).toBe("feasible");
    state = {
      ...state,
      ...{
        version: 1,
        stateRef: "layout-state-v1",
        currentLayoutId: queen.selectedOptionId,
        currentLayoutSource: "known-option" as const,
        activeFurnitureIds: ["bed-queen", "desk-standard"] as const,
        lastChangedPreference: queen.changedPreference,
        lastResultStatus: queen.status,
        lastToolResult: queen,
      },
    };

    const king = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        planningFixture: fixture,
        candidateFurnitureIds: ["bed-king", "desk-standard"],
        retainFurnitureIds: ["desk-standard"],
      }),
      state,
      queen.feasibleOptions[0] ?? null,
      fixture,
    );
    expect(king.status).toBe("no_feasible_option");
    expect(king.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "FURNITURE_CLEARANCE",
          actualDistanceMm: 70,
          requiredDistanceMm: 250,
        }),
      ]),
    );

    const recovery = compareKnownLayoutOptions(
      createToolInputForTests({
        state,
        planningFixture: fixture,
        candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["bed-queen"],
      }),
      state,
      queen.feasibleOptions[0] ?? null,
      fixture,
    );
    expect(recovery.status).toBe("feasible");
    const selected =
      recovery.feasibleOptions.find((option) => option.id === recovery.selectedOptionId) ?? null;
    expect(selected?.checkedStates.every((check) => check.passed)).toBe(true);

    const acceptedState = {
      ...state,
      version: 2,
      stateRef: "layout-state-v2",
      currentLayoutId: selected?.id ?? null,
      currentLayoutSource: "known-option" as const,
      activeFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"] as const,
      lastChangedPreference: recovery.changedPreference,
      lastResultStatus: recovery.status,
      lastToolResult: recovery,
    };
    const manual = evaluateManualPlacement(
      acceptedState,
      selected,
      {
        priorStateRef: acceptedState.stateRef,
        sourceLayoutId: selected?.id ?? "",
        instanceId: "desk-main",
        xMm: 3650,
        yMm: 700,
      },
      fixture,
    );
    expect(manual).toMatchObject({
      accepted: true,
      rejectionCode: null,
      selectedLayout: { placementSource: "manual-adjustment" },
    });
  });
});

