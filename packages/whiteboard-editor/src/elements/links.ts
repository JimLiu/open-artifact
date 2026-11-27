/**
 * Where board links and assets point:
 *
 * - links (cards, linked pictures, links in text) hold `#element=<id>` (an
 *   element of this board, which the board goes to), an artifact address
 *   `open-artifact://artifact/<id>[#place]` or an `http(s)` URL; artifact
 *   addresses open the artifact in the Open Artifacts Shell
 *   (`<shell>/a/<id>[#place]`);
 * - uploaded pictures and videos are stored as `/_blob/<id>`, which every
 *   Open Artifact host serves from its root (the runtime's asset
 *   contract), so they load as stored;
 * - inline images (`data:`) pass through unchanged.
 */

import { maybeSession } from '../services/session.ts';
import {
  ARTIFACT_ADDRESS_PREFIX,
  artifactAddressOfUrl,
  artifactAddressParts,
  elementAnchor,
  elementAnchorId,
  linkedElementId,
  normalizeLinkHref,
  type ElementId,
} from '@open-artifact/whiteboard-core';

export { ARTIFACT_ADDRESS_PREFIX };

/** The id in an artifact address, or `undefined` for other links. */
export function artifactIdOf(href: string): string | undefined {
  return artifactAddressParts(href)?.artifact;
}

/** This board's artifact id, when the Shell gave it. */
export function thisBoardId(): string | undefined {
  return maybeSession()?.shell?.artifactId ?? undefined;
}

/** The origin artifacts open under: the Shell's, or this page's when the page is not framed. */
function artifactOrigin(shellOrigin?: string | null, pageOrigin?: string): string {
  return shellOrigin ?? maybeSession()?.shell?.origin ?? pageOrigin ?? (typeof location === 'undefined' ? '' : location.origin);
}

/**
 * The element of this board a link points at: `#element=<id>`, or this
 * board's own address (or page URL) at `#element=<id>`. `undefined` for
 * links elsewhere. `here` is this board's artifact id.
 */
export function boardLinkElement(href: string, here: string | undefined = thisBoardId()): ElementId | undefined {
  const text = href.trim();
  const linked = linkedElementId(text, here);
  if (linked !== undefined || here === undefined) return linked;
  return linkedElementId(artifactAddressOfUrl(text, [artifactOrigin()]) ?? '', here);
}

/**
 * The stored form of a link typed or pasted as a page URL of the Shell:
 * this board's page at an element becomes `#element=<id>`, another
 * artifact's page its artifact address. Anything else as it is.
 */
export function storedLinkOf(text: string, here: string | undefined = thisBoardId(), shellOrigin?: string | null): string {
  const origin = shellOrigin ?? maybeSession()?.shell?.origin;
  const address = origin ? artifactAddressOfUrl(text, [origin]) : undefined;
  if (address === undefined) return text;
  const linked = linkedElementId(address, here);
  return linked === undefined ? address : elementAnchor(linked);
}

/**
 * The URL a board link opens: artifacts under the Shell's origin (or this
 * page's origin when the page is not framed) at the place the link names,
 * an element of this board on this board's page, web links as they are.
 * `undefined` for links the board does not open.
 */
export function boardLinkTarget(href: string, shellOrigin?: string | null, pageOrigin?: string, here: string | undefined = thisBoardId()): string | undefined {
  const normalized = normalizeLinkHref(href);
  if (normalized === undefined) return undefined;
  const anchored = elementAnchorId(normalized);
  if (anchored !== undefined) {
    const origin = shellOrigin ?? maybeSession()?.shell?.origin;
    return here !== undefined && origin ? `${origin}/a/${encodeURIComponent(here)}${elementAnchor(anchored)}` : elementAnchor(anchored);
  }
  const parts = artifactAddressParts(normalized);
  if (parts === undefined) return /^https?:\/\//i.test(normalized) ? normalized : undefined;
  return `${artifactOrigin(shellOrigin, pageOrigin)}/a/${encodeURIComponent(parts.artifact)}${parts.place ?? ''}`;
}

/**
 * The URL that opens this board at element `id`: its page in the Shell,
 * else this page with `#element=<id>`.
 */
export function elementPageUrl(id: ElementId): string {
  const target = boardLinkTarget(elementAnchor(id)) ?? elementAnchor(id);
  if (!target.startsWith('#') || typeof location === 'undefined') return target;
  return location.href.replace(/#.*$/, '') + target;
}

/** The text shown for a link's address: the host and path of a web link, else the address. */
export function linkDisplayUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return href;
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return href;
  }
}

/**
 * The URL a picture or video source loads from. Uploads (`/_blob/<id>`)
 * are served from the host's root, so every source loads as stored; this
 * is the one place to change should a host serve them elsewhere.
 */
export function resolveAssetUrl(src: string): string {
  return src;
}

/** Opens a board link in a new tab (no opener). */
export function openBoardLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * The link under a pressed DOM node (a link card, a linked picture or a
 * link inside text), for tools that open links on Mod-click or a tap.
 */
export function linkHrefAt(target: EventTarget | null): string | undefined {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return undefined;
  const anchor = target.closest('a[href]');
  return anchor instanceof HTMLAnchorElement ? anchor.href : undefined;
}
