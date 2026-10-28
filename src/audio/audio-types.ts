export const AUDIO_MODEL_ID = "openai-whisper-tiny-generic-cpu:4";
export const AUDIO_MODEL_ALIAS = "whisper-tiny";
export const AUDIO_EXECUTION_PROVIDER = "CPUExecutionProvider";
export const AUDIO_LANGUAGE = "en";
export const AUDIO_FORMAT = "pcm_s16le";
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_BYTES_PER_SAMPLE = 2;
export const AUDIO_MIN_DURATION_MS = 300;
export const AUDIO_MAX_DURATION_MS = 20_000;
export const AUDIO_MAX_PCM_BYTES =
  (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE * AUDIO_MAX_DURATION_MS) / 1000;

export interface AudioModelIdentity {
  readonly alias: string;
  readonly id: string;
  readonly deviceType: string;
  readonly executionProvider: string;
  readonly fileSizeMb: number | null;
  readonly language: typeof AUDIO_LANGUAGE;
  readonly inputMode: "temporary PCM WAV file URI";
}

export interface AudioReadiness {
  readonly sdkVersion: "2.2.1";
  readonly provider: "Foundry Local in-process SDK";
  readonly model: AudioModelIdentity | null;
  readonly modelCached: boolean;
  readonly localAudioReady: boolean;
  readonly externalEndpointUsed: false;
  readonly maxDurationMs: typeof AUDIO_MAX_DURATION_MS;
  readonly inputFormat: "PCM16LE · 16 kHz · mono";
  readonly status:
    | "not_initialized"
    | "checking"
    | "preparation_required"
    | "loading"
    | "ready"
    | "transcribing"
    | "model_unavailable"
    | "error";
  readonly detail: string;
  readonly lastTranscriptionMs: number | null;
}

export interface AudioCapturePayload {
  readonly format: typeof AUDIO_FORMAT;
  readonly sampleRate: typeof AUDIO_SAMPLE_RATE;
  readonly channels: typeof AUDIO_CHANNELS;
  readonly durationMs: number;
  readonly data: ArrayBuffer;
}

export interface ValidatedAudioCapture {
  readonly format: typeof AUDIO_FORMAT;
  readonly sampleRate: typeof AUDIO_SAMPLE_RATE;
  readonly channels: typeof AUDIO_CHANNELS;
  readonly durationMs: number;
  readonly pcmBytes: Uint8Array;
}

export interface AudioTranscriptionResult {
  readonly transcript: string;
  readonly transcriptionMs: number;
  readonly audioDurationMs: number;
  readonly model: AudioModelIdentity;
  readonly externalEndpointUsed: false;
}

export type AudioCaptureValidationErrorCode =
  | "INVALID_PAYLOAD"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_SAMPLE_RATE"
  | "UNSUPPORTED_CHANNEL_COUNT"
  | "DURATION_OUT_OF_RANGE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_PCM_LENGTH"
  | "DURATION_SIZE_MISMATCH";

export interface AudioCaptureValidationError {
  readonly code: AudioCaptureValidationErrorCode;
  readonly message: string;
}

export type AudioCaptureValidationResult =
  | { readonly ok: true; readonly value: ValidatedAudioCapture }
  | { readonly ok: false; readonly error: AudioCaptureValidationError };

export type AudioRecorderStatus = "idle" | "requesting_permission" | "recording" | "transcribing" | "error";

export interface AudioRecorderState {
  readonly status: AudioRecorderStatus;
  readonly elapsedMs: number;
  readonly detail: string;
}

export type AudioRecorderEvent =
  | { readonly type: "REQUEST_PERMISSION" }
  | { readonly type: "START" }
  | { readonly type: "TICK"; readonly elapsedMs: number }
  | { readonly type: "TRANSCRIBE" }
  | { readonly type: "COMPLETE" }
  | { readonly type: "FAIL"; readonly detail: string }
  | { readonly type: "RESET" };

export interface TranscriptDraftUpdate {
  readonly value: string;
  readonly shouldSubmit: false;
}
