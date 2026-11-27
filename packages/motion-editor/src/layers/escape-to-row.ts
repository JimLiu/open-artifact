/**
 * Esc inside the picked layer's Text styles or Appearance puts the focus back on that layer's row in the tree,
 * so a keyboard user lands somewhere near instead of losing the pick; Esc on the row then lets the pick go.
 * A popup (a menu, a color picker) that handled the key itself, or one portaled out of the group, keeps it.
 */

import { isComposingKey } from '@open-artifact/ui/keys';

/** The picked layer's row in the layer tree. */
export const PICKED_ROW = '[data-layers-tree] [role="treeitem"][aria-selected="true"]';

export interface EscapePress {
  key: string;
  defaultPrevented: boolean;
  /** An input method is composing; Esc belongs to it. */
  composing: boolean;
  /** The key went down on an element inside the group (not in a popup portaled out of it). */
  inside: boolean;
}

/** Whether this key press should go back to the picked row. Pure. */
export function escapeGoesToRow(press: EscapePress): boolean {
  return press.key === 'Escape' && !press.defaultPrevented && !press.composing && press.inside;
}

interface GroupKeyEvent {
  key: string;
  defaultPrevented: boolean;
  target: unknown;
  currentTarget: { contains(other: Node | null): boolean; ownerDocument: Document };
  nativeEvent: { isComposing: boolean; keyCode: number };
  preventDefault(): void;
}

/**
 * Key handler for a group: on Esc, focuses the picked row and takes the key (so it does not let the pick go too).
 * Returns whether it did.
 */
export function escapeToPickedRow(event: GroupKeyEvent): boolean {
  const target = event.target instanceof Node ? event.target : null;
  const press = { key: event.key, defaultPrevented: event.defaultPrevented, composing: isComposingKey(event.nativeEvent), inside: target !== null && event.currentTarget.contains(target) };
  if (!escapeGoesToRow(press)) return false;
  const row = event.currentTarget.ownerDocument.querySelector<HTMLElement>(PICKED_ROW);
  if (row === null) return false;
  event.preventDefault();
  row.focus();
  return true;
}
