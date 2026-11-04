import { spawn } from "node:child_process";
import electron from "electron";

const electronArgs = process.getuid?.() === 0 ? ["--no-sandbox", "."] : ["."];
const child = spawn(electron, electronArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEMO_STREAM_OWNER_PROBE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const successMarker = "ELECTRON_STREAM_OWNER_PROBE_OK";
let output = "";
for (const [source, target] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  source.setEncoding("utf8");
  source.on("data", (chunk) => {
    target.write(chunk);
    output = `${output}${chunk}`.slice(-1_000_000);
  });
}

let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill();
}, 360_000);

const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});
clearTimeout(timeout);

if (timedOut) {
  throw new Error("Electron stream-owner probe timed out after 360 seconds.");
}
if (result.signal !== null) {
  throw new Error(`Electron stream-owner probe exited on signal ${result.signal}.`);
}
if (result.code !== 0) {
  throw new Error(`Electron stream-owner probe exited with code ${result.code ?? "null"}.`);
}
if (!output.includes(successMarker)) {
  throw new Error(`Electron stream-owner probe exited without ${successMarker}.`);
}

console.log("Enhanced New Home App stream-owner probe completed.");
