/**
 * Keys pressed while focus is in a dialog or popover. Most still reach the
 * canvas shortcuts (⌘Z, arrows), but the ones that press the focused control
 * or would delete what is behind belong to the dialog.
 */

/** Open overlays whose focused controls keep their own keys (toasts included). */
export const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

const PRESSING_KEYS = new Set(['Enter', ' ', 'Delete', 'Backspace']);

/** True when a key pressed in a dialog is the dialog's, not a canvas shortcut. */
export function dialogKeepsKey(key: string): boolean {
  return PRESSING_KEYS.has(key);
}

/** Controls that Enter and Space press, wherever they sit (the selection bar, its More tools card, a panel). */
export const PRESSABLE_SELECTOR = 'button, [role="button"], [role^="menuitem"], [role="radio"], a[href]';

/** True when Enter or Space goes to the focused control under `target`, not to a canvas shortcut. A held modifier leaves the key to the shortcuts. */
export function controlTakesKey(key: string, target: EventTarget | null, modified = false): boolean {
  if (modified || (key !== 'Enter' && key !== ' ')) return false;
  const element = target as Element | null;
  return typeof element?.closest === 'function' && element.closest(PRESSABLE_SELECTOR) !== null;
}
