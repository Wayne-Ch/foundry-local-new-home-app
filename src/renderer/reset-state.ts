import type { AudioRecorderState, LiveTranscriptDraft } from "../audio/audio-types";
import type { TraceEntry } from "../shared/contracts";

export const DEFAULT_AUDIO_NOTICE = "Editable draft only; click Send to submit.";

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
