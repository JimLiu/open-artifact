/**
 * Elements the drawing tools place inside an artboard: their HTML, the
 * container a press inside an edited artboard puts them in, and the
 * corner radius new rectangles take.
 */

import type { HtmlElement } from '@open-artifact/dc';
import { acceptsChildren } from './outline.ts';
import { dashArray } from './notes.ts';
import type { Address, BoardOp } from './ops.ts';

/** Tools that place an element inside an artboard (`frame` is the Artboard tool there). */
export type PlaceTool = 'text' | 'rect' | 'oval' | 'line' | 'arrow' | 'frame';

/** A box in the container's pixels; a size of 0 is left to the element. */
export interface PlaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which way a line was drawn: 1 rightward / downward, -1 the other way. */
export interface DrawDirection {
  x: 1 | -1;
  y: 1 | -1;
}

/** Fill of placed rectangles and ovals. */
export const PLACE_FILL = '#b6b0a7';
/** Stroke of placed lines and arrows. */
export const PLACE_STROKE = '#8a8378';
/** Stroke width of placed lines and arrows. */
export const PLACE_LINE_WIDTH = 4;
/** Smallest side of a line's box, so a flat line can still be clicked. */
export const MIN_LINE_BOX = 8;
/** Words a new text element starts with. */
export const PLACEHOLDER_TEXT = 'Your text here';
/** Radius of a new rectangle when none was set before. */
export const DEFAULT_PLACE_RADIUS = 8;
/** Widest or tallest drawn path an artboard keeps. */
export const MAX_PATH_EXTENT = 8000;
/** Stroke of paths drawn with the Pencil. */
export const PEN_INK = '#2b2b2b';

/** Size a click places (0: sized by the content). */
export const CLICK_SIZES: Record<Exclude<PlaceTool, 'frame'>, { w: number; h: number }> = {
  text: { w: 0, h: 0 },
  rect: { w: 120, h: 120 },
  oval: { w: 96, h: 96 },
  line: { w: 160, h: 0 },
  arrow: { w: 160, h: 0 },
};

/** What the refusals call each tool's element. */
export const PLACE_NOUNS: Record<Exclude<PlaceTool, 'frame'> | 'pen', string> = {
  pen: 'a path',
  text: 'text',
  rect: 'a rectangle',
  oval: 'an oval',
  arrow: 'an arrow',
  line: 'a line',
};

/** The refusal when the artboard under the pointer has not loaded. */
export const notLoadedMessage = (tool: keyof typeof PLACE_NOUNS): string => `That artboard didn’t load — pick another one to add ${PLACE_NOUNS[tool]}.`;
export const PATH_TOO_LARGE = 'That path is too large to keep. Draw it smaller, or in pieces.';
export const PATH_FAILED = 'Couldn’t add that path to the artboard. Try again.';
export const PLACE_FAILED = 'Couldn’t place the element. Try again.';
export const EMPTY_TEXT_REMOVED = 'Empty text box removed';

/** Four corner radii in px: top-left, top-right, bottom-right, bottom-left. */
export type Corners = readonly [number, number, number, number];

/** A number as written in markup: at most two decimals, no trailing zeros. */
const n = (value: number): string => String(Math.round(value * 100) / 100);

/** Declarations for corner radii: one `border-radius` when all four match, else the four longhands. */
export function radiusDeclarations(corners: Corners): [string, string][] {
  if (corners.every((c) => c === corners[0])) return [['border-radius', `${n(corners[0])}px`]];
  const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  return corners.map((c, i) => [`border-${names[i]}-radius`, `${n(c)}px`]);
}

/** Inline style text for corner radii (the default radius when none is remembered). */
export function radiusCss(corners: Corners | null): string {
  return radiusDeclarations(corners ?? [DEFAULT_PLACE_RADIUS, DEFAULT_PLACE_RADIUS, DEFAULT_PLACE_RADIUS, DEFAULT_PLACE_RADIUS])
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
}

/** A radius written in px (`12px`, `12`), rounded to two decimals; `null` for other units and keywords. */
export function pxRadius(value: string | undefined): number | null {
  const match = /^\s*(\d*\.?\d+)(px)?\s*$/.exec(value ?? '');
  return match ? Math.round(Number(match[1]) * 100) / 100 : null;
}

/** Corners from a `border-radius` value of one to four px lengths; `null` for anything else. */
export function cornersOf(value: string | readonly string[]): Corners | null {
  const parts = typeof value === 'string' ? value.trim().split(/\s+/) : [...value];
  if (parts.length < 1 || parts.length > 4) return null;
  const px = parts.map(pxRadius);
  if (px.some((v) => v === null)) return null;
  const [a, b = a, c = a, d = b] = px as number[];
  return [a!, b!, c!, d!];
}

/** Corners kept in storage, or `null` when what is there is not four lengths. */
export function parseCorners(raw: string | null | undefined): Corners | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
    return [value[0], value[1], value[2], value[3]];
  } catch {
    return null;
  }
}

/** The storage key of the remembered radius for the document at `pathname`. */
export function radiusKey(pathname: string): string {
  const path = pathname.replace(/\/index\.html?$/i, '/').replace(/\/+$/, '') || '/';
  return `mc-design/rect-radius${path}`;
}

/** Appends to the `style` attribute of the first element in `html`. */
function appendStyle(html: string, css: string): string {
  return html.replace(/style="([^"]*)"/, (_all, style: string) => `style="${style}; ${css}"`);
}

/** Where an element sits: absolutely positioned at the box, with its size when one was drawn. */
function placement(box: PlaceBox): string {
  return [`position: absolute`, `left: ${n(box.x)}px`, `top: ${n(box.y)}px`, ...(box.w > 0 ? [`width: ${n(box.w)}px`] : []), ...(box.h > 0 ? [`height: ${n(box.h)}px`] : [])].join('; ');
}

/** The element a box tool places, without its position. */
function template(tool: 'text' | 'rect' | 'oval' | 'frame', options: { radius?: Corners | null; font?: string | null }): string {
  switch (tool) {
    case 'rect':
      return `<div style="box-sizing: border-box; display: flex; flex-direction: column; width: 120px; height: 120px; background-color: ${PLACE_FILL}; ${radiusCss(options.radius ?? null)}"></div>`;
    case 'oval':
      return `<div style="box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 96px; height: 96px; background-color: ${PLACE_FILL}; border-radius: 50%"></div>`;
    case 'frame':
      return '<div style="box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 16px; background-color: #ffffff; border-radius: 2px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08)"></div>';
    case 'text': {
      const font = options.font ? `; font-family: ${options.font.replace(/"/g, "'")}` : '';
      return `<div style="font-size: 16px; line-height: 1${font}">${PLACEHOLDER_TEXT}</div>`;
    }
  }
}

/** Pulls `end` back toward `start` by `by`, keeping at least half a pixel (or the whole line, when shorter). */
function pulledBack(start: [number, number], end: [number, number], by: number): [number, number] {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (length === 0) return end;
  const kept = Math.max(Math.min(length, 0.5), length - by);
  const round = (v: number) => Math.round(v * 100) / 100;
  return [round(start[0] + ((end[0] - start[0]) * kept) / length), round(start[1] + ((end[1] - start[1]) * kept) / length)];
}

/**
 * A straight line (or arrow) drawn over `box` in direction `dir`. The box
 * grows to at least {@link MIN_LINE_BOX} on each side around the line; an
 * arrow's line stops short of its tip so the head covers the end.
 */
export function lineHtml(tool: 'line' | 'arrow', box: PlaceBox, dir: DrawDirection, freshId: () => string): string {
  const w = Math.max(box.w, MIN_LINE_BOX);
  const h = Math.max(box.h, MIN_LINE_BOX);
  const dx = (w - box.w) / 2;
  const dy = (h - box.h) / 2;
  const start: [number, number] = [dir.x === 1 ? dx : dx + box.w, dir.y === 1 ? dy : dy + box.h];
  let end: [number, number] = [dir.x === 1 ? dx + box.w : dx, dir.y === 1 ? dy + box.h : dy];
  let defs = '';
  let marker = '';
  if (tool === 'arrow') {
    const id = freshId();
    end = pulledBack(start, end, PLACE_LINE_WIDTH * 2);
    // The head is sized in stroke widths and centred on the line's end.
    defs = `<defs><marker id="${id}" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2" overflow="visible"><path d="M0 0 L4 2 L0 4 Z" fill="${PLACE_STROKE}" stroke="none"></path></marker></defs>`;
    marker = ` marker-end="url(#${id})"`;
  }
  const style = `position: absolute; left: ${n(box.x - dx)}px; top: ${n(box.y - dy)}px; width: ${n(w)}px; height: ${n(h)}px; overflow: visible; fill: none; stroke: ${PLACE_STROKE}; stroke-width: ${PLACE_LINE_WIDTH}; stroke-linecap: round; stroke-linejoin: round`;
  return `<svg width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" preserveAspectRatio="none" style="${style}">${defs}<path d="M ${n(start[0])} ${n(start[1])} L ${n(end[0])} ${n(end[1])}"${marker}></path></svg>`;
}

/**
 * The element a click or drag of `tool` places at `box` (container pixels).
 * A click passes the tool's {@link CLICK_SIZES}; `dir` is the way a line
 * was drawn (rightward when clicked).
 */
export function placedHtml(tool: PlaceTool, box: PlaceBox, options: { radius?: Corners | null; font?: string | null; dir?: DrawDirection; freshId?: () => string } = {}): string {
  if (tool === 'line' || tool === 'arrow') return lineHtml(tool, box, options.dir ?? { x: 1, y: -1 }, options.freshId ?? (() => 'arrow-head-1'));
  return appendStyle(template(tool, options), placement(box));
}

/** A drawn path in the container's pixels: where it starts and its points from there. */
export interface PenStroke {
  x: number;
  y: number;
  points: readonly (readonly [number, number])[];
}

/**
 * A Pencil stroke as an svg element positioned in its container, or `null`
 * when it spans more than {@link MAX_PATH_EXTENT} pixels either way.
 */
export function pencilHtml(stroke: PenStroke, pen: { width: number; dash: string }): string | null {
  const xs = stroke.points.map((p) => p[0]);
  const ys = stroke.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  if (spanX > MAX_PATH_EXTENT || spanY > MAX_PATH_EXTENT) return null;
  const w = Math.max(2, Math.round(spanX));
  const h = Math.max(2, Math.round(spanY));
  // Points to a thousandth of a pixel; the box on whole pixels.
  const at = (v: number): string => String(Math.round(v * 1000) / 1000);
  const d = stroke.points.map(([x, y], i) => `${i ? 'L' : 'M'}${at(x - minX)} ${at(y - minY)}`).join(' ');
  const dashes = dashArray(pen.dash, pen.width);
  const ink = `stroke: ${PEN_INK}; stroke-width: ${n(pen.width)}${dashes ? `; stroke-dasharray: ${dashes}` : ''}`;
  const style = `position: absolute; left: ${Math.round(stroke.x + minX)}px; top: ${Math.round(stroke.y + minY)}px; width: ${w}px; height: ${h}px; overflow: visible; fill: none; ${ink}; stroke-linecap: round; stroke-linejoin: round`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="${style}"><path d="${d}" vector-effect="non-scaling-stroke"></path></svg>`;
}

/** Elements that hold drawn shapes without taking others (and the hidden ones). */
const NO_DRAWINGS = new Set(['option', 'script', 'style', 'title', 'template', 'head', 'helmet', 'path', 'circle', 'rect', 'line', 'ellipse', 'polygon', 'polyline', 'use', 'param']);

/** Children table parts take. */
const TABLE_PARTS: Record<string, readonly string[]> = {
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr'],
  thead: ['tr'],
  tbody: ['tr'],
  tfoot: ['tr'],
  tr: ['td', 'th'],
  colgroup: ['col'],
};

/** Where a paragraph above stops mattering: a block may go inside these even within a `<p>`. */
const PARAGRAPH_STOPS = new Set(['button', 'td', 'th', 'caption', 'table', 'object', 'marquee', 'applet', 'template', 'html', 'foreignobject']);

/** Whether a placed element (a `div`, or an `svg` for lines and paths) can go inside `element`. */
function holds(element: HtmlElement, placed: 'div' | 'svg'): boolean {
  if (!acceptsChildren(element) || NO_DRAWINGS.has(element.tag)) return false;
  const parts = TABLE_PARTS[element.tag];
  if (parts && !parts.includes(placed)) return false;
  if (placed === 'div') {
    // A block inside a paragraph would be moved out of it by the parser.
    for (let node: HtmlElement | null = element; node && !PARAGRAPH_STOPS.has(node.tag); node = node.parent) if (node.tag === 'p') return false;
  }
  return true;
}

/**
 * The element a drawing goes into when pressed on `under` (the innermost
 * element at the point): out of locked elements and svg drawings, then
 * outward past elements that can't hold it. `null` is the artboard itself.
 */
export function drawContainer(under: HtmlElement | null, placed: 'div' | 'svg', locked: (element: HtmlElement) => boolean = () => false): HtmlElement | null {
  let element = under;
  let outer: HtmlElement | null = null;
  for (let node = element; node; node = node.parent) if (node.tag === 'svg' || locked(node)) outer = node;
  if (outer) element = outer.parent;
  while (element && !holds(element, placed)) element = element.parent;
  return element;
}

/**
 * The edits that place `html` at the end of `container` (the artboard when
 * `null`). A container that is not positioned is made `relative` first, so
 * the element's position counts from it; both go in one undo step.
 */
export function placementOps(container: Address | null, anchor: boolean, html: string): BoardOp[] {
  const insert: BoardOp = { kind: 'insert', target: container, position: 'last-child', html };
  return container && anchor ? [{ kind: 'style', targets: [container], patch: { position: 'relative' } }, insert] : [insert];
}
