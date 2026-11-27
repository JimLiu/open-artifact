/**
 * Copied artboards, notes and elements placed into an artboard as
 * positioned layers: where the drop point is, how the layers keep their
 * places around it, and the markup that puts each one there.
 */

import { applySplices, attributeValue, elementChildren, parseTemplate, setStyle, styleMap, type StylePatch } from '@open-artifact/dc';
import type { Rect } from '@open-artifact/design-core';
import { pixels } from './layout-write-back.ts';

/** How far apart repeated pastes cascade; also how much overlap keeps elements where they were. */
export const CASCADE_STEP = 24;

/**
 * The point (in the artboard's own pixels) pasted things centre on: the
 * artboard's centre while it is in view, else the centre of the part of it
 * that is in view. `view` is the visible part of the canvas, `null` in the
 * focused view (the artboard's centre).
 */
export function dropPoint(board: Rect, view: Rect | null): { x: number; y: number } {
  const centre = { x: board.x + board.w / 2, y: board.y + board.h / 2 };
  const inside = (point: { x: number; y: number }, rect: Rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
  if (!view || inside(centre, view)) return { x: centre.x - board.x, y: centre.y - board.y };
  const left = Math.max(board.x, view.x), right = Math.min(board.x + board.w, view.x + view.w);
  const top = Math.max(board.y, view.y), bottom = Math.min(board.y + board.h, view.y + view.h);
  if (left >= right || top >= bottom) return { x: board.w / 2, y: board.h / 2 };
  return { x: (left + right) / 2 - board.x, y: (top + bottom) / 2 - board.y };
}

/** The bounds of some boxes. */
export function boundsOf(boxes: readonly Rect[]): Rect {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return { x, y, w: Math.max(...boxes.map((box) => box.x + box.w)) - x, h: Math.max(...boxes.map((box) => box.y + box.h)) - y };
}

/**
 * True when elements copied from this same artboard stay where they were:
 * their bounds overlap the container by at least their own size or one
 * cascade step, both across and down.
 */
export function staysInPlace(group: Rect, container: Rect, step = CASCADE_STEP): boolean {
  const across = Math.min(group.x + group.w, container.x + container.w) - Math.max(group.x, container.x);
  const down = Math.min(group.y + group.h, container.y + container.h) - Math.max(group.y, container.y);
  return across >= Math.min(group.w, step) && down >= Math.min(group.h, step);
}

/**
 * One element's markup with `patch` written into its inline style.
 * `null` when the markup is not one element.
 */
export function styledMarkup(html: string, patch: StylePatch): string | null {
  const model = parseTemplate(html.trim());
  const tops = elementChildren(model.nodes);
  if (tops.length !== 1 || model.nodes.some((node) => node.type === 'text' && node.value.trim())) return null;
  try {
    return applySplices(model.text, setStyle(model, tops[0]!, patch));
  } catch {
    return null;
  }
}

/**
 * The styles that put a layer at (`left`, `top`) of its container: absolute,
 * without margins. An artboard's root (`width` given) also keeps its width.
 */
export function layerPatch(html: string, left: number, top: number, width?: number): StylePatch {
  const model = parseTemplate(html.trim());
  const element = elementChildren(model.nodes)[0];
  const patch: Record<string, string | null> = {};
  if (element) for (const property of Object.keys(styleMap(attributeValue(element, 'style') ?? ''))) if (property.startsWith('margin')) patch[property] = null;
  if (width !== undefined) Object.assign(patch, { 'box-sizing': 'border-box', width: pixels(width) });
  return Object.assign(patch, { position: 'absolute', left: pixels(left), top: pixels(top), right: 'auto', bottom: 'auto', margin: '0px' });
}

/** A layer to place: its markup, its box (any common coordinates) and its note groups, innermost first. */
export interface Layer {
  html: string;
  box: Rect;
  groups?: readonly string[];
  /** An artboard's root keeps its width. */
  root?: boolean;
}

/** A group box: what ungrouping recognises. */
export function groupBoxHtml(box: Rect, inner: string): string {
  return `<div data-dc-group style="box-sizing: border-box; position: absolute; margin: 0px; left: ${pixels(box.x)}; top: ${pixels(box.y)}; width: ${pixels(box.w)}; height: ${pixels(box.h)}">${inner}</div>`;
}

/**
 * The markup of `layers` around `centre` (in the container's pixels): each
 * keeps its place relative to the others, the whole centred there. Layers
 * sharing a group (two or more of them) go in a group box, outer groups
 * outside. `null` when a layer's markup is not one element.
 */
export function arrangeLayers(layers: readonly Layer[], centre: { x: number; y: number }): string | null {
  if (!layers.length) return '';
  const all = boundsOf(layers.map((layer) => layer.box));
  const origin = { x: centre.x - all.w / 2 - all.x, y: centre.y - all.h / 2 - all.y };
  const counts = new Map<string, number>();
  for (const layer of layers) for (const group of layer.groups ?? []) counts.set(group, (counts.get(group) ?? 0) + 1);
  // Outer groups first; groups of a single layer are not boxed.
  const chainOf = (layer: Layer) => [...(layer.groups ?? [])].reverse().filter((group) => (counts.get(group) ?? 0) > 1);
  const place = (members: readonly Layer[], depth: number, offset: { x: number; y: number }): string | null => {
    const out: string[] = [];
    const done = new Set<string>();
    for (const layer of members) {
      const group = chainOf(layer)[depth];
      if (group === undefined) {
        const markup = styledMarkup(layer.html, layerPatch(layer.html, layer.box.x + offset.x, layer.box.y + offset.y, layer.root ? layer.box.w : undefined));
        if (markup === null) return null;
        out.push(markup);
        continue;
      }
      if (done.has(group)) continue;
      done.add(group);
      const inside = members.filter((other) => chainOf(other)[depth] === group);
      const box = boundsOf(inside.map((other) => other.box));
      const inner = place(inside, depth + 1, { x: -box.x, y: -box.y });
      if (inner === null) return null;
      out.push(groupBoxHtml({ x: box.x + offset.x, y: box.y + offset.y, w: box.w, h: box.h }, inner));
    }
    return out.join('\n');
  };
  return place(layers, 0, origin);
}
