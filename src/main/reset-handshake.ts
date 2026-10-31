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
  const cancellation = ownership.revokeOwner(owner.webContentsId);
  let reset: Promise<T>;
  try {
    reset = resetController();
  } catch (error) {
    reset = Promise.reject(error);
  }

  const [cancellationOutcome, resetOutcome] = await Promise.allSettled([cancellation, reset]);
  if (cancellationOutcome.status === "rejected") {
    reportCancellationFailure(cancellationOutcome.reason);
  }
  if (resetOutcome.status === "fulfilled") {
    return resetOutcome.value;
  }
  if (cancellationOutcome.status === "rejected") {
    throw new AggregateError(
      [cancellationOutcome.reason, resetOutcome.reason],
      "Conversation reset failed after active audio cancellation also failed.",
    );
  }
  throw resetOutcome.reason;
}
