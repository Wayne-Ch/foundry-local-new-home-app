import { spawn } from "node:child_process";
import electronPath from "electron";

const child = spawn(electronPath, ["."], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEMO_SMOKE_AND_EXIT: "1",
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  throw new Error(`Electron smoke launch exited with code ${exitCode}.`);
}

console.log("Electron smoke launch completed.");
