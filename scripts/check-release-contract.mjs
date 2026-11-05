import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import semver from "semver";

const root = new URL("../", import.meta.url);
const nodeRange = "^22.12.0 || ^24.0.0 || >=26.0.0";
const npmRange = ">=11.18.0";
const validatedNode = "26.13.0";
const validatedNpm = "11.20.0";

const readText = (path) => readFileSync(new URL(path, root), "utf8");
const readJson = (path) => JSON.parse(readText(path));

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const lockRoot = packageLock.packages[""];

assert.equal(packageJson.packageManager, `npm@${validatedNpm}`);
assert.equal(packageJson.engines.node, nodeRange);
assert.equal(packageJson.engines.npm, npmRange);
assert.equal(packageJson.devEngines.runtime.version, nodeRange);
assert.equal(packageJson.devEngines.packageManager.version, npmRange);
assert.equal(packageJson.devDependencies.semver, "7.8.5");
assert.equal(lockRoot.engines.node, nodeRange);
assert.equal(lockRoot.engines.npm, npmRange);
assert.equal(lockRoot.devDependencies.semver, "7.8.5");

const nodeMatrix = [
  { version: "20.19.0", supported: false },
  { version: "21.7.3", supported: false },
  { version: "22.11.0", supported: false },
  { version: "22.12.0", supported: true },
  { version: "22.99.0", supported: true },
  { version: "23.11.1", supported: false },
  { version: "24.0.0", supported: true },
  { version: "24.99.0", supported: true },
  { version: "25.8.0", supported: false },
  { version: "26.0.0", supported: true },
  { version: "30.0.0", supported: true },
];

for (const entry of nodeMatrix) {
  assert.equal(
    semver.satisfies(entry.version, nodeRange),
    entry.supported,
    `Node ${entry.version} support must be ${entry.supported}.`,
  );
}

const readinessMatrix = [
  {
    state: "Cold, empty shared model cache",
    modelCached: false,
    executionProviderRegistered: false,
    localInferenceReady: false,
    expected: "Prepare offline",
  },
  {
    state: "Warm shared cache with a fresh product root",
    modelCached: true,
    executionProviderRegistered: true,
    localInferenceReady: false,
    expected: "Load local model",
  },
  {
    state: "Model cached; product-specific WebGPU provider registration still needed",
    modelCached: true,
    executionProviderRegistered: false,
    localInferenceReady: false,
    expected: "Load local model",
  },
  {
    state: "Layout loaded; floor-plan vision still pending",
    modelCached: true,
    executionProviderRegistered: true,
    localInferenceReady: true,
    visionReady: false,
    expected: "Prepare offline",
  },
  {
    state: "Both exact local models loaded",
    modelCached: true,
    executionProviderRegistered: true,
    localInferenceReady: true,
    visionReady: true,
    expected: "Local models ready",
  },
];

const runtimeButtonLabel = ({ modelCached, localInferenceReady, visionReady = false }) =>
  localInferenceReady && visionReady
    ? "Local models ready"
    : localInferenceReady
      ? "Prepare offline"
      : modelCached
        ? "Load local model"
        : "Prepare offline";

for (const entry of readinessMatrix) {
  assert.equal(runtimeButtonLabel(entry), entry.expected, `${entry.state} has the wrong label.`);
}

const renderer = readText("src/renderer/renderer.ts");
const normalizedRenderer = renderer.replace(/\s+/gu, " ");
assert.ok(
  normalizedRenderer.includes(
    'coreReadiness.readyCount === 0 && readiness.modelCached ? "Load local model" : "Prepare offline"',
  ),
  "Renderer setup labels no longer distinguish cached layout assets from cold preparation.",
);
assert.match(renderer, /prepareButton\.textContent = "Local models ready";/u);
assert.match(renderer, /deriveCoreModelReadiness\(readiness, viewState\.visionReadiness\)/u);

const coreReadiness = readText("src/foundry/core-model-readiness.ts");
assert.ok(
  coreReadiness.includes('export const OFFLINE_CORE_READY_TEXT = "Offline ready · 2/2 local models";'),
  "Combined core readiness text changed.",
);

const html = readText("index.html");
for (const statusText of [
  "Layout planning · Qwen3 0.6B · GPU · checking",
  "Floor-plan vision · Qwen3.5 0.8B · CPU · checking",
]) {
  assert.ok(html.includes(statusText), `index.html is missing compact core status: ${statusText}`);
}
assert.equal(
  (html.match(/id="prepareButton"/gu) ?? []).length,
  1,
  "Core readiness must retain exactly one setup button.",
);

const commonRequiredDocText = [nodeRange, npmRange];
const testGuideRequiredText = [
  ...commonRequiredDocText,
  ...new Set(readinessMatrix.map((entry) => entry.expected)),
  "Offline ready · 2/2 local models",
];
const validatedEnvironmentNote =
  "Note: This guide was validated on Windows 11 x64 with Node.js 26.13.0 and npm 11.20.0. Other environments have not yet been validated.";
const forbiddenDocText = [
  "model or execution provider is not prepared",
  "layout model or webgpu execution provider is not prepared",
  "when they are prepared but not loaded",
  "known local state is prepared but not loaded",
];

for (const [path, requiredDocText] of [
  ["README.md", commonRequiredDocText],
  ["TEST-GUIDE.md", testGuideRequiredText],
]) {
  const normalized = readText(path).replace(/\s+/gu, " ");
  const normalizedLower = normalized.toLowerCase();
  for (const required of requiredDocText) {
    assert.ok(normalized.includes(required), `${path} is missing: ${required}`);
  }
  for (const forbidden of forbiddenDocText) {
    assert.ok(!normalizedLower.includes(forbidden), `${path} retains contradictory wording: ${forbidden}`);
  }
}

assert.ok(
  readText("TEST-GUIDE.md").includes(validatedEnvironmentNote),
  "TEST-GUIDE.md is missing the validated environment note.",
);

console.log(`Supported Node range: ${nodeRange}`);
console.log(`Validated environment: Node ${validatedNode} / npm ${validatedNpm}`);
console.table(
  nodeMatrix.map((entry) => ({
    version: entry.version,
    expected: entry.supported ? "pass" : "fail",
    actual: semver.satisfies(entry.version, nodeRange) ? "pass" : "fail",
  })),
);
console.table(
  readinessMatrix.map((entry) => ({
    state: entry.state,
    modelCached: entry.modelCached,
    executionProviderRegistered: entry.executionProviderRegistered,
    localInferenceReady: entry.localInferenceReady,
    label: runtimeButtonLabel(entry),
  })),
);
console.log("RELEASE_CONTRACT_OK");
