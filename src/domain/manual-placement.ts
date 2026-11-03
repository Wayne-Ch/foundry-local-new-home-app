import { clearanceRuleSet, defaultPlanningFixture, furnitureCatalog } from "./fixture";
import { evaluateLayoutOption } from "./geometry";
import type {
  DemoState,
  EvaluatedLayoutOption,
  FurniturePlacement,
  LayoutOption,
  PlanningFixture,
} from "./types";

export const MANUAL_PLACEMENT_GRID_MM = 50;

export interface ManualPlacementRequest {
  readonly priorStateRef: string;
  readonly sourceLayoutId: string;
  readonly instanceId: string;
  readonly xMm: number;
  readonly yMm: number;
}

export type ManualPlacementRejectionCode =
  | "NO_ACCEPTED_LAYOUT"
  | "STALE_STATE"
  | "LAYOUT_MISMATCH"
  | "UNKNOWN_PLACEMENT"
  | "INVALID_COORDINATES"
  | "INVALID_PLACEMENT";

export interface ManualPlacementOutcome {
  readonly accepted: boolean;
  readonly rejectionCode: ManualPlacementRejectionCode | null;
  readonly reason: string;
  readonly request: ManualPlacementRequest;
  readonly preview: EvaluatedLayoutOption | null;
  readonly state: DemoState;
  readonly selectedLayout: EvaluatedLayoutOption | null;
}

function rejected(
  request: ManualPlacementRequest,
  state: DemoState,
  selectedLayout: EvaluatedLayoutOption | null,
  rejectionCode: ManualPlacementRejectionCode,
  reason: string,
  preview: EvaluatedLayoutOption | null = null,
): ManualPlacementOutcome {
  return {
    accepted: false,
    rejectionCode,
    reason,
    request,
    preview,
    state,
    selectedLayout,
  };
}

function manualLayoutOption(
  state: DemoState,
  selectedLayout: EvaluatedLayoutOption,
  request: ManualPlacementRequest,
): LayoutOption {
  const version = state.version + 1;
  const baseLabel = selectedLayout.label.replace(/\s+·\s+manual adjustment v\d+$/i, "");
  const placements: FurniturePlacement[] = selectedLayout.placements.map((placement) => ({
    instanceId: placement.instanceId,
    furnitureId: placement.furnitureId,
    xMm: placement.instanceId === request.instanceId ? request.xMm : placement.xMm,
    yMm: placement.instanceId === request.instanceId ? request.yMm : placement.yMm,
    orientation: placement.orientation,
  }));
  return {
    id: `manual-layout-v${version}`,
    label: `${baseLabel} · manual adjustment v${version}`,
    furnitureIds: placements.map((placement) => placement.furnitureId),
    placements,
    rationale: "Application-owned manual placement revalidated against every locked deterministic check.",
  };
}

function coordinatesAreValid(request: ManualPlacementRequest): boolean {
  return (
    Number.isFinite(request.xMm) &&
    Number.isFinite(request.yMm) &&
    Number.isInteger(request.xMm) &&
    Number.isInteger(request.yMm) &&
    request.xMm % MANUAL_PLACEMENT_GRID_MM === 0 &&
    request.yMm % MANUAL_PLACEMENT_GRID_MM === 0
  );
}

export function evaluateManualPlacement(
  state: DemoState,
  selectedLayout: EvaluatedLayoutOption | null,
  request: ManualPlacementRequest,
  planningFixture: PlanningFixture = defaultPlanningFixture,
): ManualPlacementOutcome {
  if (selectedLayout === null) {
    return rejected(
      request,
      state,
      selectedLayout,
      "NO_ACCEPTED_LAYOUT",
      "No accepted layout is available for manual adjustment.",
    );
  }
  if (request.priorStateRef !== state.stateRef) {
    return rejected(
      request,
      state,
      selectedLayout,
      "STALE_STATE",
      `The accepted layout changed from ${request.priorStateRef} to ${state.stateRef}. Revert and try again.`,
    );
  }
  if (request.sourceLayoutId !== selectedLayout.id || state.currentLayoutId !== selectedLayout.id) {
    return rejected(
      request,
      state,
      selectedLayout,
      "LAYOUT_MISMATCH",
      "The manual adjustment does not target the current accepted layout.",
    );
  }
  if (!selectedLayout.placements.some((placement) => placement.instanceId === request.instanceId)) {
    return rejected(
      request,
      state,
      selectedLayout,
      "UNKNOWN_PLACEMENT",
      `The accepted layout does not contain placement ${request.instanceId}.`,
    );
  }
  if (!coordinatesAreValid(request)) {
    return rejected(
      request,
      state,
      selectedLayout,
      "INVALID_COORDINATES",
      `Manual placement coordinates must use the ${MANUAL_PLACEMENT_GRID_MM} mm grid.`,
    );
  }

  const preview = evaluateLayoutOption(
    manualLayoutOption(state, selectedLayout, request),
    planningFixture.roomPlan,
    furnitureCatalog,
    clearanceRuleSet,
    "manual-adjustment",
  );
  if (preview.status === "rejected") {
    return rejected(
      request,
      state,
      selectedLayout,
      "INVALID_PLACEMENT",
      preview.conflicts.map((conflict) => conflict.message).join(" "),
      preview,
    );
  }

  const version = state.version + 1;
  const moved = preview.placements.find((placement) => placement.instanceId === request.instanceId);
  const nextState: DemoState = {
    ...state,
    version,
    stateRef: `layout-state-v${version}`,
    currentLayoutId: preview.id,
    currentLayoutSource: "manual-adjustment",
    activeFurnitureIds: [...new Set(preview.placements.map((placement) => placement.furnitureId))],
    lastChangedPreference: `Manual placement: ${moved?.label ?? request.instanceId} moved to (${request.xMm}, ${request.yMm}) mm.`,
    lastResultStatus: "feasible",
  };
  return {
    accepted: true,
    rejectionCode: null,
    reason: `${moved?.label ?? "Furniture"} placement passes all locked deterministic checks.`,
    request,
    preview,
    state: nextState,
    selectedLayout: preview,
  };
}
