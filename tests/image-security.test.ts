import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLOOR_PLAN_MAX_BYTES, validateFloorPlanImageBytes } from "../src/layout-import/image-security";
import { FloorPlanImageStore } from "../src/main/floor-plan-image-store";

const samplePath = new URL("../public/assets/floor-plan/sample-family-room.png", import.meta.url);

function oversizedPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

describe("floor-plan image security", () => {
  it("accepts the packaged PNG by magic signature and bounded dimensions", () => {
    const source = readFileSync(samplePath);
    const validated = validateFloorPlanImageBytes(source);

    expect(validated).toMatchObject({
      format: "png",
      mimeType: "image/png",
      width: 992,
      height: 776,
      byteLength: source.byteLength,
      pixelCount: 992 * 776,
    });
    expect(validated.bytes).not.toBe(source);
    expect(validated.bytes).toEqual(new Uint8Array(source));
  });

  it.each([
    ["svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["html", new TextEncoder().encode("<html><body>floor plan</body></html>")],
    ["pdf", new TextEncoder().encode("%PDF-1.7 floor plan")],
    ["office", new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(32)])],
  ])("rejects %s content even when a picker could rename it", (_kind, bytes) => {
    expect(() => validateFloorPlanImageBytes(bytes)).toThrow(/PNG, JPEG, or WebP|between 24 bytes/);
  });

  it("rejects byte, dimension, and pixel bombs before decoding", () => {
    expect(() => validateFloorPlanImageBytes(new Uint8Array(FLOOR_PLAN_MAX_BYTES + 1))).toThrow(
      /must be between/,
    );
    expect(() => validateFloorPlanImageBytes(oversizedPng(4096, 32))).toThrow(/dimensions/);
    expect(() => validateFloorPlanImageBytes(oversizedPng(2048, 2048))).toThrow(/pixels/);
  });

  it("owns, previews, and zero-fills bytes without exposing a filesystem path", () => {
    const source = readFileSync(samplePath);
    const store = new FloorPlanImageStore();
    const preview = store.load(source, "picker", "chosen-room.png");
    const owned = store.borrowBytes();

    expect(preview.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(preview).not.toHaveProperty("path");
    expect(owned.some((value) => value !== 0)).toBe(true);

    store.clear();

    expect(owned.every((value) => value === 0)).toBe(true);
    expect(store.preview).toBeNull();
    expect(() => store.borrowBytes()).toThrow("No floor-plan image is loaded");
  });

  it("can release inference bytes while retaining the sanitized preview", () => {
    const store = new FloorPlanImageStore();
    const preview = store.load(readFileSync(samplePath), "sample", "sample");
    const owned = store.borrowBytes();

    store.releaseBytesRetainingPreview();

    expect(owned.every((value) => value === 0)).toBe(true);
    expect(store.preview).toEqual(preview);
    expect(() => store.borrowBytes()).toThrow("No floor-plan image is loaded");
  });
});
