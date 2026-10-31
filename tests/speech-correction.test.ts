import { describe, expect, it } from "vitest";
import { applySpeechCorrectionSuggestions } from "../src/renderer/speech-correction";

describe("visible clause-local speech correction suggestions", () => {
  it("suggests a Queen bed only inside a bounded furniture clause", () => {
    const raw = "Fit the queen size bag beside the desk.";
    const result = applySpeechCorrectionSuggestions(raw);

    expect(result).toEqual({
      rawTranscript: raw,
      correctedTranscript: "Fit the queen-size bed beside the desk.",
      corrections: [{ id: "queen-bed", original: "queen size bag", replacement: "queen-size bed" }],
    });
  });

  it("does not leak Queen-bed context from another sentence", () => {
    const raw = "Keep the Queen bed. Do not be a creep.";

    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it.each([
    "Keep the queen size bag.",
    "I packed a queen size bag for the trip. Keep the desk by the window.",
    "Keep the queen size bag for travel. Fit the desk beside the window.",
  ])("keeps literal or ambiguous bag wording unchanged: %s", (raw) => {
    expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it("allows keep only when the same clause explicitly frames the phrase as a bed", () => {
    expect(
      applySpeechCorrectionSuggestions("Keep the queen size bag as the bed in this layout."),
    ).toMatchObject({
      correctedTranscript: "Keep the queen-size bed as the bed in this layout.",
      corrections: [{ id: "queen-bed", original: "queen size bag", replacement: "queen-size bed" }],
    });
  });

  it("requires local baby-bed context before suggesting creep as baby bed", () => {
    expect(applySpeechCorrectionSuggestions("Add a creep for the baby beside the desk.")).toMatchObject({
      correctedTranscript: "Add a baby bed for the baby beside the desk.",
      corrections: [{ id: "baby-bed", original: "creep", replacement: "baby bed" }],
    });
    expect(applySpeechCorrectionSuggestions("Replace the crib with a creep.")).toMatchObject({
      correctedTranscript: "Replace the crib with a baby bed.",
      corrections: [{ id: "baby-bed", original: "creep", replacement: "baby bed" }],
    });
  });

  it("does not infer baby-bed intent from a desk or unrelated layout entity", () => {
    const raw = "Add a creep beside the desk. Keep the closet clear.";

    expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it("separates action-led conjunctions before evaluating local context", () => {
    const raw = "Keep the crib and add a creep beside the desk.";

    expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it("handles multiline clauses independently and preserves raw formatting", () => {
    const raw = [
      "Fit the queen size bag beside the desk.",
      "Do not be a creep.",
      "Replace the crib with a creep.",
    ].join("\n");

    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: [
        "Fit the queen-size bed beside the desk.",
        "Do not be a creep.",
        "Replace the crib with a baby bed.",
      ].join("\n"),
      corrections: [
        { id: "queen-bed", original: "queen size bag", replacement: "queen-size bed" },
        { id: "baby-bed", original: "creep", replacement: "baby bed" },
      ],
    });
  });

  it("does not rewrite quoted speech", () => {
    const raw =
      'The buyer said "Fit the queen size bag beside the desk." Then fit the queen size bag beside the desk.';

    expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
      correctedTranscript:
        'The buyer said "Fit the queen size bag beside the desk." Then fit the queen-size bed beside the desk.',
      corrections: [{ id: "queen-bed", original: "queen size bag", replacement: "queen-size bed" }],
    });
  });

  it("does not apply suggestions under explicit negation", () => {
    const raw = "Do not add a creep for the baby. Never fit the queen size bag beside the desk.";

    expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it("records each repeated local replacement in transcript order", () => {
    const raw = "For the baby, add a creep beside the crib and use a creep as the baby bed.";

    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: "For the baby, add a baby bed beside the crib and use a baby bed as the baby bed.",
      corrections: [
        { id: "baby-bed", original: "creep", replacement: "baby bed" },
        { id: "baby-bed", original: "creep", replacement: "baby bed" },
      ],
    });
  });
});
