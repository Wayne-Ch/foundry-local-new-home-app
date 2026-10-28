import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodePcm16Wav } from "./audio-contract";

export interface TempAudioStoreOptions {
  readonly createId?: () => string;
  readonly ensureDirectory?: (directory: string) => Promise<void>;
  readonly write?: (filePath: string, data: Uint8Array) => Promise<void>;
  readonly remove?: (filePath: string) => Promise<void>;
}

export class TempAudioStore {
  readonly #activePaths = new Set<string>();
  readonly #createId: () => string;
  readonly #ensureDirectory: (directory: string) => Promise<void>;
  readonly #write: (filePath: string, data: Uint8Array) => Promise<void>;
  readonly #remove: (filePath: string) => Promise<void>;

  constructor(
    readonly rootDir: string,
    options: TempAudioStoreOptions = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
    this.#ensureDirectory =
      options.ensureDirectory ??
      (async (directory) => {
        await mkdir(directory, { recursive: true });
      });
    this.#write =
      options.write ??
      (async (filePath, data) => {
        await writeFile(filePath, data);
      });
    this.#remove = options.remove ?? unlink;
  }

  get activeCount(): number {
    return this.#activePaths.size;
  }

  async createWav(pcmBytes: Uint8Array): Promise<string> {
    await this.#ensureDirectory(this.rootDir);
    const filePath = path.join(this.rootDir, `capture-${this.#createId()}.wav`);
    this.#activePaths.add(filePath);
    try {
      await this.#write(filePath, encodePcm16Wav(pcmBytes));
      return filePath;
    } catch (writeError) {
      try {
        await this.remove(filePath);
      } catch (cleanupError) {
        throw new AggregateError(
          [writeError, cleanupError],
          `Failed to write temporary audio file ${filePath} and cleanup also failed.`,
        );
      }
      throw writeError;
    }
  }

  async remove(filePath: string): Promise<void> {
    if (!this.#activePaths.has(filePath)) {
      return;
    }
    try {
      await this.#remove(filePath);
      this.#activePaths.delete(filePath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.#activePaths.delete(filePath);
        return;
      }
      throw error;
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
