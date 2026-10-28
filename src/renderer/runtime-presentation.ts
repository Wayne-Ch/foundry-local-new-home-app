import type { RuntimeReadiness } from "../domain/types";

export function runtimeBadgeLabel(readiness: RuntimeReadiness): string {
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
