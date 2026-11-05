import { describe, expect, it } from "vitest";
import type { FloorPlanVisionReadiness, RuntimeReadiness } from "../src/domain/types";
import { deriveCoreModelReadiness, OFFLINE_CORE_READY_TEXT } from "../src/foundry/core-model-readiness";
import { coreModelStatusLines } from "../src/renderer/runtime-presentation";

const layoutReady: RuntimeReadiness = {
  sdkVersion: "2.2.1",
  provider: "Foundry Local in-process SDK",
  planningMode: "Runtime-guided intent-delta JSON schema -> app-derived tool invocation",
  responseMode: "Application-rendered typed evidence",
  target: {
    modelId: "qwen3-0.6b-generic-gpu:2",
    executionProvider: "WebGPUExecutionProvider",
    source: "built_in_default",
    stageValidated: true,
  },
  model: {
    alias: "qwen3-0.6b",
    id: "qwen3-0.6b-generic-gpu:2",
    deviceType: "GPU",
    executionProvider: "WebGPUExecutionProvider",
    supportsToolCalling: true,
    fileSizeMb: 529,
  },
  modelCached: true,
  executionProviderRegistered: true,
  localInferenceReady: true,
  externalEndpointUsed: false,
  nonessentialTelemetryDisabled: true,
  cachePath: "<test>",
  appDataPath: "<test>",
  status: "ready",
  detail: "ready",
};

const visionReady: FloorPlanVisionReadiness = {
  sdkVersion: "2.2.1",
  provider: "Foundry Local in-process SDK",
  target: {
    modelId: "qwen3.5-0.8b-generic-cpu:3",
    executionProvider: "CPUExecutionProvider",
    task: "vision-language-chat",
    stageValidated: true,
  },
  model: {
    alias: "qwen3.5-0.8b",
    id: "qwen3.5-0.8b-generic-cpu:3",
    deviceType: "CPU",
    executionProvider: "CPUExecutionProvider",
    supportsToolCalling: false,
    fileSizeMb: 900,
  },
  modelCached: true,
  localInferenceReady: true,
  externalEndpointUsed: false,
  status: "ready",
  detail: "ready",
};

describe("combined core-model readiness", () => {
  it("reports 2/2 only when both exact model identities are cached and locally ready", () => {
    expect(deriveCoreModelReadiness(layoutReady, visionReady)).toEqual({
      layoutReady: true,
      floorPlanVisionReady: true,
      readyCount: 2,
      totalCount: 2,
      allReady: true,
    });
    expect(OFFLINE_CORE_READY_TEXT).toBe("Offline ready · 2/2 local models");
  });

  it("fails closed when either model is not cached, loaded, or exact", () => {
    const exactLayoutModel = layoutReady.model;
    if (exactLayoutModel === null) {
      throw new Error("The ready layout fixture must include its exact model identity.");
    }
    expect(
      deriveCoreModelReadiness(layoutReady, {
        ...visionReady,
        modelCached: false,
      }),
    ).toMatchObject({ readyCount: 1, allReady: false });
    expect(
      deriveCoreModelReadiness(
        {
          ...layoutReady,
          model: {
            ...exactLayoutModel,
            id: "alternate-generic-gpu:1",
          },
        },
        visionReady,
      ),
    ).toMatchObject({ readyCount: 1, allReady: false });
  });

  it("maps each model to its own compact visible status and exact accessible identity", () => {
    expect(coreModelStatusLines(layoutReady, visionReady)).toEqual({
      layout: {
        text: "Layout planning · Qwen3 0.6B · GPU · ready",
        state: "ready",
        title: expect.stringContaining("qwen3-0.6b-generic-gpu:2 · WebGPUExecutionProvider"),
      },
      vision: {
        text: "Floor-plan vision · Qwen3.5 0.8B · CPU · ready",
        state: "ready",
        title: expect.stringContaining("qwen3.5-0.8b-generic-cpu:3 · CPUExecutionProvider"),
      },
    });

    expect(
      coreModelStatusLines(
        {
          ...layoutReady,
          localInferenceReady: false,
          status: "loading",
        },
        {
          ...visionReady,
          localInferenceReady: false,
          status: "error",
        },
      ),
    ).toMatchObject({
      layout: { state: "loading", text: expect.stringContaining("· loading") },
      vision: { state: "error", text: expect.stringContaining("· error") },
    });
  });

  it.each([
    {
      name: "initial",
      readiness: {
        ...visionReady,
        model: null,
        modelCached: false,
        localInferenceReady: false,
        status: "not_initialized",
      } satisfies FloorPlanVisionReadiness,
      expectedLabel: "not initialized",
      expectedState: "checking",
    },
    {
      name: "checking",
      readiness: {
        ...visionReady,
        model: null,
        modelCached: false,
        localInferenceReady: false,
        status: "checking",
      } satisfies FloorPlanVisionReadiness,
      expectedLabel: "checking",
      expectedState: "checking",
    },
    {
      name: "cached",
      readiness: {
        ...visionReady,
        localInferenceReady: false,
        status: "checking",
      } satisfies FloorPlanVisionReadiness,
      expectedLabel: "cached",
      expectedState: "cached",
    },
    {
      name: "loading",
      readiness: {
        ...visionReady,
        localInferenceReady: false,
        status: "loading",
      } satisfies FloorPlanVisionReadiness,
      expectedLabel: "loading",
      expectedState: "loading",
    },
    {
      name: "ready",
      readiness: visionReady,
      expectedLabel: "ready",
      expectedState: "ready",
    },
    {
      name: "error",
      readiness: {
        ...visionReady,
        localInferenceReady: false,
        status: "error",
      } satisfies FloorPlanVisionReadiness,
      expectedLabel: "error",
      expectedState: "error",
    },
  ] as const)(
    "keeps the floor-plan vision $name label and presentation state distinct",
    ({ readiness, expectedLabel, expectedState }) => {
      expect(coreModelStatusLines(layoutReady, readiness).vision).toMatchObject({
        text: `Floor-plan vision · Qwen3.5 0.8B · CPU · ${expectedLabel}`,
        state: expectedState,
      });
    },
  );
});
