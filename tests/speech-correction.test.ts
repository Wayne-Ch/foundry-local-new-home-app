import { describe, expect, it } from "vitest";
import { applySpeechCorrectionSuggestions } from "../src/renderer/speech-correction";

describe("visible speech correction suggestions", () => {
  it("corrects the observed layout transcript without hiding the raw transcript", () => {
    const raw = "We may need a creep keep the queen size bag and add a creep without blocking the closet";
    const result = applySpeechCorrectionSuggestions(raw);

    expect(result.rawTranscript).toBe(raw);
    expect(result.correctedTranscript).toBe(
      "We may need a baby bed keep the queen-size bed and add a baby bed without blocking the closet",
    );
    expect(result.corrections).toEqual([
      { id: "queen-bed", original: "queen size bag", replacement: "queen-size bed" },
      { id: "baby-bed", original: "creep", replacement: "baby bed" },
      { id: "baby-bed", original: "creep", replacement: "baby bed" },
    ]);
  });

  it("corrects creep only when furniture or layout context is present", () => {
    expect(
      applySpeechCorrectionSuggestions("Keep the Queen bed and add a creep near the desk."),
    ).toMatchObject({
      correctedTranscript: "Keep the Queen bed and add a baby bed near the desk.",
    });
    expect(applySpeechCorrectionSuggestions("The thriller adds a creep to the final scene.")).toMatchObject({
      correctedTranscript: "The thriller adds a creep to the final scene.",
      corrections: [],
    });
  });

  it("does not rewrite unrelated bag wording", () => {
    expect(applySpeechCorrectionSuggestions("I bought a queen size bag for a long trip.")).toMatchObject({
      correctedTranscript: "I bought a queen size bag for a long trip.",
      corrections: [],
    });
  });
});
