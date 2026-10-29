import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  audioDurationMsFromPcmBytes,
  extractPcm16FromWav,
  validateAudioCapturePayload,
} from "../src/audio/audio-contract";
import {
  AUDIO_CHANNELS,
  AUDIO_FORMAT,
  AUDIO_SAMPLE_RATE,
  WHISPER_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import { FoundryLayoutService } from "../src/foundry/foundry-service";
import { resolveFoundryPaths } from "../src/foundry/paths";

const expectedWords = ["queen", "size", "bed", "desk", "blocking", "closet", "door"] as const;
const fixturePath = path.resolve("tests", "fixtures", "queen-desk.wav");
const wavBytes = new Uint8Array(await readFile(fixturePath));
const pcmBytes = extractPcm16FromWav(wavBytes);
const durationMs = audioDurationMsFromPcmBytes(pcmBytes.byteLength);
const data = pcmBytes.buffer.slice(
  pcmBytes.byteOffset,
  pcmBytes.byteOffset + pcmBytes.byteLength,
) as ArrayBuffer;
const validation = validateAudioCapturePayload({
  format: AUDIO_FORMAT,
  sampleRate: AUDIO_SAMPLE_RATE,
  channels: AUDIO_CHANNELS,
  durationMs,
  data,
});
if (!validation.ok) {
  throw new Error(validation.error.message);
}

const paths = await resolveFoundryPaths();
const beforeFiles = new Set(await listCaptureFiles(paths.audioTempDir));
const service = new FoundryLayoutService();
try {
  const preparationStarted = performance.now();
  const readiness = await service.prepareAudioOffline("whisper_file", (detail) => {
    process.stdout.write(`\rAudio runtime: ${detail.padEnd(96).slice(0, 96)}`);
  });
  process.stdout.write("\n");
  const preparationMs = Math.round(performance.now() - preparationStarted);
  assert.equal(readiness.localAudioReady, true, readiness.detail);
  assert.equal(readiness.model?.id, WHISPER_AUDIO_MODEL_ID);
  assert.equal(readiness.model?.executionProvider, "CPUExecutionProvider");
  assert.equal(readiness.externalEndpointUsed, false);

  const result = await service.transcribeAudio(validation.value);
  const normalized = result.transcript.toLowerCase();
  const matchedWords = expectedWords.filter((word) => normalized.includes(word));
  const recall = matchedWords.length / expectedWords.length;
  assert.ok(
    recall >= 0.85,
    `Expected at least 85% key-word recall. Matched ${matchedWords.join(", ")} from: ${result.transcript}`,
  );
  assert.equal(result.model.id, WHISPER_AUDIO_MODEL_ID);
  assert.equal(result.externalEndpointUsed, false);
  assert.ok(result.transcriptionMs < 5000, `Transcription took ${result.transcriptionMs} ms.`);

  const afterFiles = new Set(await listCaptureFiles(paths.audioTempDir));
  assert.deepEqual(afterFiles, beforeFiles, "Temporary microphone WAV files must be deleted.");

  const report = {
    generatedAt: new Date().toISOString(),
    fixturePath,
    fixtureBytes: wavBytes.byteLength,
    audioDurationMs: durationMs,
    preparationMs,
    transcript: result.transcript,
    matchedWords,
    keyWordRecall: recall,
    transcriptionMs: result.transcriptionMs,
    model: result.model,
    externalEndpointUsed: result.externalEndpointUsed,
    tempFilesBefore: [...beforeFiles],
    tempFilesAfter: [...afterFiles],
  };
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await writeFile(
    path.resolve("artifacts", "audio-integration.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await service.shutdown();
}

async function listCaptureFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter(
      (fileName) => fileName.startsWith("capture-") && fileName.endsWith(".wav"),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
