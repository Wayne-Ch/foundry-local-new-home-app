import { describe, expect, it } from "vitest";
import { RendererOperationBarrier } from "../src/renderer/operation-barrier";

describe("renderer reset operation barrier", () => {
  it("invalidates an in-flight recording before reset cleanup begins", () => {
    const barrier = new RendererOperationBarrier();
    const recordingGeneration = barrier.beginOperation();

    const resetGeneration = barrier.beginReset();

    expect(barrier.resetInFlight).toBe(true);
    expect(barrier.isCurrentOperation(recordingGeneration)).toBe(false);
    expect(barrier.isCurrentReset(resetGeneration)).toBe(true);
  });

  it("prevents a stale layout turn from overwriting the reset state", () => {
    const barrier = new RendererOperationBarrier();
    const turnGeneration = barrier.beginOperation();
    const resetGeneration = barrier.beginReset();
    expect(barrier.finishReset(resetGeneration)).toBe(true);

    expect(barrier.isCurrentOperation(turnGeneration)).toBe(false);
    const nextGeneration = barrier.beginOperation();
    expect(barrier.isCurrentOperation(nextGeneration)).toBe(true);
  });

  it("keeps controls blocked after reset rejection without revalidating stale work", () => {
    const barrier = new RendererOperationBarrier();
    const staleGeneration = barrier.beginOperation();
    const resetGeneration = barrier.beginReset();

    expect(barrier.failReset(resetGeneration)).toBe(true);

    expect(barrier.resetInFlight).toBe(false);
    expect(barrier.resetQuarantined).toBe(true);
    expect(barrier.operationsBlocked).toBe(true);
    expect(barrier.isCurrentOperation(staleGeneration)).toBe(false);
    expect(barrier.isCurrentOperation(barrier.beginOperation())).toBe(false);
  });

  it("allows explicit reset recovery while quarantined and releases controls only after success", () => {
    const barrier = new RendererOperationBarrier();
    const failedReset = barrier.beginReset();
    expect(barrier.failReset(failedReset)).toBe(true);

    const recoveryReset = barrier.beginReset();
    expect(barrier.resetInFlight).toBe(true);
    expect(barrier.operationsBlocked).toBe(true);
    expect(barrier.finishReset(recoveryReset)).toBe(true);

    expect(barrier.resetQuarantined).toBe(false);
    expect(barrier.operationsBlocked).toBe(false);
    expect(barrier.isCurrentOperation(barrier.beginOperation())).toBe(true);
  });

  it("releases automatic quarantine with a fresh generation after runtime recovery", () => {
    const barrier = new RendererOperationBarrier();
    const failedReset = barrier.beginReset();
    const quarantinedGeneration = barrier.beginOperation();
    expect(barrier.failReset(failedReset)).toBe(true);

    expect(barrier.releaseResetQuarantine()).toBe(true);
    expect(barrier.isCurrentOperation(quarantinedGeneration)).toBe(false);
    expect(barrier.isCurrentOperation(barrier.beginOperation())).toBe(true);
  });
});
