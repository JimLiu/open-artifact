/**
 * The properties panel's resize handle beyond dragging: a press (a click
 * that is not a drag, or Enter / Space) steps the width through its preset
 * sizes, and a pointer has to travel a few pixels before it resizes.
 */

/** Pixels a pointer moves along the resize axis before the width follows it. */
export const PANEL_DRAG_THRESHOLD = 3;
/** Pixels a pointer may wander across the resize axis and still press the handle. */
export const PANEL_PRESS_SLOP = 8;
/** How long a mouse press waits, so a double-click can reset the width instead. */
export const PANEL_PRESS_DELAY = 500;

/** The widths a press steps through. */
export interface PanelPresets {
  /** The default width. */
  home: number;
  min: number;
  max: number;
  /** The last width the panel was dragged to, if any. */
  dragged: number | null;
}

/**
 * The width a press moves to: default, then widest, then narrowest, then the
 * last dragged width (when there is one and it is none of those), round again.
 * A width off that round goes to the widest.
 */
export function pressedWidth(width: number, presets: PanelPresets): number {
  const round: number[] = [];
  const dragged = presets.dragged === null ? null : Math.min(presets.max, Math.max(presets.min, presets.dragged));
  for (const size of [presets.home, presets.max, presets.min, dragged]) {
    if (size !== null && !round.includes(size)) round.push(size);
  }
  const at = round.indexOf(width);
  return at < 0 ? presets.max : round[(at + 1) % round.length]!;
}

/** A pointer held on the handle: where it went down and what it has done since. */
export interface HandlePointer {
  x: number;
  y: number;
  /** It travelled past {@link PANEL_DRAG_THRESHOLD} along the resize axis: the width follows it. */
  dragging: boolean;
  /** It wandered past {@link PANEL_PRESS_SLOP} across the resize axis: letting go is no press. */
  strayed: boolean;
}

export function holdHandle(x: number, y: number): HandlePointer {
  return { x, y, dragging: false, strayed: false };
}

/** The held pointer after it moved to (x, y). Once dragging or strayed, it stays so. */
export function moveHandle(held: HandlePointer, x: number, y: number): HandlePointer {
  const dragging = held.dragging || Math.abs(x - held.x) > PANEL_DRAG_THRESHOLD;
  const strayed = held.strayed || Math.abs(y - held.y) > PANEL_PRESS_SLOP;
  return dragging === held.dragging && strayed === held.strayed ? held : { ...held, dragging, strayed };
}

/** Letting go of the pointer presses the handle: it neither dragged nor strayed. */
export function isHandlePress(held: HandlePointer): boolean {
  return !held.dragging && !held.strayed;
}
