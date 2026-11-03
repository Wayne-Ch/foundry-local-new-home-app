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

async function navigate(client, url, expectedPlacementCount) {
  await client.send("Page.navigate", { url });
  await waitFor("renderer scenario", async () =>
    client.evaluate(`(() => {
      return document.readyState === "complete"
        && window.location.href === ${JSON.stringify(url)}
        && document.querySelectorAll("rect[data-placement-id]").length === ${expectedPlacementCount};
    })()`),
  );
}

async function navigateToRejectedPreview(client, url, expectedRenderedPlacementCount) {
  await client.send("Page.navigate", { url });
  await waitFor("automatic rejected preview", async () =>
    client.evaluate(`(() => {
      return document.readyState === "complete"
        && window.location.href === ${JSON.stringify(url)}
        && document.querySelector("#resultBadge")?.textContent === "Rejected preview · not accepted"
        && document.querySelectorAll("rect.furniture-placement").length === ${expectedRenderedPlacementCount}
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
      importStatus: document.querySelector("#floorPlanImportStatus")?.textContent ?? "",
      manualStatus: document.querySelector("#manualPlacementStatus")?.textContent ?? "",
      measurementText: document.querySelector("#measurementList")?.textContent ?? "",
      measurements: [...document.querySelectorAll("#measurementList .measurement-item")].map(
        (element) => element.textContent?.trim() ?? "",
      ),
      conflictText: document.querySelector("#conflictList")?.textContent ?? "",
      requirementText: document.querySelector("#requirementSummary")?.textContent ?? "",
      messageCount: document.querySelectorAll("#messages .message").length,
      applyDisabled: document.querySelector("#manualApplyButton")?.disabled ?? true,
      revertDisabled: document.querySelector("#manualRevertButton")?.disabled ?? true,
      scaleX: matrix?.a ?? 0,
      scaleY: matrix?.d ?? 0,
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

async function clickPlacement(client, instanceId) {
  const before = await snapshot(client);
  const target = placement(before, instanceId);
  await dispatchMouseClick(client, target.centerX, target.centerY);
  await waitFor(`${instanceId} focus`, async () => (await snapshot(client)).activePlacementId === instanceId);
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
  await wait(100);
}

const arrowVirtualKeyCodes = {
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
};

async function pressArrow(client, key) {
  const virtualKeyCode = arrowVirtualKeyCodes[key];
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: key,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: key,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
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

async function verifyPointerScenario(client, baseUrl, scenario) {
  const url = `${baseUrl}/${scenario.query}`;
  await navigate(client, url, scenario.expectedIds.length);
  await installCaptureProbe(client);
  const initial = await snapshot(client);
  assertAccessiblePlacements(initial, scenario.expectedIds);
  if (scenario.roomMode === "imported") {
    assert.match(initial.importStatus, /VLM visible-topology recognition passed/);
  }

  const bedOrigin = placement(initial, "bed-main").xMm;
  const deskOrigin = placement(initial, "desk-main").xMm;
  await dragPlacement(client, "desk-main", 50);
  const deskPreview = await snapshot(client);
  assertAccessiblePlacements(deskPreview, scenario.expectedIds);
  assert.equal(placement(deskPreview, "desk-main").xMm, deskOrigin + 50, `${scenario.name} desk position`);
  assert.equal(
    deskPreview.applyDisabled,
    false,
    `${scenario.name} should produce a valid preview: ${deskPreview.manualStatus}`,
  );
  assert.equal(deskPreview.revertDisabled, false, `${scenario.name} should enable Revert`);
  assert.ok(
    deskPreview.captureEvents.some((event) => event.type === "pointerdown" && event.captured === true),
    `${scenario.name} never captured the pointer`,
  );
  assert.ok(
    deskPreview.captureEvents.some(
      (event) => event.type === "lostpointercapture" && event.captured === false,
    ),
    `${scenario.name} never released the pointer`,
  );

  if (scenario.expectedIds.includes("crib-main")) {
    const cribOrigin = placement(initial, "crib-main").xMm;
    await dragPlacement(client, "crib-main", 50);
    const cribPreview = await snapshot(client);
    assertAccessiblePlacements(cribPreview, scenario.expectedIds);
    assert.equal(placement(cribPreview, "crib-main").xMm, cribOrigin + 50);
    assert.equal(placement(cribPreview, "desk-main").xMm, deskOrigin);
  }

  await dragPlacement(client, "bed-main", 50);
  const bedPreview = await snapshot(client);
  assertAccessiblePlacements(bedPreview, scenario.expectedIds);
  assert.equal(placement(bedPreview, "bed-main").xMm, bedOrigin + 50);
  assert.equal(placement(bedPreview, "desk-main").xMm, deskOrigin);

  await clickSelector(client, "#manualRevertButton");
  await wait(100);
  const reverted = await snapshot(client);
  assert.equal(placement(reverted, "desk-main").xMm, deskOrigin, `${scenario.name} desk revert`);
  assert.equal(reverted.revertDisabled, true, `${scenario.name} Revert should disable`);
}

async function verifyRetainedFailureScenario(client, baseUrl, scenario) {
  const url = `${baseUrl}/${scenario.query}`;
  await navigateToRejectedPreview(client, url, scenario.expectedAcceptedIds.length);
  await installCaptureProbe(client);
  const rejected = await snapshot(client);

  assert.equal(rejected.importStatus.includes("VLM visible-topology recognition passed"), true);
  assert.equal(rejected.resultBadge, "Rejected preview · not accepted");
  assert.equal(rejected.layoutTitle, `Rejected preview · ${scenario.rejectedLabel}`);
  assert.match(rejected.layoutNotice, /same exact rejected option and are not accepted/);
  assert.equal(rejected.layoutViewActionsHidden, false);
  assert.equal(rejected.showAcceptedHidden, false);
  assert.equal(rejected.showRejectedHidden, true);
  assert.match(rejected.layoutViewStatus, /Rejected preview is displayed and is not accepted/);
  assert.equal(
    rejected.layoutViewStatus.includes(
      `Accepted layout preserved: ${scenario.acceptedLabel} (${scenario.acceptedLayoutId})`,
    ),
    true,
  );
  assert.equal(rejected.placements.length, 0);
  assert.deepEqual(
    rejected.renderedPlacements.map((candidate) => candidate.id),
    scenario.expectedAcceptedIds,
  );
  for (const rendered of rejected.renderedPlacements) {
    assert.equal(rendered.layoutStatus, "rejected");
    assert.equal(rendered.interactive, "false");
    assert.equal(rendered.role, null);
    assert.equal(rendered.tabindex, null);
  }
  assert.deepEqual(rejected.measurements, scenario.measurements);
  for (const conflict of scenario.conflicts) {
    assert.match(rejected.conflictText, new RegExp(conflict));
  }
  assert.match(
    rejected.requirementText,
    new RegExp(`Accepted provenance: known option · ${scenario.acceptedLayoutId}`),
  );
  assert.match(rejected.manualStatus, /cannot be edited or applied/);
  assert.equal(rejected.applyDisabled, true);
  assert.equal(rejected.revertDisabled, true);

  const rejectedDeskOrigin = renderedPlacement(rejected, "desk-main").xMm;
  await attemptRenderedDrag(client, "desk-main", 50);
  const rejectedAfterDrag = await snapshot(client);
  assert.equal(renderedPlacement(rejectedAfterDrag, "desk-main").xMm, rejectedDeskOrigin);
  assert.equal(rejectedAfterDrag.placements.length, 0);
  assert.equal(rejectedAfterDrag.applyDisabled, true);
  assert.equal(rejectedAfterDrag.revertDisabled, true);
  assert.equal(
    rejectedAfterDrag.captureEvents.some((event) => event.type === "gotpointercapture"),
    false,
  );

  await clickSelector(client, "#showAcceptedLayoutButton");
  const accepted = await waitFor("preserved accepted layout", async () => {
    const current = await snapshot(client);
    return current.placements.length === scenario.expectedAcceptedIds.length &&
      /accepted layout preserved/.test(current.layoutTitle)
      ? current
      : null;
  });
  assertAccessiblePlacements(accepted, scenario.expectedAcceptedIds);
  assert.equal(accepted.layoutViewActionsHidden, false);
  assert.equal(accepted.showAcceptedHidden, true);
  assert.equal(accepted.showRejectedHidden, false);
  assert.equal(
    accepted.layoutViewStatus.includes(
      `Accepted layout preserved: ${scenario.acceptedLabel} (${scenario.acceptedLayoutId})`,
    ),
    true,
  );
  assert.match(accepted.layoutViewStatus, /without rerunning inference/);
  assert.equal(accepted.stateText, rejected.stateText);
  assert.equal(accepted.messageCount, rejected.messageCount);
  assert.deepEqual(accepted.measurements, scenario.measurements);
  assert.match(
    accepted.requirementText,
    new RegExp(`Accepted provenance: known option · ${scenario.acceptedLayoutId}`),
  );

  const acceptedDeskOrigin = placement(accepted, "desk-main").xMm;
  await dragPlacement(client, "desk-main", 50);
  const adjustable = await snapshot(client);
  assert.equal(placement(adjustable, "desk-main").xMm, acceptedDeskOrigin + 50);
  assert.equal(adjustable.applyDisabled, false);
  assert.equal(adjustable.revertDisabled, false);
  assert.equal(adjustable.stateText, rejected.stateText);
  await clickSelector(client, "#manualRevertButton");
  await waitFor("preserved accepted layout revert", async () => {
    const current = await snapshot(client);
    return placement(current, "desk-main").xMm === acceptedDeskOrigin && current.revertDisabled
      ? current
      : null;
  });

  await clickSelector(client, "#showRejectedLayoutButton");
  const restoredRejected = await waitFor("rejected preview restoration", async () => {
    const current = await snapshot(client);
    return current.placements.length === 0 &&
      current.renderedPlacements.length === scenario.expectedAcceptedIds.length &&
      current.resultBadge === "Rejected preview · not accepted"
      ? current
      : null;
  });
  assert.equal(restoredRejected.showAcceptedHidden, false);
  assert.equal(restoredRejected.showRejectedHidden, true);
  assert.deepEqual(restoredRejected.measurements, scenario.measurements);
  assert.equal(restoredRejected.stateText, rejected.stateText);
  assert.equal(restoredRejected.messageCount, rejected.messageCount);
}

async function verifyKeyboardApplyAndRevert(client, baseUrl) {
  const url = `${baseUrl}/?preview=1&step=recovery`;
  await navigate(client, url, 3);
  const initial = await snapshot(client);
  const initialDeskX = placement(initial, "desk-main").xMm;
  const initialStateText = initial.stateText;
  const initialMeasurements = initial.measurementText;

  await clickPlacement(client, "desk-main");
  await pressArrow(client, "ArrowRight");
  const validPreview = await waitFor("keyboard preview", async () => {
    const current = await snapshot(client);
    return placement(current, "desk-main").xMm === initialDeskX + 50 ? current : null;
  });
  assert.equal(validPreview.activePlacementId, "desk-main");
  assert.equal(validPreview.stateText, initialStateText);
  assert.notEqual(validPreview.measurementText, initialMeasurements);
  assert.equal(validPreview.applyDisabled, false);
  assert.equal(validPreview.revertDisabled, false);
  assertAccessiblePlacements(validPreview, ["bed-main", "desk-main", "crib-main"]);

  await clickSelector(client, "#manualApplyButton");
  const applied = await waitFor("valid manual Apply", async () => {
    const current = await snapshot(client);
    return current.stateText !== initialStateText && current.applyDisabled && current.revertDisabled
      ? current
      : null;
  });
  assert.equal(placement(applied, "desk-main").xMm, initialDeskX + 50);

  await navigate(client, url, 3);
  const reset = await snapshot(client);
  const resetDeskX = placement(reset, "desk-main").xMm;
  const resetStateText = reset.stateText;
  await clickPlacement(client, "desk-main");
  for (let index = 0; index < 5; index += 1) {
    await pressArrow(client, "ArrowLeft");
    await waitFor(`keyboard redraw ${index + 1}`, async () => {
      const current = await snapshot(client);
      return current.activePlacementId === "desk-main" ? current : null;
    });
  }
  const invalidPreview = await snapshot(client);
  assert.equal(placement(invalidPreview, "desk-main").xMm, resetDeskX - 250);
  assert.equal(invalidPreview.activePlacementId, "desk-main");
  assert.equal(invalidPreview.stateText, resetStateText);
  assert.equal(invalidPreview.applyDisabled, true);
  assert.equal(invalidPreview.revertDisabled, false);
  assert.match(invalidPreview.manualStatus, /250 mm is required/);

  await clickSelector(client, "#manualRevertButton");
  const reverted = await waitFor("invalid preview Revert", async () => {
    const current = await snapshot(client);
    return placement(current, "desk-main").xMm === resetDeskX && current.revertDisabled ? current : null;
  });
  assert.equal(reverted.stateText, resetStateText);
  assert.equal(reverted.applyDisabled, true);
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
const profilePath = await mkdtemp(path.join(os.tmpdir(), "furniture-controls-browser-"));
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

  const scenarios = [
    {
      name: "default layout A",
      query: "?preview=1&step=queen",
      roomMode: "default",
      expectedIds: ["bed-main", "desk-main"],
    },
    {
      name: "default layout C",
      query: "?preview=1&step=recovery",
      roomMode: "default",
      expectedIds: ["bed-main", "desk-main", "crib-main"],
    },
    {
      name: "imported layout A",
      query: "?preview=1&room=imported&step=queen",
      roomMode: "imported",
      expectedIds: ["bed-main", "desk-main"],
    },
    {
      name: "imported layout C",
      query: "?preview=1&room=imported&step=recovery",
      roomMode: "imported",
      expectedIds: ["bed-main", "desk-main", "crib-main"],
    },
  ];
  for (const scenario of scenarios) {
    await verifyPointerScenario(client, baseUrl, scenario);
  }
  const retainedFailureScenarios = [
    {
      name: "imported B after A",
      query: "?preview=1&room=imported&step=conflict",
      acceptedLayoutId: "imported-queen-desk-standard-v1",
      acceptedLabel: "Imported room · Queen + rotated standard desk",
      rejectedLabel: "Imported room · King + rotated standard desk",
      expectedAcceptedIds: ["bed-main", "desk-main"],
      measurements: ["Rejected evidence · King bed ↔ Standard desk: 70 mm / required 250 mm · 180 mm short"],
      conflicts: ["King bed and Standard desk have 70 mm clearance; 250 mm is required\\."],
    },
    {
      name: "imported E after recovery C",
      query: "?preview=1&room=imported",
      acceptedLayoutId: "imported-queen-crib-compact-v1",
      acceptedLabel: "Imported room · Queen + baby bed + compact desk",
      rejectedLabel: "Imported room · King + baby bed + compact desk",
      expectedAcceptedIds: ["bed-main", "desk-main", "crib-main"],
      measurements: [
        "Rejected evidence · King bed ↔ Compact desk: 70 mm / required 250 mm · 180 mm short",
        "Rejected evidence · King bed ↔ Baby bed: 170 mm / required 250 mm · 80 mm short",
        "Rejected evidence · Compact desk ↔ Baby bed: 350 mm / required 250 mm",
      ],
      conflicts: [
        "King bed and Compact desk have 70 mm clearance; 250 mm is required\\.",
        "King bed and Baby bed have 170 mm clearance; 250 mm is required\\.",
      ],
    },
  ];
  for (const scenario of retainedFailureScenarios) {
    await verifyRetainedFailureScenario(client, baseUrl, scenario);
  }
  await verifyKeyboardApplyAndRevert(client, baseUrl);
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
  "Furniture controls probe passed for default/imported layouts A and C, automatic imported B/E rejected previews, preserved-layout banners, no-inference toggles, rejected drag blocking, accepted drag, pointer capture, keyboard focus, Apply, and invalid Revert.",
);
