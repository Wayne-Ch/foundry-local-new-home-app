import { describe, expect, it, vi } from "vitest";
import { type AudioStreamOwnerIdentity, AudioStreamOwnership } from "../src/main/audio-stream-owner";
import { createResetConversationHandler, resetConversationForRenderer } from "../src/main/reset-handshake";

const owner: AudioStreamOwnerIdentity = {
  webContentsId: 1,
  processId: 10,
  frameId: 100,
  frameTreeNodeId: 1000,
  frameToken: "frame-a",
};

function v0() {
  return {
    state: {
      version: 0,
      stateRef: "layout-state-v0",
    },
  } as const;
}

describe("main reset IPC ownership handshake", () => {
  it("starts the authoritative controller reset immediately and still awaits active cancellation", async () => {
    const calls: string[] = [];
    let finishCancellation!: () => void;
    const cancellationGate = new Promise<void>((resolve) => {
      finishCancellation = resolve;
    });
    const ownership = new AudioStreamOwnership(async () => {
      calls.push("cancel-started");
      await cancellationGate;
      calls.push("cancel-finished");
    });
    const lease = ownership.begin(owner);
    await ownership.activate(lease, "stream-a");
    const resetController = vi.fn(async () => {
      calls.push("controller-reset-started");
      return v0();
    });

    const assertTrustedRenderer = vi.fn(() => ({ owner }));
    const handler = createResetConversationHandler(
      assertTrustedRenderer,
      ownership,
      resetController,
      vi.fn(),
    );
    const event = { sender: "trusted-renderer" };
    const reset = handler(event);
    await Promise.resolve();

    expect(assertTrustedRenderer).toHaveBeenCalledWith(event);
    expect(calls).toEqual(["cancel-started", "controller-reset-started"]);
    expect(resetController).toHaveBeenCalledOnce();

    finishCancellation();
    await expect(reset).resolves.toEqual(v0());
    expect(calls).toEqual(["cancel-started", "controller-reset-started", "cancel-finished"]);
  });

  it.each(["cancellation failed", "audio cancellation timed out"])(
    "continues through controller reset after %s and frees the next recording",
    async (message) => {
      const ownership = new AudioStreamOwnership(async () => {
        throw new Error(message);
      });
      const lease = ownership.begin(owner);
      await ownership.activate(lease, "stream-a");
      const reportCancellationFailure = vi.fn();
      const resetController = vi.fn(async () => v0());

      await expect(
        resetConversationForRenderer(ownership, owner, resetController, reportCancellationFailure),
      ).resolves.toEqual(v0());

      expect(reportCancellationFailure).toHaveBeenCalledOnce();
      expect(resetController).toHaveBeenCalledOnce();
      const nextLease = ownership.begin(owner);
      await expect(ownership.activate(nextLease, "stream-b")).resolves.toBe(true);
    },
  );

  it("preserves both cancellation and controller reset failures", async () => {
    const ownership = new AudioStreamOwnership(async () => {
      throw new Error("cancellation failed");
    });
    const lease = ownership.begin(owner);
    await ownership.activate(lease, "stream-a");

    await expect(
      resetConversationForRenderer(
        ownership,
        owner,
        async () => {
          throw new Error("controller reset failed");
        },
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      message: "Conversation reset failed after active audio cancellation also failed.",
      errors: [
        expect.objectContaining({ message: "cancellation failed" }),
        expect.objectContaining({ message: "controller reset failed" }),
      ],
    });
  });

  it("makes repeated reset a no-op for ownership and permits the next recording", async () => {
    const cancelStream = vi.fn(async () => {});
    const ownership = new AudioStreamOwnership(cancelStream);
    const lease = ownership.begin(owner);
    await ownership.activate(lease, "stream-a");
    const resetController = vi.fn(async () => v0());

    await resetConversationForRenderer(ownership, owner, resetController, vi.fn());
    await resetConversationForRenderer(ownership, owner, resetController, vi.fn());

    expect(cancelStream).toHaveBeenCalledOnce();
    expect(resetController).toHaveBeenCalledTimes(2);
    const nextLease = ownership.begin(owner);
    await expect(ownership.activate(nextLease, "stream-b")).resolves.toBe(true);
  });
});
