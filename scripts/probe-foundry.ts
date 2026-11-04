import { writeFile } from "node:fs/promises";
import path from "node:path";
import { FoundryLocalManager } from "foundry-local-sdk";
import { resolveFoundryPaths } from "../src/foundry/paths";
import { canonicalExecutionProvider, resolveRuntimeTarget } from "../src/foundry/runtime-config";

const paths = await resolveFoundryPaths();
const target = resolveRuntimeTarget();
const manager = FoundryLocalManager.create({
  appName: "FoundryLocalNewHomeLayoutProbe",
  appDataDir: paths.appDataDir,
  modelCacheDir: paths.modelCacheDir,
  logsDir: paths.logsDir,
  logLevel: "warn",
  disableNonessentialTelemetry: true,
});

try {
  const cachedModels = await manager.catalog.getCachedModels();
  const configuredModel = await manager.catalog
    .getModelVariant(target.modelId)
    .then((model) => ({
      alias: model.alias,
      id: model.id,
      cached: model.isCached,
      supportsToolCalling: model.supportsToolCalling,
      task: model.info.task,
      deviceType: model.info.runtime?.deviceType ?? model.info.deviceType,
      executionProvider: canonicalExecutionProvider(
        model.info.runtime?.executionProvider ?? model.info.executionProvider ?? "CPUExecutionProvider",
      ),
      fileSizeMb: model.info.fileSizeMb ?? null,
    }))
    .catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  const report = {
    generatedAt: new Date().toISOString(),
    sdkVersion: "2.2.1",
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    paths,
    target,
    configuredModel,
    executionProviders: manager.discoverEps(),
    candidateModels: cachedModels
      .filter(
        (model) =>
          model.supportsToolCalling === true &&
          ["chat-completion", "coding"].includes(model.info.task?.toLowerCase() ?? ""),
      )
      .map((model) => ({
        alias: model.alias,
        id: model.id,
        cached: model.isCached,
        supportsToolCalling: model.supportsToolCalling,
        task: model.info.task,
        deviceType: model.info.runtime?.deviceType ?? model.info.deviceType,
        executionProvider: canonicalExecutionProvider(
          model.info.runtime?.executionProvider ?? model.info.executionProvider ?? "CPUExecutionProvider",
        ),
        fileSizeMb: model.info.fileSizeMb ?? null,
        license: model.info.license ?? null,
      }))
      .sort(
        (left, right) =>
          (left.fileSizeMb ?? Number.MAX_SAFE_INTEGER) - (right.fileSizeMb ?? Number.MAX_SAFE_INTEGER),
      ),
  };

  await writeFile(
    path.join(process.cwd(), "artifacts", "foundry-probe.json"),
    JSON.stringify(report, null, 2),
    { encoding: "utf8", flag: "w" },
  ).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
    await writeFile(
      path.join(process.cwd(), "artifacts", "foundry-probe.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  manager.dispose();
}
