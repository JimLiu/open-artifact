/**
 * A shape library from a link: the page itself fetches the `https://` link
 * (no cookies, no referrer, nothing in between), reads at most 4 MB of it,
 * tells what it is from its content and cleans it, all before anything is
 * stored. The panel then asks before adding it.
 *
 * Whether a link can be read is up to the site it points at (it must allow
 * other pages to read it) and to the board's host (it may keep pages from
 * fetching other sites). The page cannot tell most failures apart, so it
 * says so plainly and points to adding the file instead.
 */

import { cleanLibrarySource, joinBytes, readShapeLibraryBytes, SHAPE_LIBRARY_LIMITS, type ShapeLibraryRead } from '@open-artifact/whiteboard-core';

/** How long a link may take. */
export const LINK_TIMEOUT_MS = 15_000;

/** The hint every failed link ends with. */
export const LINK_FALLBACK_HINT = 'Download the file and add it with “From a file…” (or drop it on this panel).';

/** A library read from a link, ready to confirm. */
export interface LinkLibrary {
  ok: true;
  /** The site it came from. */
  host: string;
  read: ShapeLibraryRead;
}

/** A link that gave no library, and why. */
export interface LinkRefusal {
  ok: false;
  reason: string;
}

/** The link as a URL when it is an `https://` link, else why not. */
export function checkLibraryLink(text: string): { ok: true; url: URL } | LinkRefusal {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'Paste a link to a shape library.' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'This is not a link.' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only https:// links can be added.' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'Links with a name or password in them cannot be added.' };
  return { ok: true, url };
}

/** The file name a link gives: its last path part, else its host. */
export function linkFileName(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last) || url.hostname;
  } catch {
    return last || url.hostname;
  }
}

/** A library read from a link keeps the link as its source unless it names its own. */
export function withLinkSource(read: ShapeLibraryRead, url: URL): ShapeLibraryRead {
  if (read.library.source !== undefined) return read;
  const source = cleanLibrarySource(url.href);
  return source === undefined ? read : { ...read, library: { ...read.library, source } };
}

/** Reads a response body, stopping past `max` bytes. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | 'too_large'> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    chunks.push(value);
  }
  return joinBytes(chunks, total);
}

/** Fetches a link and reads the library in it (nothing is stored). */
export async function readLibraryLink(text: string): Promise<LinkLibrary | LinkRefusal> {
  const checked = checkLibraryLink(text);
  if (!checked.ok) return checked;
  const { url } = checked;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  // The board's host may keep pages from fetching other sites: that shows as a policy report, not in the error.
  let blockedByHost = false;
  const onViolation = (event: SecurityPolicyViolationEvent) => {
    if (event.effectiveDirective === 'connect-src' || event.violatedDirective.startsWith('connect-src') || event.violatedDirective.startsWith('default-src')) blockedByHost = true;
  };
  document.addEventListener('securitypolicyviolation', onViolation);
  try {
    let response: Response;
    try {
      response = await fetch(url.href, { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
    } catch {
      // Let a policy report arrive before deciding why.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (blockedByHost) return { ok: false, reason: `This board’s host does not let the page fetch other sites, so links cannot be added here. ${LINK_FALLBACK_HINT}` };
      if (controller.signal.aborted) return { ok: false, reason: `The link took longer than ${LINK_TIMEOUT_MS / 1000} seconds. ${LINK_FALLBACK_HINT}` };
      return { ok: false, reason: `The link could not be read from this page (the site may not allow it). ${LINK_FALLBACK_HINT}` };
    }
    if (!response.ok) return { ok: false, reason: `The link answered with status ${response.status}. ${LINK_FALLBACK_HINT}` };
    let bytes: Uint8Array | 'too_large';
    try {
      bytes = await readCapped(response.body, SHAPE_LIBRARY_LIMITS.bytes);
    } catch {
      return { ok: false, reason: controller.signal.aborted ? `The link took longer than ${LINK_TIMEOUT_MS / 1000} seconds. ${LINK_FALLBACK_HINT}` : `The link could not be read to the end. ${LINK_FALLBACK_HINT}` };
    }
    if (bytes === 'too_large') return { ok: false, reason: `This shape library is larger than ${SHAPE_LIBRARY_LIMITS.bytes / 1024 / 1024} MB: split it into smaller libraries.` };
    const read = await readShapeLibraryBytes(bytes, linkFileName(url));
    if (!read.ok) return read;
    return { ok: true, host: url.host, read: withLinkSource(read, url) };
  } finally {
    clearTimeout(timer);
    document.removeEventListener('securitypolicyviolation', onViolation);
  }
}
