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
