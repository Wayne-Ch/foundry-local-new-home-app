import { describe, expect, it, vi } from "vitest";
import {
  AUDIO_EXECUTION_PROVIDER,
  AUDIO_MAX_DURATION_MS,
  type AudioReadiness,
  type LiveTranscriptDraft,
  NEMOTRON_AUDIO_MODEL_ALIAS,
  NEMOTRON_AUDIO_MODEL_ID,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import {
  beginAudioModePreparation,
  isAudioPreparationActive,
  resetAfterStartingCleanup,
  SingleFlightOperation,
  submitTranscriptDraft,
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

  it.each(["nemotron_streaming", "whisper_file"] as const)(
    "marks requested %s preparation not ready before the mode switch finishes",
    (mode) => {
      expect(beginAudioModePreparation(readyAudio(), mode)).toMatchObject({
        activeMode: mode,
        localAudioReady: false,
        model: null,
        status: "checking",
      });
    },
  );

  it("transitions a final transcript to the exact edited prompt that was submitted", () => {
    const draft: LiveTranscriptDraft = {
      streamId: "11111111-1111-4111-8111-111111111111",
      sequence: 3,
      text: "Can a queen bed fit here?",
      isFinal: true,
    };

    const submitted = submitTranscriptDraft(draft, "Keep the Queen, but use the compact desk.");

    expect(submitted).toEqual({
      draft: {
        ...draft,
        text: "Keep the Queen, but use the compact desk.",
        isFinal: true,
      },
      phase: "submitted",
      notice: "Editable prompt submitted for local processing.",
    });
    expect(submitted.notice).not.toContain("not sent");
  });

  it("does not create transcript submission state for a typed-only prompt", () => {
    const draft: LiveTranscriptDraft = {
      streamId: null,
      sequence: -1,
      text: "",
      isFinal: false,
    };

    expect(submitTranscriptDraft(draft, "Typed prompt")).toEqual({
      draft,
      phase: "draft",
      notice: null,
    });
  });
});

function readyAudio(): AudioReadiness {
  return {
    sdkVersion: "2.2.1",
    provider: "Foundry Local in-process SDK",
    model: {
      alias: NEMOTRON_AUDIO_MODEL_ALIAS,
      id: NEMOTRON_AUDIO_MODEL_ID,
      deviceType: "CPU",
      executionProvider: AUDIO_EXECUTION_PROVIDER,
      fileSizeMb: 696,
      language: "en",
      inputMode: "streaming PCM ItemQueue",
    },
    preferredModelId: NEMOTRON_AUDIO_MODEL_ID,
    fallbackModelId: WHISPER_AUDIO_MODEL_ID,
    activeMode: "nemotron_streaming",
    fallbackAvailable: true,
    fallbackReason: null,
    modelCached: true,
    localAudioReady: true,
    externalEndpointUsed: false,
    maxDurationMs: AUDIO_MAX_DURATION_MS,
    inputFormat: "PCM16LE · 16 kHz · mono",
    status: "ready",
    detail: "ready",
    lastTranscriptionMs: null,
  };
}
