/**
 * `@` in a comment box: the name being typed before the caret, who it can name, what a pick puts in the text, and whom
 * a message names when it is sent. Pure: no DOM.
 *
 * People are named by their display name (a message's `to` holds it); the agent by {@link AGENT_KEY}.
 */

/** The `to` entry that names the agent. */
export const AGENT_KEY = 'agent';

/** Most rows the list shows, the agent's included. */
export const MENTION_ROWS = 8;

/** Most different people one comment may name. */
export const MENTION_PEOPLE_LIMIT = 32;

/** Someone a comment can name. */
export interface MentionPerson {
  /** What a message's `to` names them by. */
  key: string;
  name: string;
  /** Their id on this host, when it is known (to leave the viewer out). */
  id?: string;
}

/** A row of the list. */
export interface MentionOption {
  kind: 'agent' | 'person';
  key: string;
  label: string;
}

/** An `@name` being typed: `start` is its `@`, `end` the caret. */
export interface TypedMention {
  start: number;
  end: number;
  query: string;
}

/** A person picked from the list: the name as it went into the text. */
export interface MentionPick {
  key: string;
  name: string;
}

const WORD = String.raw`[\p{L}\p{M}\p{N}_.'’-]`;
/** Before the caret: `@` at the start or after a space or an opening bracket, then up to three words of a name. */
const TYPING = new RegExp(String.raw`(?:^|[\s([{])@(${WORD}{1,40}(?: ${WORD}{0,40}){0,2})?$`, 'u');

/** The `@name` typed just before `caret`, or `null` when the text there is not one. */
export function typedMention(text: string, caret: number): TypedMention | null {
  const head = text.slice(0, caret);
  const found = TYPING.exec(head);
  if (found === null) return null;
  const query = found[1] ?? '';
  return { start: head.length - query.length - 1, end: head.length, query };
}

/** How names and queries are compared. */
export const foldName = (text: string): string => text.trim().toLocaleLowerCase();

/** Whether `name`, or one of its words, starts with `query` (an empty query matches everyone). */
export function nameMatches(name: string, query: string): boolean {
  const wanted = foldName(query);
  if (wanted === '') return true;
  const folded = name.toLocaleLowerCase();
  return folded.startsWith(wanted) || folded.split(/\s+/).some((word) => word.startsWith(wanted));
}

/** A name as it is written after `@`: no `<`, `>` or `@`; `someone` when nothing is left. */
export function mentionName(name: string): string {
  return name.replace(/[<>@]/g, '').trim() || 'someone';
}

/** What the list is drawn from. */
export interface MentionSource {
  /** The query typed after `@`. */
  query: string;
  /** The agent's name. */
  agentName: string;
  /** The viewer may send comments to the agent: it gets a row. */
  agentListed: boolean;
  /** Everyone else, in the order they should be listed. */
  people: readonly MentionPerson[];
  /** The viewer, who is never listed. */
  self: { id?: string; name: string };
}

/** The rows for a query: the agent first when it matches, then the people who match, {@link MENTION_ROWS} at most. */
export function mentionOptions({ query, agentName, agentListed, people, self }: MentionSource): MentionOption[] {
  const rows: MentionOption[] = [];
  const wanted = foldName(query);
  const agentFolded = foldName(agentName);
  if (agentListed && agentFolded.startsWith(wanted)) rows.push({ kind: 'agent', key: AGENT_KEY, label: agentName });
  const seen = new Set<string>([AGENT_KEY]);
  const selfName = foldName(self.name);
  for (const person of people) {
    if (rows.length >= MENTION_ROWS) break;
    const key = foldName(person.key);
    const name = foldName(person.name);
    if (key === '' || name === '' || seen.has(key)) continue;
    if ((self.id !== undefined && person.id === self.id) || name === selfName) continue;
    // Someone whose name starts with the agent's could pass for it.
    if (agentFolded !== '' && name.startsWith(agentFolded)) continue;
    if (!nameMatches(person.name, query)) continue;
    seen.add(key);
    rows.push({ kind: 'person', key: person.key, label: person.name });
  }
  return rows;
}

/** The text with `typed` replaced by the option's `@name` and a space, and where the caret goes. */
export function applyMention(text: string, typed: TypedMention, option: MentionOption): { text: string; caret: number; name: string } {
  const name = mentionName(option.label);
  const word = `@${name} `;
  return { text: text.slice(0, typed.start) + word + text.slice(typed.end), caret: typed.start + word.length, name };
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `@name` as a whole: after the start, a space or an opening bracket; a name ending in a Latin letter, digit or `_`
 * must end there (`@Bob`, not `@Bobby`), any other may run into what follows (a script written without spaces).
 */
function namePattern(name: string, flags: string): RegExp {
  const tail = /[A-Za-z0-9_]$/.test(name) ? '(?![A-Za-z0-9_])' : '';
  return new RegExp(`(?<=^|[\\s([{])@${escapeRegExp(name)}${tail}`, flags);
}

/** Whether `text` has `@name` in it (case ignored). */
export function mentionsName(text: string, name: string): boolean {
  return name.trim() !== '' && namePattern(name, 'iu').test(text);
}

/**
 * Whom a message names: {@link AGENT_KEY} when it mentions the agent (and the agent may be asked), then each picked
 * person whose `@name` is still in the text. A name typed without picking it names no one.
 */
export function mentionTargets(text: string, picks: readonly MentionPick[], agent: { name: string; listed: boolean }): string[] {
  const keys: string[] = [];
  if (agent.listed && mentionsName(text, agent.name)) keys.push(AGENT_KEY);
  for (const pick of picks) {
    if (keys.includes(pick.key) || !mentionsName(text, pick.name)) continue;
    keys.push(pick.key);
  }
  return keys;
}

/** How many people a `to` list names (the agent not counted). */
export const peopleNamed = (to: readonly string[]): number => to.filter((key) => key !== AGENT_KEY).length;

/** What refuses a comment that names more than {@link MENTION_PEOPLE_LIMIT} people. */
export function mentionLimitText(verb: 'post' | 'save'): string {
  return `A comment can mention up to ${MENTION_PEOPLE_LIMIT} people. Remove some mentions to ${verb}.`;
}

/** The names a sent message's mentions are drawn for: the agent's when it went to the agent, and the people it named. */
export function sentMentionNames(to: readonly string[] | undefined, agentName: string): string[] {
  const keys = to ?? [];
  return [...(agentName && keys.includes(AGENT_KEY) ? [agentName] : []), ...keys.filter((key) => key !== AGENT_KEY).map(mentionName)];
}

/**
 * Whether a message's card leads with an `@agent` tag: a person sent it to the agent (the box ticked, or the agent named
 * in `to`) and its text does not mention the agent itself.
 */
export function leadsWithAgent(message: { text: string; to?: readonly string[]; author: { kind: string } }, agentName: string): boolean {
  return message.author.kind === 'person' && Boolean(message.to?.includes(AGENT_KEY)) && agentName.trim() !== '' && !mentionsName(message.text, agentName);
}

/** A run of a message's text: plain, or an `@name` drawn as a mention. */
export interface MentionPiece {
  text: string;
  mention: boolean;
}

/** `text` cut into plain runs and the `@name` runs of `names` (the longest name wins where two start alike). */
export function mentionPieces(text: string, names: readonly string[]): MentionPiece[] {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (wanted.length === 0 || !text.includes('@')) return text ? [{ text, mention: false }] : [];
  const patterns = wanted.map((name) => namePattern(name, 'giu'));
  const pieces: MentionPiece[] = [];
  let from = 0;
  for (;;) {
    let best: { at: number; length: number } | null = null;
    for (const pattern of patterns) {
      pattern.lastIndex = from;
      const hit = pattern.exec(text);
      if (hit !== null && (best === null || hit.index < best.at)) best = { at: hit.index, length: hit[0].length };
    }
    if (best === null) break;
    if (best.at > from) pieces.push({ text: text.slice(from, best.at), mention: false });
    pieces.push({ text: text.slice(best.at, best.at + best.length), mention: true });
    from = best.at + best.length;
  }
  if (from < text.length) pieces.push({ text: text.slice(from), mention: false });
  return pieces;
}

/** Where Escape (or a pick) closed the list: it stays closed while the same `@` grows from that query. */
export interface ClosedMention {
  start: number;
  query: string;
}

/** Whether the list is still closed for `typed` after it was closed at `closed`. */
export function stillClosed(closed: ClosedMention | null, typed: TypedMention | null): boolean {
  if (closed === null || typed === null || typed.start !== closed.start) return false;
  return foldName(typed.query).startsWith(foldName(closed.query));
}

/** What the status region says about the highlighted row. */
export function optionPosition(label: string, index: number, total: number): string {
  return `${label}, ${index + 1} of ${total}`;
}
