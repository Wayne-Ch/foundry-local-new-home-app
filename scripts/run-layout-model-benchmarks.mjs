import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const candidates = [
  "qwen2.5-0.5b-instruct-vitis-npu:3",
  "qwen3-0.6b-generic-gpu:2",
  "qwen3.5-0.8b-generic-gpu:2",
  "qwen3.5-2b-generic-gpu:2",
  "qwen3.5-4b-generic-gpu:2",
  "qwen3-1.7b-generic-gpu:2",
  "qwen2.5-1.5b-instruct-generic-gpu:4",
];
const defaultModelId = "qwen3-0.6b-generic-gpu:2";
const requestedIds = process.env.LAYOUT_BENCHMARK_MODELS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const selectedCandidates =
  requestedIds && requestedIds.length > 0
    ? candidates.filter((candidate) => requestedIds.includes(candidate))
    : candidates;
if (selectedCandidates.length === 0) {
  throw new Error("LAYOUT_BENCHMARK_MODELS did not match a declared exact candidate.");
}
const requestedRequiredIds = process.env.LAYOUT_BENCHMARK_REQUIRED_MODELS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const requiredModelIds =
  requestedRequiredIds && requestedRequiredIds.length > 0
    ? requestedRequiredIds
    : selectedCandidates.includes(defaultModelId)
      ? [defaultModelId]
      : selectedCandidates;
if (requiredModelIds.some((requiredId) => !selectedCandidates.includes(requiredId))) {
  throw new Error("LAYOUT_BENCHMARK_REQUIRED_MODELS must be a subset of the requested candidates.");
}

function safeName(modelId) {
  return modelId.replace(/[^a-z0-9.-]+/gi, "-");
}

function runWorker(modelId, outputName) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join("scripts", "benchmark-layout-models.ts")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LAYOUT_BENCHMARK_MODELS: modelId,
          LAYOUT_BENCHMARK_OUTPUT: outputName,
        },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", (error) => finish({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => finish({ code, signal, error: null }));
  });
}

const startedAt = new Date().toISOString();
const candidateReports = [];
let common = null;

for (const modelId of selectedCandidates) {
  const outputName = `layout-model-benchmark-${safeName(modelId)}.json`;
  const workerOutputPath = path.join(process.cwd(), "artifacts", outputName);
  await rm(workerOutputPath, { force: true });
  const result = await runWorker(modelId, outputName);
  let workerReport = null;
  try {
    workerReport = JSON.parse(await readFile(workerOutputPath, "utf8"));
  } catch {
    workerReport = null;
  }
  if (workerReport === null) {
    candidateReports.push({
      id: modelId,
      passed: false,
      compatibility: "worker_failed",
      failure:
        result.error instanceof Error
          ? `Isolated benchmark worker failed to start: ${result.error.message}.`
          : `Isolated benchmark worker exited with code ${result.code ?? "null"}${
              result.signal ? ` and signal ${result.signal}` : ""
            }.`,
    });
    continue;
  }
  common ??= workerReport;
  const candidate = workerReport.candidates?.[0];
  if (candidate === undefined) {
    candidateReports.push({
      id: modelId,
      passed: false,
      compatibility: "worker_report_invalid",
      failure: "Isolated worker wrote no candidate result.",
    });
    continue;
  }
  candidateReports.push({
    ...candidate,
    workerExitCode: result.code,
    workerSignal: result.signal,
  });
}

const passing = candidateReports
  .filter((candidate) => candidate.passed === true)
  .sort((left, right) => {
    if (left.exactId === defaultModelId && right.exactId !== defaultModelId) {
      return -1;
    }
    if (right.exactId === defaultModelId && left.exactId !== defaultModelId) {
      return 1;
    }
    const maxDifference =
      Number(left.warmTurnMaxMs ?? Number.MAX_SAFE_INTEGER) -
      Number(right.warmTurnMaxMs ?? Number.MAX_SAFE_INTEGER);
    if (maxDifference !== 0) {
      return maxDifference;
    }
    const medianDifference =
      Number(left.warmTurnMedianMs ?? Number.MAX_SAFE_INTEGER) -
      Number(right.warmTurnMedianMs ?? Number.MAX_SAFE_INTEGER);
    return medianDifference !== 0
      ? medianDifference
      : Number(left.loadMs ?? Number.MAX_SAFE_INTEGER) - Number(right.loadMs ?? Number.MAX_SAFE_INTEGER);
  });
const selected = passing[0]
  ? {
      id: passing[0].exactId,
      executionProvider: passing[0].executionProvider,
      warmTurnMedianMs: passing[0].warmTurnMedianMs,
      warmTurnMaxMs: passing[0].warmTurnMaxMs,
    }
  : null;
const gateFailures = [];
for (const requiredId of requiredModelIds) {
  const candidate = candidateReports.find((entry) => (entry.exactId ?? entry.id) === requiredId);
  if (candidate === undefined) {
    gateFailures.push(`Required candidate ${requiredId} is missing.`);
  } else if (candidate.passed !== true) {
    gateFailures.push(`Required candidate ${requiredId} failed one or more quality scenarios.`);
  }
}
if (selected === null) {
  gateFailures.push("No passing model was selected.");
} else {
  const selectedCandidate = candidateReports.find(
    (entry) => (entry.exactId ?? entry.id) === selected.id && entry.passed === true,
  );
  if (selectedCandidate === undefined) {
    gateFailures.push(`Selected model ${selected.id} does not have a passing candidate result.`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  suiteStartedAt: startedAt,
  sdkVersion: common?.sdkVersion ?? "2.2.1",
  nodeVersion: process.version,
  platform: `${process.platform}-${process.arch}`,
  contract: common?.contract ?? null,
  isolation: "One fresh Node/Foundry Local process per exact model candidate.",
  selectionRule:
    "Keep the stage-validated built-in default when it passes every required scenario; otherwise use lowest warm maximum, median, then load.",
  noModelDownloads: true,
  excluded: common?.excluded ?? [
    {
      family: "Qwen 9B",
      reason:
        "Explicitly excluded by task; it is not cached and its larger footprint conflicts with the latency objective.",
    },
  ],
  candidates: candidateReports,
  selected,
  gate: {
    passed: gateFailures.length === 0,
    requiredModelIds,
    rejectedCandidateIds: candidateReports
      .filter((candidate) => candidate.passed !== true)
      .map((candidate) => candidate.exactId ?? candidate.id),
    failures: gateFailures,
  },
};

const outputPath = path.join(process.cwd(), "artifacts", "layout-model-benchmark.json");
await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
console.log(`\nWrote isolated suite report ${outputPath}`);
console.log(
  JSON.stringify(
    {
      selected: report.selected,
      candidates: candidateReports.map((candidate) => ({
        id: candidate.exactId ?? candidate.id,
        task: candidate.task ?? null,
        compatibility: candidate.compatibility,
        passed: candidate.passed,
        loadMs: candidate.loadMs ?? null,
        warmTurnMedianMs: candidate.warmTurnMedianMs ?? null,
        warmTurnMaxMs: candidate.warmTurnMaxMs ?? null,
        failure: candidate.failure ?? null,
        failures: candidate.failures ?? [],
      })),
    },
    null,
    2,
  ),
);
if (!report.gate.passed) {
  console.error(`Benchmark quality gate failed: ${report.gate.failures.join(" ")}`);
  process.exitCode = 1;
}
