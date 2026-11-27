/**
 * Fill and stroke commands on the selection: X takes the fill away, ⇧X
 * swaps fill and stroke, and Remove fill clears every part of a
 * background. Elements are edited through `edit` (one undo step each
 * command); shape notes through the canvas. Appearance goes through on
 * locked layers: the lock keeps only their place and size.
 */

import { elementPath, styleMap, type HtmlElement, type StylePatch, type TemplateModel } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import type { Address, BoardOp } from '../lib/ops.ts';
import { isPaintProperty, loneShapeOf, paintTargetOf } from '../lib/lone-shape.ts';
import { boxSwap, clipsToText, noteSwap, noteUnfill, REMOVE_FILL_PATCH, shapeSwap, SHAPE_UNFILL_PATCH, NOTHING_TO_UNFILL, SWAP_MESSAGES, swapReport, UNFILL_PATCH, type SwapRefusal } from '../lib/paint.ts';
import { edit, selectedElements } from './commands.ts';
import { boardApi } from './frames.ts';
import { announce } from './announce.ts';

const SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path', 'line', 'polyline']);

const address = (model: TemplateModel, element: HtmlElement): Address => ({ tid: model.tidOf.get(element)!, path: elementPath(model, element) });

/** What a paint edit lands on: a shape (with its single-layer graphic, if any) or a box. */
function paintSubject(element: HtmlElement): { shape: HtmlElement; svg: HtmlElement | null } | { box: HtmlElement } | null {
  if (SHAPES.has(element.tag)) return { shape: element, svg: element.parent && loneShapeOf(element.parent) === element ? element.parent : null };
  if (element.tag === 'svg') {
    const shape = loneShapeOf(element);
    return shape ? { shape, svg: element } : null;
  }
  return { box: element };
}

/** A shape's style patch split between it and its single-layer graphic. */
function shapeEdits(model: TemplateModel, shape: HtmlElement, svg: HtmlElement | null, patch: StylePatch): { target: Address; patch: StylePatch }[] {
  if (!svg) return [{ target: address(model, shape), patch }];
  const onShape: Record<string, string | null> = {};
  const onSvg: Record<string, string | null> = {};
  for (const [property, value] of Object.entries(patch)) (paintTargetOf(svg, shape, property, value) === 'shape' ? onShape : onSvg)[property] = value;
  return [
    ...(Object.keys(onShape).length ? [{ target: address(model, shape), patch: onShape }] : []),
    ...(Object.keys(onSvg).length ? [{ target: address(model, svg), patch: onSvg }] : []),
  ];
}

/** A stroke 1px wide on screen, in the graphic's own units. */
function onePixelStroke(board: string, model: TemplateModel, svg: HtmlElement | null): string {
  const box = svg ? /^\s*\S+[\s,]+\S+[\s,]+(\S+)/.exec(svg.attrs.find((attr) => attr.name.toLowerCase() === 'viewbox')?.value ?? '') : null;
  const rendered = svg ? boardApi(board)?.inspect(model.tidOf.get(svg)!)?.rect.width : undefined;
  const units = box ? Number(box[1]) : NaN;
  return rendered && Number.isFinite(units) && units > 0 ? String(Math.round((units / rendered) * 100) / 100 || 0.01) : '1';
}

/** Writes style edits (and `fill` attributes removed) as one undo step. */
function writePaint(board: string, edits: { target: Address; patch: StylePatch }[], unfilled: Address[] = []): boolean {
  if (!edits.length) return false;
  const key = `paint:${Date.now()}`;
  if (!edit(board, { kind: 'styles', edits }, { coalesce: key })) return false;
  // Each edit re-reads the source, so these addresses still match.
  for (const target of unfilled) edit(board, { kind: 'attr', target, name: 'fill', value: null } satisfies BoardOp, { coalesce: key });
  return true;
}

/** Tells how a swap went: done, done in part, or why not. */
function reportSwap(refusals: SwapRefusal[], swapped: number): void {
  const report = swapReport(refusals, swapped);
  if (!report) return;
  if ('toast' in report) toast.add({ title: report.toast });
  else announce(report.announce);
}

/** ⇧X: swaps fill and stroke of the selected elements or shape notes. False when nothing is selected that could. */
export function swapSelectionPaint(): boolean {
  const view = useView.getState();
  const doc = useDocument.getState();
  if (doc.readOnly) return false;
  const { selection } = view;
  if (selection.kind === 'objects') {
    // Artboards have no fill and stroke to swap.
    const refusals: SwapRefusal[] = selection.boards.length ? ['unfit'] : [];
    const next = { ...doc.canvas.notes };
    let swapped = 0;
    for (const id of selection.notes) {
      const note = next[id];
      if (!note) continue;
      const result = noteSwap(note);
      if (typeof result === 'string') refusals.push(result);
      else {
        next[id] = result;
        swapped++;
      }
    }
    if (swapped) doc.updateCanvas((canvas) => ({ ...canvas, notes: { ...canvas.notes, ...Object.fromEntries(selection.notes.filter((id) => next[id]).map((id) => [id, next[id]!])) } }));
    reportSwap(refusals, swapped);
    return true;
  }
  if (selection.kind !== 'elements') return false;
  if (view.crop) {
    toast.add({ title: SWAP_MESSAGES.busy });
    return true;
  }
  const selected = selectedElements();
  if (!selected) return false;
  const { board, model } = selected;
  const refusals: SwapRefusal[] = [];
  const edits: { target: Address; patch: StylePatch }[] = [];
  let swapped = 0;
  for (const element of new Set(selected.elements.map((el) => (SHAPES.has(el.tag) && el.parent && loneShapeOf(el.parent) === el ? el.parent : el)))) {
    const subject = paintSubject(element);
    if (!subject) {
      refusals.push('unfit');
      continue;
    }
    if ('box' in subject) {
      const api = boardApi(board);
      const shown = api?.inspect(model.tidOf.get(subject.box)!);
      if (api && !shown) {
        refusals.push('hidden');
        continue;
      }
      const plan = boxSwap(subject.box, shown?.computed);
      if ('refused' in plan) refusals.push(plan.refused);
      else {
        edits.push({ target: address(model, subject.box), patch: plan.patch });
        swapped++;
      }
      continue;
    }
    const plan = shapeSwap(subject.shape, onePixelStroke(board, model, subject.svg ?? subject.shape.parent));
    if ('refused' in plan) refusals.push(plan.refused);
    else {
      edits.push(...shapeEdits(model, subject.shape, subject.svg, plan.patch));
      swapped++;
    }
  }
  if (swapped && !writePaint(board, edits)) {
    toast.add({ title: SWAP_MESSAGES.failed });
    return true;
  }
  reportSwap(refusals, swapped);
  return true;
}

/** X: takes the fill away from the selected elements or shape notes. */
export function unfillSelection(): boolean {
  const view = useView.getState();
  const doc = useDocument.getState();
  if (doc.readOnly) return false;
  const { selection } = view;
  if (selection.kind === 'objects') {
    const changed = selection.notes.flatMap((id) => {
      const note = doc.canvas.notes[id];
      const next = note ? noteUnfill(note) : null;
      return next ? [[id, next] as const] : [];
    });
    if (changed.length) {
      doc.updateCanvas((canvas) => ({ ...canvas, notes: { ...canvas.notes, ...Object.fromEntries(changed) } }));
      announce('Fill removed');
    } else toast.add({ title: NOTHING_TO_UNFILL });
    return true;
  }
  if (selection.kind !== 'elements') return false;
  if (!removeFill(UNFILL_PATCH)) toast.add({ title: NOTHING_TO_UNFILL });
  return true;
}

/**
 * Remove fill on the selected elements: boxes get `patch` (X writes the
 * color and image; the Remove fill button and None every background part),
 * shapes `fill: none` with their `fill` attribute removed. False when
 * nothing selected has a fill to remove.
 */
export function removeFill(patch: StylePatch = REMOVE_FILL_PATCH): boolean {
  const selected = selectedElements();
  if (!selected) return false;
  const { board, model } = selected;
  const edits: { target: Address; patch: StylePatch }[] = [];
  const unfilled: Address[] = [];
  for (const element of selected.elements) {
    const subject = paintSubject(element);
    if (!subject) continue;
    if ('box' in subject) {
      const style = subject.box.attrs.find((attr) => attr.name.toLowerCase() === 'style')?.value ?? '';
      edits.push({ target: address(model, subject.box), patch: clipsToText(styleMap(style)) ? { 'background-color': 'transparent' } : patch });
      continue;
    }
    edits.push(...shapeEdits(model, subject.shape, subject.svg, SHAPE_UNFILL_PATCH));
    for (const owner of [subject.shape, subject.svg]) if (owner && owner.attrs.some((attr) => attr.name.toLowerCase() === 'fill')) unfilled.push(address(model, owner));
  }
  if (!edits.length) return false;
  if (writePaint(board, edits, unfilled)) announce('Fill removed');
  return true;
}

/**
 * Writes paint to the selected shapes (the vector panels): a single-shape
 * graphic's paint goes where it takes effect, on the shape or the graphic.
 */
export function paintSelection(patch: StylePatch): void {
  const selected = selectedElements();
  if (!selected) return;
  const { board, model } = selected;
  const edits = selected.elements.flatMap((element) => {
    const subject = paintSubject(element);
    if (!subject) return [];
    return 'box' in subject ? [{ target: address(model, subject.box), patch }] : shapeEdits(model, subject.shape, subject.svg, patch);
  });
  writePaint(board, edits);
}

/** The paint a single-shape layer shows: its graphic's, overridden by the shape's (style, then attributes). */
export function layerPaint(svg: HtmlElement, shape: HtmlElement): Record<string, string> {
  const own = (element: HtmlElement): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const attr of element.attrs) if (isPaintProperty(attr.name)) out[attr.name.toLowerCase()] = attr.value ?? '';
    return { ...out, ...styleMap(element.attrs.find((attr) => attr.name.toLowerCase() === 'style')?.value ?? '') };
  };
  return { ...own(svg), ...own(shape) };
}
