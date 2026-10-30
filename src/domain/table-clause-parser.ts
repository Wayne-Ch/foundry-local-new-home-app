import { findTableActionMatches, type TableActionId, tableActionLeadWords } from "./table-actions";

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface TableActionContext {
  readonly source: "local" | "inherited";
  readonly id: TableActionId;
  readonly action: TextSpan;
  readonly scope: TextSpan;
}

export interface TableClauseOccurrence {
  readonly index: number;
  readonly table: TextSpan;
  readonly clause: TextSpan;
  readonly scope: TextSpan;
  readonly coordinator: TextSpan | null;
  readonly actionContext: TableActionContext | null;
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
  readonly coordinator: TextSpan | null;
}

function wordSet(value: string): ReadonlySet<string> {
  return new Set(value.split(" "));
}

const tableClauseCoordinators = new Set(["and", "nor", "or", "plus", "then"]);
const phraseCoordinators = new Set(["and", "nor", "or", "plus", "with"]);
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
        candidates.push({
          leftEnd: token.start,
          rightStart: next.end,
          coordinator: { start: token.start, end: next.end },
        });
        index += 1;
      } else {
        candidates.push({
          leftEnd: token.start,
          rightStart: token.end,
          coordinator: { start: token.start, end: token.end },
        });
      }
    } else if (token.kind === "word" && tableClauseCoordinators.has(token.value)) {
      candidates.push({
        leftEnd: token.start,
        rightStart: token.end,
        coordinator: { start: token.start, end: token.end },
      });
    }
  }
  if (candidates.length === 0) {
    return { leftEnd: left.end, rightStart: left.end, coordinator: null };
  }

  for (const candidate of candidates) {
    const words = gapTokens
      .filter((token) => token.kind === "word" && token.start >= candidate.rightStart)
      .map((token) => token.value);
    const actionIndex = words.findIndex((word) => tableActionLeadWords.has(word));
    if (
      (actionIndex >= 0 && words.slice(0, actionIndex).every((word) => actionLeadWords.has(word))) ||
      (actionIndex < 0 && words.some((word) => tableBindingPrepositions.has(word)))
    ) {
      return candidate;
    }
  }
  return (
    candidates.at(-1) ?? {
      leftEnd: right.start,
      rightStart: right.start,
      coordinator: null,
    }
  );
}

function governingTableActions(
  value: string,
  scope: TextSpan,
): readonly { readonly id: TableActionId; readonly action: TextSpan }[] {
  return findTableActionMatches(value.slice(scope.start, scope.end)).map((match) => ({
    id: match.id,
    action: {
      start: scope.start + match.start,
      end: scope.start + match.end,
    },
  }));
}

function localGoverningTableAction(
  value: string,
  actions: readonly { readonly id: TableActionId; readonly action: TextSpan }[],
  clause: TextSpan,
  table: TextSpan,
): Omit<TableActionContext, "source"> | null {
  const candidates = actions.filter(
    (action) => action.action.start >= clause.start && action.action.end <= table.start,
  );
  let selected = candidates[0] ?? null;
  let scopeStart = clause.start;
  for (const candidate of candidates.slice(1)) {
    if (selected === null) {
      selected = candidate;
      continue;
    }
    const between = value.slice(selected.action.end, candidate.action.start);
    const resetBoundary =
      /(?<boundary>,\s*(?:(?:and|or|nor|then|but)\s+)?|\b(?:and|or|nor|then|but)\s+)(?:(?:also|could|did|do|does|don't|i|it|never|no\s+longer|not|please|should|then|they|we|would|you)\s+)*$/i.exec(
        between,
      );
    if (resetBoundary !== null) {
      selected = candidate;
      scopeStart =
        selected.action.start -
        between.length +
        resetBoundary.index +
        (resetBoundary.groups?.boundary?.length ?? 0);
    } else if (/\bto\s+(?:(?:also|please)\s+)*$/i.test(between)) {
      selected = candidate;
    }
  }
  return selected === null
    ? null
    : {
        id: selected.id,
        action: selected.action,
        scope: {
          start: scopeStart,
          end: clause.end,
        },
      };
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
        ? { leftEnd: hardClause.end, rightStart: hardClause.end, coordinator: null }
        : splitBetweenTables(value, tokens, table, next);
    });
    const actions = governingTableActions(value, hardClause);
    let governingAction: Omit<TableActionContext, "source"> | null = null;

    for (let index = 0; index < tables.length; index += 1) {
      const table = tables[index];
      if (table === undefined) {
        continue;
      }
      const precedingSplit = index === 0 ? undefined : splits[index - 1];
      const clause = trimSpan(value, {
        start: index === 0 ? hardClause.start : (precedingSplit?.rightStart ?? hardClause.start),
        end: index === tables.length - 1 ? hardClause.end : (splits[index]?.leftEnd ?? hardClause.end),
      });
      const localActionMatch = localGoverningTableAction(value, actions, clause, table);
      const localAction: TableActionContext | null =
        localActionMatch === null
          ? null
          : {
              source: "local",
              id: localActionMatch.id,
              action: localActionMatch.action,
              scope: localActionMatch.scope,
            };
      const inheritedAction =
        localAction === null && precedingSplit?.coordinator != null && governingAction !== null
          ? {
              source: "inherited" as const,
              ...governingAction,
            }
          : null;
      const actionContext = localAction ?? inheritedAction;
      if (localAction !== null) {
        governingAction = {
          id: localAction.id,
          action: localAction.action,
          scope: localAction.scope,
        };
      } else if (precedingSplit?.coordinator === null) {
        governingAction = null;
      }
      occurrences.push({
        index: occurrences.length,
        table,
        clause,
        scope: hardClause,
        coordinator: precedingSplit?.coordinator ?? null,
        actionContext,
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
