/**
 * Keys that move focus between the text and the bars around it: Escape leaves the text for the page's bar, F6 (or
 * Mod-F6, Alt-F10) goes to the bar of what the cursor is in, or the page's bar, and from any bar F6 comes back.
 */
import type { EditorView } from 'prosemirror-view';
import { isComposingKey } from '@open-artifact/ui/keys';

const PAGE_BAR = '[role="toolbar"][aria-label="Page"]';
const CURSOR_BARS = ['[data-selbar]', '[data-image-bar]', '[role="toolbar"][aria-label="Cell actions"]', '[role="toolbar"][data-contents-bar]'];
const CONTROL = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isBarKey(event: KeyboardEvent): boolean {
  if (event.key === 'F6') return !event.altKey && !event.shiftKey;
  return event.key === 'F10' && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
}

function shown(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function focusFirstControl(bar: Element | null): boolean {
  const control = bar?.querySelector<HTMLElement>(CONTROL);
  if (!control) return false;
  control.focus();
  return true;
}

function cursorBar(doc: Document): HTMLElement | null {
  // A page can hold several of a kind (one table of contents' bar shows, the others' don't).
  for (const selector of CURSOR_BARS) {
    const bar = [...doc.querySelectorAll<HTMLElement>(selector)].find(shown);
    if (bar) return bar;
  }
  return null;
}

/** What Escape leaves the text alone for: a bar over the text, a menu, a list of choices or a dialog. */
const OVER_TEXT = [...CURSOR_BARS, '[role="menu"]', '[role="listbox"]', '[role="dialog"]', '[role="alertdialog"]'].join(', ');

/** Escape in the text, with nothing over it: the keyboard goes to the page's bar. */
export function leaveText(view: EditorView): boolean {
  const doc = view.dom.ownerDocument;
  if ([...doc.querySelectorAll<HTMLElement>(OVER_TEXT)].some(shown)) return false;
  return focusFirstControl(doc.querySelector(PAGE_BAR));
}

/** Listens for the bar keys while `view` is drawn; the returned function stops it. */
export function focusKeys(view: EditorView): () => void {
  const doc = view.dom.ownerDocument;
  const onKey = (event: KeyboardEvent) => {
    if (isComposingKey(event)) return;
    const target = event.target instanceof Node ? event.target : null;
    const inText = !!target && view.dom.contains(target);
    if (!isBarKey(event)) return;
    if (inText) {
      if (focusFirstControl(cursorBar(doc)) || focusFirstControl(doc.querySelector(PAGE_BAR))) event.preventDefault();
      return;
    }
    if (target instanceof Element && target.closest('[role="toolbar"]')) {
      event.preventDefault();
      view.focus();
    }
  };
  doc.defaultView?.addEventListener('keydown', onKey);
  return () => doc.defaultView?.removeEventListener('keydown', onKey);
}
