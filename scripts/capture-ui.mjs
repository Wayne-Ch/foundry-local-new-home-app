import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";

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
const profilePath = path.join(os.tmpdir(), `new-home-layout-browser-${process.pid}`);
await Promise.all([
  mkdir(path.dirname(screenshotPath), { recursive: true }),
  mkdir(profilePath, { recursive: true }),
]);

const server = await createServer({
  root: process.cwd(),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 0,
  },
});
await server.listen();

try {
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("Vite did not expose a TCP port.");
  }
  const child = spawn(
    browserExecutable,
    [
      "--headless=new",
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "--disable-gpu",
      "--hide-scrollbars",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1600,900",
      `--user-data-dir=${profilePath}`,
      `--screenshot=${screenshotPath}`,
      `http://127.0.0.1:${address.port}/?preview=1`,
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0 || !existsSync(screenshotPath)) {
    throw new Error(`Browser screenshot capture exited with code ${exitCode}.`);
  }
} finally {
  await server.close();
}

console.log(`Captured labeled visual preview: ${screenshotPath}`);
