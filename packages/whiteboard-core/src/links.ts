/**
 * Board links: which addresses a link card, a linked picture or a link in
 * text may point at, and how a card's title and subtitle read.
 *
 * A link points at
 * - an element of the same board (`#element=<element id>`);
 * - another artifact (`open-artifact://artifact/<id>`), optionally at a place
 *   in it (`…#element=<element id>` on a board, or the place fragment that
 *   artifact's type reads, such as `#slide-3`), which the Shell resolves;
 * - a web page (`http(s)://…`, no credentials, no whitespace or control
 *   characters).
 */

import { ARTIFACT_ID } from '@open-artifact/protocol';
import { ELEMENT_ID_PATTERN, LINK_KIND_LABELS, LINK_KINDS, MAX_IMAGE_HREF_CHARS, MAX_LINK_HREF_CHARS, MAX_LINK_TITLE_CHARS, type ElementId, type LinkElement, type LinkKind } from './schema.ts';
import { percentEncodeMarkdownChars } from './image-source.ts';

/** A title must show at least one letter, digit, symbol or punctuation mark. */
const VISIBLE_TITLE_CHAR_PATTERN = /[\p{L}\p{N}\p{S}\p{P}]/u;

/** True for a link-card kind. */
export function isLinkKind(kind: unknown): kind is LinkKind {
  return typeof kind === 'string' && (LINK_KINDS as readonly string[]).includes(kind);
}

/**
 * An `http(s)` URL that is safe to show and open: no whitespace or control
 * characters, no credentials, Markdown-breaking characters escaped.
 */
export function normalizeHttpUrl(href: unknown, maxChars = MAX_IMAGE_HREF_CHARS): string | undefined {
  const url = typeof href === 'string' ? percentEncodeMarkdownChars(href) : '';
  if (url.length > maxChars || !/^https?:\/\/[^\s\p{Cc}\p{Cf}﷐-﷔]+$/u.test(url)) return undefined;
  try {
    const { username, password } = new URL(url);
    return username === '' && password === '' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The fragment that points at an element: `#element=<id>`. */
export const ELEMENT_ANCHOR_PREFIX = '#element=';

/** The prefix of artifact addresses. */
export const ARTIFACT_ADDRESS_PREFIX = 'open-artifact://artifact/';

/** A place fragment an artifact address may carry (the Shell reads it; the board only bounds it). */
const ARTIFACT_PLACE_PATTERN = /^#[A-Za-z0-9_.~:@+\-=&%/]{1,200}$/;

/** The link to element `id` of the same board. */
export function elementAnchor(id: ElementId): string {
  return ELEMENT_ANCHOR_PREFIX + id;
}

/** The element a `#element=<id>` fragment points at, or `undefined` for anything else. */
export function elementAnchorId(href: unknown): ElementId | undefined {
  if (typeof href !== 'string' || !href.startsWith(ELEMENT_ANCHOR_PREFIX)) return undefined;
  const id = href.slice(ELEMENT_ANCHOR_PREFIX.length);
  return ELEMENT_ID_PATTERN.test(id) ? id : undefined;
}

/** A link to an element of the same board (`#element=<id>`), if it is one. */
export function normalizeElementAnchor(href: unknown): string | undefined {
  const id = elementAnchorId(typeof href === 'string' ? href.trim() : href);
  return id === undefined ? undefined : elementAnchor(id);
}

/** True when the link points at an element of the same board. */
export function isElementAnchor(href: string): boolean {
  return elementAnchorId(href) !== undefined;
}

/** The artifact and place (`#…`, when given) of an artifact address. */
export interface ArtifactAddressParts {
  artifact: string;
  place?: string;
}

/** The artifact and place of an artifact address, or `undefined` when it is not one. */
export function artifactAddressParts(href: unknown): ArtifactAddressParts | undefined {
  if (typeof href !== 'string') return undefined;
  const text = href.trim();
  if (text.length > MAX_LINK_HREF_CHARS || /[\s\p{Cc}]/u.test(text)) return undefined;
  const match = /^open-artifact:\/\/artifact\/([^/?#]+)(#.*)?$/u.exec(text);
  if (match === null || !ARTIFACT_ID.test(match[1]!)) return undefined;
  const place = match[2];
  if (place === undefined) return { artifact: match[1]! };
  if (!ARTIFACT_PLACE_PATTERN.test(place)) return undefined;
  if (place.startsWith(ELEMENT_ANCHOR_PREFIX) && elementAnchorId(place) === undefined) return undefined;
  return { artifact: match[1]!, place };
}

/** The address of `artifact`, at `place` when given. */
export function artifactAddress(artifact: string, place?: string): string {
  return ARTIFACT_ADDRESS_PREFIX + artifact + (place ?? '');
}

/** The canonical `open-artifact://artifact/<id>[#place]` form of an artifact address, if it is one. */
export function normalizeArtifactAddress(href: unknown): string | undefined {
  const parts = artifactAddressParts(href);
  return parts === undefined ? undefined : artifactAddress(parts.artifact, parts.place);
}

/**
 * The artifact address a page URL of the Shell stands for: `<origin>/a/<id>`,
 * with the place in its fragment when it has one the address may carry,
 * becomes `open-artifact://artifact/<id>[#place]`. Only URLs on one of
 * `origins` (the Shell's) count; `undefined` for anything else.
 */
export function artifactAddressOfUrl(text: unknown, origins: readonly string[]): string | undefined {
  if (typeof text !== 'string' || origins.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (!origins.includes(url.origin) || url.search !== '') return undefined;
  const id = /^\/a\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (id === undefined || !ARTIFACT_ID.test(id)) return undefined;
  return (url.hash === '' ? undefined : normalizeArtifactAddress(artifactAddress(id, url.hash))) ?? artifactAddress(id);
}

/** A link card's address: an element of this board, an artifact address or a web URL. */
export function normalizeLinkHref(href: unknown): string | undefined {
  return normalizeElementAnchor(href) ?? normalizeArtifactAddress(href) ?? normalizeHttpUrl(href, MAX_LINK_HREF_CHARS);
}

/** A linked picture's address: an element of this board, an artifact address or a web URL. */
export function normalizeImageHref(href: unknown): string | undefined {
  return normalizeElementAnchor(href) ?? normalizeArtifactAddress(href) ?? normalizeHttpUrl(href, MAX_IMAGE_HREF_CHARS);
}

/** True when the card points at another artifact. */
export function isArtifactLink(href: string): boolean {
  return normalizeArtifactAddress(href) !== undefined;
}

/** A short one-line label: whitespace collapsed, invisible characters dropped, capped at `maxChars`. */
export function sanitizeShortLabel(label: unknown, maxChars: number): string {
  if (typeof label !== 'string') return '';
  const value = label
    .replace(/\s+/g, ' ')
    .replace(/(?![‌‍\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ +/g, ' ')
    .trim();
  return VISIBLE_TITLE_CHAR_PATTERN.test(value) ? [...value].slice(0, maxChars).join('').trim() : '';
}

/** A card title: whitespace collapsed, invisible characters dropped, capped. */
export function sanitizeLinkTitle(title: unknown): string {
  return sanitizeShortLabel(title, MAX_LINK_TITLE_CHARS);
}

/**
 * The link fields of a card, or `undefined` when its address is not allowed.
 * Legacy `kind: "board"` reads as `whiteboard`; a card to an element of the
 * same board takes no kind (it shows its target's).
 */
export function normalizeLinkFields(input: { href?: unknown; title?: unknown; kind?: unknown }): Pick<LinkElement, 'href' | 'title' | 'kind'> | undefined {
  const href = normalizeLinkHref(input.href);
  if (href === undefined) return undefined;
  const title = sanitizeLinkTitle(input.title);
  if (isElementAnchor(href)) return { href, ...(title !== '' ? { title } : {}) };
  const kind = input.kind === 'board' ? 'whiteboard' : input.kind;
  return {
    href,
    ...(title !== '' ? { title } : {}),
    ...(isLinkKind(kind) ? { kind } : isArtifactLink(href) ? {} : { kind: 'web' as const }),
  };
}

/** A label for the card's kind (`Artifact` when unknown). */
export function linkKindLabel(link: Pick<LinkElement, 'kind'>, live?: { kind?: LinkKind }): string {
  const kind = live?.kind ?? link.kind;
  return kind === undefined ? 'Artifact' : LINK_KIND_LABELS[kind];
}

/** The title a card shows: the live title, its stored title, or its kind. */
export function linkTitle(link: Pick<LinkElement, 'kind' | 'title'>, live?: { kind?: LinkKind; title?: string }): string {
  return live?.title ?? link.title ?? linkKindLabel(link, live);
}

/** The line under a card's title: its kind, or its address when untitled. */
export function linkSubtitle(link: Pick<LinkElement, 'kind' | 'title' | 'href'>, live?: { kind?: LinkKind; title?: string }): string {
  return (live?.title ?? link.title) === undefined ? (link.href.split('?')[0] ?? link.href).replace(/^https?:\/\//, '') : linkKindLabel(link, live);
}
