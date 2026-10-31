import { describe, expect, it } from "vitest";
import { clearanceRuleSet, furnitureCatalog, knownLayoutOptions, roomPlan } from "../src/domain/fixture";
import {
  evaluateLayoutOption,
  rectangleDistanceMm,
  rectangleIntersectsDoorSwing,
  rectanglesOverlap,
} from "../src/domain/geometry";

function option(id: string) {
  const found = knownLayoutOptions.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`Missing test option ${id}`);
  }
  return found;
}

describe("deterministic geometry fixtures", () => {
  it("accepts Queen plus standard desk", () => {
    const result = evaluateLayoutOption(
      option("queen-desk-standard-v1"),
      roomPlan,
      furnitureCatalog,
      clearanceRuleSet,
    );
    expect(result.status).toBe("feasible");
    expect(result.conflicts).toEqual([]);
    expect(result.checkedStates.every((check) => check.passed)).toBe(true);
  });

  it("rejects King plus standard desk with exactly the closet conflict", () => {
    const result = evaluateLayoutOption(
      option("king-desk-standard-v1"),
      roomPlan,
      furnitureCatalog,
      clearanceRuleSet,
    );
    expect(result.status).toBe("rejected");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      code: "RESERVED_ZONE_OVERLAP",
      zoneId: "closet-access-zone",
      objectIds: ["desk-main"],
    });
  });

  it("accepts Queen plus crib plus revised compact desk", () => {
    const result = evaluateLayoutOption(
      option("queen-crib-compact-v1"),
      roomPlan,
      furnitureCatalog,
      clearanceRuleSet,
    );
    expect(result.status).toBe("feasible");
    expect(result.placements.map((placement) => placement.furnitureId)).toEqual([
      "bed-queen",
      "desk-compact",
      "crib-standard",
    ]);
  });

  it("rejects every bounded King plus desk plus crib option", () => {
    const results = [option("king-crib-compact-east-v1"), option("king-crib-compact-south-v1")].map(
      (layout) => evaluateLayoutOption(layout, roomPlan, furnitureCatalog, clearanceRuleSet),
    );
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(
      results
        .flatMap((result) => result.conflicts)
        .some((conflict) => conflict.code === "DOOR_SWING_OVERLAP"),
    ).toBe(true);
    expect(
      results
        .flatMap((result) => result.conflicts)
        .some((conflict) => conflict.code === "FURNITURE_CLEARANCE"),
    ).toBe(true);
  });

  it("reports exact accepted and rejected furniture clearance measurements", () => {
    const accepted = evaluateLayoutOption(
      option("queen-crib-compact-v1"),
      roomPlan,
      furnitureCatalog,
      clearanceRuleSet,
    );
    expect(accepted.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: ["Queen bed", "Compact desk"],
          actualDistanceMm: 476,
          requiredDistanceMm: 250,
          passed: true,
        }),
        expect.objectContaining({
          labels: ["Queen bed", "Baby bed"],
          actualDistanceMm: 576,
          requiredDistanceMm: 250,
          passed: true,
        }),
      ]),
    );

    const rejected = evaluateLayoutOption(
      option("king-crib-compact-east-v1"),
      roomPlan,
      furnitureCatalog,
      clearanceRuleSet,
    );
    expect(rejected.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: ["King bed", "Compact desk"],
          actualDistanceMm: 70,
          requiredDistanceMm: 250,
          passed: false,
        }),
        expect.objectContaining({
          labels: ["King bed", "Baby bed"],
          actualDistanceMm: 170,
          requiredDistanceMm: 250,
          passed: false,
        }),
      ]),
    );
  });
});

describe("geometry boundaries", () => {
  it("treats touching reserved rectangles as clear and one millimetre overlap as blocked", () => {
    const closet = roomPlan.reservedZones.find((zone) => zone.id === "closet-access-zone");
    if (closet === undefined) {
      throw new Error("Missing closet zone");
    }
    expect(rectanglesOverlap({ xMm: 3000, yMm: 500, widthMm: 200, depthMm: 400 }, closet.rect)).toBe(false);
    expect(rectanglesOverlap({ xMm: 3001, yMm: 500, widthMm: 200, depthMm: 400 }, closet.rect)).toBe(true);
  });

  it("treats the exact door-swing radius as blocked", () => {
    expect(rectangleIntersectsDoorSwing({ xMm: 900, yMm: 3500, widthMm: 80, depthMm: 100 }, roomPlan)).toBe(
      true,
    );
    expect(rectangleIntersectsDoorSwing({ xMm: 901, yMm: 3500, widthMm: 80, depthMm: 100 }, roomPlan)).toBe(
      false,
    );
  });

  it("accepts exactly 250 mm furniture clearance and rejects 249 mm", () => {
    const left = { xMm: 0, yMm: 0, widthMm: 100, depthMm: 100 };
    expect(rectangleDistanceMm(left, { xMm: 350, yMm: 0, widthMm: 100, depthMm: 100 })).toBe(250);
    expect(rectangleDistanceMm(left, { xMm: 349, yMm: 0, widthMm: 100, depthMm: 100 })).toBe(249);
  });
});
