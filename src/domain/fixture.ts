import type {
  ClearanceRuleSet,
  FurnitureDefinition,
  FurnitureId,
  LayoutOption,
  LockedConstraints,
  RoomPlan,
} from "./types";

export const ROOM_PLAN_ID = "ignite-bedroom-a";
export const ROOM_PLAN_VERSION = "2026-10-27.1";
export const CLEARANCE_RULE_SET_ID = "ignite-demo-clearance";
export const CLEARANCE_RULE_SET_VERSION = "1.0.0";
export const LOCKED_CONSTRAINT_SET_ID = "verified-bedroom-locks-v1";
export const REQUIRED_ROOM_STATE_SET_ID = "all-required-room-states-v1";
export const FURNITURE_CATALOG_VERSION = "2026-10-30.1";
export const GEOMETRY_ENGINE_VERSION = "1.1.0";

export const lockedConstraints: LockedConstraints = {
  verifiedMeasurementsOnly: true,
  keepDoorSwingClear: true,
  keepClosetAccessClear: true,
  keepWindowClearance: true,
  enforceFurnitureClearance: true,
};

export const roomPlan: RoomPlan = {
  id: ROOM_PLAN_ID,
  version: ROOM_PLAN_VERSION,
  label: "Verified empty bedroom plan",
  unit: "mm",
  widthMm: 4200,
  depthMm: 3600,
  verifiedBy: "Demo fixture: tape-measure plan",
  verifiedAt: "2026-10-27",
  doorSwing: {
    id: "door-entry-swing",
    label: "900 mm inward entry-door swing",
    hingeXmm: 0,
    hingeYmm: 3600,
    radiusMm: 900,
    quadrant: "north-east",
  },
  reservedZones: [
    {
      id: "closet-access-zone",
      label: "Closet door and standing access zone",
      kind: "closet-access",
      rect: {
        xMm: 3200,
        yMm: 450,
        widthMm: 1000,
        depthMm: 2300,
      },
    },
    {
      id: "window-clearance-zone",
      label: "Window clearance zone",
      kind: "window-clearance",
      rect: {
        xMm: 1400,
        yMm: 0,
        widthMm: 1400,
        depthMm: 450,
      },
    },
  ],
};

export const clearanceRuleSet: ClearanceRuleSet = {
  id: CLEARANCE_RULE_SET_ID,
  version: CLEARANCE_RULE_SET_VERSION,
  unit: "mm",
  minimumFurnitureGapMm: 250,
  notes: [
    "Furniture footprints must remain inside the verified room boundary.",
    "No footprint may overlap the entry-door swing, closet access zone, or window clearance zone.",
    "Known options require at least 250 mm between furniture footprints.",
    "This demo is footprint and clearance planning only, not safety, structural, or accessibility certification.",
  ],
};

export const furnitureCatalog: Readonly<Record<FurnitureId, FurnitureDefinition>> = {
  "bed-queen": {
    id: "bed-queen",
    label: "Queen bed",
    category: "bed",
    widthMm: 1524,
    depthMm: 2032,
    source: "Verified demo catalog",
    color: "#5B8DEF",
  },
  "bed-king": {
    id: "bed-king",
    label: "King bed",
    category: "bed",
    widthMm: 1930,
    depthMm: 2032,
    source: "Verified demo catalog",
    color: "#9B6BE8",
  },
  "desk-standard": {
    id: "desk-standard",
    label: "Standard desk",
    category: "desk",
    widthMm: 1200,
    depthMm: 600,
    source: "Verified demo catalog",
    color: "#E6A23C",
  },
  "desk-compact": {
    id: "desk-compact",
    label: "Compact desk",
    category: "desk",
    widthMm: 900,
    depthMm: 500,
    source: "Verified demo catalog",
    color: "#F4C95D",
  },
  "crib-standard": {
    id: "crib-standard",
    label: "Baby bed",
    category: "crib",
    widthMm: 1320,
    depthMm: 740,
    source: "Verified demo catalog; footprint planning only",
    color: "#4CC9A6",
  },
};

export const knownLayoutOptions: readonly LayoutOption[] = [
  {
    id: "queen-desk-standard-v1",
    label: "Queen + rotated standard desk",
    furnitureIds: ["bed-queen", "desk-standard"],
    rationale: "Keeps the verified door, closet, and window zones clear.",
    placements: [
      {
        instanceId: "bed-main",
        furnitureId: "bed-queen",
        xMm: 300,
        yMm: 650,
        orientation: 0,
      },
      {
        instanceId: "desk-main",
        furnitureId: "desk-standard",
        xMm: 2400,
        yMm: 500,
        orientation: 90,
      },
    ],
  },
  {
    id: "king-desk-standard-v1",
    label: "King + rotated standard desk",
    furnitureIds: ["bed-king", "desk-standard"],
    rationale: "The only known standard-desk placement shifts into the closet access zone.",
    placements: [
      {
        instanceId: "bed-main",
        furnitureId: "bed-king",
        xMm: 300,
        yMm: 650,
        orientation: 0,
      },
      {
        instanceId: "desk-main",
        furnitureId: "desk-standard",
        xMm: 2700,
        yMm: 500,
        orientation: 90,
      },
    ],
  },
  {
    id: "queen-crib-compact-v1",
    label: "Queen + baby bed + rotated compact desk",
    furnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
    rationale: "The compact rotated desk preserves the Queen bed and opens a verified baby-bed footprint.",
    placements: [
      {
        instanceId: "bed-main",
        furnitureId: "bed-queen",
        xMm: 300,
        yMm: 650,
        orientation: 0,
      },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 2300,
        yMm: 550,
        orientation: 90,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 2400,
        yMm: 1950,
        orientation: 90,
      },
    ],
  },
  {
    id: "queen-compact-desk-v1",
    label: "Queen + compact desk",
    furnitureIds: ["bed-queen", "desk-compact"],
    rationale: "Retains the revised compact desk after removing the baby bed.",
    placements: [
      {
        instanceId: "bed-main",
        furnitureId: "bed-queen",
        xMm: 300,
        yMm: 650,
        orientation: 0,
      },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 2300,
        yMm: 550,
        orientation: 90,
      },
    ],
  },
  {
    id: "king-crib-compact-east-v1",
    label: "King + baby bed + compact desk (east)",
    furnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    rationale: "The King footprint removes the required furniture gaps in the known east-side arrangement.",
    placements: [
      {
        instanceId: "bed-main",
        furnitureId: "bed-king",
        xMm: 300,
        yMm: 650,
        orientation: 0,
      },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 2300,
        yMm: 550,
        orientation: 90,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 2400,
        yMm: 1950,
        orientation: 90,
      },
    ],
  },
  {
    id: "king-crib-compact-south-v1",
    label: "King + baby bed + compact desk (south)",
    furnitureIds: ["bed-king", "desk-compact", "crib-standard"],
    rationale: "Moving the desk south enters the door swing and still misses required furniture clearance.",
    placements: [
      {
        instanceId: "bed-main",
        furnitureId: "bed-king",
        xMm: 300,
        yMm: 650,
        orientation: 0,
      },
      {
        instanceId: "desk-main",
        furnitureId: "desk-compact",
        xMm: 500,
        yMm: 2850,
        orientation: 0,
      },
      {
        instanceId: "crib-main",
        furnitureId: "crib-standard",
        xMm: 2400,
        yMm: 1950,
        orientation: 90,
      },
    ],
  },
] as const;

function furnitureSetKey(ids: readonly FurnitureId[]): string {
  return [...ids].sort().join("|");
}

export function getKnownLayoutOptions(ids: readonly FurnitureId[]): readonly LayoutOption[] {
  const key = furnitureSetKey(ids);
  return knownLayoutOptions.filter((option) => furnitureSetKey(option.furnitureIds) === key);
}
