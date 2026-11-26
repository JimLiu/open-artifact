/**
 * Listens for artboard swipes (lib/swipe.ts) on the focused view's backdrop
 * and inside an artboard's frame. A swipe the page could use itself, like
 * scrolling a carousel or moving a slider, is left to the page.
 */

import { nearEdge, scrollsToward, swipeStep, type SwipeStep } from '../lib/swipe.ts';

const DRAG_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'CANVAS']);
const MEDIA_TAGS = new Set(['VIDEO', 'AUDIO']);
const DRAG_ROLES = new Set(['slider', 'scrollbar', 'application']);
const SCROLLING = new Set(['auto', 'scroll']);
const CLIPPING = new Set(['hidden', 'clip']);

export interface SwipeWatch {
  /** Screen pixels per CSS pixel of the watched document (a scaled frame). */
  scale?(): number;
  /** The screen x of a client x in the watched document. */
  screenX?(clientX: number): number;
  /** Whether a swipe would page right now. */
  enabled(): boolean;
  onSwipe(step: Exclude<SwipeStep, 0>): void;
}

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && (node as Node).nodeType === 1;
}

/** A control that reads sideways drags itself: a field, a slider, media controls, a carousel. */
function readsSideDrags(el: Element): boolean {
  if (DRAG_TAGS.has(el.tagName)) return true;
  if (MEDIA_TAGS.has(el.tagName)) return el.hasAttribute('controls');
  if ((el as HTMLElement).isContentEditable || el.getAttribute('draggable') === 'true') return true;
  const role = el.getAttribute('role');
  if (role !== null && DRAG_ROLES.has(role)) return true;
  return (el.getAttribute('aria-roledescription') ?? '').toLowerCase().includes('carousel');
}

/** Which ways (next, previous) the page under `start` could scroll sideways itself. */
function pageScrolls(start: Element): { next: boolean; previous: boolean } {
  const doc = start.ownerDocument;
  const view = doc.defaultView;
  const out = { next: false, previous: false };
  if (!view) return out;
  const take = (box: Element, rtl: boolean): void => {
    out.next ||= scrollsToward(box, 1, rtl);
    out.previous ||= scrollsToward(box, -1, rtl);
  };
  const stops = new Set<Element | null>([doc.documentElement, doc.body]);
  for (let el: Element | null = start; el && !stops.has(el); el = el.parentElement) {
    const style = view.getComputedStyle(el);
    if (SCROLLING.has(style.overflowX)) take(el, style.direction === 'rtl');
  }
  const page = doc.scrollingElement;
  const clipped = [...stops].some((el) => el !== null && CLIPPING.has(view.getComputedStyle(el).overflowX));
  if (page && !clipped) take(page, view.getComputedStyle(doc.documentElement).direction === 'rtl');
  return out;
}

/** Starts listening on `root`; returns the way to stop. */
export function watchSwipes(root: Document | HTMLElement, watch: SwipeWatch): () => void {
  // Which ways the page could scroll is read at the start, before the gesture scrolls it.
  let start: { x: number; y: number; at: number; target: Element; next: boolean; previous: boolean } | null = null;
  const screenWidth = (): number => window.innerWidth;

  const onStart = (event: TouchEvent): void => {
    const touch = event.touches[0];
    const target = event.target;
    start = null;
    if (event.touches.length !== 1 || !touch || !isElement(target) || !watch.enabled()) return;
    if (nearEdge(watch.screenX ? watch.screenX(touch.clientX) : touch.clientX, screenWidth())) return;
    for (let el: Element | null = target; el; el = el.parentElement) if (readsSideDrags(el)) return;
    start = { x: touch.clientX, y: touch.clientY, at: event.timeStamp, target, ...pageScrolls(target) };
  };
  const onMove = (event: TouchEvent): void => {
    if (event.touches.length > 1) start = null;
  };
  const onEnd = (event: TouchEvent): void => {
    const from = start;
    start = null;
    const touch = event.changedTouches[0];
    if (!from || !touch || event.type !== 'touchend' || event.touches.length) return;
    const scale = watch.scale?.() ?? 1;
    const step = swipeStep((touch.clientX - from.x) * scale, (touch.clientY - from.y) * scale, event.timeStamp - from.at);
    if (step === 0 || !watch.enabled()) return;
    const selection = from.target.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed) return;
    if (step === 1 ? from.next : from.previous) return;
    watch.onSwipe(step);
  };

  const options = { passive: true, capture: true } as const;
  root.addEventListener('touchstart', onStart as EventListener, options);
  root.addEventListener('touchmove', onMove as EventListener, options);
  root.addEventListener('touchend', onEnd as EventListener, options);
  root.addEventListener('touchcancel', onEnd as EventListener, options);
  return () => {
    root.removeEventListener('touchstart', onStart as EventListener, options);
    root.removeEventListener('touchmove', onMove as EventListener, options);
    root.removeEventListener('touchend', onEnd as EventListener, options);
    root.removeEventListener('touchcancel', onEnd as EventListener, options);
  };
}
