/** @mentions in a comment: who can be named, finding the name being typed, and who a message names. */

export interface MentionCandidate {
  /** What a message's `to` names them by: `agent` for the agent, a person's name otherwise. */
  key: string;
  name: string;
  kind: 'person' | 'agent';
}

/** The key a message's `to` uses for the agent. */
export const AGENT_KEY = 'agent';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Scripts written without spaces between words: an `@name` there may touch the words around it. */
const NO_SPACES = String.raw`\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}`;
const NO_SPACE_LETTER = new RegExp(`[${NO_SPACES}]`, 'u');
/**
 * What an `@` may not follow: a letter, digit or the like of a script with spaces (`ann@agent.com` names no one), or
 * a Markdown mark (`**@Agent**` and `` `@Agent` `` are drawn as typed, so they name no one either).
 */
const IN_A_WORD = /[\p{L}\p{N}_.+\-/:@*~`]/u;

/**
 * Whether an `@` after `before` (undefined: the text's start) can begin an `@name`: after the start, a space,
 * punctuation (`，@Ann`, `(@Ann`), or a letter of a script written without spaces (`请@宝玉`).
 */
export function mayStartMention(before: string | undefined): boolean {
  return before === undefined || NO_SPACE_LETTER.test(before) || !IN_A_WORD.test(before);
}

/**
 * `@name` as a regular expression source, matched from its `@`. A name ending in a letter or digit of a script
 * with spaces must end there (`@Ann`, not `@Anna`); any other may run into what follows (`@宝玉，`, `@宝玉请看`).
 */
function nameSource(name: string): string {
  const last = [...name].at(-1) ?? '';
  const tail = /[\p{L}\p{N}_]/u.test(last) && !NO_SPACE_LETTER.test(last) ? '(?![\\p{L}\\p{N}_])' : '';
  return `@${escape(name)}${tail}`;
}

/** Any of the names as `@name`, longest first (so `@Ann Lee` beats `@Ann`), or null for none. */
export function mentionSource(names: readonly string[]): string | null {
  const sorted = [...new Set(names.filter(name => name.trim()))].sort((a, b) => b.length - a.length);
  return sorted.length ? `(?:${sorted.map(nameSource).join('|')})` : null;
}

/** The `@name` being typed just before the caret: where its `@` is and what follows it. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (!mayStartMention(at > 0 ? before[at - 1] : undefined)) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s\s/.test(query) || /^\s/.test(query)) return null;
  return { start: at, query };
}

/** The candidates whose name, or a word of it, starts with the query (the agent first). */
export function matchCandidates(candidates: readonly MentionCandidate[], query: string, limit = 6): MentionCandidate[] {
  const wanted = query.trim().toLowerCase();
  const hits = candidates.filter(candidate => {
    if (!wanted) return true;
    const name = candidate.name.toLowerCase();
    return name.startsWith(wanted) || name.split(/\s+/).some(word => word.startsWith(wanted));
  });
  return hits.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'agent' ? -1 : 1)).slice(0, limit);
}

/** The text with the typed `@query` replaced by the whole name and a space; and where the caret goes. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  const after = text.slice(caret).replace(/^ /, '');
  return { text: text.slice(0, start) + inserted + after, caret: start + inserted.length };
}

/** Where each `@name` of these names starts and ends in the text, longest names first, none inside another. */
function mentionSpans(text: string, names: readonly string[]): { start: number; end: number }[] {
  const source = mentionSource(names);
  if (!source) return [];
  const spans: { start: number; end: number }[] = [];
  for (const match of text.matchAll(new RegExp(source, 'giu'))) {
    if (mayStartMention(match.index > 0 ? text[match.index - 1] : undefined)) spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/** The keys of the candidates a message names, in the order of the candidates. */
export function mentionsIn(text: string, candidates: readonly MentionCandidate[]): string[] {
  const named = new Set(mentionSpans(text, candidates.map(candidate => candidate.name)).map(span => text.slice(span.start + 1, span.end).toLowerCase()));
  const keys: string[] = [];
  for (const candidate of candidates) {
    if (named.has(candidate.name.toLowerCase()) && !keys.includes(candidate.key)) keys.push(candidate.key);
  }
  return keys;
}

export interface TextPiece {
  text: string;
  mention: boolean;
}

/** The text cut into plain pieces and `@name` pieces, for the names given (longest first, so `@Ann Lee` beats `@Ann`). */
export function splitMentions(text: string, names: readonly string[]): TextPiece[] {
  const spans = mentionSpans(text, names);
  if (!spans.length) return [{ text, mention: false }];
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const { start, end } of spans) {
    if (start > last) pieces.push({ text: text.slice(last, start), mention: false });
    pieces.push({ text: text.slice(start, end), mention: true });
    last = end;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), mention: false });
  return pieces;
}
