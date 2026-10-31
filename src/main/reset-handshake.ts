import type { AudioStreamOwnerIdentity, AudioStreamOwnership } from "./audio-stream-owner";

export function createResetConversationHandler<Event, T>(
  assertTrustedRenderer: (event: Event) => {
    readonly owner: Pick<AudioStreamOwnerIdentity, "webContentsId">;
  },
  ownership: AudioStreamOwnership,
  resetController: () => Promise<T>,
  reportCancellationFailure: (error: unknown) => void,
): (event: Event) => Promise<T> {
  return (event) => {
    const renderer = assertTrustedRenderer(event);
    return resetConversationForRenderer(
      ownership,
      renderer.owner,
      resetController,
      reportCancellationFailure,
    );
  };
}

export async function resetConversationForRenderer<T>(
  ownership: AudioStreamOwnership,
  owner: Pick<AudioStreamOwnerIdentity, "webContentsId">,
  resetController: () => Promise<T>,
  reportCancellationFailure: (error: unknown) => void,
): Promise<T> {
  let cancellationFailure: unknown;
  try {
    await ownership.revokeOwner(owner.webContentsId);
  } catch (error) {
    cancellationFailure = error;
    reportCancellationFailure(error);
  }

  try {
    return await resetController();
  } catch (resetFailure) {
    if (cancellationFailure !== undefined) {
      throw new AggregateError(
        [cancellationFailure, resetFailure],
        "Conversation reset failed after active audio cancellation also failed.",
      );
    }
    throw resetFailure;
  }
}
