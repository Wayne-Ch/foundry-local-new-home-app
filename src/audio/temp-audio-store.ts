import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodePcm16Wav } from "./audio-contract";

export class TempAudioStore {
  readonly #activePaths = new Set<string>();

  constructor(readonly rootDir: string) {}

  get activeCount(): number {
    return this.#activePaths.size;
  }

  async createWav(pcmBytes: Uint8Array): Promise<string> {
    await mkdir(this.rootDir, { recursive: true });
    const filePath = path.join(this.rootDir, `capture-${randomUUID()}.wav`);
    await writeFile(filePath, encodePcm16Wav(pcmBytes));
    this.#activePaths.add(filePath);
    return filePath;
  }

  async remove(filePath: string): Promise<void> {
    if (!this.#activePaths.has(filePath)) {
      return;
    }
    try {
      await unlink(filePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    } finally {
      this.#activePaths.delete(filePath);
    }
  }

  async cleanupAll(): Promise<void> {
    const files = [...this.#activePaths];
    await Promise.all(files.map(async (filePath) => this.remove(filePath)));
  }
}

export async function withTemporaryWav<T>(
  store: TempAudioStore,
  pcmBytes: Uint8Array,
  operation: (filePath: string) => Promise<T>,
): Promise<T> {
  const filePath = await store.createWav(pcmBytes);
  try {
    return await operation(filePath);
  } finally {
    await store.remove(filePath);
  }
}
