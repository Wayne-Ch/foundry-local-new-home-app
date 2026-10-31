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
const babyBedGoverningActions = new Set([
  "add",
  "arrange",
  "bring",
  "fit",
  "include",
  "need",
  "place",
  "position",
  "put",
  "replace",
  "require",
  "swap",
  "use",
  "want",
]);
const replacementActions = new Set(["replace", "swap"]);
const replacementConnectors = new Set(["for", "with"]);
const actionParticles = new Map<string, ReadonlySet<string>>([
  ["bring", new Set(["in"])],
  ["fit", new Set(["in"])],
  ["put", new Set(["in"])],
]);
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
const explicitBedContextWords = new Set(["bed", "bedroom", "headboard", "mattress", "sleep", "sleeping"]);
const layoutEntityWords = new Set([
  "closet",
  "cot",
  "crib",
  "desk",
  "door",
  "furniture",
  "layout",
  "nursery",
  "wall",
  "window",
]);
const spatialContextWords = new Set([
  "against",
  "along",
  "beside",
  "between",
  "blocking",
  "by",
  "clear",
  "inside",
  "near",
  "next",
  "opposite",
  "under",
  "within",
]);
const babyBedContextWords = new Set(["baby", "cot", "crib", "infant", "newborn", "nursery", "toddler"]);
const literalBagContextWords = new Set([
  "baggage",
  "carry-on",
  "carryon",
  "journey",
  "luggage",
  "suitcase",
  "travel",
  "trip",
  "vacation",
]);
const localContextLeadWords = new Set([
  "against",
  "along",
  "at",
  "beside",
  "by",
  "for",
  "in",
  "inside",
  "near",
  "next",
  "within",
]);
const interruptionModifierWords = new Set([
  "absolutely",
  "actually",
  "all",
  "any",
  "at",
  "by",
  "case",
  "certainly",
  "circumstances",
  "currently",
  "definitely",
  "ever",
  "in",
  "just",
  "kindly",
  "means",
  "now",
  "please",
  "really",
  "simply",
  "under",
  "whatsoever",
]);
const strongLayoutActions = new Set(["arrange", "fit", "move", "place", "position", "replace", "swap"]);
const contextOnlyActions = new Set(["keep", "retain"]);
const defaultContextBoundaryExceptions = new Set(["as"]);
const literalBagContextBoundaryExceptions = new Set(["after", "as", "before"]);
const maxActionDistanceWords = 6;
const maxContextWordsAfterCandidate = 10;

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
  const allowedParticles = actionParticles.get(action);
  const objectTokens =
    gapTokens[0] !== undefined && allowedParticles?.has(gapTokens[0].normalized) === true
      ? gapTokens.slice(1)
      : gapTokens;
  if (
    objectTokens.length <= 3 &&
    objectTokens.every((token) => directObjectLeadWords.has(token.normalized))
  ) {
    return true;
  }
  if (!replacementActions.has(action)) {
    return false;
  }
  const connectorIndex = objectTokens.findIndex((token) => replacementConnectors.has(token.normalized));
  if (connectorIndex < 1 || connectorIndex > 3) {
    return false;
  }
  const replacedObject = objectTokens.slice(0, connectorIndex);
  const candidateLead = objectTokens.slice(connectorIndex + 1);
  const replacedNouns = replacedObject.filter((token) => !directObjectLeadWords.has(token.normalized));
  return (
    replacedNouns.length >= 1 &&
    replacedNouns.length <= 2 &&
    candidateLead.length <= 2 &&
    candidateLead.every((token) => directObjectLeadWords.has(token.normalized))
  );
}

function containsTokenSequence(tokens: readonly WordToken[], sequence: readonly string[]): boolean {
  if (sequence.length === 0 || tokens.length < sequence.length) {
    return false;
  }
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((word, offset) => tokens[index + offset]?.normalized === word)) {
      return true;
    }
  }
  return false;
}

function tokenIsAvoidance(token: WordToken): boolean {
  return /^(?:avoid|avoided|avoiding|avoids|exclude|excluded|excluding|excludes)$/.test(token.normalized);
}

function containsNegationCue(tokens: readonly WordToken[]): boolean {
  return (
    tokens.some(
      (token) =>
        token.normalized === "don't" ||
        token.normalized === "dont" ||
        token.normalized === "never" ||
        token.normalized === "not" ||
        token.normalized === "without" ||
        tokenIsAvoidance(token),
    ) ||
    containsTokenSequence(tokens, ["do", "not"]) ||
    containsTokenSequence(tokens, ["no", "need", "to"]) ||
    containsTokenSequence(tokens, ["no", "longer"]) ||
    containsTokenSequence(tokens, ["rather", "than"])
  );
}

function endsWithNegationCue(tokens: readonly WordToken[]): boolean {
  const normalized = tokens.map((token) => token.normalized);
  const suffixMatches = (sequence: readonly string[]) =>
    normalized.length >= sequence.length &&
    sequence.every((word, offset) => normalized[normalized.length - sequence.length + offset] === word);
  return (
    suffixMatches(["don't"]) ||
    suffixMatches(["dont"]) ||
    suffixMatches(["never"]) ||
    suffixMatches(["not"]) ||
    suffixMatches(["do", "not"]) ||
    suffixMatches(["no", "need", "to"]) ||
    suffixMatches(["no", "longer"])
  );
}

function tokensAreInterruptionModifiers(tokens: readonly WordToken[]): boolean {
  return tokens.every((token) => interruptionModifierWords.has(token.normalized));
}

function tokensAreLocalContextPhrase(tokens: readonly WordToken[]): boolean {
  const first = tokens[0];
  if (first === undefined || !localContextLeadWords.has(first.normalized)) {
    return false;
  }
  return tokens.some(
    (token) =>
      babyBedContextWords.has(token.normalized) ||
      layoutEntityWords.has(token.normalized) ||
      literalBagContextWords.has(token.normalized) ||
      token.normalized.startsWith("pack"),
  );
}

function findLocalModifierStart(clauseText: string, actionStart: number): number {
  const tokens = collectWordTokens(clauseText, actionStart);
  let boundaryStart = 0;
  for (const token of tokens) {
    if (clauseBoundaryWords.has(token.normalized)) {
      boundaryStart = token.end;
    }
  }

  const commaIndexes: number[] = [];
  for (let index = boundaryStart; index < actionStart; index += 1) {
    if (clauseText[index] === ",") {
      commaIndexes.push(index);
    }
  }
  if (commaIndexes.length === 0) {
    return boundaryStart;
  }

  let localStart = (commaIndexes.at(-1) ?? boundaryStart - 1) + 1;
  let trailingTokens = collectWordTokens(clauseText.slice(localStart, actionStart));
  for (let index = commaIndexes.length - 1; index >= 0; index -= 1) {
    const comma = commaIndexes[index];
    if (comma === undefined || !tokensAreInterruptionModifiers(trailingTokens)) {
      break;
    }
    const priorStart = index === 0 ? boundaryStart : (commaIndexes[index - 1] ?? boundaryStart - 1) + 1;
    const priorTokens = collectWordTokens(clauseText.slice(priorStart, comma));
    if (
      !endsWithNegationCue(priorTokens) &&
      !tokensAreInterruptionModifiers(priorTokens) &&
      !tokensAreLocalContextPhrase(priorTokens)
    ) {
      break;
    }
    localStart = priorStart;
    trailingTokens = [...priorTokens, ...trailingTokens];
  }
  return localStart;
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

function findLocalContextEnd(
  clauseText: string,
  candidateEnd: number,
  boundaryExceptions = defaultContextBoundaryExceptions,
): number {
  const suffix = clauseText.slice(candidateEnd);
  const tokens = collectWordTokens(suffix);
  let end = candidateEnd;
  let wordCount = 0;
  for (const token of tokens) {
    const separator = suffix.slice(end - candidateEnd, token.start);
    if (
      separator.trim() !== "" ||
      (clauseBoundaryWords.has(token.normalized) && !boundaryExceptions.has(token.normalized)) ||
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

function cueIsNegated(tokens: readonly WordToken[], cueIndex: number): boolean {
  const prefix = tokens.slice(Math.max(0, cueIndex - 4), cueIndex);
  const previous = tokens[cueIndex - 1];
  return containsNegationCue(prefix) || previous?.normalized === "no";
}

function hasPositiveCue(tokens: readonly WordToken[], words: ReadonlySet<string>): boolean {
  for (const [index, token] of tokens.entries()) {
    if (words.has(token.normalized) && !cueIsNegated(tokens, index)) {
      return true;
    }
  }
  return false;
}

function maskCandidate(clauseText: string, candidateStart: number, candidateEnd: number): string {
  return `${clauseText.slice(0, candidateStart)}${" ".repeat(candidateEnd - candidateStart)}${clauseText.slice(candidateEnd)}`;
}

function candidateIsNegated(localText: string, candidate: TextRange, action: GoverningAction): boolean {
  const beforeAction = collectWordTokens(localText, action.start);
  if (containsNegationCue(beforeAction)) {
    return true;
  }
  const actionToCandidate = collectWordTokens(localText.slice(action.end, candidate.start));
  if (containsNegationCue(actionToCandidate)) {
    return true;
  }
  const suffix = collectWordTokens(localText.slice(candidate.end)).slice(0, 6);
  return containsTokenSequence(suffix, ["not", "anymore"]) || containsTokenSequence(suffix, ["no", "longer"]);
}

function hasQueenBedContext(clauseText: string, candidate: TextRange, action: GoverningAction): boolean {
  const contextTokens = collectWordTokens(maskCandidate(clauseText, candidate.start, candidate.end));
  if (hasPositiveCue(contextTokens, explicitBedContextWords)) {
    return true;
  }
  if (contextOnlyActions.has(action.verb)) {
    return true;
  }
  if (!hasPositiveCue(contextTokens, layoutEntityWords)) {
    return false;
  }
  return (
    strongLayoutActions.has(action.verb) ||
    hasPositiveCue(contextTokens, spatialContextWords) ||
    contextTokens.some((token) => ["furniture", "layout", "nursery"].includes(token.normalized))
  );
}

function hasBabyBedContext(clauseText: string, candidate: TextRange): boolean {
  const contextTokens = collectWordTokens(maskCandidate(clauseText, candidate.start, candidate.end));
  return hasPositiveCue(contextTokens, babyBedContextWords);
}

function hasLiteralBagContext(clauseText: string, candidate: TextRange): boolean {
  const contextTokens = collectWordTokens(maskCandidate(clauseText, candidate.start, candidate.end));
  return contextTokens.some(
    (token) => literalBagContextWords.has(token.normalized) || token.normalized.startsWith("pack"),
  );
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
      const action = findDirectGoverningAction(maskedClause, localCandidate.start);
      if (action === null) {
        continue;
      }
      if (candidatePattern.id === "baby-bed" && !babyBedGoverningActions.has(action.verb)) {
        continue;
      }
      const localStart = findLocalModifierStart(maskedClause, action.start);
      const contextEnd = findLocalContextEnd(maskedClause, localCandidate.end);
      const literalBagContextEnd = findLocalContextEnd(
        maskedClause,
        localCandidate.end,
        literalBagContextBoundaryExceptions,
      );
      const context = maskedClause.slice(localStart, contextEnd);
      const contextCandidate = {
        start: localCandidate.start - localStart,
        end: localCandidate.end - localStart,
      };
      const contextAction = {
        ...action,
        start: action.start - localStart,
        end: action.end - localStart,
      };
      if (candidateIsNegated(context, contextCandidate, contextAction)) {
        continue;
      }
      if (
        candidatePattern.id === "queen-bed" &&
        hasLiteralBagContext(maskedClause.slice(localStart, literalBagContextEnd), contextCandidate)
      ) {
        continue;
      }
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
