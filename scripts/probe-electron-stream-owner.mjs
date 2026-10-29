import { spawn } from "node:child_process";
import electron from "electron";

const child = spawn(electron, ["."], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEMO_STREAM_OWNER_PROBE: "1",
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  throw new Error(`Electron stream-owner probe exited with code ${exitCode}.`);
}
