/**
 * The lasso: a stylus on a touch screen draws a loop over empty board to
 * pick what is inside it.
 *
 * - A point is added after {@link LASSO.stepPx} of movement; the line
 *   counts as a loop after {@link LASSO.loopPx} of travel.
 * - On release, an item is picked when more than half of its sample points
 *   are inside the loop ({@link lassoSamples}). A section around the place
 *   the lasso started is never picked; locked items only when nothing else
 *   is; groups are picked whole.
 * - Without a loop, the release picks what is under the stylus, or clears
 *   the selection.
 * - Holding still first turns the press into a hold (see `select.ts`).
 */

import {
  arrowHeads,
  arrowPolyline,
  boxCenter,
  elementBounds,
  elementLayoutBox,
  elementTurn,
  expandSelectionToGroups,
  measuredArrowGeometry,
  rotatePointAround,
  withoutLockedIdsUnlessAll,
  type BoardElement,
  type ElementId,
  type ElementMeasures,
  type ElementsById,
} from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';

/** Screen distances of the lasso: between its points, and the travel that makes it a loop. */
export const LASSO = { stepPx: 2, loopPx: 10 } as const;
/** Points sampled along a stroke at most. */
const STROKE_SAMPLES = 40;
/** Points sampled along each leg of an arrow. */
const ARROW_LEG_SAMPLES = 5;
/** Rows and columns of the grid sampled over other items. */
const GRID_SAMPLES = 5;

/** True when `point` is inside the closed polygon `polygon` (even-odd). */
export function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The board points that stand for an item when a lasso is tested against it. */
export function lassoSamples(element: BoardElement, measures?: ElementMeasures, byId?: ElementsById): Point[] {
  if (element.type === 'stroke') {
    const count = element.points.length / 2;
    const step = Math.max(1, Math.ceil(count / STROKE_SAMPLES));
    const box = elementLayoutBox(element, measures);
    const turn = elementTurn(element);
    const out: Point[] = [];
    for (let index = 0; index < count; index += step) {
      const point = { x: element.x + element.points[index * 2]!, y: element.y + element.points[index * 2 + 1]! };
      out.push(box && turn !== 0 ? rotatePointAround(point, boxCenter(box), turn) : point);
    }
    return out;
  }
  if (element.type === 'arrow') {
    const line = byId ? measuredArrowGeometry(element, byId, measures) : undefined;
    const flat = line ? arrowPolyline(line, arrowHeads(element)) : [];
    const out: Point[] = [];
    for (let index = 0; index + 3 < flat.length; index += 2) {
      const [x0, y0, x1, y1] = [flat[index]!, flat[index + 1]!, flat[index + 2]!, flat[index + 3]!];
      if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
      for (let step = 0; step < ARROW_LEG_SAMPLES; step++) {
        const t = step / (ARROW_LEG_SAMPLES - 1);
        out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
      }
    }
    return out;
  }
  const box = elementBounds(element, measures);
  if (!box) return [];
  const out: Point[] = [];
  for (let row = 0; row < GRID_SAMPLES; row++) {
    for (let column = 0; column < GRID_SAMPLES; column++) {
      out.push({ x: box.x + (box.w * column) / (GRID_SAMPLES - 1), y: box.y + (box.h * row) / (GRID_SAMPLES - 1) });
    }
  }
  return out;
}

/** True when more than half of an item's samples are inside the loop. */
export function lassoTakes(element: BoardElement, loop: readonly Point[], measures?: ElementMeasures, byId?: ElementsById): boolean {
  const samples = lassoSamples(element, measures, byId);
  if (samples.length === 0) return false;
  const inside = samples.filter((point) => insidePolygon(point, loop)).length;
  return inside * 2 > samples.length;
}

/**
 * What a lasso picks: the items mostly inside `loop`, without a section
 * around `start`, grown to whole groups, without locked items unless only
 * locked items are inside.
 */
export function lassoPick(
  elements: readonly BoardElement[],
  loop: readonly Point[],
  start: Point,
  measures?: ElementMeasures,
  byId?: ElementsById,
): ReadonlySet<ElementId> {
  const around = (element: BoardElement): boolean => {
    if (element.type !== 'container') return false;
    const box = elementBounds(element, measures);
    return box !== undefined && start.x >= box.x && start.x <= box.x + box.w && start.y >= box.y && start.y <= box.y + box.h;
  };
  const taken = elements.filter((element) => !around(element) && lassoTakes(element, loop, measures, byId));
  const grown = expandSelectionToGroups(elements, new Set(taken.map((element) => element.id)), new Set());
  return withoutLockedIdsUnlessAll(elements, grown);
}

/** The SVG path of the lasso line. */
export function lassoPath(points: readonly Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

/* ------------------------------------------------------------------------ */
/* Gathering                                                                */
/* ------------------------------------------------------------------------ */

/**
 * After a finger or stylus picks with a rubber band or a lasso, taps
 * gather: tapping an item adds it to the selection or takes it out, and
 * tapping empty board clears the selection and stops gathering.
 */
let gathering = false;

/** Whether taps gather now. */
export function isGathering(): boolean {
  return gathering;
}

/** Starts or stops gathering. */
export function setGathering(on: boolean): void {
  gathering = on;
}
