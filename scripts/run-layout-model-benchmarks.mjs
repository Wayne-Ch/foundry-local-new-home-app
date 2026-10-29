import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
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

for (const modelId of candidates) {
  const outputName = `layout-model-benchmark-${safeName(modelId)}.json`;
  const result = await runWorker(modelId, outputName);
  if (result.code !== 0) {
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
  const workerReport = JSON.parse(await readFile(path.join(process.cwd(), "artifacts", outputName), "utf8"));
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
  candidateReports.push(candidate);
}

const passing = candidateReports
  .filter((candidate) => candidate.passed === true)
  .sort((left, right) => {
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
const report = {
  generatedAt: new Date().toISOString(),
  suiteStartedAt: startedAt,
  sdkVersion: common?.sdkVersion ?? "2.2.1",
  nodeVersion: process.version,
  platform: `${process.platform}-${process.arch}`,
  contract: common?.contract ?? null,
  isolation: "One fresh Node/Foundry Local process per exact model candidate.",
  selectionRule: "Lowest warm maximum, then warm median, then model load.",
  noModelDownloads: true,
  excluded: common?.excluded ?? [
    {
      family: "Qwen 9B",
      reason:
        "Explicitly excluded by task; it is not cached and its larger footprint conflicts with the latency objective.",
    },
  ],
  candidates: candidateReports,
  selected: passing[0]
    ? {
        id: passing[0].exactId,
        executionProvider: passing[0].executionProvider,
        warmTurnMedianMs: passing[0].warmTurnMedianMs,
        warmTurnMaxMs: passing[0].warmTurnMaxMs,
      }
    : null,
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
