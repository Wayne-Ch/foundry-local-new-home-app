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

interface CorrectionCandidate extends TextRange {
  readonly id: SpeechCorrection["id"];
  readonly replacement: string;
}

interface WordToken extends TextRange {
  readonly value: string;
  readonly normalized: string;
}

interface GoverningAction {
  readonly verb: string;
  readonly start: number;
  readonly end: number;
}

const governingActions = new Set([
  "add",
  "arrange",
  "bring",
  "fit",
  "include",
  "keep",
  "move",
  "need",
  "place",
  "position",
  "put",
  "remove",
  "replace",
  "require",
  "retain",
  "swap",
  "use",
  "want",
]);
const replacementActions = new Set(["replace", "swap"]);
const replacementConnectors = new Set(["for", "with"]);
const directObjectLeadWords = new Set([
  "a",
  "an",
  "another",
  "any",
  "current",
  "existing",
  "her",
  "his",
  "its",
  "my",
  "new",
  "old",
  "our",
  "same",
  "some",
  "that",
  "the",
  "their",
  "these",
  "this",
  "those",
  "your",
]);
const clauseBoundaryWords = new Set([
  "after",
  "although",
  "and",
  "as",
  "because",
  "before",
  "but",
  "if",
  "nor",
  "once",
  "or",
  "since",
  "so",
  "then",
  "though",
  "unless",
  "until",
  "when",
  "whenever",
  "whereas",
  "while",
  "yet",
]);
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
const hardClauseBoundaryPattern = /[.!?;:\r\n]+/g;
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
const contextOnlyActions = new Set(["keep", "retain"]);
const maxActionDistanceWords = 6;
const maxContextWordsAfterCandidate = 10;
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

function collectWordTokens(value: string, end = value.length): WordToken[] {
  const tokens: WordToken[] = [];
  wordTokenPattern.lastIndex = 0;
  for (const match of value.slice(0, end).matchAll(wordTokenPattern)) {
    if (match.index === undefined) {
      continue;
    }
    tokens.push({
      value: match[0],
      normalized: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

function containsOnlyWordsAndWhitespace(value: string, tokens: readonly WordToken[]): boolean {
  let cursor = 0;
  for (const token of tokens) {
    if (value.slice(cursor, token.start).trim() !== "") {
      return false;
    }
    cursor = token.end;
  }
  return value.slice(cursor).trim() === "";
}

function hasDirectObjectShape(action: string, gapTokens: readonly WordToken[]): boolean {
  if (gapTokens.length <= 3 && gapTokens.every((token) => directObjectLeadWords.has(token.normalized))) {
    return true;
  }
  if (!replacementActions.has(action)) {
    return false;
  }
  const connectorIndex = gapTokens.findIndex((token) => replacementConnectors.has(token.normalized));
  if (connectorIndex < 1 || connectorIndex > 3) {
    return false;
  }
  const replacedObject = gapTokens.slice(0, connectorIndex);
  const candidateLead = gapTokens.slice(connectorIndex + 1);
  const replacedNouns = replacedObject.filter((token) => !directObjectLeadWords.has(token.normalized));
  return (
    replacedNouns.length >= 1 &&
    replacedNouns.length <= 2 &&
    candidateLead.length <= 2 &&
    candidateLead.every((token) => directObjectLeadWords.has(token.normalized))
  );
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

function findDirectGoverningAction(clauseText: string, candidateStart: number): GoverningAction | null {
  const tokens = collectWordTokens(clauseText, candidateStart);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token === undefined || !governingActions.has(token.normalized)) {
      continue;
    }
    const gapText = clauseText.slice(token.end, candidateStart);
    const gapTokens = collectWordTokens(gapText);
    if (gapTokens.length > maxActionDistanceWords) {
      return null;
    }
    if (
      actionIsNegated(clauseText, token.start) ||
      !containsOnlyWordsAndWhitespace(gapText, gapTokens) ||
      gapTokens.some((gapToken) => clauseBoundaryWords.has(gapToken.normalized)) ||
      !hasDirectObjectShape(token.normalized, gapTokens)
    ) {
      return null;
    }
    return {
      verb: token.normalized,
      start: token.start,
      end: token.end,
    };
  }
  return null;
}

function findLocalContextEnd(clauseText: string, candidateEnd: number): number {
  const suffix = clauseText.slice(candidateEnd);
  const tokens = collectWordTokens(suffix);
  let end = candidateEnd;
  let wordCount = 0;
  for (const token of tokens) {
    const separator = suffix.slice(end - candidateEnd, token.start);
    if (
      separator.trim() !== "" ||
      (clauseBoundaryWords.has(token.normalized) && token.normalized !== "as") ||
      subjectPronouns.has(token.normalized) ||
      /^[A-Z]/.test(token.value)
    ) {
      break;
    }
    wordCount += 1;
    if (wordCount > maxContextWordsAfterCandidate) {
      break;
    }
    end = candidateEnd + token.end;
  }
  return end;
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
  if (hasPositiveCue(context, explicitBedContextPattern)) {
    return true;
  }
  if (contextOnlyActions.has(action.verb)) {
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
      const window = findHardCandidateWindow(rawTranscript, { start, end }, quotedRanges);
      const maskedClause = maskRanges(
        rawTranscript.slice(window.start, window.end),
        window.start,
        quotedRanges,
      );
      const localCandidate = { start: start - window.start, end: end - window.start };
      if (candidateIsNegated(maskedClause, localCandidate)) {
        continue;
      }
      const action = findDirectGoverningAction(maskedClause, localCandidate.start);
      if (action === null) {
        continue;
      }
      if (
        candidatePattern.id === "queen-bed" &&
        literalBagContextPattern.test(maskCandidate(maskedClause, localCandidate.start, localCandidate.end))
      ) {
        continue;
      }
      const contextEnd = findLocalContextEnd(maskedClause, localCandidate.end);
      const context = maskedClause.slice(action.start, contextEnd);
      const contextCandidate = {
        start: localCandidate.start - action.start,
        end: localCandidate.end - action.start,
      };
      const contextAction = {
        ...action,
        start: 0,
        end: action.end - action.start,
      };
      const hasContext =
        candidatePattern.id === "queen-bed"
          ? hasQueenBedContext(context, contextCandidate, contextAction)
          : hasBabyBedContext(context, contextCandidate);
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
