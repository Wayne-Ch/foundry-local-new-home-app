import {
  type FloorPlanImageFormat,
  validateFloorPlanImageBytes,
  zeroFill,
} from "../layout-import/image-security";
import type { FloorPlanImageDescriptor } from "../shared/contracts";

export interface PreparedFloorPlanImage {
  readonly previewBytes: Uint8Array;
  readonly inferenceBytes: Uint8Array;
}

export class FloorPlanImageStore {
  #bytes: Uint8Array | null = null;
  #preview: FloorPlanImageDescriptor | null = null;
  readonly #onZeroFill: ((bytes: Uint8Array) => void) | undefined;
  readonly #prepare:
    | ((image: ReturnType<typeof validateFloorPlanImageBytes>) => PreparedFloorPlanImage)
    | undefined;

  constructor(
    options: {
      readonly onZeroFill?: (bytes: Uint8Array) => void;
      readonly prepare?: (image: ReturnType<typeof validateFloorPlanImageBytes>) => PreparedFloorPlanImage;
    } = {},
  ) {
    this.#onZeroFill = options.onZeroFill;
    this.#prepare = options.prepare;
  }

  get preview(): FloorPlanImageDescriptor | null {
    return this.#preview;
  }

  get format(): FloorPlanImageFormat {
    if (this.#preview === null) {
      throw new Error("No floor-plan image is loaded.");
    }
    return this.#preview.format;
  }

  load(
    input: Uint8Array,
    source: FloorPlanImageDescriptor["source"],
    displayName: string,
  ): FloorPlanImageDescriptor {
    const sourceImage = validateFloorPlanImageBytes(input);
    let previewImage = sourceImage;
    let inferenceImage = sourceImage;
    if (this.#prepare !== undefined) {
      let prepared: PreparedFloorPlanImage;
      try {
        prepared = this.#prepare(sourceImage);
      } finally {
        zeroFill(sourceImage.bytes);
      }
      try {
        previewImage = validateFloorPlanImageBytes(prepared.previewBytes);
        inferenceImage = validateFloorPlanImageBytes(prepared.inferenceBytes);
      } catch (error) {
        if (previewImage !== sourceImage) {
          zeroFill(previewImage.bytes);
        }
        throw error;
      } finally {
        zeroFill(prepared.previewBytes);
        zeroFill(prepared.inferenceBytes);
      }
    }

    this.clear();
    this.#bytes = inferenceImage.bytes;
    this.#preview = {
      format: previewImage.format,
      mimeType: previewImage.mimeType,
      width: previewImage.width,
      height: previewImage.height,
      byteLength: previewImage.byteLength,
      pixelCount: previewImage.pixelCount,
      source,
      displayName,
      dataUrl: `data:${previewImage.mimeType};base64,${Buffer.from(previewImage.bytes).toString("base64")}`,
      sourceFormat: sourceImage.format,
      sourceByteLength: sourceImage.byteLength,
      inferenceFormat: inferenceImage.format,
      inferenceWidth: inferenceImage.width,
      inferenceHeight: inferenceImage.height,
      inferenceByteLength: inferenceImage.byteLength,
    };
    if (previewImage !== inferenceImage) {
      zeroFill(previewImage.bytes);
    }
    return this.#preview;
  }

  borrowBytes(): Uint8Array {
    if (this.#bytes === null) {
      throw new Error("No floor-plan image is loaded.");
    }
    return this.#bytes;
  }

  releaseBytesRetainingPreview(): void {
    this.#releaseBytes();
  }

  clear(): void {
    this.#releaseBytes();
    this.#preview = null;
  }

  #releaseBytes(): void {
    if (this.#bytes === null) {
      return;
    }
    zeroFill(this.#bytes);
    this.#onZeroFill?.(this.#bytes);
    this.#bytes = null;
  }
}
