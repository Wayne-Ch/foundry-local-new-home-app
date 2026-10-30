export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface TableClauseOccurrence {
  readonly index: number;
  readonly table: TextSpan;
  readonly clause: TextSpan;
}

export interface CoordinatedPhraseParse {
  readonly components: readonly TextSpan[];
  readonly complete: boolean;
}

type ClauseTokenKind = "word" | "comma" | "hard-boundary" | "symbol";

interface ClauseToken extends TextSpan {
  readonly kind: ClauseTokenKind;
  readonly value: string;
}

interface ClauseSplit {
  readonly leftEnd: number;
  readonly rightStart: number;
}

function wordSet(value: string): ReadonlySet<string> {
  return new Set(value.split(" "));
}

const tableClauseCoordinators = new Set(["and", "nor", "or", "plus", "then"]);
const phraseCoordinators = new Set(["and", "nor", "or", "plus", "with"]);
const tableClauseActions = wordSet(
  "add bring carry change choose compare display drop fit format get go hold include keep leave mount move need organize output place position prefer present provide put render remove replace retain return select set show store summarize support swap switch tabulate take try use want",
);
const tableBindingPrepositions = wordSet(
  "against along alongside as beneath beside between behind by front in into near next on onto under upon",
);
const actionLeadWords = wordSet("also could did do does i it never not please should then they we would you");

function tokenizeClause(value: string): readonly ClauseToken[] {
  return [...value.matchAll(/[a-z0-9]+(?:'[a-z]+)?|[,;.!?]|[^\s]/gi)].map((match) => {
    const token = match[0];
    const normalizedToken = token.toLowerCase();
    const start = match.index;
    const kind: ClauseTokenKind =
      token === ","
        ? "comma"
        : /[;.!?]/.test(token)
          ? "hard-boundary"
          : /^[a-z0-9]/.test(normalizedToken)
            ? "word"
            : "symbol";
    return {
      kind,
      value: normalizedToken,
      start,
      end: start + token.length,
    };
  });
}

function trimSpan(value: string, span: TextSpan): TextSpan {
  let { start, end } = span;
  while (start < end && /\s/.test(value[start] ?? "")) {
    start += 1;
  }
  while (end > start && /\s/.test(value[end - 1] ?? "")) {
    end -= 1;
  }
  return { start, end };
}

function hardClauseSpans(value: string, tokens: readonly ClauseToken[]): readonly TextSpan[] {
  const spans: TextSpan[] = [];
  let start = 0;
  for (const token of tokens) {
    if (token.kind !== "hard-boundary" && !(token.kind === "word" && token.value === "but")) {
      continue;
    }
    const span = trimSpan(value, { start, end: token.start });
    if (span.start < span.end) {
      spans.push(span);
    }
    start = token.end;
  }
  const finalSpan = trimSpan(value, { start, end: value.length });
  if (finalSpan.start < finalSpan.end) {
    spans.push(finalSpan);
  }
  return spans;
}

function splitBetweenTables(
  value: string,
  tokens: readonly ClauseToken[],
  left: TextSpan,
  right: TextSpan,
): ClauseSplit {
  const gapTokens = tokens.filter((token) => token.start >= left.end && token.end <= right.start);
  const candidates: ClauseSplit[] = [];
  for (let index = 0; index < gapTokens.length; index += 1) {
    const token = gapTokens[index];
    if (token === undefined) {
      continue;
    }
    if (token.kind === "comma") {
      const next = gapTokens[index + 1];
      if (
        next?.kind === "word" &&
        tableClauseCoordinators.has(next.value) &&
        value.slice(token.end, next.start).trim().length === 0
      ) {
        candidates.push({ leftEnd: token.start, rightStart: next.end });
        index += 1;
      } else {
        candidates.push({ leftEnd: token.start, rightStart: token.end });
      }
    } else if (token.kind === "word" && tableClauseCoordinators.has(token.value)) {
      candidates.push({ leftEnd: token.start, rightStart: token.end });
    }
  }
  if (candidates.length === 0) {
    return { leftEnd: left.end, rightStart: left.end };
  }

  for (const candidate of candidates) {
    const words = gapTokens
      .filter((token) => token.kind === "word" && token.start >= candidate.rightStart)
      .map((token) => token.value);
    const actionIndex = words.findIndex((word) => tableClauseActions.has(word));
    if (
      (actionIndex >= 0 && words.slice(0, actionIndex).every((word) => actionLeadWords.has(word))) ||
      (actionIndex < 0 && words.some((word) => tableBindingPrepositions.has(word)))
    ) {
      return candidate;
    }
  }
  return candidates.at(-1) ?? { leftEnd: right.start, rightStart: right.start };
}

export function parseTableClauseOccurrences(value: string): readonly TableClauseOccurrence[] {
  const tokens = tokenizeClause(value);
  const occurrences: TableClauseOccurrence[] = [];
  for (const hardClause of hardClauseSpans(value, tokens)) {
    const tables = tokens
      .filter(
        (token) =>
          token.kind === "word" &&
          (token.value === "table" || token.value === "tables") &&
          token.start >= hardClause.start &&
          token.end <= hardClause.end,
      )
      .map((token) => ({ start: token.start, end: token.end }));
    if (tables.length === 0) {
      continue;
    }

    const splits = tables.slice(0, -1).map((table, index) => {
      const next = tables[index + 1];
      return next === undefined
        ? { leftEnd: hardClause.end, rightStart: hardClause.end }
        : splitBetweenTables(value, tokens, table, next);
    });

    for (let index = 0; index < tables.length; index += 1) {
      const table = tables[index];
      if (table === undefined) {
        continue;
      }
      const clause = trimSpan(value, {
        start: index === 0 ? hardClause.start : (splits[index - 1]?.rightStart ?? hardClause.start),
        end: index === tables.length - 1 ? hardClause.end : (splits[index]?.leftEnd ?? hardClause.end),
      });
      occurrences.push({
        index: occurrences.length,
        table,
        clause,
      });
    }
  }
  return occurrences;
}

export function parseCoordinatedPhrase(value: string): CoordinatedPhraseParse {
  const tokens = tokenizeClause(value);
  const separators = tokens.filter(
    (token) =>
      token.kind === "comma" ||
      token.value === "+" ||
      (token.kind === "word" && phraseCoordinators.has(token.value)),
  );
  const components: TextSpan[] = [];
  let componentStart = 0;
  let previousSeparator: ClauseTokenKind | "coordinator" | null = null;
  let complete = true;

  for (const separator of separators) {
    const component = trimSpan(value, { start: componentStart, end: separator.start });
    if (component.start < component.end) {
      components.push(component);
    } else if (!(previousSeparator === "comma" && separator.kind === "word")) {
      complete = false;
    }
    previousSeparator = separator.kind === "comma" ? "comma" : "coordinator";
    componentStart = separator.end;
  }

  const finalComponent = trimSpan(value, { start: componentStart, end: value.length });
  if (finalComponent.start < finalComponent.end) {
    components.push(finalComponent);
  } else {
    complete = false;
  }

  return {
    components,
    complete: complete && components.length > 0,
  };
}
