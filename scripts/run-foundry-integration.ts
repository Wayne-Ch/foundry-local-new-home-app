import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { expandCandidateFurnitureIds } from "../src/domain/tool-contract";
import type { DemoState, FurnitureId, LayoutToolResult } from "../src/domain/types";
import { FoundryLayoutService } from "../src/foundry/foundry-service";
import { stageTurns } from "../src/foundry/prompt";
import { VALIDATED_EXECUTION_PROVIDER, VALIDATED_MODEL_ID } from "../src/foundry/runtime-config";

interface TurnEvidence {
  readonly label: string;
  readonly prompt: string;
  readonly intentDelta: unknown;
  readonly toolArguments: unknown;
  readonly toolStatus: LayoutToolResult["status"];
  readonly selectedOptionId: string | null;
  readonly evidenceOptionId: string | null;
  readonly conflicts: readonly string[];
  readonly aggregateConflicts: readonly string[];
  readonly assistantText: string;
  readonly validationAttempts: number;
  readonly performance: unknown;
  readonly durationMs: number;
}

function assertSet(actual: readonly FurnitureId[], expected: readonly FurnitureId[], label: string): void {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

async function runAndCommit(
  service: FoundryLayoutService,
  state: DemoState,
  label: string,
  prompt: string,
  expectedFurniture: readonly FurnitureId[],
  expectedStatus: LayoutToolResult["status"],
): Promise<{ readonly state: DemoState; readonly evidence: TurnEvidence }> {
  const started = performance.now();
  const outcome = await service.runTurn(prompt, state, (_phase, detail) => {
    process.stdout.write(`\r${label}: ${detail.padEnd(96).slice(0, 96)}`);
  });
  process.stdout.write("\n");
  assertSet(
    expandCandidateFurnitureIds(outcome.validatedInput.candidateFurnitureIds),
    expectedFurniture,
    `${label} furniture intent`,
  );
  assert.equal(outcome.toolResult.status, expectedStatus, `${label} geometry status`);
  assert.ok(outcome.assistantText.length > 0, `${label} model summary`);
  console.log(`${label} assistant: ${outcome.assistantText}`);

  return {
    state: applyToolResult(state, outcome.toolResult),
    evidence: {
      label,
      prompt,
      intentDelta: outcome.modelIntent.parsed,
      toolArguments: outcome.validatedInput,
      toolStatus: outcome.toolResult.status,
      selectedOptionId: outcome.toolResult.selectedOptionId,
      evidenceOptionId: outcome.toolResult.evidenceOptionId,
      conflicts: outcome.toolResult.conflicts.map((conflict) => conflict.message),
      aggregateConflicts: outcome.toolResult.aggregateConflicts.map((conflict) => conflict.message),
      assistantText: outcome.assistantText,
      validationAttempts: outcome.validationAttempts,
      performance: outcome.performance,
      durationMs: Math.round(performance.now() - started),
    },
  };
}

const service = new FoundryLayoutService();
let state = createInitialDemoState();
const turns: TurnEvidence[] = [];

try {
  console.log("Initializing Foundry Local SDK 2.2.1...");
  await service.initialize();
  const readiness = await service.prepareOffline((detail) => {
    process.stdout.write(`\rRuntime: ${detail.padEnd(96).slice(0, 96)}`);
  });
  process.stdout.write("\n");
  assert.equal(readiness.localInferenceReady, true, readiness.detail);
  assert.equal(readiness.externalEndpointUsed, false);
  assert.equal(readiness.nonessentialTelemetryDisabled, true);
  assert.equal(
    readiness.target.source,
    "built_in_default",
    "Integration must run with the built-in stage configuration; clear runtime override variables.",
  );
  assert.equal(readiness.target.stageValidated, true);
  assert.equal(readiness.target.modelId, VALIDATED_MODEL_ID);
  assert.equal(readiness.target.executionProvider, VALIDATED_EXECUTION_PROVIDER);
  assert.equal(readiness.model?.id, VALIDATED_MODEL_ID);
  assert.equal(readiness.model?.executionProvider, VALIDATED_EXECUTION_PROVIDER);
  assert.equal(readiness.modelCached, true);
  assert.equal(readiness.executionProviderRegistered, true);
  assert.equal(readiness.model?.supportsToolCalling, true);

  const turnA = await runAndCommit(
    service,
    state,
    "Turn A",
    stageTurns[0]?.prompt ?? "",
    ["bed-queen", "desk-standard"],
    "feasible",
  );
  state = turnA.state;
  turns.push(turnA.evidence);
  assert.equal(turnA.evidence.selectedOptionId, "queen-desk-standard-v1");

  const turnB = await runAndCommit(
    service,
    state,
    "Turn B",
    stageTurns[1]?.prompt ?? "",
    ["bed-king", "desk-standard"],
    "no_feasible_option",
  );
  state = turnB.state;
  turns.push(turnB.evidence);
  assert.ok(
    turnB.evidence.conflicts.some((conflict) => conflict.toLowerCase().includes("closet")),
    "Turn B must surface the deterministic closet conflict.",
  );
  assert.ok(turnB.evidence.assistantText.includes("?"), "Turn B must ask which preference may change.");

  const turnC = await runAndCommit(
    service,
    state,
    "Turn C",
    stageTurns[2]?.prompt ?? "",
    ["bed-queen", "desk-compact", "crib-standard"],
    "feasible",
  );
  state = turnC.state;
  turns.push(turnC.evidence);
  assert.equal(turnC.evidence.selectedOptionId, "queen-crib-compact-v1");

  const failureTurn = await runAndCommit(
    service,
    state,
    "Controlled failure",
    stageTurns[3]?.prompt ?? "",
    ["bed-king", "desk-compact", "crib-standard"],
    "no_feasible_option",
  );
  state = failureTurn.state;
  turns.push(failureTurn.evidence);
  assert.ok(failureTurn.evidence.conflicts.length > 0);
  assert.ok(failureTurn.evidence.evidenceOptionId);
  assert.ok(
    failureTurn.evidence.aggregateConflicts.some((conflict) => conflict.toLowerCase().includes("door swing")),
    "Controlled failure aggregate reasons must include the alternate door-swing rejection.",
  );
  assert.ok(
    failureTurn.evidence.conflicts.every((conflict) => !conflict.toLowerCase().includes("door swing")),
    "The displayed east-option preview must not inherit the south-option door-swing conflict.",
  );
  assert.ok(
    failureTurn.evidence.assistantText.includes("?"),
    "Controlled failure must ask which preference may change.",
  );

  const correctionPrompt =
    "Correction: keep the Queen bed and compact desk. Remove the crib. Do not switch to a King.";
  const correction = await runAndCommit(
    service,
    state,
    "Adversarial correction",
    correctionPrompt,
    ["bed-queen", "desk-compact"],
    "feasible",
  );
  state = correction.state;
  turns.push(correction.evidence);
  assert.equal(correction.evidence.selectedOptionId, "queen-compact-desk-v1");

  const transitionState: DemoState = {
    ...state,
    stateRef: "layout-state-v50",
    version: 50,
    currentLayoutId: "integration-king-compact-crib",
    activeFurnitureIds: ["bed-king", "desk-compact", "crib-standard"],
  };
  for (const [label, prompt] of [
    ["Replace transition", "Replace the King with a Queen."],
    ["From/to transition", "Move from King to Queen and keep the crib."],
    ["Scoped negation", "Do not keep the King; use the Queen and do not remove the crib."],
  ] as const) {
    const transition = await runAndCommit(
      service,
      transitionState,
      label,
      prompt,
      ["bed-queen", "desk-compact", "crib-standard"],
      "feasible",
    );
    turns.push(transition.evidence);
    assert.equal(transition.evidence.selectedOptionId, "queen-crib-compact-v1");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    provider: readiness.provider,
    sdkVersion: readiness.sdkVersion,
    target: readiness.target,
    model: readiness.model,
    modelCached: readiness.modelCached,
    executionProviderRegistered: readiness.executionProviderRegistered,
    cachePath: readiness.cachePath,
    appDataPath: readiness.appDataPath,
    localInferenceReady: readiness.localInferenceReady,
    externalEndpointUsed: readiness.externalEndpointUsed,
    nonessentialTelemetryDisabled: readiness.nonessentialTelemetryDisabled,
    finalState: state,
    turns,
  };
  await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), "artifacts", "foundry-integration.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await service.shutdown();
}
