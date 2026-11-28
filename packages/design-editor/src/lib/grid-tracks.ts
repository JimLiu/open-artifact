/**
 * Grid fields: a track list read as a count of equal tracks when it is one,
 * and an item's span across tracks.
 */

/** The most tracks or the longest span a number field takes. */
export const MAX_TRACKS = 12;

export const COLUMNS_TIP = 'Track count (equal columns), or any CSS track list (160px 1fr)';
export const ROWS_TIP = 'Track count (equal rows); unset lets rows size to content';

/** Splits a track list at top-level spaces (not inside brackets or parentheses). */
function tracksOf(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else current += char;
  }
  if (current) out.push(current);
  return out;
}

/** A track a count can stand for: a length, a percentage, a fraction, auto, or minmax/fit-content of those. */
const SIMPLE_TRACK = /^(auto|min-content|max-content|-?\d*\.?\d+(px|fr|%|r?em|vw|vh|ch)?|(minmax|fit-content)\([^()]*\))$/i;

/**
 * The number of equal tracks a track list is, or null when it is any other
 * list: `repeat(n, minmax(0, 1fr))`, `repeat(n, 1fr)`, or n same simple
 * tracks (`1fr 1fr 1fr`, `100px 100px`).
 */
export function trackCount(value: string | undefined): number | null {
  const text = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!text || text === 'none') return null;
  const repeat = /^repeat\(\s*(\d+)\s*,\s*(minmax\(\s*0(px)?\s*,\s*1fr\s*\)|1fr)\s*\)$/i.exec(text);
  if (repeat) return Number(repeat[1]) || null;
  const tracks = tracksOf(text);
  if (!tracks.length || !tracks.every((track) => track === tracks[0] && SIMPLE_TRACK.test(track))) return null;
  return tracks.length;
}

/** What a typed value writes: a number makes that many equal tracks (1 to 12); other text is a track list, written as it is. */
export function tracksValue(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  if (/^\d*\.?\d+$/.test(text)) return `repeat(${Math.min(MAX_TRACKS, Math.max(1, Math.round(Number(text))))}, minmax(0, 1fr))`;
  return text;
}

/** What the field shows for a written track list: its count when it is one, else the list. */
export const tracksShown = (value: string | undefined): string => {
  const count = trackCount(value);
  return count === null ? (value ?? '') : String(count);
};

/** An item's placement on one axis: its start line (when written) and how many tracks it spans (null: auto). */
export interface GridSpan {
  start: string | null;
  span: number | null;
}

/** Reads `grid-column` / `grid-row`: `auto`, `3`, `span 2`, `3 / span 2`. */
export function readSpan(value: string | undefined): GridSpan {
  const text = (value ?? '').trim();
  if (!text || text === 'auto') return { start: null, span: null };
  const parts = text.split('/').map((part) => part.trim());
  const head = parts[0];
  // A computed `span 2 / auto` is `span 2`.
  const tail = parts[1] === 'auto' ? undefined : parts[1];
  const spanOf = (part: string | undefined) => {
    const match = /^span\s+(\d+)$/i.exec(part ?? '');
    return match ? Number(match[1]) : null;
  };
  if (tail === undefined) {
    const span = spanOf(head);
    if (span !== null) return { start: null, span };
    return { start: head && head !== 'auto' ? head : null, span: head && head !== 'auto' ? 1 : null };
  }
  const start = head && head !== 'auto' ? head : null;
  const span = spanOf(tail);
  if (span !== null) return { start, span };
  // `1 / 3`: the span between two numbered lines. A line counted from the
  // end (`1 / -1`, full width) depends on how many tracks there are, so it
  // has no span; writing one would break the placement.
  if (start && /^\d+$/.test(start) && /^\d+$/.test(tail) && Number(start) > 0 && Number(tail) > 0) return { start, span: Math.abs(Number(tail) - Number(start)) || null };
  return { start, span: null };
}

/** What a typed span writes, keeping a written start line: `3 / span n`, `span n`; empty: back to auto (or the start line alone). */
export function spanValue(current: string | undefined, typed: string): string | null {
  const { start } = readSpan(current);
  const text = typed.trim();
  if (!text || text === 'auto') return start;
  const n = Math.min(MAX_TRACKS, Math.max(1, Math.round(Number(text))));
  if (!Number.isFinite(n)) return current ?? null;
  return start ? `${start} / span ${n}` : `span ${n}`;
}
