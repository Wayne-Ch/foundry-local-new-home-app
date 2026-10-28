import type {
  CheckedRoomState,
  EvaluatedLayoutOption,
  LayoutConflict,
  LayoutToolResult,
} from "../domain/types";

export interface LayoutPresentation {
  readonly mode:
    | "waiting"
    | "feasible"
    | "rejected_option"
    | "retained_accepted"
    | "no_preview"
    | "clarification";
  readonly displayLayout: EvaluatedLayoutOption | null;
  readonly resultBadgeClass: string;
  readonly resultBadgeText: string;
  readonly layoutTitle: string;
  readonly layoutNotice: string;
  readonly verdictTitle: string;
  readonly checksLabel: string;
  readonly conflictsLabel: string;
  readonly checks: readonly CheckedRoomState[];
  readonly conflicts: readonly LayoutConflict[];
}

function optionById(
  options: readonly EvaluatedLayoutOption[],
  optionId: string | null,
): EvaluatedLayoutOption | null {
  return options.find((option) => option.id === optionId) ?? null;
}

export function createLayoutPresentation(
  result: LayoutToolResult | null,
  selectedLayout: EvaluatedLayoutOption | null,
): LayoutPresentation {
  if (result === null) {
    return {
      mode: "waiting",
      displayLayout: selectedLayout,
      resultBadgeClass: "result-badge is-neutral",
      resultBadgeText: "Waiting for a request",
      layoutTitle: "Verified room plan",
      layoutNotice: "Verified dimensions only. Select the first scripted turn to begin.",
      verdictTitle: "No layout evaluated",
      checksLabel: "Locked checks",
      conflictsLabel: "Visible conflicts",
      checks: [],
      conflicts: [],
    };
  }

  if (result.status === "feasible") {
    const option =
      optionById(result.feasibleOptions, result.evidenceOptionId) ??
      optionById(result.feasibleOptions, result.selectedOptionId) ??
      selectedLayout;
    return {
      mode: "feasible",
      displayLayout: option,
      resultBadgeClass: "result-badge is-success",
      resultBadgeText: "Feasible known option",
      layoutTitle: option?.label ?? "Verified feasible layout",
      layoutNotice: "Rendered from deterministic tool output. Exact dimensions remain application-owned.",
      verdictTitle: "All locked checks pass",
      checksLabel: "Locked checks",
      conflictsLabel: "Visible conflicts",
      checks: result.checkedStates,
      conflicts: result.conflicts,
    };
  }

  if (result.status === "clarification_required") {
    return {
      mode: "clarification",
      displayLayout: selectedLayout,
      resultBadgeClass: "result-badge is-warning",
      resultBadgeText: "Verified input missing",
      layoutTitle: "Clarification required",
      layoutNotice: "Geometry did not run because verified facts are missing.",
      verdictTitle: "No geometry executed",
      checksLabel: "Locked checks",
      conflictsLabel: "Visible conflicts",
      checks: result.checkedStates,
      conflicts: result.conflicts,
    };
  }

  const rejectedOption = optionById(result.rejectedOptions, result.evidenceOptionId);
  if (rejectedOption !== null) {
    const aggregateNote =
      result.rejectedOptions.length > 1
        ? ` Aggregate reasons across ${result.rejectedOptions.length} rejected options are labeled separately in Developer trace.`
        : "";
    const acceptedLayoutNote =
      selectedLayout === null
        ? " No layout has been accepted."
        : " The prior accepted layout remains active.";
    return {
      mode: "rejected_option",
      displayLayout: rejectedOption,
      resultBadgeClass: "result-badge is-error",
      resultBadgeText: "No feasible known option",
      layoutTitle: `${rejectedOption.label} · rejected option preview`,
      layoutNotice: `The preview, checks, and conflicts below all belong to this exact rejected option.${aggregateNote}${acceptedLayoutNote}`,
      verdictTitle: "Deterministic conflict",
      checksLabel: "Preview option checks",
      conflictsLabel: "Preview option conflicts",
      checks: result.checkedStates,
      conflicts: result.conflicts,
    };
  }

  if (selectedLayout !== null) {
    return {
      mode: "retained_accepted",
      displayLayout: selectedLayout,
      resultBadgeClass: "result-badge is-error",
      resultBadgeText: "No known option set",
      layoutTitle: `${selectedLayout.label} · retained accepted layout`,
      layoutNotice:
        "No option was evaluated for the requested combination. This is the prior accepted layout, not a rejected preview.",
      verdictTitle: "No geometry available for request",
      checksLabel: "Retained layout checks",
      conflictsLabel: "Current request conflicts",
      checks: selectedLayout.checkedStates,
      conflicts: [],
    };
  }

  return {
    mode: "no_preview",
    displayLayout: null,
    resultBadgeClass: "result-badge is-error",
    resultBadgeText: "No known option set",
    layoutTitle: "No rejected option preview",
    layoutNotice:
      "No option was evaluated for the requested combination, and there is no prior accepted layout to retain.",
    verdictTitle: "No geometry available for request",
    checksLabel: "Locked checks",
    conflictsLabel: "Current request conflicts",
    checks: [],
    conflicts: [],
  };
}
