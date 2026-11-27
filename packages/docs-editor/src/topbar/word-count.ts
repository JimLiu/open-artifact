/**
 * How many words and characters the open tab holds, and how many of them are selected, as the More menu tells it.
 *
 * Counted as the page reads: a proposed insertion is not in the text yet, a block drawn as a picture (a diagram, a
 * formula, a table drawn from CSV) has no words of its own, and a chip counts as the words it shows. Words are told
 * apart by spaces and dashes; Chinese, Japanese, Thai and the other scripts written without spaces are split into
 * words by the browser's word segmenter. Characters are what a reader sees as one (an emoji with its modifiers is
 * one); line breaks are not characters. Pure.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { liveKind } from '../code/languages.ts';
import { schema } from '../editor/schema.ts';

export interface TextCount {
  words: number;
  characters: number;
}

export interface TabCount {
  tab: TextCount;
  /** What the selection holds; null when nothing is selected. */
  selected: TextCount | null;
}

/** The words a chip shows, or null for an inline node with none (a picture). */
export type ChipText = (node: PMNode) => string | null;

interface Span {
  from: number;
  to: number;
}

const NO_SPACES = String.raw`\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}`;
const HAS_NO_SPACE_SCRIPT = new RegExp(`[${NO_SPACES}]`, 'u');
/** A run in those scripts, with what continues a word there: combining marks, the long vowel and repeat signs. */
const NO_SPACE_RUN = new RegExp(String.raw`([${NO_SPACES}][${NO_SPACES}\p{M}ー々〆]*)`, 'u');
const HAS_LETTER = /[\p{L}\p{N}]/u;
const BETWEEN_WORDS = /[\s—]+/u;
/** Zero-width characters: a zero-width space parts two words, and none of them is a character one sees. */
const ZERO_WIDTH = /[\u200B\u2060\uFEFF]/gu;
const LINE_BREAKS = /\n+/;

type Granularity = 'word' | 'grapheme';
const segmenters = new Map<Granularity, Intl.Segmenter | null>();
function segmenter(granularity: Granularity): Intl.Segmenter | null {
  if (!segmenters.has(granularity)) segmenters.set(granularity, typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity }) : null);
  return segmenters.get(granularity) ?? null;
}

/** Words in a run of a script written without spaces: the segmenter's, else one per letter. */
function wordsWithoutSpaces(run: string): number {
  const words = segmenter('word');
  if (!words) return [...run].filter(ch => HAS_LETTER.test(ch)).length;
  let count = 0;
  for (const part of words.segment(run)) if (part.isWordLike || HAS_LETTER.test(part.segment)) count++;
  return count;
}

export function countWords(text: string): number {
  let count = 0;
  for (const piece of text.replace(/\u200B/gu, ' ').replace(ZERO_WIDTH, '').split(BETWEEN_WORDS)) {
    if (!HAS_NO_SPACE_SCRIPT.test(piece)) {
      if (HAS_LETTER.test(piece)) count++;
      continue;
    }
    // Split keeps the runs at the odd places, so Latin written up against such a run ("Q3" before Han) is a word of its own.
    piece.split(NO_SPACE_RUN).forEach((part, index) => {
      if (index % 2) count += wordsWithoutSpaces(part);
      else if (HAS_LETTER.test(part)) count++;
    });
  }
  return count;
}

export function countCharacters(text: string): number {
  const graphemes = segmenter('grapheme');
  let count = 0;
  for (const line of text.replace(ZERO_WIDTH, '').split(LINE_BREAKS)) {
    if (!graphemes) count += [...line].length;
    else for (const _ of graphemes.segment(line)) count++;
  }
  return count;
}

const textCount = (text: string): TextCount => ({ words: countWords(text), characters: countCharacters(text) });

/** A piece of the tab as it reads: text at a place, a chip's words (taken whole), or a break between lines. */
type Piece = { kind: 'text'; text: string; at: number } | { kind: 'chip'; text: string; at: number; size: number } | { kind: 'break' };

const proposed = (node: PMNode): boolean => node.attrs.suggestOp === 'ins' || node.marks.some(mark => mark.type === schema.marks.suggestIns);
const drawn = (node: PMNode): boolean => node.type === schema.nodes.codeBlock && liveKind(node.attrs.language as string | null) !== null;
const overlaps = (spans: readonly Span[], from: number, to: number): boolean => spans.some(span => span.from < to && span.to > from);

/** `doc`'s count, and the count of what `spans` cover when there are any. `chipText` reads a chip's words. */
export function countDoc(doc: PMNode, spans: readonly Span[], chipText: ChipText): TabCount {
  const selecting = spans.filter(span => span.to > span.from);
  const pieces: Piece[] = [];
  // A selection over only what isn't counted (a proposed insertion) still says "0 of n selected".
  let selectedSkipped = false;
  const skip = (node: PMNode, pos: number) => {
    if (!selectedSkipped && (node.isInline || node.textContent !== '') && overlaps(selecting, pos, pos + node.nodeSize)) selectedSkipped = true;
  };
  doc.descendants((node, pos) => {
    if (proposed(node)) {
      skip(node, pos);
      return false;
    }
    if (!node.isInline) {
      if (node.isTextblock || node.isLeaf) pieces.push({ kind: 'break' });
      return !drawn(node);
    }
    if (node.isText) pieces.push({ kind: 'text', text: node.text ?? '', at: pos });
    else {
      const words = node.type === schema.nodes.hardBreak ? null : chipText(node);
      pieces.push(words ? { kind: 'chip', text: words, at: pos, size: node.nodeSize } : { kind: 'break' });
    }
    return false;
  });

  const whole = pieces.map(piece => (piece.kind === 'break' ? '\n' : piece.text)).join('');
  if (!selecting.length) return { tab: textCount(whole), selected: null };

  let picked = '';
  let lastEnd = -1;
  const take = (text: string, from: number, to: number) => {
    picked += (from === lastEnd ? '' : '\n') + text;
    lastEnd = to;
  };
  for (const piece of pieces) {
    if (piece.kind === 'chip') {
      if (overlaps(selecting, piece.at, piece.at + piece.size)) take(piece.text, piece.at, piece.at + piece.size);
    } else if (piece.kind === 'text') {
      const end = piece.at + piece.text.length;
      for (const span of selecting) {
        const from = Math.max(span.from, piece.at);
        const to = Math.min(span.to, end);
        if (to > from) take(piece.text.slice(from - piece.at, to - piece.at), from, to);
      }
    }
  }
  const selected = textCount(picked);
  return { tab: textCount(whole), selected: selected.characters > 0 || selectedSkipped ? selected : null };
}

/** The open tab's count with its selection (each cell of a cell selection is a range of its own). */
export function countEditor(state: EditorState, chipText: ChipText): TabCount {
  const spans = state.selection.ranges.map(range => ({ from: range.$from.pos, to: range.$to.pos }));
  return countDoc(state.doc, spans, chipText);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The menu's two lines: words, then characters, numbers grouped ("1,204"). */
export function countLines({ tab, selected }: TabCount, locale = 'en-US'): [string, string] {
  const show = (n: number) => n.toLocaleString(locale);
  const words = plural(tab.words, 'word', 'words');
  const characters = plural(tab.characters, 'character', 'characters');
  if (!selected) return [`${show(tab.words)} ${words} in this tab`, `${show(tab.characters)} ${characters}`];
  return [`${show(selected.words)} of ${show(tab.words)} ${words} selected`, `${show(selected.characters)} of ${show(tab.characters)} ${characters}`];
}
