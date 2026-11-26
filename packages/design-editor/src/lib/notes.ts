/**
 * How canvas notes look: colors, text sizes, bounds of drawn shapes and a
 * tiny Markdown subset for stickies.
 */

import type { CanvasNote, NoteColor, Rect } from '@open-artifact/design-core';

import { noteFontSize } from '@open-artifact/design-core';
export { noteFontSize };

/** Sticky backgrounds and stroke colors for the named note colors. */
export const NOTE_PALETTE: Record<NoteColor, { sticky: string; stroke: string }> = {
  gray: { sticky: '#ecebe8', stroke: '#6b6a66' },
  red: { sticky: '#fbd9d5', stroke: '#d4483b' },
  orange: { sticky: '#fde3c4', stroke: '#e07a1f' },
  green: { sticky: '#d7efd2', stroke: '#3f9a4a' },
  teal: { sticky: '#cdeeea', stroke: '#1f9488' },
  blue: { sticky: '#d6e6fb', stroke: '#2f6fd6' },
  purple: { sticky: '#e6dcf8', stroke: '#7a4fd1' },
  pink: { sticky: '#f8d8ea', stroke: '#cf4b93' },
};

/** Default sticky color. */
export const DEFAULT_STICKY = '#fdf0b2';

/** A named color's value, or the string itself (any CSS color). */
export function noteColor(value: string | undefined, use: 'sticky' | 'stroke', fallback: string): string {
  if (!value) return fallback;
  return Object.hasOwn(NOTE_PALETTE, value) ? NOTE_PALETTE[value as NoteColor][use] : value;
}

/** Stroke shared by SVG notes and the GPU scene. */
export function noteStroke(note: CanvasNote) {
  const css = note.css;
  const value = typeof note.stroke === 'number' ? note.stroke : parseFloat(css?.['stroke-width'] ?? '');
  const width = Number.isFinite(value) ? Math.max(0.1, Math.min(100, value)) : 3;
  const pattern = css?.['stroke-dasharray']?.split(/[\s,]+/).map(Number);
  const dash: [number, number] | undefined = note.dash === 'dashed' ? [width * 3, width * 2.5] : note.dash === 'dotted' ? [0.01, width * 2]
    : pattern?.length === 2 && pattern.every(n => Number.isFinite(n) && n >= 0) && pattern.some(n => n > 0) ? [pattern[0]!, pattern[1]!] : undefined;
  return { width, dash, color: note.color ?? css?.stroke };
}

/** Notes drawn from points. */
export const isPathNote = (note: CanvasNote): boolean => note.kind === 'pen' || note.kind === 'line' || note.kind === 'arrow';

/** World bounds of a note (text notes use their size or a typical one). */
export function noteBounds(note: CanvasNote): Rect {
  if (isPathNote(note) && note.points?.length) {
    const xs = note.points.map((p) => p[0]);
    const ys = note.points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: note.x + minX, y: note.y + minY, w: Math.max(1, Math.max(...xs) - minX), h: Math.max(1, Math.max(...ys) - minY) };
  }
  if (note.kind === 'link') return { x: note.x, y: note.y, w: note.w ?? 640, h: note.h ?? 112 };
  const w = note.w ?? (note.kind === 'title1' ? Math.min(note.maxW ?? 1200, 480) : 240);
  const h = note.h ?? (note.kind === 'title1' ? noteFontSize(note.size, note.kind) * 1.3 * textLines(note.text) : 80);
  return { x: note.x, y: note.y, w, h };
}

/** Line height of note text, as a multiple of its size. */
export const NOTE_LINE_HEIGHT = 1.35;

/** Lines in a note's text (at least one). */
export function textLines(text: string | undefined): number {
  return text ? text.split('\n').length : 1;
}

/** Pasted text as a note keeps it: one kind of line break, no blank lines around it. */
export function noteTextOf(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\s*\n|\s+$/g, '');
}

/** The box a text note needs: its widest line up to `maxW`, and its lines. */
export function textNoteSize(text: string, fontSize: number, measure: (line: string) => number, maxW: number): { w: number; h: number } {
  const lines = text.split('\n');
  const widest = Math.max(1, ...lines.map((line) => measure(line)));
  return { w: Math.ceil(Math.min(maxW, widest)), h: Math.ceil(fontSize * NOTE_LINE_HEIGHT * lines.length) };
}

/** Steps a new object along a diagonal until no object already starts at the same spot. */
export function staggeredSpot(at: { x: number; y: number }, taken: readonly { x: number; y: number }[], step = 24, tries = 50): { x: number; y: number } {
  let spot = { x: Math.round(at.x), y: Math.round(at.y) };
  for (let i = 0; i < tries && taken.some((other) => Math.abs(other.x - spot.x) < step / 2 && Math.abs(other.y - spot.y) < step / 2); i++) {
    spot = { x: spot.x + step, y: spot.y + step };
  }
  return spot;
}

/** One rendered piece of a sticky's Markdown. */
export type MarkdownBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'item'; text: string; marker: string }
  | { kind: 'paragraph'; text: string };

/** Splits sticky text into headings, list items and paragraphs. */
export function markdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (const line of text.split('\n')) {
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*(\d+[.)])\s+(.*)$/.exec(line);
    if (heading) blocks.push({ kind: 'heading', text: heading[1]! });
    else if (bullet) blocks.push({ kind: 'item', text: bullet[1]!, marker: '•' });
    else if (ordered) blocks.push({ kind: 'item', text: ordered[2]!, marker: ordered[1]! });
    else blocks.push({ kind: 'paragraph', text: line });
  }
  return blocks;
}

/** Inline runs: `**bold**`, `*italic*` and `` `code` ``. */
export type InlineRun = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

/** Splits a line into inline runs. */
export function inlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('[')) {
      const split = token.indexOf('](');
      runs.push({ text: token.slice(1, split), href: token.slice(split + 2, -1) });
    } else if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('`')) runs.push({ text: token.slice(1, -1), code: true });
    else runs.push({ text: token.slice(1, -1), italic: true });
    last = match.index + token.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

/** SVG dash pattern of a pen stroke. */
export function dashArray(dash: string | undefined, width: number): string | undefined {
  if (dash === 'dashed') return `${width * 3} ${width * 2.5}`;
  if (dash === 'dotted') return `0 ${width * 2}`;
  return undefined;
}

/** Stroke and fill paths for the two configurable ends, in the shaft's coordinates. */
export function arrowHeads(note: CanvasNote, points: readonly (readonly [number, number])[]): { d: string; filled: boolean }[] {
  if (points.length < 2) return [];
  const heads = [];
  for (const start of [true, false]) {
    const kind = start ? note.headStart : note.headEnd ?? (note.kind === 'arrow' ? 'filled' : 'none');
    if (kind !== 'open' && kind !== 'filled') continue;
    const [x, y] = points[start ? 0 : points.length - 1]!;
    const [a, b] = points[start ? 1 : points.length - 2]!;
    const angle = Math.atan2(y - b, x - a);
    const wing = (offset: number) => `${x - 12 * Math.cos(angle + offset)} ${y - 12 * Math.sin(angle + offset)}`;
    const filled = kind === 'filled';
    heads.push({ d: `M${wing(-0.45)}L${x} ${y}L${wing(0.45)}${filled ? 'Z' : `L${x} ${y}`}`, filled });
  }
  return heads;
}

/** The pen path's original coordinate box, before the note was resized. */
export function penViewBox(d: string): [number, number] {
  const values = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const box: [number, number] = [1, 1];
  for (let i = 0; i + 1 < values.length; i += 2) {
    box[0] = Math.max(box[0], Number(values[i]));
    box[1] = Math.max(box[1], Number(values[i + 1]));
  }
  return box;
}
