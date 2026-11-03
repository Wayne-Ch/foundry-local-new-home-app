import type {
  CheckedRoomState,
  ClearanceRuleSet,
  EvaluatedLayoutOption,
  FurnitureDefinition,
  FurniturePlacement,
  LayoutConflict,
  LayoutOption,
  Point,
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
  return rectangleSeparation(left, right).distanceMm;
}

export interface RectangleSeparation {
  readonly from: Point;
  readonly to: Point;
  readonly distanceMm: number;
}

function nearestAxisPoints(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): readonly [number, number] {
  if (leftEnd < rightStart) {
    return [leftEnd, rightStart];
  }
  if (rightEnd < leftStart) {
    return [leftStart, rightEnd];
  }
  const overlapStart = Math.max(leftStart, rightStart);
  const overlapEnd = Math.min(leftEnd, rightEnd);
  const midpoint = (overlapStart + overlapEnd) / 2;
  return [midpoint, midpoint];
}

export function rectangleSeparation(left: Rectangle, right: Rectangle): RectangleSeparation {
  const a = rectangleEdges(left);
  const b = rectangleEdges(right);
  const [fromX, toX] = nearestAxisPoints(a.left, a.right, b.left, b.right);
  const [fromY, toY] = nearestAxisPoints(a.top, a.bottom, b.top, b.bottom);
  return {
    from: { xMm: fromX, yMm: fromY },
    to: { xMm: toX, yMm: toY },
    distanceMm: Math.hypot(toX - fromX, toY - fromY),
  };
}

export function rectangleIntersectsDoorSwing(rect: Rectangle, room: RoomPlan): boolean {
  const edges = rectangleEdges(rect);
  return room.doorSwings.some((swing) => {
    const east = swing.quadrant.endsWith("east");
    const south = swing.quadrant.startsWith("south");
    if (
      (east && edges.right < swing.hingeXmm) ||
      (!east && edges.left > swing.hingeXmm) ||
      (south && edges.bottom < swing.hingeYmm) ||
      (!south && edges.top > swing.hingeYmm)
    ) {
      return false;
    }

    const nearestX = Math.max(edges.left, Math.min(swing.hingeXmm, edges.right));
    const nearestY = Math.max(edges.top, Math.min(swing.hingeYmm, edges.bottom));
    const distance = Math.hypot(nearestX - swing.hingeXmm, nearestY - swing.hingeYmm);
    return distance <= swing.radiusMm;
  });
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
  placementSource: EvaluatedLayoutOption["placementSource"] = "known-option",
): EvaluatedLayoutOption {
  const placements = option.placements.map((placement) => resolvePlacement(placement, catalog));
  const conflicts: LayoutConflict[] = [];
  const measurements: EvaluatedLayoutOption["measurements"][number][] = [];

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

    for (const swing of room.doorSwings) {
      if (
        rectangleIntersectsDoorSwing(placement.rect, {
          ...room,
          doorSwings: [swing],
        })
      ) {
        conflicts.push({
          code: "DOOR_SWING_OVERLAP",
          ruleId: "keep-door-swing-clear",
          message: `${placement.label} intersects the verified ${swing.radiusMm} mm ${swing.label.toLowerCase()}.`,
          objectIds: [placement.instanceId],
          zoneId: swing.id,
        });
      }
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

      const separation = rectangleSeparation(left.rect, right.rect);
      const actualDistanceMm = Math.round(separation.distanceMm);
      measurements.push({
        id: `${left.instanceId}--${right.instanceId}`,
        kind: "furniture-clearance",
        objectIds: [left.instanceId, right.instanceId],
        labels: [left.label, right.label],
        actualDistanceMm,
        requiredDistanceMm: rules.minimumFurnitureGapMm,
        passed: actualDistanceMm >= rules.minimumFurnitureGapMm && !rectanglesOverlap(left.rect, right.rect),
      });

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

      if (separation.distanceMm < rules.minimumFurnitureGapMm) {
        conflicts.push({
          code: "FURNITURE_CLEARANCE",
          ruleId: "minimum-furniture-gap",
          message: `${left.label} and ${right.label} have ${actualDistanceMm} mm clearance; ${rules.minimumFurnitureGapMm} mm is required.`,
          objectIds: [left.instanceId, right.instanceId],
          actualDistanceMm,
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
      "Doors can open",
      conflicts,
      ["DOOR_SWING_OVERLAP"],
      "No footprint intersects a verified door swing.",
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
    placementSource,
    rationale: option.rationale,
    placements,
    measurements,
    conflicts,
    checkedStates,
  };
}
