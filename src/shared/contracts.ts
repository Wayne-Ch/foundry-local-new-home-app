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
  runTurn: "demo:run-turn",
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
  readonly stageTurns: readonly StageTurnDefinition[];
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
  readonly assistantText: string;
  readonly messages: readonly ConversationMessage[];
  readonly trace: readonly TraceEntry[];
  readonly readiness: RuntimeReadiness;
}

export interface ProgressEvent {
  readonly phase:
    | "model-planning"
    | "tool-validating"
    | "geometry-running"
    | "model-summarizing"
    | "complete"
    | "error";
  readonly detail: string;
}

export interface PrepareOfflineResponse {
  readonly readiness: RuntimeReadiness;
  readonly model: ModelIdentity | null;
}

export interface DemoApi {
  getBootstrap(): Promise<BootstrapPayload>;
  initializeRuntime(): Promise<RuntimeReadiness>;
  prepareOffline(): Promise<PrepareOfflineResponse>;
  runTurn(request: RunTurnRequest): Promise<RunTurnResponse>;
  resetConversation(): Promise<BootstrapPayload>;
  onProgress(callback: (event: ProgressEvent) => void): () => void;
}
