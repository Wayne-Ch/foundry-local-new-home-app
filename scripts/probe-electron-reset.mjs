import { spawn } from "node:child_process";
import electron from "electron";

const child = spawn(electron, ["."], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEMO_RENDERER_RESET_PROBE: "1",
  },
  stdio: "inherit",
});

let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill();
}, 360_000);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
clearTimeout(timeout);

if (timedOut) {
  throw new Error("Electron renderer Reset probe timed out after 360 seconds.");
}
if (exitCode !== 0) {
  throw new Error(`Electron renderer Reset probe exited with code ${exitCode}.`);
}

console.log("Electron renderer Reset probe completed.");
