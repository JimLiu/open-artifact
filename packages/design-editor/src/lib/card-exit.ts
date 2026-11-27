/**
 * Closing a link's address field with the keyboard puts the focus back on
 * the canvas, where Delete would remove the selection. The first Delete or
 * Backspace after that only says so (press it again to delete); holding it
 * down does not count as pressing it again. Any other key, a click or
 * leaving the window ends this. The card keeps the focus while it animates
 * out; a Delete or Backspace landing in it then goes where the focus is
 * going.
 */

export type CardExitKey = 'first' | 'held' | null;

export interface CardExit {
  /**
   * The address field just closed by the keyboard: `by` is the key that
   * closed it (it is not the next key), `closing` tells the nodes of the
   * card while it is still there, closing.
   */
  arm(from?: { by?: object; closing?: (target: EventTarget | null) => boolean }): void;
  /** True when `press`, a Delete or Backspace on `target`, lands in the closing card. */
  leftIn(press: { readonly key: string }, target: EventTarget | null): boolean;
  /** A key went down: `first` swallows it with a word, `held` swallows a repeat of it. */
  keyDown(press: { readonly key: string; readonly repeat?: boolean }): CardExitKey;
  keyUp(key: string): void;
  /** A click, or the window lost focus. */
  cancel(): void;
}

const DELETE_KEYS = new Set(['Delete', 'Backspace']);
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']);

export function createCardExit(): CardExit {
  let armed = false;
  let held: string | null = null;
  let card: ((target: EventTarget | null) => boolean) | null = null;
  let closer: object | null = null;
  return {
    arm(from) {
      armed = true;
      held = null;
      card = from?.closing ?? null;
      closer = from?.by ?? null;
    },
    leftIn(press, target) {
      return DELETE_KEYS.has(press.key) && card !== null && card(target);
    },
    keyDown(press) {
      if (press === closer) return null;
      const { key, repeat = false } = press;
      if (repeat && held === key) return 'held';
      // A fresh press: whatever was held has been let go (frames send no key-ups).
      if (!repeat) held = null;
      if (!armed || repeat || MODIFIERS.has(key)) return null;
      armed = false;
      if (!DELETE_KEYS.has(key)) return null;
      held = key;
      return 'first';
    },
    keyUp(key) {
      if (held === key) held = null;
    },
    cancel() {
      armed = false;
      held = null;
      card = null;
      closer = null;
    },
  };
}

/** What the first swallowed Delete says. */
export function pressAgainMessage(key: string, apple: boolean): string {
  return `Address field closed. Press ${apple || key === 'Delete' ? 'Delete' : 'Backspace'} again to delete`;
}

export const ADDRESS_CLOSED = 'Address field closed';
export const ADDRESS_CLOSED_UNSAVED = 'Address field closed. The address was not saved';

/**
 * Where Tab goes among a card's `count` controls from the one at `at`
 * (-1: none of them): the next or previous index, or `null` past either
 * end, which closes the card.
 */
export function cardTabTarget(count: number, at: number, back: boolean): number | null {
  if (!count) return null;
  if (at < 0) return back ? count - 1 : 0;
  const next = back ? at - 1 : at + 1;
  return next < 0 || next >= count ? null : next;
}
