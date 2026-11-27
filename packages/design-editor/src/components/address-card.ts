/**
 * Keys inside a link's address card: Tab and Shift+Tab move among the
 * card's controls, and past either end close it; Escape, or Enter in the
 * address field, closes it too. Each says so (and whether the typed
 * address was dropped). Closed with Tab or Escape, the next Delete on the
 * canvas only says to press it again.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isComposingKey } from '@open-artifact/ui/keys';
import { ADDRESS_CLOSED, ADDRESS_CLOSED_UNSAVED, cardTabTarget } from '../lib/card-exit.ts';
import { cardExit } from '../services/card-exit.ts';
import { announce } from '../services/announce.ts';

const FOCUSABLE = 'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export interface AddressCardOptions {
  /** The address as saved, to tell whether an Escape drops a typed one. */
  saved: string;
  /** Closes the card (Enter in the address field, Tab past either end); focus goes back where it was before. */
  close(): void;
  /** Tab or Escape here returns to the canvas selection, so the next Delete is held back once. */
  guardDelete: boolean;
}

/** After Tab closes the card, the held Tab's repeats move nothing until it is let go. */
function swallowHeldTab(): void {
  const swallow = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
  };
  const stop = (event?: KeyboardEvent) => {
    if (event && event.key !== 'Tab') return;
    window.removeEventListener('keydown', swallow, true);
    window.removeEventListener('keyup', stop, true);
    window.removeEventListener('blur', end);
  };
  const end = () => stop();
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', stop, true);
  window.addEventListener('blur', end);
}

export function addressCardKeys({ saved, close, guardDelete }: AddressCardOptions) {
  return (event: ReactKeyboardEvent<HTMLElement>): void => {
    const card = event.currentTarget;
    const field = event.target instanceof HTMLInputElement ? event.target : null;
    // Closed, the card stays a moment, with the focus in it, while it animates out.
    const closing = (target: EventTarget | null): boolean => target instanceof Node && card.contains(target) && !card.hasAttribute('data-open');
    // The field's own Escape has reset its draft, but the box still shows it.
    const unsaved = (): boolean => {
      const input = card.querySelector('input');
      return Boolean(input && input.value.trim() !== saved.trim());
    };
    if (event.key === 'Tab') {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (event.repeat && !card.contains(document.activeElement)) return;
      const stops = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const next = cardTabTarget(stops.length, stops.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (next !== null) {
        stops[next]!.focus();
        return;
      }
      const message = unsaved() ? ADDRESS_CLOSED_UNSAVED : ADDRESS_CLOSED;
      close();
      swallowHeldTab();
      announce(message);
      if (guardDelete) cardExit.arm({ by: event.nativeEvent, closing });
      return;
    }
    if (event.key === 'Escape' && !isComposingKey(event.nativeEvent)) {
      announce(field && field.value.trim() !== saved.trim() ? ADDRESS_CLOSED_UNSAVED : ADDRESS_CLOSED);
      if (guardDelete) cardExit.arm({ by: event.nativeEvent, closing });
      return;
    }
    if (event.key === 'Enter' && field && !isComposingKey(event.nativeEvent)) {
      close();
      announce(ADDRESS_CLOSED);
    }
  };
}
