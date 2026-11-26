/**
 * A graphic holding a single shape (an arrow, a line, a drawn stroke, an
 * icon of one path) reads as one layer: the layers list shows one row for
 * it, its fill and stroke are written where they take effect, and it
 * stacks as the graphic.
 */

import { attributeValue, elementChildren, parseStyle, type HtmlElement } from '@open-artifact/dc';

const SHAPE_TAGS = new Set(['path', 'line', 'circle', 'rect', 'ellipse', 'polygon', 'polyline']);

/** Paint written on a shape or its graphic. */
const PAINT = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit']);
/** How the whole layer looks. */
const LAYER_LOOK = new Set(['opacity', 'filter', 'mix-blend-mode']);
/** Where the shape is and what it is made of. */
const GEOMETRY = new Set(['d', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'pathlength', 'marker-start', 'marker-mid', 'marker-end', 'vector-effect', 'paint-order', 'clip-rule', 'shape-rendering']);
/** Attributes any layer may carry. */
const BOOKKEEPING = new Set(['style', 'data-label', 'data-locked']);

const isAppearance = (name: string): boolean => PAINT.has(name) || LAYER_LOOK.has(name);
const isGeometry = (shape: HtmlElement, name: string): boolean => GEOMETRY.has(name) || (shape.tag === 'rect' && (name === 'width' || name === 'height'));

/** Whether an element sits inside another graphic. */
function insideGraphic(element: HtmlElement): boolean {
  for (let node = element.parent; node; node = node.parent) if (node.tag === 'svg') return true;
  return false;
}

/** Only arrowheads: `<marker>`, or `<defs>` holding nothing but markers. */
function onlyMarkers(element: HtmlElement): boolean {
  if (element.tag === 'marker') return true;
  return element.tag === 'defs' && elementChildren(element).every((child) => child.tag === 'marker');
}

/** The one shape of a graphic that is a single layer, or `null`. */
export function loneShapeOf(svg: HtmlElement): HtmlElement | null {
  if (svg.tag !== 'svg' || insideGraphic(svg) || attributeValue(svg, 'data-uneditable') !== undefined) return null;
  const kids = elementChildren(svg);
  const shapes = kids.filter((child) => SHAPE_TAGS.has(child.tag));
  if (shapes.length !== 1 || kids.some((child) => !SHAPE_TAGS.has(child.tag) && !onlyMarkers(child))) return null;
  const shape = shapes[0]!;
  if (elementChildren(shape).length) return null;
  const shapeStyle = attributeValue(shape, 'style') ?? '';
  if (shapeStyle.includes('{{')) return null;
  const shapeLook = parseStyle(shapeStyle).map((d) => d.property.toLowerCase());
  if (shapeLook.some((property) => !isAppearance(property) && property !== 'border-color')) return null;
  const svgNames = new Set(svg.attrs.map((attr) => attr.name.toLowerCase()));
  for (const attr of shape.attrs) {
    const name = attr.name.toLowerCase();
    if (BOOKKEEPING.has(name) || isAppearance(name)) continue;
    if (!isGeometry(shape, name) || svgNames.has(name)) return null;
  }
  // The same layer look on both would leave the layer two answers.
  const svgLook = new Set(parseStyle(attributeValue(svg, 'style') ?? '').map((d) => d.property.toLowerCase()));
  for (const property of LAYER_LOOK) {
    const onShape = shapeLook.includes(property) || attributeValue(shape, property) !== undefined;
    const onSvg = svgLook.has(property) || svgNames.has(property);
    if (onShape && onSvg) return null;
  }
  return shape;
}

/** The single-layer graphic a shape belongs to, or `null`. */
export function loneGraphicOf(shape: HtmlElement): HtmlElement | null {
  const svg = shape.parent;
  return svg && loneShapeOf(svg) === shape ? svg : null;
}

/** The element that stands for a layer: a lone shape's graphic, else the element itself. */
export function layerOf(element: HtmlElement): HtmlElement {
  return loneGraphicOf(element) ?? element;
}

const SHAPE_NAMES: Record<string, string> = { rect: 'Rectangle', circle: 'Ellipse', ellipse: 'Ellipse', polygon: 'Polygon', polyline: 'Line', line: 'Line', path: 'Vector' };

/** A paint or look declared on an element (style first, then the attribute). */
function declared(element: HtmlElement, property: string): string | undefined {
  const fromStyle = parseStyle(attributeValue(element, 'style') ?? '').find((d) => d.property.toLowerCase() === property)?.value;
  return fromStyle ?? attributeValue(element, property);
}

/** The layer name of a single-shape graphic. */
export function loneShapeName(svg: HtmlElement, shape: HtmlElement): string {
  const headed = ['marker-start', 'marker-end'].some((name) => (declared(shape, name) ?? '').trim() && declared(shape, name)!.trim() !== 'none');
  if (headed) return 'Arrow';
  if (kidsHaveMarkers(svg) && (shape.tag === 'line' || shape.tag === 'polyline' || shape.tag === 'path')) return 'Line';
  const stretched = (attributeValue(svg, 'preserveAspectRatio') ?? '').trim() === 'none';
  const unfilled = [declared(svg, 'fill'), declared(shape, 'fill')].some((value) => value?.trim() === 'none');
  if (shape.tag === 'path' && stretched && unfilled) return 'Drawing';
  return SHAPE_NAMES[shape.tag] ?? 'Vector';
}

function kidsHaveMarkers(svg: HtmlElement): boolean {
  return elementChildren(svg).some(onlyMarkers);
}

/** Whether a paint value counts as written (not empty, not `inherit`). */
const written = (value: string | undefined): boolean => Boolean(value?.trim()) && value!.trim() !== 'inherit';

/**
 * Where a paint or look property of a single-shape layer goes: on the shape
 * when the shape already has it, when the graphic doesn't (or styles it from
 * a class), or when the fill is being removed; on the graphic otherwise.
 * Anything that is no paint (opacity, filter…) stays on the graphic.
 */
export function paintTargetOf(svg: HtmlElement, shape: HtmlElement, property: string, value: string | null): 'shape' | 'svg' {
  const name = property.toLowerCase();
  if (!PAINT.has(name)) return 'svg';
  if (written(declared(shape, name))) return 'shape';
  if (!written(declared(svg, name)) || attributeValue(svg, 'class') !== undefined) return 'shape';
  if (name === 'fill' && value?.trim() === 'none') return 'shape';
  return 'svg';
}

/** True for a fill, stroke or other paint property. */
export const isPaintProperty = (property: string): boolean => PAINT.has(property.toLowerCase());
