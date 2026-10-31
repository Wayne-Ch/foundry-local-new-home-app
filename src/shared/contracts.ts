import type {
  AudioCapturePayload,
  AudioPartialTranscriptEvent,
  AudioReadiness,
  AudioStreamCancelRequest,
  AudioStreamChunkRequest,
  AudioStreamChunkResponse,
  AudioStreamFinishRequest,
  AudioStreamStartRequest,
  AudioStreamStartResponse,
  AudioTranscriptionResult,
  PrepareAudioRequest,
} from "../audio/audio-types";
import type { ManualPlacementOutcome, ManualPlacementRequest } from "../domain/manual-placement";
import type {
  DemoStateSnapshot,
  EvaluatedLayoutOption,
  LayoutToolResult,
  ModelIdentity,
  RoomPlan,
  RuntimeReadiness,
} from "../domain/types";

export const ipcChannels = {
  getBootstrap: "demo:get-bootstrap",
  initializeRuntime: "demo:initialize-runtime",
  prepareOffline: "demo:prepare-offline",
  prepareAudio: "demo:prepare-audio",
  startAudioStream: "demo:start-audio-stream",
  appendAudioChunk: "demo:append-audio-chunk",
  finishAudioStream: "demo:finish-audio-stream",
  cancelAudioStream: "demo:cancel-audio-stream",
  audioPartial: "demo:audio-partial",
  authorizeMicrophone: "demo:authorize-microphone",
  transcribeAudio: "demo:transcribe-audio",
  runTurn: "demo:run-turn",
  applyManualPlacement: "demo:apply-manual-placement",
  resetConversation: "demo:reset-conversation",
  progress: "demo:progress",
} as const;

export type StageTurnId = "turn-a" | "turn-b" | "turn-c" | "controlled-failure";

export interface StageTurnDefinition {
  readonly id: StageTurnId;
  readonly label: string;
  readonly prompt: string;
}

export interface TraceEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly kind:
    | "user"
    | "model-tool-call"
    | "validation"
    | "geometry"
    | "model-summary"
    | "application-response"
    | "manual-placement"
    | "audio-transcription"
    | "runtime"
    | "error";
  readonly title: string;
  readonly payload: unknown;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "application" | "system";
  readonly text: string;
  readonly status?: "normal" | "warning" | "error";
}

export interface BootstrapPayload {
  readonly roomPlan: RoomPlan;
  readonly state: DemoStateSnapshot;
  readonly readiness: RuntimeReadiness;
  readonly audioReadiness: AudioReadiness;
  readonly stageTurns: readonly StageTurnDefinition[];
  readonly completedStageTurnIds: readonly StageTurnId[];
  readonly lastInteraction: "turn" | "manual" | null;
  readonly selectedLayout: EvaluatedLayoutOption | null;
  readonly lastToolResult: LayoutToolResult | null;
  readonly messages: readonly ConversationMessage[];
  readonly trace: readonly TraceEntry[];
}

export interface RunTurnRequest {
  readonly prompt: string;
  readonly scriptedTurnId?: StageTurnId;
}

export interface RunTurnResponse {
  readonly state: DemoStateSnapshot;
  readonly toolResult: LayoutToolResult | null;
  readonly selectedLayout: EvaluatedLayoutOption | null;
  readonly completedStageTurnIds: readonly StageTurnId[];
  readonly lastInteraction: "turn";
  readonly assistantText: string;
  readonly messages: readonly ConversationMessage[];
  readonly trace: readonly TraceEntry[];
  readonly readiness: RuntimeReadiness;
}

export interface ManualPlacementResponse {
  readonly outcome: ManualPlacementOutcome;
  readonly completedStageTurnIds: readonly StageTurnId[];
  readonly lastInteraction: "turn" | "manual" | null;
  readonly messages: readonly ConversationMessage[];
  readonly trace: readonly TraceEntry[];
}

export interface ProgressEvent {
  readonly phase:
    | "model-planning"
    | "tool-validating"
    | "geometry-running"
    | "model-summarizing"
    | "audio-preparing"
    | "audio-transcribing"
    | "complete"
    | "error";
  readonly detail: string;
}

export interface PrepareOfflineResponse {
  readonly readiness: RuntimeReadiness;
  readonly model: ModelIdentity | null;
}

export interface PrepareAudioResponse {
  readonly readiness: AudioReadiness;
}

export interface AudioTranscriptionResponse {
  readonly result: AudioTranscriptionResult;
  readonly audioReadiness: AudioReadiness;
  readonly trace: readonly TraceEntry[];
}

export interface MicrophoneAuthorizationRequest {
  readonly hasTransientUserActivation: boolean;
}

export interface DemoApi {
  getBootstrap(): Promise<BootstrapPayload>;
  initializeRuntime(): Promise<RuntimeReadiness>;
  prepareOffline(): Promise<PrepareOfflineResponse>;
  prepareAudio(request: PrepareAudioRequest): Promise<PrepareAudioResponse>;
  authorizeMicrophone(): Promise<void>;
  transcribeAudio(request: AudioCapturePayload): Promise<AudioTranscriptionResponse>;
  startAudioStream(request: AudioStreamStartRequest): Promise<AudioStreamStartResponse>;
  appendAudioChunk(request: AudioStreamChunkRequest): Promise<AudioStreamChunkResponse>;
  finishAudioStream(request: AudioStreamFinishRequest): Promise<AudioTranscriptionResponse>;
  cancelAudioStream(request: AudioStreamCancelRequest): Promise<void>;
  runTurn(request: RunTurnRequest): Promise<RunTurnResponse>;
  applyManualPlacement(request: ManualPlacementRequest): Promise<ManualPlacementResponse>;
  resetConversation(): Promise<BootstrapPayload>;
  onProgress(callback: (event: ProgressEvent) => void): () => void;
  onAudioPartial(callback: (event: AudioPartialTranscriptEvent) => void): () => void;
}
