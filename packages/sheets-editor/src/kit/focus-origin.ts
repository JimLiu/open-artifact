import { isComposingKey } from '@open-artifact/ui/keys';

interface InputState {
  observed: boolean;
  lastInputDismisses: boolean;
}

const DISMISSAL_KEYS: ReadonlySet<string> = new Set(['Escape', 'Enter', ' ']);
const states = new WeakMap<Document, InputState>();

/** Starts watching which input last happened in `doc`; safe to call repeatedly. */
export function observeDocumentInput(doc: Document | null | undefined): void {
  if (doc == null || states.has(doc)) return;
  const state: InputState = { observed: false, lastInputDismisses: false };
  states.set(doc, state);
  const target: Window | Document = doc.defaultView ?? doc;
  target.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted) return;
      const key = event as KeyboardEvent;
      state.observed = true;
      state.lastInputDismisses = !isComposingKey(key) && DISMISSAL_KEYS.has(key.key);
    },
    true,
  );
  target.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isTrusted) return;
      state.observed = true;
      state.lastInputDismisses = true;
    },
    true,
  );
  doc.defaultView?.addEventListener('blur', () => {
    state.observed = false;
    state.lastInputDismisses = false;
  });
}

/** A ref callback that starts watching input in the element's document. */
export function watchInputOf(element: Element | null): void {
  observeDocumentInput(element?.ownerDocument);
}

/**
 * Whether a focus came back from closing something (a press, Escape or Enter), rather
 * than from the user moving focus on purpose. Such focus should not pop a tooltip.
 */
export function isDismissalRelatedFocus(event: Pick<FocusEvent, 'relatedTarget' | 'target'>): boolean {
  if (event.relatedTarget != null) return false;
  const doc = (event.target as Node | null)?.ownerDocument;
  const state = doc == null ? undefined : states.get(doc);
  return state !== undefined && state.observed && state.lastInputDismisses;
}

export function isFocusVisible(element: EventTarget | null): boolean {
  try {
    return element instanceof Element && element.matches(':focus-visible');
  } catch {
    return false;
  }
}
