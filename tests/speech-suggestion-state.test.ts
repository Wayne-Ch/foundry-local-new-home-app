import { describe, expect, it } from "vitest";
import { applySpeechCorrectionSuggestions } from "../src/renderer/speech-correction";
import {
  applySpeechSuggestion,
  createSpeechSuggestionDraft,
  dismissSpeechSuggestion,
  reconcileSpeechSuggestionEdit,
  undoSpeechSuggestion,
} from "../src/renderer/speech-suggestion-state";

function required<T>(value: T | null): T {
  if (value === null) {
    throw new Error("Expected a speech suggestion.");
  }
  return value;
}

describe("explicit speech suggestion state", () => {
  it("keeps the exact raw transcript in the editable prompt until Apply", () => {
    const correction = applySpeechCorrectionSuggestions("Fit the queen size bag beside the desk.");
    const draft = createSpeechSuggestionDraft("", correction);

    expect(draft.promptValue).toBe("Fit the queen size bag beside the desk.");
    expect(draft.suggestion).toMatchObject({
      status: "pending",
      rawDraftValue: "Fit the queen size bag beside the desk.",
      suggestedDraftValue: "Fit the queen-size bed beside the desk.",
    });
  });

  it("changes only the editable prompt after explicit acceptance and records provenance", () => {
    const correction = applySpeechCorrectionSuggestions("Add a creep for the baby beside the crib.");
    const draft = createSpeechSuggestionDraft("Keep the desk.", correction);
    expect(draft.suggestion).not.toBeNull();

    const applied = applySpeechSuggestion(required(draft.suggestion), draft.promptValue);

    expect(applied.promptValue).toBe("Keep the desk. Add a baby bed for the baby beside the crib.");
    expect(applied.suggestion?.status).toBe("applied");
    expect(applied.provenance).toEqual({
      source: "explicit_user_acceptance",
      rawTranscript: "Add a creep for the baby beside the crib.",
      suggestedTranscript: "Add a baby bed for the baby beside the crib.",
      promptBefore: "Keep the desk. Add a creep for the baby beside the crib.",
      promptAfter: "Keep the desk. Add a baby bed for the baby beside the crib.",
      corrections: [{ id: "baby-bed", original: "creep", replacement: "baby bed" }],
    });
  });

  it("dismisses without changing the raw prompt", () => {
    const draft = createSpeechSuggestionDraft(
      "",
      applySpeechCorrectionSuggestions("Fit the queen size bag beside the desk."),
    );

    expect(dismissSpeechSuggestion(required(draft.suggestion))).toEqual({
      promptValue: "Fit the queen size bag beside the desk.",
      suggestion: null,
      provenance: null,
    });
  });

  it("undoes an applied suggestion back to the raw transcript", () => {
    const draft = createSpeechSuggestionDraft(
      "",
      applySpeechCorrectionSuggestions("Fit the queen size bag beside the desk."),
    );
    const applied = applySpeechSuggestion(required(draft.suggestion), draft.promptValue);
    const undone = undoSpeechSuggestion(required(applied.suggestion), applied.promptValue);

    expect(undone).toMatchObject({
      promptValue: "Fit the queen size bag beside the desk.",
      suggestion: {
        status: "pending",
      },
      provenance: null,
    });
  });

  it("drops stale suggestion and undo state after a manual edit", () => {
    const draft = createSpeechSuggestionDraft(
      "",
      applySpeechCorrectionSuggestions("Fit the queen size bag beside the desk."),
    );
    const applied = applySpeechSuggestion(required(draft.suggestion), draft.promptValue);

    expect(
      reconcileSpeechSuggestionEdit(required(applied.suggestion), `${applied.promptValue} Please.`),
    ).toBeNull();
  });

  it("does not create suggestion state for an exact baby-bed alias", () => {
    const raw = "Add a baby bed beside the crib.";
    const draft = createSpeechSuggestionDraft("", applySpeechCorrectionSuggestions(raw));

    expect(draft).toEqual({
      promptValue: raw,
      suggestion: null,
    });
  });
});
