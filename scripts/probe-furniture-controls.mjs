import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function waitFor(description, check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(50);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError instanceof Error ? ` ${lastError.message}` : ""}`,
  );
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) {
        return;
      }
      const pending = this.pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP connection closed."));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

async function connectToBrowser(profilePath) {
  const activePortPath = path.join(profilePath, "DevToolsActivePort");
  const activePort = await waitFor("browser DevTools port", async () => {
    if (!existsSync(activePortPath)) {
      return null;
    }
    const [port] = (await readFile(activePortPath, "utf8")).split(/\r?\n/);
    return port?.trim() || null;
  });
  const page = await waitFor("browser page target", async () => {
    const response = await fetch(`http://127.0.0.1:${activePort}/json/list`);
    const targets = await response.json();
    return targets.find((target) => target.type === "page") ?? null;
  });
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const client = new CdpClient(socket);
  await Promise.all([client.send("Page.enable"), client.send("Runtime.enable")]);
  return client;
}

async function navigate(client, url, expectedInteractiveCount) {
  await client.send("Page.navigate", { url });
  await waitFor("accepted renderer scenario", async () =>
    client.evaluate(`(() => {
      return document.readyState === "complete"
        && window.location.href === ${JSON.stringify(url)}
        && document.querySelectorAll("rect[data-placement-id]").length === ${expectedInteractiveCount};
    })()`),
  );
}

async function navigateToRejectedPreview(client, url, expectedRenderedCount) {
  await client.send("Page.navigate", { url });
  await waitFor("automatic rejected preview", async () =>
    client.evaluate(`(() => {
      return document.readyState === "complete"
        && window.location.href === ${JSON.stringify(url)}
        && document.querySelector("#resultBadge")?.textContent === "Rejected preview · not accepted"
        && document.querySelectorAll("rect.furniture-placement").length === ${expectedRenderedCount}
        && document.querySelectorAll("rect[data-placement-id]").length === 0;
    })()`),
  );
}

async function snapshot(client) {
  return client.evaluate(`(() => {
    const placementElements = [...document.querySelectorAll("rect[data-placement-id]")];
    const renderedPlacementElements = [...document.querySelectorAll("rect.furniture-placement")];
    const svg = document.querySelector("#roomSvg");
    const matrix = svg?.getScreenCTM();
    return {
      activePlacementId:
        document.activeElement?.getAttribute?.("data-placement-id")
        ?? document.activeElement?.id
        ?? document.activeElement?.tagName
        ?? null,
      stateText: document.querySelector("#turnCounter")?.textContent ?? "",
      resultBadge: document.querySelector("#resultBadge")?.textContent ?? "",
      layoutTitle: document.querySelector("#layoutTitle")?.textContent ?? "",
      layoutNotice: document.querySelector("#layoutNotice")?.textContent ?? "",
      layoutViewStatus: document.querySelector("#layoutViewStatus")?.textContent ?? "",
      layoutViewActionsHidden: document.querySelector("#layoutViewActions")?.hidden ?? true,
      showAcceptedHidden: document.querySelector("#showAcceptedLayoutButton")?.hidden ?? true,
      showRejectedHidden: document.querySelector("#showRejectedLayoutButton")?.hidden ?? true,
      manualStatus: document.querySelector("#manualPlacementStatus")?.textContent ?? "",
      measurementText: document.querySelector("#measurementList")?.textContent ?? "",
      conflictText: document.querySelector("#conflictList")?.textContent ?? "",
      requirementText: document.querySelector("#requirementSummary")?.textContent ?? "",
      nextTurnText: document.querySelector("#nextTurnButton")?.textContent?.trim() ?? "",
      buyerMessages: [...document.querySelectorAll("#messages .message-user p")].map(
        (element) => element.textContent?.trim() ?? "",
      ),
      applicationMessages: [...document.querySelectorAll("#messages .message-application p")].map(
        (element) => element.textContent?.trim() ?? "",
      ),
      applyDisabled: document.querySelector("#manualApplyButton")?.disabled ?? true,
      revertDisabled: document.querySelector("#manualRevertButton")?.disabled ?? true,
      scaleX: matrix?.a ?? 0,
      placements: placementElements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-placement-id"),
          label: element.getAttribute("aria-label"),
          role: element.getAttribute("role"),
          tabindex: element.getAttribute("tabindex"),
          focusable: element.getAttribute("focusable"),
          keyshortcuts: element.getAttribute("aria-keyshortcuts"),
          xMm: Number(element.getAttribute("x")),
          yMm: Number(element.getAttribute("y")),
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      }),
      renderedPlacements: renderedPlacementElements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-rendered-placement-id"),
          layoutStatus: element.getAttribute("data-layout-status"),
          interactive: element.getAttribute("data-interactive"),
          role: element.getAttribute("role"),
          tabindex: element.getAttribute("tabindex"),
          xMm: Number(element.getAttribute("x")),
          yMm: Number(element.getAttribute("y")),
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      }),
      captureEvents: window.__placementCaptureEvents ?? [],
    };
  })()`);
}

function placement(snapshotValue, instanceId) {
  const result = snapshotValue.placements.find((candidate) => candidate.id === instanceId);
  assert.ok(result, `Missing interactive placement ${instanceId}`);
  return result;
}

function renderedPlacement(snapshotValue, instanceId) {
  const result = snapshotValue.renderedPlacements.find((candidate) => candidate.id === instanceId);
  assert.ok(result, `Missing rendered placement ${instanceId}`);
  return result;
}

async function installCaptureProbe(client) {
  await client.evaluate(`(() => {
    window.__placementCaptureEvents = [];
    const svg = document.querySelector("#roomSvg");
    if (!(svg instanceof SVGSVGElement)) {
      throw new Error("Missing room SVG");
    }
    for (const type of ["pointerdown", "gotpointercapture", "pointerup", "lostpointercapture"]) {
      svg.addEventListener(type, (event) => {
        window.__placementCaptureEvents.push({
          type,
          pointerId: event.pointerId,
          captured: svg.hasPointerCapture(event.pointerId),
        });
      });
    }
    return true;
  })()`);
}

async function dispatchMouseClick(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function clickSelector(client, selector) {
  const point = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement) || element.disabled || element.hidden) {
      return null;
    }
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(point, `Unavailable control ${selector}`);
  await dispatchMouseClick(client, point.x, point.y);
}

async function clickPlacement(client, instanceId) {
  const before = await snapshot(client);
  const target = placement(before, instanceId);
  await dispatchMouseClick(client, target.centerX, target.centerY);
  await waitFor(`${instanceId} focus`, async () => (await snapshot(client)).activePlacementId === instanceId);
}

async function dragPlacement(client, instanceId, deltaMm) {
  const before = await snapshot(client);
  const target = placement(before, instanceId);
  const deltaX = before.scaleX * deltaMm;
  assert.ok(deltaX > 0, "Invalid SVG scale");
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.centerX,
    y: target.centerY,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.centerX,
    y: target.centerY,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.centerX + deltaX,
    y: target.centerY,
    button: "left",
    buttons: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.centerX + deltaX,
    y: target.centerY,
    button: "left",
    clickCount: 1,
  });
  await waitFor(`${instanceId} drag preview`, async () => {
    const current = await snapshot(client);
    return placement(current, instanceId).xMm === target.xMm + deltaMm ? current : null;
  });
}

async function attemptRenderedDrag(client, instanceId, deltaMm) {
  const before = await snapshot(client);
  const target = renderedPlacement(before, instanceId);
  const deltaX = before.scaleX * deltaMm;
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.centerX,
    y: target.centerY,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.centerX,
    y: target.centerY,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.centerX + deltaX,
    y: target.centerY,
    button: "left",
    buttons: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.centerX + deltaX,
    y: target.centerY,
    button: "left",
    clickCount: 1,
  });
  await wait(100);
}

async function pressArrowRight(client) {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 39,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 39,
  });
}

function assertAccessiblePlacements(snapshotValue, expectedIds) {
  assert.deepEqual(
    snapshotValue.placements.map((candidate) => candidate.id),
    expectedIds,
  );
  for (const item of snapshotValue.placements) {
    assert.equal(item.role, "button");
    assert.equal(item.tabindex, "0");
    assert.equal(item.focusable, "true");
    assert.match(item.label, /draggable\. Use arrow keys for 50 millimetre adjustments\./);
    assert.equal(item.keyshortcuts, "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape");
  }
}

async function verifyAcceptedFurniture(client, baseUrl, scenario, instanceId) {
  const url = `${baseUrl}/${scenario.query}`;
  await navigate(client, url, scenario.expectedIds.length);
  await installCaptureProbe(client);
  const initial = await snapshot(client);
  assertAccessiblePlacements(initial, scenario.expectedIds);
  assert.equal(initial.nextTurnText, scenario.expectedNextTurnText);
  assert.equal(initial.buyerMessages.at(-1), scenario.expectedBuyerPrompt);
  assert.equal(initial.buyerMessages.length, initial.applicationMessages.length);
  const initialPlacement = placement(initial, instanceId);
  const initialStateText = initial.stateText;

  await dragPlacement(client, instanceId, 50);
  const pointerPreview = await snapshot(client);
  assert.equal(placement(pointerPreview, instanceId).xMm, initialPlacement.xMm + 50);
  assert.equal(pointerPreview.stateText, initialStateText);
  assert.equal(pointerPreview.applyDisabled, false);
  assert.equal(pointerPreview.revertDisabled, false);
  assert.ok(pointerPreview.captureEvents.some((event) => event.type === "gotpointercapture"));
  assert.ok(pointerPreview.captureEvents.some((event) => event.type === "lostpointercapture"));

  await clickSelector(client, "#manualRevertButton");
  await waitFor(`${instanceId} pointer Revert`, async () => {
    const current = await snapshot(client);
    return placement(current, instanceId).xMm === initialPlacement.xMm && current.revertDisabled
      ? current
      : null;
  });

  await clickPlacement(client, instanceId);
  await pressArrowRight(client);
  const keyboardPreview = await waitFor(`${instanceId} keyboard preview`, async () => {
    const current = await snapshot(client);
    return placement(current, instanceId).xMm === initialPlacement.xMm + 50 ? current : null;
  });
  assert.equal(keyboardPreview.activePlacementId, instanceId);
  assert.equal(keyboardPreview.stateText, initialStateText);
  assert.equal(keyboardPreview.applyDisabled, false);
  assert.equal(keyboardPreview.revertDisabled, false);

  await clickSelector(client, "#manualApplyButton");
  const applied = await waitFor(`${instanceId} Apply`, async () => {
    const current = await snapshot(client);
    return current.stateText !== initialStateText &&
      placement(current, instanceId).xMm === initialPlacement.xMm + 50 &&
      current.applyDisabled &&
      current.revertDisabled
      ? current
      : null;
  });
  assert.equal(applied.buyerMessages.length, initial.buyerMessages.length);
  assert.equal(applied.applicationMessages.length, initial.applicationMessages.length + 1);
  assert.match(applied.applicationMessages.at(-1), /App-owned manual placement accepted/);
  assert.equal(applied.nextTurnText, scenario.expectedNextTurnText);
}

async function verifyRejectedScenario(client, baseUrl, scenario) {
  const url = `${baseUrl}/${scenario.query}`;
  await navigateToRejectedPreview(client, url, scenario.expectedIds.length);
  await installCaptureProbe(client);
  const rejected = await snapshot(client);

  assert.equal(rejected.resultBadge, "Rejected preview · not accepted");
  assert.match(rejected.layoutTitle, /^Rejected preview/);
  assert.match(rejected.layoutNotice, /same exact rejected option and are not accepted/);
  assert.equal(rejected.layoutViewActionsHidden, false);
  assert.equal(rejected.showAcceptedHidden, false);
  assert.equal(rejected.showRejectedHidden, true);
  assert.match(rejected.layoutViewStatus, /Rejected preview is displayed and is not accepted/);
  assert.equal(rejected.placements.length, 0);
  assert.deepEqual(
    rejected.renderedPlacements.map((candidate) => candidate.id),
    scenario.expectedIds,
  );
  for (const rendered of rejected.renderedPlacements) {
    assert.equal(rendered.layoutStatus, "rejected");
    assert.equal(rendered.interactive, "false");
    assert.equal(rendered.role, null);
    assert.equal(rendered.tabindex, null);
  }
  for (const measurement of scenario.measurements) {
    assert.match(rejected.measurementText, new RegExp(measurement));
  }
  assert.match(rejected.requirementText, new RegExp(scenario.acceptedLayoutId));
  assert.match(rejected.manualStatus, /cannot be edited or applied/);
  assert.equal(rejected.applyDisabled, true);
  assert.equal(rejected.revertDisabled, true);

  const rejectedDeskOrigin = renderedPlacement(rejected, "desk-main").xMm;
  await attemptRenderedDrag(client, "desk-main", 50);
  const rejectedAfterDrag = await snapshot(client);
  assert.equal(renderedPlacement(rejectedAfterDrag, "desk-main").xMm, rejectedDeskOrigin);
  assert.equal(
    rejectedAfterDrag.captureEvents.some((event) => event.type === "gotpointercapture"),
    false,
  );

  await clickSelector(client, "#showAcceptedLayoutButton");
  const accepted = await waitFor("preserved accepted layout", async () => {
    const current = await snapshot(client);
    return current.placements.length === scenario.expectedIds.length &&
      /accepted layout preserved/.test(current.layoutTitle)
      ? current
      : null;
  });
  assertAccessiblePlacements(accepted, scenario.expectedIds);
  assert.equal(accepted.showAcceptedHidden, true);
  assert.equal(accepted.showRejectedHidden, false);
  assert.match(accepted.layoutViewStatus, /without rerunning inference/);
  assert.equal(accepted.stateText, rejected.stateText);
  assert.deepEqual(accepted.buyerMessages, rejected.buyerMessages);
  assert.deepEqual(accepted.applicationMessages, rejected.applicationMessages);

  await clickSelector(client, "#showRejectedLayoutButton");
  const restoredRejected = await waitFor("rejected preview restoration", async () => {
    const current = await snapshot(client);
    return current.resultBadge === "Rejected preview · not accepted" &&
      current.placements.length === 0 &&
      current.renderedPlacements.length === scenario.expectedIds.length
      ? current
      : null;
  });
  assert.equal(restoredRejected.stateText, rejected.stateText);
  assert.deepEqual(restoredRejected.buyerMessages, rejected.buyerMessages);
  assert.deepEqual(restoredRejected.applicationMessages, rejected.applicationMessages);
}

const browserExecutable = findBrowserExecutable();
if (!browserExecutable) {
  throw new Error("No supported headless browser found. Set BROWSER_EXECUTABLE.");
}

const server = await createServer({
  root: process.cwd(),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 0,
  },
});
const profilePath = await mkdtemp(path.join(os.tmpdir(), "new-home-standard-controls-"));
let browserProcess;
let client;

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("Vite did not expose a TCP port.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  browserProcess = spawn(
    browserExecutable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profilePath}`,
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1600,900",
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    {
      cwd: process.cwd(),
      stdio: "ignore",
    },
  );
  client = await connectToBrowser(profilePath);

  const acceptedScenarios = [
    {
      query: "?preview=1&step=queen",
      expectedIds: ["bed-main", "desk-main"],
      expectedNextTurnText: "Run next: B · King conflict",
      expectedBuyerPrompt:
        "Can a Queen-size bed and a desk fit here without blocking the closet or the door?",
    },
    {
      query: "?preview=1&step=request",
      expectedIds: ["bed-main", "desk-main", "crib-main"],
      expectedNextTurnText: "Run next: E · King controlled failure",
      expectedBuyerPrompt:
        "Can we do a Queen bed and a desk, and also add a baby bed? A compact desk is fine if needed. Keep the door, closet, and window clear, and leave the 250 mm furniture-clearance rule locked.",
    },
  ];
  for (const scenario of acceptedScenarios) {
    for (const instanceId of scenario.expectedIds) {
      await verifyAcceptedFurniture(client, baseUrl, scenario, instanceId);
    }
  }

  const rejectedScenarios = [
    {
      query: "?preview=1&step=conflict",
      acceptedLayoutId: "queen-desk-standard-v1",
      expectedIds: ["bed-main", "desk-main"],
      measurements: ["King bed ↔ Standard desk: 470 mm / required 250 mm"],
    },
    {
      query: "?preview=1&step=failure",
      acceptedLayoutId: "queen-crib-compact-v1",
      expectedIds: ["bed-main", "desk-main", "crib-main"],
      measurements: [
        "King bed ↔ Compact desk: 70 mm / required 250 mm",
        "King bed ↔ Baby bed: 170 mm / required 250 mm",
        "Compact desk ↔ Baby bed: 500 mm / required 250 mm",
      ],
    },
  ];
  for (const scenario of rejectedScenarios) {
    await verifyRejectedScenario(client, baseUrl, scenario);
  }
} finally {
  if (client !== undefined) {
    try {
      await client.send("Browser.close");
    } catch {}
  }
  if (browserProcess !== undefined) {
    await Promise.race([
      new Promise((resolve) => browserProcess.once("exit", resolve)),
      wait(5_000).then(() => browserProcess.kill()),
    ]);
  }
  await server.close();
  await waitFor(
    "browser profile cleanup",
    async () => {
      try {
        await rm(profilePath, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    },
    5_000,
  );
}

console.log(
  "New Home App furniture controls probe passed for A/C bed, desk, and baby-bed pointer + 50 mm keyboard previews, Apply/Revert, automatic B/E rejected previews, non-interactive rejected furniture, and no-inference accepted/rejected switching.",
);
