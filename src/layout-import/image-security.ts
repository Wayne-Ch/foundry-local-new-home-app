import { createHash } from "node:crypto";

export const FLOOR_PLAN_MAX_BYTES = 4 * 1024 * 1024;
export const FLOOR_PLAN_MAX_DIMENSION = 2048;
export const FLOOR_PLAN_MAX_PIXELS = 4_000_000;
export const FLOOR_PLAN_INFERENCE_MAX_DIMENSION = 1280;
export const FLOOR_PLAN_FIXTURE_WIDTH = 1020;
export const FLOOR_PLAN_FIXTURE_HEIGHT = 1080;
export const FLOOR_PLAN_FIXTURE_BYTE_LENGTH = 194_686;
export const FLOOR_PLAN_FIXTURE_SHA256 = "02c90be495d1f64e8adb57c4d00eb81f09fbeb80e885a0066f692026d2145587";

export type FloorPlanImageFormat = "png" | "jpeg" | "webp";

export interface FloorPlanImageMetadata {
  readonly format: FloorPlanImageFormat;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly pixelCount: number;
}

export interface ValidatedFloorPlanImage extends FloorPlanImageMetadata {
  readonly bytes: Uint8Array;
}

function assertBounds(metadata: FloorPlanImageMetadata): void {
  if (
    metadata.width < 1 ||
    metadata.height < 1 ||
    metadata.width > FLOOR_PLAN_MAX_DIMENSION ||
    metadata.height > FLOOR_PLAN_MAX_DIMENSION ||
    metadata.pixelCount > FLOOR_PLAN_MAX_PIXELS
  ) {
    throw new Error(
      `Floor-plan image dimensions must be at most ${FLOOR_PLAN_MAX_DIMENSION} x ${FLOOR_PLAN_MAX_DIMENSION} and ${FLOOR_PLAN_MAX_PIXELS} pixels.`,
    );
  }
}

function readPng(bytes: Uint8Array): Omit<FloorPlanImageMetadata, "byteLength" | "pixelCount"> | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.length < 24 ||
    !signature.every((value, index) => bytes[index] === value) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    format: "png",
    mimeType: "image/png",
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

function readJpeg(bytes: Uint8Array): Omit<FloorPlanImageMetadata, "byteLength" | "pixelCount"> | null {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return null;
  }
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      break;
    }
    const length = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length) {
      break;
    }
    if (sofMarkers.has(marker) && length >= 7) {
      return {
        format: "jpeg",
        mimeType: "image/jpeg",
        height: (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0),
        width: (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0),
      };
    }
    offset += length;
  }
  throw new Error("JPEG floor-plan image does not contain a supported frame header.");
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readWebp(bytes: Uint8Array): Omit<FloorPlanImageMetadata, "byteLength" | "pixelCount"> | null {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP"
  ) {
    return null;
  }
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  let width = 0;
  let height = 0;
  if (chunk === "VP8X") {
    width = readUint24Le(bytes, 24) + 1;
    height = readUint24Le(bytes, 27) + 1;
  } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b1 = bytes[21] ?? 0;
    const b2 = bytes[22] ?? 0;
    const b3 = bytes[23] ?? 0;
    const b4 = bytes[24] ?? 0;
    width = 1 + b1 + ((b2 & 0x3f) << 8);
    height = 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
  } else if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    width = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff;
    height = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff;
  } else {
    throw new Error("WebP floor-plan image uses an unsupported container layout.");
  }
  return { format: "webp", mimeType: "image/webp", width, height };
}

export function validateFloorPlanImageBytes(input: Uint8Array): ValidatedFloorPlanImage {
  if (input.buffer instanceof SharedArrayBuffer) {
    throw new Error("SharedArrayBuffer-backed floor-plan images are not accepted.");
  }
  if (input.byteLength < 24 || input.byteLength > FLOOR_PLAN_MAX_BYTES) {
    throw new Error(`Floor-plan image must be between 24 bytes and ${FLOOR_PLAN_MAX_BYTES} bytes.`);
  }

  const detected = readPng(input) ?? readJpeg(input) ?? readWebp(input);
  if (detected === null) {
    throw new Error("Floor-plan image must be a PNG, JPEG, or WebP file with a valid magic signature.");
  }
  const metadata: FloorPlanImageMetadata = {
    ...detected,
    byteLength: input.byteLength,
    pixelCount: detected.width * detected.height,
  };
  assertBounds(metadata);
  return {
    ...metadata,
    bytes: new Uint8Array(input),
  };
}

export function validateSupportedFloorPlanFixtureBytes(input: Uint8Array): ValidatedFloorPlanImage {
  const validated = validateFloorPlanImageBytes(input);
  const sha256 = createHash("sha256").update(input).digest("hex");
  if (
    validated.format !== "png" ||
    validated.width !== FLOOR_PLAN_FIXTURE_WIDTH ||
    validated.height !== FLOOR_PLAN_FIXTURE_HEIGHT ||
    validated.byteLength !== FLOOR_PLAN_FIXTURE_BYTE_LENGTH ||
    sha256 !== FLOOR_PLAN_FIXTURE_SHA256
  ) {
    zeroFill(validated.bytes);
    throw new Error(
      `Only the exact private NARA demo fixture is supported: PNG ${FLOOR_PLAN_FIXTURE_WIDTH} x ${FLOOR_PLAN_FIXTURE_HEIGHT}, ${FLOOR_PLAN_FIXTURE_BYTE_LENGTH} bytes, SHA-256 ${FLOOR_PLAN_FIXTURE_SHA256}.`,
    );
  }
  return validated;
}

export function zeroFill(bytes: Uint8Array): void {
  bytes.fill(0);
}
