import * as React from 'react';
import { OVERLAY_ATTRIBUTE } from './layers.tsx';

/** The portal a modal popup is rendered into. */
export const DIALOG_PORTAL_SELECTOR = '[data-base-ui-portal]';
const TOAST_SELECTOR = '[data-ui="Toast"]';

/** Live regions that still announce, and the layers that speak for themselves. */
export const ANNOUNCING_REGION_SELECTOR = `[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], ${TOAST_SELECTOR}, [role="dialog"], [role="alertdialog"], dialog, [popover], [${OVERLAY_ATTRIBUTE}], ${DIALOG_PORTAL_SELECTOR}`;

/** Regions that announce changes: these stay live while a modal popup hides the page. */
export const LIVE_ANNOUNCEMENT_SELECTOR = `[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], ${TOAST_SELECTOR}`;

const FOCUS_GUARD_SELECTOR = '[data-base-ui-focus-guard]';
/** A toast's own focus guards keep working. */
const TOAST_CHILD_SELECTOR = `${TOAST_SELECTOR} > *, ${TOAST_SELECTOR} > * > *`;

const hasUnhiddenLiveRegion = (element: Element): boolean =>
  !element.matches('[aria-hidden="true"], [inert]') && element.querySelector('[aria-live]') !== null;

/**
 * Keeps a modal popup's live-region neighbours audible but hides the rest of the page around
 * them, as it changes: content added after the popup opened, regions that start or stop
 * announcing (a status, an alert, a toast), and regions turned off.
 */
export function hideBesideLiveRegions(portal: Element, view: Window & typeof globalThis): () => void {
  const hidden = new Set<Element>();
  const announcing = new Set<Element>();
  const attributeObserver = new view.MutationObserver((records) => {
    const changed = new Set<Element>();
    for (const { type, target, addedNodes, attributeName, oldValue } of records) {
      for (const node of type === 'childList' ? Array.from(addedNodes) : [target]) {
        if (!(node instanceof view.Element)) continue;
        changed.add(node);
        if (attributeName === 'aria-hidden' && oldValue === 'true') hidden.delete(node);
      }
    }
    changed.forEach((node) => hide(node));
  });
  const watchAttributes = (element: Element): void =>
    attributeObserver.observe(element, {
      attributeFilter: ['aria-hidden', 'inert', 'aria-live', 'role', 'popover'],
      attributeOldValue: true,
    });
  const unhide = (element: Element): boolean => {
    const wasHidden = hidden.delete(element);
    if (wasHidden) element.removeAttribute('aria-hidden');
    return wasHidden;
  };
  const subtreeObserver = new view.MutationObserver((records) => {
    for (const { type, target, addedNodes } of records) {
      for (const node of type === 'childList' ? Array.from(addedNodes) : [target]) {
        if (!(node instanceof view.Element)) continue;
        if (type === 'attributes' && node.matches(ANNOUNCING_REGION_SELECTOR)) {
          announcing.add(node);
          Array.from(hidden)
            .filter((element) => node.contains(element))
            .forEach(unhide);
        } else if (type === 'attributes' && announcing.delete(node)) hide(node);
        if (node.matches(ANNOUNCING_REGION_SELECTOR) || node.querySelector(ANNOUNCING_REGION_SELECTOR) !== null) {
          for (let parent = node.parentElement; parent; parent = parent.parentElement) if (unhide(parent)) hide(parent, true);
        }
      }
    }
  });
  const hide = (element: Element, force = false): void => {
    if (element.matches(ANNOUNCING_REGION_SELECTOR)) unhide(element);
    if ([...announcing].some((region) => region.contains(element) && region.matches(ANNOUNCING_REGION_SELECTOR))) return;
    if (!element.matches('[aria-hidden="true"], [inert]')) {
      if (element.matches(ANNOUNCING_REGION_SELECTOR) || (!force && element.contains(element.ownerDocument.activeElement))) return;
      subtreeObserver.observe(element, { subtree: true, childList: true, attributeFilter: ['aria-live', 'role', 'popover'] });
      if (element.querySelector(ANNOUNCING_REGION_SELECTOR) !== null) {
        attributeObserver.observe(element, { childList: true });
        Array.from(element.children).forEach((child) => hide(child, force));
        return;
      }
      hidden.add(element);
      element.setAttribute('aria-hidden', 'true');
    }
    watchAttributes(element);
  };
  const visit = (element: Element): void => {
    if (element.matches('[aria-live="off"]')) hide(element);
    else if (element.matches(`[aria-live], ${TOAST_SELECTOR}, ${DIALOG_PORTAL_SELECTOR}`)) return;
    else if (hasUnhiddenLiveRegion(element)) {
      attributeObserver.observe(element, { childList: true });
      Array.from(element.children).forEach(visit);
    } else watchAttributes(element);
  };
  for (let element: Element = portal; element !== element.ownerDocument.body && element.parentElement; element = element.parentElement) {
    for (const sibling of Array.from(element.parentElement.children)) {
      if (sibling !== element && hasUnhiddenLiveRegion(sibling)) visit(sibling);
    }
  }
  return () => {
    attributeObserver.disconnect();
    subtreeObserver.disconnect();
    hidden.forEach((element) => element.removeAttribute('aria-hidden'));
  };
}

/** While a modal popup is open, hides the page beside the live regions it leaves audible. */
export function useHideBesideLiveRegions(popup: HTMLElement | null, enabled: boolean): void {
  React.useEffect(() => {
    const portal = popup?.closest(DIALOG_PORTAL_SELECTOR);
    const view = popup?.ownerDocument.defaultView;
    if (!enabled || !popup || !portal || !view) return undefined;
    let release: (() => void) | null = null;
    const sync = (): void => {
      if (!popup.hasAttribute('data-open')) {
        release?.();
        release = null;
      } else if (release === null) release = hideBesideLiveRegions(portal, view);
    };
    const observer = new view.MutationObserver(sync);
    observer.observe(popup, { attributeFilter: ['data-open'] });
    sync();
    return () => {
      observer.disconnect();
      release?.();
    };
  }, [popup, enabled]);
}

/** Whether a focus guard inside a live region should go inert while `popup` holds the page. */
export function isLiveRegionFocusGuard(guard: Element, popup: Element): boolean {
  return (
    guard.matches(FOCUS_GUARD_SELECTOR) &&
    !popup.contains(guard) &&
    !guard.matches(TOAST_CHILD_SELECTOR) &&
    guard.closest(LIVE_ANNOUNCEMENT_SELECTOR) !== null
  );
}

/**
 * A live region stays live beside an open sheet, but the focus guards inside it go inert, so
 * neither Tab nor a screen reader lands in it; guards that appear later go inert too.
 */
export function inertLiveRegionFocusGuards(popup: Element): () => void {
  const doc = popup.ownerDocument;
  const view = doc.defaultView;
  if (view === null) return () => {};
  const madeInert = new Set<Element>();
  const sweep = (): void => {
    for (const guard of Array.from(doc.querySelectorAll(FOCUS_GUARD_SELECTOR))) {
      if (madeInert.has(guard) || guard.hasAttribute('inert') || !isLiveRegionFocusGuard(guard, popup)) continue;
      guard.setAttribute('inert', '');
      madeInert.add(guard);
    }
  };
  const observer = new view.MutationObserver(sweep);
  observer.observe(doc.body, { subtree: true, childList: true });
  sweep();
  return () => {
    observer.disconnect();
    for (const guard of madeInert) guard.removeAttribute('inert');
    madeInert.clear();
  };
}
