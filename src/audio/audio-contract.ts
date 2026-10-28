import {
  AUDIO_BYTES_PER_SAMPLE,
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MAX_PCM_BYTES,
  AUDIO_MIN_DURATION_MS,
  AUDIO_SAMPLE_RATE,
  type AudioCapturePayload,
  type AudioCaptureValidationResult,
  type AudioRecorderEvent,
  type AudioRecorderState,
  type TranscriptDraftUpdate,
} from "./audio-types";

const PCM_DURATION_TOLERANCE_BYTES = 64;

export function validateAudioCapturePayload(input: unknown): AudioCaptureValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return failure("INVALID_PAYLOAD", "Audio payload must be an object.");
  }

  const candidate = input as Partial<AudioCapturePayload>;
  if (candidate.format !== AUDIO_FORMAT) {
    return failure("UNSUPPORTED_FORMAT", `Expected ${AUDIO_FORMAT}.`);
  }
  if (candidate.sampleRate !== AUDIO_SAMPLE_RATE) {
    return failure("UNSUPPORTED_SAMPLE_RATE", `Expected ${AUDIO_SAMPLE_RATE} Hz.`);
  }
  if (candidate.channels !== AUDIO_CHANNELS) {
    return failure("UNSUPPORTED_CHANNEL_COUNT", "Expected mono audio.");
  }
  if (
    !Number.isInteger(candidate.durationMs) ||
    (candidate.durationMs ?? 0) < AUDIO_MIN_DURATION_MS ||
    (candidate.durationMs ?? 0) > AUDIO_MAX_DURATION_MS
  ) {
    return failure(
      "DURATION_OUT_OF_RANGE",
      `Audio duration must be ${AUDIO_MIN_DURATION_MS}-${AUDIO_MAX_DURATION_MS} ms.`,
    );
  }
  if (!(candidate.data instanceof ArrayBuffer)) {
    return failure("INVALID_PAYLOAD", "Audio data must be an ArrayBuffer.");
  }
  if (candidate.data.byteLength === 0 || candidate.data.byteLength % AUDIO_BYTES_PER_SAMPLE !== 0) {
    return failure("INVALID_PCM_LENGTH", "PCM payload must contain complete 16-bit samples.");
  }
  if (candidate.data.byteLength > AUDIO_MAX_PCM_BYTES) {
    return failure("PAYLOAD_TOO_LARGE", `PCM payload exceeds ${AUDIO_MAX_PCM_BYTES} bytes.`);
  }

  const expectedBytes = Math.round(
    ((candidate.durationMs ?? 0) / 1000) * AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE,
  );
  if (Math.abs(candidate.data.byteLength - expectedBytes) > PCM_DURATION_TOLERANCE_BYTES) {
    return failure(
      "DURATION_SIZE_MISMATCH",
      `PCM byte length ${candidate.data.byteLength} does not match ${candidate.durationMs} ms.`,
    );
  }

  return {
    ok: true,
    value: {
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs: candidate.durationMs ?? 0,
      pcmBytes: new Uint8Array(candidate.data),
    },
  };
}

export function encodePcm16Wav(pcmBytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(44 + pcmBytes.byteLength);
  const view = new DataView(output.buffer);

  writeAscii(output, 0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(output, 8, "WAVE");
  writeAscii(output, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, AUDIO_CHANNELS, true);
  view.setUint32(24, AUDIO_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE, true);
  view.setUint16(32, AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE, true);
  view.setUint16(34, AUDIO_BYTES_PER_SAMPLE * 8, true);
  writeAscii(output, 36, "data");
  view.setUint32(40, pcmBytes.byteLength, true);
  output.set(pcmBytes, 44);
  return output;
}

export function extractPcm16FromWav(wavBytes: Uint8Array): Uint8Array {
  if (wavBytes.byteLength < 44) {
    throw new Error("WAV file is too small.");
  }
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  if (readAscii(wavBytes, 0, 4) !== "RIFF" || readAscii(wavBytes, 8, 4) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE file.");
  }

  let offset = 12;
  let format:
    | {
        readonly audioFormat: number;
        readonly channels: number;
        readonly sampleRate: number;
        readonly bitsPerSample: number;
      }
    | undefined;
  let data: Uint8Array | undefined;

  while (offset + 8 <= wavBytes.byteLength) {
    const chunkId = readAscii(wavBytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > wavBytes.byteLength) {
      throw new Error(`WAV chunk ${chunkId} exceeds the file length.`);
    }

    if (chunkId === "fmt ") {
      format = {
        audioFormat: view.getUint16(chunkStart, true),
        channels: view.getUint16(chunkStart + 2, true),
        sampleRate: view.getUint32(chunkStart + 4, true),
        bitsPerSample: view.getUint16(chunkStart + 14, true),
      };
    } else if (chunkId === "data") {
      data = wavBytes.slice(chunkStart, chunkStart + chunkSize);
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (format === undefined || data === undefined) {
    throw new Error("WAV file is missing fmt or data chunks.");
  }
  if (
    format.audioFormat !== 1 ||
    format.channels !== AUDIO_CHANNELS ||
    format.sampleRate !== AUDIO_SAMPLE_RATE ||
    format.bitsPerSample !== AUDIO_BYTES_PER_SAMPLE * 8
  ) {
    throw new Error(`Expected PCM16LE ${AUDIO_SAMPLE_RATE} Hz mono WAV, received ${JSON.stringify(format)}.`);
  }
  return data;
}

export function audioDurationMsFromPcmBytes(byteLength: number): number {
  return Math.round((byteLength / (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE)) * 1000);
}

export function reduceAudioRecorderState(
  state: AudioRecorderState,
  event: AudioRecorderEvent,
): AudioRecorderState {
  switch (event.type) {
    case "REQUEST_PERMISSION":
      return { status: "requesting_permission", elapsedMs: 0, detail: "Requesting microphone access." };
    case "START":
      if (state.status !== "requesting_permission" && state.status !== "idle") {
        return state;
      }
      return { status: "recording", elapsedMs: 0, detail: "Recording locally." };
    case "TICK":
      return state.status === "recording" ? { ...state, elapsedMs: event.elapsedMs } : state;
    case "TRANSCRIBE":
      return state.status === "recording"
        ? { status: "transcribing", elapsedMs: state.elapsedMs, detail: "Transcribing locally." }
        : state;
    case "COMPLETE":
    case "RESET":
      return { status: "idle", elapsedMs: 0, detail: "" };
    case "FAIL":
      return { status: "error", elapsedMs: state.elapsedMs, detail: event.detail };
  }
}

export function createTranscriptDraftUpdate(currentValue: string, transcript: string): TranscriptDraftUpdate {
  const normalizedTranscript = transcript.trim().replaceAll(/\s+/g, " ");
  const existing = currentValue.trim();
  return {
    value: existing ? `${existing} ${normalizedTranscript}` : normalizedTranscript,
    shouldSubmit: false,
  };
}

function failure(code: Parameters<typeof createFailure>[0], message: string): AudioCaptureValidationResult {
  return createFailure(code, message);
}

function createFailure(
  code:
    | "INVALID_PAYLOAD"
    | "UNSUPPORTED_FORMAT"
    | "UNSUPPORTED_SAMPLE_RATE"
    | "UNSUPPORTED_CHANNEL_COUNT"
    | "DURATION_OUT_OF_RANGE"
    | "PAYLOAD_TOO_LARGE"
    | "INVALID_PCM_LENGTH"
    | "DURATION_SIZE_MISMATCH",
  message: string,
): AudioCaptureValidationResult {
  return { ok: false, error: { code, message } };
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function readAscii(source: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...source.subarray(offset, offset + length));
}
