import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ENHANCED_NEW_HOME_PRODUCT_NAME = "Enhanced New Home App";
export const ENHANCED_NEW_HOME_APP_ID = "com.waynech.foundry-local.new-home.enhanced";
export const ENHANCED_NEW_HOME_FOUNDRY_APP_NAME = "EnhancedNewHomeApp";
export const ENHANCED_NEW_HOME_PRODUCT_DIRECTORY = "EnhancedNewHomeApp";

export interface FoundryPaths {
  readonly appDataDir: string;
  readonly logsDir: string;
  readonly modelCacheDir: string;
  readonly audioTempDir: string;
}

export interface EnhancedNewHomeProductPaths extends FoundryPaths {
  readonly productRootDir: string;
  readonly electronProfileDir: string;
  readonly electronSessionDir: string;
  readonly electronLogsDir: string;
  readonly electronTempDir: string;
  readonly crashDumpsDir: string;
}

function platformProductRootDir(): string {
  const override = process.env.ENHANCED_NEW_HOME_APP_DATA_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }

  if (process.platform === "win32") {
    const root = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
    return path.join(root, ENHANCED_NEW_HOME_PRODUCT_DIRECTORY);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", ENHANCED_NEW_HOME_PRODUCT_DIRECTORY);
  }

  const root = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
  return path.join(root, "enhanced-new-home-app");
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

export function resolveEnhancedNewHomeProductPaths(): EnhancedNewHomeProductPaths {
  const productRootDir = platformProductRootDir();
  const appDataDir = path.join(productRootDir, "foundry-app-data");
  const logsDir = path.join(productRootDir, "foundry-logs");
  const modelCacheDir = sharedModelCacheDir(appDataDir);
  const electronProfileDir = path.join(productRootDir, "electron-profile");
  const electronSessionDir = path.join(productRootDir, "electron-session");
  const electronLogsDir = path.join(productRootDir, "electron-logs");
  const electronTempDir = path.join(os.tmpdir(), ENHANCED_NEW_HOME_PRODUCT_DIRECTORY, "electron");
  const audioTempDir = path.join(os.tmpdir(), ENHANCED_NEW_HOME_PRODUCT_DIRECTORY, "audio");
  const crashDumpsDir = path.join(productRootDir, "crash-dumps");
  return {
    productRootDir,
    appDataDir,
    logsDir,
    modelCacheDir,
    audioTempDir,
    electronProfileDir,
    electronSessionDir,
    electronLogsDir,
    electronTempDir,
    crashDumpsDir,
  };
}

export async function resolveFoundryPaths(): Promise<FoundryPaths> {
  const paths = resolveEnhancedNewHomeProductPaths();
  await Promise.all([
    mkdir(paths.productRootDir, { recursive: true }),
    mkdir(paths.appDataDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.modelCacheDir, { recursive: true }),
    mkdir(paths.audioTempDir, { recursive: true }),
  ]);
  return {
    appDataDir: paths.appDataDir,
    logsDir: paths.logsDir,
    modelCacheDir: paths.modelCacheDir,
    audioTempDir: paths.audioTempDir,
  };
}
