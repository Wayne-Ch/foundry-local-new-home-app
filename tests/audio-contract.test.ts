import { describe, expect, it, vi } from "vitest";
import {
  audioDurationMsFromPcmBytes,
  createTranscriptDraftUpdate,
  encodePcm16Wav,
  extractPcm16FromWav,
  reduceAudioRecorderState,
  validateAudioCapturePayload,
} from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MAX_PCM_BYTES,
  AUDIO_SAMPLE_RATE,
  type AudioCapturePayload,
  type AudioRecorderState,
} from "../src/audio/audio-types";
import {
  type AudioRecorderOperation,
  type AudioRecorderOperationRef,
  cleanupRecorderOperation,
  clipPcm16ToMaxBytes,
  releaseMediaStream,
  resampleChannelsToPcm16,
} from "../src/renderer/audio-capture";

function validPayload(durationMs = 1000): AudioCapturePayload {
  return {
    format: AUDIO_FORMAT,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    durationMs,
    data: new ArrayBuffer((AUDIO_SAMPLE_RATE * durationMs * 2) / 1000),
  };
}

describe("audio IPC validation", () => {
  it("accepts bounded PCM16LE 16 kHz mono input", () => {
    const result = validateAudioCapturePayload(validPayload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pcmBytes.byteLength).toBe(32_000);
      expect(result.value.durationMs).toBe(1000);
    }
  });

  it.each([
    [{ ...validPayload(), format: "wav" }, "UNSUPPORTED_FORMAT"],
    [{ ...validPayload(), sampleRate: 48_000 }, "UNSUPPORTED_SAMPLE_RATE"],
    [{ ...validPayload(), channels: 2 }, "UNSUPPORTED_CHANNEL_COUNT"],
    [{ ...validPayload(), durationMs: 100 }, "DURATION_OUT_OF_RANGE"],
    [
      {
        ...validPayload(AUDIO_MAX_DURATION_MS),
        data: new ArrayBuffer(640_002),
      },
      "PAYLOAD_TOO_LARGE",
    ],
    [{ ...validPayload(), data: new ArrayBuffer(31_000) }, "DURATION_SIZE_MISMATCH"],
  ])("rejects invalid bounded payload %#", (payload, code) => {
    expect(validateAudioCapturePayload(payload)).toMatchObject({
      ok: false,
      error: { code },
    });
  });
});

describe("PCM and WAV conversion", () => {
  it("round-trips PCM bytes through the temporary WAV container", () => {
    const pcm = new Uint8Array([0, 0, 255, 127, 0, 128, 1, 0]);
    const wav = encodePcm16Wav(pcm);
    expect(extractPcm16FromWav(wav)).toEqual(pcm);
    expect(audioDurationMsFromPcmBytes(32_000)).toBe(1000);
  });

  it("downmixes and resamples browser channels to 16 kHz PCM16", () => {
    const left = new Float32Array(48_000).fill(0.5);
    const right = new Float32Array(48_000).fill(-0.5);
    const pcm = resampleChannelsToPcm16([left, right], 48_000);
    expect(pcm.byteLength).toBe(32_000);
    expect(new DataView(pcm.buffer).getInt16(0, true)).toBe(0);
  });

  it("clips codec padding beyond the maximum PCM duration", () => {
    const padded = new Uint8Array(AUDIO_MAX_PCM_BYTES + 3_200);
    padded[AUDIO_MAX_PCM_BYTES - 1] = 123;
    padded[AUDIO_MAX_PCM_BYTES] = 231;

    const clipped = clipPcm16ToMaxBytes(padded);

    expect(clipped.byteLength).toBe(AUDIO_MAX_PCM_BYTES);
    expect(clipped.at(-1)).toBe(123);
    expect(audioDurationMsFromPcmBytes(clipped.byteLength)).toBe(AUDIO_MAX_DURATION_MS);
  });
});

describe("audio recorder state and draft behavior", () => {
  it("moves through permission, recording, transcription, and completion", () => {
    let state: AudioRecorderState = { status: "idle", elapsedMs: 0, detail: "" };
    state = reduceAudioRecorderState(state, { type: "REQUEST_PERMISSION" });
    expect(state.status).toBe("requesting_permission");
    state = reduceAudioRecorderState(state, { type: "START" });
    state = reduceAudioRecorderState(state, { type: "TICK", elapsedMs: 1250 });
    expect(state).toMatchObject({ status: "recording", elapsedMs: 1250 });
    state = reduceAudioRecorderState(state, { type: "TRANSCRIBE" });
    expect(state.status).toBe("transcribing");
    state = reduceAudioRecorderState(state, { type: "COMPLETE" });
    expect(state).toEqual({ status: "idle", elapsedMs: 0, detail: "" });
  });

  it("creates an editable transcript draft and never auto-submits", () => {
    expect(createTranscriptDraftUpdate("", "  Can a queen bed fit?  ")).toEqual({
      value: "Can a queen bed fit?",
      shouldSubmit: false,
    });
    expect(createTranscriptDraftUpdate("Keep this.", "Add a desk.")).toEqual({
      value: "Keep this. Add a desk.",
      shouldSubmit: false,
    });
  });

  it("stops every microphone track during cleanup", () => {
    const stopOne = vi.fn();
    const stopTwo = vi.fn();
    releaseMediaStream({
      getTracks: () => [{ stop: stopOne }, { stop: stopTwo }],
    } as unknown as MediaStream);
    expect(stopOne).toHaveBeenCalledOnce();
    expect(stopTwo).toHaveBeenCalledOnce();
  });

  it("ignores stale recorder cleanup without touching the newer capture", () => {
    const oldRecorder = { state: "recording", stop: vi.fn() } as unknown as MediaRecorder;
    const newRecorder = { state: "recording", stop: vi.fn() } as unknown as MediaRecorder;
    const oldOperation = {
      operationId: 1,
      lifecycleGeneration: 0,
      recorder: oldRecorder,
      stream: {} as MediaStream,
      chunks: [new Blob(["old"])],
      startedAt: 0,
      recordingTimerId: 10,
      recordingLimitId: 11,
    } satisfies AudioRecorderOperation;
    const newOperation = {
      operationId: 2,
      lifecycleGeneration: 0,
      recorder: newRecorder,
      stream: {} as MediaStream,
      chunks: [new Blob(["new"])],
      startedAt: 0,
      recordingTimerId: 20,
      recordingLimitId: 21,
    } satisfies AudioRecorderOperation;
    const reference: AudioRecorderOperationRef = { current: newOperation };
    const clearInterval = vi.fn();
    const clearTimeout = vi.fn();
    const releaseStream = vi.fn();

    expect(
      cleanupRecorderOperation(reference, oldOperation, {
        stopRecorder: true,
        clearInterval,
        clearTimeout,
        releaseStream,
      }),
    ).toBe(false);
    expect(reference.current).toBe(newOperation);
    expect(newOperation.chunks).toHaveLength(1);
    expect(clearInterval).not.toHaveBeenCalled();
    expect(clearTimeout).not.toHaveBeenCalled();
    expect(releaseStream).not.toHaveBeenCalled();
    expect(newRecorder.stop).not.toHaveBeenCalled();

    expect(
      cleanupRecorderOperation(reference, newOperation, {
        stopRecorder: true,
        clearInterval,
        clearTimeout,
        releaseStream,
      }),
    ).toBe(true);
    expect(reference.current).toBeNull();
    expect(newOperation.chunks).toHaveLength(0);
    expect(clearInterval).toHaveBeenCalledWith(20);
    expect(clearTimeout).toHaveBeenCalledWith(21);
    expect(releaseStream).toHaveBeenCalledWith(newOperation.stream);
    expect(newRecorder.stop).toHaveBeenCalledOnce();
  });
});
