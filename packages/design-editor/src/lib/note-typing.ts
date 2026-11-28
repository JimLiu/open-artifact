/**
 * Formatting a sticky's Markdown while it is typed: bold and italic on the
 * selected words, and the list kind of the selected lines. A sticky's text
 * is plain Markdown in a text box, so each change rewrites the text and
 * hands back where the selection goes.
 *
 * Inline marks are read the way the sticky draws them (`inlineRuns`):
 * `**bold**`, `*italic*`, `***both***`; code spans and links are kept
 * whole and take no marks. Marks never run across lines.
 */

/** A text and its selection, as offsets into it. */
export interface Edited {
  text: string;
  start: number;
  end: number;
}

export type InlineMark = 'bold' | 'italic';
export type LineList = 'none' | 'bullet' | 'number';

/** A run of a line as written: a piece of plain or marked text, or a code span or link kept whole. */
interface Piece {
  /** The run's words without its marks (a whole piece: its source). */
  text: string;
  bold: boolean;
  italic: boolean;
  whole: boolean;
  /** Where its words start in the line. */
  at: number;
}

const TOKEN = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function pieces(line: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(line); match; match = TOKEN.exec(line)) {
    if (match.index > last) out.push({ text: line.slice(last, match.index), bold: false, italic: false, whole: false, at: last });
    const token = match[0];
    if (token.startsWith('[') || token.startsWith('`')) out.push({ text: token, bold: false, italic: false, whole: true, at: match.index });
    else {
      const marks = token.startsWith('***') ? 3 : token.startsWith('**') ? 2 : 1;
      out.push({ text: token.slice(marks, -marks), bold: marks >= 2, italic: marks !== 2, whole: false, at: match.index + marks });
    }
    last = match.index + token.length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false, italic: false, whole: false, at: last });
  return out;
}

/** One visible character of a line: where it is written, and its marks. */
interface Char {
  ch: string;
  at: number;
  bold: boolean;
  italic: boolean;
  whole: boolean;
  /** The whole piece it belongs to (code and links), to write it back as it was. */
  piece: number;
}

function chars(line: string): Char[] {
  return pieces(line).flatMap((piece, index) => [...piece.text].map((ch, i) => ({ ch, at: piece.at + i, bold: piece.bold, italic: piece.italic, whole: piece.whole, piece: index })));
}

/** Writes characters back as Markdown, and where each one lands. */
function write(list: Char[]): { line: string; places: number[] } {
  let line = '';
  const places: number[] = [];
  let i = 0;
  while (i < list.length) {
    const first = list[i]!;
    let j = i + 1;
    if (first.whole) {
      while (j < list.length && list[j]!.whole && list[j]!.piece === first.piece) j++;
    } else {
      while (j < list.length && !list[j]!.whole && list[j]!.bold === first.bold && list[j]!.italic === first.italic) j++;
    }
    const mark = first.whole ? '' : first.bold && first.italic ? '***' : first.bold ? '**' : first.italic ? '*' : '';
    line += mark;
    for (let k = i; k < j; k++) {
      places.push(line.length);
      line += list[k]!.ch;
    }
    line += mark;
    i = j;
  }
  return { line, places };
}

/** The lines of a text with their start offsets. */
function lines(text: string): { line: string; at: number }[] {
  const out: { line: string; at: number }[] = [];
  let at = 0;
  for (const line of text.split('\n')) {
    out.push({ line, at });
    at += line.length + 1;
  }
  return out;
}

const isWord = (ch: string) => /[\p{L}\p{N}_'’-]/u.test(ch);

/**
 * The visible characters an inline mark acts on, per line: the selected
 * ones, or with nothing selected the word at the caret. Code and links,
 * and the spaces around the words, take no marks.
 */
function targets(text: string, start: number, end: number): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  lines(text).forEach(({ line, at }, index) => {
    const list = chars(line);
    const picked = new Set<number>();
    if (start === end) {
      if (start < at || start > at + line.length) return;
      const caret = start - at;
      // The character after the caret, else the one before it (marks between them don't count).
      const after = list.findIndex((c) => c.at >= caret);
      const before = after === -1 ? list.length - 1 : after - 1;
      const near = [after, before].find((k) => k >= 0 && isWord(list[k]!.ch) && !list[k]!.whole);
      if (near === undefined) return;
      let a = near;
      let b = near;
      while (a > 0 && isWord(list[a - 1]!.ch) && !list[a - 1]!.whole) a--;
      while (b < list.length - 1 && isWord(list[b + 1]!.ch) && !list[b + 1]!.whole) b++;
      for (let k = a; k <= b; k++) picked.add(k);
    } else {
      list.forEach((c, k) => {
        const pos = at + c.at;
        if (pos >= start && pos < end && !c.whole) picked.add(k);
      });
      // Spaces at the ends of the selection stay unmarked.
      const order = [...picked].sort((x, y) => x - y);
      while (order.length && /\s/.test(list[order[0]!]!.ch)) picked.delete(order.shift()!);
      while (order.length && /\s/.test(list[order[order.length - 1]!]!.ch)) picked.delete(order.pop()!);
    }
    if (picked.size) out.set(index, picked);
  });
  return out;
}

/** Whether every word the mark would act on already has it (nothing to act on: false). */
export function hasMark(text: string, start: number, end: number, mark: InlineMark): boolean {
  const all = lines(text);
  const picked = targets(text, start, end);
  if (!picked.size) return false;
  return [...picked].every(([index, set]) => {
    const list = chars(all[index]!.line);
    return [...set].every((k) => list[k]![mark]);
  });
}

/** Whether there are words for a mark to act on. */
export function canMark(text: string, start: number, end: number): boolean {
  return targets(text, start, end).size > 0;
}

/**
 * Adds a mark to the words it acts on, or takes it off when they all have
 * it. The selection keeps the same words (the caret, the same place in them).
 */
export function toggleMark(text: string, start: number, end: number, mark: InlineMark): Edited {
  const picked = targets(text, start, end);
  if (!picked.size) return { text, start, end };
  const on = !hasMark(text, start, end, mark);
  const all = lines(text);
  let out = '';
  let newStart = start;
  let newEnd = end;
  all.forEach(({ line, at }, index) => {
    if (index) out += '\n';
    const base = out.length;
    const set = picked.get(index);
    if (!set) {
      // A line before or after: its offsets only move by what earlier lines gained.
      if (start >= at && start <= at + line.length) newStart = base + (start - at);
      if (end >= at && end <= at + line.length) newEnd = base + (end - at);
      out += line;
      return;
    }
    const list = chars(line).map((c, k) => (set.has(k) ? { ...c, [mark]: on } : c));
    const { line: written, places } = write(list);
    // The caret or a selection end goes to the same character it was next to.
    const moved = (pos: number, side: 'start' | 'end'): number => {
      const col = pos - at;
      const old = chars(line);
      if (side === 'start') {
        const k = old.findIndex((c) => c.at >= col);
        return base + (k === -1 ? written.length : places[k]!);
      }
      let k = -1;
      old.forEach((c, i) => (c.at < col ? (k = i) : undefined));
      return base + (k === -1 ? 0 : places[k]! + 1);
    };
    if (start >= at && start <= at + line.length) newStart = moved(start, start === end ? 'end' : 'start');
    if (end >= at && end <= at + line.length) newEnd = start === end ? newStart : moved(end, 'end');
    out += written;
  });
  return { text: out, start: newStart, end: newEnd };
}

const BULLET = /^(\s*)[-*]\s+/;
const NUMBER = /^(\s*)\d+[.)]\s+/;

/** The lines a selection touches, by index (a selection ending at a line's start leaves that line out). */
function touched(text: string, start: number, end: number): number[] {
  const all = lines(text);
  const last = end > start ? end - 1 : end;
  return all.flatMap(({ line, at }, index) => (at <= last && start <= at + line.length && !(end > start && at === end) ? [index] : []));
}

/** The list the selected lines make: one kind when they all are, else none. */
export function lineListOf(text: string, start: number, end: number): LineList {
  const all = lines(text);
  const kinds = touched(text, start, end).map((index) => {
    const line = all[index]!.line;
    return BULLET.test(line) ? 'bullet' : NUMBER.test(line) ? 'number' : 'none';
  });
  return kinds.length && kinds.every((kind) => kind === kinds[0]) ? kinds[0]! : 'none';
}

/** Makes the selected lines a bulleted or numbered list (numbered from 1), or plain lines. */
export function setLineList(text: string, start: number, end: number, list: LineList): Edited {
  const all = lines(text);
  const picked = new Set(touched(text, start, end));
  let out = '';
  let newStart = start;
  let newEnd = end;
  let n = 0;
  all.forEach(({ line, at }, index) => {
    if (index) out += '\n';
    const base = out.length;
    let next = line;
    let oldPrefix = 0;
    let newPrefix = 0;
    if (picked.has(index)) {
      const found = BULLET.exec(line) ?? NUMBER.exec(line);
      const indent = found ? found[1]! : '';
      oldPrefix = found ? found[0].length : 0;
      const prefix = list === 'bullet' ? '- ' : list === 'number' ? `${++n}. ` : '';
      newPrefix = indent.length + prefix.length;
      next = indent + prefix + line.slice(oldPrefix);
    }
    const moved = (pos: number) => {
      const col = pos - at;
      return base + (col < oldPrefix ? newPrefix : col - oldPrefix + newPrefix);
    };
    if (start >= at && start <= at + line.length) newStart = moved(start);
    if (end >= at && end <= at + line.length) newEnd = moved(end);
    out += next;
  });
  return { text: out, start: newStart, end: newEnd };
}
