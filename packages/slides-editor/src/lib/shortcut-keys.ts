/**
 * What a modified key press means to the editor, whatever the keyboard
 * layout: undo / redo and the stacking-order keys.
 */

import type { ZMove } from '@open-artifact/slides-core';
import { shortcutLetter, type ShortcutKeyLike } from '@open-artifact/ui/keys';

/** The fields of a keydown these functions read. */
export interface ModifiedKey extends ShortcutKeyLike {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** ⌘Z (Ctrl+Z) undoes, ⇧⌘Z or Ctrl+Y redoes; anything else is null. */
export function undoRedoKey(event: ModifiedKey): 'undo' | 'redo' | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const letter = shortcutLetter(event);
  if (letter === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (letter === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}

/** The letter of a ⌘ (Ctrl) shortcut pressed without Option, or null: ⌥⌘D is not ⌘D. */
export function commandLetter(event: ModifiedKey): string | null {
  return (event.metaKey || event.ctrlKey) && !event.altKey ? shortcutLetter(event) : null;
}

/** Typed characters a Ctrl+Shift bracket key may produce that are shortcuts of their own (zoom, help). */
const NOT_BRACKETS = new Set(['+', '=', '_', '-', '?', '`']);

/** The bracket a physical key or a typed `}` / `{` stands for, with Shift held. */
function shiftedBracket(event: ModifiedKey): ']' | '[' | null {
  if (event.key === '}') return ']';
  if (event.key === '{') return '[';
  if (NOT_BRACKETS.has(event.key)) return null;
  if (event.code === 'BracketRight') return ']';
  if (event.code === 'BracketLeft') return '[';
  return null;
}

/**
 * The stacking-order move a key asks for, or null.
 * - ⌘] / ⌘[ (Ctrl off Apple platforms) move one layer, by the typed bracket.
 * - All the way to the front / back is ⌥⌘] / ⌥⌘[ with ⌘, read by the physical
 *   key since Option changes the typed character; with Ctrl (not on Apple
 *   platforms) it is Ctrl+Shift, because Ctrl+Alt is AltGr, which types.
 */
export function layerMoveKey(event: ModifiedKey, apple: boolean): ZMove | null {
  const end = (bracket: ']' | '[' | null): ZMove | null => (bracket === ']' ? 'front' : bracket === '[' ? 'back' : null);
  const step = (): ZMove | null => (event.key === ']' ? 'forward' : event.key === '[' ? 'backward' : null);
  if (event.metaKey) {
    if (event.shiftKey) return null;
    if (event.altKey) return end(event.code === 'BracketRight' ? ']' : event.code === 'BracketLeft' ? '[' : null);
    return step();
  }
  if (!event.ctrlKey || apple || event.altKey) return null;
  return event.shiftKey ? end(shiftedBracket(event)) : step();
}

/**
 * True when a stacking-order key should be held back from the browser (where
 * ⌘[ / ⌘] go back and forward) even where it does nothing, as in a field.
 */
export function holdsLayerKeyInField(event: ModifiedKey, apple: boolean): boolean {
  return layerMoveKey(event, apple) !== null;
}

/** What is read out after a stacking-order change of `count` elements. */
export function layerAnnouncement(move: ZMove, count: number): string {
  const what = count === 1 ? 'Element' : `${count} elements`;
  switch (move) {
    case 'front':
      return `${what} moved to the front`;
    case 'back':
      return `${what} moved to the back`;
    case 'forward':
      return `${what} moved up one layer`;
    case 'backward':
      return `${what} moved down one layer`;
  }
}
