/**
 * Cleaning one library shape's SVG into a drawing the board can show.
 *
 * SVG files from drawing tools carry a lot the board does not need (an XML
 * declaration, comments, editor metadata and namespaces, stylesheets) and a
 * few things it refuses (text, scripts, embedded pictures). Cleaning keeps
 * the drawing and drops the noise:
 *
 * - the XML declaration, doctype, comments, `<metadata>`, `<desc>`, titles
 *   and every element or attribute in a namespace other than SVG;
 * - `<style>` rules for classes, ids and element names, and `style="…"`
 *   attributes, become presentation attributes;
 * - the root gets the SVG namespace and a `viewBox` (from its width and
 *   height when it has none) and loses its own width and height;
 * - long decimals are rounded and ids nothing points at are dropped;
 * - the shape's name becomes the root's first `<title>`.
 *
 * What is left must pass the same vetting as any drawing on the board and
 * fit in {@link MAX_SHAPE_SVG_CHARS}; anything else is refused with a reason.
 * Refused parts are never stripped quietly: a shape that needs text or a
 * picture to make sense is left out rather than shown half drawn.
 *
 * Pure: no DOM, so it runs the same in the page, the server and tests.
 */

import { checkSvgSource, SVG_NAMESPACE } from '../image-source.ts';
import { unknownSvgParts, WHOLE_SVG_PART, SVG_ALLOWED_ATTRIBUTES, SVG_NONE_ONLY_ATTRIBUTES } from '../drawn-svg/vetting.ts';
import { parseXml, serializeXml, XLINK_NAMESPACE, XmlComment, XmlElement, XmlParseError, XmlText } from '../drawn-svg/xml.ts';

/** Longest cleaned SVG a library shape may have. */
export const MAX_SHAPE_SVG_CHARS = 16_000;
/** Longest SVG text read at all (anything longer is refused before parsing). */
export const MAX_SHAPE_SVG_INPUT_CHARS = 400_000;

/** A cleaned shape drawing. */
export interface CleanedShapeSvg {
  ok: true;
  svg: string;
  /** The viewBox size. */
  w: number;
  h: number;
}

/** A shape that could not be cleaned, and why (a phrase that follows "it …" in a sentence). */
export interface RefusedShapeSvg {
  ok: false;
  reason: string;
}

/** Presentation properties a declaration may set (the rest are dropped). */
const PRESENTATION_PROPERTIES: ReadonlySet<string> = new Set(
  [...SVG_ALLOWED_ATTRIBUTES, ...SVG_NONE_ONLY_ATTRIBUTES].filter(
    (name) =>
      !['id', 'class', 'role', 'xmlns', 'xmlns:xlink', 'version', 'viewBox', 'preserveAspectRatio', 'href', 'xlink:href', 'offset', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'd', 'points', 'transform'].includes(name) &&
      !['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'fx', 'fy'].includes(name),
  ),
);

/** Elements removed with everything inside them. */
const DROPPED_ELEMENTS: ReadonlySet<string> = new Set(['metadata', 'title', 'desc']);

/** Attributes removed wherever they are (they change nothing the board draws). */
const DROPPED_ATTRIBUTES: ReadonlySet<string> = new Set(['version', 'enable-background', 'xml:space', 'baseProfile', 'data-name', 'overflow', 'style', 'class']);

/** Attributes whose decimals may be rounded. */
const ROUNDED_ATTRIBUTES: ReadonlySet<string> = new Set(['d', 'points', 'viewBox', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'fx', 'fy', 'stroke-width']);

/* -------------------------------------------------------------------------- */
/* Stylesheets                                                                */
/* -------------------------------------------------------------------------- */

/** One simple selector: an element name and/or classes and/or an id. */
interface SimpleSelector {
  tag?: string;
  classes: string[];
  id?: string;
  /** CSS specificity as one comparable number. */
  weight: number;
}

/** One stylesheet rule split into simple selectors. */
interface StyleRule {
  selectors: SimpleSelector[];
  declarations: Array<[string, string]>;
  order: number;
}

const SIMPLE_SELECTOR_PATTERN = /^([A-Za-z][\w-]*|\*)?((?:\.[A-Za-z_-][\w-]*)*)(#[A-Za-z_-][\w-]*)?((?:\.[A-Za-z_-][\w-]*)*)$/;

/** The selector, or `undefined` when it is more than one simple selector. */
function parseSimpleSelector(text: string): SimpleSelector | undefined {
  const match = SIMPLE_SELECTOR_PATTERN.exec(text.trim());
  if (match === null || match[0] === '') return undefined;
  const classes = `${match[2] ?? ''}${match[4] ?? ''}`
    .split('.')
    .filter((name) => name !== '');
  const tag = match[1] !== undefined && match[1] !== '*' ? match[1] : undefined;
  const id = match[3]?.slice(1);
  return { ...(tag !== undefined ? { tag } : {}), classes, ...(id !== undefined ? { id } : {}), weight: (id !== undefined ? 10_000 : 0) + classes.length * 100 + (tag !== undefined ? 1 : 0) };
}

/** `prop: value; …` as pairs (lower-case names, `!important` dropped, empty values skipped). */
function parseDeclarations(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const part of text.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!\s*important\s*$/i, '')
      .trim()
      .replace(/^url\(\s*(["'])(#[^"']*)\1\s*\)$/i, 'url($2)');
    if (/^[a-z-]+$/.test(name) && value !== '') pairs.push([name, value]);
  }
  return pairs;
}

/**
 * The rules of a stylesheet whose selectors are all simple. Rules inside
 * at-rules (`@media`, `@font-face`, …) and rules with other selectors are
 * skipped.
 */
function parseStylesheet(css: string, firstOrder: number): StyleRule[] {
  const rules: StyleRule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let index = 0;
  let order = firstOrder;
  while (index < text.length) {
    const open = text.indexOf('{', index);
    if (open < 0) break;
    const prelude = text.slice(index, open).trim();
    if (prelude.startsWith('@')) {
      // Skip the whole at-rule block, nested braces included.
      let depth = 0;
      let at = open;
      for (; at < text.length; at++) {
        if (text[at] === '{') depth++;
        else if (text[at] === '}' && --depth === 0) break;
      }
      index = at + 1;
      continue;
    }
    const close = text.indexOf('}', open);
    if (close < 0) break;
    const selectors = prelude.split(',').map(parseSimpleSelector);
    if (selectors.length > 0 && selectors.every((selector) => selector !== undefined)) {
      rules.push({ selectors: selectors as SimpleSelector[], declarations: parseDeclarations(text.slice(open + 1, close)), order: order++ });
    }
    index = close + 1;
  }
  return rules;
}

function selectorMatches(selector: SimpleSelector, element: XmlElement): boolean {
  if (selector.tag !== undefined && selector.tag !== element.localName) return false;
  if (selector.id !== undefined && selector.id !== element.getAttribute('id')) return false;
  if (selector.classes.length === 0) return true;
  const classes = new Set((element.getAttribute('class') ?? '').split(/\s+/));
  return selector.classes.every((name) => classes.has(name));
}

/**
 * Applies stylesheet rules and `style` attributes to every element as
 * presentation attributes (stylesheet over attributes, by specificity then
 * order; `style` over both), keeping only presentation properties.
 */
function inlineStyles(root: XmlElement, rules: readonly StyleRule[]): void {
  for (const element of [root, ...root.descendants()]) {
    const matched: Array<{ weight: number; order: number; declarations: Array<[string, string]> }> = [];
    for (const rule of rules) {
      const weights = rule.selectors.filter((selector) => selectorMatches(selector, element)).map((selector) => selector.weight);
      if (weights.length > 0) matched.push({ weight: Math.max(...weights), order: rule.order, declarations: rule.declarations });
    }
    matched.sort((a, b) => a.weight - b.weight || a.order - b.order);
    const style = element.getAttribute('style');
    const declarations = [...matched.flatMap((rule) => rule.declarations), ...(style !== null ? parseDeclarations(style) : [])];
    for (const [name, value] of declarations) if (PRESENTATION_PROPERTIES.has(name)) element.setAttribute(name, value);
  }
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

/** A positive length from a `width`/`height` value (`px` or no unit), or `undefined`. */
function readLength(value: string | null): number | undefined {
  const match = value === null ? null : /^\s*(\d+(?:\.\d+)?|\.\d+)(?:px)?\s*$/.exec(value);
  const number = match === null ? NaN : Number(match[1]);
  return number > 0 && Number.isFinite(number) ? number : undefined;
}

/** A viewBox's four numbers, when the size is positive. */
export function readViewBox(value: string | null): [number, number, number, number] | undefined {
  if (value === null) return undefined;
  const numbers = value.trim().split(/[\s,]+/).map(Number);
  if (numbers.length !== 4 || !numbers.every(Number.isFinite)) return undefined;
  const [x, y, w, h] = numbers as [number, number, number, number];
  return w > 0 && h > 0 ? [x, y, w, h] : undefined;
}

/** `value` rounded to `decimals`, without a leading zero or trailing zeros. */
function formatRounded(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const text = Object.is(rounded, -0) ? '0' : String(rounded);
  return text.includes('e') ? '0' : text.replace(/^(-?)0\./, '$1.');
}

const DECIMAL_PATTERN = /-?\d*\.\d+(?:[eE][-+]?\d+)?/g;

/**
 * Rounds the decimals in an attribute value. Integers (and so arc flags) are
 * left as they are; a space is added where a rounded number would otherwise
 * run into its neighbor.
 */
function roundDecimals(value: string, decimals: number): string {
  let result = '';
  let last = 0;
  for (const match of value.matchAll(DECIMAL_PATTERN)) {
    const start = match.index;
    // A number that starts with a zero followed by a digit may be arc flags run together; keep it.
    if (/^-?0\d/.test(match[0])) continue;
    let text = formatRounded(Number(match[0]), decimals);
    result += value.slice(last, start);
    if (/[\d.]$/.test(result) && /^[\d.]/.test(text)) text = ' ' + text;
    const next = value[start + match[0].length];
    if (next !== undefined && /[.\d]/.test(next) && !text.includes('.')) text += ' ';
    result += text;
    last = start + match[0].length;
  }
  return result + value.slice(last);
}

/* -------------------------------------------------------------------------- */
/* Cleaning                                                                   */
/* -------------------------------------------------------------------------- */

function refuse(reason: string): RefusedShapeSvg {
  return { ok: false, reason };
}

/** True for an element in the SVG namespace (or in none, when the file never declared it). */
function isSvgElement(element: XmlElement): boolean {
  return element.prefix === undefined && (element.namespaceURI === SVG_NAMESPACE || element.namespaceURI === null);
}

/** Drops comments, foreign and dropped elements, and stray whitespace; returns the stylesheets' text. */
function pruneTree(element: XmlElement, styles: string[]): void {
  for (const node of [...element.childNodes]) {
    if (node instanceof XmlComment) node.remove();
    else if (node instanceof XmlText) {
      if (!['text', 'tspan', 'textPath', 'style'].includes(element.localName) && /^[ \t\r\n]*$/.test(node.data)) node.remove();
    } else if (!isSvgElement(node) || DROPPED_ELEMENTS.has(node.localName)) node.remove();
    else if (node.localName === 'style') {
      styles.push(node.textContent);
      node.remove();
    } else pruneTree(node, styles);
  }
}

/** Drops attributes from other namespaces and those that change nothing; `xlink:href` becomes `href`. */
function pruneAttributes(element: XmlElement): void {
  for (const attribute of [...element.attributes]) {
    if (attribute.namespaceURI === XLINK_NAMESPACE && attribute.localName === 'href') {
      element.removeAttribute(attribute.name);
      if (!element.hasAttribute('href')) element.setAttribute('href', attribute.value);
    } else if (attribute.name === 'xmlns' || attribute.prefix !== undefined || DROPPED_ATTRIBUTES.has(attribute.name)) {
      element.removeAttribute(attribute.name);
    }
  }
}

/** Ids something points at (`url(#id)` or `href="#id"`). */
function referencedIds(elements: readonly XmlElement[]): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    for (const attribute of element.attributes) {
      for (const match of attribute.value.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) ids.add(match[1]!);
      if (attribute.localName === 'href' && attribute.value.startsWith('#')) ids.add(attribute.value.slice(1));
    }
  }
  return ids;
}

/** Empty groups and definitions draw nothing. */
function dropEmptyContainers(element: XmlElement): void {
  for (const child of element.children) {
    dropEmptyContainers(child);
    if ((child.localName === 'g' || child.localName === 'defs') && child.childNodes.length === 0) child.remove();
  }
}

/**
 * Removes clip paths that clip nothing: a `<clipPath>` holding one plain
 * rectangle that covers the whole viewBox (as many design tools export
 * around every icon), with the `clip-path` attributes pointing at it.
 */
function dropWholeViewClips(root: XmlElement, viewBox: readonly [number, number, number, number]): void {
  const [vx, vy, vw, vh] = viewBox;
  const all = root.descendants();
  for (const clip of all) {
    if (clip.localName !== 'clipPath' || clip.hasAttribute('transform') || (clip.getAttribute('clipPathUnits') ?? 'userSpaceOnUse') !== 'userSpaceOnUse') continue;
    const [rect, ...rest] = clip.children;
    if (rect === undefined || rest.length > 0 || rect.localName !== 'rect' || rect.hasAttribute('transform')) continue;
    const number = (name: string, fallback: number): number => (rect.getAttribute(name) === null ? fallback : Number(rect.getAttribute(name)));
    const [x, y, w, h] = [number('x', 0), number('y', 0), number('width', NaN), number('height', NaN)];
    if (!(x <= vx && y <= vy && x + w >= vx + vw && y + h >= vy + vh)) continue;
    const id = clip.getAttribute('id');
    if (id === null) continue;
    for (const element of all) if (/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/.exec(element.getAttribute('clip-path') ?? '')?.[1] === id) element.removeAttribute('clip-path');
    clip.remove();
  }
}

/** A sentence part naming the refused parts of a drawing. */
function describeUnknownParts(parts: readonly string[]): string {
  if (parts.includes(WHOLE_SVG_PART)) return 'is not a drawing the board can read';
  const named = parts.slice(0, 4).join(', ');
  const hint = parts.includes('<text>') || parts.includes('<tspan>') ? ' (turn text into outlines first)' : '';
  return `uses ${named}${parts.length > 4 ? ` and ${parts.length - 4} more` : ''}, which drawings on a board cannot have${hint}`;
}

/**
 * Cleans one shape's SVG and names it `title`. Returns the cleaned drawing
 * and its viewBox size, or why it cannot be used.
 */
export function cleanShapeSvg(source: string, title: string): CleanedShapeSvg | RefusedShapeSvg {
  if (typeof source !== 'string' || source.trim() === '') return refuse('has no drawing');
  if (source.length > MAX_SHAPE_SVG_INPUT_CHARS) return refuse(`is too large to read (${Math.ceil(source.length / 1000)}k characters)`);
  const body = source
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[^>]*\?>/, '')
    .replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>/i, '')
    .trim();
  let root: XmlElement;
  try {
    root = parseXml(body);
  } catch (error) {
    if (error instanceof XmlParseError) return refuse('is not well-formed SVG');
    throw error;
  }
  if (root.localName !== 'svg' || root.prefix !== undefined || (root.namespaceURI !== SVG_NAMESPACE && root.namespaceURI !== null)) return refuse('is not an SVG drawing');

  const styles: string[] = [];
  pruneTree(root, styles);
  inlineStyles(root, styles.flatMap((css, index) => parseStylesheet(css, index * 1000)));
  for (const element of [root, ...root.descendants()]) pruneAttributes(element);

  // The root: namespace, viewBox, no fixed size.
  const viewBox = readViewBox(root.getAttribute('viewBox')) ?? ((w, h) => (w !== undefined && h !== undefined ? ([0, 0, w, h] as [number, number, number, number]) : undefined))(readLength(root.getAttribute('width')), readLength(root.getAttribute('height')));
  if (viewBox === undefined) return refuse('has no size (it needs a viewBox, or a width and height)');
  for (const name of ['width', 'height', 'x', 'y']) root.removeAttribute(name);
  const [, , boxW, boxH] = viewBox;
  dropWholeViewClips(root, viewBox);

  // Ids: keep only those something points at.
  const all = [root, ...root.descendants()];
  const referenced = referencedIds(all);
  for (const element of all) {
    const id = element.getAttribute('id');
    if (id !== null && !referenced.has(id)) element.removeAttribute('id');
  }

  // Decimals: rounded to about a sixteen-hundredth of the drawing, unless a transform scales it.
  const scaled = all.some((element) => /scale|matrix/i.test(`${element.getAttribute('transform') ?? ''} ${element.getAttribute('gradientTransform') ?? ''}`));
  const decimals = Math.min(6, Math.max(2, Math.ceil(Math.log10(1600 / Math.max(boxW, boxH)))));
  if (!scaled) {
    for (const element of all) {
      for (const attribute of element.attributes) {
        if (!ROUNDED_ATTRIBUTES.has(attribute.name) || element.localName === 'stop') continue;
        if (attribute.name === 'd' && /[aA]/.test(attribute.value)) continue;
        attribute.value = roundDecimals(attribute.value, decimals);
      }
    }
  }
  root.setAttribute('viewBox', viewBox.map((value) => roundDecimals(String(value), decimals).trim()).join(' '));
  dropEmptyContainers(root);

  // The name as the first child, then the namespace first among the root's attributes.
  const titleElement = new XmlElement('title', SVG_NAMESPACE);
  titleElement.appendChild(new XmlText(title));
  root.insertBefore(titleElement, root.childNodes[0] ?? null);
  const rootAttributes = root.attributes.splice(0, root.attributes.length);
  root.setAttribute('xmlns', SVG_NAMESPACE);
  root.attributes.push(...rootAttributes.filter((attribute) => attribute.name !== 'xmlns'));

  const svg = serializeXml(root);
  if (svg.length > MAX_SHAPE_SVG_CHARS) return refuse(`is too detailed (${svg.length.toLocaleString('en-US')} characters after cleaning; a shape has at most ${MAX_SHAPE_SVG_CHARS.toLocaleString('en-US')})`);
  const parts = unknownSvgParts(svg);
  if (parts.length > 0) return refuse(describeUnknownParts(parts));
  if (typeof checkSvgSource(svg) === 'string') return refuse('is not a drawing the board can read');
  return { ok: true, svg, w: boxW, h: boxH };
}
