/**
 * Scaling part of a slide by one factor (Scale mode, K). Every absolute
 * length in the scaled elements grows or shrinks by the factor: sizes, type,
 * spacing, borders, shadows, connector ends. Pinned elements also keep their
 * place relative to the selection's box, which moves so that one of its
 * points (a corner, an edge's middle) stays where it was.
 */

import {
  FONT_SIZE_RANGE,
  isPinned,
  pinnedRectOf,
  pinNode,
  pxValue,
  round2,
  updateNodeAt,
  type ConnectorNode,
  type Coord,
  type CssProperty,
  type NodePath,
  type Rect,
  type Slide,
  type SlideNode,
  type StyleMap,
} from '@open-artifact/slides-core';

/** Factors the field and the grips accept at most. */
export const SCALE_RANGE = { min: 0.01, max: 100 } as const;

/** The selection never gets smaller than this on its longer side, in slide px. */
export const SMALLEST_SIDE = 24;

/** The factors one selection can take. */
export interface ScaleLimits {
  min: number;
  max: number;
}

/** Which grips scale the selection: all eight, only the bottom-right corner, or none (typing only). */
export type ScaleGrips = 'all' | 'far' | 'none';

/** A point or a shift, in slide px. */
export interface Point {
  x: number;
  y: number;
}

/** A resize grip by compass point. */
export type GripId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/* -------------------------------------------------------------------------- */
/* The field                                                                   */
/* -------------------------------------------------------------------------- */

/** Rewrites decimal digits of any script as ASCII digits (each script's digits run 0–9 in a row). */
function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0)!;
    let zero = code;
    for (let step = 0; step < 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1)); step++) zero--;
    return String(code - zero);
  });
}

/**
 * Reads what was typed into the Scale field: a percentage (the unit when none
 * is written; the sign may come first), a multiple (`1.5x`, `1.5×`), or a
 * width in px measured against `width`. A comma may stand for the decimal
 * point but not for thousands. Null when it is not a positive amount.
 */
export function parseScaleInput(text: string, width?: number): number | null {
  const value = asciiDigits(text)
    .replace(/[．٫]/g, '.')
    .replace(/，/g, ',')
    .replace(/[٪％﹪]/g, '%')
    .replace(/[‎‏؜\s]/g, '');
  const parts = /^(%?)(\d*[.,]?\d+)(%|x|×|px)?$/i.exec(value);
  if (!parts) return null;
  const amountText = parts[2]!;
  const unitText = parts[3];
  if (parts[1] && unitText) return null;
  if (/,\d{3}$/.test(amountText)) return null;
  const amount = Number(amountText.replace(',', '.'));
  const unit = (unitText ?? '%').toLowerCase();
  let factor: number;
  if (unit === '%') factor = amount / 100;
  else if (unit === 'px') factor = width && width > 0 ? amount / width : Number.NaN;
  else factor = amount;
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}

/** A factor kept inside `limits`. */
export function clampScale(factor: number, limits: ScaleLimits): number {
  return Math.min(limits.max, Math.max(limits.min, factor));
}

/** True when a typed factor is usable as it is (read, and inside the limits). */
export function scaleInRange(factor: number | null, limits: ScaleLimits): factor is number {
  return factor !== null && factor >= limits.min && factor <= limits.max;
}

/** A factor as the field shows it: a percentage to one decimal, ASCII digits. */
export function formatScale(factor: number): string {
  return `${Math.round(factor * 1000) / 10}%`;
}

/** One arrow-key step from `factor`: 1%, or 10% with Shift, kept inside the limits. */
export function stepScale(factor: number, up: boolean, large: boolean, limits: ScaleLimits): number {
  const step = (up ? 1 : -1) * (large ? 0.1 : 0.01);
  return clampScale(Math.round((factor + step) * 1000) / 1000, limits);
}

/* -------------------------------------------------------------------------- */
/* Grips                                                                       */
/* -------------------------------------------------------------------------- */

/** The point of the box a grip drag leaves in place, as fractions of its width and height from the top-left. */
export function gripAnchor(grip: GripId): Point {
  return {
    x: grip.includes('w') ? 1 : grip.includes('e') ? 0 : 0.5,
    y: grip.includes('n') ? 1 : grip.includes('s') ? 0 : 0.5,
  };
}

/**
 * The factor a grip dragged by (dx, dy) asks of a box of `size` (already
 * scaled): the change along whichever axis the grip moved further, in the
 * box's own (rotated) frame. A side under 8px that is also the shorter one
 * does not count: it would turn tiny moves into huge factors.
 */
export function gripFactor(size: { w: number; h: number }, grip: GripId, dx: number, dy: number, rotation = 0): number {
  const a = (rotation * Math.PI) / 180;
  const along = dx * Math.cos(a) + dy * Math.sin(a);
  const across = dy * Math.cos(a) - dx * Math.sin(a);
  const usable = (side: number, other: number): boolean => side > 0 && (side >= 8 || side >= other);
  let horizontal = 1;
  if (usable(size.w, size.h)) {
    if (grip.includes('e')) horizontal = (size.w + along) / size.w;
    else if (grip.includes('w')) horizontal = (size.w - along) / size.w;
  }
  let vertical = 1;
  if (usable(size.h, size.w)) {
    if (grip.includes('s')) vertical = (size.h + across) / size.h;
    else if (grip.includes('n')) vertical = (size.h - across) / size.h;
  }
  return Math.abs(vertical - 1) > Math.abs(horizontal - 1) ? vertical : horizontal;
}

/**
 * How far the box must move, going from factor `from` to `to`, for the point
 * at `anchor` (fractions of the unscaled box) to stay where it is on the
 * slide. A rotated box turns about its center, so the anchor is found there.
 */
export function anchorShift(size: { w: number; h: number }, anchor: Point, from: number, to: number, rotation = 0): Point {
  const a = (rotation * Math.PI) / 180;
  // The anchor relative to the box's center, turned with the box, then measured from the unturned top-left.
  const ox = (anchor.x - 0.5) * size.w;
  const oy = (anchor.y - 0.5) * size.h;
  const x = ox * Math.cos(a) - oy * Math.sin(a) + size.w / 2;
  const y = ox * Math.sin(a) + oy * Math.cos(a) + size.h / 2;
  return { x: x * (from - to), y: y * (from - to) };
}

/* -------------------------------------------------------------------------- */
/* Lengths                                                                     */
/* -------------------------------------------------------------------------- */

/** Properties that hold no length to scale. */
const UNSCALED: ReadonlySet<CssProperty> = new Set<CssProperty>([
  'font-family',
  'font-weight',
  'opacity',
  'flex-grow',
  'flex-shrink',
  'aspect-ratio',
]);

/** Properties a scaled element keeps as they are: where it sits, which its rect (or its flow) decides. */
const PLACE: ReadonlySet<CssProperty> = new Set<CssProperty>(['left', 'top', 'right', 'bottom', 'margin']);

const ABSOLUTE_LENGTH = /(-?\d*\.?\d+(?:e-?\d+)?)(px|pt|pc|in|cm|mm|rem)\b/gi;

/** A value with every absolute length multiplied by `factor` (`url()` and quoted strings untouched). */
export function scaleLengths(value: string, factor: number): string {
  return value
    .split(/(url\([^)]*\)|"[^"]*"|'[^']*')/i)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(ABSOLUTE_LENGTH, (_all, amount: string, unit: string) => `${round2(Number(amount) * factor)}${unit}`),
    )
    .join('');
}

/** A style with its lengths scaled; a selected element (`root`) keeps its place. */
export function scaleStyle(style: StyleMap, factor: number, root: boolean): StyleMap {
  const out: StyleMap = { ...style };
  for (const [property, value] of Object.entries(style) as [CssProperty, string][]) {
    if (UNSCALED.has(property) || (root && PLACE.has(property))) continue;
    out[property] = scaleLengths(value, factor);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Elements                                                                    */
/* -------------------------------------------------------------------------- */

/** What was measured of an element before scaling: sizes its style leaves to the layout. */
export interface Measured {
  /** Laid-out size, for elements whose style sets no px width or height. */
  w?: number;
  h?: number;
  /** Computed font size, for text whose style sets none. */
  fontSize?: number;
}

/** Elements that take their size from the layout but draw something of a fixed size. */
const MEDIA_KINDS: ReadonlySet<SlideNode['kind']> = new Set(['image', 'icon', 'svg', 'shape', 'embed']);

/** Elements whose text inherits a font size: a scale writes it down so it can grow. */
const TEXT_KINDS: ReadonlySet<SlideNode['kind']> = new Set(['text', 'list', 'textbox', 'table']);

/** Key of a path inside {@link ScaleUnit.measured}. */
export function measuredKey(path: NodePath): string {
  return path.join('.');
}

/** True when the element sets a px length for `property`. */
function hasPx(style: StyleMap, property: 'width' | 'height' | 'font-size'): boolean {
  return /^-?[\d.]+px$/.test(style[property] ?? '');
}

/** What the layout decides for an element that a scale has to write down. */
export function needsMeasure(node: SlideNode): { size: boolean; font: boolean } {
  return {
    size: MEDIA_KINDS.has(node.kind) && (!hasPx(node.style, 'width') || !hasPx(node.style, 'height')),
    font: TEXT_KINDS.has(node.kind) && !hasPx(node.style, 'font-size'),
  };
}

function scaleCoord(coord: Coord, factor: number): Coord {
  return coord.unit === 'px' ? { value: round2(coord.value * factor), unit: 'px' } : coord;
}

/** An element and everything inside it with every length scaled; `path` is where it sits (for measurements). */
export function scaleNode(node: SlideNode, factor: number, path: NodePath, measured: ReadonlyMap<string, Measured>, root: boolean): SlideNode {
  const style = scaleStyle(node.style, factor, root);
  const seen = measured.get(measuredKey(path));
  if (seen) {
    if (seen.w !== undefined && !hasPx(node.style, 'width')) style.width = pxValue(seen.w * factor);
    if (seen.h !== undefined && !hasPx(node.style, 'height')) style.height = pxValue(seen.h * factor);
    if (seen.fontSize !== undefined && !hasPx(node.style, 'font-size')) style['font-size'] = pxValue(seen.fontSize * factor);
  }
  switch (node.kind) {
    case 'box':
      return { ...node, style, children: node.children.map((child, i) => scaleNode(child, factor, [...path, i], measured, false)) };
    case 'textbox':
      return {
        ...node,
        style,
        ...(node.indent !== undefined ? { indent: round2(node.indent * factor) } : {}),
        blocks: node.blocks.map((block) => ({ ...block, style: scaleStyle(block.style, factor, false) })),
      };
    case 'list':
      return node.itemMargin
        ? { ...node, style, itemMargin: { top: round2(node.itemMargin.top * factor), bottom: round2(node.itemMargin.bottom * factor) } }
        : { ...node, style };
    case 'table':
      return {
        ...node,
        style,
        rows: node.rows.map((row) => ({
          ...row,
          style: scaleStyle(row.style, factor, false),
          cells: row.cells.map((cell) => ({ ...cell, style: scaleStyle(cell.style, factor, false) })),
        })),
      };
    case 'connector':
      // A connector inside a scaled box: its ends are lengths in that box.
      return !root && node.points ? { ...node, style, points: mapPoints(node.points, (c) => scaleCoord(c, factor)) } : { ...node, style };
    default:
      return { ...node, style } as SlideNode;
  }
}

function mapPoints(points: NonNullable<ConnectorNode['points']>, fn: (coord: Coord, axis: 'x' | 'y') => Coord): NonNullable<ConnectorNode['points']> {
  return { x1: fn(points.x1, 'x'), y1: fn(points.y1, 'y'), x2: fn(points.x2, 'x'), y2: fn(points.y2, 'y') };
}

/* -------------------------------------------------------------------------- */
/* A selection                                                                 */
/* -------------------------------------------------------------------------- */

/** One selected element as Scale sees it, measured when Scale started. */
export interface ScaleUnit {
  path: NodePath;
  /** Top-left of the box its offsets are measured in (the slide, or a host box), in slide px. */
  host: Point;
  /** Its unrotated box in its host's coordinates. */
  rect: Rect;
  /** Measurements of it and of the elements inside it, by {@link measuredKey}. */
  measured: ReadonlyMap<string, Measured>;
}

/** A selection to scale: its units and the box around them, in slide px. */
export interface ScaleTarget {
  units: readonly ScaleUnit[];
  box: Rect;
}

/** A position moved as the box scales: kept at the same place relative to the box's top-left, plus `shift`. */
function placeAt(value: number, origin: number, factor: number, shift: number): number {
  return origin + (value - origin) * factor + shift;
}

/**
 * The slide with the selection scaled by `factor` about the box's top-left,
 * moved by `shift` (see {@link anchorShift}). Elements in the flow only grow
 * or shrink: the flow places them.
 */
export function scaleSlide(slide: Slide, target: ScaleTarget, factor: number, shift: Point): Slide {
  if (factor === 1 && shift.x === 0 && shift.y === 0) return slide;
  const { box } = target;
  let next = slide;
  for (const unit of target.units) {
    next = updateNodeAt(next, unit.path, (node) => {
      const scaled = scaleNode(node, factor, unit.path, unit.measured, true);
      if (!isPinned(node)) return scaled;
      if (node.kind === 'connector' && node.points) {
        const move = (coord: Coord, axis: 'x' | 'y'): Coord => {
          if (coord.unit !== 'px') return coord;
          const host = axis === 'x' ? unit.host.x : unit.host.y;
          const origin = axis === 'x' ? box.x : box.y;
          return { value: round2(placeAt(host + coord.value, origin, factor, axis === 'x' ? shift.x : shift.y) - host), unit: 'px' };
        };
        return { ...(scaled as ConnectorNode), points: mapPoints(node.points, move) };
      }
      const rect = pinnedRectOf(node) ?? unit.rect;
      const pinned = pinNode(scaled, {
        x: placeAt(unit.host.x + rect.x, box.x, factor, shift.x) - unit.host.x,
        y: placeAt(unit.host.y + rect.y, box.y, factor, shift.y) - unit.host.y,
        w: rect.w * factor,
        h: rect.h * factor,
      });
      // A size the element leaves to its content (text with no height) stays that way: the content scales.
      const style: StyleMap = { ...pinned.style };
      if (scaled.style.width === undefined) delete style.width;
      if (scaled.style.height === undefined) delete style.height;
      return { ...pinned, style } as SlideNode;
    });
  }
  return next;
}

/** Font sizes in px that the scaled elements end up with (written ones and measured ones). */
function fontSizes(node: SlideNode, path: NodePath, measured: ReadonlyMap<string, Measured>, out: number[]): void {
  const written = /^([\d.]+)px$/.exec(node.style['font-size'] ?? '');
  const size = written ? Number(written[1]) : measured.get(measuredKey(path))?.fontSize;
  if (size && size > 0) out.push(size);
  if (node.kind === 'box') node.children.forEach((child, i) => fontSizes(child, [...path, i], measured, out));
}

/**
 * The factors the selection can take: type stays inside the format's font
 * size range, the box stays at least {@link SMALLEST_SIDE} on its longer
 * side, and 100% is always allowed.
 */
export function scaleLimits(slide: Slide, target: ScaleTarget, nodeAtPath: (slide: Slide, path: NodePath) => SlideNode | undefined): ScaleLimits {
  let min: number = SCALE_RANGE.min;
  let max: number = SCALE_RANGE.max;
  const sizes: number[] = [];
  for (const unit of target.units) {
    const node = nodeAtPath(slide, unit.path);
    if (node) fontSizes(node, unit.path, unit.measured, sizes);
  }
  for (const size of sizes) {
    min = Math.max(min, FONT_SIZE_RANGE.min / size);
    max = Math.min(max, FONT_SIZE_RANGE.max / size);
  }
  const side = Math.max(target.box.w, target.box.h);
  if (side > 0) min = Math.max(min, SMALLEST_SIDE / side);
  return {
    min: Math.min(1, Math.ceil(min * 1000 - 1e-6) / 1000),
    max: Math.max(1, Math.floor(max * 1000 + 1e-6) / 1000),
  };
}

/* -------------------------------------------------------------------------- */
/* Which grips                                                                 */
/* -------------------------------------------------------------------------- */

const START = new Set([undefined, '', 'start', 'flex-start', 'normal', 'stretch']);

/** True when a flow element keeps its top-left in place as it grows inside `parent` (the slide when null). */
function keepsTopLeft(parentStyle: StyleMap, siblings: readonly SlideNode[], index: number): boolean {
  const child = siblings[index]!;
  // Pinned siblings take no room in the flow.
  const before = siblings.slice(0, index).filter((sibling) => !isPinned(sibling));
  if (parentStyle.display === 'grid') {
    return START.has(child.style['align-self'] ?? parentStyle['align-items']) && START.has(child.style['justify-self'] ?? parentStyle['justify-items']) && before.length === 0;
  }
  if (parentStyle['flex-wrap'] === 'wrap') return false;
  if (!START.has(parentStyle['justify-content'])) return false;
  if (!START.has(child.style['align-self'] ?? parentStyle['align-items'])) return false;
  // A growing element before it would hand it the space it gives up.
  return !before.some((sibling) => grows(sibling.style));
}

function grows(style: StyleMap): boolean {
  if (style['flex-grow'] !== undefined) return Number(style['flex-grow']) > 0;
  const flex = style.flex?.trim().split(/\s+/)[0];
  return flex !== undefined && flex !== 'none' && Number(flex) > 0;
}

/**
 * The grips Scale offers: all of them for one pinned element; only the far
 * corner for one element in the flow that keeps its top-left in place all
 * the way up (nothing turned on the way); none for several elements, for
 * connectors and rules, or when the flow would move it.
 */
export function scaleGrips(slide: Slide, paths: readonly NodePath[], nodeAtPath: (slide: Slide, path: NodePath) => SlideNode | undefined): ScaleGrips {
  if (paths.length !== 1) return 'none';
  const path = paths[0]!;
  const node = nodeAtPath(slide, path);
  if (!node || node.kind === 'connector' || node.kind === 'rule' || (node.kind === 'shape' && node.shape === 'line')) return 'none';
  if (isPinned(node)) return 'all';
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const here = nodeAtPath(slide, path.slice(0, depth + 1));
    if (!here || here.style.transform) return 'none';
    if (depth < path.length - 1 && isPinned(here)) return 'far';
    const parent = depth === 0 ? null : nodeAtPath(slide, path.slice(0, depth));
    if (parent && parent.kind !== 'box') return 'none';
    const siblings = parent && parent.kind === 'box' ? parent.children : slide.children;
    if (!keepsTopLeft(parent ? parent.style : slide.style, siblings, path[depth]!)) return 'none';
  }
  return 'far';
}
