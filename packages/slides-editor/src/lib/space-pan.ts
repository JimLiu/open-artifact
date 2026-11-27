/**
 * Holding Space (Shift+Space too) to drag the stage around, or dragging it
 * with the middle button: what each press and release of the key, and each
 * press of the pointer, does to the hold,
 * and when the browser's own handling of the key has to be stopped (a
 * repeating Space scrolls the page; a Space released after a drag would
 * click a focused button).
 */

/** Where a Space hold stands. */
export interface SpaceHold {
  /** Space is down and belongs to the stage. */
  held: boolean;
  /** The stage is being dragged. */
  dragging: boolean;
  /** The stage was dragged during this hold, so the key's release is swallowed. */
  dragged: boolean;
}

/** No hold. */
export const SPACE_RELEASED: SpaceHold = { held: false, dragging: false, dragged: false };

/** A Space keydown, as far as the hold cares. */
export interface SpacePress {
  repeat: boolean;
  /** Alt, Ctrl or Meta is down (Shift is not: Shift+Space pans too). */
  chord: boolean;
  /** The key is someone else's: a field, a focused control, a dialog, text being typed. */
  elsewhere: boolean;
}

/** The hold after a key event, and whether to stop the browser's default. */
export interface SpaceStep {
  hold: SpaceHold;
  preventDefault: boolean;
}

/** True for the Space bar, by its physical key. */
export function isSpaceKey(event: { code: string; key: string }): boolean {
  return event.code ? event.code === 'Space' : event.key === ' ';
}

/** Space pressed, or repeating while down. */
export function pressSpace(hold: SpaceHold, press: SpacePress): SpaceStep {
  // Once held, the key's repeats stay the stage's, wherever the focus went since.
  const keeps = press.repeat && hold.held;
  if (!keeps && (press.chord || press.elsewhere)) {
    return { hold: { ...hold, held: false, dragged: press.repeat && hold.dragged }, preventDefault: false };
  }
  if (press.repeat) return { hold, preventDefault: true };
  return { hold: { ...hold, held: true, dragged: hold.dragging }, preventDefault: true };
}

/** Space released. */
export function releaseSpace(hold: SpaceHold): SpaceStep {
  return { hold: { ...hold, held: false, dragged: false }, preventDefault: hold.dragged };
}

/** Another key released. Letting go of ⌘ ends the hold: a Mac sends no keyup for keys released while ⌘ is down. */
export function releaseOtherKey(hold: SpaceHold, key: string): SpaceHold {
  return key === 'Meta' && hold.held ? { ...hold, held: false } : hold;
}

/** `PointerEvent.button` of the middle button (the wheel). */
export const MIDDLE_BUTTON = 1;

/**
 * The pointer pressed on the stage: while Space is held any button starts a
 * drag of the stage; the middle button does without it. Only a drag made
 * during the hold swallows the key's release.
 */
export function pressPointer(hold: SpaceHold, button = 0): { hold: SpaceHold; drags: boolean } {
  if (hold.held) return { hold: { ...hold, dragging: true, dragged: true }, drags: true };
  return { hold, drags: button === MIDDLE_BUTTON };
}

/** The pointer released (or the press was cancelled). */
export function releasePointer(hold: SpaceHold): SpaceHold {
  return hold.dragging ? { ...hold, dragging: false } : hold;
}
