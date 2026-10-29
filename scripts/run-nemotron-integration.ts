import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { audioDurationMsFromPcmBytes, extractPcm16FromWav } from "../src/audio/audio-contract";
import {
  AUDIO_STREAM_CHUNK_BYTES,
  type AudioPartialTranscriptEvent,
  NEMOTRON_AUDIO_MODEL_ID,
} from "../src/audio/audio-types";
import { FoundryLayoutService } from "../src/foundry/foundry-service";

const expectedWords = ["queen", "size", "bed", "desk", "blocking", "closet", "door"] as const;
const fixturePath = path.resolve("tests", "fixtures", "queen-desk.wav");
const pcmBytes = extractPcm16FromWav(new Uint8Array(await readFile(fixturePath)));
const service = new FoundryLayoutService();
const partials: AudioPartialTranscriptEvent[] = [];

try {
  const preparationStarted = performance.now();
  const readiness = await service.prepareAudioOffline("nemotron_streaming", (detail) => {
    process.stdout.write(`\rNemotron runtime: ${detail.padEnd(96).slice(0, 96)}`);
  });
  process.stdout.write("\n");
  const preparationMs = Math.round(performance.now() - preparationStarted);
  assert.equal(readiness.localAudioReady, true, readiness.detail);
  assert.equal(readiness.model?.id, NEMOTRON_AUDIO_MODEL_ID);
  assert.equal(readiness.activeMode, "nemotron_streaming");
  assert.equal(readiness.model?.executionProvider, "CPUExecutionProvider");

  const started = await service.startAudioStream((event) => {
    partials.push(event);
    process.stdout.write(`\rLive draft: ${event.text.slice(-72).padEnd(72)}`);
  });
  assert.equal(started.model.id, NEMOTRON_AUDIO_MODEL_ID);

  let sequence = 0;
  for (let offset = 0; offset < pcmBytes.byteLength; offset += AUDIO_STREAM_CHUNK_BYTES) {
    const chunk = pcmBytes.slice(offset, Math.min(offset + AUDIO_STREAM_CHUNK_BYTES, pcmBytes.byteLength));
    const response = service.appendAudioStreamChunk(started.streamId, sequence, chunk);
    assert.equal(response.acceptedSequence, sequence);
    sequence += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.stdout.write("\n");

  const result = await service.finishAudioStream({
    streamId: started.streamId,
    lastSequence: sequence - 1,
    audioDurationMs: audioDurationMsFromPcmBytes(pcmBytes.byteLength),
  });
  const normalized = result.transcript.toLowerCase();
  const matchedWords = expectedWords.filter((word) => normalized.includes(word));
  const recall = matchedWords.length / expectedWords.length;
  assert.ok(recall >= 0.85, `Nemotron transcript recall was ${recall}: ${result.transcript}`);
  assert.equal(result.model.id, NEMOTRON_AUDIO_MODEL_ID);
  assert.equal(result.mode, "nemotron_streaming");
  assert.equal(result.transcriptSource, "live_stream_final");
  assert.equal(result.externalEndpointUsed, false);
  assert.ok(partials.length > 1, "Expected multiple live partial transcript revisions.");
  assert.ok(
    partials.some((event, index) => index > 0 && event.text !== partials[index - 1]?.text),
    "Expected the live subtitle hypothesis to revise while audio was still streaming.",
  );
  const firstPartial = partials[0];
  assert.ok(firstPartial !== undefined, "Expected a first live partial transcript.");
  assert.ok(result.firstPartialMs !== null && result.firstPartialMs < 3000);
  assert.ok(result.finalizationMs < 2000);

  const report = {
    generatedAt: new Date().toISOString(),
    fixturePath,
    audioDurationMs: result.audioDurationMs,
    preparationMs,
    partialCount: partials.length,
    firstPartialMs: result.firstPartialMs,
    firstPartialTranscript: firstPartial.text,
    finalizationMs: result.finalizationMs,
    finalTranscript: result.transcript,
    totalStreamingMs: result.transcriptionMs,
    transcript: result.transcript,
    matchedWords,
    keyWordRecall: recall,
    model: result.model,
    mode: result.mode,
    transcriptSource: result.transcriptSource,
    externalEndpointUsed: result.externalEndpointUsed,
  };
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await writeFile(
    path.resolve("artifacts", "nemotron-integration.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await service.shutdown();
}
