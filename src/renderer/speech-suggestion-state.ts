import { createTranscriptDraftUpdate } from "../audio/audio-contract";
import type { SpeechCorrection, SpeechCorrectionResult } from "./speech-correction";

export interface SpeechSuggestionState extends SpeechCorrectionResult {
  readonly status: "pending" | "applied";
  readonly rawDraftValue: string;
  readonly suggestedDraftValue: string;
}

export interface SpeechCorrectionProvenance {
  readonly source: "explicit_user_acceptance";
  readonly rawTranscript: string;
  readonly suggestedTranscript: string;
  readonly promptBefore: string;
  readonly promptAfter: string;
  readonly corrections: readonly SpeechCorrection[];
}

export interface SpeechSuggestionDraft {
  readonly promptValue: string;
  readonly suggestion: SpeechSuggestionState | null;
}

export function createSpeechSuggestionDraft(
  currentPromptValue: string,
  correction: SpeechCorrectionResult,
): SpeechSuggestionDraft {
  const rawDraft = createTranscriptDraftUpdate(currentPromptValue, correction.rawTranscript);
  if (correction.corrections.length === 0) {
    return {
      promptValue: rawDraft.value,
      suggestion: null,
    };
  }
  const suggestedDraft = createTranscriptDraftUpdate(currentPromptValue, correction.correctedTranscript);
  return {
    promptValue: rawDraft.value,
    suggestion: {
      ...correction,
      status: "pending",
      rawDraftValue: rawDraft.value,
      suggestedDraftValue: suggestedDraft.value,
    },
  };
}

export function applySpeechSuggestion(
  suggestion: SpeechSuggestionState,
  currentPromptValue: string,
): {
  readonly promptValue: string;
  readonly suggestion: SpeechSuggestionState | null;
  readonly provenance: SpeechCorrectionProvenance | null;
} {
  if (suggestion.status !== "pending" || currentPromptValue !== suggestion.rawDraftValue) {
    return {
      promptValue: currentPromptValue,
      suggestion: null,
      provenance: null,
    };
  }
  return {
    promptValue: suggestion.suggestedDraftValue,
    suggestion: {
      ...suggestion,
      status: "applied",
    },
    provenance: {
      source: "explicit_user_acceptance",
      rawTranscript: suggestion.rawTranscript,
      suggestedTranscript: suggestion.correctedTranscript,
      promptBefore: suggestion.rawDraftValue,
      promptAfter: suggestion.suggestedDraftValue,
      corrections: suggestion.corrections,
    },
  };
}

export function dismissSpeechSuggestion(suggestion: SpeechSuggestionState): {
  readonly promptValue: string;
  readonly suggestion: null;
  readonly provenance: null;
} {
  return {
    promptValue: suggestion.rawDraftValue,
    suggestion: null,
    provenance: null,
  };
}

export function undoSpeechSuggestion(
  suggestion: SpeechSuggestionState,
  currentPromptValue: string,
): {
  readonly promptValue: string;
  readonly suggestion: SpeechSuggestionState | null;
  readonly provenance: null;
} {
  if (suggestion.status !== "applied" || currentPromptValue !== suggestion.suggestedDraftValue) {
    return {
      promptValue: currentPromptValue,
      suggestion: null,
      provenance: null,
    };
  }
  return {
    promptValue: suggestion.rawDraftValue,
    suggestion: {
      ...suggestion,
      status: "pending",
    },
    provenance: null,
  };
}

export function reconcileSpeechSuggestionEdit(
  suggestion: SpeechSuggestionState,
  promptValue: string,
): SpeechSuggestionState | null {
  const expectedValue =
    suggestion.status === "applied" ? suggestion.suggestedDraftValue : suggestion.rawDraftValue;
  return promptValue === expectedValue ? suggestion : null;
}
