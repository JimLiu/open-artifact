import { eo, lerp, seg } from './math.ts';
import type { Ease } from './math.ts';

/**
 * `kit.count(el, t, t0, t1, {from, ease})`: a figure written in the markup counts up to itself between t0 and t1, then
 * shows its words exactly as written. Only a lone figure is counted; anything else is left as it is.
 */

/** The one figure in a line of words, and how it is written, so a value in between is written the same way. */
export interface Figure {
  before: string;
  sign: string;
  /** The thousands separator, or ''. */
  group: string;
  /** The decimal mark, or ''. */
  mark: string;
  places: number;
  after: string;
  value: number;
  /** Digits the whole part is padded to with zeros ("007"), or 0. */
  pad: number;
}

const SEPARATORS = ".,'’   ";
const RUN = /\d+(?:[.,'’   ]\d+)*/g;
const SPLIT = /[.,'’   ]/;
const MOST_DIGITS = 15;

/** Every part after the first is three digits, and the first is one to three digits that is not a leading zero. */
const inThrees = (parts: readonly string[]): boolean =>
  parts.length > 1 && (parts[0] ?? '').length <= 3 && !(parts[0] ?? '').startsWith('0') && parts.slice(1).every((part) => part.length === 3);

/** How a run of digits and separators reads: its whole digits, thousands separator, decimal mark and decimals; null when it is no one number. */
function readRun(run: string): { whole: string; group: string; mark: string; decimals: string } | null {
  const parts = run.split(SPLIT);
  const marks = [...run].filter((char) => SEPARATORS.includes(char));
  if (marks.length === 0) return { whole: run, group: '', mark: '', decimals: '' };
  const last = marks[marks.length - 1] ?? '';
  const decimalMark = last === '.' || last === ',';
  // "3.142" and "0,125": one mark that cannot be a thousands separator is a decimal mark.
  if (marks.length === 1 && decimalMark && (last === '.' || !inThrees(parts))) return { whole: parts[0] ?? '', group: '', mark: last, decimals: parts[1] ?? '' };
  if (marks.every((char) => char === last) && inThrees(parts)) return { whole: parts.join(''), group: last, mark: '', decimals: '' };
  const groups = marks.slice(0, -1);
  const group = groups[0] ?? '';
  if (decimalMark && group !== last && groups.every((char) => char === group) && inThrees(parts.slice(0, -1)))
    return { whole: parts.slice(0, -1).join(''), group, mark: last, decimals: parts[parts.length - 1] ?? '' };
  return null;
}

/**
 * The figure in `text`, or null where there is none to count: no number or more than one, one joined to a word (Q3,
 * B2B), a label (Top 10), an ordinal (1st), more than fifteen digits, or a year standing alone (2026) unless `years`.
 */
export function readFigure(text: string, years = false): Figure | null {
  const runs = [...text.matchAll(RUN)];
  const found = runs[0];
  if (runs.length !== 1 || found === undefined) return null;
  const read = readRun(found[0]);
  if (read === null || read.whole.length + read.decimals.length > MOST_DIGITS) return null;
  let before = text.slice(0, found.index);
  const after = text.slice(found.index + found[0].length);
  const sign = before.endsWith('-') || before.endsWith('−') ? before.slice(-1) : '';
  if (sign) before = before.slice(0, -1);
  if (/[\p{L}\p{N}]$/u.test(before)) return null;
  if ((before.match(/\p{L}/gu) ?? []).length > 2) return null;
  if (/^(st|nd|rd|th)(?!\p{L})/iu.test(after)) return null;
  const value = Number(read.whole + (read.decimals ? '.' + read.decimals : '')) * (sign ? -1 : 1);
  // A year stands alone: nothing after it but the end of the line or a stop, and no currency before it.
  const lonely = /^(?:\s*$|[.,;:!?)\]"'’”])/u.test(after) && !/\p{Sc}/u.test(before);
  if (!years && !sign && !read.group && !read.decimals && read.whole.length === 4 && value >= 1900 && value <= 2100 && lonely) return null;
  return {
    before,
    sign,
    group: read.group,
    mark: read.mark,
    places: read.decimals.length,
    after,
    value,
    pad: read.whole.length > 1 && read.whole.startsWith('0') ? read.whole.length : 0,
  };
}

/** `value` written as the figure is: its places, separators, padding and the words around it. Never "-0". */
export function writeFigure(figure: Figure, value: number): string {
  const [whole = '0', decimals = ''] = Math.abs(value).toFixed(figure.places).split('.');
  const digits = whole.padStart(figure.pad, '0');
  const grouped = figure.group ? digits.replace(/\B(?=(\d{3})+$)/g, figure.group) : digits;
  const negative = value < 0 && /[1-9]/.test(whole + decimals);
  return figure.before + (negative ? figure.sign || '-' : '') + grouped + (decimals ? figure.mark + decimals : '') + figure.after;
}

interface Counted {
  /** The words as written, shown once the count is over. */
  text: string;
  figure: Figure | null;
  /** What the count last showed. */
  shown: string;
}

const counted = new WeakMap<object, Counted>();

export interface CountOptions {
  /** Where the count starts; by default half the figure. */
  from?: number;
  ease?: Ease;
}

/**
 * Counts the figure in `el`'s words from `from` to itself between t0 and t1, and gives what it shows. Its words are
 * read the first time; words that something else writes later (a person's retype) are read again. An element with
 * child elements, or words with no figure, is never written to. Anything not a finite number shows the words.
 */
export function count(el: Element, t: number, t0: number, t1: number, options: CountOptions = {}): string {
  if (el === null || typeof el !== 'object' || typeof el.textContent !== 'string') return '';
  const now = el.textContent;
  const leaves = el.children.length === 0;
  let kept = counted.get(el);
  if (kept === undefined || (now !== kept.text && now !== kept.shown)) {
    kept = { text: now, figure: leaves ? readFigure(now, options.from !== undefined && options.from !== null) : null, shown: now };
    counted.set(el, kept);
  }
  const { figure } = kept;
  const x = t1 > t0 ? seg(t, t0, t1) : 1;
  const ease = typeof options.ease === 'function' ? options.ease : eo;
  const from = options.from !== undefined && options.from !== null ? Number(options.from) : figure ? figure.value / 2 : NaN;
  const value = figure !== null && x < 1 ? lerp(from, figure.value, ease(x)) : NaN;
  const shown = figure !== null && Math.abs(value) < 1e15 ? writeFigure(figure, value) : kept.text;
  if (figure !== null && leaves && el.textContent !== shown) el.textContent = shown;
  kept.shown = shown;
  return shown;
}
