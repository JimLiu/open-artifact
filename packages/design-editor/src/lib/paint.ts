/**
 * Fill and stroke: removing a fill (X, the Remove fill button, None) and
 * swapping fill with stroke (⇧X) on boxes, shapes and shape notes.
 */

import { attributeValue, parseStyle, styleMap, type HtmlElement, type StylePatch } from '@open-artifact/dc';
import type { CanvasNote, NoteCss } from '@open-artifact/design-core';
import { hasCssBorder } from './note-look.ts';
import { readAlignment, splitShorthand } from './border-align.ts';

/** X: the fill goes, a class's background included. */
export const UNFILL_PATCH: StylePatch = { 'background-color': 'transparent', 'background-image': 'none' };

/** Remove fill (and None): every part of the background, so a class's goes too. */
export const REMOVE_FILL_PATCH: StylePatch = {
  background: null,
  'background-color': 'transparent',
  'background-image': 'none',
  'background-size': null,
  'background-position': null,
  'background-repeat': null,
};

/** Remove fill on a shape: `fill: none` in its style (the `fill` attribute goes separately). */
export const SHAPE_UNFILL_PATCH: StylePatch = { fill: 'none' };

/** Why a fill and stroke couldn't be swapped. */
export type SwapRefusal = 'unfit' | 'component' | 'not-solid' | 'in-code' | 'hidden' | 'nothing';

const REFUSALS = new Map<SwapRefusal, string>([
  ['unfit', 'Lines, pictures, notes, and artboards can’t swap fill and stroke'],
  ['component', 'Open the component to swap its fill and stroke'],
  ['not-solid', 'Only a single solid color can be swapped'],
  ['in-code', 'Colors set in code can’t be swapped here. Ask the agent in chat to swap them.'],
  ['hidden', 'This isn’t shown on the page right now. Show it first.'],
  ['nothing', 'Swapping wouldn’t change it'],
]);

export const swapRefusalMessage = (reason: SwapRefusal): string => REFUSALS.get(reason)!;

/** A message as a sentence: ends with a period. */
const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

export const SWAP_MESSAGES = {
  done: 'Fill and stroke swapped',
  rest: 'The rest swapped.',
  busy: 'Finish cropping or editing points first',
  failed: 'Couldn’t swap the fill and stroke. Try again.',
} as const;

/** X with nothing to take the fill from. */
export const NOTHING_TO_UNFILL = 'Nothing selected has a fill that can be removed.';

/**
 * How a swap is told: a toast when anything was refused (the first reason,
 * then "The rest swapped." if some went through), else a quiet
 * announcement. `null` when nothing was tried.
 */
export function swapReport(refusals: readonly SwapRefusal[], swapped: number): { toast: string } | { announce: string } | null {
  const reason = refusals[0];
  if (reason) return { toast: swapped ? `${sentence(swapRefusalMessage(reason))} ${SWAP_MESSAGES.rest}` : sentence(swapRefusalMessage(reason)) };
  return swapped ? { announce: SWAP_MESSAGES.done } : null;
}

/** Elements with no fill and stroke of their own to swap. */
const UNFIT = new Set(['img', 'picture', 'video', 'audio', 'iframe', 'canvas', 'hr', 'br', 'input', 'textarea', 'select', 'tr', 'thead', 'tbody', 'tfoot', 'col', 'colgroup']);
const COMPONENTS = new Set(['x-import', 'dc-import']);
const SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path', 'line', 'polyline']);

/** True for a color that paints nothing. */
export function isClearColor(color: string | undefined): boolean {
  const value = (color ?? '').trim().toLowerCase();
  return !value || value === 'transparent' || value === 'none' || /rgba\([^)]*,\s*0\)$/.test(value) || /\/\s*0\)$/.test(value) || value === '#0000' || value === '#00000000';
}

const LAYERED = /url\(|gradient\(/i;

/** The swap result: the patch to write, or why not. */
export type SwapPlan = { patch: StylePatch } | { refused: SwapRefusal };

/**
 * Swapping a box's background color and border color. A box without a
 * border gets a 1px solid one in its fill; a box without a fill keeps its
 * border's width with `border-style: none`. An aligned border swaps
 * through the outline that draws it. `computed` fills in what classes set.
 */
export function boxSwap(element: HtmlElement, computed: Record<string, string> = {}): SwapPlan {
  if (UNFIT.has(element.tag)) return { refused: 'unfit' };
  if (COMPONENTS.has(element.tag)) return { refused: 'component' };
  const text = attributeValue(element, 'style') ?? '';
  if (text.includes('{{') || parseStyle(text).some((d) => d.important && /^(background|border|outline)/.test(d.property))) return { refused: 'in-code' };
  const inline = styleMap(text);
  if (LAYERED.test(inline.background ?? '') || LAYERED.test(inline['background-image'] ?? '') || LAYERED.test(computed['background-image'] ?? '') || inline['border-image'] || inline['border-image-source']) return { refused: 'not-solid' };
  const plainBackground = inline.background && !LAYERED.test(inline.background) ? inline.background : undefined;
  const fill = inline['background-color'] ?? plainBackground ?? computed['background-color'] ?? '';
  const hasFill = !isClearColor(fill);
  const aligned = readAlignment(inline);
  if (aligned.look) {
    const stroke = aligned.look.color;
    if (!hasFill && isClearColor(stroke)) return { refused: 'nothing' };
    if (hasFill && fill.trim() === stroke.trim()) return { refused: 'nothing' };
    return { patch: { ...(plainBackground ? { background: null } : {}), 'background-color': isClearColor(stroke) ? 'transparent' : stroke, 'outline-color': hasFill ? fill : 'transparent' } };
  }
  const colors = ['top', 'right', 'bottom', 'left'].map((side) => inline[`border-${side}-color`]).filter((value): value is string => value !== undefined);
  if (new Set(colors).size > 1 || (inline['border-color'] ?? '').trim().split(/\s+(?![^(]*\))/).filter(Boolean).length > 1) return { refused: 'not-solid' };
  const short = splitShorthand(inline.border);
  const style = inline['border-style'] ?? short.style ?? computed['border-top-style'] ?? 'none';
  const width = inline['border-width'] ?? short.width ?? computed['border-top-width'] ?? '0px';
  const strokeColor = colors[0] ?? inline['border-color'] ?? short.color ?? computed['border-top-color'] ?? '';
  const hasStroke = style !== 'none' && style !== 'hidden' && parseFloat(width) !== 0 && !isClearColor(strokeColor);
  if (!hasFill && !hasStroke) return { refused: 'nothing' };
  if (hasFill && hasStroke && fill.trim() === strokeColor.trim()) return { refused: 'nothing' };
  const patch: Record<string, string | null> = plainBackground ? { background: null } : {};
  patch['background-color'] = hasStroke ? strokeColor : 'transparent';
  if (!hasFill) patch['border-style'] = 'none';
  else if (hasStroke) patch['border-color'] = fill;
  else Object.assign(patch, { 'border-width': '1px', 'border-style': 'solid', 'border-color': fill });
  return { patch };
}

/** A paint declared on an element or inherited from its graphic. */
function paintOf(element: HtmlElement, property: 'fill' | 'stroke'): string | undefined {
  for (let node: HtmlElement | null = element; node; node = node.parent) {
    const value = styleMap(attributeValue(node, 'style') ?? '')[property] ?? attributeValue(node, property);
    if (value !== undefined && value.trim() !== 'inherit') return value.trim();
    if (node.tag === 'svg') break;
  }
  return undefined;
}

/** Whether a path has just two points (a straight line). */
const twoPointPath = (d: string): boolean => (d.match(/[a-df-z]/gi) ?? []).length <= 2 && !/[zZ]/.test(d) && (d.match(/-?\d*\.?\d+/g) ?? []).length <= 4;

/**
 * Swapping a shape's `fill` and `stroke` (SVG defaults: black fill, no
 * stroke). Lines and arrowed shapes have no fill to swap. A new stroke
 * that had none gets `strokeWidth` (1px on screen) unless one is written.
 */
export function shapeSwap(shape: HtmlElement, strokeWidth = '1'): SwapPlan {
  if (!SHAPES.has(shape.tag)) return { refused: 'unfit' };
  if (shape.tag === 'line' || shape.tag === 'polyline' || (shape.tag === 'path' && twoPointPath(attributeValue(shape, 'd') ?? ''))) return { refused: 'unfit' };
  if (['marker-start', 'marker-mid', 'marker-end'].some((name) => attributeValue(shape, name) !== undefined || styleMap(attributeValue(shape, 'style') ?? '')[name] !== undefined)) return { refused: 'unfit' };
  if ((attributeValue(shape, 'style') ?? '').includes('{{')) return { refused: 'in-code' };
  const fill = paintOf(shape, 'fill') ?? 'black';
  const stroke = paintOf(shape, 'stroke') ?? 'none';
  if (LAYERED.test(fill) || LAYERED.test(stroke)) return { refused: 'not-solid' };
  if (fill === stroke || (isClearColor(fill) && isClearColor(stroke))) return { refused: 'nothing' };
  const patch: Record<string, string | null> = { fill: isClearColor(stroke) ? 'none' : stroke, stroke: isClearColor(fill) ? 'none' : fill };
  const hasWidth = styleMap(attributeValue(shape, 'style') ?? '')['stroke-width'] ?? attributeValue(shape, 'stroke-width') ?? (shape.parent ? attributeValue(shape.parent, 'stroke-width') : undefined);
  if (isClearColor(stroke) && !isClearColor(fill) && hasWidth === undefined) patch['stroke-width'] = strokeWidth;
  return { patch };
}

/** A shape note's default stroke (its `color` unset). */
const NOTE_STROKE = '#2b2b2b';

/** A note's css without `keys` (undefined when nothing is left). */
function cssWithout(css: NoteCss | undefined, keys: readonly string[]): NoteCss | undefined {
  if (!css) return undefined;
  const kept = Object.fromEntries(Object.entries(css).filter(([key]) => !keys.includes(key))) as NoteCss;
  return Object.keys(kept).length ? kept : undefined;
}

/** A note with `css` set, or without the key when it is undefined. */
function withCss(note: CanvasNote, css: NoteCss | undefined): CanvasNote {
  const next: CanvasNote = { ...note };
  if (css) next.css = css;
  else delete next.css;
  return next;
}

const NOTE_BACKGROUND = ['background', 'background-color'] as const;

/**
 * Shape notes (rectangles and ovals) swapped: their fill takes the border's
 * color and back. A fill or border set in the note's css is swapped there;
 * a gradient fill is not one color, and is refused.
 */
export function noteSwap(note: CanvasNote): CanvasNote | SwapRefusal {
  if (note.kind !== 'rect' && note.kind !== 'oval') return 'unfit';
  const css = note.css;
  const cssFill = css?.['background-color'] ?? css?.background;
  if (cssFill !== undefined && LAYERED.test(cssFill)) return 'not-solid';
  const cssBorder = hasCssBorder(css);
  const fill = cssFill ?? note.fill ?? 'transparent';
  const stroke = cssBorder ? (css?.['border-color'] ?? 'currentcolor') : (note.color ?? NOTE_STROKE);
  if (fill === stroke) return 'nothing';
  let next = withCss(note, cssWithout(css, cssFill !== undefined ? NOTE_BACKGROUND : []));
  if (cssFill !== undefined) next = withCss(next, { ...next.css, 'background-color': stroke });
  else next.fill = stroke;
  if (cssBorder) next = withCss(next, { ...next.css, 'border-color': fill });
  else next.color = fill;
  return next;
}

/** A shape note without its fill (`null`: it has none, or isn't a shape note). */
export function noteUnfill(note: CanvasNote): CanvasNote | null {
  if (note.kind !== 'rect' && note.kind !== 'oval') return null;
  const cssFill = note.css?.background !== undefined || note.css?.['background-color'] !== undefined;
  if (note.fill === undefined && !cssFill) return null;
  const next = withCss(note, cssWithout(note.css, NOTE_BACKGROUND));
  delete next.fill;
  return next;
}

/**
 * The edit a fill color pick makes on a box. None (`transparent`) removes
 * every part of the background; a color drops the image layers over it
 * (a gradient or picture would hide it); clearing goes back to the class.
 */
export function fillColorPatch(inline: Record<string, string>, computed: Record<string, string>, next: string | null): StylePatch {
  if (clipsToText(inline)) return { 'background-color': next };
  if (next !== null && isClearColor(next)) return REMOVE_FILL_PATCH;
  const patch: Record<string, string | null> = { 'background-color': next };
  if (inline.background !== undefined) patch.background = null;
  if (next !== null && (LAYERED.test(inline['background-image'] ?? '') || (inline['background-image'] === undefined && LAYERED.test(computed['background-image'] ?? '')))) patch['background-image'] = 'none';
  return patch;
}

const CLOSED_SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon']);

/**
 * Whether the background paints the text (`background-clip: text`, read
 * from the inline style). Its layers are the text's color, so neither a
 * fill pick nor None touches them.
 */
export function clipsToText(inline: Record<string, string>): boolean {
  return [inline['background-clip'], inline['-webkit-background-clip']].some((value) => /\btext\b/i.test(value ?? ''));
}

/**
 * Whether Remove fill applies: a box with a visible background, or a
 * closed shape with a visible fill. Not when the background is set with
 * `!important` (the inline value can't win) or in code.
 */
export function removableFill(element: HtmlElement, computed: Record<string, string> = {}): boolean {
  const text = attributeValue(element, 'style') ?? '';
  if (text.includes('{{')) return false;
  const shape = SHAPES.has(element.tag) ? element : null;
  if (shape) {
    const closed = CLOSED_SHAPES.has(shape.tag) || (shape.tag === 'path' && /z/i.test(attributeValue(shape, 'd') ?? ''));
    return closed && !isClearColor(paintOf(shape, 'fill') ?? 'black');
  }
  if (parseStyle(text).some((d) => d.important && d.property.startsWith('background'))) return false;
  const inline = styleMap(text);
  if (clipsToText(inline)) return false;
  const color = inline['background-color'] ?? (inline.background && !LAYERED.test(inline.background) ? inline.background : undefined) ?? computed['background-color'];
  const image = inline['background-image'] ?? (LAYERED.test(inline.background ?? '') ? inline.background : undefined) ?? computed['background-image'];
  return !isClearColor(color) || LAYERED.test(image ?? '');
}
