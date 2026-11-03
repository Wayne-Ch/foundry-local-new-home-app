import type { LayoutOption, PlanningFixture, RoomPlan } from "./types";

export const FLOOR_PLAN_VISION_MODEL_ID = "qwen3.5-0.8b-generic-cpu:3";
export const FLOOR_PLAN_VISION_EXECUTION_PROVIDER = "CPUExecutionProvider";
export const IMPORTED_ROOM_PLAN_ID = "imported-nara-master-bedroom";
export const IMPORTED_ROOM_PLAN_VERSION = "2026-11-03.2";
export const FLOOR_PLAN_SAMPLE_ASSET_PATH = "assets/floor-plan/sample-master-bedroom.png";
export const FLOOR_PLAN_VISION_MAX_OUTPUT_TOKENS = 320;

const IMPORTED_ROOM_WIDTH_MM = 3650;
const IMPORTED_ROOM_DEPTH_MM = 3950;
const MAX_RECOGNITION_BYTES = 2048;

export type RecognitionAlternative = "present" | "absent" | "uncertain";

export interface FloorPlanRecognition {
  readonly schema: "single-room-topology-v1";
  readonly roomShape: "rectangle" | "not_rectangle" | "uncertain";
  readonly roomLabel: RecognitionAlternative;
  readonly doorOpening: RecognitionAlternative;
  readonly windowOpening: RecognitionAlternative;
}

export interface FloorPlanRecognitionError {
  readonly code: "INVALID_OUTPUT" | "CONTENT_MISMATCH" | "REPETITION";
  readonly message: string;
}

export type FloorPlanRecognitionResult =
  | { readonly ok: true; readonly value: FloorPlanRecognition }
  | { readonly ok: false; readonly error: FloorPlanRecognitionError };

export const floorPlanRecognitionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema: { type: "string", enum: ["single-room-topology-v1"] },
    roomShape: { type: "string", enum: ["rectangle", "not_rectangle", "uncertain"] },
    roomLabel: { type: "string", enum: ["present", "absent", "uncertain"] },
    doorOpening: { type: "string", enum: ["present", "absent", "uncertain"] },
    windowOpening: { type: "string", enum: ["present", "absent", "uncertain"] },
  },
  required: ["schema", "roomShape", "roomLabel", "doorOpening", "windowOpening"],
} as const;

export const floorPlanVisionSystemPrompt =
  "You are a visual evidence classifier. Inspect only the supplied image and do not assume it is a floor plan. Every recognition field allows positive, negative, or uncertain evidence. Use roomShape=rectangle only for a clearly visible rectangular room-like boundary, roomShape=not_rectangle only for a clearly visible non-rectangular room-like boundary, and roomShape=uncertain otherwise. Use present only when the named feature is directly visible, absent only when clearly not visible, and uncertain when ambiguous or unreadable. Do not infer hidden content, expected fixtures, dimensions, scale, filename identity, or a fit verdict. Return exactly one compact JSON object matching the supplied schema and no prose.";

export const floorPlanVisionUserPrompt =
  "Classify the independent visible evidence for room shape, a printed room label, at least one architectural door opening or swing, and at least one architectural window opening. Include every required key exactly once and return JSON only.";

export function createFloorPlanVisionRequestOptions() {
  return {
    search: {
      doSample: false,
      temperature: 0,
      seed: 42,
      maxOutputTokens: FLOOR_PLAN_VISION_MAX_OUTPUT_TOKENS,
    },
    toolChoice: "none" as const,
    additionalOptions: {
      guidance_type: "json_schema",
      guidance_data: JSON.stringify(floorPlanRecognitionJsonSchema),
      chat_template_kwargs: JSON.stringify({ enable_thinking: false }),
    },
  };
}

const expectedKeyCounts = {
  schema: 1,
  roomShape: 1,
  roomLabel: 1,
  doorOpening: 1,
  windowOpening: 1,
} as const;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function keyCount(raw: string, key: string): number {
  return raw.match(new RegExp(`"${key}"\\s*:`, "g"))?.length ?? 0;
}

export function parseFloorPlanRecognition(raw: string): FloorPlanRecognitionResult {
  if (new TextEncoder().encode(raw).byteLength > MAX_RECOGNITION_BYTES || raw.includes("\0")) {
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

  if (Object.entries(expectedKeyCounts).some(([key, expected]) => keyCount(raw, key) !== expected)) {
    return {
      ok: false,
      error: {
        code: "INVALID_OUTPUT",
        message: "Vision output was missing, duplicated, or extended beyond the exact single-room contract.",
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INVALID_OUTPUT",
        message: `Vision output was not one complete JSON object: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ["schema", "roomShape", "roomLabel", "doorOpening", "windowOpening"]) ||
    parsed.schema !== "single-room-topology-v1" ||
    !["rectangle", "not_rectangle", "uncertain"].includes(String(parsed.roomShape)) ||
    !["present", "absent", "uncertain"].includes(String(parsed.roomLabel)) ||
    !["present", "absent", "uncertain"].includes(String(parsed.doorOpening)) ||
    !["present", "absent", "uncertain"].includes(String(parsed.windowOpening))
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_OUTPUT",
        message: "Vision output did not match the exact single-room object shape.",
      },
    };
  }

  if (
    parsed.roomShape !== "rectangle" ||
    parsed.roomLabel !== "present" ||
    parsed.doorOpening !== "present" ||
    parsed.windowOpening !== "present"
  ) {
    return {
      ok: false,
      error: {
        code: "CONTENT_MISMATCH",
        message:
          "The image did not visibly confirm the supported rectangular room with a label, door, and window.",
      },
    };
  }

  return {
    ok: true,
    value: {
      schema: "single-room-topology-v1",
      roomShape: "rectangle",
      roomLabel: "present",
      doorOpening: "present",
      windowOpening: "present",
    },
  };
}

function importedRoomPlan(_recognition: FloorPlanRecognition): RoomPlan {
  return {
    id: IMPORTED_ROOM_PLAN_ID,
    version: IMPORTED_ROOM_PLAN_VERSION,
    label: "Imported NARA master bedroom · experimental",
    unit: "mm",
    widthMm: IMPORTED_ROOM_WIDTH_MM,
    depthMm: IMPORTED_ROOM_DEPTH_MM,
    verifiedBy:
      "Foundry Local recognized topology; application applied the NARA fixture's documented dimensions and canonical geometry",
    verifiedAt: "2026-11-03",
    doorSwings: [
      {
        id: "imported-entry-door-swing",
        label: "upper-left inward entry-door swing",
        hingeXmm: 0,
        hingeYmm: 850,
        radiusMm: 850,
        quadrant: "south-east",
      },
    ],
    reservedZones: [
      {
        id: "closet-access-zone",
        label: "Built-in closet and standing access zone",
        kind: "closet-access",
        rect: {
          xMm: 2400,
          yMm: 0,
          widthMm: 1250,
          depthMm: 700,
        },
      },
      {
        id: "window-clearance-zone",
        label: "Exterior window clearance zone",
        kind: "window-clearance",
        rect: {
          xMm: 1100,
          yMm: 3500,
          widthMm: 1450,
          depthMm: 450,
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
    rationale: "Keeps the canonical entry door, closet access, and exterior window clear.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-queen", xMm: 900, yMm: 1050, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-standard",
        xMm: 2800,
        yMm: 1000,
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
      { instanceId: "bed-main", furnitureId: "bed-king", xMm: 800, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-standard",
        xMm: 2800,
        yMm: 1200,
        orientation: 90,
      },
    ],
  },
  {
    id: "imported-queen-crib-compact-v1",
    label: "Imported room · Queen + baby bed + compact desk",
    furnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
    rationale: "Uses the east side while preserving the canonical entry, closet, and window zones.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-queen", xMm: 850, yMm: 1000, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 2800,
        yMm: 850,
        orientation: 90,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 2750,
        yMm: 2100,
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
      { instanceId: "bed-main", furnitureId: "bed-queen", xMm: 850, yMm: 1000, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 2800,
        yMm: 850,
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
      { instanceId: "bed-main", furnitureId: "bed-king", xMm: 800, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 2800,
        yMm: 850,
        orientation: 90,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 2900,
        yMm: 2100,
        orientation: 90,
      },
    ],
  },
  {
    id: "imported-king-crib-compact-door-v1",
    label: "Imported room · King + baby bed + compact desk near entry",
    furnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    rationale: "Moving the compact desk toward the upper-left entry crosses the canonical door swing.",
    placements: [
      { instanceId: "bed-main", furnitureId: "bed-king", xMm: 800, yMm: 1200, orientation: 0 },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 300,
        yMm: 800,
        orientation: 0,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 2900,
        yMm: 2100,
        orientation: 90,
      },
    ],
  },
] as const;

export function createImportedPlanningFixture(recognition: FloorPlanRecognition): PlanningFixture {
  return {
    mode: "imported",
    roomPlan: importedRoomPlan(recognition),
    knownLayoutOptions: importedKnownLayoutOptions,
  };
}
