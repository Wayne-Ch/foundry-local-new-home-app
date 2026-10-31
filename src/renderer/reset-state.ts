import type { AudioRecorderState, LiveTranscriptDraft } from "../audio/audio-types";
import type { TraceEntry } from "../shared/contracts";

export const DEFAULT_AUDIO_NOTICE = "Editable draft only; click Send to submit.";

export interface RendererTransientState<
  SpeechCorrection = unknown,
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
  readonly trace: readonly TraceEntry[];
  readonly manualPreview: ManualPreview | null;
  readonly manualPreviewOrigin: ManualPreviewOrigin | null;
  readonly placementDrag: PlacementDrag | null;
}

export function resetRendererTransientState<
  SpeechCorrection,
  ManualPreview,
  ManualPreviewOrigin,
  PlacementDrag,
>(
  state: RendererTransientState<SpeechCorrection, ManualPreview, ManualPreviewOrigin, PlacementDrag>,
): RendererTransientState<SpeechCorrection, ManualPreview, ManualPreviewOrigin, PlacementDrag> {
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
    trace: [],
    manualPreview: null,
    manualPreviewOrigin: null,
    placementDrag: null,
  };
}
