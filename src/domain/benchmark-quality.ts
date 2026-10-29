import type { LayoutIntentDelta } from "./tool-contract";
import type { FurnitureId, LayoutToolStatus } from "./types";

export interface ExpectedLayoutIntent {
  readonly bed: readonly LayoutIntentDelta["bed"][];
  readonly desk: readonly LayoutIntentDelta["desk"][];
  readonly crib: readonly LayoutIntentDelta["crib"][];
  readonly clarification: readonly LayoutIntentDelta["clarification"][];
}

export interface ScenarioQualityInput {
  readonly actualIntent: LayoutIntentDelta;
  readonly expectedIntent: ExpectedLayoutIntent;
  readonly actualFurniture: readonly FurnitureId[];
  readonly expectedFurniture: readonly FurnitureId[];
  readonly actualStatus: LayoutToolStatus;
  readonly expectedStatus: LayoutToolStatus;
  readonly actualSelectedOptionId: string | null;
  readonly expectedSelectedOptionId: string | null | undefined;
}

export interface ScenarioQualityResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function sameSet(actual: readonly FurnitureId[], expected: readonly FurnitureId[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

export function evaluateScenarioQuality(input: ScenarioQualityInput): ScenarioQualityResult {
  const failures: string[] = [];
  for (const key of ["bed", "desk", "crib", "clarification"] as const) {
    const expected = input.expectedIntent[key];
    const actual = input.actualIntent[key];
    if (!expected.some((value) => value === actual)) {
      failures.push(`intent.${key}=${actual}; expected ${expected.join(" or ")}`);
    }
  }
  if (!sameSet(input.actualFurniture, input.expectedFurniture)) {
    failures.push(`furniture=${input.actualFurniture.join(",")}`);
  }
  if (input.actualStatus !== input.expectedStatus) {
    failures.push(`status=${input.actualStatus}`);
  }
  if (
    input.expectedSelectedOptionId !== undefined &&
    input.actualSelectedOptionId !== input.expectedSelectedOptionId
  ) {
    failures.push(`selected=${input.actualSelectedOptionId}`);
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

export interface BenchmarkCandidateGateRecord {
  readonly id?: unknown;
  readonly exactId?: unknown;
  readonly passed?: unknown;
}

export interface BenchmarkSelectionGateRecord {
  readonly id?: unknown;
}

function candidateId(candidate: BenchmarkCandidateGateRecord): string | null {
  if (typeof candidate.exactId === "string" && candidate.exactId.length > 0) {
    return candidate.exactId;
  }
  return typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : null;
}

export function benchmarkGateFailures(
  candidates: readonly BenchmarkCandidateGateRecord[],
  requiredModelIds: readonly string[],
  selected: BenchmarkSelectionGateRecord | null,
): string[] {
  const failures: string[] = [];
  for (const requiredId of requiredModelIds) {
    const candidate = candidates.find((entry) => candidateId(entry) === requiredId);
    if (candidate === undefined) {
      failures.push(`Required candidate ${requiredId} is missing.`);
    } else if (candidate.passed !== true) {
      failures.push(`Required candidate ${requiredId} failed one or more quality scenarios.`);
    }
  }
  if (selected === null || typeof selected.id !== "string" || selected.id.length === 0) {
    failures.push("No passing model was selected.");
    return failures;
  }
  const selectedCandidate = candidates.find((entry) => candidateId(entry) === selected.id);
  if (selectedCandidate === undefined || selectedCandidate.passed !== true) {
    failures.push(`Selected model ${selected.id} does not have a passing candidate result.`);
  }
  return failures;
}
