/**
 * Where a field says what it did with typed text, when the editor does not
 * take that over: a quiet (`polite`) live region, one per host, in the
 * nearest dialog (a modal dialog hides the rest of the page from screen
 * readers) or else the page body, in the page's language. The region is made
 * when a field in that host takes the focus, so it is in place before the
 * first message, and stays with its host.
 */

import { VISUALLY_HIDDEN, type AnnounceRegion } from './select-announce.ts';

/** The parts of a region's host the announcer uses. */
export interface FieldAnnounceHost<R extends AnnounceRegion> {
  appendChild(node: R): unknown;
}

/** The parts of a field the announcer uses (an `HTMLElement` has them, with `HTMLSpanElement` regions). */
export interface FieldAnnounceTarget<R extends AnnounceRegion> {
  ownerDocument: {
    createElement(tag: 'span'): R;
    body: FieldAnnounceHost<R> | null;
    documentElement: { lang: string };
  };
  closest(selector: string): FieldAnnounceHost<R> | null;
}

const regions = new WeakMap<object, AnnounceRegion>();

/** The region for a field's host, made the first time. Null when the field has no host to put one in. */
function regionFor<R extends AnnounceRegion>(field: FieldAnnounceTarget<R>): R | null {
  const doc = field.ownerDocument;
  const host = field.closest('[role="dialog"], [role="alertdialog"]') ?? doc.body;
  if (!host) return null;
  const known = regions.get(host) as R | undefined;
  if (known) return known;
  const region = doc.createElement('span');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.setAttribute('style', VISUALLY_HIDDEN);
  if (doc.documentElement.lang) region.setAttribute('lang', doc.documentElement.lang);
  host.appendChild(region);
  regions.set(host, region);
  return region;
}

/** Makes the region a field will speak into; call when the field takes the focus. */
export function prepareFieldAnnounce<R extends AnnounceRegion>(field: FieldAnnounceTarget<R>): void {
  regionFor(field);
}

/** Says `message` from a field. The same message twice in a row is said again. */
export function announceFromField<R extends AnnounceRegion>(field: FieldAnnounceTarget<R>, message: string): void {
  if (!message) return;
  const region = regionFor(field);
  if (!region) return;
  // A no-break space makes a repeat a change, so it is read again.
  region.textContent = region.textContent === message ? `${message} ` : message;
}
