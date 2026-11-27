/**
 * The four stacking items of the canvas menu: one step forward or
 * backward, or to the front or back. An item whose way is already at the
 * end is disabled and says so.
 */

import { isApplePlatform } from '@open-artifact/editor-kit';
import { ChromeMenuItem } from '@open-artifact/editor-kit/react';
import { stackSelection, stackRoom } from '../services/commands.ts';
import { stackMessage, stacksUp, type StackOrder } from '../lib/stacking.ts';

const ORDERS: readonly StackOrder[] = ['forward', 'front', 'backward', 'back'];

/** Names for layers that overlap (notes, positioned elements). */
const STACKED = new Map<StackOrder, string>([
  ['forward', 'Bring forward'],
  ['front', 'Bring to front'],
  ['backward', 'Send backward'],
  ['back', 'Send to back'],
]);

/** Names for elements in the flow, where the stack is the reading order. */
const IN_FLOW = new Map<StackOrder, string>([
  ['forward', 'Move later'],
  ['front', 'Move to last'],
  ['backward', 'Move earlier'],
  ['back', 'Move to first'],
]);

/** One step takes ⌘ (Ctrl); the bracket alone goes all the way. */
function shortcutOf(order: StackOrder): string {
  const bracket = stacksUp(order) ? ']' : '[';
  if (order === 'front' || order === 'back') return bracket;
  return `${isApplePlatform() ? '⌘' : 'Ctrl+'}${bracket}`;
}

export function StackingItems({ disabled, reason, flow = false }: { disabled: boolean; reason?: string; flow?: boolean }) {
  return (
    <>
      {ORDERS.map((order) => {
        const room = stackRoom(order);
        const stuck = room === false;
        return (
          <ChromeMenuItem key={order} shortcut={shortcutOf(order)} disabled={disabled || stuck || room === null} title={reason ?? (stuck ? stackMessage(order, false) : undefined)} onSelect={() => stackSelection(order)}>
            {(flow ? IN_FLOW : STACKED).get(order)}
          </ChromeMenuItem>
        );
      })}
    </>
  );
}
