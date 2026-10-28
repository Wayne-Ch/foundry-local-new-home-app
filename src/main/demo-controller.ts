import { randomUUID } from "node:crypto";
import { validateAudioCapturePayload } from "../audio/audio-contract";
import type { AudioCapturePayload } from "../audio/audio-types";
import { applyToolResult, createInitialDemoState } from "../domain/demo-state";
import { roomPlan } from "../domain/fixture";
import type { DemoState, EvaluatedLayoutOption } from "../domain/types";
import { FoundryLayoutService } from "../foundry/foundry-service";
import { stageTurns } from "../foundry/prompt";
import type {
  AudioTranscriptionResponse,
  BootstrapPayload,
  ConversationMessage,
  PrepareAudioResponse,
  PrepareOfflineResponse,
  ProgressEvent,
  RunTurnRequest,
  RunTurnResponse,
  TraceEntry,
} from "../shared/contracts";

function now(): string {
  return new Date().toISOString();
}

function message(role: ConversationMessage["role"], text: string, status?: ConversationMessage["status"]) {
  return {
    id: randomUUID(),
    role,
    text,
    ...(status ? { status } : {}),
  };
}

export class DemoController {
  readonly #foundry = new FoundryLayoutService();
  #state: DemoState = createInitialDemoState();
  #selectedLayout: EvaluatedLayoutOption | null = null;
  #messages: ConversationMessage[] = [
    message(
      "system",
      "Verified room plan loaded. Geometry remains deterministic; Foundry Local interprets requirements and calls the tool.",
    ),
  ];
  #trace: TraceEntry[] = [];

  bootstrap(): BootstrapPayload {
    return {
      roomPlan,
      state: this.#state,
      readiness: this.#foundry.readiness,
      audioReadiness: this.#foundry.audioReadiness,
      stageTurns,
      selectedLayout: this.#selectedLayout,
      lastToolResult: this.#state.lastToolResult,
      messages: this.#messages,
      trace: this.#trace,
    };
  }

  async initializeRuntime(): Promise<BootstrapPayload["readiness"]> {
    const readiness = await this.#foundry.initialize();
    this.#pushTrace("runtime", "Runtime inspection", readiness);
    return readiness;
  }

  async prepareOffline(onProgress?: (event: ProgressEvent) => void): Promise<PrepareOfflineResponse> {
    const readiness = await this.#foundry.prepareOffline((detail) => {
      onProgress?.({ phase: "model-planning", detail });
    });
    this.#pushTrace("runtime", "Offline readiness prepared", readiness);
    return { readiness, model: readiness.model };
  }

  async prepareAudio(onProgress?: (event: ProgressEvent) => void): Promise<PrepareAudioResponse> {
    const readiness = await this.#foundry.prepareAudioOffline((detail) => {
      onProgress?.({ phase: "audio-preparing", detail });
    });
    this.#pushTrace("runtime", "Audio runtime prepared", readiness);
    return { readiness };
  }

  async transcribeAudio(
    payload: AudioCapturePayload,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<AudioTranscriptionResponse> {
    const validation = validateAudioCapturePayload(payload);
    if (!validation.ok) {
      this.#pushTrace("error", "Audio payload rejected", validation.error);
      throw new Error(validation.error.message);
    }

    onProgress?.({ phase: "audio-transcribing", detail: "Transcribing microphone audio locally." });
    try {
      const result = await this.#foundry.transcribeAudio(validation.value);
      this.#pushTrace("audio-transcription", "Local speech-to-text result", {
        transcript: result.transcript,
        transcriptionMs: result.transcriptionMs,
        audioDurationMs: result.audioDurationMs,
        model: result.model,
        externalEndpointUsed: result.externalEndpointUsed,
        autoSubmitted: false,
      });
      onProgress?.({ phase: "complete", detail: "Transcript is ready for review." });
      return {
        result,
        audioReadiness: this.#foundry.audioReadiness,
        trace: this.#trace,
      };
    } catch (error) {
      this.#pushTrace("error", "Local speech-to-text failed", {
        message: error instanceof Error ? error.message : String(error),
        audioReadiness: this.#foundry.audioReadiness,
      });
      onProgress?.({
        phase: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async runTurn(
    request: RunTurnRequest,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<RunTurnResponse> {
    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new Error("Prompt cannot be empty.");
    }

    this.#messages.push(message("user", prompt));
    this.#pushTrace("user", request.scriptedTurnId ?? "Manual prompt", { prompt, state: this.#state });

    try {
      const outcome = await this.#foundry.runTurn(prompt, this.#state, (phase, detail) => {
        const progressPhase =
          phase === "model-planning"
            ? "model-planning"
            : phase === "tool-validating"
              ? "tool-validating"
              : phase === "geometry-running"
                ? "geometry-running"
                : phase === "model-summarizing"
                  ? "model-summarizing"
                  : "model-planning";
        onProgress?.({ phase: progressPhase, detail });
      });

      this.#pushTrace("model-tool-call", "Model-proposed tool call", outcome.toolCall);
      this.#pushTrace("validation", "Application validation accepted", {
        attempts: outcome.validationAttempts,
        priorErrors: outcome.validationErrors,
        input: outcome.validatedInput,
        preflight: outcome.planningPreflight,
      });
      this.#pushTrace("geometry", "Deterministic geometry result", outcome.toolResult);

      this.#state = applyToolResult(this.#state, outcome.toolResult);
      if (outcome.toolResult.status === "feasible") {
        this.#selectedLayout =
          outcome.toolResult.feasibleOptions.find(
            (option) => option.id === outcome.toolResult.selectedOptionId,
          ) ?? null;
      }

      this.#messages.push(message("application", outcome.assistantText));
      this.#pushTrace("application-response", "Application rendering of typed evidence", {
        text: outcome.assistantText,
        source: "deterministic tool result",
        modelSummaryUsed: false,
      });
      onProgress?.({ phase: "complete", detail: "Turn complete." });
      return this.#response(outcome.toolResult, outcome.assistantText);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#messages.push(
        message("assistant", `Foundry Local could not complete this turn: ${detail}`, "error"),
      );
      this.#pushTrace("error", "Turn failed without a fallback", {
        message: detail,
        name: error instanceof Error ? error.name : "UnknownError",
      });
      onProgress?.({ phase: "error", detail });
      throw error;
    }
  }

  async reset(): Promise<BootstrapPayload> {
    await this.#foundry.resetAudio();
    this.#foundry.resetConversation();
    this.#state = createInitialDemoState();
    this.#selectedLayout = null;
    this.#messages = [
      message("system", "Conversation reset. Verified dimensions and locked room constraints remain loaded."),
    ];
    this.#trace = [];
    return this.bootstrap();
  }

  async shutdown(): Promise<void> {
    await this.#foundry.shutdown();
  }

  #response(toolResult: RunTurnResponse["toolResult"], assistantText: string): RunTurnResponse {
    return {
      state: this.#state,
      toolResult,
      selectedLayout: this.#selectedLayout,
      assistantText,
      messages: this.#messages,
      trace: this.#trace,
      readiness: this.#foundry.readiness,
    };
  }

  #pushTrace(kind: TraceEntry["kind"], title: string, payload: unknown): void {
    this.#trace.push({
      id: randomUUID(),
      timestamp: now(),
      kind,
      title,
      payload,
    });
  }
}
