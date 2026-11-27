/**
 * CSS outlines in captures. dom-to-svg draws an element's background and
 * border but not its `outline`, which sits outside the box and takes no room
 * in the layout. {@link drawOutlines} adds each one to the drawing as a
 * stroked `<rect>`, and {@link outlineReach} says how far one sticks out, so
 * the capture of a single element can grow to hold it.
 *
 * The geometry ({@link visibleOutline}, {@link outlineRect}) is pure and
 * loads in `node --test`.
 */

/** The computed style properties an outline is read from. */
export interface OutlineStyle {
  outlineStyle: string;
  outlineWidth: string;
  outlineOffset: string;
  outlineColor: string;
  visibility: string;
  opacity: string;
  borderTopLeftRadius: string;
}

/** An outline that draws something. */
export interface VisibleOutline {
  /** Line width, px. */
  width: number;
  /** Gap between the border box and the line's inner edge, px (negative: inside the box). */
  offset: number;
  color: string;
  dash: 'solid' | 'dashed' | 'dotted';
}

/** A box in the drawing's coordinates. */
export interface OutlineBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const px = (value: string): number => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
};

const clear = (color: string): boolean => {
  const value = color.trim().toLowerCase();
  if (!value || value === 'transparent') return true;
  // Only a fourth value is alpha: `rgb(255, 0, 0)` ends in a 0 that is its blue.
  const alpha = /^rgba?\((?:[^,)]*,){3}\s*([\d.]+)(%?)\s*\)$/.exec(value) ?? /^rgba?\([^)]*\/\s*([\d.]+)(%?)\s*\)$/.exec(value);
  return alpha !== null && Number.parseFloat(alpha[1]!) === 0;
};

/** The outline a computed style draws, or null when it draws none (no style, `auto`, no width, no colour, hidden). */
export function visibleOutline(style: OutlineStyle): VisibleOutline | null {
  const kind = style.outlineStyle.trim().toLowerCase();
  if (!kind || kind === 'none' || kind === 'auto' || kind === 'hidden') return null;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return null;
  const width = px(style.outlineWidth);
  if (!(width > 0) || clear(style.outlineColor)) return null;
  const dash = kind === 'dashed' || kind === 'dotted' ? kind : 'solid';
  return { width, offset: px(style.outlineOffset), color: style.outlineColor, dash };
}

/** How far past the border box an outline reaches on each side, px. */
export const outlineReach = (outline: VisibleOutline | null): number => (outline ? Math.max(0, outline.width + outline.offset) : 0);

/** One corner radius length (`12px`, `50%`) taken against a side, at most half of it. */
function cornerLength(value: string | undefined, side: number): number {
  if (!value) return 0;
  const length = value.endsWith('%') ? (px(value) / 100) * side : px(value);
  return Math.min(Math.max(length, 0), side / 2);
}

/**
 * The attributes of a `<rect>` that strokes `outline` around `box`: the
 * stroke is centred on the rect's edge, so the rect is the border box grown
 * by the offset and half the width. Its corners follow the box's top left
 * radius, grown as much. Null when the rect would have no area.
 */
export function outlineRect(box: OutlineBox, outline: VisibleOutline, style: Pick<OutlineStyle, 'borderTopLeftRadius' | 'opacity'>): Record<string, string> | null {
  const grow = outline.offset + outline.width / 2;
  const width = box.width + grow * 2;
  const height = box.height + grow * 2;
  if (!(width > 0 && height > 0) || !(box.width > 0 && box.height > 0)) return null;
  const round = (value: number): string => String(Math.round(value * 100) / 100);
  const attributes: Record<string, string> = {
    x: round(box.x - grow),
    y: round(box.y - grow),
    width: round(width),
    height: round(height),
    fill: 'none',
    stroke: outline.color,
    'stroke-width': round(outline.width),
  };
  const [horizontal, vertical = horizontal] = style.borderTopLeftRadius.trim().split(/\s+/);
  const rx = cornerLength(horizontal, box.width);
  const ry = cornerLength(vertical, box.height);
  if (rx > 0 && ry > 0 && rx + grow > 0 && ry + grow > 0) {
    attributes.rx = round(rx + grow);
    attributes.ry = round(ry + grow);
  }
  if (outline.dash === 'dashed') attributes['stroke-dasharray'] = `${round(outline.width * 2)} ${round(outline.width)}`;
  if (outline.dash === 'dotted') {
    attributes['stroke-dasharray'] = `0 ${round(outline.width * 2)}`;
    attributes['stroke-linecap'] = 'round';
  }
  const opacity = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity < 1) attributes.opacity = String(opacity);
  return attributes;
}

/** The outline an element draws (none for a zero-sized one). */
export function elementOutline(element: Element): VisibleOutline | null {
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return visibleOutline(element.ownerDocument.defaultView!.getComputedStyle(element));
}

/** An element under capture that draws an outline, and the name its group gets in dom-to-svg's drawing. */
interface Outlined {
  element: Element;
  id: string;
  /** The id was lent for the capture and is taken back after it. */
  lent: boolean;
  outline: VisibleOutline;
  box: OutlineBox;
  style: Pick<OutlineStyle, 'borderTopLeftRadius' | 'opacity'>;
}

const LENT_ID = 'oa-capture-outline-';
const SVG = 'http://www.w3.org/2000/svg';

/**
 * Finds the elements under `root` (itself included, shapes inside an `<svg>`
 * left out) that draw an outline, and gives each one without an id a
 * temporary one: dom-to-svg names an element's group by its id, which is how
 * the outline finds its place in the drawing. Call `release` when the
 * drawing is made; it takes the lent ids back.
 */
export function markOutlines(root: Element): { outlined: Outlined[]; release: () => void } {
  const doc = root.ownerDocument;
  const view = doc.defaultView!;
  const outlined: Outlined[] = [];
  let next = 0;
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (element.parentElement?.closest('svg')) continue;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) continue;
    const style = view.getComputedStyle(element);
    const outline = visibleOutline(style);
    if (!outline) continue;
    let id = element.id;
    const lent = !id;
    if (lent) {
      do id = `${LENT_ID}${next++}`;
      while (doc.getElementById(id));
      element.id = id;
    }
    outlined.push({
      element,
      id,
      lent,
      outline,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      style: { borderTopLeftRadius: style.borderTopLeftRadius, opacity: style.opacity },
    });
  }
  return {
    outlined,
    release: () => {
      for (const mark of outlined) if (mark.lent && mark.element.id === mark.id) mark.element.removeAttribute('id');
    },
  };
}

/** Draws each outline right after its element's group in an SVG drawing made while they were marked. */
export function drawOutlines(svg: Element, outlined: readonly Outlined[]): void {
  const groups = new Map<string, Element>();
  for (const group of Array.from(svg.querySelectorAll('[id]'))) if (!groups.has(group.id)) groups.set(group.id, group);
  for (const mark of outlined) {
    const group = groups.get(mark.id);
    const attributes = outlineRect(mark.box, mark.outline, mark.style);
    if (!group || !attributes) continue;
    const rect = svg.ownerDocument.createElementNS(SVG, 'rect');
    for (const [name, value] of Object.entries(attributes)) rect.setAttribute(name, value);
    group.after(rect);
    if (mark.lent) group.removeAttribute('id');
  }
}
