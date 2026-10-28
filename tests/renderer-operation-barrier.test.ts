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

  it("releases the UI after reset rejection without revalidating stale work", () => {
    const barrier = new RendererOperationBarrier();
    const staleGeneration = barrier.beginOperation();
    const resetGeneration = barrier.beginReset();

    expect(barrier.finishReset(resetGeneration)).toBe(true);

    expect(barrier.resetInFlight).toBe(false);
    expect(barrier.isCurrentOperation(staleGeneration)).toBe(false);
    expect(barrier.isCurrentOperation(barrier.beginOperation())).toBe(true);
  });
});
