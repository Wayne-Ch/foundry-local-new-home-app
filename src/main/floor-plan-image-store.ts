import {
  type FloorPlanImageFormat,
  validateFloorPlanImageBytes,
  zeroFill,
} from "../layout-import/image-security";
import type { FloorPlanImageDescriptor } from "../shared/contracts";

export class FloorPlanImageStore {
  #bytes: Uint8Array | null = null;
  #preview: FloorPlanImageDescriptor | null = null;
  readonly #onZeroFill: ((bytes: Uint8Array) => void) | undefined;

  constructor(options: { readonly onZeroFill?: (bytes: Uint8Array) => void } = {}) {
    this.#onZeroFill = options.onZeroFill;
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
    const validated = validateFloorPlanImageBytes(input);
    this.clear();
    this.#bytes = validated.bytes;
    this.#preview = {
      format: validated.format,
      mimeType: validated.mimeType,
      width: validated.width,
      height: validated.height,
      byteLength: validated.byteLength,
      pixelCount: validated.pixelCount,
      source,
      displayName,
      dataUrl: `data:${validated.mimeType};base64,${Buffer.from(validated.bytes).toString("base64")}`,
    };
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
