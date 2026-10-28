import { audioDurationMsFromPcmBytes, validateAudioCapturePayload } from "../audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MAX_PCM_BYTES,
  AUDIO_SAMPLE_RATE,
  type AudioCapturePayload,
} from "../audio/audio-types";

const MIME_TYPE_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"] as const;

export interface AudioRecorderOperation {
  readonly operationId: number;
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
  readonly chunks: Blob[];
  readonly startedAt: number;
  recordingTimerId: number | null;
  recordingLimitId: number | null;
}

export interface AudioRecorderOperationRef {
  current: AudioRecorderOperation | null;
}

interface RecorderCleanupOptions {
  readonly stopRecorder: boolean;
  readonly clearInterval: (timerId: number) => void;
  readonly clearTimeout: (timerId: number) => void;
  readonly releaseStream: (stream: MediaStream) => void;
}

export function chooseRecordingMimeType(): string | undefined {
  return MIME_TYPE_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export function releaseMediaStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

export function isCurrentRecorderOperation(
  reference: AudioRecorderOperationRef,
  operation: AudioRecorderOperation,
): boolean {
  return (
    reference.current === operation &&
    reference.current.operationId === operation.operationId &&
    reference.current.recorder === operation.recorder
  );
}

export function cleanupRecorderOperation(
  reference: AudioRecorderOperationRef,
  operation: AudioRecorderOperation,
  options: RecorderCleanupOptions,
): boolean {
  if (!isCurrentRecorderOperation(reference, operation)) {
    return false;
  }

  reference.current = null;
  if (operation.recordingTimerId !== null) {
    options.clearInterval(operation.recordingTimerId);
    operation.recordingTimerId = null;
  }
  if (operation.recordingLimitId !== null) {
    options.clearTimeout(operation.recordingLimitId);
    operation.recordingLimitId = null;
  }
  operation.chunks.length = 0;
  if (options.stopRecorder && operation.recorder.state !== "inactive") {
    try {
      operation.recorder.stop();
    } catch {
      // The recorder can race with an already queued stop event.
    }
  }
  options.releaseStream(operation.stream);
  return true;
}

export function clipPcm16ToMaxBytes(pcmBytes: Uint8Array): Uint8Array {
  return pcmBytes.byteLength <= AUDIO_MAX_PCM_BYTES ? pcmBytes : pcmBytes.subarray(0, AUDIO_MAX_PCM_BYTES);
}

export async function recordedBlobToAudioPayload(blob: Blob): Promise<AudioCapturePayload> {
  if (blob.size === 0) {
    throw new Error("The microphone recording was empty.");
  }

  const context = new AudioContext();
  try {
    const source = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: source.numberOfChannels }, (_, index) =>
      source.getChannelData(index),
    );
    const pcmBytes = clipPcm16ToMaxBytes(resampleChannelsToPcm16(channels, source.sampleRate));
    const durationMs = audioDurationMsFromPcmBytes(pcmBytes.byteLength);
    if (durationMs > AUDIO_MAX_DURATION_MS) {
      throw new Error(`Recording exceeds the ${AUDIO_MAX_DURATION_MS / 1000}-second limit.`);
    }

    const data = pcmBytes.buffer.slice(
      pcmBytes.byteOffset,
      pcmBytes.byteOffset + pcmBytes.byteLength,
    ) as ArrayBuffer;
    const payload: AudioCapturePayload = {
      format: AUDIO_FORMAT,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_CHANNELS,
      durationMs,
      data,
    };
    const validation = validateAudioCapturePayload(payload);
    if (!validation.ok) {
      throw new Error(validation.error.message);
    }
    return payload;
  } finally {
    await context.close();
  }
}

export function resampleChannelsToPcm16(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
): Uint8Array {
  if (channels.length === 0 || channels[0]?.length === 0) {
    throw new Error("Decoded audio has no samples.");
  }
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
    throw new Error("Decoded audio has an invalid sample rate.");
  }

  const sourceLength = Math.min(...channels.map((channel) => channel.length));
  const outputLength = Math.max(1, Math.round((sourceLength * AUDIO_SAMPLE_RATE) / sourceSampleRate));
  const output = new Uint8Array(outputLength * 2);
  const view = new DataView(output.buffer);
  const sourceStep = sourceSampleRate / AUDIO_SAMPLE_RATE;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = Math.min(sourceLength - 1, outputIndex * sourceStep);
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(sourceLength - 1, lowerIndex + 1);
    const fraction = sourcePosition - lowerIndex;
    let mixed = 0;
    for (const channel of channels) {
      const lower = channel[lowerIndex] ?? 0;
      const upper = channel[upperIndex] ?? lower;
      mixed += lower + (upper - lower) * fraction;
    }
    mixed /= channels.length;
    const clamped = Math.max(-1, Math.min(1, mixed));
    const sample = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    view.setInt16(outputIndex * 2, sample, true);
  }

  return output;
}
