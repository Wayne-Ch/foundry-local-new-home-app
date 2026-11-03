import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFloorPlanRecognition } from "../src/domain/floor-plan-import";
import {
  validateFloorPlanImageBytes,
  validateSupportedFloorPlanFixtureBytes,
} from "../src/layout-import/image-security";

interface ValidatorPayload {
  readonly case: string;
  readonly image: {
    readonly path: string;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
  };
  readonly runs: readonly {
    readonly finishReason: string;
    readonly rawOutput: string;
  }[];
}

function readPayload(name: string): ValidatorPayload {
  const fixturePath = new URL(`./fixtures/floor-plan/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fixturePath, "utf8")) as ValidatorPayload;
}

const cases = [
  { payload: readPayload("validator-positive.json"), accepted: true },
  { payload: readPayload("validator-white-control.json"), accepted: false },
  { payload: readPayload("validator-rectangle-only-control.json"), accepted: false },
] as const;

describe("authoritative floor-plan validator regressions", () => {
  it.each(cases)(
    "replays the exact $payload.case payload without forcing schema alternatives",
    ({ payload, accepted }) => {
      expect(payload.runs).toHaveLength(3);
      expect(new Set(payload.runs.map((run) => run.rawOutput)).size).toBe(1);
      for (const run of payload.runs) {
        expect(run.finishReason).toBe("stop");
        const parsed = parseFloorPlanRecognition(run.rawOutput);
        expect(parsed.ok).toBe(accepted);
        if (!accepted && !parsed.ok) {
          expect(parsed.error.code).toBe("CONTENT_MISMATCH");
        }
      }
    },
  );

  it.each(cases)("pins the exact $payload.case image bytes and dimensions", ({ payload }) => {
    const bytes = readFileSync(path.resolve(payload.image.path));
    const validated = validateFloorPlanImageBytes(bytes);

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(payload.image.sha256);
    expect(validated).toMatchObject({
      format: "png",
      width: payload.image.width,
      height: payload.image.height,
    });
  });

  it("allows canonical geometry only for the exact positive fixture bytes", () => {
    const positive = readFileSync(path.resolve(cases[0].payload.image.path));
    const white = readFileSync(path.resolve(cases[1].payload.image.path));
    const rectangleOnly = readFileSync(path.resolve(cases[2].payload.image.path));

    expect(validateSupportedFloorPlanFixtureBytes(positive)).toMatchObject({
      format: "png",
      width: 1020,
      height: 1080,
    });
    expect(() => validateSupportedFloorPlanFixtureBytes(white)).toThrow("exact private NARA demo fixture");
    expect(() => validateSupportedFloorPlanFixtureBytes(rectangleOnly)).toThrow(
      "exact private NARA demo fixture",
    );
  });
});
