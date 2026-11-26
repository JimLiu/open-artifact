/**
 * Holding Shift while dragging keeps the move on one of eight directions:
 * across, up and down, or a 45° diagonal, whichever the pointer is nearest.
 */

/** tan 22.5°: the half-angle between two neighbouring directions. */
const HALF_STEP = Math.SQRT2 - 1;

/** The drag `(dx, dy)` brought onto the nearest of the eight directions. */
export function shiftDragDelta(dx: number, dy: number): { x: number; y: number } {
  const across = Math.abs(dx);
  const down = Math.abs(dy);
  if (down <= across * HALF_STEP) return { x: dx, y: 0 };
  if (across <= down * HALF_STEP) return { x: 0, y: dy };
  const slope = dx * dy > 0 ? 1 : -1;
  // The point on the diagonal nearest the pointer.
  const along = Math.round((dx + dy * slope) / 2);
  return { x: along, y: along * slope };
}

/**
 * Axes a positioned element is held on when dragged: set from both sides
 * (`left` and `right`, or `top` and `bottom`) it is stretched between them,
 * so it only moves the other way.
 */
export function pinnedAxes(inline: Record<string, string | undefined>): { x: boolean; y: boolean } {
  const set = (name: string): boolean => Boolean(inline[name]?.trim()) && inline[name]!.trim() !== 'auto';
  return { x: set('left') && set('right'), y: set('top') && set('bottom') };
}
