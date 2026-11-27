import type { Parameters } from '@open-artifact/data-core';
import { DRAFTS_COLLECTION, SOURCE_ATTRIBUTE } from '@open-artifact/data-core';
import { MAX_RUN_REPORT_BYTES, escapedJsonByteSize } from './runs.ts';
import { DERIVED_SOURCE_ATTRIBUTE } from './sources.ts';

/** `data/users/<me>/page`: the page as this viewer sees it while the agent works. */
export interface ShownPageRecord {
  v: 1;
  at: string;
  /** What the page showed when it wasn't the dashboard itself (see {@link showingOf}). */
  showing?: string;
  width: number;
  filters: Parameters;
  html: string;
  truncated?: true;
}

export interface ShownPage {
  html: string;
  width: number;
}

/** What the page shows, as {@link showingOf} reads it. */
export interface ShownView {
  mode: 'live' | 'draft' | 'version';
  draftId?: string;
  version?: number;
}

/** The prefix of an earlier version's `showing`: `history/<n>`, the `n` that `open-artifact history` lists. */
export const HISTORY_SHOWING_PREFIX = 'history/';

/**
 * What the agent is told the page shows when it isn't the dashboard itself: a draft as `drafts/<id>`, an earlier
 * version as `history/<n>`; null for the dashboard.
 */
export function showingOf(shown: ShownView): string | null {
  if (shown.mode === 'draft' && shown.draftId !== undefined && shown.draftId !== '') return `${DRAFTS_COLLECTION}/${shown.draftId}`;
  if (shown.mode === 'version' && shown.version !== undefined && Number.isSafeInteger(shown.version)) return `${HISTORY_SHOWING_PREFIX}${shown.version}`;
  return null;
}

/** Where the viewer's changes go when it isn't the dashboard itself: the draft shown (`drafts/<id>`). An earlier version is only looked at. */
export function writeToOf(shown: ShownView): string | null {
  return shown.mode === 'draft' ? showingOf(shown) : null;
}

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const words = (text: string): ReadonlySet<string> => new Set(text.split(/\s+/));

export const SHOWN_ALLOWED_TAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  [XHTML_NAMESPACE]: words(
    'a abbr address article aside b bdi bdo blockquote br button canvas caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd label li main mark meter nav ol output p picture pre progress q rp rt ruby s samp section select small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr',
  ),
  [SVG_NAMESPACE]: words(
    'svg g path rect circle ellipse line polyline polygon text tspan defs clipPath mask linearGradient radialGradient stop pattern marker symbol use',
  ),
};
export const SVG_DEFINITION_TAGS = words('defs clipPath mask linearGradient radialGradient pattern marker symbol');
export const ALLOWED_HTML_ATTRIBUTES = words(
  'id title lang dir role alt width height value min max low high optimum colspan rowspan scope headers span start reversed datetime open',
);
export const ALLOWED_SVG_ATTRIBUTES = words(
  'viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity opacity clip-path clip-rule mask marker-start marker-mid marker-end font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline dx dy textLength lengthAdjust offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod fx fy patternUnits patternTransform patternContentUnits markerWidth markerHeight markerUnits refX refY orient clipPathUnits maskUnits maskContentUnits vector-effect paint-order visibility display color overflow letter-spacing word-spacing text-decoration xml:space',
);
const ALLOWED_CSS_FUNCTIONS = words('translate scale rotate skewX skewY matrix rgb rgba hsl hsla');
const LOCAL_SVG_REFERENCE_PATTERN = /^url\(["']?#([^"')\s]+)["']?\)$/;
const MAX_LINK_CHARACTERS = 2048;
const APPEND_BATCH_SIZE = 4096;
/** Marks an element the shown page keeps although only its opacity hides it. */
export const FADED_ATTRIBUTE = 'data-faded';
export const STOP_ATTRIBUTE = 'data-dash-stop';

const VISIBILITY_OPTIONS = { visibilityProperty: true, opacityProperty: true, checkVisibilityCSS: true, checkOpacity: true };

export function isVisibleForExport(element: Element): boolean {
  return typeof element.checkVisibility === 'function' && element.checkVisibility(VISIBILITY_OPTIONS);
}

export function isVisibleIgnoringOpacity(element: Element): boolean {
  return (
    typeof element.checkVisibility === 'function' &&
    element.checkVisibility({ ...VISIBILITY_OPTIONS, opacityProperty: false, checkOpacity: false })
  );
}

/** An http(s) or mailto link with no credentials, at most 2048 printable ASCII characters; otherwise undefined. */
export function sanitizeShownLink(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > MAX_LINK_CHARACTERS) return undefined;
  const value = input.trim();
  if (!/^(?:https?:\/\/|mailto:)/i.test(value)) return undefined;
  let href: string;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return undefined;
    if (url.username !== '' || url.password !== '') return undefined;
    if (url.protocol === 'mailto:' && url.pathname === '') return undefined;
    href = url.href;
  } catch {
    return undefined;
  }
  return href.length > MAX_LINK_CHARACTERS || !/^[\x21-\x7e]+$/.test(href) ? undefined : href;
}

/** An SVG attribute value with no backslash and only plain transform or colour functions, or a local `url(#id)`. */
export function isSafeShownSvgValue(value: string): boolean {
  if (LOCAL_SVG_REFERENCE_PATTERN.test(value.trim())) return true;
  return !value.includes('\\') && [...value.matchAll(/([\w-]+)\s*\(/g)].every((match) => ALLOWED_CSS_FUNCTIONS.has(match[1] ?? ''));
}

/** Each line trimmed, empty lines dropped. */
export function normalizeShownPageLines(html: string): string {
  return html
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** The record with `html`, cut by tenths until it fits the run-report size. */
export function fitShownPageRecord(html: string, base: Omit<ShownPageRecord, 'html' | 'truncated'>): ShownPageRecord {
  let record: ShownPageRecord = { ...base, html };
  for (let length = html.length; length > 0 && escapedJsonByteSize(record) > MAX_RUN_REPORT_BYTES; ) {
    length = Math.floor(length * 0.9);
    record = { ...base, truncated: true, html: html.slice(0, length) };
  }
  return record;
}

const isSvgDefinition = (element: Element): boolean =>
  element.namespaceURI === SVG_NAMESPACE && SVG_DEFINITION_TAGS.has(element.localName);
const isHrefAttribute = (attribute: Attr): boolean => attribute.localName === 'href' || attribute.name === 'xlink:href';

function isAllowedAttribute(attribute: Attr, element: Element): boolean {
  if (element.hasAttribute(STOP_ATTRIBUTE) && (attribute.name === 'role' || attribute.name === 'aria-description')) return false;
  if (isHrefAttribute(attribute))
    return (
      attribute.value.startsWith('#') ||
      (element.namespaceURI === XHTML_NAMESPACE && element.localName === 'a' && sanitizeShownLink(attribute.value) !== undefined)
    );
  if (ALLOWED_SVG_ATTRIBUTES.has(attribute.name)) return isSafeShownSvgValue(attribute.value);
  return ALLOWED_HTML_ATTRIBUTES.has(attribute.name) || attribute.name.startsWith('aria-');
}

/** The element without its children: the source (unless derived) and allowed attributes, but no SVG geometry. */
function cloneShell(element: Element): Element {
  const replaced = element.localName === 'canvas' || element.localName === 'img';
  const select = element.localName === 'select';
  const copy = element.ownerDocument.createElementNS(element.namespaceURI, replaced ? 'img' : select ? 'output' : element.localName);
  for (const attribute of element.attributes)
    if (
      (attribute.name === SOURCE_ATTRIBUTE && !element.hasAttribute(DERIVED_SOURCE_ATTRIBUTE)) ||
      (isAllowedAttribute(attribute, element) && (attribute.name === 'viewBox' || !ALLOWED_SVG_ATTRIBUTES.has(attribute.name)))
    )
      copy.setAttribute(attribute.name, attribute.value);
  if (select) copy.textContent = [...(element as HTMLSelectElement).selectedOptions].map((option) => option.textContent).join(', ');
  return copy;
}

function isDisplayContents(element: Element): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display === 'contents' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

function isExportable(element: Element, inDefinitions: boolean, faded = false): boolean {
  if (SHOWN_ALLOWED_TAGS[element.namespaceURI ?? '']?.has(element.localName) !== true) return false;
  return (
    inDefinitions ||
    isSvgDefinition(element) ||
    isVisibleForExport(element) ||
    isDisplayContents(element) ||
    (faded && isVisibleIgnoringOpacity(element))
  );
}

function cloneShown(element: Element, inDefinitions: boolean, faded: boolean): Element | null {
  let copy: Element;
  try {
    copy = cloneShell(element);
  } catch {
    return null;
  }
  const definitions = inDefinitions || isSvgDefinition(element);
  if (element.localName === 'canvas' || element.localName === 'img' || element.localName === 'select') return copy;
  const children: Node[] = [];
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && !definitions) children.push(child.cloneNode());
    if (!(child instanceof Element) || isSvgDefinition(child)) continue;
    const fadedHere = !faded && !isExportable(child, definitions) && isExportable(child, definitions, true);
    const childCopy = fadedHere || isExportable(child, definitions, faded) ? cloneShown(child, definitions, faded || fadedHere) : null;
    if (fadedHere) childCopy?.setAttribute(FADED_ATTRIBUTE, '');
    if (childCopy !== null) children.push(childCopy);
  }
  for (let index = 0; index < children.length; index += APPEND_BATCH_SIZE)
    copy.append(...children.slice(index, index + APPEND_BATCH_SIZE));
  return copy;
}

/** The page as it shows, for the agent: static HTML, one trimmed line per line, or null. */
export function renderShownPageHtml(root: Element): string | null {
  const copy =
    typeof Element.prototype.checkVisibility === 'function' && isExportable(root, false) ? cloneShown(root, false, false) : null;
  return copy === null ? null : normalizeShownPageLines(copy.outerHTML);
}
