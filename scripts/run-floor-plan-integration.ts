import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { createImportedPlanningFixture, FLOOR_PLAN_SAMPLE_ASSET_PATH } from "../src/domain/floor-plan-import";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { evaluateManualPlacement } from "../src/domain/manual-placement";
import { createToolInputForTests } from "../src/domain/tool-contract";
import { FoundryFloorPlanVisionError, FoundryLayoutService } from "../src/foundry/foundry-service";
import { validateFloorPlanImageBytes, zeroFill } from "../src/layout-import/image-security";

const successMarker = "FLOOR_PLAN_INTEGRATION_OK";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

if (process.platform !== "win32") {
  throw new Error("The real floor-plan VLM integration gate must run on Windows.");
}

const fixturePath = path.resolve("public", FLOOR_PLAN_SAMPLE_ASSET_PATH);
const sourceBytes = await readFile(fixturePath);
const validated = validateFloorPlanImageBytes(sourceBytes);
sourceBytes.fill(0);
const service = new FoundryLayoutService();

try {
  const outcome = await service.analyzeFloorPlan(validated.format, validated.bytes, (detail) => {
    console.log(`[floor-plan] ${detail}`);
  });
  assert(outcome.model.id === "qwen3.5-0.8b-generic-cpu:3", `Unexpected vision model ${outcome.model.id}.`);
  assert(
    outcome.model.executionProvider === "CPUExecutionProvider",
    `Unexpected vision provider ${outcome.model.executionProvider}.`,
  );
  assert(service.visionReadiness.externalEndpointUsed === false, "External endpoint flag changed.");

  const planningFixture = createImportedPlanningFixture(outcome.recognition);
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
      changedPreference:
        "In the imported bedroom, can a Queen-size bed and a desk fit while keeping the door, closet, and window clear?",
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
      changedPreference: "What changes in the imported room if we use a King-size bed instead?",
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

  const recovery = compareKnownLayoutOptions(
    createToolInputForTests({
      state,
      planningFixture,
      candidateFurnitureIds: ["bed-queen", "desk-compact", "crib-standard"],
      retainFurnitureIds: ["bed-queen"],
      changedPreference:
        "Keep the Queen bed in the imported bedroom. Add a baby bed. Use a compact desk if needed.",
    }),
    state,
    acceptedQueen,
    planningFixture,
  );
  assert(recovery.status === "feasible", `Imported recovery failed: ${recovery.summary}`);
  state = applyToolResult(state, recovery);
  const acceptedRecovery =
    recovery.feasibleOptions.find((option) => option.id === recovery.selectedOptionId) ?? null;
  assert(acceptedRecovery !== null, "Imported recovery did not select a layout.");

  const manual = evaluateManualPlacement(
    state,
    acceptedRecovery,
    {
      priorStateRef: state.stateRef,
      sourceLayoutId: acceptedRecovery.id,
      instanceId: "desk-main",
      xMm: 2850,
      yMm: 850,
    },
    planningFixture,
  );
  assert(manual.accepted, `Imported manual placement failed: ${manual.reason}`);

  const evidence = {
    marker: successMarker,
    fixture: {
      path: fixturePath,
      format: validated.format,
      width: validated.width,
      height: validated.height,
    },
    model: outcome.model,
    recognition: outcome.recognition,
    roomPlan: planningFixture.roomPlan,
    queen: {
      status: queen.status,
      selectedOptionId: queen.selectedOptionId,
    },
    king: {
      status: king.status,
      conflicts: king.conflicts,
    },
    recovery: {
      status: recovery.status,
      selectedOptionId: recovery.selectedOptionId,
    },
    manual: {
      accepted: manual.accepted,
      selectedLayoutId: manual.selectedLayout?.id ?? null,
    },
    performance: outcome.performance,
    externalEndpointUsed: service.visionReadiness.externalEndpointUsed,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    path.join("artifacts", "floor-plan-integration.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(successMarker);
} catch (error) {
  if (error instanceof FoundryFloorPlanVisionError) {
    console.error("FLOOR_PLAN_VISION_ATTEMPTS", JSON.stringify(error.attempts, null, 2));
  }
  throw error;
} finally {
  zeroFill(validated.bytes);
  await service.shutdown();
}
