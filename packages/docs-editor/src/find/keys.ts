/** Reading a key press the way the page's shortcuts are written: ⌘ on Apple platforms, Ctrl elsewhere. */
import { isApplePlatform } from '@open-artifact/editor-kit';
import { isComposingKey } from '../../../ui/src/keys.ts';

export interface KeyPress {
  key: string;
  keyCode?: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

/** The platform's command key, and not the other one. */
export function modOnly(event: KeyPress, apple = isApplePlatform()): boolean {
  return apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** An input method is composing: the key is its, not a shortcut. */
export const composing = (event: KeyPress) => isComposingKey(event);

/** ⌘F (find) or ⇧⌘H (find and replace), else null. */
export function findChord(event: KeyPress, apple = isApplePlatform()): 'find' | 'replace' | null {
  if (composing(event) || event.altKey || !modOnly(event, apple)) return null;
  const key = event.key.toLowerCase();
  if (key === 'f' && !event.shiftKey) return 'find';
  if (key === 'h' && event.shiftKey) return 'replace';
  return null;
}

/** ⌘Z (undo) or ⇧⌘Z / Ctrl+Y (redo), else null. */
export function undoChord(event: KeyPress, apple = isApplePlatform()): 'undo' | 'redo' | null {
  if (composing(event) || event.altKey || !modOnly(event, apple)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !apple && !event.shiftKey) return 'redo';
  return null;
}

/** The target is inside a dialog, menu or list box, which keep their own keys. */
export function inPopup(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]') !== null;
}
