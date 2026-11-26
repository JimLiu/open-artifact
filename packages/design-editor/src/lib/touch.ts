/**
 * Touch taps on the canvas. A fingertip wobbles a few pixels while it rests,
 * far more than a mouse does, so a touch counts as a tap until it travels
 * further than the mouse drag threshold before it turns into a pan.
 */

/** How far (CSS pixels) a finger may drift and still tap. */
export const TOUCH_TAP_SLOP = 9;

/** True while a touch that went down at `start` and is now at `point` can still be a tap. */
export function staysTap(start: { x: number; y: number }, point: { x: number; y: number }): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) <= TOUCH_TAP_SLOP;
}
