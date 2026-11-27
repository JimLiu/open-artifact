/**
 * Keys an input hands to the canvas.
 *
 * A properties field committed with Enter keeps the focus (its text
 * selected) but no longer counts as typing: canvas shortcuts with a
 * modifier work from it. A bare key goes into the field and ends that.
 *
 * With an artboard's text box still open while the focus is on the editor
 * page, canvas shortcuts that change the selection write the typed words
 * first, then run. ⌘X and ⌘V only write them, and say to press again.
 */

import { letterOf } from './physical-keys.ts';
import { stackOrderOf } from './stacking.ts';

export interface HandoffPress {
  key: string;
  code?: string;
  /** ⌘ or Ctrl. */
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'AltGraph']);

/** True for a modifier key on its own. */
export const isModifierKey = (key: string): boolean => MODIFIERS.has(key);

/** The attribute a committed field carries until it is typed in or left. */
export const COMMITTED_ATTRIBUTE = 'data-committed';

/**
 * True when a key in a committed field goes to the canvas: one with ⌘ / Ctrl
 * or Alt, or Shift with a letter (⇧X). Select all, the clipboard and
 * Shift with arrows or other keys still work on the field's text.
 */
export function committedFieldPasses(press: HandoffPress): boolean {
  if (isModifierKey(press.key)) return false;
  const letter = letterOf(press);
  if (press.meta) return press.alt || press.shift || !['a', 'c', 'x', 'v'].includes(letter);
  if (press.alt) return true;
  return press.shift && /^[a-z]$/.test(letter);
}

/** True when a key in a committed field ends the committed state: one without ⌘ / Ctrl that stays in the field. */
export function endsCommitted(press: HandoffPress): boolean {
  return !press.meta && !isModifierKey(press.key) && !committedFieldPasses(press);
}

/** What an open text box does with a canvas shortcut: write first and run it, write and hold it, or nothing. */
export type TextHandoff = 'commit' | 'hold' | null;

const BARE = new Set(['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '[', ']']);

export function textHandoffOf(press: HandoffPress, apple: boolean): TextHandoff {
  if (isModifierKey(press.key)) return null;
  const letter = letterOf(press);
  if (stackOrderOf(press, apple)) return 'commit';
  if (!press.meta) {
    if (press.alt) return null;
    if (BARE.has(press.key)) return 'commit';
    return press.shift && ['h', 'v', 'a', 'x'].includes(letter) ? 'commit' : null;
  }
  if (press.alt) return null;
  if (!press.shift && (letter === 'x' || letter === 'v')) return 'hold';
  if (letter === 'l') return 'commit';
  if (press.shift) return letter === 'a' ? 'commit' : null;
  if (letter === 'd' || letter === 'b' || letter === 'g' || press.key === 'Backspace') return 'commit';
  return !apple && letter === 'c' ? 'commit' : null;
}

/** What a held ⌘X / ⌘V says once the words are written. */
export function textHandoffMessage(press: HandoffPress, apple: boolean, selected: boolean): string {
  if (!selected) return 'Text updated';
  const letter = letterOf(press);
  const key = `${apple ? '⌘' : 'Ctrl+'}${letter.toUpperCase()}`;
  return `Text updated. Press ${key} again to ${letter === 'x' ? 'cut' : 'paste'}`;
}
