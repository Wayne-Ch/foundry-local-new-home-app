import {
  CLEARANCE_RULE_SET_ID,
  CLEARANCE_RULE_SET_VERSION,
  clearanceRuleSet,
  FURNITURE_CATALOG_VERSION,
  furnitureCatalog,
  GEOMETRY_ENGINE_VERSION,
  getKnownLayoutOptions,
  ROOM_PLAN_ID,
  ROOM_PLAN_VERSION,
  roomPlan,
} from "./fixture";
import { evaluateLayoutOption } from "./geometry";
import { type CompareLayoutOptionsInput, expandCandidateFurnitureIds } from "./tool-contract";
import type { CheckedRoomState, DemoStateSnapshot, LayoutConflict, LayoutToolResult } from "./types";

function aggregateCheckedStates(
  selected: LayoutToolResult["feasibleOptions"][number] | undefined,
  rejected: LayoutToolResult["rejectedOptions"],
): readonly CheckedRoomState[] {
  if (selected !== undefined) {
    return selected.checkedStates;
  }
  if (rejected.length === 0) {
    return [];
  }

  return rejected[0]?.checkedStates ?? [];
}

function uniqueConflicts(conflicts: readonly LayoutConflict[]): readonly LayoutConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = [
      conflict.code,
      conflict.ruleId,
      conflict.objectIds.join(","),
      conflict.zoneId ?? "",
      conflict.actualDistanceMm ?? "",
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function compareKnownLayoutOptions(
  input: CompareLayoutOptionsInput,
  state: DemoStateSnapshot,
): LayoutToolResult {
  const provenance = {
    roomPlanId: ROOM_PLAN_ID,
    planVersion: ROOM_PLAN_VERSION,
    clearanceRuleSetId: CLEARANCE_RULE_SET_ID,
    clearanceRuleSetVersion: CLEARANCE_RULE_SET_VERSION,
    furnitureCatalogVersion: FURNITURE_CATALOG_VERSION,
    geometryEngineVersion: GEOMETRY_ENGINE_VERSION,
    unit: "mm" as const,
    evaluatedLayoutIds: [] as string[],
  };

  if (input.clarificationNeeded) {
    return {
      tool: "compare_layout_options",
      status: "clarification_required",
      stateRef: state.stateRef,
      changedPreference: input.changedPreference,
      selectedOptionId: null,
      feasibleOptions: [],
      rejectedOptions: [],
      conflicts: [],
      checkedStates: [],
      unknowns: input.unknowns,
      noResultReason: null,
      summary: "Geometry was not run because verified inputs are missing.",
      provenance,
    };
  }

  const options = getKnownLayoutOptions(expandCandidateFurnitureIds(input.candidateFurnitureIds));
  const evaluated = options.map((option) =>
    evaluateLayoutOption(option, roomPlan, furnitureCatalog, clearanceRuleSet),
  );
  provenance.evaluatedLayoutIds.push(...evaluated.map((option) => option.id));

  const feasibleOptions = evaluated.filter((option) => option.status === "feasible");
  const rejectedOptions = evaluated.filter((option) => option.status === "rejected");
  const selected = feasibleOptions[0];
  const conflicts = uniqueConflicts(rejectedOptions.flatMap((option) => option.conflicts));

  if (selected !== undefined) {
    return {
      tool: "compare_layout_options",
      status: "feasible",
      stateRef: state.stateRef,
      changedPreference: input.changedPreference,
      selectedOptionId: selected.id,
      feasibleOptions,
      rejectedOptions,
      conflicts,
      checkedStates: aggregateCheckedStates(selected, rejectedOptions),
      unknowns: [],
      noResultReason: null,
      summary: `${selected.label} passes all ${selected.checkedStates.length} deterministic checks.`,
      provenance,
    };
  }

  const hasKnownOptions = evaluated.length > 0;
  return {
    tool: "compare_layout_options",
    status: "no_feasible_option",
    stateRef: state.stateRef,
    changedPreference: input.changedPreference,
    selectedOptionId: null,
    feasibleOptions: [],
    rejectedOptions,
    conflicts,
    checkedStates: aggregateCheckedStates(undefined, rejectedOptions),
    unknowns: [],
    noResultReason: {
      code: hasKnownOptions ? "NO_KNOWN_FEASIBLE_OPTION" : "NO_KNOWN_OPTION_SET",
      message: hasKnownOptions
        ? `None of the ${evaluated.length} bounded known options passes the locked constraints.`
        : "The application has no verified known option set for that exact furniture combination.",
      preferencesThatMayChange: ["bed size", "desk footprint or orientation", "crib requirement"],
    },
    summary: hasKnownOptions
      ? "No bounded known option is feasible; the prior accepted layout remains active."
      : "No geometry was fabricated for an unknown furniture combination.",
    provenance,
  };
}
