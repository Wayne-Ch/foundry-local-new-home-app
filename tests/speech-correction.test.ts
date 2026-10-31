import { describe, expect, it } from "vitest";
import { applySpeechCorrectionSuggestions } from "../src/renderer/speech-correction";

describe("visible candidate-local speech correction suggestions", () => {
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
    "I packed a queen size bag for the trip. Keep the desk by the window.",
    "Keep the queen size bag for travel. Fit the desk beside the window.",
    "Fit the desk, and the queen size bag is luggage.",
    "Move the queen size bag by the door before the trip.",
  ])("keeps literal or ambiguous bag wording unchanged: %s", (raw) => {
    expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it.each([
    ["Keep the queen size bag.", "Keep the queen-size bed."],
    ["Replace the queen size bag with a king bed.", "Replace the queen-size bed with a king bed."],
    [
      "Keep the queen size bag as the bed in this layout.",
      "Keep the queen-size bed as the bed in this layout.",
    ],
  ])("suggests a Queen bed under a direct local furniture action: %s", (raw, correctedTranscript) => {
    expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
      correctedTranscript,
      corrections: [{ id: "queen-bed", original: "queen size bag", replacement: "queen-size bed" }],
    });
  });

  it("requires a direct additive, request, placement, or replacement action with local baby-bed context", () => {
    expect(applySpeechCorrectionSuggestions("Add a creep beside the desk for the baby.")).toMatchObject({
      correctedTranscript: "Add a baby bed beside the desk for the baby.",
      corrections: [{ id: "baby-bed", original: "creep", replacement: "baby bed" }],
    });
    expect(applySpeechCorrectionSuggestions("Bring in a creep for the nursery layout.")).toMatchObject({
      correctedTranscript: "Bring in a baby bed for the nursery layout.",
      corrections: [{ id: "baby-bed", original: "creep", replacement: "baby bed" }],
    });
    expect(applySpeechCorrectionSuggestions("For the baby, place a creep beside the desk.")).toMatchObject({
      correctedTranscript: "For the baby, place a baby bed beside the desk.",
      corrections: [{ id: "baby-bed", original: "creep", replacement: "baby bed" }],
    });
    expect(applySpeechCorrectionSuggestions("We need a creep in the nursery.")).toMatchObject({
      correctedTranscript: "We need a baby bed in the nursery.",
      corrections: [{ id: "baby-bed", original: "creep", replacement: "baby bed" }],
    });
    expect(applySpeechCorrectionSuggestions("Replace the crib with a creep.")).toMatchObject({
      correctedTranscript: "Replace the crib with a baby bed.",
      corrections: [{ id: "baby-bed", original: "creep", replacement: "baby bed" }],
    });
  });

  it.each(["while", "because", "although", "whereas", "when", "after", "before", "since", "if", "unless"])(
    "never inherits an action across a %s clause with a new subject",
    (boundary) => {
      const creep = `Keep the crib ${boundary} she called him a creep.`;
      const bag = `Move the desk ${boundary} they bought a queen size bag for the drive.`;

      expect(applySpeechCorrectionSuggestions(creep)).toEqual({
        rawTranscript: creep,
        correctedTranscript: creep,
        corrections: [],
      });
      expect(applySpeechCorrectionSuggestions(bag)).toEqual({
        rawTranscript: bag,
        correctedTranscript: bag,
        corrections: [],
      });
    },
  );

  it.each([
    "Keep the crib she called him a creep.",
    "Move the desk the movers bought a queen size bag for the drive.",
  ])("requires the candidate itself to be in the direct action span: %s", (raw) => {
    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it("does not infer baby-bed intent from a desk or unrelated layout entity", () => {
    const raw = "Add a creep beside the desk. Keep the closet clear.";

    expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it.each([
    "Do not be a creep.",
    "Keep the creep away from the baby.",
    "That guy is a creep.",
    "Move the creep away from the nursery.",
    "Remove the creep from the baby's room.",
    "Retain the creep near the crib.",
  ])("keeps ordinary-person and avoidance creep wording exact: %s", (raw) => {
    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
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

  it.each([
    "Keep the crib and that guy seems like a creep.",
    "Keep the crib and he acts like a creep.",
    "Keep the crib, she called him a creep.",
    "Keep the crib but the buyer said that man was a creep.",
    "Keep the crib, and our neighbor looks like a creep.",
    "Keep the crib and somebody described the visitor as a creep.",
    "Keep the crib and people said the visitor was a creep.",
    "Move the desk and she carried a queen size bag to the car.",
    "Move the desk and they bought a queen size bag for the drive.",
    "Move the desk, the shopper called it a queen size bag.",
    "Move the desk but that mover loaded a queen size bag into the car.",
    "Move the desk, and my friend said the queen size bag was in the trunk.",
    "Move the desk and movers bought a queen size bag for the car.",
    "Move the desk and Wayne brought a queen size bag to the car.",
  ])("does not inherit a layout action across an explicit new subject clause: %s", (raw) => {
    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it.each([
    [
      "Keep the crib and add a creep for the baby.",
      "Keep the crib and add a baby bed for the baby.",
      "baby-bed",
    ],
    [
      "Move the desk, then fit the queen size bag as the bed in this layout.",
      "Move the desk, then fit the queen-size bed as the bed in this layout.",
      "queen-bed",
    ],
  ] as const)(
    "keeps a later independent positive layout clause suggestible: %s",
    (raw, correctedTranscript, id) => {
      expect(applySpeechCorrectionSuggestions(raw)).toMatchObject({
        correctedTranscript,
        corrections: [expect.objectContaining({ id })],
      });
    },
  );

  it("binds each candidate to its own subject or action window across quotes and newlines", () => {
    const raw = [
      'Keep the crib and she said "add a creep for the baby."',
      "That buyer called the visitor a creep, but replace the crib with a creep.",
      "Move the desk and he said the queen size bag belongs in the car.",
      "Then fit the queen size bag beside the desk.",
    ].join("\n");

    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: [
        'Keep the crib and she said "add a creep for the baby."',
        "That buyer called the visitor a creep, but replace the crib with a baby bed.",
        "Move the desk and he said the queen size bag belongs in the car.",
        "Then fit the queen-size bed beside the desk.",
      ].join("\n"),
      corrections: [
        { id: "baby-bed", original: "creep", replacement: "baby bed" },
        { id: "queen-bed", original: "queen size bag", replacement: "queen-size bed" },
      ],
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

  it.each([
    "Do not, under any circumstances, add a creep for the baby.",
    "Never, ever add a creep for the baby.",
    "Don't, please add a creep for the baby.",
    "I do not, under any circumstances, want a creep in the nursery.",
  ])("suppresses punctuated or adverb-interrupted additive negation: %s", (raw) => {
    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it.each([
    "No need to add a creep for the baby.",
    "I no longer want a creep for the baby.",
    "Arrange the nursery without a creep for the baby.",
    "Avoid adding a creep for the baby.",
    "Exclude a creep for the baby.",
    "Use the crib rather than a creep for the baby.",
    "I want a creep for the baby not anymore.",
  ])("suppresses baby-bed suggestions under local negation: %s", (raw) => {
    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it.each([
    "No need to add a creep for the baby, but add a creep beside the crib.",
    "I no longer want a creep for the baby. Add a creep beside the crib.",
    "Arrange the nursery without a creep for the baby, then add a creep beside the crib.",
    "Exclude a creep for the baby; replace the crib with a creep.",
  ])("allows a later positive clause to suggest independently: %s", (raw) => {
    const result = applySpeechCorrectionSuggestions(raw);

    expect(result.corrections).toEqual([{ id: "baby-bed", original: "creep", replacement: "baby bed" }]);
    expect(result.correctedTranscript.match(/baby bed/g)).toHaveLength(1);
  });

  it.each([
    [
      "Do not move the desk but fit the queen size bag beside the desk.",
      "Do not move the desk but fit the queen-size bed beside the desk.",
    ],
    [
      "Do not move the desk, then fit the queen size bag beside the desk.",
      "Do not move the desk, then fit the queen-size bed beside the desk.",
    ],
    [
      "Do not move the desk, fit the queen size bag beside the desk.",
      "Do not move the desk, fit the queen-size bed beside the desk.",
    ],
    [
      "Although I said not to move the desk, fit the queen size bag beside the desk.",
      "Although I said not to move the desk, fit the queen-size bed beside the desk.",
    ],
    [
      "I packed luggage, but fit the queen size bag beside the desk.",
      "I packed luggage, but fit the queen-size bed beside the desk.",
    ],
    [
      "I packed luggage, then fit the queen size bag beside the desk.",
      "I packed luggage, then fit the queen-size bed beside the desk.",
    ],
    [
      "I packed luggage, fit the queen size bag beside the desk.",
      "I packed luggage, fit the queen-size bed beside the desk.",
    ],
    [
      "After I packed luggage, fit the queen size bag beside the desk.",
      "After I packed luggage, fit the queen-size bed beside the desk.",
    ],
  ])("keeps earlier negation or luggage outside the later candidate span: %s", (raw, corrected) => {
    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: corrected,
      corrections: [{ id: "queen-bed", original: "queen size bag", replacement: "queen-size bed" }],
    });
  });

  it.each([
    "Do not fit the queen size bag beside the desk.",
    "Don't, please fit the queen size bag beside the desk.",
    "Fit the queen size bag as luggage.",
    "I packed the queen size bag as luggage.",
  ])("suppresses local Queen candidates under negation or luggage semantics: %s", (raw) => {
    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it("does not create a correction for the exact baby bed term", () => {
    const raw = "Add a baby bed to the nursery layout.";

    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
      correctedTranscript: raw,
      corrections: [],
    });
  });

  it("does not create suggestions for exact supported aliases", () => {
    const raw = "Keep the Queen bed. Add a baby bed. Use a compact desk if needed.";

    expect(applySpeechCorrectionSuggestions(raw)).toEqual({
      rawTranscript: raw,
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
