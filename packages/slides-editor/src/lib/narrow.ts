/**
 * How the editor fits a narrow window: whether the slide rail has room
 * beside the stage, and where the pager and zoom card goes so it stays
 * clear of the centred toolbar at the bottom.
 */

/** From this window width on the slide rail shows beside the stage, px. */
export const RAIL_MIN_WIDTH = 1024;

/** How far under {@link RAIL_MIN_WIDTH} the window must fall before the rail hides, px (so a window near the line doesn't flicker). */
export const RAIL_HYSTERESIS = 16;

/**
 * Whether the rail has room at this window width. Between the two lines
 * the previous answer holds (and, with none yet, there's no room).
 */
export function railFits(previous: boolean | null, width: number): boolean {
  if (width >= RAIL_MIN_WIDTH) return true;
  if (width <= RAIL_MIN_WIDTH - RAIL_HYSTERESIS) return false;
  return previous ?? false;
}

/** Gap between the pager card and the stage's right edge, px. */
export const CORNER_EDGE = 12;

/** Gap between the pager card and the toolbar, px. */
export const CORNER_GAP = 8;

/**
 * How far the centred toolbar moves left for the pager card (`own` px wide)
 * to fit beside it in an `area` px wide stage: 0 when it fits already, or
 * `'above'` when there isn't room even then, and the card goes above the
 * toolbar instead.
 */
export function cornerShift(area: number, toolbar: number, own: number): number | 'above' {
  const room = (area - toolbar) / 2;
  const shift = Math.ceil(CORNER_EDGE + own + CORNER_GAP - room);
  if (shift <= 0) return 0;
  return room - shift >= CORNER_GAP ? shift : 'above';
}
