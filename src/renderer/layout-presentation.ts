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
    | "accepted_after_rejection"
    | "retained_accepted"
    | "no_preview"
    | "clarification";
  readonly activeView: LayoutEvidenceView | null;
  readonly canShowAcceptedLayout: boolean;
  readonly canShowRejectedOption: boolean;
  readonly displayLayout: EvaluatedLayoutOption | null;
  readonly evidenceLayout: EvaluatedLayoutOption | null;
  readonly roomConflicts: readonly LayoutConflict[];
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

export type LayoutEvidenceView = "accepted" | "rejected";

export function defaultLayoutEvidenceView(result: LayoutToolResult | null): LayoutEvidenceView {
  if (
    result?.status === "no_feasible_option" &&
    result.evidenceOptionId !== null &&
    result.rejectedOptions.some((option) => option.id === result.evidenceOptionId)
  ) {
    return "rejected";
  }
  return "accepted";
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
  requestedView: LayoutEvidenceView = defaultLayoutEvidenceView(result),
): LayoutPresentation {
  if (result === null) {
    return {
      mode: "waiting",
      activeView: selectedLayout === null ? null : "accepted",
      canShowAcceptedLayout: false,
      canShowRejectedOption: false,
      displayLayout: selectedLayout,
      evidenceLayout: selectedLayout,
      roomConflicts: selectedLayout?.conflicts ?? [],
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
      activeView: "accepted",
      canShowAcceptedLayout: false,
      canShowRejectedOption: false,
      displayLayout: option,
      evidenceLayout: option,
      roomConflicts: option?.conflicts ?? result.conflicts,
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
      activeView: selectedLayout === null ? null : "accepted",
      canShowAcceptedLayout: false,
      canShowRejectedOption: false,
      displayLayout: selectedLayout,
      evidenceLayout: null,
      roomConflicts: selectedLayout?.conflicts ?? [],
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
    if (selectedLayout !== null && requestedView === "accepted") {
      return {
        mode: "accepted_after_rejection",
        activeView: "accepted",
        canShowAcceptedLayout: true,
        canShowRejectedOption: true,
        displayLayout: selectedLayout,
        evidenceLayout: rejectedOption,
        roomConflicts: selectedLayout.conflicts,
        resultBadgeClass: "result-badge is-warning",
        resultBadgeText: "Request rejected · accepted preserved",
        layoutTitle: `${selectedLayout.label} · accepted layout preserved`,
        layoutNotice:
          'Showing the preserved accepted layout. The rejected request did not replace it; exact rejected-option checks, measurements, and conflicts remain visible at right. Select "Inspect rejected option" to return to its visual preview without rerunning inference.',
        verdictTitle: "Requested option rejected",
        checksLabel: "Rejected option checks",
        conflictsLabel: "Rejected option conflicts",
        checks: rejectedOption.checkedStates,
        conflicts: rejectedOption.conflicts,
      };
    }
    const acceptedLayoutNote =
      selectedLayout === null
        ? " No layout has been accepted."
        : ` Accepted layout preserved: ${selectedLayout.label} (${selectedLayout.id}); select "Show accepted layout" to display it.`;
    return {
      mode: "rejected_option",
      activeView: "rejected",
      canShowAcceptedLayout: selectedLayout !== null,
      canShowRejectedOption: selectedLayout !== null,
      displayLayout: rejectedOption,
      evidenceLayout: rejectedOption,
      roomConflicts: rejectedOption.conflicts,
      resultBadgeClass: "result-badge is-error",
      resultBadgeText: "Rejected preview · not accepted",
      layoutTitle: `Rejected preview · ${rejectedOption.label}`,
      layoutNotice: `This rejected preview, its checks, measurements, and conflicts all belong to the same exact rejected option and are not accepted.${aggregateNote}${acceptedLayoutNote}`,
      verdictTitle: "Deterministic conflict",
      checksLabel: "Rejected preview checks",
      conflictsLabel: "Rejected preview conflicts",
      checks: rejectedOption.checkedStates,
      conflicts: rejectedOption.conflicts,
    };
  }

  if (selectedLayout !== null) {
    return {
      mode: "retained_accepted",
      activeView: "accepted",
      canShowAcceptedLayout: false,
      canShowRejectedOption: false,
      displayLayout: selectedLayout,
      evidenceLayout: null,
      roomConflicts: selectedLayout.conflicts,
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
    activeView: null,
    canShowAcceptedLayout: false,
    canShowRejectedOption: false,
    displayLayout: null,
    evidenceLayout: null,
    roomConflicts: [],
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
