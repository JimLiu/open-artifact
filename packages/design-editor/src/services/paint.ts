/**
 * Fill and stroke commands on the selection: X takes the fill away, ⇧X
 * swaps fill and stroke, and Remove fill clears every part of a
 * background. Elements are edited through `edit` (one undo step each
 * command); shape notes through the canvas. Appearance goes through on
 * locked layers: the lock keeps only their place and size.
 */

import { attributeValue, elementKind, elementPath, hasDynamicStyle, styleMap, type HtmlElement, type StylePatch, type TemplateModel } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { noteCssValue, type CanvasNote } from '@open-artifact/design-core';
import { shapeFill } from '../lib/note-look.ts';
import { noteRoles } from '../lib/mixed-panel.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import type { Address, BoardOp } from '../lib/ops.ts';
import { isPaintProperty, loneShapeOf, paintTargetOf } from '../lib/lone-shape.ts';
import { boxSwap, clipsToText, noteFilled, noteSwap, noteUnfill, REMOVE_FILL_PATCH, shapeSwap, SHAPE_UNFILL_PATCH, NOTHING_TO_UNFILL, SWAP_MESSAGES, swapReport, UNFILL_PATCH, type SwapRefusal } from '../lib/paint.ts';
import { edit, resolvedGroups, selectedElements, tryEdit, type ResolvedGroup } from './commands.ts';
import { paintKindOf, paintProperty, type MixedSelection, type PaintKind, type PaintRole } from '../lib/selection.ts';
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
function reportSwap(refusals: SwapRefusal[], swapped: number, failed = false): void {
  const report = swapReport(refusals, swapped, failed);
  if (!report) return;
  if ('toast' in report) toast.add({ title: report.toast });
  else announce(report.announce);
}

/** Style edits that swap fill and stroke in one artboard, and what was refused. */
interface SwapPlan {
  edits: { target: Address; patch: StylePatch }[];
  refusals: SwapRefusal[];
  swapped: number;
}

/** Plans the swap of one artboard's selected elements. */
function planSwap({ board, model, elements }: ResolvedGroup): SwapPlan {
  const plan: SwapPlan = { edits: [], refusals: [], swapped: 0 };
  const api = boardApi(board);
  for (const element of new Set(elements.map((el) => (SHAPES.has(el.tag) && el.parent && loneShapeOf(el.parent) === el ? el.parent : el)))) {
    const subject = paintSubject(element);
    if (!subject) {
      plan.refusals.push('unfit');
      continue;
    }
    if ('box' in subject) {
      const shown = api?.inspect(model.tidOf.get(subject.box)!);
      if (api && !shown) {
        plan.refusals.push('hidden');
        continue;
      }
      const swap = boxSwap(subject.box, shown?.computed);
      if ('refused' in swap) plan.refusals.push(swap.refused);
      else {
        plan.edits.push({ target: address(model, subject.box), patch: swap.patch });
        plan.swapped++;
      }
      continue;
    }
    const swap = shapeSwap(subject.shape, onePixelStroke(board, model, subject.svg ?? subject.shape.parent));
    if ('refused' in swap) plan.refusals.push(swap.refused);
    else {
      plan.edits.push(...shapeEdits(model, subject.shape, subject.svg, swap.patch));
      plan.swapped++;
    }
  }
  return plan;
}

/** Swaps fill and stroke of shape notes on the canvas; returns what was refused and how many swapped. */
function swapNotes(ids: readonly string[]): { refusals: SwapRefusal[]; swapped: number } {
  const doc = useDocument.getState();
  const refusals: SwapRefusal[] = [];
  const changed: [string, CanvasNote][] = [];
  for (const id of ids) {
    const note = doc.canvas.notes[id];
    if (!note) continue;
    const result = noteSwap(note);
    if (typeof result === 'string') refusals.push(result);
    else changed.push([id, result]);
  }
  if (changed.length) doc.updateCanvas((canvas) => ({ ...canvas, notes: { ...canvas.notes, ...Object.fromEntries(changed) } }));
  return { refusals, swapped: changed.length };
}

/**
 * ⇧X: swaps fill and stroke of the selected elements or shape notes. Across
 * files, each artboard swaps its own elements and the notes swap on the
 * canvas, as one undo step; artboards have nothing to swap. False when
 * nothing is selected that could.
 */
export function swapSelectionPaint(): boolean {
  const view = useView.getState();
  const doc = useDocument.getState();
  if (doc.readOnly) return false;
  const { selection } = view;
  if (selection.kind === 'objects') {
    const notes = swapNotes(selection.notes);
    // Artboards have no fill and stroke to swap.
    reportSwap([...(selection.boards.length ? ['unfit' as const] : []), ...notes.refusals], notes.swapped);
    return true;
  }
  if (selection.kind !== 'elements' && selection.kind !== 'mixed') return false;
  if (view.crop) {
    toast.add({ title: SWAP_MESSAGES.busy });
    return true;
  }
  if (selection.kind === 'mixed') {
    const refusals: SwapRefusal[] = [];
    let swapped = 0;
    let failed = false;
    doc.transact(() => {
      for (const group of resolvedGroups(selection.elements)) {
        const plan = planSwap(group);
        refusals.push(...plan.refusals);
        if (!plan.edits.length) continue;
        if (tryEdit(group.board, { kind: 'styles', edits: plan.edits }).kind === 'done') swapped += plan.swapped;
        else failed = true;
      }
      const notes = swapNotes(selection.notes);
      refusals.push(...notes.refusals);
      swapped += notes.swapped;
      if (selection.boards.length) refusals.push('unfit');
    });
    reportSwap(refusals, swapped, failed);
    return true;
  }
  const selected = selectedElements();
  if (!selected) return false;
  const plan = planSwap(selected);
  if (plan.swapped && !writePaint(selected.board, plan.edits)) {
    reportSwap(plan.refusals, 0, true);
    return true;
  }
  reportSwap(plan.refusals, plan.swapped);
  return true;
}

/** Notes without their fill; empty when none had one to take away. */
function unfilledNotes(ids: readonly string[]): [string, CanvasNote][] {
  const { notes } = useDocument.getState().canvas;
  return ids.flatMap((id) => {
    const next = notes[id] ? noteUnfill(notes[id]!) : null;
    return next ? [[id, next] as [string, CanvasNote]] : [];
  });
}

/**
 * X: takes the fill away from the selected elements or shape notes; across
 * files from each artboard's elements and the notes, as one undo step.
 */
export function unfillSelection(): boolean {
  const view = useView.getState();
  const doc = useDocument.getState();
  if (doc.readOnly) return false;
  const { selection } = view;
  if (selection.kind === 'objects' || selection.kind === 'mixed') {
    let removed = false;
    doc.transact(() => {
      if (selection.kind === 'mixed') {
        for (const group of resolvedGroups(selection.elements)) {
          const plan = planUnfill(group, UNFILL_PATCH);
          if (!plan.edits.length || tryEdit(group.board, { kind: 'styles', edits: plan.edits }).kind !== 'done') continue;
          for (const target of plan.unfilled) tryEdit(group.board, { kind: 'attr', target, name: 'fill', value: null });
          removed = true;
        }
      }
      const changed = unfilledNotes(selection.notes);
      if (changed.length) {
        useDocument.getState().updateCanvas((canvas) => ({ ...canvas, notes: { ...canvas.notes, ...Object.fromEntries(changed) } }));
        removed = true;
      }
    });
    if (removed) announce('Fill removed');
    else toast.add({ title: NOTHING_TO_UNFILL });
    return true;
  }
  if (selection.kind !== 'elements') return false;
  if (!removeFill(UNFILL_PATCH)) toast.add({ title: NOTHING_TO_UNFILL });
  return true;
}

/** The edits that take the fill away from one artboard's selected elements, and the `fill` attributes to remove. */
function planUnfill({ model, elements }: ResolvedGroup, patch: StylePatch): { edits: { target: Address; patch: StylePatch }[]; unfilled: Address[] } {
  const edits: { target: Address; patch: StylePatch }[] = [];
  const unfilled: Address[] = [];
  for (const element of elements) {
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
  return { edits, unfilled };
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
  const { edits, unfilled } = planUnfill(selected, patch);
  if (!edits.length) return false;
  if (writePaint(selected.board, edits, unfilled)) announce('Fill removed');
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

/* ------------------------- across several files ------------------------- */

/** The paint kind of an element (see `paintKindOf`). */
const kindOf = (element: HtmlElement): PaintKind => paintKindOf(elementKind(element), element.tag);

/** What a merged color row paints: elements of any artboards, and notes. */
export type PaintAcross = Pick<MixedSelection, 'elements' | 'notes'>;

/** The elements of a mixed selection whose colors can change: not styled by code (a lock keeps only place and size). */
function paintableGroups(selection: Pick<MixedSelection, 'elements'>): ResolvedGroup[] {
  return resolvedGroups(selection.elements)
    .map((group) => ({ ...group, elements: group.elements.filter((element) => !hasDynamicStyle(element)) }))
    .filter((group) => group.elements.length > 0);
}

/** The paint kinds among a mixed selection's elements whose colors can change. */
export function mixedPaintKinds(selection: Pick<MixedSelection, 'elements'>): PaintKind[] {
  return [...new Set(paintableGroups(selection).flatMap((group) => group.elements.map(kindOf)))];
}

/** The paint kind of every element of a mixed selection: a merged row lists what all of them have. */
export function mixedElementKinds(selection: Pick<MixedSelection, 'elements'>): PaintKind[] {
  return resolvedGroups(selection.elements).flatMap((group) => group.elements.map(kindOf));
}

/** The paint written on a drawn element: a single-shape graphic's, overridden by its shape's. */
function drawnPaint(element: HtmlElement): Record<string, string> {
  const shape = element.tag === 'svg' ? loneShapeOf(element) : null;
  if (shape) return layerPaint(element, shape);
  const out: Record<string, string> = {};
  for (const attr of element.attrs) if (isPaintProperty(attr.name)) out[attr.name.toLowerCase()] = attr.value ?? '';
  return { ...out, ...styleMap(attributeValue(element, 'style') ?? '') };
}

/** Each element's color for a role, for a merged row (elements that take no such color are left out). */
export function mixedPaintValues(selection: Pick<MixedSelection, 'elements'>, role: PaintRole): string[] {
  return resolvedGroups(selection.elements).flatMap((group) => {
    const api = boardApi(group.board);
    return group.elements.flatMap((element) => {
      const kind = kindOf(element);
      const property = paintProperty(kind, role);
      if (!property) return [];
      // Drawn paint is read as written; boxes and text as rendered (borders from one side).
      if (kind === 'shape' || kind === 'line') return [drawnPaint(element)[property] ?? ''];
      const read = property === 'border-color' ? 'border-top-color' : property;
      return [api?.inspect(group.model.tidOf.get(element)!)?.computed[read] ?? styleMap(attributeValue(element, 'style') ?? '')[property] ?? ''];
    });
  });
}

/** The fill of each shape note among these (a merged Fill row). */
export function noteFillValues(ids: readonly string[]): string[] {
  const notes = useDocument.getState().canvas.notes;
  return ids.flatMap((id) => (notes[id] && noteRoles(notes[id]).includes('fill') ? [shapeFill(notes[id])] : []));
}

/**
 * Sets one color across a selection as one undo step: each element gets
 * the property its kind takes for that role (`paintProperty`), on the
 * part where it shows (a single-shape graphic's shape or the graphic);
 * a shape note takes a fill as its background. The others are left
 * alone. `null` takes the color away. Returns false when nothing took it.
 */
export function paintMixed(selection: PaintAcross, role: PaintRole, color: string | null): boolean {
  const doc = useDocument.getState();
  if (doc.readOnly) return false;
  let painted = false;
  doc.transact(() => {
    if (role === 'fill' && (color === null || noteCssValue('background-color', color) !== null)) {
      const notes = doc.canvas.notes;
      const changed = selection.notes.flatMap((id) => {
        const next = notes[id] ? noteFilled(notes[id], color) : null;
        return next ? [[id, next] as const] : [];
      });
      if (changed.length) {
        doc.updateCanvas((canvas) => ({ ...canvas, notes: { ...canvas.notes, ...Object.fromEntries(changed) } }));
        painted = true;
      }
    }
    for (const group of paintableGroups(selection)) {
      const edits = group.elements.flatMap((element) => {
        const property = paintProperty(kindOf(element), role);
        if (!property) return [];
        const patch: StylePatch = { [property]: color };
        // A graphic of several shapes takes it on itself: its shapes inherit it.
        const subject = paintSubject(element) ?? { box: element };
        return 'box' in subject ? [{ target: address(group.model, subject.box), patch }] : shapeEdits(group.model, subject.shape, subject.svg, patch);
      });
      if (edits.length && tryEdit(group.board, { kind: 'styles', edits }).kind === 'done') painted = true;
    }
  });
  return painted;
}
