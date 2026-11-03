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
import { applyToolResult } from "../domain/demo-state";
import { defaultPlanningFixture } from "../domain/fixture";
import { createImportedPlanningFixture, type FloorPlanRecognition } from "../domain/floor-plan-import";
import { evaluateManualPlacement, type ManualPlacementRequest } from "../domain/manual-placement";
import {
  createActiveRoomSession,
  createInactiveRoomSession,
  ROOM_INTAKE_MESSAGE,
  type RoomSession,
  requireActiveRoomSession,
  resetRoomSessionState,
} from "../domain/room-session";
import type { DemoState, EvaluatedLayoutOption, PlanningFixture } from "../domain/types";
import {
  FoundryFloorPlanVisionError,
  FoundryLayoutService,
  type FoundryTurnOutcome,
} from "../foundry/foundry-service";
import { nextPendingStageTurnIndex, stageTurnsForMode } from "../foundry/prompt";
import { FLOOR_PLAN_FIXTURE_SHA256 } from "../layout-import/image-security";
import type {
  AudioTranscriptionResponse,
  BootstrapPayload,
  ConversationMessage,
  ManualPlacementResponse,
  PrepareAudioResponse,
  PrepareOfflineResponse,
  ProgressEvent,
  RunTurnRequest,
  RunTurnResponse,
  StageTurnDefinition,
  StageTurnId,
  TraceEntry,
} from "../shared/contracts";
import { FloorPlanImageStore } from "./floor-plan-image-store";

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

function recognizedFloorPlanFacts(recognition: FloorPlanRecognition): readonly string[] {
  return [
    `Room shape: ${recognition.roomShape}.`,
    `Room label: ${recognition.roomLabel}.`,
    `Door opening: ${recognition.doorOpening}.`,
    `Window opening: ${recognition.windowOpening}.`,
    "The VLM recognized visible topology only; the app applied the documented NARA fixture scale and canonical door/window/closet geometry.",
  ];
}

function manuallyCompletedStageTurn(
  turns: readonly StageTurnDefinition[],
  completedTurnIds: readonly StageTurnId[],
  outcome: FoundryTurnOutcome,
): StageTurnId | undefined {
  const nextTurn = turns[nextPendingStageTurnIndex(turns, completedTurnIds)];
  const candidates = outcome.validatedInput.candidateFurnitureIds;
  if (
    nextTurn?.id === "turn-c" &&
    outcome.toolResult.status === "feasible" &&
    candidates.bed === "bed-queen" &&
    candidates.desk === "desk-compact" &&
    candidates.crib === "crib-standard"
  ) {
    return "turn-c";
  }
  return undefined;
}

type DemoFoundryService = Pick<
  FoundryLayoutService,
  | "readiness"
  | "audioReadiness"
  | "visionReadiness"
  | "initialize"
  | "prepareOffline"
  | "prepareAudioOffline"
  | "transcribeAudio"
  | "startAudioStream"
  | "appendAudioStreamChunk"
  | "finishAudioStream"
  | "cancelAudioStream"
  | "runTurn"
  | "prepareFloorPlanVision"
  | "analyzeFloorPlan"
  | "cancelFloorPlanAnalysis"
  | "reset"
  | "shutdown"
>;

export interface DemoControllerOptions {
  readonly foundry?: DemoFoundryService;
  readonly floorPlanImages?: FloorPlanImageStore;
}

export class DemoController {
  readonly #foundry: DemoFoundryService;
  readonly #floorPlanImages: FloorPlanImageStore;
  #roomSession: RoomSession = createInactiveRoomSession();
  #selectedLayout: EvaluatedLayoutOption | null = null;
  #messages: ConversationMessage[] = [message("system", ROOM_INTAKE_MESSAGE)];
  #trace: TraceEntry[] = [];
  #completedStageTurnIds: StageTurnId[] = [];
  #lastInteraction: BootstrapPayload["lastInteraction"] = null;
  #floorPlanImport: BootstrapPayload["floorPlanImport"] = {
    status: "idle",
    preview: null,
    recognition: null,
    recognizedFacts: [],
    error: null,
  };
  #operationGeneration = 0;
  #conversationGeneration = 0;
  #resetPromise: Promise<BootstrapPayload> | null = null;
  #floorPlanReleasePromise: Promise<void> | null = null;

  constructor(options: DemoControllerOptions = {}) {
    this.#foundry = options.foundry ?? new FoundryLayoutService();
    this.#floorPlanImages = options.floorPlanImages ?? new FloorPlanImageStore();
  }

  bootstrap(): BootstrapPayload {
    const common = {
      conversationGeneration: this.#conversationGeneration,
      readiness: this.#foundry.readiness,
      audioReadiness: this.#foundry.audioReadiness,
      visionReadiness: this.#foundry.visionReadiness,
      floorPlanImport: this.#floorPlanImport,
      completedStageTurnIds: this.#completedStageTurnIds,
      lastInteraction: this.#lastInteraction,
      selectedLayout: this.#selectedLayout,
      messages: this.#messages,
      trace: this.#trace,
    };
    if (this.#roomSession.mode === "none") {
      return {
        ...common,
        roomMode: "none",
        roomPlan: null,
        state: null,
        stageTurns: [],
        lastToolResult: null,
      };
    }
    return {
      ...common,
      roomMode: this.#roomSession.mode,
      roomPlan: this.#roomSession.planningFixture.roomPlan,
      state: this.#roomSession.state,
      stageTurns: stageTurnsForMode(this.#roomSession.mode),
      lastToolResult: this.#roomSession.state.lastToolResult,
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

  async loadFloorPlanImage(
    bytes: Uint8Array,
    source: "sample" | "picker",
    displayName: string,
  ): Promise<BootstrapPayload> {
    if (this.#resetPromise !== null) {
      throw new Error("Conversation reset is in progress.");
    }
    this.#operationGeneration += 1;
    await this.#foundry.cancelFloorPlanAnalysis();
    const preview = this.#floorPlanImages.load(bytes, source, displayName);
    this.#roomSession = createInactiveRoomSession();
    this.#conversationGeneration += 1;
    this.#resetConversationState();
    this.#floorPlanImport = {
      status: "image_ready",
      preview,
      recognition: null,
      recognizedFacts: [],
      error: null,
    };
    this.#messages = [
      message(
        "system",
        "Floor-plan preview loaded. No room geometry is active until Analyze layout succeeds; Use default room remains an explicit fallback.",
      ),
    ];
    this.#pushTrace("floor-plan-vision", "Floor-plan image accepted", {
      source,
      displayName,
      format: preview.format,
      width: preview.width,
      height: preview.height,
      byteLength: preview.byteLength,
      sourceFormat: preview.sourceFormat,
      sourceByteLength: preview.sourceByteLength,
      inferenceFormat: preview.inferenceFormat,
      inferenceWidth: preview.inferenceWidth,
      inferenceHeight: preview.inferenceHeight,
      inferenceByteLength: preview.inferenceByteLength,
      fixtureSha256: FLOOR_PLAN_FIXTURE_SHA256,
      exactFixtureIdentityVerified: true,
      filesystemPathExposed: false,
    });
    return this.bootstrap();
  }

  async analyzeFloorPlan(onProgress?: (event: ProgressEvent) => void): Promise<BootstrapPayload> {
    const generation = this.#beginOperation();
    const preview = this.#floorPlanImages.preview;
    if (preview === null) {
      throw new Error("Load the packaged sample or choose an exact copy of that fixture before analysis.");
    }
    this.#floorPlanImport = {
      ...this.#floorPlanImport,
      status: "analyzing",
      error: null,
    };
    try {
      onProgress?.({
        phase: "vision-preparing",
        detail: `Preparing exact CPU vision model for ${preview.displayName}.`,
      });
      const outcome = await this.#foundry.analyzeFloorPlan(
        this.#floorPlanImages.format,
        this.#floorPlanImages.borrowBytes(),
        (detail) => {
          if (this.#isOperationCurrent(generation)) {
            onProgress?.({ phase: "vision-analyzing", detail });
          }
        },
      );
      this.#assertOperationCurrent(generation);
      this.#roomSession = createActiveRoomSession(createImportedPlanningFixture(outcome.recognition));
      this.#conversationGeneration += 1;
      this.#resetConversationState();
      const recognizedFacts = recognizedFloorPlanFacts(outcome.recognition);
      this.#floorPlanImport = {
        status: "imported",
        preview,
        recognition: outcome.recognition,
        recognizedFacts,
        error: null,
      };
      this.#floorPlanImages.releaseBytesRetainingPreview();
      this.#messages = [
        message(
          "system",
          "Experimental NARA master bedroom loaded. Foundry Local recognized only the visible rectangular room, label, door, and window topology. The application applied the documented NARA fixture scale and canonical door/window/closet geometry; the VLM did not infer millimetres, hinges, coordinates, or clearance.",
        ),
      ];
      this.#pushTrace("floor-plan-vision", "Bounded floor-plan recognition accepted", {
        model: outcome.model,
        recognition: outcome.recognition,
        rawOutput: outcome.rawOutput,
        preflight: outcome.preflight,
        performance: outcome.performance,
        externalEndpointUsed: false,
      });
      onProgress?.({ phase: "complete", detail: "Imported room geometry is ready." });
      return this.bootstrap();
    } catch (error) {
      if (!this.#isOperationCurrent(generation)) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      this.#floorPlanImport = {
        ...this.#floorPlanImport,
        status: "error",
        error: detail,
      };
      this.#pushTrace("floor-plan-vision", "Bounded floor-plan recognition rejected", {
        attempts: error instanceof FoundryFloorPlanVisionError ? error.attempts : [],
        roomActive: this.#roomSession.mode !== "none",
        defaultRoomAvailable: true,
        externalEndpointUsed: false,
      });
      this.#pushTrace("error", "Floor-plan recognition failed closed", {
        message: detail,
        roomActive: this.#roomSession.mode !== "none",
        defaultRoomAvailable: true,
        externalEndpointUsed: false,
      });
      onProgress?.({ phase: "error", detail });
      throw error;
    }
  }

  async useDefaultRoom(): Promise<BootstrapPayload> {
    if (this.#resetPromise !== null) {
      throw new Error("Conversation reset is in progress.");
    }
    this.#operationGeneration += 1;
    await this.#foundry.cancelFloorPlanAnalysis();
    this.#floorPlanImages.clear();
    this.#roomSession = createActiveRoomSession(defaultPlanningFixture);
    this.#conversationGeneration += 1;
    this.#floorPlanImport = {
      status: "idle",
      preview: null,
      recognition: null,
      recognizedFacts: [],
      error: null,
    };
    this.#resetConversationState();
    this.#messages = [
      message(
        "system",
        "Verified default room restored. Experimental floor-plan bytes and preview state were cleared.",
      ),
    ];
    return this.bootstrap();
  }

  releaseFloorPlanImage(): Promise<void> {
    if (this.#floorPlanReleasePromise !== null) {
      return this.#floorPlanReleasePromise;
    }
    if (this.#floorPlanImages.preview === null && this.#roomSession.mode === "none") {
      return Promise.resolve();
    }
    this.#operationGeneration += 1;
    this.#conversationGeneration += 1;
    this.#floorPlanImages.clear();
    this.#roomSession = createInactiveRoomSession();
    this.#floorPlanImport = {
      status: "idle",
      preview: null,
      recognition: null,
      recognizedFacts: [],
      error: null,
    };
    this.#resetConversationState();
    let trackedPromise: Promise<void>;
    trackedPromise = this.#foundry.cancelFloorPlanAnalysis().finally(() => {
      if (this.#floorPlanReleasePromise === trackedPromise) {
        this.#floorPlanReleasePromise = null;
      }
    });
    this.#floorPlanReleasePromise = trackedPromise;
    return trackedPromise;
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
      conversationGeneration: this.#conversationGeneration,
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
        conversationGeneration: this.#conversationGeneration,
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
    const activeRoom = requireActiveRoomSession(this.#roomSession);
    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new Error("Prompt cannot be empty.");
    }

    this.#messages.push(message("user", prompt));
    this.#pushTrace("user", request.scriptedTurnId ?? "Manual prompt", {
      prompt,
      state: activeRoom.state,
    });

    try {
      const outcome = await this.#foundry.runTurn(
        prompt,
        activeRoom.state,
        (phase, detail) => {
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
        },
        this.#selectedLayout,
        activeRoom.planningFixture,
      );
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

      this.#roomSession = {
        ...activeRoom,
        state: applyToolResult(activeRoom.state, outcome.toolResult),
      };
      if (outcome.toolResult.status === "feasible") {
        this.#selectedLayout =
          outcome.toolResult.feasibleOptions.find(
            (option) => option.id === outcome.toolResult.selectedOptionId,
          ) ?? null;
      }
      const completedStageTurnId =
        request.scriptedTurnId ??
        manuallyCompletedStageTurn(
          stageTurnsForMode(this.#planningFixture.mode),
          this.#completedStageTurnIds,
          outcome,
        );
      if (completedStageTurnId !== undefined && !this.#completedStageTurnIds.includes(completedStageTurnId)) {
        this.#completedStageTurnIds.push(completedStageTurnId);
      }
      this.#lastInteraction = "turn";

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

  applyManualPlacement(request: ManualPlacementRequest): ManualPlacementResponse {
    this.#beginOperation();
    const activeRoom = requireActiveRoomSession(this.#roomSession);
    const outcome = evaluateManualPlacement(
      activeRoom.state,
      this.#selectedLayout,
      request,
      activeRoom.planningFixture.roomPlan,
    );
    this.#pushTrace("manual-placement", "Application-owned manual placement", {
      provenance: "application-owned direct manipulation",
      accepted: outcome.accepted,
      rejectionCode: outcome.rejectionCode,
      reason: outcome.reason,
      request: outcome.request,
      preview: outcome.preview,
      priorAcceptedLayoutId: this.#selectedLayout?.id ?? null,
    });
    if (outcome.accepted) {
      this.#roomSession = {
        ...activeRoom,
        state: outcome.state,
      };
      this.#selectedLayout = outcome.selectedLayout;
      this.#lastInteraction = "manual";
      this.#messages.push(
        message(
          "application",
          `App-owned manual placement accepted: ${outcome.reason} No model geometry was used.`,
        ),
      );
    }
    return {
      conversationGeneration: this.#conversationGeneration,
      outcome: {
        ...outcome,
        state: requireActiveRoomSession(this.#roomSession).state,
        selectedLayout: this.#selectedLayout,
      },
      completedStageTurnIds: this.#completedStageTurnIds,
      lastInteraction: this.#lastInteraction,
      messages: this.#messages,
      trace: this.#trace,
    };
  }

  reset(): Promise<BootstrapPayload> {
    if (this.#resetPromise !== null) {
      return this.#resetPromise;
    }
    this.#operationGeneration += 1;
    this.#conversationGeneration += 1;
    this.#roomSession = createInactiveRoomSession();
    this.#floorPlanImages.clear();
    this.#floorPlanImport = {
      status: "idle",
      preview: null,
      recognition: null,
      recognizedFacts: [],
      error: null,
    };
    this.#resetConversationState();
    const resetGeneration = this.#conversationGeneration;
    let trackedPromise: Promise<BootstrapPayload>;
    trackedPromise = this.#reset(resetGeneration).finally(() => {
      if (this.#resetPromise === trackedPromise) {
        this.#resetPromise = null;
      }
    });
    this.#resetPromise = trackedPromise;
    return trackedPromise;
  }

  async #reset(resetGeneration: number): Promise<BootstrapPayload> {
    await this.#foundry.reset();
    if (resetGeneration !== this.#conversationGeneration) {
      throw new Error("Conversation reset was superseded by a newer reset generation.");
    }
    return this.bootstrap();
  }

  #resetConversationState(): void {
    this.#roomSession = resetRoomSessionState(this.#roomSession);
    this.#selectedLayout = null;
    this.#messages = [
      message(
        "system",
        this.#roomSession.mode === "none"
          ? ROOM_INTAKE_MESSAGE
          : this.#roomSession.mode === "imported"
            ? "Conversation reset. Imported room geometry and locked constraints remain loaded."
            : "Conversation reset. Verified dimensions and locked room constraints remain loaded.",
      ),
    ];
    this.#trace = [];
    this.#completedStageTurnIds = [];
    this.#lastInteraction = null;
  }

  async shutdown(): Promise<void> {
    this.#operationGeneration += 1;
    await this.#floorPlanReleasePromise?.catch(() => undefined);
    this.#floorPlanImages.clear();
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
    const activeRoom = requireActiveRoomSession(this.#roomSession);
    return {
      conversationGeneration: this.#conversationGeneration,
      state: activeRoom.state,
      toolResult,
      selectedLayout: this.#selectedLayout,
      completedStageTurnIds: this.#completedStageTurnIds,
      lastInteraction: "turn",
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
