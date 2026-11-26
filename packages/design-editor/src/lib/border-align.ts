/**
 * Border alignment: a border drawn inside the box (a plain CSS border),
 * centred on its edge, or outside it. Center and Outside draw the border
 * with an outline, written one of two ways:
 *
 * - Kept: the border stays as transparent space, so nothing moves.
 *     border-color: transparent; background-origin: border-box;
 *     outline-width/style/color; outline-offset: -<width / 2> | 0px
 * - Free: the border goes (`border-style: none`), for boxes where the kept
 *   space would show as a gap between the line and what the box paints:
 *   images and other replaced elements, backgrounds clipped to the padding
 *   or content box, and empty fixed-size border-box boxes. A content-box
 *   size grows by the border it lost so the box keeps its size; on a side
 *   that can't keep it, a positioned box moves in by the border so what it
 *   shows stays put.
 */

import { attributeValue, parseStyle, styleMap, type HtmlElement, type StylePatch } from '@open-artifact/dc';

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
  focus: 'This element shows keyboard focus with its outline, so its border can’t be aligned',
} as const;

/** Each side's width is set only on a border aligned inside. */
export const SIDES_NEED_INSIDE = 'To set each side, first align the border inside';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const STYLES = /^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/;
const NAMED_WIDTHS: Record<string, string> = { thin: '1px', medium: '3px', thick: '5px' };
/** Elements whose outline is their keyboard focus ring. */
const FOCUSABLE = new Set(['button', 'input', 'select', 'textarea', 'summary']);

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

/** How an aligned border is written: over kept transparent space, or with the border gone. */
export type AlignMode = 'kept' | 'free';

const noneStyle = (inline: Record<string, string>): boolean =>
  /^(none|hidden)$/.test((inline['border-style'] ?? '').trim()) || /^(none|hidden)$/.test(splitShorthand(inline.border).style ?? '') || inline.border?.trim() === '0';

/** The border an outline stands for, and where, when the element's border is aligned. */
export function readAlignment(inline: Record<string, string>): { alignment: BorderAlignment; look: BorderLook | null; mode: AlignMode } {
  const look = { width: inline['outline-width'] ?? '', style: inline['outline-style'] ?? '', color: inline['outline-color'] ?? '' };
  const offset = (inline['outline-offset'] ?? '').trim();
  const mode: AlignMode = noneStyle(inline) ? 'free' : 'kept';
  if (!look.width || !drawn(look.style) || !offset || (mode === 'kept' && !isClear(inline['border-color'] ?? ''))) return { alignment: 'inside', look: null, mode };
  if (offset === offsetFor('outside', look.width) || offset === '0') return { alignment: 'outside', look, mode };
  if (offset === offsetFor('center', look.width)) return { alignment: 'center', look, mode };
  return { alignment: 'inside', look: null, mode };
}

/** Elements that paint their content inside the border (the kept space would show). */
const REPLACED = new Set(['img', 'video', 'canvas', 'svg', 'iframe', 'embed', 'object']);

const clipsInside = (value: string | undefined): boolean => /\b(padding-box|content-box)\b/.test(value ?? '');
const fixedSize = (value: string | undefined): boolean => Boolean(value?.trim()) && !/^(auto|fit-content|max-content|min-content)$/.test(value!.trim());
const isEmpty = (element: HtmlElement): boolean => element.children.every((node) => node.type === 'text' && !node.value.trim());

/**
 * Whether aligning this element's border takes the border away (free)
 * instead of keeping its space: replaced elements, a background clipped to
 * the padding or content box, an empty fixed-size border-box box.
 */
export function alignModeFor(element: HtmlElement, computed: Record<string, string> = {}): AlignMode {
  if (REPLACED.has(element.tag)) return 'free';
  const inline = styleMap(attributeValue(element, 'style') ?? '');
  const background = inline.background && /\b(padding-box|content-box)\b/.test(inline.background) ? inline.background : undefined;
  if (clipsInside(inline['background-clip'] ?? inline['-webkit-background-clip'] ?? background ?? computed['background-clip'])) return 'free';
  const borderBox = (inline['box-sizing'] ?? computed['box-sizing']) === 'border-box';
  if (borderBox && isEmpty(element) && fixedSize(inline.width) && fixedSize(inline.height)) return 'free';
  return 'kept';
}

const plusPx = (value: string, add: number): string => {
  const plain = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  if (plain) return `${Math.round((Number(plain[1]) + add) * 100) / 100}px`;
  // Undo what an earlier step added.
  const added = /^calc\((.+) ([+-]) (\d*\.?\d+)px\)$/.exec(value.trim());
  if (added && Number(added[3]) * (added[2] === '+' ? 1 : -1) === -add) return added[1]!;
  return `calc(${value.trim()} ${add < 0 ? '-' : '+'} ${Math.abs(add)}px)`;
};

/**
 * What keeps a free-aligned box in place when its border changes by
 * `delta` px on every side (positive: the border goes away). A content-box
 * width or height set inline grows by the border on both sides; on an axis
 * without one, a positioned box moves in by the border.
 */
export function freeShift(inline: Record<string, string>, computed: Record<string, string>, delta: number): Record<string, string> {
  const patch: Record<string, string> = {};
  if (!delta) return patch;
  const contentBox = (inline['box-sizing'] ?? computed['box-sizing'] ?? 'content-box') !== 'border-box';
  const positioned = /^(absolute|fixed)$/.test(inline.position ?? computed.position ?? '');
  for (const [size, start, end] of [['width', 'left', 'right'], ['height', 'top', 'bottom']] as const) {
    if (fixedSize(inline[size])) {
      if (contentBox) patch[size] = plusPx(inline[size]!, 2 * delta);
      continue;
    }
    if (!positioned) continue;
    const side = fixedSize(inline[start]) ? start : fixedSize(inline[end]) ? end : null;
    if (side) patch[side] = plusPx(inline[side]!, delta);
  }
  return patch;
}

/** Why a plain (inside) border can't be aligned, or `null` when it can. */
export function alignRefusal(element: HtmlElement, computed: Record<string, string> = {}): string | null {
  const text = attributeValue(element, 'style') ?? '';
  const declarations = parseStyle(text);
  const inline = styleMap(text);
  if (text.includes('{{') || declarations.some((d) => d.important && /^(border|outline)/.test(d.property)) || inline['border-image'] || inline['border-image-source']) return ALIGN_REFUSALS.code;
  if (FOCUSABLE.has(element.tag) || (element.tag === 'a' && attributeValue(element, 'href') !== undefined) || attributeValue(element, 'tabindex') !== undefined) return ALIGN_REFUSALS.focus;
  if (readAlignment(inline).alignment !== 'inside') return null;
  if (drawn(inline['outline-style'] ?? splitShorthand(inline.outline).style ?? '')) return ALIGN_REFUSALS.outline;
  const sides = sidesOf(inline, computed);
  const first = sides[0]!;
  if (sides.every((side) => !drawn(side.style) || px(side.width) === 0 || isClear(side.color))) return ALIGN_REFUSALS.color;
  if (sides.some((side) => side.width !== first.width || side.style !== first.style || side.color !== first.color)) return ALIGN_REFUSALS.sides;
  return null;
}

const OUTLINE = ['outline-width', 'outline-style', 'outline-color', 'outline-offset'] as const;
/** Every inline border declaration a free alignment takes away. */
const BORDER_PARTS = ['border', 'border-width', 'border-style', 'border-color', ...SIDES.flatMap((side) => [`border-${side}`, `border-${side}-width`, `border-${side}-style`, `border-${side}-color`])];

/**
 * The edit that moves an element's border to `to` (one style patch), or
 * `null` when it can't move or is there already.
 */
export function alignPatch(element: HtmlElement, to: BorderAlignment, computed: Record<string, string> = {}): StylePatch | null {
  const inline = styleMap(attributeValue(element, 'style') ?? '');
  const now = readAlignment(inline);
  if (now.alignment === to || alignRefusal(element, computed)) return null;
  if (now.look) {
    if (to !== 'inside') return { 'outline-offset': offsetFor(to, now.look.width) };
    const patch: Record<string, string | null> = {};
    for (const property of OUTLINE) patch[property] = null;
    if (now.mode === 'free') {
      // A plain border again, and the box back where the border puts it.
      patch['border-style'] = null;
      patch.border = `${now.look.width} ${now.look.style} ${now.look.color}`;
      Object.assign(patch, freeShift(inline, computed, -(px(now.look.width) ?? 0)));
      return patch;
    }
    // Back to a plain border: the shorthand gives the color again when it has it.
    const shortColor = splitShorthand(inline.border).color;
    patch['border-color'] = shortColor === now.look.color ? null : now.look.color;
    if (inline['background-origin'] === 'border-box') patch['background-origin'] = null;
    return patch;
  }
  if (to === 'inside') return null;
  const look = sidesOf(inline, computed)[0]!;
  const width = NAMED_WIDTHS[look.width] ?? look.width;
  const outline = { 'outline-width': width, 'outline-style': look.style, 'outline-color': look.color, 'outline-offset': offsetFor(to, width) };
  if (alignModeFor(element, computed) === 'free') {
    const patch: Record<string, string | null> = {};
    for (const property of BORDER_PARTS) if (inline[property] !== undefined) patch[property] = null;
    patch['border-style'] = 'none';
    return { ...patch, ...freeShift(inline, computed, px(width) ?? 0), ...outline };
  }
  return { 'border-color': 'transparent', 'background-origin': 'border-box', ...outline };
}

/**
 * An edit to an aligned border (its color, style or width), written to the
 * outline that draws it. A width change moves the offset and resizes the
 * kept space (kept) or what keeps the box in place (free); a style of
 * `none` takes the border away.
 */
export function alignedLookPatch(inline: Record<string, string>, change: Partial<BorderLook>, computed: Record<string, string> = {}): StylePatch | null {
  const { alignment, look, mode } = readAlignment(inline);
  if (!look || alignment === 'inside') return null;
  const free = mode === 'free';
  if (change.style === 'none') {
    const patch: Record<string, string | null> = free ? { ...freeShift(inline, computed, -(px(look.width) ?? 0)) } : { 'border-style': 'none', 'border-color': null };
    for (const property of OUTLINE) patch[property] = null;
    if (inline['background-origin'] === 'border-box') patch['background-origin'] = null;
    return patch;
  }
  const patch: Record<string, string | null> = {};
  if (change.color !== undefined) patch['outline-color'] = change.color || look.color;
  if (change.style !== undefined) patch['outline-style'] = change.style;
  if (change.width !== undefined) {
    const width = change.width || '1px';
    patch['outline-width'] = width;
    if (free) Object.assign(patch, freeShift(inline, computed, (px(width) ?? 0) - (px(look.width) ?? 0)));
    else patch['border-width'] = width;
    patch['outline-offset'] = offsetFor(alignment, width);
  }
  return patch;
}
