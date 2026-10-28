import { writeFile } from "node:fs/promises";
import path from "node:path";
import { FoundryLocalManager } from "foundry-local-sdk";
import { resolveFoundryPaths } from "../src/foundry/paths";

const paths = await resolveFoundryPaths();
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
  const report = {
    generatedAt: new Date().toISOString(),
    sdkVersion: "2.2.1",
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    paths,
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
        executionProvider:
          model.info.runtime?.executionProvider ?? model.info.executionProvider ?? "CPUExecutionProvider",
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
