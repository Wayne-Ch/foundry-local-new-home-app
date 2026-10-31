export interface SpeechCorrection {
  readonly id: "queen-bed" | "baby-bed";
  readonly original: string;
  readonly replacement: string;
}

export interface SpeechCorrectionResult {
  readonly rawTranscript: string;
  readonly correctedTranscript: string;
  readonly corrections: readonly SpeechCorrection[];
}

const layoutEntityPattern = /\b(?:baby|bed|closet|crib|desk|door|fit|furniture|layout|room|window)\b/i;
const furnitureActionPattern = /\b(?:add|bring|include|keep|need|place|remove|use|want)\b/i;

function replaceWithCorrection(
  value: string,
  pattern: RegExp,
  replacement: string,
  id: SpeechCorrection["id"],
  corrections: SpeechCorrection[],
): string {
  return value.replace(pattern, (original) => {
    corrections.push({ id, original, replacement });
    return replacement;
  });
}

export function applySpeechCorrectionSuggestions(rawTranscript: string): SpeechCorrectionResult {
  const corrections: SpeechCorrection[] = [];
  let correctedTranscript = rawTranscript;
  if (layoutEntityPattern.test(rawTranscript) && furnitureActionPattern.test(rawTranscript)) {
    correctedTranscript = replaceWithCorrection(
      correctedTranscript,
      /\bqueen[\s-]+size(?:d)?[\s-]+bag\b/gi,
      "queen-size bed",
      "queen-bed",
      corrections,
    );
    correctedTranscript = replaceWithCorrection(
      correctedTranscript,
      /\bcreep\b/gi,
      "baby bed",
      "baby-bed",
      corrections,
    );
  }
  return {
    rawTranscript,
    correctedTranscript,
    corrections,
  };
}
