import { randomUUID } from "node:crypto";
import {
  validateAudioCapturePayload,
  validateAudioStreamCancel,
  validateAudioStreamChunk,
  validateAudioStreamFinish,
  validateAudioStreamStart,
  validatePrepareAudioRequest,
} from "../audio/audio-contract";
import type {
  AudioCapturePayload,
  AudioPartialTranscriptEvent,
  AudioStreamCancelRequest,
  AudioStreamChunkRequest,
  AudioStreamChunkResponse,
  AudioStreamFinishRequest,
  AudioStreamStartRequest,
  AudioStreamStartResponse,
  PrepareAudioRequest,
} from "../audio/audio-types";
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

type DemoFoundryService = Pick<
  FoundryLayoutService,
  | "readiness"
  | "audioReadiness"
  | "initialize"
  | "prepareOffline"
  | "prepareAudioOffline"
  | "transcribeAudio"
  | "startAudioStream"
  | "appendAudioStreamChunk"
  | "finishAudioStream"
  | "cancelAudioStream"
  | "runTurn"
  | "reset"
  | "shutdown"
>;

export interface DemoControllerOptions {
  readonly foundry?: DemoFoundryService;
}

export class DemoController {
  readonly #foundry: DemoFoundryService;
  #state: DemoState = createInitialDemoState();
  #selectedLayout: EvaluatedLayoutOption | null = null;
  #messages: ConversationMessage[] = [
    message(
      "system",
      "Verified room plan loaded. Geometry remains deterministic; Foundry Local interprets requirements and calls the tool.",
    ),
  ];
  #trace: TraceEntry[] = [];
  #operationGeneration = 0;
  #resetPromise: Promise<BootstrapPayload> | null = null;

  constructor(options: DemoControllerOptions = {}) {
    this.#foundry = options.foundry ?? new FoundryLayoutService();
  }

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
    const generation = this.#beginOperation();
    const readiness = await this.#foundry.initialize();
    this.#assertOperationCurrent(generation);
    this.#pushTrace("runtime", "Runtime inspection", readiness);
    return readiness;
  }

  async prepareOffline(onProgress?: (event: ProgressEvent) => void): Promise<PrepareOfflineResponse> {
    const generation = this.#beginOperation();
    const readiness = await this.#foundry.prepareOffline((detail) => {
      if (this.#isOperationCurrent(generation)) {
        onProgress?.({ phase: "model-planning", detail });
      }
    });
    this.#assertOperationCurrent(generation);
    this.#pushTrace("runtime", "Offline readiness prepared", readiness);
    return { readiness, model: readiness.model };
  }

  async prepareAudio(
    request: PrepareAudioRequest,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<PrepareAudioResponse> {
    const generation = this.#beginOperation();
    const validated = validatePrepareAudioRequest(request);
    const readiness = await this.#foundry.prepareAudioOffline(validated.mode, (detail) => {
      if (this.#isOperationCurrent(generation)) {
        onProgress?.({ phase: "audio-preparing", detail });
      }
    });
    this.#assertOperationCurrent(generation);
    this.#pushTrace("runtime", "Audio runtime prepared", readiness);
    return { readiness };
  }

  async startAudioStream(
    request: AudioStreamStartRequest,
    onPartial: (event: AudioPartialTranscriptEvent) => void,
  ): Promise<AudioStreamStartResponse> {
    validateAudioStreamStart(request);
    const generation = this.#beginOperation();
    return this.#foundry.startAudioStream((event) => {
      if (this.#isOperationCurrent(generation)) {
        onPartial(event);
      }
    });
  }

  appendAudioStreamChunk(request: AudioStreamChunkRequest): AudioStreamChunkResponse {
    const validated = validateAudioStreamChunk(request);
    return this.#foundry.appendAudioStreamChunk(validated.streamId, validated.sequence, validated.pcmBytes);
  }

  async finishAudioStream(
    request: AudioStreamFinishRequest,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<AudioTranscriptionResponse> {
    const generation = this.#beginOperation();
    const validated = validateAudioStreamFinish(request);
    if (this.#isOperationCurrent(generation)) {
      onProgress?.({ phase: "audio-transcribing", detail: "Finalizing Nemotron live captions." });
    }
    const result = await this.#foundry.finishAudioStream(validated);
    this.#assertOperationCurrent(generation);
    this.#pushTrace("audio-transcription", "Nemotron live caption result", {
      transcript: result.transcript,
      transcriptionMs: result.transcriptionMs,
      audioDurationMs: result.audioDurationMs,
      firstPartialMs: result.firstPartialMs,
      finalizationMs: result.finalizationMs,
      transcriptSource: result.transcriptSource,
      mode: result.mode,
      model: result.model,
      externalEndpointUsed: result.externalEndpointUsed,
      autoSubmitted: false,
    });
    onProgress?.({ phase: "complete", detail: "Final transcript is ready for review." });
    return {
      result,
      audioReadiness: this.#foundry.audioReadiness,
      trace: this.#trace,
    };
  }

  async cancelAudioStream(request: AudioStreamCancelRequest): Promise<void> {
    const validated = validateAudioStreamCancel(request);
    await this.#foundry.cancelAudioStream(validated.streamId);
  }

  async transcribeAudio(
    payload: AudioCapturePayload,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<AudioTranscriptionResponse> {
    const generation = this.#beginOperation();
    const validation = validateAudioCapturePayload(payload);
    if (!validation.ok) {
      this.#pushTrace("error", "Audio payload rejected", validation.error);
      throw new Error(validation.error.message);
    }

    if (this.#isOperationCurrent(generation)) {
      onProgress?.({ phase: "audio-transcribing", detail: "Transcribing microphone audio locally." });
    }
    try {
      const result = await this.#foundry.transcribeAudio(validation.value);
      this.#assertOperationCurrent(generation);
      this.#pushTrace("audio-transcription", "Local speech-to-text result", {
        transcript: result.transcript,
        transcriptionMs: result.transcriptionMs,
        audioDurationMs: result.audioDurationMs,
        model: result.model,
        mode: result.mode,
        transcriptSource: result.transcriptSource,
        firstPartialMs: result.firstPartialMs,
        finalizationMs: result.finalizationMs,
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
      if (!this.#isOperationCurrent(generation)) {
        throw error;
      }
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
    const generation = this.#beginOperation();
    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new Error("Prompt cannot be empty.");
    }

    this.#messages.push(message("user", prompt));
    this.#pushTrace("user", request.scriptedTurnId ?? "Manual prompt", { prompt, state: this.#state });

    try {
      const outcome = await this.#foundry.runTurn(prompt, this.#state, (phase, detail) => {
        if (!this.#isOperationCurrent(generation)) {
          return;
        }
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
      this.#assertOperationCurrent(generation);

      this.#pushTrace("model-tool-call", "Model-proposed intent delta", outcome.modelIntent);
      this.#pushTrace("validation", "Application-derived tool input accepted", {
        attempts: outcome.validationAttempts,
        priorErrors: outcome.validationErrors,
        toolCall: outcome.toolCall,
        input: outcome.validatedInput,
        preflight: outcome.planningPreflight,
        performance: outcome.performance,
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
      if (!this.#isOperationCurrent(generation)) {
        throw error;
      }
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

  reset(): Promise<BootstrapPayload> {
    if (this.#resetPromise !== null) {
      return this.#resetPromise;
    }
    this.#operationGeneration += 1;
    let trackedPromise: Promise<BootstrapPayload>;
    trackedPromise = this.#reset().finally(() => {
      if (this.#resetPromise === trackedPromise) {
        this.#resetPromise = null;
      }
    });
    this.#resetPromise = trackedPromise;
    return trackedPromise;
  }

  async #reset(): Promise<BootstrapPayload> {
    await this.#foundry.reset();
    this.#state = createInitialDemoState();
    this.#selectedLayout = null;
    this.#messages = [
      message("system", "Conversation reset. Verified dimensions and locked room constraints remain loaded."),
    ];
    this.#trace = [];
    return this.bootstrap();
  }

  async shutdown(): Promise<void> {
    this.#operationGeneration += 1;
    await this.#foundry.shutdown();
  }

  #beginOperation(): number {
    if (this.#resetPromise !== null) {
      throw new Error("Conversation reset is in progress.");
    }
    return this.#operationGeneration;
  }

  #isOperationCurrent(generation: number): boolean {
    return generation === this.#operationGeneration && this.#resetPromise === null;
  }

  #assertOperationCurrent(generation: number): void {
    if (!this.#isOperationCurrent(generation)) {
      throw new Error("Operation was superseded by conversation reset.");
    }
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
