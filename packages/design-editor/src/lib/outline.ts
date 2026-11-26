/**
 * The layers list: an artboard's template as named rows. Names follow the
 * element's role ("Heading", "Column", "Repeating group"…); the detail is
 * its label, a short text preview or its id/class/tag.
 */

import { attributeValue, elementChildren, elementPath, styleMap, type HtmlElement, type TemplateModel } from '@open-artifact/dc';
import type { Address, BoardOp } from './ops.ts';
import { loneShapeName, loneShapeOf } from './lone-shape.ts';

/** Glyph shown before a row's name. */
export type OutlineGlyph = 'column' | 'row' | 'grid' | 'text' | 'frame' | 'image' | 'shape' | 'component' | 'repeat' | 'conditional';

/** One row of the layers list. */
export interface OutlineNode {
  tid: number;
  path: number[];
  name: string;
  detail: string;
  glyph: OutlineGlyph;
  children: OutlineNode[];
}

/** Rendered layout of an element (from the board runtime), when known. */
export interface OutlineLayout {
  display: string;
  direction: string;
}

const HIDDEN = new Set(['helmet', 'style', 'script', 'template', 'meta', 'link', 'title', 'br']);

const TAG_NAMES: Record<string, string> = {
  section: 'Section',
  article: 'Article',
  header: 'Header',
  footer: 'Footer',
  nav: 'Navigation',
  aside: 'Aside',
  main: 'Main',
  form: 'Form',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  p: 'Paragraph',
  img: 'Image',
  picture: 'Image',
  video: 'Video',
  audio: 'Audio',
  svg: 'Graphic',
  canvas: 'Canvas',
  iframe: 'Embed',
  button: 'Button',
  input: 'Input',
  textarea: 'Text area',
  select: 'Select',
  figure: 'Figure',
  figcaption: 'Caption',
  blockquote: 'Quote',
  hr: 'Divider',
  a: 'Link',
  table: 'Table',
};

/** SVG shapes inside a graphic. */
const SHAPES: Record<string, string> = {
  rect: 'Rectangle',
  circle: 'Ellipse',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  polyline: 'Line',
  line: 'Line',
  path: 'Vector',
  g: 'Group',
};

const MEDIA = new Set(['img', 'picture', 'video', 'audio', 'svg', 'canvas', 'iframe']);

/** Direct text of an element (not its descendants'), collapsed. */
function ownText(element: HtmlElement): string {
  return element.children
    .filter((child) => child.type === 'text')
    .map((child) => (child as { value: string }).value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The selector-ish fallback detail: `#id`, `.class` or `<tag>`. */
export function selectorOf(element: HtmlElement): string {
  const id = attributeValue(element, 'id')?.trim();
  if (id) return `#${id}`;
  const cls = attributeValue(element, 'class')?.trim().split(/\s+/)[0];
  if (cls) return `.${cls}`;
  return `<${element.tag}>`;
}

/** Name and glyph of an element. */
export function describeElement(element: HtmlElement, layout?: OutlineLayout): { name: string; glyph: OutlineGlyph } {
  const tag = element.tag;
  if (tag === 'x-import' || tag === 'dc-import') return { name: 'Component', glyph: 'component' };
  if (tag === 'sc-if') return { name: 'Conditional group', glyph: 'conditional' };
  if (tag === 'sc-for') return { name: 'Repeating group', glyph: 'repeat' };
  const shape = SHAPES[tag];
  if (shape) return { name: shape, glyph: tag === 'g' ? 'frame' : 'shape' };
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return { name: 'Heading', glyph: 'text' };
  const kids = elementChildren(element).filter((child) => !HIDDEN.has(child.tag));
  const named = TAG_NAMES[tag];
  if (named) return { name: named, glyph: MEDIA.has(tag) ? 'image' : kids.length ? glyphOfLayout(element, layout) : ownText(element) ? 'text' : 'frame' };
  if (kids.length) {
    const glyph = glyphOfLayout(element, layout);
    return { name: glyph === 'column' ? 'Column' : glyph === 'row' ? 'Row' : glyph === 'grid' ? 'Grid' : 'Group', glyph };
  }
  if (ownText(element)) return { name: 'Text', glyph: 'text' };
  return { name: 'Group', glyph: 'frame' };
}

function glyphOfLayout(element: HtmlElement, layout?: OutlineLayout): OutlineGlyph {
  const inline = styleMap(attributeValue(element, 'style') ?? '');
  const display = layout?.display || inline.display || '';
  const direction = layout?.direction || inline['flex-direction'] || 'row';
  if (display.includes('grid')) return 'grid';
  if (display.includes('flex')) return direction.startsWith('column') ? 'column' : 'row';
  return 'frame';
}

/** The muted detail after a row's name. */
export function detailOf(element: HtmlElement): string {
  const label = attributeValue(element, 'data-label') ?? attributeValue(element, 'aria-label');
  if (label?.trim()) return cut(label.trim(), 28);
  if (element.tag === 'img') {
    const alt = attributeValue(element, 'alt')?.trim();
    if (alt) return cut(alt, 28);
  }
  if (element.tag === 'sc-for') {
    const each = attributeValue(element, 'each') ?? attributeValue(element, 'items');
    if (each) return cut(each, 28);
  }
  if (element.tag === 'sc-if') {
    const test = attributeValue(element, 'test') ?? attributeValue(element, 'when');
    if (test) return cut(test, 28);
  }
  const text = ownText(element);
  if (text) return `“${cut(text, 26)}”`;
  return cut(selectorOf(element), 28);
}

/** Builds the layers tree of a template. */
export function buildOutline(model: TemplateModel, layoutOf?: (tid: number) => OutlineLayout | undefined): OutlineNode[] {
  const build = (list: HtmlElement[]): OutlineNode[] =>
    list
      .filter((element) => !HIDDEN.has(element.tag))
      .map((element) => {
        const tid = model.tidOf.get(element)!;
        const shape = loneShapeOf(element);
        if (shape) return loneRow(model, element, shape);
        const { name, glyph } = describeElement(element, layoutOf?.(tid));
        return { tid, path: elementPath(model, element), name, detail: detailOf(element), glyph, children: build(elementChildren(element)) };
      });
  return build(elementChildren(model.nodes));
}

/** A graphic of one shape: one row, named for the shape, labelled by the graphic or else the shape. */
function loneRow(model: TemplateModel, svg: HtmlElement, shape: HtmlElement): OutlineNode {
  const own = (element: HtmlElement): string | undefined => (attributeValue(element, 'data-label') ?? attributeValue(element, 'aria-label'))?.trim() || undefined;
  const label = own(svg) ?? own(shape);
  return { tid: model.tidOf.get(svg)!, path: elementPath(model, svg), name: loneShapeName(svg, shape), detail: label ? cut(label, 28) : '', glyph: 'shape', children: [] };
}

/** The row an element shows in: a lone shape shows as its graphic. */
export function rowTidOf(model: TemplateModel, tid: number): number {
  const element = model.elements[tid];
  const parent = element?.parent;
  return parent && loneShapeOf(parent) === element ? model.tidOf.get(parent)! : tid;
}

/** Naming a one-shape graphic takes the name off its shape, so the row shows the new one. */
export function loneLabelOp(model: TemplateModel, tid: number): BoardOp | null {
  const svg = model.elements[tid];
  const shape = svg ? loneShapeOf(svg) : null;
  if (!shape || attributeValue(shape, 'data-label') === undefined) return null;
  return { kind: 'attr', target: addressOf(model, shape), name: 'data-label', value: null };
}

/** Tids of the ancestors of an element (by path), outermost first. */
export function ancestorTids(model: TemplateModel, path: readonly number[]): number[] {
  const out: number[] = [];
  let siblings = elementChildren(model.nodes);
  for (const index of path.slice(0, -1)) {
    const element = siblings[index];
    if (!element) break;
    out.push(model.tidOf.get(element)!);
    siblings = elementChildren(element);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Editing from the layers list                                                */
/* -------------------------------------------------------------------------- */

/** Where a dragged row lands, relative to the row it is dropped on. */
export type OutlineDrop = 'before' | 'after' | 'inside';

/** Elements that cannot hold children (void elements, media, component instances). */
const NO_CHILDREN = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'video', 'audio', 'iframe', 'canvas', 'textarea', 'select', 'x-import', 'dc-import', 'picture']);

/** Whether an element can take dropped children. */
export function acceptsChildren(element: HtmlElement): boolean {
  return !NO_CHILDREN.has(element.tag) && !HIDDEN.has(element.tag);
}

/** The address of an element in its model. */
const addressOf = (model: TemplateModel, element: HtmlElement): Address => ({ tid: model.tidOf.get(element)!, path: elementPath(model, element) });

/** Whether `inner` is `outer` or inside it. */
function within(inner: HtmlElement, outer: HtmlElement): boolean {
  for (let node: HtmlElement | null = inner; node; node = node.parent) if (node === outer) return true;
  return false;
}

/**
 * The move that drops the `dragged` elements (tids) `where` the `target`
 * element: before or after it among its siblings, or inside it as its last
 * child. `null` when the drop is not allowed: onto or into one of the
 * dragged elements, inside an element that holds no children, or a no-op.
 */
export function reorderOp(model: TemplateModel, dragged: readonly number[], target: number, where: OutlineDrop): BoardOp | null {
  const targetElement = model.elements[target];
  const moving = dragged.map((tid) => model.elements[tid]).filter((element): element is HtmlElement => Boolean(element));
  if (!targetElement || !moving.length || moving.length !== dragged.length) return null;
  if (moving.some((element) => within(targetElement, element))) return null;
  if (where === 'inside' && !acceptsChildren(targetElement)) return null;
  if (moving.length === 1 && where !== 'inside') {
    // Dropping right where it already is changes nothing.
    const element = moving[0]!;
    const siblings = element.parent ? elementChildren(element.parent) : elementChildren(model.nodes);
    const index = siblings.indexOf(element);
    if (index >= 0 && siblings[where === 'before' ? index + 1 : index - 1] === targetElement) return null;
  }
  // Document order keeps the moved elements in their order.
  const ordered = [...moving].sort((a, b) => model.tidOf.get(a)! - model.tidOf.get(b)!);
  return { kind: 'move', targets: ordered.map((element) => addressOf(model, element)), target: addressOf(model, targetElement), position: where === 'inside' ? 'last-child' : where };
}

/** The edit that names a layer (`data-label`; an empty name removes it). */
export function renameOp(model: TemplateModel, tid: number, name: string): BoardOp | null {
  const element = model.elements[tid];
  if (!element) return null;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80);
  const current = attributeValue(element, 'data-label') ?? null;
  if ((clean || null) === current) return null;
  return { kind: 'attr', target: addressOf(model, element), name: 'data-label', value: clean || null };
}

/** Where a hidden layer keeps the inline `display` it had. */
export const HIDDEN_DISPLAY_ATTRIBUTE = 'data-display';

/** Whether a layer is hidden from the layers list (inline `display: none`). */
export function isHiddenLayer(element: HtmlElement): boolean {
  return (styleMap(attributeValue(element, 'style') ?? '').display ?? '').trim() === 'none';
}

/**
 * The edits that hide or show a layer. Hiding writes `display: none`,
 * keeping a previous inline display in `data-display`; showing puts that
 * back (or removes `display`).
 */
export function visibilityOps(model: TemplateModel, tid: number): BoardOp[] {
  const element = model.elements[tid];
  if (!element) return [];
  const target = addressOf(model, element);
  const display = styleMap(attributeValue(element, 'style') ?? '').display?.trim();
  if (display === 'none') {
    const kept = attributeValue(element, HIDDEN_DISPLAY_ATTRIBUTE)?.trim() || null;
    const ops: BoardOp[] = [{ kind: 'style', targets: [target], patch: { display: kept } }];
    if (attributeValue(element, HIDDEN_DISPLAY_ATTRIBUTE) !== undefined) ops.push({ kind: 'attr', target, name: HIDDEN_DISPLAY_ATTRIBUTE, value: null });
    return ops;
  }
  const ops: BoardOp[] = [{ kind: 'style', targets: [target], patch: { display: 'none' } }];
  if (display) ops.push({ kind: 'attr', target, name: HIDDEN_DISPLAY_ATTRIBUTE, value: display });
  return ops;
}

/* -------------------------------------------------------------------------- */
/* Rows that follow their element                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where each element of `before` is in `after` (old tid → new tid), for
 * state kept per row (open or closed). The text both share at the start
 * and the end is unchanged: elements that begin there are the same
 * elements, shifted by the change in length when they come after it; an
 * element whose start tag holds the change keeps its place if its tag
 * does. Inside the changed text (a move spans from where an element was
 * to where it went), an element is matched by its text, first come first
 * served; one written differently has no match.
 */
export function carryTids(before: TemplateModel, after: TemplateModel): Map<number, number> {
  const a = before.text;
  const b = after.text;
  const limit = Math.min(a.length, b.length);
  let head = 0;
  while (head < limit && a.charCodeAt(head) === b.charCodeAt(head)) head++;
  // Back to the start of the tag the change is in: that tag may be another element now.
  if (head < limit) head = Math.max(0, a.lastIndexOf('<', head));
  let tail = 0;
  while (tail < limit - head && a.charCodeAt(a.length - 1 - tail) === b.charCodeAt(b.length - 1 - tail)) tail++;
  const shift = b.length - a.length;
  const byStart = new Map<number, HtmlElement>();
  for (const element of after.elements) byStart.set(element.start, element);
  const out = new Map<number, number>();
  const unmatched: [number, HtmlElement][] = [];
  before.elements.forEach((element, tid) => {
    // At the change itself only an element of the same tag is taken as the same (its start tag was edited).
    const start = element.start >= a.length - tail ? element.start + shift : element.start <= head ? element.start : -1;
    const match = start >= 0 ? byStart.get(start) : undefined;
    if (match && match.tag === element.tag) out.set(tid, after.tidOf.get(match)!);
    else unmatched.push([tid, element]);
  });
  // Inside the change (a move spans it), an element written the same way is the same element.
  const taken = new Set(out.values());
  const byText = new Map<string, number[]>();
  after.elements.forEach((element, tid) => {
    if (taken.has(tid)) return;
    const text = b.slice(element.start, element.end);
    byText.set(text, [...(byText.get(text) ?? []), tid]);
  });
  for (const [tid, element] of unmatched) {
    const same = byText.get(a.slice(element.start, element.end));
    const next = same?.shift();
    if (next !== undefined) out.set(tid, next);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Dropping after a row, at a shallower level                                  */
/* -------------------------------------------------------------------------- */

/** Containers a drop never climbs out of. */
const DROP_WALLS = new Set(['sc-if', 'sc-for', 'x-import', 'dc-import', 'td', 'th', 'caption', 'svg']);

/**
 * The rows a drop "after" `tid` may land after, nearest first: the row
 * itself, then — while each is the last child — its parent, grandparent…
 * up to `levels` steps. A drop pulled left of a last row this way ends up
 * after the container it closes.
 */
export function climbAfter(model: TemplateModel, tid: number, levels: number): number[] {
  const out = [tid];
  let element = model.elements[tid];
  for (let step = 0; element && step < levels; step++) {
    const parent = element.parent;
    if (!parent || DROP_WALLS.has(parent.tag)) break;
    const kids = elementChildren(parent).filter((child) => !HIDDEN.has(child.tag));
    if (kids[kids.length - 1] !== element) break;
    out.push(model.tidOf.get(parent)!);
    element = parent;
  }
  return out;
}

/** How many levels up a drop below a row goes, by how far left of the row's indent the pointer is. */
export function levelsLeft(indentStart: number, pointerX: number, indent: number): number {
  return Math.max(0, Math.ceil((indentStart - pointerX) / indent));
}
