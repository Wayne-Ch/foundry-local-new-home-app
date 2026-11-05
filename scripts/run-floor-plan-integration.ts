import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { createImportedPlanningFixture, FLOOR_PLAN_SAMPLE_ASSET_PATH } from "../src/domain/floor-plan-import";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { evaluateManualPlacement } from "../src/domain/manual-placement";
import { createToolInputForTests } from "../src/domain/tool-contract";
import {
  type FoundryFloorPlanAttempt,
  type FoundryFloorPlanOutcome,
  FoundryFloorPlanVisionError,
  FoundryLayoutService,
} from "../src/foundry/foundry-service";
import { importedStageTurns } from "../src/foundry/prompt";
import {
  FLOOR_PLAN_FIXTURE_BYTE_LENGTH,
  FLOOR_PLAN_FIXTURE_HEIGHT,
  FLOOR_PLAN_FIXTURE_SHA256,
  FLOOR_PLAN_FIXTURE_WIDTH,
  validateFloorPlanImageBytes,
  validateSupportedFloorPlanFixtureBytes,
  zeroFill,
} from "../src/layout-import/image-security";

const successMarker = "FLOOR_PLAN_INTEGRATION_OK";
const artifactDirectory = "artifacts";
const successArtifactPath = path.join(artifactDirectory, "floor-plan-integration.json");
const failureArtifactPath = path.join(artifactDirectory, "floor-plan-integration-failure.json");

interface VisionCaseEvidence {
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly exactFixtureIdentityRequired: boolean;
  readonly accepted: boolean;
  readonly recognition: FoundryFloorPlanOutcome["recognition"] | null;
  readonly attempts: readonly FoundryFloorPlanAttempt[];
  readonly error: string | null;
}

type VisionCaseResult =
  | {
      readonly accepted: true;
      readonly outcome: FoundryFloorPlanOutcome;
      readonly evidence: VisionCaseEvidence;
    }
  | {
      readonly accepted: false;
      readonly error: FoundryFloorPlanVisionError;
      readonly evidence: VisionCaseEvidence;
    };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

if (process.platform !== "win32") {
  throw new Error("The real floor-plan VLM integration gate must run on Windows.");
}

const service = new FoundryLayoutService();
const visionCases: VisionCaseEvidence[] = [];

async function runVisionCase(
  name: string,
  fixturePath: string,
  exactFixtureIdentityRequired: boolean,
): Promise<VisionCaseResult> {
  const sourceBytes = await readFile(fixturePath);
  const sha256 = createHash("sha256").update(sourceBytes).digest("hex");
  let validated: ReturnType<typeof validateFloorPlanImageBytes>;
  try {
    validated = exactFixtureIdentityRequired
      ? validateSupportedFloorPlanFixtureBytes(sourceBytes)
      : validateFloorPlanImageBytes(sourceBytes);
  } finally {
    sourceBytes.fill(0);
  }

  try {
    const outcome = await service.analyzeFloorPlan(validated.format, validated.bytes, (detail) => {
      console.log(`[floor-plan:${name}] ${detail}`);
    });
    const evidence: VisionCaseEvidence = {
      name,
      path: fixturePath,
      sha256,
      format: validated.format,
      width: validated.width,
      height: validated.height,
      byteLength: validated.byteLength,
      exactFixtureIdentityRequired,
      accepted: true,
      recognition: outcome.recognition,
      attempts: outcome.attempts,
      error: null,
    };
    visionCases.push(evidence);
    return { accepted: true, outcome, evidence };
  } catch (error) {
    if (!(error instanceof FoundryFloorPlanVisionError)) {
      throw error;
    }
    const evidence: VisionCaseEvidence = {
      name,
      path: fixturePath,
      sha256,
      format: validated.format,
      width: validated.width,
      height: validated.height,
      byteLength: validated.byteLength,
      exactFixtureIdentityRequired,
      accepted: false,
      recognition: null,
      attempts: error.attempts,
      error: error.message,
    };
    visionCases.push(evidence);
    return { accepted: false, error, evidence };
  } finally {
    zeroFill(validated.bytes);
  }
}

function assertRejectedControl(result: VisionCaseResult, name: string): void {
  assert(!result.accepted, `${name} unexpectedly satisfied the acceptance conjunction.`);
  assert(result.error.attempts.length > 0, `${name} rejection did not retain raw attempts.`);
  assert(
    result.error.attempts.every((attempt) => attempt.finishReason === "stop"),
    `${name} did not finish every retained attempt with stop.`,
  );
  assert(
    result.error.attempts.every((attempt) => attempt.error?.code === "CONTENT_MISMATCH"),
    `${name} did not produce a structured content-mismatch rejection.`,
  );
}

let successEvidence: Record<string, unknown> | null = null;
try {
  const fixturePath = path.resolve("public", FLOOR_PLAN_SAMPLE_ASSET_PATH);
  const whiteControlPath = path.resolve("tests", "fixtures", "floor-plan", "white-control.png");
  const rectangleOnlyControlPath = path.resolve(
    "tests",
    "fixtures",
    "floor-plan",
    "rectangle-only-control.png",
  );

  const visionReadiness = await service.prepareFloorPlanVision((detail) => {
    console.log(`[floor-plan:prepare] ${detail}`);
  });
  assert(visionReadiness.modelCached, "The exact floor-plan vision model is not cached.");
  assert(visionReadiness.localInferenceReady, "The exact floor-plan vision model is not loaded.");
  assert(
    visionReadiness.model?.id === "qwen3.5-0.8b-generic-cpu:3",
    `Unexpected prepared vision model ${visionReadiness.model?.id ?? "<none>"}.`,
  );
  assert(
    visionReadiness.model.executionProvider === "CPUExecutionProvider",
    `Unexpected prepared vision provider ${visionReadiness.model.executionProvider}.`,
  );

  const positive = await runVisionCase("exact-nara-positive", fixturePath, true);
  assert(positive.accepted, "The exact NARA fixture failed the visible-evidence contract.");
  assert(positive.evidence.sha256 === FLOOR_PLAN_FIXTURE_SHA256, "Exact fixture SHA-256 changed.");
  assert(positive.evidence.format === "png", "Exact fixture is no longer PNG.");
  assert(
    positive.evidence.width === FLOOR_PLAN_FIXTURE_WIDTH &&
      positive.evidence.height === FLOOR_PLAN_FIXTURE_HEIGHT,
    "Exact fixture dimensions changed.",
  );
  assert(
    positive.evidence.byteLength === FLOOR_PLAN_FIXTURE_BYTE_LENGTH,
    "Exact fixture byte length changed.",
  );
  assert(
    positive.outcome.model.id === "qwen3.5-0.8b-generic-cpu:3",
    `Unexpected vision model ${positive.outcome.model.id}.`,
  );
  assert(
    positive.outcome.model.executionProvider === "CPUExecutionProvider",
    `Unexpected vision provider ${positive.outcome.model.executionProvider}.`,
  );
  assert(service.visionReadiness.externalEndpointUsed === false, "External endpoint flag changed.");

  const whiteControl = await runVisionCase("white-control", whiteControlPath, false);
  assertRejectedControl(whiteControl, "White control");
  const rectangleOnlyControl = await runVisionCase("rectangle-only-control", rectangleOnlyControlPath, false);
  assertRejectedControl(rectangleOnlyControl, "Rectangle-only control");

  const planningFixture = createImportedPlanningFixture(positive.outcome.recognition);
  assert(planningFixture.roomPlan.doorSwings.length === 1, "Expected one canonical entry-door swing.");
  assert(
    planningFixture.roomPlan.reservedZones.some((zone) => zone.kind === "window-clearance"),
    "Expected the canonical exterior-window clearance zone.",
  );

  let state = createInitialDemoState(planningFixture.roomPlan);
  const queen = compareKnownLayoutOptions(
    createToolInputForTests({
      state,
      planningFixture,
      candidateFurnitureIds: ["bed-queen", "desk-standard"],
      changedPreference: importedStageTurns[0]?.prompt ?? "",
    }),
    state,
    null,
    planningFixture,
  );
  assert(queen.status === "feasible", `Queen baseline failed: ${queen.summary}`);
  state = applyToolResult(state, queen);
  const acceptedQueen = queen.feasibleOptions.find((option) => option.id === queen.selectedOptionId) ?? null;
  assert(acceptedQueen !== null, "Queen baseline did not select a layout.");

  const king = compareKnownLayoutOptions(
    createToolInputForTests({
      state,
      planningFixture,
      candidateFurnitureIds: ["bed-king", "desk-standard"],
      retainFurnitureIds: ["desk-standard"],
      changedPreference: importedStageTurns[1]?.prompt ?? "",
    }),
    state,
    acceptedQueen,
    planningFixture,
  );
  assert(king.status === "no_feasible_option", "King conflict did not fail closed.");
  assert(
    king.conflicts.some(
      (conflict) =>
        conflict.code === "FURNITURE_CLEARANCE" &&
        conflict.actualDistanceMm === 70 &&
        conflict.requiredDistanceMm === 250,
    ),
    "King conflict did not preserve the exact 70 / 250 mm evidence.",
  );

  const turnC = compareKnownLayoutOptions(
    createToolInputForTests({
      state,
      planningFixture,
      candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
      retainFurnitureIds: ["bed-queen"],
      changedPreference: importedStageTurns[2]?.prompt ?? "",
    }),
    state,
    acceptedQueen,
    planningFixture,
  );
  assert(turnC.status === "feasible", `Imported Turn C failed: ${turnC.summary}`);
  state = applyToolResult(state, turnC);
  const acceptedTurnC = turnC.feasibleOptions.find((option) => option.id === turnC.selectedOptionId) ?? null;
  assert(acceptedTurnC !== null, "Imported Turn C did not select a layout.");

  const manual = evaluateManualPlacement(
    state,
    acceptedTurnC,
    {
      priorStateRef: state.stateRef,
      sourceLayoutId: acceptedTurnC.id,
      instanceId: "desk-main",
      xMm: 2850,
      yMm: 850,
    },
    planningFixture.roomPlan,
  );
  assert(manual.accepted, `Imported manual placement failed: ${manual.reason}`);

  successEvidence = {
    marker: successMarker,
    readiness: visionReadiness,
    validatorCases: visionCases,
    model: positive.outcome.model,
    recognition: positive.outcome.recognition,
    roomPlan: planningFixture.roomPlan,
    queen: {
      status: queen.status,
      selectedOptionId: queen.selectedOptionId,
    },
    king: {
      status: king.status,
      conflicts: king.conflicts,
    },
    turnC: {
      status: turnC.status,
      selectedOptionId: turnC.selectedOptionId,
    },
    manual: {
      accepted: manual.accepted,
      selectedLayoutId: manual.selectedLayout?.id ?? null,
    },
    performance: positive.outcome.performance,
    externalEndpointUsed: service.visionReadiness.externalEndpointUsed,
  };
} catch (error) {
  await mkdir(artifactDirectory, { recursive: true });
  const failureEvidence = {
    marker: "FLOOR_PLAN_INTEGRATION_FAILED",
    error: errorMessage(error),
    validatorCases: visionCases,
  };
  await writeFile(failureArtifactPath, `${JSON.stringify(failureEvidence, null, 2)}\n`);
  console.error("FLOOR_PLAN_INTEGRATION_FAILURE_EVIDENCE", JSON.stringify(failureEvidence, null, 2));
  throw error;
} finally {
  await service.shutdown();
}

assert(successEvidence !== null, "Floor-plan integration completed without success evidence.");
await mkdir(artifactDirectory, { recursive: true });
await writeFile(successArtifactPath, `${JSON.stringify(successEvidence, null, 2)}\n`);
console.log(successMarker);
