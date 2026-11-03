import { describe, expect, it } from "vitest";
import { createInitialDemoState } from "../src/domain/demo-state";
import {
  createFloorPlanVisionRequestOptions,
  createImportedPlanningFixture,
  floorPlanRecognitionJsonSchema,
  floorPlanVisionSystemPrompt,
  floorPlanVisionUserPrompt,
  parseFloorPlanRecognition,
} from "../src/domain/floor-plan-import";
import { rectangleIntersectsDoorSwing } from "../src/domain/geometry";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { evaluateManualPlacement } from "../src/domain/manual-placement";
import { createToolInputForTests } from "../src/domain/tool-contract";

const validRecognition =
  '{"schema":"single-room-topology-v1","roomShape":"rectangle","roomLabel":"present","doorOpening":"present","windowOpening":"present"}';

const rejectedFamilyAttempt1 =
  '{"schema":"single-room-v1","room":{"shape":"rectangle","aspectPermille":1000},"doors":[{"wall":"north","startPermille":100,"endPermille":100,"hinge":"south","swing":"inward","quadrant":"north-west"},{"wall":"east","startPermille":100,"endPermille":100,"hinge":"south","swing":"inward","quadrant":"north-west"}],"window":{"wall":"east","startPermille":100,"endPermille":100},"fixedObstruction":{"kind":"none"},"movableFurnitureSymbols":"present"}';

const rejectedFamilyAttempt2 =
  '{"schema":"single-room-v1","room":{"shape":"rectangle","aspectPermille":1000},"doors":[{"wall":"north","startPermille":100,"endPermille":100,"hinge":"south","swing":"inward","quadrant":"north-west"},{"wall":"east","startPermille":1000,"endPermille":1000,"hinge":"south","swing":"inward","quadrant":"north-west"}],"window":{"wall":"east","startPermille":1000,"endPermille":1000},"fixedObstruction":{"kind":"none"},"movableFurnitureSymbols":"present"}';

function importedFixture() {
  const parsed = parseFloorPlanRecognition(validRecognition);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return createImportedPlanningFixture(parsed.value);
}

describe("strict floor-plan recognition contract", () => {
  it("uses the exact neutral evidence prompts and deterministic request options", () => {
    expect(floorPlanVisionSystemPrompt).toBe(
      "You are a visual evidence classifier. Inspect only the supplied image and do not assume it is a floor plan. Every recognition field allows positive, negative, or uncertain evidence. Use roomShape=rectangle only for a clearly visible rectangular room-like boundary, roomShape=not_rectangle only for a clearly visible non-rectangular room-like boundary, and roomShape=uncertain otherwise. Use present only when the named feature is directly visible, absent only when clearly not visible, and uncertain when ambiguous or unreadable. Do not infer hidden content, expected fixtures, dimensions, scale, filename identity, or a fit verdict. Return exactly one compact JSON object matching the supplied schema and no prose.",
    );
    expect(floorPlanVisionUserPrompt).toBe(
      "Classify the independent visible evidence for room shape, a printed room label, at least one architectural door opening or swing, and at least one architectural window opening. Include every required key exactly once and return JSON only.",
    );
    expect(createFloorPlanVisionRequestOptions()).toEqual({
      search: {
        doSample: false,
        temperature: 0,
        seed: 42,
        maxOutputTokens: 320,
      },
      toolChoice: "none",
      additionalOptions: {
        guidance_type: "json_schema",
        guidance_data: JSON.stringify(floorPlanRecognitionJsonSchema),
        chat_template_kwargs: JSON.stringify({ enable_thinking: false }),
      },
    });
  });

  it("accepts the bounded ordered two-door fixture and converts it to app geometry", () => {
    const parsed = parseFloorPlanRecognition(validRecognition);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const fixture = createImportedPlanningFixture(parsed.value);
    expect(fixture.mode).toBe("imported");
    expect(fixture.roomPlan).toMatchObject({
      id: "imported-nara-master-bedroom",
      widthMm: 3650,
      depthMm: 3950,
      doorSwings: [
        {
          hingeXmm: 0,
          hingeYmm: 850,
          radiusMm: 850,
          quadrant: "south-east",
        },
      ],
      reservedZones: [
        {
          kind: "closet-access",
          rect: { xMm: 2400, yMm: 0, widthMm: 1250, depthMm: 700 },
        },
        {
          kind: "window-clearance",
          rect: { xMm: 1100, yMm: 3500, widthMm: 1450, depthMm: 450 },
        },
      ],
    });
  });

  it("keeps every semantic schema alternative open instead of forcing success", () => {
    expect(floorPlanRecognitionJsonSchema.properties.roomShape.enum).toEqual([
      "rectangle",
      "not_rectangle",
      "uncertain",
    ]);
    for (const key of ["roomLabel", "doorOpening", "windowOpening"] as const) {
      expect(floorPlanRecognitionJsonSchema.properties[key].enum).toEqual(["present", "absent", "uncertain"]);
    }
  });

  it("accepts harmless object-key ordering", () => {
    const parsed = JSON.parse(validRecognition) as Record<string, unknown>;
    const reordered = JSON.stringify({
      windowOpening: parsed.windowOpening,
      roomShape: parsed.roomShape,
      doorOpening: parsed.doorOpening,
      roomLabel: parsed.roomLabel,
      schema: parsed.schema,
    });

    expect(parseFloorPlanRecognition(reordered).ok).toBe(true);
  });

  it("checks the canonical imported entry-door swing", () => {
    const room = importedFixture().roomPlan;

    expect(rectangleIntersectsDoorSwing({ xMm: 50, yMm: 850, widthMm: 100, depthMm: 100 }, room)).toBe(true);
    expect(rectangleIntersectsDoorSwing({ xMm: 2500, yMm: 2500, widthMm: 100, depthMm: 100 }, room)).toBe(
      false,
    );
  });

  it.each([
    [
      "duplicate field",
      validRecognition.replace('"roomShape":"rectangle"', '"roomShape":"rectangle","roomShape":"rectangle"'),
    ],
    ["missing window", validRecognition.replace(/,"windowOpening":"present"/, "")],
    ["non-rectangular room", validRecognition.replace('"rectangle"', '"not_rectangle"')],
    ["uncertain room", validRecognition.replace('"rectangle"', '"uncertain"')],
    ["missing bedroom label", validRecognition.replace('"roomLabel":"present"', '"roomLabel":"absent"')],
    ["uncertain door", validRecognition.replace('"doorOpening":"present"', '"doorOpening":"uncertain"')],
    ["missing window", validRecognition.replace('"windowOpening":"present"', '"windowOpening":"absent"')],
    ["legacy bad Family attempt 1", rejectedFamilyAttempt1],
    ["legacy bad Family attempt 2", rejectedFamilyAttempt2],
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
  it("runs Queen success, King conflict, buyer-request C, and app-owned manual placement", () => {
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

    const turnC = compareKnownLayoutOptions(
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
    expect(turnC.status).toBe("feasible");
    const selected = turnC.feasibleOptions.find((option) => option.id === turnC.selectedOptionId) ?? null;
    expect(selected?.checkedStates.every((check) => check.passed)).toBe(true);

    const acceptedState = {
      ...state,
      version: 2,
      stateRef: "layout-state-v2",
      currentLayoutId: selected?.id ?? null,
      currentLayoutSource: "known-option" as const,
      activeFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"] as const,
      lastChangedPreference: turnC.changedPreference,
      lastResultStatus: turnC.status,
      lastToolResult: turnC,
    };
    const manual = evaluateManualPlacement(
      acceptedState,
      selected,
      {
        priorStateRef: acceptedState.stateRef,
        sourceLayoutId: selected?.id ?? "",
        instanceId: "desk-main",
        xMm: 2850,
        yMm: 850,
      },
      fixture.roomPlan,
    );
    expect(manual).toMatchObject({
      accepted: true,
      rejectionCode: null,
      selectedLayout: { placementSource: "manual-adjustment" },
    });

    const doorBlocked = evaluateManualPlacement(
      acceptedState,
      selected,
      {
        priorStateRef: acceptedState.stateRef,
        sourceLayoutId: selected?.id ?? "",
        instanceId: "desk-main",
        xMm: 300,
        yMm: 800,
      },
      fixture.roomPlan,
    );
    expect(doorBlocked).toMatchObject({
      accepted: false,
      rejectionCode: "INVALID_PLACEMENT",
      preview: {
        conflicts: expect.arrayContaining([expect.objectContaining({ code: "DOOR_SWING_OVERLAP" })]),
      },
    });

    const windowBlocked = evaluateManualPlacement(
      acceptedState,
      selected,
      {
        priorStateRef: acceptedState.stateRef,
        sourceLayoutId: selected?.id ?? "",
        instanceId: "bed-main",
        xMm: 1100,
        yMm: 1900,
      },
      fixture.roomPlan,
    );
    expect(windowBlocked).toMatchObject({
      accepted: false,
      rejectionCode: "INVALID_PLACEMENT",
      preview: {
        conflicts: expect.arrayContaining([
          expect.objectContaining({
            code: "RESERVED_ZONE_OVERLAP",
            zoneId: "window-clearance-zone",
          }),
        ]),
      },
    });

    const controlledFailure = compareKnownLayoutOptions(
      createToolInputForTests({
        state: acceptedState,
        planningFixture: fixture,
        candidateFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
        retainFurnitureIds: ["desk-compact", "crib-standard"],
      }),
      acceptedState,
      selected,
      fixture,
    );
    expect(controlledFailure.status).toBe("no_feasible_option");
    expect(controlledFailure.aggregateConflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "FURNITURE_CLEARANCE", actualDistanceMm: 70 }),
        expect.objectContaining({ code: "FURNITURE_CLEARANCE", actualDistanceMm: 170 }),
        expect.objectContaining({ code: "DOOR_SWING_OVERLAP" }),
      ]),
    );
  });
});
