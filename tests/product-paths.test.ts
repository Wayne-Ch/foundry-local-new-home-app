import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEW_HOME_APP_ID,
  NEW_HOME_FOUNDRY_APP_NAME,
  NEW_HOME_PRODUCT_DIRECTORY,
  NEW_HOME_PRODUCT_NAME,
  resolveNewHomeProductPaths,
} from "../src/foundry/paths";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("New Home App product identity", () => {
  it("uses a standard-only product, package, and Foundry identity", () => {
    expect(NEW_HOME_PRODUCT_NAME).toBe("New Home App");
    expect(NEW_HOME_APP_ID).toContain(".standard");
    expect(NEW_HOME_FOUNDRY_APP_NAME).toBe("FoundryLocalNewHomeAppStandard");
    expect(NEW_HOME_PRODUCT_DIRECTORY).not.toContain("LayoutDemo");
  });

  it("keeps every app-owned writable path under the standard-only root", () => {
    const root = path.join(os.tmpdir(), "new-home-standard-path-test");
    vi.stubEnv("NEW_HOME_STANDARD_APP_DATA_DIR", root);
    vi.stubEnv("FOUNDRY_MODEL_CACHE_DIR", path.join(os.tmpdir(), "shared-foundry-model-cache"));

    const paths = resolveNewHomeProductPaths();
    const ownedPaths = [
      paths.appDataDir,
      paths.logsDir,
      paths.electronProfileDir,
      paths.electronSessionDir,
      paths.electronLogsDir,
      paths.crashDumpsDir,
    ];

    expect(paths.productRootDir).toBe(root);
    expect(new Set(ownedPaths).size).toBe(ownedPaths.length);
    for (const ownedPath of ownedPaths) {
      expect(ownedPath.startsWith(root)).toBe(true);
      expect(ownedPath).not.toContain("LayoutDemo");
    }
    expect(paths.audioTempDir).toContain(NEW_HOME_PRODUCT_DIRECTORY);
    expect(paths.electronTempDir).toContain(NEW_HOME_PRODUCT_DIRECTORY);
    expect(paths.electronSessionDir).toContain("electron-session");
    expect(paths.modelCacheDir).not.toContain(root);
  });
});
