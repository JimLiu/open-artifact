/**
 * Distances shown while Alt is held: from the selection's bounds to the
 * object under the pointer, along each axis. Pure geometry, in whatever
 * coordinates the rects are given in.
 */

import type { Rect } from '@open-artifact/design-core';

/** One distance: a horizontal or vertical segment and its length. */
export interface MeasureLine {
  axis: 'x' | 'y';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
}

/** The middle of the overlap of two spans, or of the first span when they don't overlap. */
function across(a0: number, a1: number, b0: number, b1: number): number {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return lo <= hi ? (lo + hi) / 2 : (a0 + a1) / 2;
}

/** Gaps along one axis between [a0, a1] and [b0, b1]: the space between them, or between their edges when one holds the other. */
function gaps(a0: number, a1: number, b0: number, b1: number, edges: boolean): [number, number][] {
  if (b0 >= a1) return [[a1, b0]];
  if (b1 <= a0) return [[b1, a0]];
  if (!edges) return [];
  const inside = (b0 >= a0 && b1 <= a1) || (a0 >= b0 && a1 <= b1);
  if (!inside) return [];
  return [[Math.min(a0, b0), Math.max(a0, b0)], [Math.min(a1, b1), Math.max(a1, b1)]];
}

/**
 * The distance lines from `from` to `to`: horizontal ones at the height the
 * two share (or the middle of `from`), vertical ones likewise. Rects that
 * hold one another get a line to each matching edge; zero-length lines are
 * left out.
 */
export function measureLines(from: Rect, to: Rect): MeasureLine[] {
  const out: MeasureLine[] = [];
  // Edge to edge only when neither is off to the side of the other.
  const apart = to.x >= from.x + from.w || to.x + to.w <= from.x || to.y >= from.y + from.h || to.y + to.h <= from.y;
  const y = across(from.y, from.y + from.h, to.y, to.y + to.h);
  for (const [x1, x2] of gaps(from.x, from.x + from.w, to.x, to.x + to.w, !apart)) {
    if (x2 - x1 > 0) out.push({ axis: 'x', x1, y1: y, x2, y2: y, length: x2 - x1 });
  }
  const x = across(from.x, from.x + from.w, to.x, to.x + to.w);
  for (const [y1, y2] of gaps(from.y, from.y + from.h, to.y, to.y + to.h, !apart)) {
    if (y2 - y1 > 0) out.push({ axis: 'y', x1: x, y1, x2: x, y2, length: y2 - y1 });
  }
  return out;
}

/** True when `inner` lies wholly within `outer` (edges may touch). */
export function rectWithin(inner: Rect, outer: Rect): boolean {
  const right = (r: Rect) => r.x + r.w;
  const bottom = (r: Rect) => r.y + r.h;
  return Math.min(inner.x - outer.x, inner.y - outer.y, right(outer) - right(inner), bottom(outer) - bottom(inner)) >= 0;
}
