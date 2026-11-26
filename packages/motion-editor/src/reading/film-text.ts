/**
 * The film as text, scene by scene: its name, where it starts, its description, the words it puts on screen (read
 * from the stage's layers) and the voiceover lines said in it. Read as text lists it, the hidden section for screen
 * readers reads it, and Save text writes it out. Pure.
 */

import type { ClockPart, SceneEntry } from '@open-artifact/motion-core';
import type { LayerRow, SceneReport } from '@open-artifact/motion-stage/protocol';

/** One scene (or chapter, or the whole film) as text. */
export interface SceneText {
  /** What it is called; '' where the film gives it no name. */
  name: string;
  /** Where it starts, as played. */
  from: number;
  /** Its description from the scene list; '' when it has none. */
  note: string;
  /** The words on screen: `undefined` not read yet, `null` could not be read. */
  shown: readonly string[] | null | undefined;
  /** The voiceover lines that start in it. */
  spoken: readonly string[];
}

/** What a reading of one stretch found: its lines and whether each was already on as the stretch began. */
export interface ReadLine {
  text: string;
  atStart: boolean;
}

/** The stretches the film is read in: each part, or the film as one when it has none. */
export interface TextPart {
  key: string | null;
  label: string;
  from: number;
  to: number;
}

/** A moment counts as a stretch's start within this much. */
const START_SLACK = 0.05;

/** Spaces collapsed, ends trimmed. */
export function plainWords(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function textParts(parts: readonly ClockPart[], duration: number): TextPart[] {
  if (parts.length === 0) return [{ key: null, label: '', from: 0, to: Math.max(0, duration) }];
  return parts.map((part) => ({ key: part.key, label: part.label, from: part.playStart, to: part.playStart + part.playDur }));
}

/** Tells one reading of a stretch from another: a changed cut reads again. */
export const partKey = (part: TextPart, index: number): string => `${index}:${part.key ?? ''}:${part.from}:${part.to}`;

/**
 * The lines of words a reading found, in the order the layers list them, each once. A line whose row is on from
 * the stretch's first moment is marked, so one held over from the scene before can be left out there.
 */
export function readLines(rows: readonly LayerRow[], from: number): ReadLine[] {
  const found: ReadLine[] = [];
  const seen = new Set<string>();
  const visit = (row: LayerRow): void => {
    if (row.kind === 'text') {
      const atStart = row.spans.length > 0 && row.spans[0]![0] <= from + START_SLACK;
      for (const raw of row.texts) {
        const text = plainWords(raw);
        if (text === '' || seen.has(text)) continue;
        seen.add(text);
        found.push({ text, atStart });
      }
    }
    for (const kid of row.kids) visit(kid);
  };
  for (const row of rows) visit(row);
  return found;
}

/** A stretch's lines, less those still on from the stretch before it (already listed there). */
export function shownLines(mine: readonly ReadLine[], before: readonly ReadLine[] | null): string[] {
  const earlier = new Set((before ?? []).map((line) => line.text));
  return mine.filter((line) => !(line.atStart && earlier.has(line.text))).map((line) => line.text);
}

/** The lines said from `from` up to `to`. */
export function spokenBetween(lines: readonly { at: number; text: string }[], from: number, to: number): string[] {
  return lines
    .filter((line) => line.at >= from - 1e-6 && line.at < to - 1e-6)
    .map((line) => plainWords(line.text))
    .filter((text) => text !== '');
}

export interface SceneTextInput {
  parts: readonly TextPart[];
  /** The scene list, for the descriptions; null when the film has none. */
  scenes: readonly SceneEntry[] | null;
  /** How each scene stands (one not yet made has no words to read); null for a film not made of scenes. */
  reports: readonly SceneReport[] | null;
  /** What was read, by {@link partKey}: the lines, or null where the reading failed. */
  read: ReadonlyMap<string, readonly ReadLine[] | null>;
  spoken: readonly { at: number; text: string }[];
}

export function sceneTexts(input: SceneTextInput): SceneText[] {
  return input.parts.map((part, index) => {
    const state = part.key === null ? null : (input.reports?.find((report) => report.id === part.key)?.state ?? null);
    const mine = input.read.get(partKey(part, index));
    const previous = index === 0 ? null : (input.read.get(partKey(input.parts[index - 1]!, index - 1)) ?? null);
    const shown = state === 'todo' ? [] : state === 'failed' ? null : mine === undefined ? undefined : mine === null ? null : shownLines(mine, previous);
    const entry = part.key === null ? undefined : input.scenes?.find((scene) => scene.id === part.key);
    return {
      name: part.label,
      from: part.from,
      note: plainWords(entry?.desc ?? ''),
      shown,
      spoken: spokenBetween(input.spoken, part.from, index === input.parts.length - 1 ? Number.POSITIVE_INFINITY : part.to),
    };
  });
}

/** The next stretch still to read: not read on this load and not waiting to be made; -1 when all are read. */
export function nextUnread(parts: readonly TextPart[], reports: readonly SceneReport[] | null, read: ReadonlyMap<string, unknown>): number {
  return parts.findIndex((part, index) => {
    const state = part.key === null ? null : (reports?.find((report) => report.id === part.key)?.state ?? null);
    return state !== 'todo' && state !== 'failed' && !read.has(partKey(part, index));
  });
}

/** Labels the text file uses; passed in so the words stay in `words.ts`. */
export interface TextFileWords {
  scene: (name: string, index: number) => string;
  startsAt: (seconds: number) => string;
  onScreen: string;
  spoken: string;
  unread: string;
}

/** The film as a plain text file: the title, then each scene with its description and words. */
export function filmTextFile(title: string, scenes: readonly SceneText[], words: TextFileWords): string {
  const out: string[] = [];
  if (title.trim() !== '') out.push(plainWords(title), '');
  scenes.forEach((scene, index) => {
    out.push(`${words.scene(scene.name, index)} (${words.startsAt(scene.from)})`);
    if (scene.note !== '') out.push(scene.note);
    if (scene.shown === null || scene.shown === undefined) out.push(words.unread);
    else if (scene.shown.length > 0) out.push(`${words.onScreen}:`, ...scene.shown.map((line) => `- ${line}`));
    if (scene.spoken.length > 0) out.push(`${words.spoken}:`, ...scene.spoken.map((line) => `- ${line}`));
    out.push('');
  });
  return `${out.join('\n').trimEnd()}\n`;
}

/** A file name from the film's title: letters, digits and dashes, else `animation`. */
export function textFileName(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base === '' ? 'animation' : base}.txt`;
}
