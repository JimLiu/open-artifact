/**
 * Layer edits that can be undone and redone on the SVG as it is then.
 *
 * Other people may change the same drawing between an edit and its undo
 * (another layer moved, a layer added). So an edit never puts the whole
 * drawing back: it remembers what it did to its own layer and does only
 * that again, finding the layer by its id and its text. When the layer
 * is no longer as the edit left it, undo and redo say `'gone'`.
 */

import {
  checkLayeredSvg,
  drawingBodyStart,
  drawingLayersOf,
  findDrawingLayer,
  isLayerEditRefusal,
  moveDrawingLayer,
  setDrawingLayerHidden,
  type DrawingLayer,
  type LayerEditRefusal,
  type LayerRef,
} from './layers.ts';

/** An edit of one layer: `apply` makes it (first at its ref, later again), `revert` takes it back. */
export interface DrawingLayerEdit {
  /** The new SVG, the same SVG when nothing changes, or why it can't be made. */
  apply(svg: string): string | LayerEditRefusal;
  revert(svg: string): string | LayerEditRefusal;
}

/** Where a move puts a layer: an index (0 at the back), or the front or back of the drawing then. */
export type LayerDestination = number | 'front' | 'back';

function ownText(svg: string, layer: DrawingLayer): string {
  return svg.slice(layer.from, layer.to);
}

function layerIds(svg: string): string[] {
  return (drawingLayersOf(svg) ?? []).map((layer) => layer.id);
}

/** The layer with `ref`'s id whose text is `text`, at `ref`'s index when several are. */
function layerHolding(svg: string, ref: LayerRef, text: string): DrawingLayer | undefined {
  let found: DrawingLayer | undefined;
  for (const layer of drawingLayersOf(svg) ?? []) {
    if (layer.id !== ref.id || ownText(svg, layer) !== text) continue;
    if (layer.n === ref.n) return layer;
    found ??= layer;
  }
  return found;
}

/** Hides or shows one layer. */
export function layerVisibilityEdit(ref: LayerRef, hidden: boolean): DrawingLayerEdit {
  let texts: { before: string; after: string } | undefined;
  const replace = (svg: string, from: string, to: string): string | LayerEditRefusal => {
    const layer = layerHolding(svg, ref, from);
    if (layer === undefined) return 'gone';
    return checkLayeredSvg(svg.slice(0, layer.from) + to + svg.slice(layer.to), layerIds(svg));
  };
  return {
    apply(svg) {
      if (texts !== undefined) return replace(svg, texts.before, texts.after);
      const layer = findDrawingLayer(svg, ref);
      if (layer === undefined) return 'gone';
      const next = setDrawingLayerHidden(svg, layer, hidden);
      if (isLayerEditRefusal(next) || next === svg) return next;
      const changed = drawingLayersOf(next)?.[layer.n];
      if (changed !== undefined) texts = { before: ownText(svg, layer), after: ownText(next, changed) };
      return next;
    },
    revert(svg) {
      return texts === undefined ? 'gone' : replace(svg, texts.after, texts.before);
    },
  };
}

/**
 * What a moved layer needs to go back: the layer it sat on (by id and index,
 * none when it was at the back) and the text between that layer and it.
 */
interface MoveOrigin {
  base: LayerRef | undefined;
  /** The moved layer's index before it moved. */
  index: number;
  spacing: string;
}

function originOf(svg: string, layer: DrawingLayer): MoveOrigin {
  const layers = drawingLayersOf(svg) ?? [];
  const base = layer.n > 0 ? layers[layer.n - 1] : undefined;
  const spacingStart = base === undefined ? drawingBodyStart(svg) : base.to;
  return { base: base && { n: base.n, id: base.id }, index: layer.n, spacing: svg.slice(spacingStart, layer.from) };
}

/** The layer a moved layer goes back onto now: its old base, or else whatever sits at the old place below it. */
function baseNow(layers: readonly DrawingLayer[], origin: MoveOrigin): DrawingLayer | undefined {
  if (origin.base === undefined) return undefined;
  const { id } = origin.base;
  const below = layers.filter((layer) => layer.id === id && layer.n < origin.index);
  if (below.length > 0) return below[below.length - 1];
  return layers.find((layer) => layer.id === id) ?? layers[Math.min(origin.index, layers.length) - 1];
}

/** Puts `text` (a layer with id `id`) back onto its base in `svg`, which no longer holds it. */
function restoreLayer(svg: string, id: string, text: string, origin: MoveOrigin): string | LayerEditRefusal {
  const layers = drawingLayersOf(svg) ?? [];
  const base = baseNow(layers, origin);
  const edge = base === undefined ? drawingBodyStart(svg) : base.to;
  let at: number;
  if (svg.startsWith(origin.spacing, edge)) at = edge + origin.spacing.length;
  else at = base === undefined ? (layers[0]?.from ?? edge) : base.to;
  const order = layers.map((layer) => layer.id);
  order.splice(base === undefined ? 0 : base.n + 1, 0, id);
  return checkLayeredSvg(svg.slice(0, at) + text + svg.slice(at), order);
}

/** Moves one layer to `to`. */
export function layerMoveEdit(ref: LayerRef, to: LayerDestination): DrawingLayerEdit {
  let origin: MoveOrigin | undefined;
  let text = '';
  /** Whether the drawing holds the edit now (made or redone, not undone). */
  let holds = false;
  const find = (svg: string): DrawingLayer | undefined => {
    if (origin === undefined) return findDrawingLayer(svg, ref);
    const exact = layerHolding(svg, ref, text);
    if (exact !== undefined) return exact;
    const same = (drawingLayersOf(svg) ?? []).filter((layer) => layer.id === ref.id);
    return same.length === 1 ? same[0] : undefined;
  };
  return {
    apply(svg) {
      if (holds) return 'gone';
      const layer = find(svg);
      if (layer === undefined) return 'gone';
      const last = (drawingLayersOf(svg)?.length ?? 1) - 1;
      const next = moveDrawingLayer(svg, layer, to === 'front' ? last : to === 'back' ? 0 : to);
      if (isLayerEditRefusal(next) || next === svg) return next;
      if (origin === undefined) {
        origin = originOf(svg, layer);
        text = ownText(svg, layer);
      }
      holds = true;
      return next;
    },
    revert(svg) {
      const layer = holds && origin !== undefined ? find(svg) : undefined;
      if (layer === undefined || origin === undefined) return 'gone';
      const back = restoreLayer(svg.slice(0, layer.from) + svg.slice(layer.to), layer.id, ownText(svg, layer), origin);
      if (!isLayerEditRefusal(back)) holds = false;
      return back;
    },
  };
}
