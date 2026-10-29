import { describe, expect, it, vi } from "vitest";
import {
  isAudioPreparationActive,
  resetAfterStartingCleanup,
  SingleFlightOperation,
} from "../src/renderer/renderer-lifecycle";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("renderer lifecycle coordination", () => {
  it("starts reset without waiting for renderer cleanup to finish", async () => {
    const cleanupGate = deferred();
    const calls: string[] = [];
    const cleanup = vi.fn(async () => {
      calls.push("cleanup-started");
      await cleanupGate.promise;
      calls.push("cleanup-finished");
    });
    const reset = vi.fn(async () => {
      calls.push("reset-started");
      return "bootstrap";
    });

    const operation = resetAfterStartingCleanup(cleanup, reset);

    expect(calls).toEqual(["cleanup-started", "reset-started"]);
    expect(reset).toHaveBeenCalledOnce();
    cleanupGate.resolve();
    await expect(operation).resolves.toBe("bootstrap");
    expect(calls).toEqual(["cleanup-started", "reset-started", "cleanup-finished"]);
  });

  it("single-flights preparation until the active operation settles", async () => {
    const gate = deferred();
    const prepareNemotron = vi.fn(async () => {
      await gate.promise;
    });
    const prepareWhisper = vi.fn(async () => {});
    const singleFlight = new SingleFlightOperation();

    const first = singleFlight.run(prepareNemotron);
    const second = singleFlight.run(prepareWhisper);

    expect(second).toBe(first);
    expect(singleFlight.active).toBe(true);
    await Promise.resolve();
    expect(prepareNemotron).toHaveBeenCalledOnce();
    expect(prepareWhisper).not.toHaveBeenCalled();

    gate.resolve();
    await first;
    expect(singleFlight.active).toBe(false);
  });

  it.each(["checking", "loading"] as const)(
    "keeps both audio mode controls blocked while readiness is %s",
    (status) => {
      expect(isAudioPreparationActive(false, status)).toBe(true);
    },
  );

  it("keeps audio mode controls blocked for the full single-flight operation", () => {
    expect(isAudioPreparationActive(true, "ready")).toBe(true);
    expect(isAudioPreparationActive(false, "ready")).toBe(false);
  });
});
