/**
 * Border alignment: a border drawn inside the box (a plain CSS border),
 * centred on its edge, or outside it. Center and Outside draw the border
 * with an outline, written one of two ways:
 *
 * - With its space: the border stays as transparent space, so nothing
 *   inside moves. A side something painted touches from inside (pinned)
 *   gives its space to the opposite side, so no gap shows there:
 *     border-color: transparent; border-<side>-width…; background-origin: border-box;
 *     outline-width/style/color; outline-offset
 * - Without it, when every side is fixed (pinned, or the box keeps its
 *   size: replaced elements, empty fixed-size border-box boxes,
 *   backgrounds clipped to the padding or content box): the inline border
 *   goes, and `border-style: none` only where a border would show without
 *   it.
 *
 * A content-box size in px grows by the border space it lost; a box placed
 * with px offsets on a frameless artboard moves so its outer edge stays.
 * Inside again is read from the inline style alone. Outline parts the
 * classes already give are not written. A focusable element gets a focus
 * ring of its own (`style-focus-visible`), since the outline covers the
 * browser's.
 */

import { attributeValue, parseStyle, styleMap, type BoxSides, type HtmlElement, type StylePatch } from '@open-artifact/dc';

export type BorderAlignment = 'inside' | 'center' | 'outside';

/** Clicking the alignment button steps through these. */
export const ALIGNMENTS: readonly BorderAlignment[] = ['inside', 'center', 'outside'];

/** The alignment after `current`. */
export const nextAlignment = (current: BorderAlignment): BorderAlignment => ALIGNMENTS[(ALIGNMENTS.indexOf(current) + 1) % ALIGNMENTS.length]!;

/** Button names and announcements: "Border alignment: Center". */
export const alignmentName = (alignment: BorderAlignment): string => `Border alignment: ${alignment[0]!.toUpperCase()}${alignment.slice(1)}`;

/** Why the alignment can't change, when it can't. */
export const ALIGN_REFUSALS = {
  color: 'To align the border, first give it a color',
  sides: 'To align the border, first make it the same on all four sides',
  outline: 'To align the border, first remove this element’s outline',
  code: 'This border is set in code, so it can’t be aligned here',
} as const;

/** Each side's width is set only on a border aligned inside. */
export const SIDES_NEED_INSIDE = 'To set each side, first align the border inside';

/** The attribute holding the focus ring an aligned border gives a focusable element. */
export const FOCUS_STYLE_ATTRIBUTE = 'style-focus-visible';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];
const OPPOSITE: Record<Side, Side> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
const STYLES = /^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/;
const NAMED_WIDTHS: Record<string, string> = { thin: '1px', medium: '3px', thick: '5px' };
/** Form controls draw a border of their own. */
const FORM_CONTROLS = new Set(['button', 'input', 'select', 'textarea']);
/** Elements that take keyboard focus (with `a[href]` and `[tabindex]`). */
const FOCUSABLE = new Set(['button', 'input', 'select', 'textarea', 'summary']);

/** What aligning depends on, measured in the artboard; a missing part counts as nothing. */
export interface AlignContext {
  /** Sides something painted touches from inside. */
  pinned?: BoxSides<boolean>;
  /** The classes draw a border without the inline style. */
  classBorder?: boolean;
  /** The outline the classes give. */
  classOutline?: Partial<{ width: string; style: string; color: string; offset: string }>;
  /** The stylesheets already style the element's keyboard focus. */
  focusStyled?: boolean;
  /** The element is placed with inline `position: absolute` on a frameless artboard, outside a repeated or conditional group. */
  placed?: boolean;
}

/** An alignment's edit: the inline style patch, and the focus ring to write (`null`: remove it; absent: leave it). */
export interface AlignEdit {
  style: StylePatch;
  focus?: string | null;
}

/** A border's three parts. */
export interface BorderLook {
  width: string;
  style: string;
  color: string;
}

/** The width, style and colour written in a `border` shorthand. */
export function splitShorthand(value: string | undefined): Partial<BorderLook> {
  const out: Partial<BorderLook> = {};
  const rest: string[] = [];
  for (const token of (value ?? '').trim().split(/\s+(?![^(]*\))/).filter(Boolean)) {
    if (STYLES.test(token)) out.style = token;
    else if (/^(\d*\.?\d+[a-z%]*|thin|medium|thick)$/i.test(token)) out.width = NAMED_WIDTHS[token] ?? token;
    else rest.push(token);
  }
  if (rest.length) out.color = rest.join(' ');
  return out;
}

const fourOf = (value: string | undefined): string[] | null => {
  if (!value?.trim()) return null;
  const [a, b = a, c = a, d = b] = value.trim().split(/\s+(?![^(]*\))/);
  return [a!, b!, c!, d!];
};

/** Each side's width, style and color as written inline (missing parts from `computed`, top side). */
function sidesOf(inline: Record<string, string>, computed: Record<string, string>): BorderLook[] {
  const short = splitShorthand(inline.border);
  const widths = fourOf(inline['border-width']);
  const styles = fourOf(inline['border-style']);
  const colors = fourOf(inline['border-color']);
  return SIDES.map((side, i) => {
    const own = splitShorthand(inline[`border-${side}`]);
    return {
      width: inline[`border-${side}-width`] ?? own.width ?? widths?.[i] ?? short.width ?? computed[`border-${side}-width`] ?? computed['border-top-width'] ?? '',
      style: inline[`border-${side}-style`] ?? own.style ?? styles?.[i] ?? short.style ?? computed['border-top-style'] ?? '',
      color: inline[`border-${side}-color`] ?? own.color ?? colors?.[i] ?? short.color ?? computed['border-top-color'] ?? '',
    };
  });
}

const px = (width: string): number | null => {
  const match = /^(-?\d*\.?\d+)(px)?$/.exec((NAMED_WIDTHS[width.trim()] ?? width).trim());
  return match ? Number(match[1]) : null;
};
const isClear = (color: string): boolean => !color.trim() || /^(transparent|none)$/i.test(color.trim()) || /rgba\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);
const drawn = (style: string): boolean => Boolean(style) && style !== 'none' && style !== 'hidden';

/** The offset that puts an outline of `width` at `alignment`. */
export function offsetFor(alignment: Exclude<BorderAlignment, 'inside'>, width: string): string {
  if (alignment === 'outside') return '0px';
  const value = px(width);
  return value === null ? `calc(${width} / -2)` : `${-value / 2}px`;
}

/** How an aligned border is written: over its kept (transparent) space, or with the border gone. */
export type AlignMode = 'kept' | 'free';

const OUTLINE = ['outline-width', 'outline-style', 'outline-color', 'outline-offset'] as const;
/** Every inline border declaration. */
const BORDER_PARTS = ['border', 'border-width', 'border-style', 'border-color', ...SIDES.flatMap((side) => [`border-${side}`, `border-${side}-width`, `border-${side}-style`, `border-${side}-color`])];

/** Whether the inline style draws a border of its own (a width, style or color other than none). */
const writesBorder = (inline: Record<string, string>): boolean =>
  BORDER_PARTS.some((property) => inline[property] !== undefined && !(/-style$/.test(property) && /^(none|hidden)$/.test(inline[property]!.trim())) && !(property === 'border' && /^(none|0)$/.test(inline[property]!.trim())));

const isOutside = (offset: string): boolean => /^(0|0px|-?0\.?0*px)$/.test(offset.trim()) || offset.trim() === '';

/**
 * The border an outline stands for, and where, when the element's border
 * is aligned; read from the inline style (outline parts the classes give
 * from `computed`).
 */
export function readAlignment(inline: Record<string, string>, computed: Record<string, string> = {}): { alignment: BorderAlignment; look: BorderLook | null; mode: AlignMode } {
  const inside = { alignment: 'inside' as const, look: null, mode: 'kept' as const };
  if (!OUTLINE.slice(0, 3).some((property) => inline[property] !== undefined)) return inside;
  const look = { width: inline['outline-width'] ?? computed['outline-width'] ?? '', style: inline['outline-style'] ?? computed['outline-style'] ?? '', color: inline['outline-color'] ?? computed['outline-color'] ?? '' };
  if (!look.width || !drawn(look.style)) return inside;
  const offset = (inline['outline-offset'] ?? computed['outline-offset'] ?? '0px').trim();
  const borderColor = inline['border-color'] ?? splitShorthand(inline.border).color;
  let mode: AlignMode;
  if (borderColor !== undefined && isClear(borderColor) && writesBorder(inline)) mode = 'kept';
  else if (!writesBorder(inline)) mode = 'free';
  else return inside;
  if (isOutside(offset) || offset === offsetFor('outside', look.width)) return { alignment: 'outside', look, mode };
  if (offset === offsetFor('center', look.width)) return { alignment: 'center', look, mode };
  return inside;
}

/** Elements that paint their content inside the border (kept space would show). */
const REPLACED = new Set(['img', 'video', 'canvas', 'svg', 'iframe', 'embed', 'object']);

const clipsInside = (value: string | undefined): boolean => /\b(padding-box|content-box)\b/.test(value ?? '');
const fixedSize = (value: string | undefined): boolean => Boolean(value?.trim()) && !/^(auto|fit-content|max-content|min-content|stretch)$/.test(value!.trim()) && !/-content\b/.test(value!);
const isEmpty = (element: HtmlElement): boolean => element.children.every((node) => node.type === 'text' && !node.value.trim());

/**
 * Whether the box keeps its size whatever its border does: replaced
 * elements, a background clipped to the padding or content box, an empty
 * fixed-size border-box box that is not a form control.
 */
export function keepsSize(element: HtmlElement, computed: Record<string, string> = {}): boolean {
  if (REPLACED.has(element.tag)) return true;
  const inline = styleMap(attributeValue(element, 'style') ?? '');
  const background = inline.background && clipsInside(inline.background) ? inline.background : undefined;
  if (clipsInside(inline['background-clip'] ?? inline['-webkit-background-clip'] ?? background ?? computed['background-clip'])) return true;
  const borderBox = (inline['box-sizing'] ?? computed['box-sizing']) === 'border-box';
  return borderBox && !FORM_CONTROLS.has(element.tag) && isEmpty(element) && fixedSize(inline.width) && fixedSize(inline.height);
}

/** Whether aligning takes the border away (every side fixed) instead of keeping its space. */
export function alignModeFor(element: HtmlElement, computed: Record<string, string> = {}, pinned?: BoxSides<boolean>): AlignMode {
  return keepsSize(element, computed) || (pinned !== undefined && SIDES.every((side) => pinned[side])) ? 'free' : 'kept';
}

/** A px (or 0) length plus `add` px, when the result is above 0; anything else stays (null). An earlier step's `calc(… + Npx)` is undone. */
export function plusPx(value: string, add: number): string | null {
  const text = value.trim();
  const plain = /^(-?\d*\.?\d+)(px)?$/.exec(text);
  if (plain && (plain[2] || Number(plain[1]) === 0)) {
    const next = Math.round((Number(plain[1]) + add) * 100) / 100;
    return next > 0 ? `${next}px` : null;
  }
  const added = /^calc\((.+) ([+-]) (\d*\.?\d+)px\)$/.exec(text);
  if (added && Number(added[3]) * (added[2] === '+' ? 1 : -1) === -add) return added[1]!;
  return null;
}

/** How far outside the box an outline of `width` reaches at `alignment`. */
const reach = (alignment: BorderAlignment, width: number): number => (alignment === 'outside' ? width : alignment === 'center' ? width / 2 : 0);

/**
 * Keeps a content-box box's size when its border space changes by
 * `lost` px per axis (positive: space went), and a placed box's outer edge
 * where it was when the outline reaches `moved` px further out.
 */
function compensate(inline: Record<string, string>, computed: Record<string, string>, lost: { x: number; y: number }, moved: number, placed: boolean): Record<string, string> {
  const patch: Record<string, string> = {};
  const contentBox = (inline['box-sizing'] ?? computed['box-sizing'] ?? 'content-box') === 'content-box';
  if (contentBox) {
    for (const [size, axis] of [['width', 'x'], ['height', 'y']] as const) {
      const value = inline[size];
      if (!lost[axis] || value === undefined) continue;
      const next = plusPx(value, lost[axis]);
      if (next !== null) patch[size] = next;
    }
  }
  if (placed && moved) {
    for (const side of ['left', 'top'] as const) {
      const value = inline[side];
      const number = value === undefined ? null : /^(-?\d*\.?\d+)px$/.exec(value.trim());
      if (!number) continue;
      const next = Math.round((Number(number[1]) + moved) * 100) / 100;
      if (next >= 0) patch[side] = `${next}px`;
    }
  }
  return patch;
}

/** The outline parts to write: each one the classes don't already give. */
function outlineParts(look: BorderLook, offset: string, context: AlignContext): Record<string, string | null> {
  const given = context.classOutline ?? {};
  const same = (a: string | undefined, b: string) => a !== undefined && a.trim() === b.trim();
  return {
    'outline-width': same(given.width, look.width) ? null : look.width,
    'outline-style': same(given.style, look.style) ? null : look.style,
    'outline-color': same(given.color, look.color) ? null : look.color,
    'outline-offset': same(given.offset ?? '0px', offset) ? null : offset,
  };
}

/** Whether the element takes keyboard focus. */
export const isFocusable = (element: HtmlElement): boolean =>
  FOCUSABLE.has(element.tag) || (element.tag === 'a' && attributeValue(element, 'href') !== undefined) || attributeValue(element, 'tabindex') !== undefined;

const RING = /^box-shadow:\s*0 0 0 calc\(.+ \+ 2px\) #fff, 0 0 0 calc\(.+ \+ 4px\) #101010$|^outline:\s*revert;\s*outline-offset:\s*revert$/;

/** Whether a focus style is the ring an aligned border wrote. */
export const isAlignRing = (value: string | undefined): boolean => value !== undefined && RING.test(value.trim());

/** The focus ring for an outline of `width` at `offset`: two rings past it, or the browser's own outline back. */
export function focusRing(width: string, offset: string): string {
  if (/^(\d*\.?\d+(px|pt|em|rem)|var\(.+\))$/.test(width.trim())) return `box-shadow: 0 0 0 calc(${width} + ${offset} + 2px) #fff, 0 0 0 calc(${width} + ${offset} + 4px) #101010`;
  return 'outline: revert; outline-offset: revert';
}

/** The focus ring edit for an element whose border now draws at `look` / `offset` (null look: no longer aligned). */
function ringEdit(element: HtmlElement, look: BorderLook | null, offset: string, context: AlignContext): string | null | undefined {
  const current = attributeValue(element, FOCUS_STYLE_ATTRIBUTE);
  const ours = isAlignRing(current);
  if (!look) return ours ? null : undefined;
  if (!isFocusable(element) || (current !== undefined && !ours) || attributeValue(element, 'style-focus') !== undefined) return undefined;
  if (!ours && context.focusStyled) return undefined;
  const ring = focusRing(look.width, offset);
  return ring === current ? undefined : ring;
}

/** Why a plain (inside) border can't be aligned, or `null` when it can. */
export function alignRefusal(element: HtmlElement, computed: Record<string, string> = {}): string | null {
  const text = attributeValue(element, 'style') ?? '';
  const declarations = parseStyle(text);
  const inline = styleMap(text);
  if (text.includes('{{') || declarations.some((d) => d.important && /^(border|outline)/.test(d.property)) || inline['border-image'] || inline['border-image-source']) return ALIGN_REFUSALS.code;
  if (readAlignment(inline, computed).alignment !== 'inside') return null;
  if (drawn(inline['outline-style'] ?? splitShorthand(inline.outline).style ?? '')) return ALIGN_REFUSALS.outline;
  const sides = sidesOf(inline, computed);
  const first = sides[0]!;
  if (sides.every((side) => !drawn(side.style) || px(side.width) === 0 || isClear(side.color))) return ALIGN_REFUSALS.color;
  if (sides.some((side) => side.width !== first.width || side.style !== first.style || side.color !== first.color)) return ALIGN_REFUSALS.sides;
  return null;
}

/** Each side's inline width of a border kept as space (the outline's width where none is written). */
function keptWidths(inline: Record<string, string>, width: string): string[] {
  const four = fourOf(inline['border-width']);
  const short = splitShorthand(inline.border).width;
  return SIDES.map((side, i) => inline[`border-${side}-width`] ?? splitShorthand(inline[`border-${side}`]).width ?? four?.[i] ?? short ?? width);
}

/** The edit that puts a plain border at `to` (center or outside). */
function fromInside(element: HtmlElement, inline: Record<string, string>, to: Exclude<BorderAlignment, 'inside'>, computed: Record<string, string>, context: AlignContext): AlignEdit {
  const side = sidesOf(inline, computed)[0]!;
  const width = NAMED_WIDTHS[side.width] ?? side.width;
  const look = { width, style: side.style, color: side.color };
  const offset = offsetFor(to, width);
  const w = px(width);
  const pinned = context.pinned ?? { top: false, right: false, bottom: false, left: false };
  const keeps = keepsSize(element, computed);
  const fixed = (s: Side) => keeps || pinned[s];
  const moved = w === null ? 0 : reach(to, w);
  const placed = context.placed === true;
  const patch: Record<string, string | null> = {};
  if (SIDES.every(fixed)) {
    for (const property of BORDER_PARTS) if (inline[property] !== undefined) patch[property] = null;
    const sideWithoutStyle = SIDES.some((s) => inline[`border-${s}-style`] === undefined && splitShorthand(inline[`border-${s}`]).style === undefined && fourOf(inline['border-style']) === null && splitShorthand(inline.border).style === undefined);
    if (context.classBorder || FORM_CONTROLS.has(element.tag) || sideWithoutStyle) patch['border-style'] = 'none';
    Object.assign(patch, outlineParts(look, offset, context), compensate(inline, computed, { x: 2 * (w ?? 0), y: 2 * (w ?? 0) }, moved, placed));
    for (const property of OUTLINE) if (patch[property] === null && inline[property] === undefined) delete patch[property];
    return { style: patch, focus: ringEdit(element, look, offset, context) };
  }
  // The space stays: a pinned side gives its width to the opposite side.
  const widths: Record<Side, number | null> = { top: w, right: w, bottom: w, left: w };
  const lost = { x: 0, y: 0 };
  if (w !== null) {
    for (const s of SIDES) {
      if (!pinned[s]) continue;
      widths[s] = 0;
      const across = OPPOSITE[s];
      if (pinned[across]) lost[s === 'left' || s === 'right' ? 'x' : 'y'] += w;
      else widths[across] = (widths[across] ?? 0) + w;
    }
  }
  patch['border-color'] = 'transparent';
  for (const s of SIDES) if (widths[s] !== w && widths[s] !== null) patch[`border-${s}-width`] = `${widths[s]}px`;
  if (inline['background-origin'] === undefined) patch['background-origin'] = 'border-box';
  Object.assign(patch, outlineParts(look, offset, context), compensate(inline, computed, lost, moved, placed));
  for (const property of OUTLINE) if (patch[property] === null && inline[property] === undefined) delete patch[property];
  return { style: patch, focus: ringEdit(element, look, offset, context) };
}

/** The edit that puts an aligned border back inside, read from the inline style. */
function toInside(element: HtmlElement, inline: Record<string, string>, look: BorderLook, alignment: BorderAlignment, mode: AlignMode, computed: Record<string, string>, context: AlignContext): AlignEdit {
  const patch: Record<string, string | null> = {};
  for (const property of OUTLINE) if (inline[property] !== undefined) patch[property] = null;
  const w = px(look.width);
  const moved = w === null ? 0 : -reach(alignment, w);
  const placed = context.placed === true;
  if (mode === 'free') {
    if (inline['border-style'] !== undefined) patch['border-style'] = null;
    patch.border = `${look.width} ${look.style} ${look.color}`;
    Object.assign(patch, compensate(inline, computed, { x: -2 * (w ?? 0), y: -2 * (w ?? 0) }, moved, placed));
    return { style: patch, focus: ringEdit(element, null, '', context) };
  }
  // Back to a plain border: the shorthand gives the color again when it has it.
  const shortColor = splitShorthand(inline.border).color;
  patch['border-color'] = shortColor === look.color ? null : look.color;
  const widths = keptWidths(inline, look.width);
  const base = fourOf(inline['border-width']) ?? (splitShorthand(inline.border).width ? [splitShorthand(inline.border).width!] : null);
  const lost = { x: 0, y: 0 };
  SIDES.forEach((s, i) => {
    const value = px(widths[i]!);
    if (w !== null && value !== null) lost[s === 'left' || s === 'right' ? 'x' : 'y'] -= w - value;
    if (inline[`border-${s}-width`] === undefined) return;
    patch[`border-${s}-width`] = base && (base[i] ?? base[0]) === look.width ? null : look.width;
  });
  if (inline['background-origin'] === 'border-box') patch['background-origin'] = null;
  Object.assign(patch, compensate(inline, computed, lost, moved, placed));
  return { style: patch, focus: ringEdit(element, null, '', context) };
}

/**
 * The edit that moves an element's border to `to`, or `null` when it
 * can't move or is there already.
 */
export function alignEdit(element: HtmlElement, to: BorderAlignment, computed: Record<string, string> = {}, context: AlignContext = {}): AlignEdit | null {
  const inline = styleMap(attributeValue(element, 'style') ?? '');
  const now = readAlignment(inline, computed);
  if (now.alignment === to || alignRefusal(element, computed)) return null;
  if (!now.look) return to === 'inside' ? null : fromInside(element, inline, to, computed, context);
  if (to === 'inside') return toInside(element, inline, now.look, now.alignment, now.mode, computed, context);
  const offset = offsetFor(to, now.look.width);
  const w = px(now.look.width);
  const given = context.classOutline?.offset ?? computed['outline-offset'] ?? '0px';
  const patch: Record<string, string | null> = { 'outline-offset': inline['outline-offset'] === undefined && given.trim() === offset ? null : offset };
  if (patch['outline-offset'] === null && inline['outline-offset'] === undefined) delete patch['outline-offset'];
  if (to === 'outside' && inline['outline-offset'] !== undefined && (context.classOutline?.offset ?? '0px') === offset) patch['outline-offset'] = null;
  Object.assign(patch, compensate(inline, computed, { x: 0, y: 0 }, w === null ? 0 : reach(to, w) - reach(now.alignment, w), context.placed === true));
  return { style: patch, focus: ringEdit(element, now.look, offset, context) };
}

/** {@link alignEdit}'s style patch alone. */
export function alignPatch(element: HtmlElement, to: BorderAlignment, computed: Record<string, string> = {}, context: AlignContext = {}): StylePatch | null {
  return alignEdit(element, to, computed, context)?.style ?? null;
}

/**
 * An edit to an aligned border (its color, style or width), written to the
 * outline that draws it. A width change moves a centred offset, resizes the
 * kept space (or what keeps the box in place) and the focus ring; a style
 * of `none` takes the border away.
 */
export function alignedLookEdit(element: HtmlElement, change: Partial<BorderLook>, computed: Record<string, string> = {}, context: AlignContext = {}): AlignEdit | null {
  return lookEdit(element, styleMap(attributeValue(element, 'style') ?? ''), change, computed, context);
}

function lookEdit(element: HtmlElement | null, inline: Record<string, string>, change: Partial<BorderLook>, computed: Record<string, string>, context: AlignContext): AlignEdit | null {
  const ring = (look: BorderLook | null, offset: string) => (element ? ringEdit(element, look, offset, context) : undefined);
  const { alignment, look, mode } = readAlignment(inline, computed);
  if (!look || alignment === 'inside') return null;
  const free = mode === 'free';
  const w = px(look.width);
  const placed = context.placed === true;
  if (change.style === 'none') {
    const patch: Record<string, string | null> = free
      ? { ...compensate(inline, computed, { x: 0, y: 0 }, w === null ? 0 : -reach(alignment, w), placed) }
      : { 'border-style': 'none', 'border-color': null, ...compensate(inline, computed, { x: 0, y: 0 }, w === null ? 0 : -reach(alignment, w), placed) };
    for (const property of OUTLINE) if (inline[property] !== undefined) patch[property] = null;
    if (!free) for (const s of SIDES) if (inline[`border-${s}-width`] !== undefined) patch[`border-${s}-width`] = null;
    if (inline['background-origin'] === 'border-box') patch['background-origin'] = null;
    return { style: patch, focus: ring(null, '') };
  }
  const patch: Record<string, string | null> = {};
  if (change.color !== undefined) patch['outline-color'] = change.color || look.color;
  if (change.style !== undefined) patch['outline-style'] = change.style;
  let next = look;
  let offset = (inline['outline-offset'] ?? offsetFor(alignment, look.width)).trim();
  if (change.width !== undefined) {
    const width = change.width || '1px';
    const v = px(width);
    next = { ...look, width };
    offset = offsetFor(alignment, width);
    patch['outline-width'] = width;
    patch['outline-offset'] = inline['outline-offset'] === undefined && alignment === 'outside' ? null : offset;
    if (patch['outline-offset'] === null) delete patch['outline-offset'];
    const grow = w !== null && v !== null ? v - w : 0;
    if (free) Object.assign(patch, compensate(inline, computed, { x: 2 * grow, y: 2 * grow }, reach(alignment, grow), placed));
    else {
      const written = SIDES.filter((s) => inline[`border-${s}-width`] !== undefined);
      if (written.length && w !== null && v !== null && w > 0) {
        for (const s of written) patch[`border-${s}-width`] = `${Math.round((px(inline[`border-${s}-width`]!) ?? w) * (v / w) * 100) / 100}px`;
        if (inline['border-width'] !== undefined || splitShorthand(inline.border).width) patch['border-width'] = width;
      } else patch['border-width'] = width;
      Object.assign(patch, compensate(inline, computed, { x: 0, y: 0 }, reach(alignment, grow), placed));
    }
  }
  return { style: patch, focus: ring(next, offset) };
}

/** {@link alignedLookEdit}'s style patch alone, for an element with this inline style. */
export function alignedLookPatch(inline: Record<string, string>, change: Partial<BorderLook>, computed: Record<string, string> = {}): StylePatch | null {
  return lookEdit(null, inline, change, computed, {})?.style ?? null;
}
