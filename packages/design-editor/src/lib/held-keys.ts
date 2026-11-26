/**
 * Keys held down for a mode: Space pans while held, Alt shows distances.
 * The browser doesn't always say when they come up (macOS sends no Space
 * keyup while ⌘ is down, and a shortcut like ⌘Space hands the key to the
 * system), so these decide from each key event whether the mode goes on.
 */

/** The parts of a keyboard event these read. */
export interface HeldKeyEvent {
  type: 'keydown' | 'keyup';
  key: string;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

const MODIFIERS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'OS']);

/**
 * Whether Space panning is on after this event. Space down starts it and
 * Space up ends it; a modifier pressed meanwhile ends it (the press is a
 * shortcut now, not a pan), and so does ⌘ coming up, after which no Space
 * keyup may follow.
 */
export function spacePanAfter(held: boolean, event: HeldKeyEvent): boolean {
  if (event.key === ' ') return event.type === 'keydown' ? !(event.metaKey || event.ctrlKey || event.altKey) : false;
  if (!held) return false;
  if (event.type === 'keydown' && MODIFIERS.has(event.key)) return false;
  if (event.type === 'keyup' && event.key === 'Meta') return false;
  return true;
}

/** Whether Alt is held after this event (any event carries the modifier state). */
export function altHeldAfter(event: HeldKeyEvent): boolean {
  if (event.key === 'Alt') return event.type === 'keydown';
  return Boolean(event.altKey);
}
