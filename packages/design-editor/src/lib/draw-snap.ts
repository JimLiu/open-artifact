/**
 * Snapping while drawing on the canvas. The press point snaps to the edges
 * and centre lines of the artboards and notes around it (inside an
 * artboard, of its top-level boxes and its own); the dragged-out
 * end snaps on the axes the press point snapped on (an axis it did not
 * snap on keeps the raw pointer). Shift draws a square, or keeps a line on
 * a multiple of 45°, and the end then slides along that direction onto a
 * line. ⌘ / Ctrl turns snapping off (a `null` threshold here).
 */

import type { Guide } from '@open-artifact/canvas-engine';
import type { Rect } from '@open-artifact/design-core';

export interface Point {
  x: number;
  y: number;
}

/** A line to snap to: at `at` on one axis, from `from` to `to` on the other. */
export interface SnapLine {
  at: number;
  from: number;
  to: number;
}

/** Vertical lines (`xs`) and horizontal ones (`ys`). */
export interface SnapTargets {
  xs: SnapLine[];
  ys: SnapLine[];
}

/** Tools that snap while drawing. */
export type DrawTool = 'board' | 'rect' | 'oval' | 'line' | 'arrow';

/** Lines within this of the press point's own coordinate are left out under Shift. */
const SAME_LINE = 0.5;
const EPS = 1e-6;

/** The edges and centre lines of `rects`. */
export function snapTargets(rects: readonly Rect[]): SnapTargets {
  const xs: SnapLine[] = [];
  const ys: SnapLine[] = [];
  for (const r of rects) {
    for (const at of [r.x, r.x + r.w / 2, r.x + r.w]) xs.push({ at, from: r.y, to: r.y + r.h });
    for (const at of [r.y, r.y + r.h / 2, r.y + r.h]) ys.push({ at, from: r.x, to: r.x + r.w });
  }
  return { xs, ys };
}

/**
 * Lines to snap to while drawing inside an artboard: the edges and centre
 * lines of its top-level boxes that fall within it, and its own six.
 */
export function boardSnapTargets(board: Rect, boxes: readonly Rect[]): SnapTargets {
  const inner = snapTargets(boxes);
  const own = snapTargets([board]);
  return {
    xs: [...inner.xs.filter((line) => line.at >= board.x - EPS && line.at <= board.x + board.w + EPS), ...own.xs],
    ys: [...inner.ys.filter((line) => line.at >= board.y - EPS && line.at <= board.y + board.h + EPS), ...own.ys],
  };
}

/** The nearest line to `v` within `threshold`, leaving out those within `SAME_LINE` of `skip`. */
function nearest(lines: readonly SnapLine[], v: number, threshold: number, skip?: number): number | null {
  let best: number | null = null;
  for (const line of lines) {
    if (skip !== undefined && Math.abs(line.at - skip) <= SAME_LINE) continue;
    const d = line.at - v;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/** The press point of a drawing: raw, snapped, and on which axes it snapped. */
export interface DrawStart {
  raw: Point;
  at: Point;
  snapped: { x: boolean; y: boolean };
}

/** Snaps a press point (`threshold` null: no snapping). */
export function drawStart(targets: SnapTargets, raw: Point, threshold: number | null): DrawStart {
  if (threshold === null) return { raw, at: raw, snapped: { x: false, y: false } };
  const dx = nearest(targets.xs, raw.x, threshold);
  const dy = nearest(targets.ys, raw.y, threshold);
  return { raw, at: { x: raw.x + (dx ?? 0), y: raw.y + (dy ?? 0) }, snapped: { x: dx !== null, y: dy !== null } };
}

/** Guides through the points that lie on a line (on the axes asked for), each spanning its lines and the points. */
export function guidesThrough(targets: SnapTargets, points: readonly Point[], axes: { x: boolean; y: boolean }, skip: Partial<Point> = {}): Guide[] {
  const out: Guide[] = [];
  const add = (vertical: boolean, at: number, lines: readonly SnapLine[], span: number[]) => {
    const on = lines.filter((line) => Math.abs(line.at - at) < EPS);
    if (!on.length || out.some((g) => g.vertical === vertical && Math.abs(g.at - at) < EPS)) return;
    out.push({ vertical, at: on[0]!.at, from: Math.min(...on.map((l) => l.from), ...span), to: Math.max(...on.map((l) => l.to), ...span) });
  };
  for (const p of points) {
    if (axes.x && !(skip.x !== undefined && Math.abs(p.x - skip.x) <= SAME_LINE)) add(true, p.x, targets.xs, points.map((q) => q.y));
    if (axes.y && !(skip.y !== undefined && Math.abs(p.y - skip.y) <= SAME_LINE)) add(false, p.y, targets.ys, points.map((q) => q.x));
  }
  return out;
}

/** The guides a press here would snap to (hovering with a drawing tool). */
export function hoverGuides(targets: SnapTargets, pointer: Point, threshold: number | null): Guide[] {
  const start = drawStart(targets, pointer, threshold);
  return guidesThrough(targets, [start.at], start.snapped);
}

/** A unit-free direction rounded to a multiple of 45°. */
function octant(v: Point): Point {
  const angle = Math.round(Math.atan2(v.y, v.x) / (Math.PI / 4)) * (Math.PI / 4);
  const clean = (n: number) => (Math.abs(n) < EPS ? 0 : n);
  return { x: clean(Math.cos(angle)), y: clean(Math.sin(angle)) };
}

/** Where a drawing goes from and to, and the guides to show. */
export interface DrawSpan {
  from: Point;
  to: Point;
  guides: Guide[];
}

/**
 * The drawing from `start` to the pointer. Shift: a square on the larger
 * side (following the drag), or a line kept on a multiple of 45° with its
 * length; the end then slides along that direction onto the nearest line
 * (lines through the press point itself left out).
 */
export function drawSpan(targets: SnapTargets, start: DrawStart, pointer: Point, options: { tool: DrawTool; shift: boolean; threshold: number | null }): DrawSpan {
  const from = start.at;
  const v = { x: pointer.x - from.x, y: pointer.y - from.y };
  const snapping = options.threshold !== null;
  const th = options.threshold ?? 0;
  const axes = { x: snapping && start.snapped.x, y: snapping && start.snapped.y };
  if (!options.shift) {
    const to = { ...pointer };
    if (axes.x) to.x += nearest(targets.xs, to.x, th) ?? 0;
    if (axes.y) to.y += nearest(targets.ys, to.y, th) ?? 0;
    return { from, to, guides: guidesThrough(targets, [from, to], axes) };
  }
  let u: Point;
  let to: Point;
  if (options.tool === 'line' || options.tool === 'arrow') {
    const length = Math.hypot(v.x, v.y);
    u = length ? octant(v) : { x: 1, y: 0 };
    to = { x: from.x + u.x * length, y: from.y + u.y * length };
  } else {
    const side = Math.max(Math.abs(v.x), Math.abs(v.y));
    const sx = v.x < 0 ? -1 : 1;
    const sy = v.y < 0 ? -1 : 1;
    u = { x: sx, y: sy };
    to = { x: from.x + sx * side, y: from.y + sy * side };
  }
  // Slide along the direction: the nearest line (by distance along it) wins.
  let best: number | null = null;
  const consider = (d: number | null, along: number) => {
    if (d === null || !along) return;
    const t = d / along;
    if (best === null || Math.abs(t) < Math.abs(best)) best = t;
  };
  if (axes.x) consider(nearest(targets.xs, to.x, th, from.x), u.x);
  if (axes.y) consider(nearest(targets.ys, to.y, th, from.y), u.y);
  if (best !== null) to = { x: to.x + u.x * best, y: to.y + u.y * best };
  return { from, to, guides: guidesThrough(targets, [to], axes, from) };
}

/**
 * Whether the pointer drew something rather than clicked: past `min` on
 * either axis for lines and under Shift, on both otherwise. `min` is 8
 * screen pixels for artboards and 4 for the rest (world units at `zoom`).
 */
export function drewShape(span: Pick<DrawSpan, 'from' | 'to'>, options: { tool: DrawTool; shift: boolean; zoom: number }): boolean {
  const min = (options.tool === 'board' ? 8 : 4) / options.zoom;
  const x = Math.abs(span.to.x - span.from.x) > min;
  const y = Math.abs(span.to.y - span.from.y) > min;
  return options.tool === 'line' || options.tool === 'arrow' || options.shift ? x || y : x && y;
}

/** The box a drawing spans. */
export function spanBox(span: Pick<DrawSpan, 'from' | 'to'>): Rect {
  const x = Math.min(span.from.x, span.to.x);
  const y = Math.min(span.from.y, span.to.y);
  return { x, y, w: Math.abs(span.to.x - span.from.x), h: Math.abs(span.to.y - span.from.y) };
}
