/**
 * One-finger horizontal swipes that page through artboards in the focused
 * view, on touch screens. Pure decisions; services/swipe.ts listens.
 */

/** A swipe must cover this many screen pixels sideways… */
export const SWIPE_MIN_DISTANCE = 40;
/** …be this much more sideways than up or down… */
export const SWIPE_SLANT = 1.2;
/** …and be over within this many milliseconds. */
export const SWIPE_MAX_MS = 700;
/** Touches that start this close to a screen edge belong to the system (back gestures). */
export const SWIPE_EDGE = 24;

/** Where a swipe goes: 1 to the next artboard (finger moved left), -1 to the previous, 0 not a swipe. */
export type SwipeStep = -1 | 0 | 1;

/** The step a finger that moved by (dx, dy) screen pixels in `elapsed` ms asks for. */
export function swipeStep(dx: number, dy: number, elapsed: number): SwipeStep {
  if (elapsed > SWIPE_MAX_MS) return 0;
  const across = Math.abs(dx);
  if (across < SWIPE_MIN_DISTANCE || across < Math.abs(dy) * SWIPE_SLANT) return 0;
  return dx < 0 ? 1 : -1;
}

/** True when a touch at `x` starts too near the left or right edge of a `width`-wide screen. */
export function nearEdge(x: number, width: number): boolean {
  return x < SWIPE_EDGE || x > width - SWIPE_EDGE;
}

/** Less than this (CSS pixels) left to scroll is rounding, not room. */
const SCROLL_SLACK = 0.5;

/** The parts of a scrolled box this reads. */
export interface ScrollBox {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * True when the box can still scroll the way a swipe of `step` would push it
 * (a swipe to the next artboard drags content leftward, so it reveals what is
 * to the right). In right-to-left boxes scrollLeft runs from 0 down to minus the overflow.
 */
export function scrollsToward(box: ScrollBox, step: SwipeStep, rtl = false): boolean {
  if (step === 0) return false;
  const room = box.scrollWidth - box.clientWidth;
  // How far along from the start edge (left, or right when rtl) the box is scrolled.
  const along = rtl ? -box.scrollLeft : box.scrollLeft;
  // Sideways from where it is: ahead to the far edge, or back to the start one.
  const left = (rtl ? step === -1 : step === 1) ? room - along : along;
  return left > SCROLL_SLACK;
}
