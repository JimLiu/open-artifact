import type * as React from 'react';
import { isComposingKey } from '@open-artifact/ui/keys';

type Handler<E> = ((event: E) => void) | undefined;

function isElement(target: EventTarget | null): target is Element {
  return target !== null && (target as Node).nodeType === 1;
}

function isNode(target: EventTarget | null): target is Node {
  return target !== null && typeof (target as Node).nodeType === 'number';
}

function isEditable(element: Element): boolean {
  return (element as HTMLElement).isContentEditable === true || element.matches('input, textarea, select');
}

/** Enter or Space that would press a button, or Enter that would submit a field's form. */
export function isActivationKey(event: React.KeyboardEvent<Element>): boolean {
  if (isComposingKey(event.nativeEvent) || (event.key !== 'Enter' && event.key !== ' ')) return false;
  const target = event.target;
  if (!isElement(target) || !isEditable(target)) return true;
  if (event.key !== 'Enter') return false;
  return event.metaKey || event.ctrlKey || (target.tagName !== 'TEXTAREA' && (target as HTMLElement).isContentEditable !== true);
}

const always = (): boolean => true;

/** The button pressed while the popup was still open, keyed by popup. */
const pressedWhileOpen = new WeakMap<Element, Element>();

/** A form submitted by the button pressed before the popup began closing still goes through. */
function swallowsSubmit(event: React.FormEvent<Element>): boolean {
  const pressed = pressedWhileOpen.get(event.currentTarget);
  pressedWhileOpen.delete(event.currentTarget);
  const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
  return !(pressed !== undefined && submitter !== null && submitter.contains(pressed));
}

function swallowWhile<E extends React.SyntheticEvent<Element>>(
  handler: Handler<E>,
  attribute: string,
  swallows: (event: E) => boolean,
  prevent: boolean,
): (event: E) => void {
  return (event) => {
    if (event.currentTarget.hasAttribute(attribute) && swallows(event)) {
      if (prevent) event.preventDefault();
      event.stopPropagation();
      return;
    }
    handler?.(event);
  };
}

interface GuardedHandlers<P, K, M, S> {
  onPointerDownCapture?: Handler<P>;
  onMouseDownCapture?: Handler<M>;
  onClickCapture?: Handler<M>;
  onAuxClickCapture?: Handler<M>;
  onKeyDownCapture?: Handler<K>;
  onSubmitCapture?: Handler<S>;
}

/**
 * While a popup is animating out it still covers the page; presses and activation keys that
 * land on it are swallowed, so nothing in a closing popup acts twice.
 */
export function guardWhileClosing<
  P extends React.PointerEvent<Element>,
  K extends React.KeyboardEvent<Element>,
  M extends React.MouseEvent<Element>,
  S extends React.FormEvent<Element>,
>(handlers: GuardedHandlers<P, K, M, S>, attribute: string): Required<GuardedHandlers<P, K, M, S>> {
  return {
    onPointerDownCapture: swallowWhile(handlers.onPointerDownCapture, attribute, always, false),
    onMouseDownCapture: swallowWhile(handlers.onMouseDownCapture, attribute, always, true),
    onClickCapture: swallowWhile(
      (event: M) => {
        const target = event.target;
        if (isElement(target)) pressedWhileOpen.set(event.currentTarget, target.closest('button, input') ?? target);
        handlers.onClickCapture?.(event);
      },
      attribute,
      always,
      true,
    ),
    onAuxClickCapture: swallowWhile(handlers.onAuxClickCapture, attribute, always, true),
    onKeyDownCapture: swallowWhile(handlers.onKeyDownCapture, attribute, isActivationKey, true),
    onSubmitCapture: swallowWhile(handlers.onSubmitCapture, attribute, swallowsSubmit, true),
  };
}

/**
 * A held Enter or Space on a menu row repeats its keydown; only the first press acts, so a row
 * that closes the menu or toggles a check does not fire again on whatever the repeats land on.
 */
export function preventRepeatedActivation(event: React.KeyboardEvent<Element>): void {
  if (!event.repeat || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  (event as React.KeyboardEvent<Element> & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
}

const KEY_GUARD_MAX_MS = 2000;

/**
 * Pressing Enter or Space on a toast's button can close the toast before the key is let go.
 * Until it is, the held key's repeats and release are kept from whatever has focus next.
 */
export function guardHeldActivationKey(event: React.KeyboardEvent<Element>, card: Element | null = event.currentTarget): void {
  if (card === null || event.repeat || !isActivationKey(event) || !isNode(event.target) || !card.contains(event.target)) return;
  const win = card.ownerDocument.defaultView;
  if (win === null) return;
  const key = event.key;
  const isInside = (target: EventTarget | null): boolean => isNode(target) && card.isConnected && card.contains(target);
  const onKey = (keyEvent: KeyboardEvent): void => {
    if (keyEvent.key !== key) return;
    if (keyEvent.type === 'keyup') {
      if (!isInside(keyEvent.target)) keyEvent.preventDefault();
      stop();
      return;
    }
    if (!isInside(keyEvent.target)) {
      keyEvent.preventDefault();
      keyEvent.stopImmediatePropagation();
    }
  };
  const stop = (): void => {
    win.clearTimeout(timer);
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('keyup', onKey, true);
  };
  const timer = win.setTimeout(stop, KEY_GUARD_MAX_MS);
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('keyup', onKey, true);
}

const ENTER_GUARD_WINDOW_MS = 500;
const ENTER_GUARD_LATE_FOCUS_MS = 1000;
const ENTER_GUARD_MAX_EVENT_AGE_MS = 3000;
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/** When the key was pressed: a trusted event's timeStamp, unless it looks stale or bogus. */
export function keyPressedAt(event: KeyboardEvent): number {
  const age = (event.view?.performance.now() ?? 0) - event.timeStamp;
  const usesTimeStamp = event.isTrusted && event.timeStamp > 0 && age > 0 && age <= ENTER_GUARD_MAX_EVENT_AGE_MS;
  return performance.now() - (usesTimeStamp ? age : 0);
}

/**
 * Swallows an Enter pressed in the moment after something opened or closed, and Enter's repeats
 * while it is held, so the press that did it does not also act on what has focus now. Any other
 * key ends the guard; with `lateFocus`, a focus move soon after starts the moment again. Returns
 * a function that ends the guard.
 */
export function guardEnterKeyAfterOpen(doc: Document, lateFocus = false): () => void {
  let guardUntil = performance.now() + ENTER_GUARD_WINDOW_MS;
  const armedAt = performance.now();
  const onKeyDown = (event: KeyboardEvent): void => {
    const plain = !(event.shiftKey || event.metaKey || event.ctrlKey || event.altKey);
    if (event.key === 'Enter' && (event.repeat || (plain && keyPressedAt(event) < guardUntil))) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) guardUntil = performance.now() + ENTER_GUARD_WINDOW_MS;
    } else if (!event.repeat && !MODIFIER_KEYS.has(event.key)) stop();
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (isElement(event.target) && event.target.tagName === 'IFRAME') return;
    if (performance.now() - armedAt <= ENTER_GUARD_LATE_FOCUS_MS) guardUntil = performance.now() + ENTER_GUARD_WINDOW_MS;
    doc.removeEventListener('focusin', onFocusIn, true);
  };
  const stop = (): void => {
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('focusin', onFocusIn, true);
  };
  doc.addEventListener('keydown', onKeyDown, true);
  if (lateFocus) doc.addEventListener('focusin', onFocusIn, true);
  return stop;
}

/**
 * An Enter press that closes a dialog must not land on whatever is under it once it is gone:
 * when the dialog is gone by the time the key repeats or is let go, Enter stays guarded until
 * the next pointer press. For the dialog popup's `onKeyDownCapture`.
 */
export function guardEnterThroughDialogClose(event: React.KeyboardEvent<Element>): void {
  if (event.key !== 'Enter' || event.repeat || !event.isTrusted) return;
  const popup = event.currentTarget;
  if (popup.hasAttribute('data-closed')) return;
  const doc = popup.ownerDocument;
  const armIfClosed = (): boolean => {
    if (popup.isConnected && !popup.hasAttribute('data-closed') && popup.checkVisibility?.() !== false) return false;
    stop();
    const focusWasInside = doc.activeElement === doc.body || popup.contains(doc.activeElement);
    doc.addEventListener('pointerdown', guardEnterKeyAfterOpen(doc, focusWasInside), { capture: true, once: true });
    return true;
  };
  const onKey = (key: KeyboardEvent): void => {
    if (MODIFIER_KEYS.has(key.key) || (key.type === 'keyup' && key.key !== 'Enter')) return;
    if (key.repeat) {
      if (key.key === 'Enter' && armIfClosed()) {
        key.preventDefault();
        key.stopPropagation();
      }
      return;
    }
    if (key.type === 'keyup') armIfClosed();
    stop();
  };
  const timer = setTimeout(armIfClosed);
  const stop = (): void => {
    clearTimeout(timer);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('keyup', onKey, true);
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('keyup', onKey, true);
}
