/**
 * Where focus lands once a banner over the page is dismissed. The Dismiss button goes away with the banner, and the
 * browser would drop focus on the body; instead it lands on the nearest sensible place: a heading before the banner,
 * the named region around it, the page's top heading, or main. A keyboard landing shows a ring; a pointer landing
 * stays quiet until a key is pressed on it.
 */

import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { isComposingKey } from '@open-artifact/ui/keys';
import { isFocusLost } from '../sources/focus.ts';

/** How the Dismiss button was pressed. */
export type DismissMode = 'keyboard' | 'mouse' | 'touch' | 'pen';

/** How a landing shows: a ring around a heading, an inset ring on anything else, nothing after a pointer press. */
export type LandingMark = 'ring' | 'inset' | 'quiet';

/** The attribute a landing carries while it holds focus; the styles draw its ring from it. */
export const FOCUS_LANDING_ATTRIBUTE = 'data-focus-landing';

/** How long after the press a landing may still happen. */
export const LANDING_WINDOW_MS = 5000;

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);
const LANDMARKS = 'dialog, [role=dialog], [role=alertdialog], main, [role=main], aside, nav, [role=complementary], [role=navigation]';
const REGIONS = `${LANDMARKS}, article, [role=article], section, [role=region], [role=tabpanel], form[aria-label], form[aria-labelledby], [role=form][aria-label], [role=form][aria-labelledby], [role=group][aria-label], [role=group][aria-labelledby], [role=search][aria-label], [role=search][aria-labelledby]`;
const HEADINGS = 'h1:not([role]), h2:not([role]), h3:not([role]), h4:not([role]), h5:not([role]), h6:not([role]), [role=heading]';
const TOP_HEADINGS = 'h1:not([aria-level]), [aria-level="1"]';
const OUTSIDE_TOP = 'dialog, [role=dialog], [role=alertdialog], aside, [role=complementary], nav, [role=navigation], article, [role=article]';
const TEXT_INPUTS = 'input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=tel], input[type=password], input[type=number], textarea';

/** The press's mode: no detail and no pointer type is a key press (Enter or Space on the button). */
export function getDismissMode(event: { detail: number; pointerType?: string }): DismissMode {
  const type = event.pointerType ?? '';
  if (event.detail === 0 && type === '') return 'keyboard';
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

/** A key that ends the watch: anything but a held key repeating or a modifier pressed alone. */
export function isWatchEndingKey(event: { key: string; repeat: boolean }): boolean {
  return !event.repeat && !MODIFIER_KEYS.has(event.key);
}

/** The mark a landing takes: after a key press a ring (inset on anything but a heading), after a pointer none. */
export function getLandingMark(mode: DismissMode, heading: boolean): LandingMark {
  if (mode !== 'keyboard') return 'quiet';
  return heading ? 'ring' : 'inset';
}

/** A key pressed on a quiet landing that shows its ring: not a shortcut, not Shift alone, not part of a composition. */
export function isRingShowingKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; keyCode: number }): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key === 'Shift') return false;
  return !isComposingKey(event);
}

function isHeading(element: Element): boolean {
  return element.matches(HEADINGS);
}

function hasBox(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function isShown(element: Element): boolean {
  if (!element.isConnected) return false;
  if (element.closest('[inert], [aria-hidden="true"]') !== null) return false;
  const view = element.ownerDocument.defaultView;
  if (view === null) return true;
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function isBefore(element: Element, banner: Element): boolean {
  // The element comes before the banner in the document and doesn't hold it.
  return (element.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && !element.contains(banner);
}

function isNamed(element: Element): boolean {
  return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby');
}

function scrollableAncestor(element: Element): Element | null {
  const view = element.ownerDocument.defaultView;
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const overflow = view?.getComputedStyle(node).overflowY ?? '';
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Where focus may land, nearest first: headings and named regions up to the landmark, the top heading, then main. */
function collectCandidates(banner: Element, mode: DismissMode): Element[] {
  const found: Element[] = [];
  const add = (element: Element | null): void => {
    if (element !== null && !found.includes(element) && element !== banner && !banner.contains(element)) found.push(element);
  };
  for (let region = banner.parentElement?.closest(REGIONS) ?? null; region !== null; region = region.parentElement?.closest(REGIONS) ?? null) {
    const headings = [...region.querySelectorAll(HEADINGS)].filter((heading) => isBefore(heading, banner));
    for (const heading of headings.reverse()) add(heading);
    if (isNamed(region)) add(region);
    if (region.matches(LANDMARKS)) break;
  }
  const doc = banner.ownerDocument;
  const viewHeight = doc.defaultView?.innerHeight ?? 0;
  const bannerHeight = banner.getBoundingClientRect().height;
  for (const heading of doc.querySelectorAll(TOP_HEADINGS))
    if (heading.closest(OUTSIDE_TOP) === null && (isBefore(heading, banner) || heading.getBoundingClientRect().top < viewHeight + bannerHeight)) add(heading);
  add(doc.querySelector('main, [role=main]'));
  if (mode === 'keyboard') return found;
  const scroller = scrollableAncestor(banner);
  if (scroller === null) return found;
  return [...found.filter((element) => scroller.contains(element) && element !== scroller), scroller];
}

interface Landing {
  element: HTMLElement;
  addedTabIndex: boolean;
}

function canTakeFocus(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !isShown(element)) return false;
  if (isHeading(element) && (element.textContent ?? '').trim() === '') return false;
  // A text field would open the on-screen keyboard after a tap, and take typing meant elsewhere otherwise.
  return !element.matches(TEXT_INPUTS);
}

function tryFocus(element: HTMLElement, mode: DismissMode, heldBanner: boolean): Landing | null {
  const doc = element.ownerDocument;
  const addedTabIndex = element.tabIndex < 0 && !element.isContentEditable && !element.hasAttribute('tabindex');
  if (addedTabIndex) element.setAttribute('tabindex', '-1');
  let preventScroll = true;
  if (mode === 'keyboard') {
    const rect = element.getBoundingClientRect();
    const viewHeight = doc.defaultView?.innerHeight ?? 0;
    const mainInView = element.matches('main, [role=main]') && rect.top >= 0 && rect.top < viewHeight;
    preventScroll = heldBanner || !hasBox(element) || mainInView;
  }
  element.focus({ preventScroll, focusVisible: mode === 'keyboard' } as FocusOptions);
  if (doc.activeElement === element) return { element, addedTabIndex };
  if (addedTabIndex) element.removeAttribute('tabindex');
  return null;
}

/** Marks a landing and clears the mark (and any tabindex it was given) once focus or the pointer moves on. */
function markLanding({ element, addedTabIndex }: Landing, mode: DismissMode): void {
  const doc = element.ownerDocument;
  const heading = isHeading(element);
  element.setAttribute(FOCUS_LANDING_ATTRIBUTE, getLandingMark(mode, heading));
  const clear = (): void => {
    element.removeAttribute(FOCUS_LANDING_ATTRIBUTE);
    if (addedTabIndex) element.removeAttribute('tabindex');
    element.removeEventListener('blur', clear);
    element.removeEventListener('keydown', onKey);
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('pointerdown', clear, true);
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (event.target !== element) clear();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (element.getAttribute(FOCUS_LANDING_ATTRIBUTE) === 'quiet' && isRingShowingKey(event))
      element.setAttribute(FOCUS_LANDING_ATTRIBUTE, getLandingMark('keyboard', heading));
  };
  element.addEventListener('blur', clear);
  element.addEventListener('keydown', onKey);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('pointerdown', clear, true);
}

interface Watch {
  banner: Element;
  /** What held the banner, innermost first: a landing around where it was needs no scrolling. */
  places: Element[];
  mode: DismissMode;
  path: string;
  deadline: number;
  candidates: Element[];
  finalFocus: (() => HTMLElement | null) | false | undefined;
  stop: () => void;
  stopped: boolean;
}

function ancestorsOf(element: Element): Element[] {
  const found: Element[] = [];
  for (let node = element.parentElement; node !== null; node = node.parentElement) found.push(node);
  return found;
}

function afterTwoFrames(run: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

function check(watch: Watch): void {
  if (watch.stopped) return;
  const { banner } = watch;
  if (banner.isConnected && isShown(banner)) return;
  watch.stop();
  const doc = banner.ownerDocument;
  const lost = isFocusLost(doc) || banner.contains(doc.activeElement);
  if (!lost || Date.now() > watch.deadline || !doc.hasFocus() || watch.finalFocus === false) return;
  const targets: Element[] = [];
  const chosen = watch.finalFocus?.() ?? null;
  if (chosen !== null) targets.push(chosen);
  if (doc.defaultView?.location.pathname === watch.path) {
    const shown = watch.candidates.filter((element) => element.isConnected);
    targets.push(...shown.filter(hasBox), ...shown.filter((element) => !hasBox(element)));
  }
  for (const target of targets) {
    if (!canTakeFocus(target)) continue;
    const place = watch.places.find((element) => element.isConnected);
    const landing = tryFocus(target, watch.mode, place !== undefined && target.contains(place));
    if (landing === null) continue;
    markLanding(landing, watch.mode);
    return;
  }
}

function startWatch(banner: Element, event: ReactMouseEvent, finalFocus: Watch['finalFocus']): Watch | null {
  const doc = banner.ownerDocument;
  const native = event.nativeEvent as MouseEvent & { pointerType?: string };
  if (!banner.contains(doc.activeElement) && !(native.isTrusted && isFocusLost(doc))) return null;
  const mode = getDismissMode({ detail: native.detail, ...(native.pointerType === undefined ? {} : { pointerType: native.pointerType }) });
  const onKey = (key: KeyboardEvent): void => {
    // Typing into a composition is the person moving on too.
    if (isComposingKey(key) || isWatchEndingKey(key)) watch.stop();
  };
  const onMove = (): void => watch.stop();
  const watch: Watch = {
    banner,
    places: ancestorsOf(banner),
    mode,
    path: doc.defaultView?.location.pathname ?? '',
    deadline: Date.now() + LANDING_WINDOW_MS,
    candidates: collectCandidates(banner, mode),
    finalFocus,
    stopped: false,
    stop: () => {
      if (watch.stopped) return;
      watch.stopped = true;
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('pointerdown', onMove, true);
      doc.removeEventListener('wheel', onMove, true);
    },
  };
  doc.addEventListener('keydown', onKey, { capture: true, passive: true });
  doc.addEventListener('pointerdown', onMove, { capture: true, passive: true });
  doc.addEventListener('wheel', onMove, { capture: true, passive: true });
  return watch;
}

/**
 * A Dismiss handler for the banner in `banner` that lands focus somewhere sensible once the banner is gone.
 * `finalFocus` picks the landing first; `false` leaves focus alone.
 */
export function useDismissFocusLanding(
  banner: RefObject<HTMLElement | null>,
  onDismiss: (() => void) | undefined,
  finalFocus?: (() => HTMLElement | null) | false,
): ((event: ReactMouseEvent) => void) | undefined {
  const watch = useRef<Watch | null>(null);
  useEffect(
    () => () => {
      const current = watch.current;
      if (current !== null && !current.stopped) afterTwoFrames(() => check(current));
    },
    [],
  );
  const dismiss = useCallback(
    (event: ReactMouseEvent): void => {
      const element = banner.current;
      watch.current?.stop();
      watch.current = element === null ? null : startWatch(element, event, finalFocus);
      const current = watch.current;
      if (current !== null) afterTwoFrames(() => check(current));
      onDismiss?.();
    },
    [banner, onDismiss, finalFocus],
  );
  return onDismiss === undefined ? undefined : dismiss;
}
