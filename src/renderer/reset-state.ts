import type { AudioRecorderState, LiveTranscriptDraft } from "../audio/audio-types";
import { createInitialDemoState } from "../domain/demo-state";
import { defaultPlanningFixture } from "../domain/fixture";
import { defaultStageTurns } from "../foundry/prompt";
import type { BootstrapPayload, TraceEntry } from "../shared/contracts";

export const DEFAULT_AUDIO_NOTICE = "Editable draft only; click Send to submit.";
export const RESET_SYSTEM_MESSAGE =
  "Conversation reset. Verified dimensions and locked room constraints remain loaded.";

export interface RendererTransientState<
  SpeechCorrection = unknown,
  SpeechCorrectionProvenance = unknown,
  ManualPreview = unknown,
  ManualPreviewOrigin = unknown,
  PlacementDrag = unknown,
> {
  readonly promptValue: string;
  readonly liveTranscriptDraft: LiveTranscriptDraft;
  readonly liveTranscriptPhase: "draft" | "submitted";
  readonly audioRecorderState: AudioRecorderState;
  readonly audioNotice: string;
  readonly speechCorrection: SpeechCorrection | null;
  readonly speechCorrectionProvenance: SpeechCorrectionProvenance | null;
  readonly trace: readonly TraceEntry[];
  readonly manualPreview: ManualPreview | null;
  readonly manualPreviewOrigin: ManualPreviewOrigin | null;
  readonly placementDrag: PlacementDrag | null;
}

export function resetRendererTransientState<
  SpeechCorrection,
  SpeechCorrectionProvenance,
  ManualPreview,
  ManualPreviewOrigin,
  PlacementDrag,
>(
  state: RendererTransientState<
    SpeechCorrection,
    SpeechCorrectionProvenance,
    ManualPreview,
    ManualPreviewOrigin,
    PlacementDrag
  >,
): RendererTransientState<
  SpeechCorrection,
  SpeechCorrectionProvenance,
  ManualPreview,
  ManualPreviewOrigin,
  PlacementDrag
> {
  return {
    ...state,
    promptValue: "",
    liveTranscriptDraft: {
      streamId: null,
      sequence: -1,
      text: "",
      isFinal: false,
    },
    liveTranscriptPhase: "draft",
    audioRecorderState: { status: "idle", elapsedMs: 0, detail: "" },
    audioNotice: DEFAULT_AUDIO_NOTICE,
    speechCorrection: null,
    speechCorrectionProvenance: null,
    trace: [],
    manualPreview: null,
    manualPreviewOrigin: null,
    placementDrag: null,
  };
}

export function createAuthoritativeResetBootstrap(
  current: BootstrapPayload,
  conversationGeneration: number,
): BootstrapPayload {
  if (
    !Number.isSafeInteger(conversationGeneration) ||
    conversationGeneration <= current.conversationGeneration
  ) {
    throw new Error("Reset conversation generation must advance monotonically.");
  }
  return {
    ...current,
    conversationGeneration,
    roomMode: "default",
    roomPlan: defaultPlanningFixture.roomPlan,
    state: createInitialDemoState(defaultPlanningFixture.roomPlan),
    stageTurns: defaultStageTurns,
    floorPlanImport: {
      status: "idle",
      preview: null,
      recognition: null,
      recognizedFacts: [],
      error: null,
    },
    completedStageTurnIds: [],
    lastInteraction: null,
    selectedLayout: null,
    lastToolResult: null,
    messages: [
      {
        id: `renderer-reset-${conversationGeneration}`,
        role: "system",
        text: RESET_SYSTEM_MESSAGE,
      },
    ],
    trace: [],
  };
}

export function isAuthoritativeResetBootstrap(
  bootstrap: BootstrapPayload,
  conversationGeneration: number,
): boolean {
  return (
    bootstrap.conversationGeneration === conversationGeneration &&
    bootstrap.state.version === 0 &&
    bootstrap.state.stateRef === "layout-state-v0" &&
    bootstrap.state.currentLayoutId === null &&
    bootstrap.state.currentLayoutSource === null &&
    bootstrap.state.activeFurnitureIds.length === 0 &&
    bootstrap.state.lastChangedPreference === null &&
    bootstrap.state.lastResultStatus === null &&
    bootstrap.completedStageTurnIds.length === 0 &&
    bootstrap.lastInteraction === null &&
    bootstrap.selectedLayout === null &&
    bootstrap.lastToolResult === null &&
    bootstrap.trace.length === 0
  );
}

export function isCurrentConversationResult(
  result: { readonly conversationGeneration: number },
  conversationGeneration: number,
): boolean {
  return result.conversationGeneration === conversationGeneration;
}
