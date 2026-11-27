/**
 * F6 regions on the page: which are showing, where the focus lands in one
 * (its anchor, else what had the focus there last, else its usual control,
 * else its first visible control), and moving there with a visible ring.
 */

import { HOME_REGION, REGION_ATTRIBUTE, REGION_ORDER, nextRegion, type RegionId } from '../lib/focus-regions.ts';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
/** Where the focus lands first: the tool in use, the canvas itself. */
const ANCHORS: Partial<Record<RegionId, string>> = { tools: '[aria-pressed="true"]', canvas: '[data-canvas-surface]' };
/** Where it lands when nothing there had it: the open tab of the side panel. */
const FALLBACKS: Partial<Record<RegionId, string>> = { panel: '[role="tab"][aria-selected="true"]' };
/** Regions cut by the canvas' edges. */
const CLIPPED = new Set<RegionId>(['canvas', 'selection']);

/** What had the focus last in each region. */
const last = new Map<RegionId, HTMLElement>();

/** The region a node is in (the innermost), or `null`. */
export function regionAt(node: Element | null): RegionId | null {
  const id = node?.closest(`[${REGION_ATTRIBUTE}]`)?.getAttribute(REGION_ATTRIBUTE);
  return id && (REGION_ORDER as readonly string[]).includes(id) ? (id as RegionId) : null;
}

const rootsOf = (id: RegionId): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[${REGION_ATTRIBUTE}="${id}"]`)];

/** Shown, not cut off by the canvas' edge, and on top where it is (a region's own root need only be shown). */
function visible(element: HTMLElement, id: RegionId): boolean {
  if (!element.isConnected || regionAt(element) !== id) return false;
  const r = element.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (element.hasAttribute(REGION_ATTRIBUTE)) return true;
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (CLIPPED.has(id)) {
    const clip = document.querySelector('[data-canvas-surface]')?.getBoundingClientRect();
    if (clip && (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom)) return false;
  }
  const hit = document.elementFromPoint(x, y);
  return Boolean(hit && (hit === element || element.contains(hit)));
}

function find(id: RegionId, selector: string | undefined): HTMLElement | null {
  if (!selector) return null;
  for (const root of rootsOf(id)) {
    const found = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll<HTMLElement>(selector)].find((el) => visible(el, id));
    if (found) return found;
  }
  return null;
}

/** Where the focus lands in a region, or `null` when it is not showing. */
function entryOf(id: RegionId): HTMLElement | null {
  const anchor = find(id, ANCHORS[id]);
  if (anchor) return anchor;
  const previous = last.get(id);
  if (previous && visible(previous, id)) return previous;
  return find(id, FALLBACKS[id]) ?? find(id, FOCUSABLE);
}

/** Marks a region's own root focused from the keyboard (the canvas): its ring shows until it loses the focus or is clicked. */
const RING_ATTRIBUTE = 'data-focus-ring';

function ringUntilLeft(root: HTMLElement): void {
  root.setAttribute(RING_ATTRIBUTE, '');
  const off = (): void => {
    root.removeAttribute(RING_ATTRIBUTE);
    root.removeEventListener('blur', off);
    root.removeEventListener('pointerdown', off, true);
  };
  root.addEventListener('blur', off);
  root.addEventListener('pointerdown', off, true);
}

/** Focuses a region's landing spot, its ring shown. */
function enter(id: RegionId): boolean {
  const target = entryOf(id);
  if (!target) return false;
  if (target.hasAttribute(REGION_ATTRIBUTE) && !target.hasAttribute(RING_ATTRIBUTE)) ringUntilLeft(target);
  target.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  return document.activeElement === target;
}

/** F6 / ⇧F6: the next region that shows, wrapping around. Returns whether the focus moved. */
export function stepRegion(step: 'forward' | 'back'): boolean {
  const current = regionAt(document.activeElement);
  const showing = new Set(REGION_ORDER.filter((id) => id === current || entryOf(id) !== null));
  const next = nextRegion(showing, current, step);
  return next ? enter(next) : false;
}

/** Brings the focus home to the canvas. */
export function focusHome(): boolean {
  return enter(HOME_REGION);
}

/** Notes what has the focus in its region (a `focusin` listener). */
export function rememberRegionFocus(event: FocusEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const id = target ? regionAt(target) : null;
  if (id && target && !target.hasAttribute(REGION_ATTRIBUTE)) last.set(id, target);
}
