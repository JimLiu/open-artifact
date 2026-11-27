/**
 * Distances from the selection to another box, shown while Alt (Option) is
 * held: edge-to-edge gaps along each axis, in whole slide pixels.
 *
 * When the two boxes overlap both across and down (one inside the other, or
 * the two crossing), the four pairs of like edges are measured: left to
 * left, right to right, top to top, bottom to bottom. Otherwise only the
 * gaps between them. A line (no width or no height) lying on the other
 * box's edge counts as overlapping it.
 */

import { samePath, type NodePath, type Rect } from '@open-artifact/slides-core';

/** The axis a gap runs along. */
export type Axis = 'x' | 'y';

/** One measured gap: it runs along `axis` from `from` to `to`, drawn at `at` on the other axis. */
export interface Gap {
  axis: Axis;
  from: number;
  to: number;
  at: number;
  /** The length, rounded to whole slide pixels (never below 1). */
  value: number;
  /** When the gap's line passes beside the other box: a dashed lead out to it, along the other axis. */
  lead: { from: number; to: number } | null;
}

/** A stretch of one axis. */
interface Span {
  start: number;
  end: number;
}

/** Below this two edges are the same, slide px. */
const TOLERANCE = 0.01;

function spanOf(rect: Rect, axis: Axis): Span {
  return axis === 'x' ? { start: rect.x, end: rect.x + rect.w } : { start: rect.y, end: rect.y + rect.h };
}

function middleOf(span: Span): number {
  return (span.start + span.end) / 2;
}

/** The middle of what two spans share, or null when they do not meet (a span with no length meets what it touches). */
function sharedMiddle(a: Span, b: Span): number | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  const flat = a.end - a.start <= TOLERANCE || b.end - b.start <= TOLERANCE;
  return end - start > (flat ? -TOLERANCE : TOLERANCE) ? (start + end) / 2 : null;
}

function gapBetween(axis: Axis, from: number, to: number, at: number, beside: Span): Gap | null {
  const value = Math.round(Math.abs(to - from));
  if (value < 1) return null;
  const lead = at < beside.start ? { from: at, to: beside.start } : at > beside.end ? { from: beside.end, to: at } : null;
  return { axis, from, to, at, value, lead };
}

/** The gaps between the selection's box and `target`, both in slide coordinates. */
export function measureGaps(selection: Rect, target: Rect): Gap[] {
  const shared: Record<Axis, number | null> = {
    x: sharedMiddle(spanOf(selection, 'x'), spanOf(target, 'x')),
    y: sharedMiddle(spanOf(selection, 'y'), spanOf(target, 'y')),
  };
  const overlapping = shared.x !== null && shared.y !== null;
  const gaps: Gap[] = [];
  for (const axis of ['x', 'y'] as const) {
    const across: Axis = axis === 'x' ? 'y' : 'x';
    const own = spanOf(selection, axis);
    const theirs = spanOf(target, axis);
    // Drawn through the part both boxes share across, else through the selection's middle.
    const at = shared[across] ?? middleOf(spanOf(selection, across));
    let pairs: (readonly [number, number])[];
    if (overlapping) pairs = [[own.start, theirs.start], [own.end, theirs.end]];
    else if (theirs.end <= own.start) pairs = [[own.start, theirs.end]];
    else if (theirs.start >= own.end) pairs = [[own.end, theirs.start]];
    else pairs = [];
    for (const [from, to] of pairs) {
      const gap = gapBetween(axis, from, to, at, spanOf(target, across));
      if (gap) gaps.push(gap);
    }
  }
  return gaps;
}

/**
 * What the selection is measured against, best first: the hovered element
 * (unless it is itself selected), then the containers of the first selected
 * element from the nearest out. The slide is the last resort, after these.
 */
export function measureTargets(selection: readonly NodePath[], hover: NodePath | null): NodePath[] {
  const targets: NodePath[] = [];
  if (hover && !selection.some((path) => samePath(path, hover))) targets.push(hover);
  const first = selection[0];
  for (let depth = (first?.length ?? 0) - 1; depth >= 1; depth--) targets.push(first!.slice(0, depth));
  return targets;
}
