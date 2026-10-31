import { lockedConstraints } from "./fixture";
import { type DemoState, type LayoutToolResult, roomStateIds } from "./types";

export function createInitialDemoState(): DemoState {
  return {
    stateRef: "layout-state-v0",
    version: 0,
    currentLayoutId: null,
    currentLayoutSource: null,
    activeFurnitureIds: [],
    lockedConstraints,
    requiredRoomStates: roomStateIds,
    lastChangedPreference: null,
    lastResultStatus: null,
    lastToolResult: null,
  };
}

export function applyToolResult(state: DemoState, result: LayoutToolResult): DemoState {
  const selected = result.feasibleOptions.find((option) => option.id === result.selectedOptionId);
  const activeFurnitureIds =
    selected === undefined
      ? state.activeFurnitureIds
      : selected.placements.map((placement) => placement.furnitureId);
  const version = state.version + 1;

  return {
    ...state,
    version,
    stateRef: `layout-state-v${version}`,
    currentLayoutId: selected?.id ?? state.currentLayoutId,
    currentLayoutSource: selected?.placementSource ?? state.currentLayoutSource,
    activeFurnitureIds: [...new Set(activeFurnitureIds)],
    lastChangedPreference: result.changedPreference,
    lastResultStatus: result.status,
    lastToolResult: result,
  };
}
