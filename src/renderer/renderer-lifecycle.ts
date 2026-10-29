import type { AudioMode, AudioReadiness, LiveTranscriptDraft } from "../audio/audio-types";

export class SingleFlightOperation {
  #operation: Promise<void> | null = null;

  get active(): boolean {
    return this.#operation !== null;
  }

  run(operation: () => Promise<void>): Promise<void> {
    if (this.#operation !== null) {
      return this.#operation;
    }

    let trackedPromise: Promise<void>;
    trackedPromise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (this.#operation === trackedPromise) {
          this.#operation = null;
        }
      });
    this.#operation = trackedPromise;
    return trackedPromise;
  }
}

export function isAudioPreparationActive(
  singleFlightActive: boolean,
  readinessStatus: AudioReadiness["status"],
): boolean {
  return singleFlightActive || readinessStatus === "checking" || readinessStatus === "loading";
}

export function beginAudioModePreparation(readiness: AudioReadiness, mode: AudioMode): AudioReadiness {
  return {
    ...readiness,
    model: null,
    activeMode: mode,
    modelCached: false,
    localAudioReady: false,
    status: "checking",
    detail: "Inspecting the local speech model.",
  };
}

export function submitTranscriptDraft(
  draft: LiveTranscriptDraft,
  submittedPrompt: string,
): {
  readonly draft: LiveTranscriptDraft;
  readonly phase: "draft" | "submitted";
  readonly notice: string | null;
} {
  if (!draft.text.trim()) {
    return { draft, phase: "draft", notice: null };
  }
  return {
    draft: {
      ...draft,
      text: submittedPrompt.trim(),
      isFinal: true,
    },
    phase: "submitted",
    notice: "Editable prompt submitted for local processing.",
  };
}

export async function resetAfterStartingCleanup<T>(
  cleanup: () => Promise<void>,
  reset: () => Promise<T>,
): Promise<T> {
  const cleanupOutcome = cleanup().then(
    () => ({ status: "fulfilled" }) as const,
    (reason: unknown) => ({ status: "rejected", reason }) as const,
  );
  const result = await reset();
  const outcome = await cleanupOutcome;
  if (outcome.status === "rejected") {
    throw outcome.reason;
  }
  return result;
}
