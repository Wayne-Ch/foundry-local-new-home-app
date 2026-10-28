import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractPcm16FromWav } from "../src/audio/audio-contract";
import { TempAudioStore, withTemporaryWav } from "../src/audio/temp-audio-store";

const tempRoots: string[] = [];

async function createStore(): Promise<TempAudioStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), "new-home-audio-test-"));
  tempRoots.push(root);
  return new TempAudioStore(root);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("temporary audio cleanup", () => {
  it("deletes the temporary WAV after successful transcription", async () => {
    const store = await createStore();
    const pcm = new Uint8Array([0, 0, 1, 0]);
    let capturedPath = "";
    const result = await withTemporaryWav(store, pcm, async (filePath) => {
      capturedPath = filePath;
      expect(extractPcm16FromWav(new Uint8Array(await readFile(filePath)))).toEqual(pcm);
      return "transcript";
    });
    expect(result).toBe("transcript");
    await expect(readFile(capturedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.activeCount).toBe(0);
  });

  it("deletes the temporary WAV after transcription errors", async () => {
    const store = await createStore();
    let capturedPath = "";
    await expect(
      withTemporaryWav(store, new Uint8Array([0, 0]), async (filePath) => {
        capturedPath = filePath;
        throw new Error("ASR failed");
      }),
    ).rejects.toThrow("ASR failed");
    await expect(readFile(capturedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.activeCount).toBe(0);
  });

  it("removes all tracked captures during reset cleanup", async () => {
    const store = await createStore();
    const first = await store.createWav(new Uint8Array([0, 0]));
    const second = await store.createWav(new Uint8Array([1, 0]));
    expect(store.activeCount).toBe(2);
    await store.cleanupAll();
    await expect(readFile(first)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(second)).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.activeCount).toBe(0);
  });
});
