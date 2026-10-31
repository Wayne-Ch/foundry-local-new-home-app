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

interface TextRange {
  readonly start: number;
  readonly end: number;
}

interface CandidateWindow extends TextRange {
  readonly text: string;
}

interface CorrectionCandidate extends TextRange {
  readonly id: SpeechCorrection["id"];
  readonly replacement: string;
}

interface GoverningAction {
  readonly verb: string;
  readonly start: number;
  readonly end: number;
}

const actionSource =
  "add|arrange|bring|fit|include|keep|move|need|place|position|put|remove|replace|require|retain|swap|use|want";
const actionPattern = new RegExp(`\\b(?:${actionSource})\\b`, "gi");
const hardClauseBoundaryPattern = /[.!?;:\r\n]+/g;
const softClauseBoundaryPattern = /,|\b(?:and|but|then)\b/gi;
const independentActionClausePattern = new RegExp(
  `^(?:\\s|please\\s+)*(?:(?:no\\s+need\\s+to|no\\s+longer|do\\s+not|don't|dont|never|not)\\s+)?(?:${actionSource}|avoid|exclude|be)\\b`,
  "i",
);
const subjectPronouns = new Set([
  "everybody",
  "everyone",
  "he",
  "i",
  "it",
  "nobody",
  "she",
  "somebody",
  "someone",
  "they",
  "we",
  "who",
  "you",
]);
const subjectDeterminers = new Set([
  "a",
  "an",
  "another",
  "any",
  "each",
  "either",
  "every",
  "her",
  "his",
  "its",
  "my",
  "neither",
  "no",
  "our",
  "some",
  "that",
  "the",
  "their",
  "these",
  "this",
  "those",
  "your",
]);
const nonSubjectOpeners = new Set([
  "against",
  "along",
  "also",
  "as",
  "beside",
  "for",
  "inside",
  "instead",
  "just",
  "like",
  "near",
  "only",
  "outside",
  "over",
  "please",
  "rather",
  "under",
  "with",
  "without",
]);
const wordTokenPattern = /\b[A-Za-z][\w'-]*\b/g;
const queenBagPattern = /\bqueen[\s-]+size(?:d)?[\s-]+bag\b/gi;
const creepPattern = /\bcreep\b/gi;
const explicitBedContextPattern = /\b(?:bed|bedroom|headboard|mattress|sleep|sleeping)\b/gi;
const layoutEntityPattern = /\b(?:closet|cot|crib|desk|door|furniture|layout|nursery|wall|window)\b/gi;
const spatialContextPattern =
  /\b(?:against|along|beside|between|blocking|by|clear of|inside|near|next to|opposite|under|within)\b/gi;
const babyBedContextPattern = /\b(?:baby|cot|crib|infant|newborn|nursery|toddler)\b/gi;
const literalBagContextPattern =
  /\b(?:baggage|carry[\s-]?on|journey|luggage|pack|packed|packing|suitcase|travel|trip|vacation)\b/i;
const strongLayoutActions = new Set(["arrange", "fit", "move", "place", "position", "replace", "swap"]);
const maxActionDistanceWords = 12;
const scopedNegationSource =
  "no\\s+need\\s+to|no\\s+longer|do\\s+not|don't|dont|never|not|without|avoid(?:ed|ing|s)?|exclude(?:d|s|ing)?|rather\\s+than";

function collectQuotedRanges(value: string): TextRange[] {
  const ranges: TextRange[] = [];
  const quotePatterns = [
    /"[^"\r\n]*"/g,
    /\u201c[^\u201d\r\n]*\u201d/g,
    /(?<![\w])'[^'\r\n]*'(?![\w])/g,
    /\u2018[^\u2019\r\n]*\u2019/g,
  ];
  for (const pattern of quotePatterns) {
    for (const match of value.matchAll(pattern)) {
      if (match.index !== undefined) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
      }
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function overlapsRange(start: number, end: number, range: TextRange): boolean {
  return start < range.end && end > range.start;
}

function maskRanges(value: string, valueStart: number, ranges: readonly TextRange[]): string {
  let masked = value;
  for (const range of ranges) {
    const start = Math.max(0, range.start - valueStart);
    const end = Math.min(value.length, range.end - valueStart);
    if (start < end) {
      masked = `${masked.slice(0, start)}${" ".repeat(end - start)}${masked.slice(end)}`;
    }
  }
  return masked;
}

function startsIndependentActionClause(value: string): boolean {
  return independentActionClausePattern.test(value);
}

function startsIndependentSubjectClause(value: string): boolean {
  const tokens = [...value.matchAll(wordTokenPattern)];
  const first = tokens[0]?.[0];
  if (first === undefined) {
    return false;
  }
  const normalized = first.toLowerCase();
  if (subjectPronouns.has(normalized)) {
    return tokens.length >= 2;
  }
  if (subjectDeterminers.has(normalized)) {
    return tokens.length >= 3;
  }
  if (/^[A-Z]/.test(first)) {
    return tokens.length >= 2;
  }
  return tokens.length >= 3 && !nonSubjectOpeners.has(normalized);
}

function startsIndependentClause(value: string): boolean {
  return startsIndependentActionClause(value) || startsIndependentSubjectClause(value);
}

function boundaryIsQuoted(start: number, end: number, quotedRanges: readonly TextRange[]): boolean {
  return quotedRanges.some((range) => overlapsRange(start, end, range));
}

function findHardCandidateWindow(
  rawTranscript: string,
  candidate: TextRange,
  quotedRanges: readonly TextRange[],
): TextRange {
  let start = 0;
  let end = rawTranscript.length;
  for (const match of rawTranscript.matchAll(hardClauseBoundaryPattern)) {
    if (match.index === undefined) {
      continue;
    }
    const boundaryEnd = match.index + match[0].length;
    if (boundaryIsQuoted(match.index, boundaryEnd, quotedRanges)) {
      continue;
    }
    if (boundaryEnd <= candidate.start) {
      start = boundaryEnd;
      continue;
    }
    if (match.index >= candidate.end) {
      end = match.index;
      break;
    }
  }
  return { start, end };
}

function findCandidateWindow(
  rawTranscript: string,
  candidate: TextRange,
  quotedRanges: readonly TextRange[],
): CandidateWindow {
  const hardWindow = findHardCandidateWindow(rawTranscript, candidate, quotedRanges);
  let start = hardWindow.start;
  let end = hardWindow.end;

  for (const match of rawTranscript.matchAll(softClauseBoundaryPattern)) {
    if (match.index === undefined) {
      continue;
    }
    const boundaryEnd = match.index + match[0].length;
    if (
      match.index < hardWindow.start ||
      match.index >= hardWindow.end ||
      boundaryIsQuoted(match.index, boundaryEnd, quotedRanges)
    ) {
      continue;
    }
    if (boundaryEnd <= candidate.start) {
      const candidatePrefix = maskRanges(
        rawTranscript.slice(boundaryEnd, candidate.start),
        boundaryEnd,
        quotedRanges,
      );
      if (startsIndependentClause(candidatePrefix)) {
        start = boundaryEnd;
      }
      continue;
    }
    if (match.index >= candidate.end) {
      const suffix = maskRanges(rawTranscript.slice(boundaryEnd, hardWindow.end), boundaryEnd, quotedRanges);
      if (startsIndependentClause(suffix)) {
        end = match.index;
        break;
      }
    }
  }

  return {
    start,
    end,
    text: rawTranscript.slice(start, end),
  };
}

function wordDistance(value: string, leftEnd: number, rightStart: number): number {
  const start = Math.min(leftEnd, rightStart);
  const end = Math.max(leftEnd, rightStart);
  return value.slice(start, end).match(/\b[\w'-]+\b/g)?.length ?? 0;
}

function hasScopedNegationBefore(value: string, position: number, maxWords: number): boolean {
  const prefix = value.slice(0, position);
  return new RegExp(`\\b(?:${scopedNegationSource})\\b(?:\\s+[\\w'-]+){0,${maxWords}}\\s*$`, "i").test(
    prefix,
  );
}

function actionIsNegated(value: string, actionStart: number): boolean {
  return hasScopedNegationBefore(value, actionStart, 6);
}

function findGoverningAction(clauseText: string, candidateStart: number): GoverningAction | null {
  const actions: GoverningAction[] = [];
  actionPattern.lastIndex = 0;
  for (const match of clauseText.matchAll(actionPattern)) {
    if (match.index === undefined || actionIsNegated(clauseText, match.index)) {
      continue;
    }
    const verb = match[0].toLowerCase();
    const end = match.index + match[0].length;
    const precedesCandidate = end <= candidateStart;
    const followsCandidateFit = verb === "fit" && match.index >= candidateStart;
    if (!precedesCandidate && !followsCandidateFit) {
      continue;
    }
    const distance = wordDistance(clauseText, end, candidateStart);
    if (distance <= maxActionDistanceWords) {
      actions.push({ verb, start: match.index, end });
    }
  }
  return (
    actions.sort(
      (left, right) =>
        wordDistance(clauseText, left.end, candidateStart) -
        wordDistance(clauseText, right.end, candidateStart),
    )[0] ?? null
  );
}

function cueIsNegated(value: string, cueStart: number): boolean {
  const prefix = value.slice(0, cueStart);
  return (
    hasScopedNegationBefore(value, cueStart, 3) || /\b(?:excluding|no)\b(?:\s+[\w'-]+){0,2}\s*$/i.test(prefix)
  );
}

function hasPositiveCue(value: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index !== undefined && !cueIsNegated(value, match.index)) {
      return true;
    }
  }
  return false;
}

function maskCandidate(clauseText: string, candidateStart: number, candidateEnd: number): string {
  return `${clauseText.slice(0, candidateStart)}${" ".repeat(candidateEnd - candidateStart)}${clauseText.slice(candidateEnd)}`;
}

function candidateIsNegated(clauseText: string, candidate: TextRange): boolean {
  if (hasScopedNegationBefore(clauseText, candidate.start, 12)) {
    return true;
  }
  const suffix = clauseText.slice(candidate.end);
  return /^(?:\s+[\w'-]+){0,4}\s+(?:not\s+anymore|no\s+longer)\b/i.test(suffix);
}

function hasQueenBedContext(clauseText: string, candidate: TextRange, action: GoverningAction): boolean {
  const context = maskCandidate(clauseText, candidate.start, candidate.end);
  if (literalBagContextPattern.test(context)) {
    return false;
  }
  if (hasPositiveCue(context, explicitBedContextPattern)) {
    return true;
  }
  if (!hasPositiveCue(context, layoutEntityPattern)) {
    return false;
  }
  return (
    strongLayoutActions.has(action.verb) ||
    hasPositiveCue(context, spatialContextPattern) ||
    /\b(?:furniture|layout|nursery)\b/i.test(context)
  );
}

function hasBabyBedContext(clauseText: string, candidate: TextRange): boolean {
  return hasPositiveCue(maskCandidate(clauseText, candidate.start, candidate.end), babyBedContextPattern);
}

function collectCandidates(rawTranscript: string, quotedRanges: readonly TextRange[]): CorrectionCandidate[] {
  const candidates: CorrectionCandidate[] = [];
  const patterns = [
    { id: "queen-bed" as const, pattern: queenBagPattern, replacement: "queen-size bed" },
    { id: "baby-bed" as const, pattern: creepPattern, replacement: "baby bed" },
  ];

  for (const candidatePattern of patterns) {
    candidatePattern.pattern.lastIndex = 0;
    for (const match of rawTranscript.matchAll(candidatePattern.pattern)) {
      if (match.index === undefined) {
        continue;
      }
      const start = match.index;
      const end = start + match[0].length;
      if (quotedRanges.some((range) => overlapsRange(start, end, range))) {
        continue;
      }
      const window = findCandidateWindow(rawTranscript, { start, end }, quotedRanges);
      const maskedClause = maskRanges(window.text, window.start, quotedRanges);
      const localCandidate = { start: start - window.start, end: end - window.start };
      if (candidateIsNegated(maskedClause, localCandidate)) {
        continue;
      }
      const action = findGoverningAction(maskedClause, localCandidate.start);
      if (action === null) {
        continue;
      }
      const hasContext =
        candidatePattern.id === "queen-bed"
          ? hasQueenBedContext(maskedClause, localCandidate, action)
          : hasBabyBedContext(maskedClause, localCandidate);
      if (hasContext) {
        candidates.push({ start, end, id: candidatePattern.id, replacement: candidatePattern.replacement });
      }
    }
  }

  return candidates.sort((left, right) => left.start - right.start);
}

export function applySpeechCorrectionSuggestions(rawTranscript: string): SpeechCorrectionResult {
  const quotedRanges = collectQuotedRanges(rawTranscript);
  const candidates = collectCandidates(rawTranscript, quotedRanges);
  const corrections: SpeechCorrection[] = [];
  let cursor = 0;
  let correctedTranscript = "";

  for (const candidate of candidates) {
    const original = rawTranscript.slice(candidate.start, candidate.end);
    correctedTranscript += rawTranscript.slice(cursor, candidate.start);
    correctedTranscript += candidate.replacement;
    corrections.push({
      id: candidate.id,
      original,
      replacement: candidate.replacement,
    });
    cursor = candidate.end;
  }
  correctedTranscript += rawTranscript.slice(cursor);

  return {
    rawTranscript,
    correctedTranscript,
    corrections,
  };
}
