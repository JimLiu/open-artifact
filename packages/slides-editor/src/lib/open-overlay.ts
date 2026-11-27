/**
 * Whether a menu, popover or dialog is open anywhere on the page. While one
 * is, Space stays with it (no stage drag starts) and the format strip stays
 * where it is.
 */

/** What is read of an element that may be an open overlay. */
export interface OverlayElement {
  matches(selector: string): boolean;
}

/** Menus, popovers and dialogs, and the open popup around a select's list. Lists that are part of the page (the slide rail, the looks) are not. */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [data-open]:has(> [role="listbox"])';

/** A popup on its way out, or one that is hidden. */
const GONE = '[data-ending-style], [data-closed], [hidden]';

/** The card of a link under the caret: it only counts as open once the focus is in it. */
export const LINK_CARD_SELECTOR = '[data-link-card]';

/** True when one of `candidates` (elements matching {@link OVERLAY_SELECTOR}) is open; `holdsFocus` tells whether the focus is in one. */
export function anyOverlayOpen<E extends OverlayElement>(candidates: Iterable<E>, holdsFocus: (el: E) => boolean): boolean {
  for (const el of candidates) {
    if (el.matches(GONE)) continue;
    if (el.matches(LINK_CARD_SELECTOR) && !holdsFocus(el)) continue;
    return true;
  }
  return false;
}

/** True when a menu, popover or dialog is open on the page. */
export function hasOpenOverlay(doc: Document = document): boolean {
  return anyOverlayOpen(doc.querySelectorAll(OVERLAY_SELECTOR), (el) => el.contains(doc.activeElement));
}
