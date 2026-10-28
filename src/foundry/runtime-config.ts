import type { RuntimeTargetIdentity } from "../domain/types";

export const VALIDATED_MODEL_ALIAS = "qwen2.5-1.5b";
export const VALIDATED_MODEL_ID = "qwen2.5-1.5b-instruct-generic-gpu:4";
export const VALIDATED_EXECUTION_PROVIDER = "WebGPUExecutionProvider";
const UNSET_RUNTIME_TARGET_VALUE = "<unset>";

export class RuntimeConfigurationError extends Error {
  constructor(
    message: string,
    readonly target: RuntimeTargetIdentity,
  ) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

export function canonicalExecutionProvider(name: string): string {
  const trimmed = name.trim();
  return trimmed === "WebGpuExecutionProvider" || trimmed === "WebGPUExecutionProvider"
    ? VALIDATED_EXECUTION_PROVIDER
    : trimmed;
}

export function invalidRuntimeTarget(
  environment: Readonly<Record<string, string | undefined>>,
): RuntimeTargetIdentity {
  const modelId = environment.FOUNDRY_MODEL_ID?.trim();
  const executionProvider = environment.FOUNDRY_EXECUTION_PROVIDER?.trim();
  return {
    modelId: modelId || UNSET_RUNTIME_TARGET_VALUE,
    executionProvider: executionProvider
      ? canonicalExecutionProvider(executionProvider)
      : UNSET_RUNTIME_TARGET_VALUE,
    source: "invalid_environment_override",
    stageValidated: false,
  };
}

export function resolveRuntimeTarget(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeTargetIdentity {
  const legacyAlias = environment.FOUNDRY_MODEL_ALIAS?.trim();
  if (legacyAlias) {
    throw new RuntimeConfigurationError(
      "FOUNDRY_MODEL_ALIAS is not supported because an alias does not identify an exact model variant. Remove it to use the validated default, or set both FOUNDRY_MODEL_ID and FOUNDRY_EXECUTION_PROVIDER.",
      invalidRuntimeTarget(environment),
    );
  }

  const modelId = environment.FOUNDRY_MODEL_ID?.trim();
  const executionProvider = environment.FOUNDRY_EXECUTION_PROVIDER?.trim();
  if ((modelId && !executionProvider) || (!modelId && executionProvider)) {
    throw new RuntimeConfigurationError(
      "FOUNDRY_MODEL_ID and FOUNDRY_EXECUTION_PROVIDER must be set together for an explicit runtime override.",
      invalidRuntimeTarget(environment),
    );
  }

  if (!modelId || !executionProvider) {
    return {
      modelId: VALIDATED_MODEL_ID,
      executionProvider: VALIDATED_EXECUTION_PROVIDER,
      source: "built_in_default",
      stageValidated: true,
    };
  }

  const canonicalProvider = canonicalExecutionProvider(executionProvider);
  return {
    modelId,
    executionProvider: canonicalProvider,
    source: "environment_override",
    stageValidated: modelId === VALIDATED_MODEL_ID && canonicalProvider === VALIDATED_EXECUTION_PROVIDER,
  };
}
