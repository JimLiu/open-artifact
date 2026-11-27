/**
 * Where a rendered page's content ends: the lowest thing a reader would see
 * (text, a picture, a control, a rule, an outline, a filled box that stands
 * out from what is behind it). Below it the page is blank, however tall its
 * frame or its `min-height: 100vh` wrappers are.
 *
 * The test of one element ({@link countsAsContent}) is pure and loads in
 * `node --test`; {@link contentBottom} walks a rendered document with it.
 */

import { documentHeight } from './document-measure.ts';
import { outlineReach, visibleOutline } from './outline.ts';

/** Elements that are content by themselves, empty or not. */
const CONTENT_TAGS = new Set(['img', 'svg', 'canvas', 'video', 'picture', 'input', 'button', 'textarea', 'select', 'iframe', 'hr', 'object', 'embed']);

/** Past this many elements the walk gives up and takes the document's height. */
export const MAX_MEASURED_ELEMENTS = 20000;

/** Least height of a filled box that counts by its fill alone. */
export const MIN_FILLED_HEIGHT = 40;

/** Least difference from what is behind (red + green + blue, 0–765) for a fill to count. */
export const MIN_FILL_CONTRAST = 24;

/** An RGB colour, 0–255 each, with its alpha 0–1. */
export type Rgba = readonly [number, number, number, number];

/** A CSS colour as the browser computes it (`rgb(…)`, `rgba(…)`, `transparent`); `null` when it can't be read. */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return [0, 0, 0, 0];
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (!match) return null;
  const alphaText = match[4];
  const alpha = alphaText === undefined ? 1 : alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
  return [Number(match[1]), Number(match[2]), Number(match[3]), Math.max(0, Math.min(1, alpha))];
}

/** `fill` painted over the opaque colour `behind`. */
export function paintOver(fill: Rgba, behind: Rgba): Rgba {
  const a = fill[3];
  return [fill[0] * a + behind[0] * (1 - a), fill[1] * a + behind[1] * (1 - a), fill[2] * a + behind[2] * (1 - a), 1];
}

/** How far apart two opaque colours are: the sum of their red, green and blue differences. */
export const colorDistance = (a: Rgba, b: Rgba): number => [0, 1, 2].reduce((sum, channel) => sum + Math.abs(a[channel]! - b[channel]!), 0);

/** What decides whether an element is content, read from its computed style. */
export interface ElementLook {
  /** Lower-case tag name. */
  tag: string;
  backgroundImage: string;
  borderBottomStyle: string;
  borderBottomWidth: number;
  /** Whether it draws an outline (outline.ts's `visibleOutline`). */
  outline: boolean;
  /** Whether it holds text of its own that isn't only white space. */
  ownText: boolean;
  height: number;
  /** Its background colour. */
  fill: Rgba | null;
  /** The opaque colour behind it. */
  behind: Rgba;
}

/** Whether a reader would see this element itself (not its children). */
export function countsAsContent(look: ElementLook): boolean {
  if (CONTENT_TAGS.has(look.tag)) return true;
  if (look.ownText) return true;
  if (look.backgroundImage !== '' && look.backgroundImage !== 'none') return true;
  if (look.borderBottomStyle !== 'none' && look.borderBottomStyle !== 'hidden' && look.borderBottomWidth > 0) return true;
  if (look.outline) return true;
  if (look.height >= MIN_FILLED_HEIGHT && look.fill && look.fill[3] > 0) return colorDistance(paintOver(look.fill, look.behind), look.behind) > MIN_FILL_CONTRAST;
  return false;
}

const WHITE: Rgba = [255, 255, 255, 1];

/**
 * How far down the rendered document's content reaches, in document px (the
 * frame is never scrolled, so client rects are document coordinates). A page
 * that clips its own overflow (`overflow: hidden` or `clip` on the root or
 * body) is as tall as its viewport; a very large one is as tall as its
 * document.
 */
export function contentBottom(doc: Document): number {
  const view = doc.defaultView!;
  const root = doc.documentElement;
  const body = doc.body;
  const style = (element: Element): CSSStyleDeclaration => view.getComputedStyle(element);
  const clips = (element: Element | null): boolean => element !== null && /^(hidden|clip)$/.test(style(element).overflowY);
  if (clips(root) || clips(body)) return root.clientHeight || view.innerHeight;
  if (root.getElementsByTagName('*').length > MAX_MEASURED_ELEMENTS) return documentHeight(doc);

  const height = documentHeight(doc);
  const page = [body, root].map((element) => (element ? parseColor(style(element).backgroundColor) : null)).find((color) => color && color[3] > 0);
  const range = doc.createRange();
  let bottom = 0;

  const textBottom = (element: Element): number => {
    let lowest = 0;
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !node.nodeValue?.trim()) continue;
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) lowest = Math.max(lowest, rect.bottom);
    }
    return lowest;
  };

  const visit = (element: Element, behind: Rgba): void => {
    const css = style(element);
    if (css.display === 'none' || css.position === 'fixed' || parseFloat(css.opacity) === 0) return;
    const rect = element.getBoundingClientRect();
    const fill = parseColor(css.backgroundColor);
    const tag = element.localName.toLowerCase();
    // A wrapper as tall as the whole document (`min-height: 100vh`) is the page, not content on it.
    const wrapper = rect.top <= 1 && rect.bottom >= height - 1;
    if (css.visibility !== 'hidden') {
      const outline = visibleOutline(css);
      // Text counts by the lines it draws, wherever it sits.
      bottom = Math.max(bottom, textBottom(element));
      const look: ElementLook = {
        tag,
        backgroundImage: css.backgroundImage,
        borderBottomStyle: css.borderBottomStyle,
        borderBottomWidth: parseFloat(css.borderBottomWidth) || 0,
        outline: outline !== null,
        ownText: false,
        height: rect.height,
        fill,
        behind,
      };
      // A wrapper's fill, border and outline frame the page; a picture it shows is still content.
      if (rect.width > 0 && rect.height > 0 && countsAsContent(wrapper ? { ...look, fill: null, borderBottomWidth: 0, outline: false } : look)) {
        bottom = Math.max(bottom, rect.bottom + (wrapper ? 0 : outlineReach(outline)));
      }
    }
    // What is inside a picture or a control is part of it.
    if (CONTENT_TAGS.has(tag)) return;
    const next = fill && fill[3] > 0 ? paintOver(fill, behind) : behind;
    for (const child of element.children) visit(child, next);
  };

  const start = body ?? root;
  const base = page ? paintOver(page, WHITE) : WHITE;
  bottom = textBottom(start);
  for (const child of start.children) visit(child, base);
  return Math.ceil(bottom);
}
