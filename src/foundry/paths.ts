import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface FoundryPaths {
  readonly appDataDir: string;
  readonly logsDir: string;
  readonly modelCacheDir: string;
  readonly audioTempDir: string;
}

function platformAppDataDir(): string {
  const override = process.env.NEW_HOME_DEMO_APP_DATA_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }

  if (process.platform === "win32") {
    const root = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
    return path.join(root, "FoundryLocalNewHomeLayoutDemo");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "FoundryLocalNewHomeLayoutDemo");
  }

  const root = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
  return path.join(root, "foundry-local-new-home-layout-demo");
}

function sharedModelCacheDir(appDataDir: string): string {
  const override = process.env.FOUNDRY_MODEL_CACHE_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }

  const foundrySharedCache = path.join(os.homedir(), ".foundry", "cache", "models");
  if (existsSync(foundrySharedCache)) {
    return foundrySharedCache;
  }

  return path.join(appDataDir, "models");
}

export async function resolveFoundryPaths(): Promise<FoundryPaths> {
  const appDataDir = platformAppDataDir();
  const logsDir = path.join(appDataDir, "logs");
  const modelCacheDir = sharedModelCacheDir(appDataDir);
  const audioTempDir = path.join(os.tmpdir(), "FoundryLocalNewHomeLayoutDemo", "audio");
  await Promise.all([
    mkdir(appDataDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
    mkdir(modelCacheDir, { recursive: true }),
    mkdir(audioTempDir, { recursive: true }),
  ]);
  return { appDataDir, logsDir, modelCacheDir, audioTempDir };
}
