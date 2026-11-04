import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { removeCaptureProfile, runWithCaptureCleanup, stopChildProcess } from "./capture-ui-cleanup.mjs";

function findBrowserExecutable() {
  const override = process.env.BROWSER_EXECUTABLE?.trim();
  if (override) {
    return override;
  }
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ]
        : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  return candidates.find((candidate) => existsSync(candidate));
}

const browserExecutable = findBrowserExecutable();
if (!browserExecutable) {
  throw new Error("No supported headless browser found. Set BROWSER_EXECUTABLE.");
}

const screenshotPath = path.join(process.cwd(), "docs", "screenshots", "stage-ui.png");
const profilePath = path.join(os.tmpdir(), `new-home-app-standard-browser-${process.pid}`);
let browserProcess;
let server;

await runWithCaptureCleanup({
  capture: async () => {
    await Promise.all([
      mkdir(path.dirname(screenshotPath), { recursive: true }),
      mkdir(profilePath, { recursive: true }),
    ]);

    server = await createServer({
      root: process.cwd(),
      logLevel: "error",
      server: {
        host: "127.0.0.1",
        port: 4173,
        strictPort: true,
      },
    });
    await server.listen();

    browserProcess = spawn(
      browserExecutable,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--disable-background-networking",
        "--disable-sync",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1600,900",
        `--user-data-dir=${profilePath}`,
        `--screenshot=${screenshotPath}`,
        "http://localhost:4173/?preview=1",
      ],
      {
        cwd: process.cwd(),
        stdio: "inherit",
      },
    );
    const exitCode = await new Promise((resolve, reject) => {
      browserProcess.once("error", reject);
      browserProcess.once("exit", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0 || !existsSync(screenshotPath)) {
      throw new Error(`Browser screenshot capture exited with code ${exitCode}.`);
    }
  },
  closeBrowser: () => stopChildProcess(browserProcess),
  stopServer: async () => {
    await server?.close();
  },
  removeProfile: () => removeCaptureProfile(profilePath),
});

console.log(`Captured labeled visual preview: ${screenshotPath}`);
