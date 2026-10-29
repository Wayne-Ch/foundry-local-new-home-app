import { afterEach, describe, expect, it, vi } from "vitest";
import { LivePcmCapture } from "../src/renderer/audio-capture";

type FailureStage =
  | "object-url"
  | "add-module"
  | "create-source"
  | "create-worklet"
  | "create-gain"
  | "connect-source"
  | "connect-worklet"
  | "connect-gain"
  | "resume"
  | "capture-construction";

function installFailedStartHarness(failureStage: FailureStage) {
  const setupError = new Error(`failed at ${failureStage}`);
  const source = {
    connect: vi.fn((target: unknown) => {
      if (failureStage === "connect-source") {
        throw setupError;
      }
      return target;
    }),
    disconnect: vi.fn(),
  };
  const worklet = {
    port: { onmessage: null },
    connect: vi.fn((target: unknown) => {
      if (failureStage === "connect-worklet") {
        throw setupError;
      }
      return target;
    }),
    disconnect: vi.fn(),
  };
  const silentGain = {
    gain: { value: 1 },
    connect: vi.fn((target: unknown) => {
      if (failureStage === "connect-gain") {
        throw setupError;
      }
      return target;
    }),
    disconnect: vi.fn(),
  };
  const context = {
    sampleRate: failureStage === "capture-construction" ? 0 : 48_000,
    destination: {},
    audioWorklet: {
      addModule: vi.fn(async () => {
        if (failureStage === "add-module") {
          throw setupError;
        }
      }),
    },
    createMediaStreamSource: vi.fn(() => {
      if (failureStage === "create-source") {
        throw setupError;
      }
      return source;
    }),
    createGain: vi.fn(() => {
      if (failureStage === "create-gain") {
        throw setupError;
      }
      return silentGain;
    }),
    resume: vi.fn(async () => {
      if (failureStage === "resume") {
        throw setupError;
      }
    }),
    close: vi.fn(async () => {}),
  };
  const createObjectURL = vi.fn(() => {
    if (failureStage === "object-url") {
      throw setupError;
    }
    return "blob:audio-worklet";
  });
  const revokeObjectURL = vi.fn();

  vi.stubGlobal(
    "AudioContext",
    vi.fn(function AudioContextMock() {
      return context;
    }),
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    vi.fn(function AudioWorkletNodeMock() {
      if (failureStage === "create-worklet") {
        throw setupError;
      }
      return worklet;
    }),
  );
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

  return {
    context,
    createObjectURL,
    revokeObjectURL,
    source,
    worklet,
    silentGain,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LivePcmCapture startup cleanup", () => {
  it.each([
    "object-url",
    "add-module",
    "create-source",
    "create-worklet",
    "create-gain",
    "connect-source",
    "connect-worklet",
    "connect-gain",
    "resume",
    "capture-construction",
  ] satisfies FailureStage[])(
    "releases every constructed resource after %s failure",
    async (failureStage) => {
      const harness = installFailedStartHarness(failureStage);

      await expect(
        LivePcmCapture.start(
          {} as MediaStream,
          () => {},
          () => {},
        ),
      ).rejects.toThrow();

      expect(harness.context.close).toHaveBeenCalledOnce();
      expect(harness.createObjectURL).toHaveBeenCalledOnce();
      expect(harness.revokeObjectURL).toHaveBeenCalledTimes(failureStage === "object-url" ? 0 : 1);

      const sourceConstructed = !["object-url", "add-module", "create-source"].includes(failureStage);
      const workletConstructed = sourceConstructed && failureStage !== "create-worklet";
      const gainConstructed = workletConstructed && failureStage !== "create-gain";
      expect(harness.source.disconnect).toHaveBeenCalledTimes(sourceConstructed ? 1 : 0);
      expect(harness.worklet.disconnect).toHaveBeenCalledTimes(workletConstructed ? 1 : 0);
      expect(harness.silentGain.disconnect).toHaveBeenCalledTimes(gainConstructed ? 1 : 0);
    },
  );
});
