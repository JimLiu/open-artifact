/**
 * Where the selection bar stands across: centred over what is selected,
 * kept inside the room it floats in with a margin on both sides. A strip
 * wider than the room is held to the room's width (it folds what does not
 * fit) and starts at the left margin.
 */

/** The gap the strip keeps from both edges of its room. */
export const BAR_MARGIN = 8;

const clampTo = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The widest the strip may be in a room this wide. */
export const barLimit = (room: number): number => Math.max(0, room - BAR_MARGIN * 2);

/**
 * The strip's left edge for a selection spanning `selection` (left and
 * width, in the room's coordinates), when the strip is `strip` wide and the
 * room `room` wide.
 */
export function barLeft(selection: { left: number; width: number }, strip: number, room: number): number {
  const half = Math.min(strip, barLimit(room)) / 2;
  const centre = clampTo(selection.left + selection.width / 2, BAR_MARGIN + half, room - BAR_MARGIN - half);
  return Math.max(BAR_MARGIN, centre - strip / 2);
}
