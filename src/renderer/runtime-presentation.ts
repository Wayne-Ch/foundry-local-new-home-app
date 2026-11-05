import type { FloorPlanVisionReadiness, RuntimeReadiness } from "../domain/types";

export interface CoreModelStatusLine {
  readonly text: string;
  readonly state: "checking" | "cached" | "loading" | "ready" | "error";
  readonly title: string;
}

export function runtimeBadgeLabel(readiness: RuntimeReadiness): string {
  if (readiness.target.source === "invalid_environment_override") {
    return "Invalid environment override";
  }
  const identity = readiness.model
    ? `${readiness.model.alias} · ${readiness.model.deviceType} · ${readiness.model.executionProvider}`
    : `${readiness.target.modelId} · ${readiness.target.executionProvider}`;
  if (readiness.target.source === "built_in_default") {
    return identity;
  }
  return readiness.target.stageValidated
    ? `Environment target · ${identity}`
    : `Override (not stage-validated) · ${identity}`;
}

export function coreModelStatusLines(
  layout: RuntimeReadiness,
  vision: FloorPlanVisionReadiness,
): {
  readonly layout: CoreModelStatusLine;
  readonly vision: CoreModelStatusLine;
} {
  const layoutState = layoutStatus(layout);
  const visionState = visionStatus(vision);
  return {
    layout: {
      text: `Layout planning · Qwen3 0.6B · GPU · ${layoutState}`,
      state: layoutState,
      title: `${layout.target.modelId} · ${layout.target.executionProvider} · ${layout.detail}`,
    },
    vision: {
      text: `Floor-plan vision · Qwen3.5 0.8B · CPU · ${visionState}`,
      state: visionState,
      title: `${vision.target.modelId} · ${vision.target.executionProvider} · ${vision.detail}`,
    },
  };
}

function layoutStatus(readiness: RuntimeReadiness): CoreModelStatusLine["state"] {
  if (
    readiness.status === "configuration_invalid" ||
    readiness.status === "model_unavailable" ||
    readiness.status === "provider_unavailable" ||
    readiness.status === "recovery_required" ||
    readiness.status === "error"
  ) {
    return "error";
  }
  if (readiness.localInferenceReady && readiness.status === "ready") {
    return "ready";
  }
  if (readiness.status === "loading" || readiness.status === "recovering") {
    return "loading";
  }
  if (readiness.modelCached) {
    return "cached";
  }
  return "checking";
}

function visionStatus(readiness: FloorPlanVisionReadiness): CoreModelStatusLine["state"] {
  if (readiness.status === "model_unavailable" || readiness.status === "error") {
    return "error";
  }
  if (readiness.localInferenceReady && readiness.status === "ready") {
    return "ready";
  }
  if (readiness.status === "loading" || readiness.status === "downloading") {
    return "loading";
  }
  if (readiness.modelCached) {
    return "cached";
  }
  return "checking";
}
