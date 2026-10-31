import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRecorderState, LiveTranscriptDraft } from "../src/audio/audio-types";
import { createPreviewApi } from "../src/renderer/preview-api";
import {
  createAuthoritativeResetBootstrap,
  DEFAULT_AUDIO_NOTICE,
  isAuthoritativeResetBootstrap,
  isCurrentConversationResult,
  type RendererTransientState,
  resetRendererTransientState,
} from "../src/renderer/reset-state";
import type { TraceEntry } from "../src/shared/contracts";

const rawTranscriptTrace: TraceEntry = {
  id: "audio-trace",
  timestamp: "2026-10-30T00:00:00.000Z",
  kind: "audio-transcription",
  title: "Local speech-to-text result",
  payload: {
    transcript: "Fit the queen size bag beside the desk.",
  },
};

function state(overrides: Partial<RendererTransientState> = {}): RendererTransientState {
  return {
    promptValue: "Fit the queen-size bed beside the desk.",
    liveTranscriptDraft: {
      streamId: "11111111-1111-4111-8111-111111111111",
      sequence: Number.MAX_SAFE_INTEGER,
      text: "Fit the queen size bag beside the desk.",
      isFinal: true,
    },
    liveTranscriptPhase: "submitted",
    audioRecorderState: { status: "idle", elapsedMs: 0, detail: "" },
    audioNotice: "Visible speech suggestions were applied.",
    speechCorrection: {
      status: "applied",
      rawDraftValue: "Fit the queen size bag beside the desk.",
      suggestedDraftValue: "Fit the queen-size bed beside the desk.",
    },
    speechCorrectionProvenance: {
      source: "explicit_user_acceptance",
      promptBefore: "Fit the queen size bag beside the desk.",
      promptAfter: "Fit the queen-size bed beside the desk.",
    },
    trace: [rawTranscriptTrace],
    manualPreview: null,
    manualPreviewOrigin: null,
    placementDrag: null,
    ...overrides,
  };
}

describe("renderer reset state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears a corrected draft, suggestion metadata, submitted transcript, and raw trace together", () => {
    const reset = resetRendererTransientState(state());

    expect(reset).toMatchObject({
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
    });
  });

  it.each([
    { status: "recording", elapsedMs: 2_500, detail: "Recording locally." },
    { status: "transcribing", elapsedMs: 2_500, detail: "Transcribing locally." },
    { status: "idle", elapsedMs: 0, detail: "" },
  ] satisfies readonly AudioRecorderState[])(
    "returns recording state $status to the same idle v0 state",
    (audioRecorderState) => {
      const reset = resetRendererTransientState(
        state({
          audioRecorderState,
          liveTranscriptPhase: "draft",
        }),
      );

      expect(reset.audioRecorderState).toEqual({ status: "idle", elapsedMs: 0, detail: "" });
      expect(reset.liveTranscriptDraft.text).toBe("");
      expect(reset.liveTranscriptPhase).toBe("draft");
    },
  );

  it("clears manual edits, suggestion provenance, preview, origin, and drag state", () => {
    const editedDraft: LiveTranscriptDraft = {
      streamId: "11111111-1111-4111-8111-111111111111",
      sequence: 7,
      text: "Fit the queen size bag beside the desk.",
      isFinal: true,
    };
    const reset = resetRendererTransientState(
      state({
        promptValue: "Use my manually edited requirement.",
        liveTranscriptDraft: editedDraft,
        speechCorrection: null,
        speechCorrectionProvenance: null,
        manualPreview: { accepted: true },
        manualPreviewOrigin: { instanceId: "desk-standard-1" },
        placementDrag: { pointerId: 9 },
      }),
    );

    expect(reset).toMatchObject({
      promptValue: "",
      speechCorrection: null,
      speechCorrectionProvenance: null,
      trace: [],
      manualPreview: null,
      manualPreviewOrigin: null,
      placementDrag: null,
    });
  });

  it("makes the renderer preview reset response a main-compatible v0 payload", async () => {
    vi.stubGlobal("window", { location: { search: "" } });
    const api = createPreviewApi();
    const before = await api.getBootstrap();
    expect(before.state.version).toBeGreaterThan(0);

    const reset = await api.resetConversation();

    expect(reset).toMatchObject({
      conversationGeneration: before.conversationGeneration + 1,
      state: {
        version: 0,
        stateRef: "layout-state-v0",
        currentLayoutId: null,
        lastToolResult: null,
      },
      completedStageTurnIds: [],
      lastInteraction: null,
      selectedLayout: null,
      lastToolResult: null,
      trace: [],
    });
  });

  it("replaces accepted renderer state with authoritative v0 before an async reset response", async () => {
    vi.stubGlobal("window", { location: { search: "" } });
    const before = await createPreviewApi().getBootstrap();

    const reset = createAuthoritativeResetBootstrap(before, before.conversationGeneration + 1);

    expect(reset).toMatchObject({
      conversationGeneration: before.conversationGeneration + 1,
      state: {
        version: 0,
        stateRef: "layout-state-v0",
        currentLayoutId: null,
        currentLayoutSource: null,
        activeFurnitureIds: [],
        lastChangedPreference: null,
        lastResultStatus: null,
      },
      completedStageTurnIds: [],
      lastInteraction: null,
      selectedLayout: null,
      lastToolResult: null,
      trace: [],
    });
    expect(reset.messages).toHaveLength(1);
    expect(reset.messages[0]?.text).toContain("Conversation reset");
  });

  it("rejects stale bootstrap and result generations during reset recovery", async () => {
    vi.stubGlobal("window", { location: { search: "" } });
    const stale = await createPreviewApi().getBootstrap();
    const expectedGeneration = stale.conversationGeneration + 1;
    const localV0 = createAuthoritativeResetBootstrap(stale, expectedGeneration);

    expect(isAuthoritativeResetBootstrap(stale, expectedGeneration)).toBe(false);
    expect(
      isAuthoritativeResetBootstrap(
        {
          ...stale,
          conversationGeneration: expectedGeneration,
        },
        expectedGeneration,
      ),
    ).toBe(false);
    expect(isAuthoritativeResetBootstrap(localV0, expectedGeneration)).toBe(true);
    expect(
      isCurrentConversationResult(
        { conversationGeneration: stale.conversationGeneration },
        expectedGeneration,
      ),
    ).toBe(false);
    expect(
      isCurrentConversationResult({ conversationGeneration: expectedGeneration }, expectedGeneration),
    ).toBe(true);
  });
});
