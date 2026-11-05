import {
  FLOOR_PLAN_VISION_EXECUTION_PROVIDER,
  FLOOR_PLAN_VISION_MODEL_ID,
} from "../domain/floor-plan-import";
import type { FloorPlanVisionReadiness, RuntimeReadiness } from "../domain/types";
import { VALIDATED_EXECUTION_PROVIDER, VALIDATED_MODEL_ID } from "./runtime-config";

export const OFFLINE_CORE_READY_TEXT = "Offline ready · 2/2 local models";

export interface CoreModelReadiness {
  readonly layoutReady: boolean;
  readonly floorPlanVisionReady: boolean;
  readonly readyCount: number;
  readonly totalCount: 2;
  readonly allReady: boolean;
}

export function deriveCoreModelReadiness(
  layout: RuntimeReadiness,
  vision: FloorPlanVisionReadiness,
): CoreModelReadiness {
  const layoutReady =
    layout.target.stageValidated &&
    layout.target.modelId === VALIDATED_MODEL_ID &&
    layout.target.executionProvider === VALIDATED_EXECUTION_PROVIDER &&
    layout.model?.id === VALIDATED_MODEL_ID &&
    layout.model.executionProvider === VALIDATED_EXECUTION_PROVIDER &&
    layout.modelCached &&
    layout.executionProviderRegistered &&
    layout.localInferenceReady &&
    layout.status === "ready" &&
    !layout.externalEndpointUsed;
  const floorPlanVisionReady =
    vision.target.modelId === FLOOR_PLAN_VISION_MODEL_ID &&
    vision.target.executionProvider === FLOOR_PLAN_VISION_EXECUTION_PROVIDER &&
    vision.model?.id === FLOOR_PLAN_VISION_MODEL_ID &&
    vision.model.executionProvider === FLOOR_PLAN_VISION_EXECUTION_PROVIDER &&
    vision.modelCached &&
    vision.localInferenceReady &&
    vision.status === "ready" &&
    !vision.externalEndpointUsed;
  const readyCount = Number(layoutReady) + Number(floorPlanVisionReady);

  return {
    layoutReady,
    floorPlanVisionReady,
    readyCount,
    totalCount: 2,
    allReady: readyCount === 2,
  };
}
