/**
 * The corner radius new rectangles take: the last one set in px on an
 * element or a rectangle note, kept for each document in this browser
 * (in memory only when storage is unavailable).
 */

import { cornersOf, parseCorners, radiusKey, type Corners } from '../lib/board-draw.ts';

/** What was remembered while storage could not be used, by document. */
const fallback = new Map<string, Corners>();

const key = (): string => radiusKey(typeof location === 'undefined' ? '/' : location.pathname);

/** The remembered corners, or `null` when none were set in this document. */
export function recalledRadius(): Corners | null {
  const at = key();
  try {
    const stored = parseCorners(globalThis.localStorage?.getItem(at));
    if (stored) return stored;
  } catch {
    // Storage may be unavailable.
  }
  return fallback.get(at) ?? null;
}

/**
 * Remembers a radius just set: one `border-radius` value, or the four
 * corners. Lengths that are not px are not remembered.
 */
export function rememberRadius(value: string | readonly string[]): void {
  const corners = cornersOf(value);
  if (!corners) return;
  const at = key();
  fallback.set(at, corners);
  try {
    globalThis.localStorage?.setItem(at, JSON.stringify(corners));
  } catch {
    // Kept in memory for this visit.
  }
}
