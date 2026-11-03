import type { LayoutOption, PlanningFixture, RoomPlan } from "./types";

export const FLOOR_PLAN_VISION_MODEL_ID = "qwen3.5-0.8b-generic-cpu:3";
export const FLOOR_PLAN_VISION_EXECUTION_PROVIDER = "CPUExecutionProvider";
export const IMPORTED_ROOM_PLAN_ID = "imported-sample-family-room";
export const IMPORTED_ROOM_PLAN_VERSION = "2026-11-03.1";
export const FLOOR_PLAN_SAMPLE_ASSET_PATH = "assets/floor-plan/sample-family-room.png";

const IMPORTED_ROOM_WIDTH_MM = 5000;
const IMPORTED_ROOM_DEPTH_MM = 3600;
const WINDOW_CLEARANCE_DEPTH_MM = 450;
const MAX_RECOGNITION_BYTES = 2048;

export interface RecognizedOpening {
  readonly wall: "north" | "east";
  readonly startPermille: number;
  readonly endPermille: number;
}

export interface FloorPlanRecognition {
  readonly schema: "single-room-v1";
  readonly room: {
    readonly shape: "rectangle";
    readonly aspectPermille: number;
  };
  readonly doors: readonly [
    RecognizedOpening & {
      readonly hinge: "west";
      readonly swing: "inward";
      readonly quadrant: "south-east";
    },
    RecognizedOpening & {
      readonly hinge: "south";
      readonly swing: "inward";
      readonly quadrant: "north-west";
    },
  ];
  readonly window: RecognizedOpening;
  readonly fixedObstruction: {
    readonly kind: "none";
  };
  readonly movableFurnitureSymbols: "present";
}

export interface FloorPlanRecognitionError {
  readonly code:
    | "INVALID_OUTPUT"
    | "INVALID_ORDER"
    | "OUT_OF_RANGE"
    | "CONFLICTING_GEOMETRY"
    | "REPETITION";
  readonly message: string;
}

export type FloorPlanRecognitionResult =
  | { readonly ok: true; readonly value: FloorPlanRecognition }
  | { readonly ok: false; readonly error: FloorPlanRecognitionError };

export const floorPlanRecognitionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema: { type: "string", enum: ["single-room-v1"] },
    room: {
      type: "object",
      additionalProperties: false,
      properties: {
        shape: { type: "string", enum: ["rectangle"] },
        aspectPermille: { type: "integer", minimum: 1000, maximum: 2000 },
      },
      required: ["shape", "aspectPermille"],
    },
    doors: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          wall: { type: "string", enum: ["north", "east"] },
          startPermille: { type: "integer", minimum: 0, maximum: 1000 },
          endPermille: { type: "integer", minimum: 0, maximum: 1000 },
          hinge: { type: "string", enum: ["west", "south"] },
          swing: { type: "string", enum: ["inward"] },
          quadrant: { type: "string", enum: ["south-east", "north-west"] },
        },
        required: [
          "wall",
          "startPermille",
          "endPermille",
          "hinge",
          "swing",
          "quadrant",
        ],
      },
    },
    window: {
      type: "object",
      additionalProperties: false,
      properties: {
        wall: { type: "string", enum: ["east"] },
        startPermille: { type: "integer", minimum: 0, maximum: 1000 },
        endPermille: { type: "integer", minimum: 0, maximum: 1000 },
      },
      required: ["wall", "startPermille", "endPermille"],
    },
    fixedObstruction: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["none"] },
      },
      required: ["kind"],
    },
    movableFurnitureSymbols: { type: "string", enum: ["present"] },
  },
  required: [
    "schema",
    "room",
    "doors",
    "window",
    "fixedObstruction",
    "movableFurnitureSymbols",
  ],
} as const;

export const floorPlanVisionSystemPrompt = `
Inspect one packaged architectural room-plan crop. Return exactly one compact JSON object matching the supplied schema.
The crop contains one rectangular room, two visible inward-swinging doors, one east-wall window, gray movable furniture symbols, and no fixed obstruction.
Treat the word "Family", gray sofas/chairs/tables, exterior labels, and crop-edge artifacts as source annotations, not walls or fixed obstructions.
Report geometry from visible content only. Coordinates are integer permille positions along the named wall, measured west-to-east on north and north-to-south on east.
Order doors as north-wall door first and east-wall door second. startPermille must be lower than endPermille.
Do not add prose, Markdown, confidence, filenames, hashes, dimensions, or extra keys.
`.trim();

export const floorPlanVisionUserPrompt = `
Recognize the single room topology. Preserve this exact key order:
schema, room, doors, window, fixedObstruction, movableFurnitureSymbols.
Within every object preserve the schema key order. Return JSON only.
`.trim();

const strictRecognitionPattern =
  /^\{\s*"schema"\s*:\s*"single-room-v1"\s*,\s*"room"\s*:\s*\{\s*"shape"\s*:\s*"rectangle"\s*,\s*"aspectPermille"\s*:\s*(\d{1,4})\s*\}\s*,\s*"doors"\s*:\s*\[\s*\{\s*"wall"\s*:\s*"north"\s*,\s*"startPermille"\s*:\s*(\d{1,4})\s*,\s*"endPermille"\s*:\s*(\d{1,4})\s*,\s*"hinge"\s*:\s*"west"\s*,\s*"swing"\s*:\s*"inward"\s*,\s*"quadrant"\s*:\s*"south-east"\s*\}\s*,\s*\{\s*"wall"\s*:\s*"east"\s*,\s*"startPermille"\s*:\s*(\d{1,4})\s*,\s*"endPermille"\s*:\s*(\d{1,4})\s*,\s*"hinge"\s*:\s*"south"\s*,\s*"swing"\s*:\s*"inward"\s*,\s*"quadrant"\s*:\s*"north-west"\s*\}\s*\]\s*,\s*"window"\s*:\s*\{\s*"wall"\s*:\s*"east"\s*,\s*"startPermille"\s*:\s*(\d{1,4})\s*,\s*"endPermille"\s*:\s*(\d{1,4})\s*\}\s*,\s*"fixedObstruction"\s*:\s*\{\s*"kind"\s*:\s*"none"\s*\}\s*,\s*"movableFurnitureSymbols"\s*:\s*"present"\s*\}\s*$/;

function repetitionDetected(raw: string): boolean {
  if (raw.length <= 384) {
    return false;
  }
  for (let size = 24; size <= 96; size += 8) {
    const tail = raw.slice(-size);
    if (tail.length === size && raw.endsWith(tail.repeat(3))) {
      return true;
    }
  }
  return false;
}

function inRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function parseFloorPlanRecognition(raw: string): FloorPlanRecognitionResult {
  if (Buffer.byteLength(raw, "utf8") > MAX_RECOGNITION_BYTES || raw.includes("\0")) {
    return {
      ok: false,
      error: {
        code: "INVALID_OUTPUT",
        message: "Vision output exceeded the bounded contract or contained a NUL byte.",
      },
    };
  }
  if (repetitionDetected(raw)) {
    return {
      ok: false,
      error: {
        code: "REPETITION",
        message: "Vision output repeated instead of completing the bounded contract.",
      },
    };
  }

  const match = strictRecognitionPattern.exec(raw);
  if (match === null) {
    return {
      ok: false,
      error: {
        code: "INVALID_ORDER",
        message:
          "Vision output was missing, duplicated, reordered, or extended beyond the exact single-room contract.",
      },
    };
  }

  const values = match.slice(1).map((value) => Number(value));
  const [
    aspectPermille,
    northDoorStart,
    northDoorEnd,
    eastDoorStart,
    eastDoorEnd,
    windowStart,
    windowEnd,
  ] = values;
  if (
    aspectPermille === undefined ||
    northDoorStart === undefined ||
    northDoorEnd === undefined ||
    eastDoorStart === undefined ||
    eastDoorEnd === undefined ||
    windowStart === undefined ||
    windowEnd === undefined
  ) {
    return {
      ok: false,
      error: { code: "INVALID_OUTPUT", message: "Vision output omitted a required numeric field." },
    };
  }

  if (
    !inRange(aspectPermille, 1200, 1550) ||
    !inRange(northDoorStart, 100, 260) ||
    !inRange(northDoorEnd, 230, 400) ||
    !inRange(eastDoorStart, 100, 280) ||
    !inRange(eastDoorEnd, 220, 420) ||
    !inRange(windowStart, 400, 620) ||
    !inRange(windowEnd, 580, 780)
  ) {
    return {
      ok: false,
      error: {
        code: "OUT_OF_RANGE",
        message: "Recognized room topology does not match the bounded sample fixture.",
      },
    };
  }

  const northDoorSpan = northDoorEnd - northDoorStart;
  const eastDoorSpan = eastDoorEnd - eastDoorStart;
  const windowSpan = windowEnd - windowStart;
  if (
    !inRange(northDoorSpan, 80, 220) ||
    !inRange(eastDoorSpan, 80, 220) ||
    !inRange(windowSpan, 100, 260) ||
    eastDoorEnd + 60 >= windowStart
  ) {
    return {
      ok: false,
      error: {
        code: "CONFLICTING_GEOMETRY",
        message: "Recognized openings are reversed, overlapping, duplicated, or geometrically infeasible.",
      },
    };
  }

  return {
    ok: true,
    value: {
      schema: "single-room-v1",
      room: { shape: "rectangle", aspectPermille },
      doors: [
        {
          wall: "north",
          startPermille: northDoorStart,
          endPermille: northDoorEnd,
          hinge: "west",
          swing: "inward",
          quadrant: "south-east",
        },
        {
          wall: "east",
          startPermille: eastDoorStart,
          endPermille: eastDoorEnd,
          hinge: "south",
          swing: "inward",
          quadrant: "north-west",
        },
      ],
      window: {
        wall: "east",
        startPermille: windowStart,
        endPermille: windowEnd,
      },
      fixedObstruction: { kind: "none" },
      movableFurnitureSymbols: "present",
    },
  };
}

function snap50(value: number): number {
  return Math.round(value / 50) * 50;
}

function importedRoomPlan(recognition: FloorPlanRecognition): RoomPlan {
  const [northDoor, eastDoor] = recognition.doors;
  const northDoorRadius = snap50(
    ((northDoor.endPermille - northDoor.startPermille) / 1000) * IMPORTED_ROOM_WIDTH_MM,
  );
  const eastDoorRadius = snap50(
    ((eastDoor.endPermille - eastDoor.startPermille) / 1000) * IMPORTED_ROOM_DEPTH_MM,
  );
  const windowStart = snap50(
    (recognition.window.startPermille / 1000) * IMPORTED_ROOM_DEPTH_MM,
  );
  const windowDepth = snap50(
    ((recognition.window.endPermille - recognition.window.startPermille) / 1000) *
      IMPORTED_ROOM_DEPTH_MM,
  );

  return {
    id: IMPORTED_ROOM_PLAN_ID,
    version: IMPORTED_ROOM_PLAN_VERSION,
    label: "Imported sample room · experimental",
    unit: "mm",
    widthMm: IMPORTED_ROOM_WIDTH_MM,
    depthMm: IMPORTED_ROOM_DEPTH_MM,
    verifiedBy:
      "Foundry Local recognized topology; application applied the documented demo scale and deterministic geometry",
    verifiedAt: "2026-11-03",
    doorSwings: [
      {
        id: "imported-north-door-swing",
        label: "north-west inward door swing",
        hingeXmm: snap50((northDoor.startPermille / 1000) * IMPORTED_ROOM_WIDTH_MM),
        hingeYmm: 0,
        radiusMm: northDoorRadius,
        quadrant: "south-east",
      },
      {
        id: "imported-east-door-swing",
        label: "east-wall inward door swing",
        hingeXmm: IMPORTED_ROOM_WIDTH_MM,
        hingeYmm: snap50((eastDoor.endPermille / 1000) * IMPORTED_ROOM_DEPTH_MM),
        radiusMm: eastDoorRadius,
        quadrant: "north-west",
      },
    ],
    reservedZones: [
      {
        id: "window-clearance-zone",
        label: "East window clearance zone",
        kind: "window-clearance",
        rect: {
          xMm: IMPORTED_ROOM_WIDTH_MM - WINDOW_CLEARANCE_DEPTH_MM,
          yMm: windowStart,
          widthMm: WINDOW_CLEARANCE_DEPTH_MM,
          depthMm: windowDepth,
        },
      },
    ],
  };
}

const importedKnownLayoutOptions: readonly LayoutOption[] = [
  {
    id: "imported-queen-desk-standard-v1",
    label: "Imported room · Queen + rotated standard desk",
    furnitureIds: ["bed-queen", "desk-standard"],
    rationale: "Keeps both recognized door swings and the east window clearance clear.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-queen", xMm: 1700, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-standard",
        xMm: 3800,
        yMm: 1600,
        orientation: 90,
      },
    ],
  },
  {
    id: "imported-king-desk-standard-v1",
    label: "Imported room · King + rotated standard desk",
    furnitureIds: ["bed-king", "desk-standard"],
    rationale: "The bounded King option leaves only 70 mm to the standard desk.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-king", xMm: 1600, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-standard",
        xMm: 3600,
        yMm: 1600,
        orientation: 90,
      },
    ],
  },
  {
    id: "imported-queen-crib-compact-v1",
    label: "Imported room · Queen + baby bed + compact desk",
    furnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
    rationale: "Uses the center and south-east floor area while preserving both recognized openings.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-queen", xMm: 1500, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 3600,
        yMm: 700,
        orientation: 90,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 3500,
        yMm: 2000,
        orientation: 90,
      },
    ],
  },
  {
    id: "imported-queen-compact-desk-v1",
    label: "Imported room · Queen + compact desk",
    furnitureIds: ["bed-queen", "desk-compact"],
    rationale: "Retains the compact desk after removing the baby bed.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-queen", xMm: 1500, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 3600,
        yMm: 700,
        orientation: 90,
      },
    ],
  },
  {
    id: "imported-king-crib-compact-east-v1",
    label: "Imported room · King + baby bed + compact desk",
    furnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    rationale: "The King footprint leaves only 170 mm to the baby bed.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-king", xMm: 1500, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 3600,
        yMm: 700,
        orientation: 90,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 3600,
        yMm: 2000,
        orientation: 90,
      },
    ],
  },
  {
    id: "imported-king-crib-compact-north-v1",
    label: "Imported room · King + baby bed + compact desk near north door",
    furnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    rationale: "Moving the compact desk north enters the recognized north-west door swing.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-king", xMm: 1500, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 1050,
        yMm: 250,
        orientation: 0,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 3600,
        yMm: 2000,
        orientation: 90,
      },
    ],
  },
] as const;

export function createImportedPlanningFixture(
  recognition: FloorPlanRecognition,
): PlanningFixture {
  return {
    mode: "imported",
    roomPlan: importedRoomPlan(recognition),
    knownLayoutOptions: importedKnownLayoutOptions,
  };
}

