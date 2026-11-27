import { splitSeenAndUnseen } from '../clipboard/paste-that-waits.ts';
import type { PieceOfPastedText } from '../clipboard/paste-that-waits.ts';

/** How a dialect of SQL escapes a quote inside a quoted text. */
export type SqlEscaping = 'backslash' | 'spark' | 'doubled';
/** What a run of SQL is, as the tokenizer cuts it. */
export type SqlTokenKindOfText = 'punct' | 'space' | 'comment' | 'name' | 'string' | 'word' | 'number' | 'placeholder';
export interface SqlToken {
  kind: SqlTokenKindOfText;
  text: string;
  /** `true` when a comment or a quoted text runs to the end without closing. */
  open?: boolean;
}
/** A token that is not a space, with the space before it and how many brackets hold it. */
export interface PlacedSqlToken {
  kind: SqlTokenKindOfText;
  text: string;
  before: string;
  depth: number;
}
/** How a piece of SQL is coloured when shown as code. */
export type SqlCodeKind = 'keyword' | 'number' | 'function' | 'string' | 'comment' | 'placeholder';
/** A piece of shown code: the pasted-text piece it is, and how it is coloured. */
export type PieceOfCode = PieceOfPastedText & { kind?: SqlCodeKind | undefined };

export function sqlPlaceholderEnd(text: string, at: number): number {
  return ((SQL_PLACEHOLDER_STICKY.lastIndex = at), SQL_PLACEHOLDER_STICKY.test(text) ? SQL_PLACEHOLDER_STICKY.lastIndex : -1);
}
export function sqlQuotedEnd(text: string, at: number, quote: string, escaping: SqlEscaping, isRaw: boolean): number {
  let closing = escaping === 'backslash' && quote !== '`' && text.startsWith(quote + quote + quote, at) ? quote + quote + quote : quote,
    takesBackslash = escaping !== 'doubled' && !isRaw;
  for (let index = at + closing.length; index < text.length; index++)
    if (takesBackslash && text[index] === '\\') index++;
    else if (text.startsWith(closing, index)) return index + closing.length;
  return -1;
}
export function tokenizeSql(text: string, escaping: SqlEscaping, takesPlaceholders: boolean): SqlToken[] {
  let tokens: SqlToken[] = [],
    length = text.length,
    at = 0,
    lineEnd = (from: number): number => {
      let index = from;
      while (index < length && text[index] !== '\n' && text[index] !== '\r') index++;
      return index;
    };
  while (at < length) {
    let character = text[at],
      ahead = text.slice(at, at + 256),
      kind: SqlTokenKindOfText = 'punct',
      end = at + 1,
      isOpen = false,
      space = SQL_SPACE.exec(ahead)?.[0];
    if (space !== void 0) {
      ((kind = 'space'), (end = at + space.length));
      while (end < length && SQL_SPACE.test(text[end]!)) end++;
    } else if ((character === '-' && text[at + 1] === '-') || (character === '#' && escaping !== 'spark')) ((kind = 'comment'), (end = lineEnd(at)));
    else if (character === '/' && text[at + 1] === '*') {
      kind = 'comment';
      let close = text.indexOf('*/', at + 2);
      ((isOpen = close === -1), (end = isOpen ? length : close + 2));
    } else if (character === "'" || character === '"' || character === '`') {
      kind = character === '`' ? 'name' : 'string';
      let isRaw = escaping === 'spark' && (character === '`' || /^[rR]$/.test(tokens.at(-1)?.text ?? '')),
        close = sqlQuotedEnd(text, at, character, escaping, isRaw);
      ((isOpen = close === -1), (end = isOpen ? length : close));
    } else if (SQL_WORD_START.test(ahead)) {
      ((kind = 'word'), (end = at + 1));
      while (end < length && /[A-Za-z0-9_]/.test(text[end]!)) end++;
    } else if (SQL_NUMBER.test(ahead)) ((kind = 'number'), (end = at + SQL_NUMBER.exec(ahead)![0].length));
    else if (takesPlaceholders && sqlPlaceholderEnd(text, at) !== -1) ((kind = 'placeholder'), (end = sqlPlaceholderEnd(text, at)));
    (tokens.push(isOpen ? { kind, text: text.slice(at, end), open: isOpen } : { kind, text: text.slice(at, end) }), (at = end));
  }
  return tokens;
}
export function sqlWordKind(word: string, next: SqlToken | PlacedSqlToken | undefined): SqlCodeKind | undefined {
  if (isSqlKeyword(word)) return 'keyword';
  if (isSqlLiteralWord(word)) return 'number';
  return next?.text === '(' ? 'function' : void 0;
}
export function sqlTokenKind(token: SqlToken, next: SqlToken | undefined): SqlCodeKind | undefined {
  if (token.kind === 'word') return sqlWordKind(token.text, next);
  if (token.kind === 'space' || token.kind === 'punct') return;
  return token.kind === 'name' ? 'string' : token.kind;
}
export function isWellFormedSqlToken(token: SqlToken, next: SqlToken | undefined): boolean {
  if (token.open === true) return false;
  return token.kind !== 'punct' || (SQL_PUNCTUATION.has(token.text) && !(token.text === '/' && next?.text === '/'));
}
export function sqlTokensWithDepth(tokens: SqlToken[]): PlacedSqlToken[] | null {
  let placed: PlacedSqlToken[] = [],
    closersAwaited: string[] = [],
    spaceBefore = '';
  for (let [index, token] of tokens.entries()) {
    if (token.kind === 'space') {
      spaceBefore = token.text;
      continue;
    }
    if (!isWellFormedSqlToken(token, tokens[index + 1])) return null;
    if (Object.values(SQL_CLOSING_BRACKETS).includes(token.text) && closersAwaited.pop() !== token.text) return null;
    if (
      (placed.push({
        kind: token.kind,
        text: token.text,
        before: spaceBefore,
        depth: closersAwaited.length,
      }),
      token.kind === 'punct' && Object.hasOwn(SQL_CLOSING_BRACKETS, token.text))
    )
      closersAwaited.push(SQL_CLOSING_BRACKETS[token.text]!);
    spaceBefore = '';
  }
  return closersAwaited.length === 0 ? placed : null;
}
export function sqlTokensOfAnyEscaping(text: string, escaping: SqlEscaping | undefined): SqlToken[] | null {
  if (escaping !== void 0) return sqlTokens(text, escaping);
  let [first = [], ...others] = SQL_ESCAPINGS.map((each) => sqlTokens(text, each));
  return others.every((tokens) => areSameSqlTokens(first, tokens)) ? first : null;
}
export function isStartOfSqlJoin(tokens: PlacedSqlToken[], index: number): boolean {
  if (SQL_JOIN_WORDS.has(sqlWordOf(tokens[index - 1]))) return false;
  let at = index;
  while (SQL_JOIN_WORDS.has(sqlWordOf(tokens[at]))) at++;
  return sqlWordOf(tokens[at]) === 'JOIN';
}
export function sqlClauseAt(tokens: PlacedSqlToken[], index: number): string | null {
  let word = sqlWordOf(tokens[index]),
    [before, after] = [tokens[index - 1], tokens[index + 1]];
  if (before?.text === '.' || sqlWordOf(before) === 'AS' || (word === 'EXCEPT' && before?.text === '*')) return '';
  let clause = SQL_CLAUSE_WORDS.has(word) ? word : '';
  if (word === 'WITH' && index === 0) clause = word;
  if ((word === 'GROUP' || word === 'ORDER') && sqlWordOf(after) === 'BY') clause = word;
  if ((word === 'JOIN' || SQL_JOIN_WORDS.has(word)) && isStartOfSqlJoin(tokens, index)) clause = 'JOIN';
  let isAmongCommas = before?.text === ',' || after?.text === ',' || (word === 'FROM' && sqlWordOf(before) === 'DISTINCT');
  return clause !== '' && isAmongCommas ? null : clause;
}
export function hasSqlAndInsideClause(tokens: PlacedSqlToken[], index: number): boolean {
  for (let at = index + 1; at < tokens.length; at++) {
    if (tokens[at]!.depth > 0) continue;
    if (sqlClauseAt(tokens, at) !== '') return false;
    if (SQL_WORDS_TAKING_AND.has(sqlWordOf(tokens[at]))) return true;
  }
  return false;
}
export function sqlLineBreaks(tokens: PlacedSqlToken[]): Map<PlacedSqlToken, string> | null {
  let breaks = new Map<PlacedSqlToken, string>(),
    clause = '',
    keepsAndOnLine = false,
    breaksAfterSelectItem = false;
  for (let index = 0; index < tokens.length; index++) {
    let token = tokens[index]!;
    if (token.depth > 0) continue;
    let word = sqlWordOf(token),
      clauseHere = sqlClauseAt(tokens, index);
    if (clauseHere === null) return null;
    let isSelectQuantifier = SQL_SELECT_QUANTIFIERS.has(word) && sqlWordOf(tokens[index - 1]) === 'SELECT',
      isConditionJoiner = SQL_CONDITION_CLAUSES.has(clause) && !keepsAndOnLine && (word === 'AND' || word === 'OR');
    if (clauseHere !== '')
      ((clause = clauseHere), (keepsAndOnLine = SQL_CONDITION_CLAUSES.has(clause) && hasSqlAndInsideClause(tokens, index)), breaks.set(token, '\n'));
    else if ((breaksAfterSelectItem && !isSelectQuantifier) || isConditionJoiner) breaks.set(token, '\n' + SQL_INDENT);
    let isCommaOnLine = token.text === ',' && !token.before.includes('\n');
    breaksAfterSelectItem = clause === 'SELECT' && (isCommaOnLine || word === 'SELECT' || isSelectQuantifier);
  }
  return breaks;
}
export function laidOutSql(text: string, escaping?: SqlEscaping): string {
  let tokens = sqlTokensOfAnyEscaping(text, escaping),
    placed = tokens === null ? null : sqlTokensWithDepth(tokens);
  if (tokens === null || placed === null) return text;
  let withoutComments = placed.filter((token) => token.kind !== 'comment'),
    semicolonAt = withoutComments.findIndex((token) => token.text === ';'),
    breaks =
      ['SELECT', 'WITH'].includes(sqlWordOf(withoutComments[0])) && (semicolonAt === -1 || semicolonAt === withoutComments.length - 1)
        ? sqlLineBreaks(withoutComments)
        : null;
  if (breaks === null) return text;
  let spaceBefore = (token: PlacedSqlToken, isFirst: boolean): string => {
      if (isFirst || token.before === '') return '';
      return breaks.get(token) ?? token.before;
    },
    laidOut = placed.map((token, index) => spaceBefore(token, index === 0) + token.text).join(''),
    tokensAfter = sqlTokens(laidOut, escaping ?? SQL_ESCAPINGS[0]).filter((token) => token.kind !== 'space');
  return areSameSqlTokens(
    tokensAfter,
    tokens.filter((token) => token.kind !== 'space'),
  )
    ? laidOut
    : text;
}
export function sqlCodePieces(text: string): PieceOfCode[] | null {
  let tokens = sqlTokensOfAnyEscaping(laidOutSql(text), void 0) ?? [],
    firstWord = tokens.find(({ kind }) => kind !== 'space' && kind !== 'comment');
  if (!SQL_QUERY_START.test(firstWord?.text ?? '')) return null;
  if (LONE_CARRIAGE_RETURN.test(text) || !tokens.every((token, index) => isWellFormedSqlToken(token, tokens[index + 1]))) return null;
  let offset = 0;
  return tokens.flatMap((token, index): PieceOfCode[] => {
    let from = offset;
    if (((offset += token.text.length), token.kind === 'space')) return [{ from, seen: token.text }];
    let kind = sqlTokenKind(token, tokens[index + 1]),
      pieces: PieceOfCode[] = [];
    for (let piece of splitSeenAndUnseen(token.text)) pieces.push({ ...piece, from: from + piece.from, kind });
    return pieces;
  });
}
export const SQL_PLACEHOLDER_PATTERN = new RegExp('\\{\\{[ \\t]*([A-Za-z_][A-Za-z0-9_]{0,63})[ \\t]*\\}\\}');
export const SQL_PLACEHOLDER_ALONE_PATTERN = new RegExp('^[ \\t]*' + SQL_PLACEHOLDER_PATTERN.source + '[ \\t]*$');
export const SQL_KEYWORDS = new Set(
  'ALL AND AS ASC BETWEEN BY CASE CROSS DESC DISTINCT ELSE END EXCEPT EXISTS FROM FULL GROUP HAVING IN INNER INTERSECT INTERVAL IS JOIN LEFT LIKE LIMIT NOT OFFSET ON OR ORDER OUTER OVER PARTITION QUALIFY RIGHT SELECT THEN UNION USING WHEN WHERE WINDOW WITH'.split(
    ' ',
  ),
);
export const SQL_LITERAL_WORDS = new Set(['TRUE', 'FALSE', 'NULL']);
export const isSqlKeyword = (word: string): boolean => SQL_KEYWORDS.has(word.toUpperCase());
export const isSqlLiteralWord = (word: string): boolean => SQL_LITERAL_WORDS.has(word.toUpperCase());
export const SQL_WORD_START = /^[A-Za-z_][A-Za-z0-9_]*/;
export const SQL_NUMBER = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;
export const SQL_SPACE = /^[ \t\r\n]+/;
export const SQL_PLACEHOLDER_STICKY = new RegExp(SQL_PLACEHOLDER_PATTERN.source, 'y');
export const sqlTokens = (text: string, escaping: SqlEscaping = 'backslash'): SqlToken[] => tokenizeSql(text, escaping, true);
export const SQL_INDENT = '  ';
export const SQL_ESCAPINGS: [SqlEscaping, ...SqlEscaping[]] = ['backslash', 'spark', 'doubled'];
export const SQL_PUNCTUATION = new Set('(),.;*+-/%=<>!|&^~:[]@?');
export const SQL_CLOSING_BRACKETS: Record<string, string> = { '(': ')', '[': ']' };
export const SQL_CLAUSE_WORDS = new Set(['SELECT', 'FROM', 'WHERE', 'HAVING', 'QUALIFY', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT']);
export const SQL_JOIN_WORDS = new Set(['INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'ASOF', 'SEMI', 'ANTI']);
export const SQL_CONDITION_CLAUSES = new Set(['WHERE', 'JOIN', 'HAVING', 'QUALIFY']);
export const SQL_SELECT_QUANTIFIERS = new Set(['DISTINCT', 'ALL']);
export const SQL_WORDS_TAKING_AND = new Set(['BETWEEN', 'CASE']);
export const areSameSqlTokens = (first: SqlToken[], second: SqlToken[]): boolean =>
  first.length === second.length &&
  first.every((token, index) => token.kind === second[index]?.kind && token.text === second[index]?.text && token.open === second[index]?.open);
export const sqlWordOf = (token: SqlToken | PlacedSqlToken | undefined): string => (token?.kind === 'word' ? token.text.toUpperCase() : '');
export const SQL_QUERY_START = /^(?:select|with)$/i;
export const LONE_CARRIAGE_RETURN = /\r(?!\n)/;
