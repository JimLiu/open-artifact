/**
 * Keys an input method is using. While a person composes text (Chinese,
 * Japanese, Korean…), the Enter, Escape or Tab they press picks or drops a
 * candidate; the page must not also act on it (submit a field, close a
 * popup, move focus). One listener ahead of every other keeps such keys
 * from the page's handlers; the browser and the input method still get
 * them. The board's own text editor reads composition itself and is left
 * alone.
 *
 * Pure DOM: unit-tested with plain event targets.
 */

import { isComposingKey, type ComposingLike } from '@open-artifact/ui/keys';

/** The keys an input method may be using. */
export const COMPOSING_KEYS: ReadonlySet<string> = new Set(['Enter', 'Escape', 'Tab']);

/** What the guard reads of a key press. */
export interface ComposingKeyPress extends ComposingLike {
  key: string;
  target: EventTarget | null;
}

/** Whether a key press belongs to the input method and is kept from the page (`ownsComposition`: a target that reads composition itself). */
export function isInputMethodKey(event: ComposingKeyPress, ownsComposition: (target: EventTarget | null) => boolean): boolean {
  return COMPOSING_KEYS.has(event.key) && isComposingKey(event) && !ownsComposition(event.target);
}

/** Keeps input-method key presses from the page's handlers (see the module comment); returns a function that stops. */
export function guardComposingKeys(host: EventTarget, ownsComposition: (target: EventTarget | null) => boolean): () => void {
  const onKey = (event: Event): void => {
    if (!('key' in event) || typeof event.key !== 'string') return;
    const press: ComposingKeyPress = {
      key: event.key,
      target: event.target,
      isComposing: 'isComposing' in event && event.isComposing === true,
      keyCode: 'keyCode' in event && typeof event.keyCode === 'number' ? event.keyCode : 0,
    };
    if (isInputMethodKey(press, ownsComposition)) event.stopImmediatePropagation();
  };
  host.addEventListener('keydown', onKey, true);
  return () => host.removeEventListener('keydown', onKey, true);
}
