/**
 * What Copy / Paste properties reads and writes on an element: a graphic
 * with one shape is its shape, and some elements take no paste at all.
 */

import { elementKind, hasDynamicStyle, type HtmlElement } from '@open-artifact/dc';
import { loneShapeOf } from './lone-shape.ts';
import type { ElementClass } from './style-clipboard.ts';

const DRAWN = new Set(['svg', 'rect', 'circle', 'ellipse', 'polygon', 'path', 'line', 'polyline']);
/** Elements no paste lands on: component instances, repeats and conditions, the head. */
export const REFUSED = new Set(['x-import', 'dc-import', 'sc-if', 'sc-for', 'helmet', 'script', 'style']);

/** The element a look is read from and written to (a graphic's single shape), and its kind. */
export function subjectOf(element: HtmlElement): { element: HtmlElement; kind: ElementClass } {
  if (element.tag === 'svg') {
    const shape = loneShapeOf(element);
    if (shape) return { element: shape, kind: 'shape' };
  }
  if (element.tag === 'hr') return { element, kind: 'rule' };
  const kind = elementKind(element);
  if (kind === 'image') return { element, kind: 'image' };
  if (DRAWN.has(element.tag)) return { element, kind: 'shape' };
  if (kind === 'text') return { element, kind: 'text' };
  return { element, kind: 'box' };
}

/** True when no paste lands on `element`: it or an ancestor is refused, or its style is computed. */
export function refuses(element: HtmlElement): boolean {
  for (let at: HtmlElement | null = element; at; at = at.parent) if (REFUSED.has(at.tag)) return true;
  return hasDynamicStyle(element);
}
