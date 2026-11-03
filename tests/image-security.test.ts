import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLOOR_PLAN_MAX_BYTES, validateFloorPlanImageBytes } from "../src/layout-import/image-security";
import { FloorPlanImageStore } from "../src/main/floor-plan-image-store";

const samplePath = new URL("../public/assets/floor-plan/sample-master-bedroom.png", import.meta.url);

function oversizedPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  bytes[7] = height >> 8;
  bytes[8] = height & 0xff;
  bytes[9] = width >> 8;
  bytes[10] = width & 0xff;
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode("VP8X"), 12);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes.set([widthMinusOne & 0xff, (widthMinusOne >> 8) & 0xff, (widthMinusOne >> 16) & 0xff], 24);
  bytes.set([heightMinusOne & 0xff, (heightMinusOne >> 8) & 0xff, (heightMinusOne >> 16) & 0xff], 27);
  return bytes;
}

describe("floor-plan image security", () => {
  it("accepts the packaged PNG by magic signature and bounded dimensions", () => {
    const source = readFileSync(samplePath);
    const validated = validateFloorPlanImageBytes(source);

    expect(validated).toMatchObject({
      format: "png",
      mimeType: "image/png",
      width: 1020,
      height: 1080,
      byteLength: source.byteLength,
      pixelCount: 1020 * 1080,
    });
    expect(validated.bytes).not.toBe(source);
    expect(validated.bytes).toEqual(new Uint8Array(source));
  });

  it.each([
    ["jpeg", jpeg(640, 480), "image/jpeg"],
    ["webp", webp(800, 600), "image/webp"],
  ] as const)("accepts bounded %s signatures without trusting extensions", (format, bytes, mimeType) => {
    expect(validateFloorPlanImageBytes(bytes)).toMatchObject({
      format,
      mimeType,
      width: format === "jpeg" ? 640 : 800,
      height: format === "jpeg" ? 480 : 600,
    });
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

  it("zero-fills the prior owned image before replacing it", () => {
    const store = new FloorPlanImageStore();
    store.load(readFileSync(samplePath), "sample", "first");
    const first = store.borrowBytes();

    store.load(readFileSync(samplePath), "picker", "second");

    expect(first.every((value) => value === 0)).toBe(true);
    expect(store.preview?.displayName).toBe("second");
  });

  it("separates sanitized preview and inference ownership and zero-fills preparation buffers", () => {
    const previewBytes = new Uint8Array(readFileSync(samplePath));
    const inferenceBytes = oversizedPng(512, 400);
    const store = new FloorPlanImageStore({
      prepare: () => ({ previewBytes, inferenceBytes }),
    });

    const preview = store.load(readFileSync(samplePath), "sample", "prepared");
    const ownedInference = store.borrowBytes();

    expect(preview).toMatchObject({
      sourceFormat: "png",
      inferenceFormat: "png",
      inferenceWidth: 512,
      inferenceHeight: 400,
    });
    expect(previewBytes.every((value) => value === 0)).toBe(true);
    expect(inferenceBytes.every((value) => value === 0)).toBe(true);
    expect(ownedInference.some((value) => value !== 0)).toBe(true);

    store.clear();
    expect(ownedInference.every((value) => value === 0)).toBe(true);
  });
});
