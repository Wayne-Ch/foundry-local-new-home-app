import { spawn } from "node:child_process";
import electronPath from "electron";

const electronArgs = process.getuid?.() === 0 ? ["--no-sandbox", "."] : ["."];
const child = spawn(electronPath, electronArgs, {
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

console.log("Enhanced New Home App Electron smoke launch completed.");
