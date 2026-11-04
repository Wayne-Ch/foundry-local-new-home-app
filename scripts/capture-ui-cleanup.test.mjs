import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeCaptureProfile, runWithCaptureCleanup } from "./capture-ui-cleanup.mjs";

async function createProfile(t) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "capture-ui-cleanup-test-"));
  t.after(() => removeCaptureProfile(rootPath));
  const profilePath = path.join(rootPath, "profile", "nested");
  await mkdir(profilePath, { recursive: true });
  await writeFile(path.join(profilePath, "state.bin"), "temporary browser state");
  return path.join(rootPath, "profile");
}

test("removes the browser profile after a successful capture", async (t) => {
  const profilePath = await createProfile(t);
  const order = [];

  await runWithCaptureCleanup({
    capture: async () => order.push("capture"),
    closeBrowser: async () => order.push("browser"),
    stopServer: async () => order.push("server"),
    removeProfile: async () => {
      order.push("profile");
      await removeCaptureProfile(profilePath);
    },
  });

  assert.deepEqual(order, ["capture", "browser", "server", "profile"]);
  assert.equal(existsSync(profilePath), false);
});

test("removes the browser profile after an injected browser failure", async (t) => {
  const profilePath = await createProfile(t);
  const primaryError = new Error("injected browser failure");
  const order = [];

  await assert.rejects(
    runWithCaptureCleanup({
      capture: async () => {
        order.push("capture");
        throw primaryError;
      },
      closeBrowser: async () => order.push("browser"),
      stopServer: async () => order.push("server"),
      removeProfile: async () => {
        order.push("profile");
        await removeCaptureProfile(profilePath);
      },
    }),
    (error) => error === primaryError,
  );

  assert.deepEqual(order, ["capture", "browser", "server", "profile"]);
  assert.equal(existsSync(profilePath), false);
});

test("preserves the capture error when an earlier cleanup step also fails", async (t) => {
  const profilePath = await createProfile(t);
  const primaryError = new Error("injected capture failure");
  const browserCleanupError = new Error("injected browser cleanup failure");
  const order = [];

  await assert.rejects(
    runWithCaptureCleanup({
      capture: async () => {
        order.push("capture");
        throw primaryError;
      },
      closeBrowser: async () => {
        order.push("browser");
        throw browserCleanupError;
      },
      stopServer: async () => order.push("server"),
      removeProfile: async () => {
        order.push("profile");
        await removeCaptureProfile(profilePath);
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, primaryError);
      assert.equal(error.errors[0], primaryError);
      assert.equal(error.errors[1].cause, browserCleanupError);
      return true;
    },
  );

  assert.deepEqual(order, ["capture", "browser", "server", "profile"]);
  assert.equal(existsSync(profilePath), false);
});
