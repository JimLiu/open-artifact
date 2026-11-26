/**
 * Geometry for pointer gestures on elements inside artboards: the marquee
 * (which elements a dragged box selects) and moving elements in the flow
 * (where a dragged element would land among its siblings).
 *
 * Rects come from the board runtime in artboard pixels and are returned in
 * world coordinates (artboard origin added).
 */

import { attributeValue, contains, elementChildren, elementPath, holdsText, styleMap, VOID_ELEMENTS, type HtmlElement, type TemplateModel } from '@open-artifact/dc';
import type { Rect } from '@open-artifact/design-core';
import { combineSelection, flowDrop, marqueeHits, type FlowContext, type FlowDrop, type MarqueeCandidate } from '../lib/gestures.ts';
import type { Address } from '../lib/ops.ts';
import { useDocument } from '../state/document.ts';
import type { ElementSelection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { boardApi } from './frames.ts';
import { isElementLocked } from '../lib/locks.ts';

export { combineSelection, flowDrop, marqueeHits, type FlowContext, type FlowDrop, type MarqueeCandidate };

/** The single top-level element of a template (its root), if it has one. */
export function templateRoot(model: TemplateModel): HtmlElement | null {
  const tops = elementChildren(model.nodes).filter((el) => el.tag !== 'helmet');
  return tops.length === 1 ? tops[0]! : null;
}

/** The root element's address in an artboard, if it has a single root. */
export function rootAddress(board: string): Address | null {
  const source = useDocument.getState().boards[board]?.source;
  if (!source) return null;
  const model = templateOf(source);
  const root = templateRoot(model);
  return root ? { tid: model.tidOf.get(root)!, path: elementPath(model, root) } : null;
}

/** World rects of elements, by tid. */
function worldRects(board: string, tids: number[]): Record<number, Rect[]> {
  const entry = useDocument.getState().canvas.boards[board];
  const api = boardApi(board);
  if (!entry || !api) return {};
  let rects: ReturnType<typeof api.rects>;
  try {
    rects = api.rects(tids);
  } catch {
    return {};
  }
  const out: Record<number, Rect[]> = {};
  for (const tid of tids) out[tid] = (rects[tid] ?? []).filter((r) => r.width || r.height).map((r) => ({ x: entry.x + r.x, y: entry.y + r.y, w: r.width, h: r.height }));
  return out;
}

/**
 * Candidates of a marquee in an artboard. `container` limits it to that
 * element's children (looking through elements that render no box, such as
 * repeats and conditions); `null` takes every element (deep marquee).
 */
export function marqueeCandidates(board: string, container: Address | null): MarqueeCandidate[] {
  const source = useDocument.getState().boards[board]?.source;
  if (!source) return [];
  const model = templateOf(source);
  // A box passes over locked elements (a read-only view keeps them).
  const readOnly = useDocument.getState().readOnly;
  const all = model.elements.filter((el) => el.tag !== 'helmet' && !hasAncestor(el, 'helmet') && (readOnly || !isElementLocked(el)));
  const rects = worldRects(board, all.map((el) => model.tidOf.get(el)!));
  const candidate = (el: HtmlElement): MarqueeCandidate => ({ tid: model.tidOf.get(el)!, path: elementPath(model, el), rects: rects[model.tidOf.get(el)!] ?? [] });
  if (!container) return all.map(candidate).filter((c) => c.rects.length);
  const parent = model.elements[container.tid];
  if (!parent) return [];
  const out: MarqueeCandidate[] = [];
  const visit = (list: HtmlElement[]) => {
    for (const el of list) {
      if (!readOnly && isElementLocked(el)) continue;
      const c = candidate(el);
      if (c.rects.length) out.push(c);
      else visit(elementChildren(el));
    }
  };
  visit(elementChildren(parent));
  return out;
}

function hasAncestor(element: HtmlElement, tag: string): boolean {
  for (let node = element.parent; node; node = node.parent) if (node.tag === tag) return true;
  return false;
}

/* ----------------------------- flow moving ------------------------------ */

/** Containers that cannot take dragged elements (they hold words, or are not real boxes). */
const NOT_CONTAINERS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button', 'label', 'strong', 'em', 'b', 'i', 'u', 's', 'code',
  'small', 'sub', 'sup', 'mark', 'q', 'pre', 'blockquote', 'figcaption', 'caption', 'legend', 'option', 'select',
  'textarea', 'svg', 'canvas', 'video', 'audio', 'picture', 'img', 'iframe', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'td', 'th', 'ul', 'ol', 'dl', 'script', 'style', 'helmet', 'sc-for', 'sc-if', 'dc-import', 'x-import',
]);

/** Elements that only make sense in their own parent (list items, table parts). */
const BOUND = new Set(['li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'option', 'col', 'colgroup', 'source', 'track']);

function canContain(element: HtmlElement): boolean {
  // Nothing is dropped into a locked element.
  if (isElementLocked(element)) return false;
  if (VOID_ELEMENTS.has(element.tag) || element.closeStart < 0 || NOT_CONTAINERS.has(element.tag) || holdsText(element)) return false;
  for (let up = element.parent; up; up = up.parent) if (up.tag === 'svg' || up.tag === 'sc-for' || up.tag === 'dc-import' || up.tag === 'x-import') return false;
  return true;
}

/** How a container lays out its children, from its computed style. */
function layoutOf(board: string, model: TemplateModel, container: HtmlElement | null): FlowContext['layout'] {
  const tid = container ? model.tidOf.get(container) : undefined;
  const computed = tid !== undefined ? boardApi(board)?.inspect(tid)?.computed : undefined;
  if (!computed) return 'column';
  if (computed.display.includes('grid')) return 'grid';
  if (computed.display.includes('flex')) return computed['flex-direction'].startsWith('column') ? 'column' : 'row';
  return 'column';
}

/** The drag context of moving elements among a container's children. */
function contextIn(board: string, model: TemplateModel, elements: readonly HtmlElement[], container: HtmlElement | null, items: readonly ElementSelection[] | null): FlowContext {
  const others = (container ? elementChildren(container) : elementChildren(model.nodes)).filter((el) => el.tag !== 'helmet' && !elements.includes(el));
  const rects = worldRects(board, [...others, ...elements].map((el) => model.tidOf.get(el)!));
  const origin = items
    ? items.flatMap((item) => {
        const rect = rects[item.tid]?.[item.instance] ?? rects[item.tid]?.[0];
        return rect ? [rect] : [];
      })
    : undefined;
  const siblings = others.flatMap((el) => {
    const rect = rects[model.tidOf.get(el)!]?.[0];
    return rect ? [{ address: { tid: model.tidOf.get(el)!, path: elementPath(model, el) }, rect }] : [];
  });
  return { board, siblings, layout: layoutOf(board, model, container), origin };
}

/**
 * Where selected flow elements dropped at a world point would land: among
 * their siblings, or inside another container under the point (one big
 * enough to take them). `null` when nothing would change.
 */
export function flowDropAt(board: string, items: readonly ElementSelection[], point: { x: number; y: number }): FlowDrop | null {
  const source = useDocument.getState().boards[board]?.source;
  const entry = useDocument.getState().canvas.boards[board];
  const api = boardApi(board);
  if (!source || !entry || !api || !items.length) return null;
  const model = templateOf(source);
  const elements = items.map((item) => model.elements[item.tid]).filter((el): el is HtmlElement => Boolean(el));
  const parent = elements[0]?.parent ?? null;
  if (!elements.length || elements.some((el) => el.parent !== parent)) return null;

  // The container under the pointer.
  let container: HtmlElement | null = parent;
  if (!elements.some((el) => BOUND.has(el.tag))) {
    const dragged = worldRects(board, elements.map((el) => model.tidOf.get(el)!));
    const area = Object.values(dragged).reduce((sum, rects) => sum + (rects[0] ? rects[0].w * rects[0].h : 0), 0);
    const width = Math.max(0, ...Object.values(dragged).map((rects) => rects[0]?.w ?? 0));
    const height = Math.max(0, ...Object.values(dragged).map((rects) => rects[0]?.h ?? 0));
    let picks: ReturnType<typeof api.pickAll> = [];
    try {
      picks = api.pickAll(point.x - entry.x, point.y - entry.y);
    } catch {
      picks = [];
    }
    const ancestors = new Set<HtmlElement>();
    for (let up = parent; up; up = up.parent) ancestors.add(up);
    const found = picks
      .map((pick) => ({ element: model.elements[pick.tid], rect: pick.rect }))
      .find(({ element, rect }) => {
        if (!element || elements.some((el) => contains(el, element)) || !canContain(element)) return false;
        if (ancestors.has(element)) return true;
        // Only containers clearly bigger than what is dragged take it.
        return rect.width * rect.height >= area * 1.1 && !(rect.width < width && rect.height < height);
      });
    container = found?.element ?? templateRoot(model) ?? parent;
  }

  const context = contextIn(board, model, elements, container, container === parent ? items : null);
  const containerRect = container ? worldRects(board, [model.tidOf.get(container)!])[model.tidOf.get(container)!]?.[0] : undefined;
  const outline = container !== parent && containerRect ? containerRect : undefined;
  if (container !== parent && container && !context.siblings.length) {
    return { target: { tid: model.tidOf.get(container)!, path: elementPath(model, container) }, position: 'last-child', line: null, outline };
  }
  const drop = flowDrop(context, point);
  return drop ? { ...drop, outline } : null;
}

/** Inherited text styles to keep on elements moving to another parent, so they look the same there. */
const INHERITED_TEXT = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform'];

/** Style patches that freeze the moved elements' inherited text styles, for a move into `drop`'s container. */
export function freezeInherited(board: string, items: readonly ElementSelection[], drop: FlowDrop): { target: Address; patch: Record<string, string> }[] {
  const source = useDocument.getState().boards[board]?.source;
  const api = boardApi(board);
  if (!source || !api) return [];
  const model = templateOf(source);
  const target = model.elements[drop.target.tid];
  if (!target) return [];
  const newParent = drop.position === 'last-child' ? target : target.parent;
  const elements = items.map((item) => model.elements[item.tid]).filter((el): el is HtmlElement => Boolean(el));
  if (!elements.length || elements[0]!.parent === newParent) return [];
  const parentStyle = newParent ? api.inspect(model.tidOf.get(newParent)!)?.computed : undefined;
  if (!parentStyle) return [];
  const out: { target: Address; patch: Record<string, string> }[] = [];
  for (const element of elements) {
    const computed = api.inspect(model.tidOf.get(element)!)?.computed;
    if (!computed) continue;
    const inline = styleMap(attributeValue(element, 'style') ?? '');
    const patch: Record<string, string> = {};
    for (const property of INHERITED_TEXT) {
      if (inline[property] || inline.font) continue;
      if (computed[property] && computed[property] !== parentStyle[property]) patch[property] = computed[property]!;
    }
    if (Object.keys(patch).length) out.push({ target: { tid: model.tidOf.get(element)!, path: elementPath(model, element) }, patch });
  }
  return out;
}
