/**
 * Keeping what the keyboard works on in sight: how far the stage has to
 * scroll for a rectangle (an element, the caret) to show inside the part of
 * the stage the floating cards leave uncovered.
 */

/** A rectangle by its edges (client coordinates). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A distance along each axis. */
export interface Offset {
  x: number;
  y: number;
}

/** Asks the stage to bring the selected element (or the caret) into view: sent after a keyboard selection. */
export const REVEAL_FOCUS_EVENT = 'open-artifact-slides:reveal-focus';

/** Sent just before a zoom step, so the stage can keep in view what was in view. */
export const ZOOM_STEP_EVENT = 'open-artifact-slides:zoom-step';

/** `box` shrunk by `inset` on each side. */
export function insetBox(box: Box, inset: Partial<Box>): Box {
  return {
    left: box.left + (inset.left ?? 0),
    top: box.top + (inset.top ?? 0),
    right: box.right - (inset.right ?? 0),
    bottom: box.bottom - (inset.bottom ?? 0),
  };
}

/** True when the two rectangles share some area. */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Room the caret keeps from the view's edges while typing: a fifth of the view each way. */
export function caretRoom(view: Box): Offset {
  return { x: Math.max(0, view.right - view.left) / 5, y: Math.max(0, view.bottom - view.top) / 5 };
}

/**
 * Scrolling along one axis that brings [start, end] inside [viewStart,
 * viewEnd] with `margin` to spare, moving as little as possible (0 when it is
 * already there). The margin shrinks to what the view can spare; a target
 * longer than the view shows its start.
 */
function axisOffset(viewStart: number, viewEnd: number, start: number, end: number, margin: number): number {
  const room = viewEnd - viewStart;
  const length = end - start;
  if (room <= 0) return 0;
  if (length >= room) return start - viewStart;
  const spare = Math.max(0, Math.min(margin, (room - length) / 2));
  if (start < viewStart + spare) return start - (viewStart + spare);
  if (end > viewEnd - spare) return end - (viewEnd - spare);
  return 0;
}

/** How far to scroll (right and down positive) so `target` shows in `view` with `margin` around it. */
export function revealOffset(view: Box, target: Box, margin: Offset | number = 0): Offset {
  const m = typeof margin === 'number' ? { x: margin, y: margin } : margin;
  return {
    x: axisOffset(view.left, view.right, target.left, target.right, m.x),
    y: axisOffset(view.top, view.bottom, target.top, target.bottom, m.y),
  };
}
