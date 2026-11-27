/**
 * Space on a focused control. Space held pans the canvas, so the page keeps the key from the browser; but a tap of
 * Space on a focused button (or switch, tab, menu item…) is that control's press, and the page lets it through. Held
 * and used to drag, it pans and presses nothing.
 */

/** Elements a tap of Space presses for what they are, */
const PRESSED_TAGS = new Set(['button', 'summary']);
/** and for the role they take. */
const PRESSED_ROLES = new Set(['button', 'switch', 'checkbox', 'radio', 'tab', 'option', 'combobox', 'menuitem', 'menuitemcheckbox', 'menuitemradio']);

/** Whether the key event's target is a control a tap of Space presses (one marked disabled is not). */
export function spacePressesTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (typeof element?.getAttribute !== 'function' || typeof element.tagName !== 'string') return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  const role = element.getAttribute('role');
  return PRESSED_TAGS.has(element.tagName.toLowerCase()) || (role !== null && PRESSED_ROLES.has(role));
}

/** One Space key event, as far as the rule below needs it. */
export interface SpaceKey {
  down: boolean;
  repeat: boolean;
  /** The press began on a control a tap of Space presses. */
  onControl: boolean;
  /** A pointer went down on the canvas while it was held. */
  panned: boolean;
}

/** Whether the page keeps this Space key event from the browser (and so from the focused control). */
export function keepsSpace({ down, repeat, onControl, panned }: SpaceKey): boolean {
  if (repeat) return true;
  if (!onControl) return true;
  return !down && panned;
}
