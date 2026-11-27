/**
 * Keys inside a link's address card: Tab and Shift+Tab go round the
 * card's controls; Escape, or Enter in the address field, closes it and
 * says so (and whether the typed address was dropped). Closed with
 * Escape, the next Delete on the canvas only says to press it again.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isComposingKey } from '@open-artifact/ui/keys';
import { ADDRESS_CLOSED, ADDRESS_CLOSED_UNSAVED } from '../lib/card-exit.ts';
import { cardExit } from '../services/card-exit.ts';
import { announce } from '../services/announce.ts';

const FOCUSABLE = 'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export interface AddressCardOptions {
  /** The address as saved, to tell whether an Escape drops a typed one. */
  saved: string;
  /** Closes the card (Enter in the address field). */
  close?(): void;
  /** Escape here returns to the canvas selection, so the next Delete is held back once. */
  guardDelete: boolean;
}

export function addressCardKeys({ saved, close, guardDelete }: AddressCardOptions) {
  return (event: ReactKeyboardEvent<HTMLElement>): void => {
    const card = event.currentTarget;
    const field = event.target instanceof HTMLInputElement ? event.target : null;
    if (event.key === 'Tab') {
      const stops = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!stops.length) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at < 0 || at === stops.length - 1 ? 0 : at + 1;
      event.preventDefault();
      stops[next]!.focus();
      return;
    }
    if (event.key === 'Escape' && !isComposingKey(event.nativeEvent)) {
      // The field's own Escape has reset its draft, but the box still shows it.
      announce(field && field.value.trim() !== saved.trim() ? ADDRESS_CLOSED_UNSAVED : ADDRESS_CLOSED);
      if (guardDelete) cardExit.arm();
      return;
    }
    if (event.key === 'Enter' && field && close && !isComposingKey(event.nativeEvent)) {
      close();
      announce(ADDRESS_CLOSED);
    }
  };
}
