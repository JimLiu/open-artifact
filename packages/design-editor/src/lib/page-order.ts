/**
 * Pure parts of reordering pages by dragging their rows in the page list:
 * where a dragged row lands, which page it then follows, and how fast the
 * list scrolls near its edges.
 */

/** A row's vertical extent on screen. */
export interface RowSpan {
  top: number;
  bottom: number;
}

/**
 * The gap a dragged row lands in, `0..rows.length`: before a row when the
 * pointer is over its upper half, after it over the lower half, last below
 * every row.
 */
export function pageDropIndex(rows: readonly RowSpan[], y: number): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (y < (row.top + row.bottom) / 2) return i;
  }
  return rows.length;
}

/** Dropping the row at `from` into gap `index` leaves the order as it is. */
export function dropKeepsOrder(from: number, index: number): boolean {
  return index === from || index === from + 1;
}

/**
 * The page the dragged one follows after dropping it into gap `index`
 * (`null` = first), counted in the list without the dragged page.
 * `undefined` when the drop changes nothing.
 */
export function pageAfterDrop(ids: readonly string[], from: number, index: number): string | null | undefined {
  if (from < 0 || from >= ids.length || dropKeepsOrder(from, index)) return undefined;
  const rest = ids.filter((_, i) => i !== from);
  const at = index > from ? index - 1 : index;
  return at <= 0 ? null : rest[at - 1]!;
}

/** Where the insertion line goes: at the top or bottom edge of a row. */
export function dropLine(rows: readonly RowSpan[], from: number, index: number): number | null {
  if (!rows.length || dropKeepsOrder(from, index)) return null;
  return index < rows.length ? rows[index]!.top : rows[rows.length - 1]!.bottom;
}

/** Pixels from the list's edge where dragging scrolls it. */
export const DRAG_SCROLL_EDGE = 24;
/** Pixels past the list's edge that still scroll it. */
export const DRAG_SCROLL_OVERSHOOT = 16;
/** Pixels scrolled per frame. */
export const DRAG_SCROLL_STEP = 8;

/** How far to scroll the list this frame for a pointer at `y` (negative = up). */
export function dragScrollStep(list: RowSpan, y: number): number {
  if (y < list.top - DRAG_SCROLL_OVERSHOOT || y > list.bottom + DRAG_SCROLL_OVERSHOOT) return 0;
  if (y < list.top + DRAG_SCROLL_EDGE) return -DRAG_SCROLL_STEP;
  if (y > list.bottom - DRAG_SCROLL_EDGE) return DRAG_SCROLL_STEP;
  return 0;
}

/** A drag starts once the pointer has moved this far. */
export const PAGE_DRAG_THRESHOLD = 4;
