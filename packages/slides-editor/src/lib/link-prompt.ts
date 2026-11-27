/**
 * Where the link field opened by ⌘K sits while the format bar is not shown:
 * against the selected text, kept inside the window so that a selection
 * scrolled partly out of view still gets a field the person can see.
 */

/** A box in window px. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Space kept between the box and the window's edges. */
const EDGE = 8;

/**
 * The box the field is placed against: the selection's box, moved and cut to
 * lie inside the window (`EDGE` px in). A box wholly outside the window ends
 * up as a sliver along the nearest edge.
 */
export function linkPromptBox(selection: Box, view: { width: number; height: number }): Box {
  const left = Math.min(Math.max(selection.x, EDGE), view.width - EDGE);
  const top = Math.min(Math.max(selection.y, EDGE), view.height - EDGE);
  const right = Math.max(Math.min(selection.x + selection.width, view.width - EDGE), left);
  const bottom = Math.max(Math.min(selection.y + selection.height, view.height - EDGE), top);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
