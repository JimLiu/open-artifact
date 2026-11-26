/**
 * Smart guides for moves and resizes: which still items a dragged box snaps
 * to, how far it snaps from, and how long each matched guide is drawn.
 *
 * Only items in view count, and of those: neighbours close by; everything in
 * the smallest section around the dragged box; and, while only words (with
 * their arrows and stickers) move, every other text, so that lines of words
 * line up across the board.
 */

import {
  buildSiblingSnapCandidates,
  elementBounds,
  type BoardElement,
  type Box,
  type ElementId,
  type ElementMeasures,
  type SnapGuide,
} from '@open-artifact/whiteboard-core';
import type { Rect } from '../lib/camera.ts';
import type { GuideLine } from '../selection/store.ts';

/** Snap distance, screen pixels. */
export const SNAP_DISTANCE_PX = 8;
/** Larger items snap from further: this share of their longer side (board units). */
export const SNAP_DISTANCE_RATIO = 1 / 12;
/** Neighbours count within this many of the larger side, or this many screen pixels. */
export const SNAP_NEIGHBOUR_REACH = { sides: 1.5, px: 320 } as const;

/** A still item's box, as snapping reads it. */
export interface SnapBox extends Box {
  /** A text snapped to from anywhere in view (only words are moving). */
  far?: true;
  /** A section. */
  section?: true;
}

/** Items that neither snap nor are snapped to. */
const UNSNAPPED: ReadonlySet<BoardElement['type']> = new Set(['stroke', 'arrow', 'sticker']);

/** Boxes of the items that stay put during a drag (no drawings, arrows or stickers). */
export function stillBoxes(elements: readonly BoardElement[], moving: ReadonlySet<ElementId>, measures: ElementMeasures): SnapBox[] {
  const movingTypes = new Set(elements.filter((element) => moving.has(element.id)).map((element) => element.type));
  const wordsOnly = movingTypes.has('text') && [...movingTypes].every((type) => type === 'text' || UNSNAPPED.has(type));
  const boxes: SnapBox[] = [];
  for (const element of elements) {
    if (moving.has(element.id) || UNSNAPPED.has(element.type)) continue;
    const box = elementBounds(element, measures);
    if (!box) continue;
    boxes.push({ ...box, ...(wordsOnly && element.type === 'text' ? { far: true } : {}), ...(element.type === 'container' ? { section: true } : {}) });
  }
  return boxes;
}

/** Gap between two boxes (negative when they overlap). */
function gapBetween(a: Box, b: Box): number {
  return Math.max(a.x - b.x - b.w, b.x - a.x - a.w, a.y - b.y - b.h, b.y - a.y - a.h);
}

/** True when `other` is close enough to `box` to count as its neighbour. */
function isNeighbour(other: Box, box: Box, zoom: number): boolean {
  return gapBetween(other, box) <= Math.max(SNAP_NEIGHBOUR_REACH.sides * Math.max(other.w, other.h, box.w, box.h), SNAP_NEIGHBOUR_REACH.px / Math.max(1, zoom));
}

/** True when the middle of `inner` lies in `outer` (edges included). */
function holdsMiddleOf(outer: Box, inner: Box): boolean {
  const x = inner.x + inner.w / 2;
  const y = inner.y + inner.h / 2;
  return x >= outer.x && x <= outer.x + outer.w && y >= outer.y && y <= outer.y + outer.h;
}

/** The smallest section, larger than `box`, around the middle of `box`. */
function sectionAround(boxes: readonly SnapBox[], box: Box): SnapBox | undefined {
  let found: SnapBox | undefined;
  for (const other of boxes) {
    if (other.section !== true || other.w * other.h <= box.w * box.h || !holdsMiddleOf(other, box)) continue;
    if (found === undefined || other.w * other.h < found.w * found.h) found = other;
  }
  return found;
}

/** The still boxes in view that `box` snaps to (see the module comment). */
export function nearbyBoxes(boxes: readonly SnapBox[], box: Box, view: Rect, zoom: number): SnapBox[] {
  const section = sectionAround(boxes, box);
  return boxes.filter(
    (other) =>
      gapBetween(other, view) < 0 &&
      (other.far === true || isNeighbour(other, box, zoom) || (section !== undefined && holdsMiddleOf(section, other))),
  );
}

/** Snap candidates (edges and centers) of the boxes `box` snaps to. */
export function snapCandidatesNear(boxes: readonly SnapBox[], box: Box, view: Rect, zoom: number): SnapGuide[] {
  return buildSiblingSnapCandidates(nearbyBoxes(boxes, box, view, zoom));
}

/** How far (board units) a box snaps from at a zoom. */
export function snapDistanceFor(box: Box, zoom: number): number {
  return Math.min(SNAP_DISTANCE_PX / zoom, Math.max(SNAP_DISTANCE_PX, SNAP_DISTANCE_RATIO * Math.max(box.w, box.h)));
}

/**
 * Matched guides with their drawn extent: from the dragged box across every
 * neighbour on the line, or, with none close by, to the nearest box on it.
 */
export function guideLines(guides: readonly SnapGuide[], boxes: readonly SnapBox[], box: Box, view: Rect, zoom: number): GuideLine[] {
  if (guides.length === 0) return [];
  const near = nearbyBoxes(boxes, box, view, zoom);
  return guides.map((guide) => {
    const vertical = guide.axis === 'x';
    const aligned = near.filter((other) =>
      (vertical ? [other.x, other.x + other.w / 2, other.x + other.w] : [other.y, other.y + other.h / 2, other.y + other.h]).some((value) => Math.abs(value - guide.pos) < 0.5),
    );
    const neighbours = aligned.filter((other) => isNeighbour(other, box, zoom));
    const nearest = aligned.reduce<Box | undefined>((best, other) => (best === undefined || gapBetween(other, box) < gapBetween(best, box) ? other : best), undefined);
    const spanned = [box, ...(neighbours.length > 0 ? neighbours : nearest ? [nearest] : [])];
    return {
      ...guide,
      from: Math.min(...spanned.map((each) => (vertical ? each.y : each.x))),
      to: Math.max(...spanned.map((each) => (vertical ? each.y + each.h : each.x + each.w))),
    };
  });
}
