import { spawn } from "node:child_process";
import electronPath from "electron";

const electronArgs = process.getuid?.() === 0 ? ["--no-sandbox", "."] : ["."];
const child = spawn(electronPath, electronArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEMO_MIC_PERMISSION_PROBE: "1",
  },
  stdio: "inherit",
});

const timeout = setTimeout(() => {
  child.kill();
}, 30_000);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
clearTimeout(timeout);

if (exitCode !== 0) {
  throw new Error(`Electron microphone permission probe exited with code ${exitCode}.`);
}

console.log("Enhanced New Home App microphone permission probe completed.");
