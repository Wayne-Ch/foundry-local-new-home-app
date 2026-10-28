import type {
  CheckedRoomState,
  ClearanceRuleSet,
  EvaluatedLayoutOption,
  FurnitureDefinition,
  FurniturePlacement,
  LayoutConflict,
  LayoutOption,
  Rectangle,
  ReservedZone,
  RoomPlan,
  RoomStateId,
} from "./types";

function rectangleEdges(rect: Rectangle) {
  return {
    left: rect.xMm,
    top: rect.yMm,
    right: rect.xMm + rect.widthMm,
    bottom: rect.yMm + rect.depthMm,
  };
}

export function rectanglesOverlap(left: Rectangle, right: Rectangle): boolean {
  const a = rectangleEdges(left);
  const b = rectangleEdges(right);
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function rectangleDistanceMm(left: Rectangle, right: Rectangle): number {
  const a = rectangleEdges(left);
  const b = rectangleEdges(right);
  const xGap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
  const yGap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
  return Math.hypot(xGap, yGap);
}

export function rectangleIntersectsDoorSwing(rect: Rectangle, room: RoomPlan): boolean {
  const edges = rectangleEdges(rect);
  const swing = room.doorSwing;
  if (edges.right < swing.hingeXmm || edges.top > swing.hingeYmm) {
    return false;
  }

  const nearestX = Math.max(edges.left, Math.min(swing.hingeXmm, edges.right));
  const nearestY = Math.max(edges.top, Math.min(swing.hingeYmm, edges.bottom));
  const distance = Math.hypot(nearestX - swing.hingeXmm, nearestY - swing.hingeYmm);
  return distance <= swing.radiusMm;
}

export function resolvePlacement(
  placement: FurniturePlacement,
  catalog: Readonly<Record<string, FurnitureDefinition>>,
) {
  const item = catalog[placement.furnitureId];
  if (item === undefined) {
    throw new Error(`Unknown furniture id: ${placement.furnitureId}`);
  }
  const rotated = placement.orientation === 90;
  return {
    ...placement,
    label: item.label,
    color: item.color,
    rect: {
      xMm: placement.xMm,
      yMm: placement.yMm,
      widthMm: rotated ? item.depthMm : item.widthMm,
      depthMm: rotated ? item.widthMm : item.depthMm,
    },
  };
}

function zoneRuleId(zone: ReservedZone): string {
  return zone.kind === "closet-access" ? "keep-closet-access-clear" : "keep-window-clearance";
}

function checkedState(
  id: RoomStateId,
  label: string,
  conflicts: readonly LayoutConflict[],
  codes: readonly LayoutConflict["code"][],
  evidence: string,
): CheckedRoomState {
  const relevant = conflicts.filter((conflict) => codes.includes(conflict.code));
  return {
    id,
    label,
    passed: relevant.length === 0,
    evidence: relevant.length === 0 ? evidence : relevant.map((conflict) => conflict.message).join(" "),
  };
}

export function evaluateLayoutOption(
  option: LayoutOption,
  room: RoomPlan,
  catalog: Readonly<Record<string, FurnitureDefinition>>,
  rules: ClearanceRuleSet,
): EvaluatedLayoutOption {
  const placements = option.placements.map((placement) => resolvePlacement(placement, catalog));
  const conflicts: LayoutConflict[] = [];

  for (const placement of placements) {
    const edges = rectangleEdges(placement.rect);
    if (edges.left < 0 || edges.top < 0 || edges.right > room.widthMm || edges.bottom > room.depthMm) {
      conflicts.push({
        code: "OUT_OF_BOUNDS",
        ruleId: "room-bounds",
        message: `${placement.label} extends outside the ${room.widthMm} x ${room.depthMm} mm room boundary.`,
        objectIds: [placement.instanceId],
      });
    }

    if (rectangleIntersectsDoorSwing(placement.rect, room)) {
      conflicts.push({
        code: "DOOR_SWING_OVERLAP",
        ruleId: "keep-door-swing-clear",
        message: `${placement.label} intersects the verified ${room.doorSwing.radiusMm} mm door swing.`,
        objectIds: [placement.instanceId],
        zoneId: room.doorSwing.id,
      });
    }

    for (const zone of room.reservedZones) {
      if (rectanglesOverlap(placement.rect, zone.rect)) {
        conflicts.push({
          code: "RESERVED_ZONE_OVERLAP",
          ruleId: zoneRuleId(zone),
          message: `${placement.label} overlaps the ${zone.label.toLowerCase()}.`,
          objectIds: [placement.instanceId],
          zoneId: zone.id,
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    const left = placements[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
      const right = placements[rightIndex];
      if (right === undefined) {
        continue;
      }

      if (rectanglesOverlap(left.rect, right.rect)) {
        conflicts.push({
          code: "FURNITURE_COLLISION",
          ruleId: "no-furniture-overlap",
          message: `${left.label} collides with ${right.label}.`,
          objectIds: [left.instanceId, right.instanceId],
          actualDistanceMm: 0,
          requiredDistanceMm: rules.minimumFurnitureGapMm,
        });
        continue;
      }

      const distance = rectangleDistanceMm(left.rect, right.rect);
      if (distance < rules.minimumFurnitureGapMm) {
        conflicts.push({
          code: "FURNITURE_CLEARANCE",
          ruleId: "minimum-furniture-gap",
          message: `${left.label} and ${right.label} have ${Math.round(distance)} mm clearance; ${rules.minimumFurnitureGapMm} mm is required.`,
          objectIds: [left.instanceId, right.instanceId],
          actualDistanceMm: Math.round(distance),
          requiredDistanceMm: rules.minimumFurnitureGapMm,
        });
      }
    }
  }

  const checkedStates: CheckedRoomState[] = [
    checkedState(
      "room-bounds",
      "All footprints inside verified room",
      conflicts,
      ["OUT_OF_BOUNDS"],
      "Every footprint is inside the verified room dimensions.",
    ),
    checkedState(
      "door-open",
      "Entry door can open",
      conflicts,
      ["DOOR_SWING_OVERLAP"],
      "No footprint intersects the verified door swing.",
    ),
    {
      id: "closet-access",
      label: "Closet access remains clear",
      passed: !conflicts.some(
        (conflict) => conflict.code === "RESERVED_ZONE_OVERLAP" && conflict.zoneId === "closet-access-zone",
      ),
      evidence:
        conflicts
          .filter(
            (conflict) =>
              conflict.code === "RESERVED_ZONE_OVERLAP" && conflict.zoneId === "closet-access-zone",
          )
          .map((conflict) => conflict.message)
          .join(" ") || "No footprint enters the verified closet access zone.",
    },
    {
      id: "window-clearance",
      label: "Window clearance remains clear",
      passed: !conflicts.some(
        (conflict) =>
          conflict.code === "RESERVED_ZONE_OVERLAP" && conflict.zoneId === "window-clearance-zone",
      ),
      evidence:
        conflicts
          .filter(
            (conflict) =>
              conflict.code === "RESERVED_ZONE_OVERLAP" && conflict.zoneId === "window-clearance-zone",
          )
          .map((conflict) => conflict.message)
          .join(" ") || "No footprint enters the verified window clearance zone.",
    },
    checkedState(
      "furniture-clearance",
      "Furniture clearance rule passes",
      conflicts,
      ["FURNITURE_COLLISION", "FURNITURE_CLEARANCE"],
      `Every furniture pair has at least ${rules.minimumFurnitureGapMm} mm clearance.`,
    ),
  ];

  return {
    id: option.id,
    label: option.label,
    status: conflicts.length === 0 ? "feasible" : "rejected",
    rationale: option.rationale,
    placements,
    conflicts,
    checkedStates,
  };
}
