/**
 * Measuring a rendered document for a PDF: the words drawn (for the
 * invisible, selectable text layer), the web links, the spans a page cut
 * must not fall inside, the blocks kept with their neighbours, and the
 * places a page is told to break. The pure parts live in text-layer.ts
 * (line grouping), pdf-text.ts and pagination.ts.
 *
 * Every measure is in document px: the measured frame is never scrolled, so
 * client rects are document coordinates.
 */

import { isDrawn, measureLinks, measureWords } from './measure.ts';
import { MAX_UNSPLIT_PICTURE, type Interval, type KeepBlock } from './pagination.ts';
import type { LinkArea, Word } from './text-layer.ts';

const styleOf = (element: Element): CSSStyleDeclaration => element.ownerDocument.defaultView!.getComputedStyle(element);

/** Is this element (and every ancestor) drawn? */
const drawn = (element: Element, cache: Map<Element, boolean>): boolean => isDrawn(element, null, cache);

/** The words drawn in the document, in reading (document) order. */
export function documentWords(doc: Document): Word[] {
  return measureWords(doc.body ?? doc.documentElement, {
    origin: 'client',
    drawnWithin: null,
    skip: /^(script|style|template|noscript|textarea|title)$/i,
    brokenWord: 'extent',
  });
}

/** The clickable boxes of web links that are drawn. */
export function documentLinks(doc: Document): LinkArea[] {
  return measureLinks(doc.documentElement, { origin: 'client', drawnWithin: null, drawnOnly: true });
}

/** The paper colour: the body's background, else the root's, else white. */
export function documentBackground(doc: Document): string {
  for (const element of [doc.body, doc.documentElement]) {
    if (!element) continue;
    const color = styleOf(element).backgroundColor;
    if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return '#ffffff';
}

const PICTURES = 'img, svg, video, canvas, picture, iframe, object, embed';

/**
 * Spans a page cut must not fall inside: each drawn text line, and each
 * picture up to {@link MAX_UNSPLIT_PICTURE} px tall (taller ones are cut
 * where the page ends).
 */
export function documentBands(doc: Document): Interval[] {
  const root = doc.body ?? doc.documentElement;
  const bands: Interval[] = [];
  const shown = new Map<Element, boolean>();
  const range = doc.createRange();
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || /^(script|style|template|noscript|title)$/i.test(parent.localName) || !drawn(parent, shown)) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) if (rect.height > 0 && rect.width > 0) bands.push([rect.top, rect.bottom]);
  }
  for (const picture of root.querySelectorAll(PICTURES)) {
    // An svg inside another picture is part of it.
    if (picture.parentElement?.closest('svg, picture')) continue;
    if (!drawn(picture, shown)) continue;
    const rect = picture.getBoundingClientRect();
    if (rect.height > 0 && rect.height <= MAX_UNSPLIT_PICTURE) bands.push([rect.top, rect.bottom]);
  }
  return bands;
}

/** Boxes the page draws around things: a border above and below, a shadow, or a fill of its own. */
function boxed(style: CSSStyleDeclaration): boolean {
  if (style.boxShadow !== '' && style.boxShadow !== 'none') return true;
  const side = (name: 'Top' | 'Bottom'): boolean => style[`border${name}Style`] !== 'none' && parseFloat(style[`border${name}Width`]) > 0;
  if (side('Top') && side('Bottom')) return true;
  const fill = style.backgroundColor;
  return fill !== '' && fill !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(fill);
}

/**
 * Boxes a page cut should not fall inside, as a printer keeps them: what the page asks to keep whole
 * (`break-inside: avoid`), and the boxes it draws (a card: bordered, shadowed or filled) up to `maxBoxHeight` px
 * tall. A taller card is cut between its lines like the rest of the page.
 */
export function documentBoxes(doc: Document, maxBoxHeight: number): Interval[] {
  const root = doc.body ?? doc.documentElement;
  const shown = new Map<Element, boolean>();
  const boxes: Interval[] = [];
  for (const element of root.querySelectorAll('*')) {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
    const style = styleOf(element);
    if (style.display === 'none' || style.display === 'contents' || style.display === 'inline') continue;
    const asked = style.breakInside === 'avoid' || style.breakInside === 'avoid-page' || style.getPropertyValue('page-break-inside') === 'avoid';
    if (!asked && !boxed(style)) continue;
    const rect = element.getBoundingClientRect();
    if (!(rect.height >= 8 && rect.width >= 8) || (!asked && rect.height > maxBoxHeight)) continue;
    if (!drawn(element, shown)) continue;
    boxes.push([rect.top, rect.bottom]);
  }
  return boxes;
}

/** Headings, captions and header rows, with the run each is kept with (see pagination.ts). */
export function documentKeepBlocks(doc: Document): KeepBlock[] {
  const root = doc.body ?? doc.documentElement;
  const range = doc.createRange();
  const blocks: KeepBlock[] = [];
  const inFlow = (element: Element): boolean => {
    const style = styleOf(element);
    return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed';
  };
  const measure = (element: Element): DOMRect | null => {
    if (!inFlow(element)) return null;
    const visible = typeof (element as HTMLElement).checkVisibility !== 'function' || (element as HTMLElement).checkVisibility({ visibilityProperty: true, opacityProperty: true });
    if (!visible) return null;
    const rect = element.getBoundingClientRect();
    return rect.height >= 8 && rect.width >= 8 ? rect : null;
  };
  const previousMeasured = (element: Element): { element: Element; rect: DOMRect } | null => {
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      const rect = measure(sibling);
      if (rect) return { element: sibling, rect };
    }
    return null;
  };
  const ancestorsInFlow = (element: Element): boolean => {
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) if (!inFlow(parent)) return false;
    return true;
  };

  for (const element of root.querySelectorAll('h1,h2,h3,h4,h5,h6,hgroup,[role=heading],caption,thead,tr:first-child,figcaption')) {
    const tag = element.localName;
    if (tag === 'tr') {
      // Only a header row (all th) that is the table's first row and not in a thead/tfoot.
      const table = element.closest('table');
      const section = element.parentElement?.localName ?? '';
      if (!table || table.querySelector('tr') !== element || section === 'thead' || section === 'tfoot' || !element.querySelector('th') || element.querySelector('td')) continue;
    }
    const rect = measure(element);
    if (!rect || !ancestorsInFlow(element)) continue;
    const style = styleOf(element);
    let next = false;
    let prev = false;
    let fromTop = rect.top;
    if (tag === 'caption' && style.captionSide === 'bottom') {
      prev = true;
      const rows = element.parentElement?.localName === 'table' ? (element.parentElement as HTMLTableElement).rows : null;
      for (let i = rows ? rows.length - 1 : -1; i >= 0; i--) {
        const row = rows![i]!.getBoundingClientRect();
        if (row.height > 0) {
          fromTop = row.top;
          break;
        }
      }
    } else if (tag === 'figcaption' && previousMeasured(element)) {
      prev = true;
      fromTop = previousMeasured(element)!.rect.top;
    } else next = true;

    const pullsLeadIn = next && tag !== 'caption' && tag !== 'thead' && tag !== 'tr' && tag !== 'figcaption';
    range.selectNodeContents(element);
    const content = range.getBoundingClientRect();
    const inset = (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    const top = rect.top;
    const bottom = content.height > 0 ? Math.max(Math.min(rect.bottom, content.bottom + inset), Math.min(top + 1, rect.bottom)) : rect.bottom;
    if (!(bottom > top)) continue;
    if (pullsLeadIn) {
      const leadInGap = 2 * (parseFloat(style.fontSize) || 0) || 48;
      let anchor: Element = element;
      let anchorTop = rect.top;
      let pulled = 0;
      for (let level = 0; level < 3; level++) {
        for (let sibling = previousMeasured(anchor); sibling && pulled < 2; sibling = previousMeasured(anchor)) {
          const gap = anchorTop - sibling.rect.bottom;
          if (gap < -0.5 || gap > leadInGap || sibling.rect.height > 48 || !(sibling.rect.left < rect.right && sibling.rect.right > rect.left)) break;
          const before = previousMeasured(sibling.element);
          if (before && !(sibling.rect.top - before.rect.bottom > gap)) break;
          anchor = sibling.element;
          anchorTop = sibling.rect.top;
          fromTop = Math.min(fromTop, sibling.rect.top);
          pulled += 1;
        }
        const parent = anchor.parentElement;
        if (!parent || parent === root || previousMeasured(anchor)) break;
        const parentRect = measure(parent);
        if (!parentRect || anchorTop - parentRect.top > 48 || parentRect.top > anchorTop + 0.5) break;
        anchor = parent;
        anchorTop = parentRect.top;
        fromTop = Math.min(fromTop, parentRect.top);
      }
    }
    blocks.push({ top, bottom, from: Math.min(fromTop, top), next, prev });
  }
  return blocks;
}

/** The full height of the document's content. */
export function documentHeight(doc: Document): number {
  return Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
}

/** `break-before` values that start a new page (the legacy `page-break-before: always` computes to `page`). */
const PAGE_BREAKS = new Set(['page', 'always', 'left', 'right', 'recto', 'verso']);

/** Tops of the drawn elements that ask for a new page before them (`break-before: page`), in document px. */
export function documentPageBreaks(doc: Document): number[] {
  const root = doc.body ?? doc.documentElement;
  const shown = new Map<Element, boolean>();
  const tops: number[] = [];
  for (const element of root.querySelectorAll('*')) {
    const style = styleOf(element);
    if (!PAGE_BREAKS.has(style.breakBefore) && style.getPropertyValue('page-break-before') !== 'always') continue;
    if (!drawn(element, shown)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height > 0 || rect.width > 0) tops.push(rect.top);
  }
  return tops;
}
