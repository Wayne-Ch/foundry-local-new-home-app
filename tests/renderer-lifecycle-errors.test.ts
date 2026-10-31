import { describe, expect, it } from "vitest";
import {
  describeRuntimeExceptionThrown,
  isUnhandledRendererErrorMessage,
  RendererLifecycleErrorMonitor,
} from "../src/main/renderer-lifecycle-errors";

describe("renderer lifecycle error monitoring", () => {
  it.each([
    "Uncaught (in promise) Error: rejected",
    "UNCAUGHT( IN   PROMISE ) Error: rejected",
    "UnhandledPromiseRejection: rejected",
    "unhandled promise rejection: rejected",
    "Unhandled   Promise-Rejection: rejected",
    "uncaught exception: rejected",
    "Uncaught-Exception: rejected",
  ])("recognizes standard Chromium unhandled error forms: %s", (message) => {
    expect(isUnhandledRendererErrorMessage(message)).toBe(true);
  });

  it("does not mistake ordinary renderer logging for an unhandled error", () => {
    expect(isUnhandledRendererErrorMessage("Recording stopped normally.")).toBe(false);
  });

  it("extracts a Chromium Runtime.exceptionThrown description", () => {
    expect(
      describeRuntimeExceptionThrown({
        exceptionDetails: {
          text: "Uncaught (in promise)",
          exception: {
            description: "Error: renderer-probe-rejection",
          },
        },
      }),
    ).toBe("Uncaught (in promise): Error: renderer-probe-rejection");
  });

  it("fails for console error, probe-harness, and CDP exception channels, then resets cleanly", () => {
    const monitor = new RendererLifecycleErrorMonitor();

    monitor.recordConsole("error", "ordinary console error");
    monitor.recordProbeHarnessError(new Error("probe error"));
    monitor.recordRuntimeException({
      exceptionDetails: {
        text: "Uncaught (in promise)",
        exception: { description: "Error: rejected promise" },
      },
    });

    expect(() => monitor.assertNone()).toThrow(/console.*probe-harness.*runtime\.exceptionThrown/i);
    expect(monitor.snapshot().map((error) => error.channel)).toEqual([
      "console",
      "probe-harness",
      "runtime.exceptionThrown",
    ]);

    monitor.clear();
    expect(() => monitor.assertNone()).not.toThrow();
  });

  it("matches an unhandled form even when Chromium reports a non-error console level", () => {
    const monitor = new RendererLifecycleErrorMonitor();

    monitor.recordConsole("warning", "UnhandledPromiseRejection: rejected");

    expect(() => monitor.assertNone()).toThrow(/UnhandledPromiseRejection/);
  });
});
