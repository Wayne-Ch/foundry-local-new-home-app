import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENHANCED_NEW_HOME_APP_ID,
  ENHANCED_NEW_HOME_FOUNDRY_APP_NAME,
  ENHANCED_NEW_HOME_PRODUCT_DIRECTORY,
  ENHANCED_NEW_HOME_PRODUCT_NAME,
  resolveEnhancedNewHomeProductPaths,
} from "../src/foundry/paths";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Enhanced New Home App product identity", () => {
  it("uses an enhanced-only product, package, and Foundry identity", () => {
    expect(ENHANCED_NEW_HOME_PRODUCT_NAME).toBe("Enhanced New Home App");
    expect(ENHANCED_NEW_HOME_APP_ID).toContain(".enhanced");
    expect(ENHANCED_NEW_HOME_FOUNDRY_APP_NAME).toBe("EnhancedNewHomeApp");
    expect(ENHANCED_NEW_HOME_PRODUCT_DIRECTORY).toBe("EnhancedNewHomeApp");
  });

  it("keeps every app-owned writable path under the enhanced-only root", () => {
    const root = path.join(os.tmpdir(), "enhanced-new-home-path-test");
    vi.stubEnv("ENHANCED_NEW_HOME_APP_DATA_DIR", root);
    vi.stubEnv("FOUNDRY_MODEL_CACHE_DIR", path.join(os.tmpdir(), "shared-foundry-model-cache"));

    const paths = resolveEnhancedNewHomeProductPaths();
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
    expect(paths.audioTempDir).toContain(ENHANCED_NEW_HOME_PRODUCT_DIRECTORY);
    expect(paths.electronTempDir).toContain(ENHANCED_NEW_HOME_PRODUCT_DIRECTORY);
    expect(paths.electronSessionDir).toContain("electron-session");
    expect(paths.modelCacheDir).not.toContain(root);
  });
});
