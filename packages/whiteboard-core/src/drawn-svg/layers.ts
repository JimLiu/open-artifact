/**
 * Layers of a drawing: the `<g>` elements right under the root `<svg>` whose
 * `id` reads as a name (`sun-rays` → "sun rays"). A layer with
 * `opacity="0"` is hidden.
 *
 * Layers are found by reading the SVG text itself (no DOM), so each one's
 * place in the text is known and an edit (moving a layer, hiding or showing
 * it) rewrites only that span. Every edited drawing is checked again before
 * it is used: still within the size limits, still showing (vetting), and
 * with its layers in the intended order.
 *
 * The shapes of each layer (as {@link drawingPaintPlan} reads them) give
 * what lies under a point and how far a layer reaches.
 */

import { MAX_SVG_SOURCE_CHARS, normalizeImageSource, svgToBase64DataUrl } from '../image-source.ts';
import { sanitizeShortLabel } from '../links.ts';
import { drawingPaintPlan, type DrawingPaintPart } from './looks.ts';
import { unknownSvgParts } from './vetting.ts';
import { parseSvgTree, type XmlElement } from './xml.ts';

/** Most layers a drawing may have (more and it has none). */
export const MAX_DRAWING_LAYERS = 24;
/** Longest layer name, in characters. */
export const MAX_DRAWING_LAYER_NAME_CHARS = 40;
/** Layers are cached until their drawings add up to this many characters. */
export const DRAWING_LAYER_CACHE_MAX_CHARS = 4_194_304;
/** A fill at least this opaque makes a shape solid to a press. */
export const SOLID_LAYER_FILL_ALPHA = 0.5;

/** One layer of a drawing, with its place in the SVG text. */
export interface DrawingLayer {
  /** Its index among the layers, 0 at the back. */
  n: number;
  /** Its `id`, as written. */
  id: string;
  /** Its name for people. */
  name: string;
  /** Where its start tag begins. */
  from: number;
  /** Where its start tag ends. */
  open: number;
  /** Where it ends (after its end tag). */
  to: number;
  hidden: boolean;
}

/** Why a layer could not be changed: it is gone, the result would be too long, or would not read back. */
export type LayerEditRefusal = 'gone' | 'long' | 'unread';

/** Names a layer by index and id (an id may repeat). */
export interface LayerRef {
  n: number;
  id: string;
}

/** True for a {@link LayerEditRefusal}. */
export function isLayerEditRefusal(value: string): value is LayerEditRefusal {
  return value === 'gone' || value === 'long' || value === 'unread';
}

/** The name a layer id reads as (empty when it reads as none). */
export function drawingLayerName(id: string): string {
  return sanitizeShortLabel(id.replace(/[-_]/g, ' '), MAX_DRAWING_LAYER_NAME_CHARS);
}

/* ------------------------------------------------------------------------ */
/* Reading the text                                                         */
/* ------------------------------------------------------------------------ */

/** An attribute's place in the text: the name at `at`, the value from `from` to `to` (quotes outside). */
interface TextAttribute {
  name: string;
  at: number;
  from: number;
  to: number;
}

/** A start tag found in the text. */
interface TextTag {
  name: string;
  from: number;
  /** Just after its `>`. */
  open: number;
  /** 0 for the root. */
  depth: number;
  /** Written `<name …/>`. */
  empty: boolean;
  attributes: TextAttribute[];
}

/** A direct child of the root, with where it ends and its id (white space folded to spaces). */
interface TopPart extends TextTag {
  to: number;
  id?: string;
}

const NAME = /[A-Za-z_:][\w:.-]*/y;
const ATTRIBUTE = /[ \t\r\n]+([A-Za-z_:][\w:.-]*)[ \t\r\n]*=[ \t\r\n]*("[^"<]*"|'[^'<]*')/y;
const TAG_END = /[ \t\r\n]*(\/?)>/y;
const CLOSING_TAG = /<\/([A-Za-z_:][\w:.-]*)[ \t\r\n]*>/y;
const PASSED_OVER: ReadonlyArray<readonly [string, string]> = [
  ['<!--', '-->'],
  ['<![CDATA[', ']]>'],
];

/** Where a comment or character data starting at `start` ends (-1 when it never does); `undefined` when none starts there. */
function passOver(svg: string, start: number): number | undefined {
  for (const [opener, closer] of PASSED_OVER) {
    if (!svg.startsWith(opener, start)) continue;
    const close = svg.indexOf(closer, start + opener.length);
    return close < 0 ? -1 : close + closer.length;
  }
  return undefined;
}

/**
 * Walks the tags of a drawing's text. `false` unless the text is exactly one
 * well-formed `<svg>` element (comments and character data inside it are
 * passed over; a prolog or doctype is not accepted).
 */
function walkTags(svg: string, onTag: (tag: TextTag) => void, onEnd: (depth: number, at: number) => void = () => {}): boolean {
  const open: string[] = [];
  let at = 0;
  const read = (pattern: RegExp): RegExpExecArray | null => {
    pattern.lastIndex = at;
    const match = pattern.exec(svg);
    if (match !== null) at = pattern.lastIndex;
    return match;
  };
  while (at < svg.length) {
    const start = svg.indexOf('<', at);
    if (start < 0 || (open.length === 0 && start !== at)) return false;
    at = start;
    const skipped = passOver(svg, start);
    if (skipped !== undefined) {
      if (skipped < 0 || open.length === 0) return false;
      at = skipped;
      continue;
    }
    if (svg.startsWith('</', start)) {
      const closing = read(CLOSING_TAG)?.[1];
      if (closing === undefined || closing !== open.pop()) return false;
      onEnd(open.length, at);
      if (open.length > 0) continue;
      return closing === 'svg' && at === svg.length;
    }
    at = start + 1;
    const name = read(NAME)?.[0];
    if (name === undefined) return false;
    const attributes: TextAttribute[] = [];
    for (;;) {
      const before = at;
      const match = read(ATTRIBUTE);
      if (match === null) break;
      const [, attribute = '', quoted = ''] = match;
      if (attributes.some((other) => other.name === attribute)) return false;
      attributes.push({ name: attribute, at: before, from: at - quoted.length + 1, to: at - 1 });
    }
    const slash = read(TAG_END)?.[1];
    if (slash === undefined || (slash === '/' && open.length === 0)) return false;
    onTag({ name, from: start, open: at, depth: open.length, empty: slash === '/', attributes });
    if (slash === '') open.push(name);
  }
  return false;
}

/** The direct children of the root `<svg>`, or `undefined` when the text does not read or an id or transform holds an entity. */
function topParts(svg: string): TopPart[] | undefined {
  const parts: TopPart[] = [];
  const read = walkTags(
    svg,
    (tag) => {
      if (tag.depth !== 1) return;
      const id = tag.attributes.find((attribute) => attribute.name === 'id');
      parts.push({ ...tag, to: tag.open, ...(id !== undefined ? { id: svg.slice(id.from, id.to).replace(/\r\n|[\t\r\n]/g, ' ') } : {}) });
    },
    (depth, at) => {
      const last = parts.at(-1);
      if (depth === 1 && last !== undefined) last.to = at;
    },
  );
  const entity = (part: TopPart): boolean =>
    part.attributes.some((attribute) => (attribute.name === 'id' || attribute.name === 'transform') && svg.slice(attribute.from, attribute.to).includes('&'));
  return read && !parts.some(entity) ? parts : undefined;
}

const HIDDEN_OPACITY = /^[ \t\r\n\f]*[+-]?(?:0+(?:\.0+)?|\.0+)(?:e[+-]?\d+)?%?[ \t\r\n\f]*$/i;

/** The layers of a drawing's SVG text, back to front; `undefined` when it has none (or too many). */
export function readDrawingLayers(svg: string): readonly DrawingLayer[] | undefined {
  const layers: DrawingLayer[] = [];
  for (const part of topParts(svg) ?? []) {
    const name = part.name === 'g' && part.id !== undefined ? drawingLayerName(part.id) : '';
    if (name === '' || part.id === undefined) continue;
    const hidden = part.attributes.some((attribute) => attribute.name === 'opacity' && HIDDEN_OPACITY.test(svg.slice(attribute.from, attribute.to)));
    layers.push(Object.freeze({ n: layers.length, id: part.id, name, from: part.from, open: part.open, to: part.to, hidden }));
  }
  return layers.length === 0 || layers.length > MAX_DRAWING_LAYERS ? undefined : Object.freeze(layers);
}

const layerCache = new Map<string, readonly DrawingLayer[] | undefined>();
let layerCacheChars = 0;

/** {@link readDrawingLayers}, cached by text. */
export function drawingLayersOf(svg: string): readonly DrawingLayer[] | undefined {
  if (layerCache.has(svg)) return layerCache.get(svg);
  if ((layerCacheChars += svg.length) > DRAWING_LAYER_CACHE_MAX_CHARS) {
    layerCache.clear();
    layerCacheChars = svg.length;
  }
  const layers = readDrawingLayers(svg);
  layerCache.set(svg, layers);
  return layers;
}

/** The layer `ref` names in `svg`: the only one with its id, else the one with its id at its index. */
export function findDrawingLayer(svg: string, ref: LayerRef): DrawingLayer | undefined {
  const same = (drawingLayersOf(svg) ?? []).filter((layer) => layer.id === ref.id);
  return same.length === 1 ? same[0] : same.find((layer) => layer.n === ref.n);
}

/* ------------------------------------------------------------------------ */
/* Editing the text                                                         */
/* ------------------------------------------------------------------------ */

/** `svg` when it is fine to show, within the size limits and with layers in the order `ids`; otherwise why not. */
export function checkLayeredSvg(svg: string, ids: readonly string[]): string | LayerEditRefusal {
  if (svg.length > MAX_SVG_SOURCE_CHARS || normalizeImageSource(svgToBase64DataUrl(svg)) === undefined) return 'long';
  const layers = drawingLayersOf(svg);
  const same = layers !== undefined && layers.length === ids.length && layers.every((layer, index) => layer.id === ids[index]);
  return same && unknownSvgParts(svg).length === 0 ? svg : 'unread';
}

/**
 * Moves a layer so it ends up at index `to` (0 at the back), keeping the
 * text between the others as written. The same text when it is already
 * there.
 */
export function moveDrawingLayer(svg: string, ref: LayerRef, to: number): string | LayerEditRefusal {
  const layer = findDrawingLayer(svg, ref);
  const layers = drawingLayersOf(svg) ?? [];
  if (layer === undefined) return 'gone';
  const index = Math.max(0, Math.min(Math.round(to), layers.length - 1));
  if (index === layer.n) return svg;
  const target = layers[index]!;
  // Above the top layer means just before the root's end tag, so later non-layer parts stay over it.
  const at = index === layers.length - 1 ? svg.lastIndexOf('</') : index > layer.n ? target.to : target.from;
  const own = svg.slice(layer.from, layer.to);
  const moved = at > layer.to ? svg.slice(0, layer.from) + svg.slice(layer.to, at) + own + svg.slice(at) : svg.slice(0, at) + own + svg.slice(at, layer.from) + svg.slice(layer.to);
  const others = layers.filter((other) => other !== layer).map((other) => other.id);
  return checkLayeredSvg(moved, [...others.slice(0, index), layer.id, ...others.slice(index)]);
}

/** The start tag of a layer, read again (with its attributes' places). */
function layerTag(svg: string, layer: DrawingLayer): TopPart | undefined {
  return topParts(svg)?.find((part) => part.from === layer.from);
}

/**
 * Hides a layer (`opacity='0'`) or shows it again (no `opacity`). A layer
 * with an opacity of its own keeps it on a group inside while hidden.
 */
export function setDrawingLayerHidden(svg: string, ref: LayerRef, hidden: boolean): string | LayerEditRefusal {
  const layer = findDrawingLayer(svg, ref);
  const tag = layer === undefined ? undefined : layerTag(svg, layer);
  if (layer === undefined || tag === undefined) return 'gone';
  if (layer.hidden === hidden) return svg;
  const ids = (drawingLayersOf(svg) ?? []).map((other) => other.id);
  const opacity = tag.attributes.find((attribute) => attribute.name === 'opacity');
  let next = svg;
  if (hidden && opacity !== undefined && !tag.empty) {
    const close = svg.lastIndexOf('</', layer.to - 1);
    const own = svg.slice(opacity.from - 1, opacity.to + 1);
    next = `${svg.slice(0, layer.open)}<g opacity=${own}>${svg.slice(layer.open, close)}</g>${svg.slice(close)}`;
  }
  const [start, end] = opacity === undefined ? [tag.from + 1 + tag.name.length, tag.from + 1 + tag.name.length] : [opacity.at, opacity.to + 1];
  next = next.slice(0, start) + (hidden ? " opacity='0'" : '') + next.slice(end);
  return checkLayeredSvg(next, ids);
}

/**
 * The drawing with only one layer (shown, even when hidden) and its
 * `<defs>`, for a thumbnail; `undefined` when it has no such layer.
 */
export function drawingLayerAlone(svg: string, ref: LayerRef): string | undefined {
  const shown = findDrawingLayer(svg, ref) === undefined ? 'gone' : setDrawingLayerHidden(svg, ref, false);
  if (isLayerEditRefusal(shown)) return undefined;
  const own = findDrawingLayer(shown, ref);
  const parts = topParts(shown);
  let rootEnd = 0;
  walkTags(shown, (tag) => {
    if (tag.depth === 0) rootEnd = tag.open;
  });
  if (own === undefined || parts === undefined) return undefined;
  const defs = parts.filter((part) => part.name === 'defs').map((part) => shown.slice(part.from, part.to));
  return shown.slice(0, rootEnd) + defs.join('') + shown.slice(own.from, own.to) + '</svg>';
}

/* ------------------------------------------------------------------------ */
/* Shapes                                                                   */
/* ------------------------------------------------------------------------ */

/** A box `[left, top, right, bottom]` in viewBox units. */
export type LayerBox = readonly [number, number, number, number];

/** What one shown layer draws. */
export interface LayerShapes {
  n: number;
  parts: readonly DrawingPaintPart[];
  /** Around its parts, strokes included. */
  box: LayerBox;
}

/** The shapes of a drawing's layers. */
export interface DrawingLayerShapes {
  /** The viewBox size (from `0 0`). */
  size: readonly [number, number];
  /** Each layer that draws something, back to front (hidden layers draw nothing). */
  layers: readonly LayerShapes[];
}

/** A press on a layer: `solid` when it hit a line or a mostly opaque fill. */
export interface LayerHit {
  n: number;
  solid: boolean;
}

/** The root's size when its picture is laid out plainly: a `0 0 W H` viewBox, no preserveAspectRatio, no opacity, no other size. */
function plainSize(root: XmlElement): readonly [number, number] | undefined {
  const match = /^\s*0[\s,]+0[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)\s*$/.exec(root.getAttribute('viewBox') ?? '');
  const size = match === null ? undefined : ([Number(match[1]), Number(match[2])] as const);
  if (size === undefined || !(size[0] > 0 && size[1] > 0)) return undefined;
  if (root.hasAttribute('preserveAspectRatio') || root.hasAttribute('opacity')) return undefined;
  const fits = (name: string, value: number): boolean => {
    const written = root.getAttribute(name);
    return written === null || written === '100%' || Number(written) === value;
  };
  return fits('width', size[0]) && fits('height', size[1]) ? size : undefined;
}

function partsBox(parts: readonly DrawingPaintPart[]): LayerBox | undefined {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const reach = (part.stroke?.width ?? 0) / 2;
    for (const contour of part.contours)
      for (let index = 0; index + 1 < contour.length; index += 2) {
        const [x, y] = [contour[index]!, contour[index + 1]!];
        left = Math.min(left, x - reach);
        top = Math.min(top, y - reach);
        right = Math.max(right, x + reach);
        bottom = Math.max(bottom, y + reach);
      }
  }
  return left <= right && top <= bottom ? [left, top, right, bottom] : undefined;
}

/** Reads the shapes of each layer; `undefined` when the drawing has no layers, does not vet or is not laid out plainly. */
export function readDrawingLayerShapes(svg: string): DrawingLayerShapes | undefined {
  const layers = drawingLayersOf(svg);
  if (layers === undefined || unknownSvgParts(svg).length > 0) return undefined;
  const root = parseSvgTree(svg);
  if (typeof root === 'string') return undefined;
  const size = plainSize(root);
  // The parsed layers are the root's `<g>` children with a layer id, in the same order as the text's.
  const elements = root.children.filter((child) => child.localName === 'g' && drawingLayerName(child.getAttribute('id') ?? '') !== '');
  if (size === undefined || elements.length !== layers.length) return undefined;
  const shapes: LayerShapes[] = [];
  for (const [n, element] of elements.entries()) {
    const plan = drawingPaintPlan(root, new Set(root.children.filter((child) => child !== element)));
    if (plan === undefined) return undefined;
    const box = partsBox(plan.parts);
    if (box !== undefined) shapes.push({ n, parts: plan.parts, box });
  }
  return { size, layers: shapes };
}

const shapeCache = new Map<string, DrawingLayerShapes | undefined>();
let shapeCacheChars = 0;

/** {@link readDrawingLayerShapes}, cached by text. */
export function drawingLayerShapesOf(svg: string): DrawingLayerShapes | undefined {
  if (shapeCache.has(svg)) return shapeCache.get(svg);
  if ((shapeCacheChars += svg.length) > DRAWING_LAYER_CACHE_MAX_CHARS) {
    shapeCache.clear();
    shapeCacheChars = svg.length;
  }
  const shapes = readDrawingLayerShapes(svg);
  shapeCache.set(svg, shapes);
  return shapes;
}

function distanceToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) || 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** How a press at `x, y` (viewBox units, `slop` around lines) meets one part: `solid`, `faint` (a see-through fill) or not at all. */
export function paintPartHit(part: DrawingPaintPart, x: number, y: number, slop: number): 'solid' | 'faint' | undefined {
  const reach = (part.stroke?.width ?? 0) / 2 + slop;
  const weight = (part.fill?.alpha ?? 0) >= SOLID_LAYER_FILL_ALPHA ? 'solid' : 'faint';
  let winding = 0;
  for (const contour of part.contours) {
    const count = contour.length / 2;
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count;
      const [ax, ay, bx, by] = [contour[2 * index]!, contour[2 * index + 1]!, contour[2 * next]!, contour[2 * next + 1]!];
      const edge = part.closed || index + 1 < count || count === 1;
      if (edge && distanceToSegment(x, y, ax, ay, bx, by) <= reach) return part.stroke === undefined ? weight : 'solid';
      if (ay <= y === by <= y) continue;
      const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (by > ay ? cross > 0 : cross < 0) winding += by > ay ? 1 : -1;
    }
  }
  return part.fill !== undefined && winding !== 0 ? weight : undefined;
}

/** The layers under a point (viewBox units), front to back. */
export function drawingLayerHits(shapes: DrawingLayerShapes, x: number, y: number, slop: number): LayerHit[] {
  const hits: LayerHit[] = [];
  for (const layer of shapes.layers.toReversed()) {
    const [left, top, right, bottom] = layer.box;
    if (x < left - slop || x > right + slop || y < top - slop || y > bottom + slop) continue;
    const met = layer.parts.map((part) => paintPartHit(part, x, y, slop));
    if (met.some((hit) => hit !== undefined)) hits.push({ n: layer.n, solid: met.includes('solid') });
  }
  return hits;
}

/** The layer a press picks: the frontmost solid one under it, else the frontmost one. */
export function topDrawingLayerHit(hits: readonly LayerHit[]): number | undefined {
  return (hits.find((hit) => hit.solid) ?? hits[0])?.n;
}

/** The layer the keyboard picks first: the frontmost with a solid part, else the frontmost that draws. */
export function firstSolidDrawingLayer(shapes: DrawingLayerShapes): number | undefined {
  const solid = (part: DrawingPaintPart): boolean => part.stroke !== undefined || (part.fill?.alpha ?? 0) >= SOLID_LAYER_FILL_ALPHA;
  const layers = shapes.layers.toReversed();
  return (layers.find((layer) => layer.parts.some(solid)) ?? layers[0])?.n;
}

/** The nearest layer over (`forward`) or under (`backward`) layer `n` that overlaps it. */
export function overlappingDrawingLayer(shapes: DrawingLayerShapes, n: number, direction: 'forward' | 'backward'): number | undefined {
  const own = shapes.layers.find((layer) => layer.n === n)?.box;
  if (own === undefined) return undefined;
  const overlaps = (box: LayerBox): boolean => box[0] <= own[2] && own[0] <= box[2] && box[1] <= own[3] && own[1] <= box[3];
  const candidates = shapes.layers.filter((layer) => (direction === 'forward' ? layer.n > n : layer.n < n) && overlaps(layer.box));
  return (direction === 'forward' ? candidates[0] : candidates.at(-1))?.n;
}

/* ------------------------------------------------------------------------ */
/* Placement                                                                */
/* ------------------------------------------------------------------------ */

/** How a drawing's viewBox sits in its frame: frame point = `x + viewBox point × scale`. */
export interface DrawingPlacement {
  scale: number;
  x: number;
  y: number;
}

/**
 * Where a drawing of viewBox `size` sits in a `w × h` frame: covering it,
 * then zoomed by `crop.zoom` and panned by `crop.x`, `crop.y` (0–1).
 */
export function drawingPlacement(w: number, h: number, size: readonly [number, number], crop?: { zoom: number; x: number; y: number }): DrawingPlacement {
  const zoom = crop?.zoom ?? 1;
  const [panX, panY] = [crop?.x ?? 0.5, crop?.y ?? 0.5];
  // The picture box, scaled by the zoom and moved by the pan.
  const [boxW, boxH] = [w * zoom, h * zoom];
  const [boxX, boxY] = [-(zoom - 1) * panX * w, -(zoom - 1) * panY * h];
  // Inside it, the drawing covers the box, placed by the pan.
  const scale = Math.max(boxW / size[0], boxH / size[1]);
  return { scale, x: boxX + (boxW - size[0] * scale) * panX, y: boxY + (boxH - size[1] * scale) * panY };
}
