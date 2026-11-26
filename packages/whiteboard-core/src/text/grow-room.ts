/**
 * Room to grow: a note or shape that grows to fit its text (after typing,
 * pasting, marking, or once the page's fonts load) must not grow into an
 * item it was clear of. Only solid items count as in the way; an overlap
 * that was already there before the growth is not held against it.
 */

import { elementLayoutBox, type Box, type ElementMeasures } from '../geometry.ts';
import { placementRectsOverlap } from '../layout.ts';
import type { BoardElement, ElementId, ShapeElement } from '../schema.ts';

/** Item types a growing box must not run into. */
export const GROW_BLOCKERS: ReadonlySet<BoardElement['type']> = new Set(['note', 'shape', 'text', 'image', 'html', 'timer', 'link', 'table']);

/** True when growing item `id` from `before` to `after` makes it overlap a blocking item it did not overlap before. */
export function growthMeetsNeighbor(elements: readonly BoardElement[], id: ElementId, before: Box, after: Box, measures?: ElementMeasures): boolean {
  for (const other of elements) {
    if (other.id === id || !GROW_BLOCKERS.has(other.type)) continue;
    const box = elementLayoutBox(other, measures);
    if (box !== undefined && placementRectsOverlap(after, box, 0) && !placementRectsOverlap(before, box, 0)) return true;
  }
  return false;
}

/**
 * True when a box grown to `size` would run into a neighbor, whether it
 * keeps its top-left corner or its center.
 */
export function grownSizeMeetsNeighbor(elements: readonly BoardElement[], element: ShapeElement, size: { w: number; h: number }, measures?: ElementMeasures): boolean {
  const before: Box = { x: element.x, y: element.y, w: element.w, h: element.h };
  const fromCorner: Box = { ...before, ...size };
  const fromCenter: Box = { x: element.x + (element.w - size.w) / 2, y: element.y + (element.h - size.h) / 2, ...size };
  return growthMeetsNeighbor(elements, element.id, before, fromCorner, measures) || growthMeetsNeighbor(elements, element.id, before, fromCenter, measures);
}
