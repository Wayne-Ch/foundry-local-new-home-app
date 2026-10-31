export type RendererLifecycleErrorChannel =
  | "console"
  | "main-lifecycle"
  | "probe-harness"
  | "runtime.exceptionThrown";

export interface RendererLifecycleError {
  readonly channel: RendererLifecycleErrorChannel;
  readonly message: string;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null ? (value as Readonly<Record<string, unknown>>) : null;
}

function readString(record: Readonly<Record<string, unknown>> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function isUnhandledRendererErrorMessage(message: string): boolean {
  const compact = message.toLowerCase().replace(/[^a-z]/g, "");
  return (
    /uncaught\s*\(\s*in\s+promise\s*\)/i.test(message) ||
    compact.includes("unhandledpromiserejection") ||
    compact.includes("uncaughtexception") ||
    /object\s+has\s+been\s+destroyed/i.test(message) ||
    /\b(?:detached|destroyed)\b/i.test(message)
  );
}

export function describeRuntimeExceptionThrown(params: unknown): string {
  const root = asRecord(params);
  const details = asRecord(root?.exceptionDetails);
  const exception = asRecord(details?.exception);
  const text = readString(details, "text");
  const description =
    readString(exception, "description") ??
    readString(exception, "unserializableValue") ??
    readString(exception, "value");
  if (text !== null && description !== null && !description.includes(text)) {
    return `${text}: ${description}`;
  }
  return description ?? text ?? "Chromium Runtime.exceptionThrown without a description.";
}

export class RendererLifecycleErrorMonitor {
  readonly #errors: RendererLifecycleError[] = [];

  recordConsole(level: string, message: string): void {
    if (level.toLowerCase() === "error" || isUnhandledRendererErrorMessage(message)) {
      this.#errors.push({ channel: "console", message });
    }
  }

  recordMainLifecycleError(error: unknown): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (isUnhandledRendererErrorMessage(message)) {
      this.#errors.push({ channel: "main-lifecycle", message });
    }
  }

  recordProbeHarnessError(error: unknown): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    this.#errors.push({ channel: "probe-harness", message });
  }

  recordRuntimeException(params: unknown): void {
    this.#errors.push({
      channel: "runtime.exceptionThrown",
      message: describeRuntimeExceptionThrown(params),
    });
  }

  snapshot(): readonly RendererLifecycleError[] {
    return [...this.#errors];
  }

  clear(): void {
    this.#errors.length = 0;
  }

  assertNone(): void {
    if (this.#errors.length > 0) {
      throw new Error(
        `Renderer lifecycle emitted destroyed-object, console, probe-harness, or unhandled errors: ${JSON.stringify(
          this.#errors,
        )}`,
      );
    }
  }
}
