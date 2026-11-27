/**
 * Escape in a modal dialog that has a menu or popover open in it closes that
 * popup, not the dialog, even when the key was typed outside the popup (the
 * focus left in a field of the dialog, or on the page). The dialog hands the
 * Escape on to the popup; a popup that stays open after that (it does not
 * close on Escape) is passed over by the next Escape, which closes the dialog.
 *
 * The dialog makes an {@link EscapeHandoff} and provides it through
 * {@link EscapeHandoffContext}; each popup inside it notes, through
 * {@link useEscapeHandoffRef}, the Escapes typed outside it while it is open;
 * the dialog's close asks {@link handEscapeToPopup} first.
 */
import { createContext, useCallback, useContext, useRef } from 'react';
import { isComposingKey } from './keys.ts';

/** The parts of a popup element the handoff uses. */
export interface HandoffPopup {
  hasAttribute(name: string): boolean;
  contains(node: unknown): boolean;
  dispatchEvent(event: unknown): boolean;
  ownerDocument: {
    addEventListener(type: 'keydown', listener: (event: HandoffKey) => void, capture: true): void;
    removeEventListener(type: 'keydown', listener: (event: HandoffKey) => void, capture: true): void;
    defaultView: { KeyboardEvent: new (type: 'keydown', init: KeyboardEventInit) => object; setTimeout(run: () => void, ms: number): unknown } | null;
  };
}

/** The parts of a key event the handoff uses. */
export interface HandoffKey {
  key: string;
  target: unknown;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
  preventDefault?(): void;
}

/** What one dialog keeps about the Escapes its popups were meant to get. */
export interface EscapeHandoff {
  /** The popup each Escape typed outside it was meant for. */
  meantFor: WeakMap<object, HandoffPopup>;
  /** Escapes typed inside one of the popups: theirs to handle. */
  inside: WeakSet<object>;
  /** The Escapes the dialog sent on. */
  sent: WeakSet<object>;
  /** Popups that stayed open after an Escape was handed to them. */
  passedOver: WeakSet<HandoffPopup>;
}

export function createEscapeHandoff(): EscapeHandoff {
  return { meantFor: new WeakMap(), inside: new WeakSet(), sent: new WeakSet(), passedOver: new WeakSet() };
}

/** A popup is open while it carries Base UI's `data-open`. */
const isOpen = (popup: HandoffPopup) => popup.hasAttribute('data-open');

/** Notes what a key pressed while `popup` is mounted means for the dialog (call in the capture phase, before the dialog sees it). */
export function noteKeyForPopup(handoff: EscapeHandoff, popup: HandoffPopup, event: HandoffKey): void {
  if (!isOpen(popup)) {
    handoff.passedOver.delete(popup);
    return;
  }
  // An Escape that ends an input method's composition is the input method's.
  if (event.key !== 'Escape' || isComposingKey(event)) return;
  if (popup.contains(event.target)) handoff.inside.add(event);
  else if (!handoff.passedOver.has(popup)) handoff.meantFor.set(event, popup);
}

/** What the dialog's open-change reports. */
export interface DialogCloseDetails {
  reason?: string;
  event?: Event | HandoffKey;
  cancel(): void;
}

/**
 * Called first when the dialog would change open state: when the change is an Escape meant for an open popup, sends
 * the Escape to that popup and keeps the dialog open. True when it did (the dialog does nothing more).
 */
export function handEscapeToPopup(handoff: EscapeHandoff, details: DialogCloseDetails): boolean {
  const event = details.event as HandoffKey | undefined;
  if (details.reason !== 'escape-key' || !event) return false;
  if (handoff.sent.has(event)) {
    details.cancel();
    return true;
  }
  const popup = handoff.meantFor.get(event);
  const view = popup?.ownerDocument.defaultView;
  if (!popup || !view || handoff.inside.has(event) || event.defaultPrevented) return false;
  const sent = new view.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', repeat: event.repeat ?? false, bubbles: true, cancelable: true });
  handoff.sent.add(sent);
  details.cancel();
  event.preventDefault?.();
  popup.dispatchEvent(sent);
  view.setTimeout(() => {
    if (isOpen(popup)) handoff.passedOver.add(popup);
  }, 0);
  return true;
}

/** The handoff of the modal dialog around a popup; null outside one. */
export const EscapeHandoffContext = createContext<EscapeHandoff | null>(null);

/** A ref for a popup's element: inside a modal dialog, the popup gets the Escapes typed outside it while it is open. */
export function useEscapeHandoffRef(): (element: HTMLElement | null) => void {
  const handoff = useContext(EscapeHandoffContext);
  const detach = useRef<(() => void) | null>(null);
  return useCallback(
    (element: HTMLElement | null) => {
      detach.current?.();
      detach.current = null;
      if (!handoff || !element) return;
      const popup = element as unknown as HandoffPopup;
      const doc = popup.ownerDocument;
      const listener = (event: HandoffKey) => noteKeyForPopup(handoff, popup, event);
      doc.addEventListener('keydown', listener, true);
      detach.current = () => doc.removeEventListener('keydown', listener, true);
    },
    [handoff],
  );
}
