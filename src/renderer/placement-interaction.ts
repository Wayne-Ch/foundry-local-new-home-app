import { MANUAL_PLACEMENT_GRID_MM } from "../domain/manual-placement";
import type { Point, Rectangle, RoomPlan } from "../domain/types";

export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

export interface ClientRectangle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SvgViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function clientPointToRoomPoint(
  point: ClientPoint,
  clientRect: ClientRectangle,
  viewBox: SvgViewBox,
): Point {
  const scale = Math.min(clientRect.width / viewBox.width, clientRect.height / viewBox.height);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const offsetX = (clientRect.width - renderedWidth) / 2;
  const offsetY = (clientRect.height - renderedHeight) / 2;
  return {
    xMm: viewBox.x + (point.x - clientRect.left - offsetX) / scale,
    yMm: viewBox.y + (point.y - clientRect.top - offsetY) / scale,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function snap(value: number, gridMm: number): number {
  return Math.round(value / gridMm) * gridMm;
}

export function snappedPlacementOrigin(
  pointer: Point,
  grabOffset: Point,
  footprint: Pick<Rectangle, "widthMm" | "depthMm">,
  room: Pick<RoomPlan, "widthMm" | "depthMm">,
  gridMm = MANUAL_PLACEMENT_GRID_MM,
): Point {
  const maxX = Math.max(0, room.widthMm - footprint.widthMm);
  const maxY = Math.max(0, room.depthMm - footprint.depthMm);
  const maxGridX = Math.floor(maxX / gridMm) * gridMm;
  const maxGridY = Math.floor(maxY / gridMm) * gridMm;
  return {
    xMm: clamp(snap(pointer.xMm - grabOffset.xMm, gridMm), 0, maxGridX),
    yMm: clamp(snap(pointer.yMm - grabOffset.yMm, gridMm), 0, maxGridY),
  };
}

export function keyboardPlacementOrigin(
  rect: Rectangle,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  room: Pick<RoomPlan, "widthMm" | "depthMm">,
  stepMm = MANUAL_PLACEMENT_GRID_MM,
): Point {
  const deltaX = key === "ArrowLeft" ? -stepMm : key === "ArrowRight" ? stepMm : 0;
  const deltaY = key === "ArrowUp" ? -stepMm : key === "ArrowDown" ? stepMm : 0;
  return snappedPlacementOrigin(
    { xMm: rect.xMm + deltaX, yMm: rect.yMm + deltaY },
    { xMm: 0, yMm: 0 },
    rect,
    room,
    MANUAL_PLACEMENT_GRID_MM,
  );
}
