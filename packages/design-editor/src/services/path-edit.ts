/**
 * Editing the points of an svg path inside an artboard: entered by
 * double-clicking the path (or a lone-shape svg drawn by one), left with
 * Escape or a press anywhere else. Each drag writes the path's `d` and is
 * one undo step.
 */

import { create } from 'zustand';
import { attributeValue, elementPath, type HtmlElement } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { isElementLocked } from '../lib/locks.ts';
import { loneShapeOf } from '../lib/lone-shape.ts';
import type { Address } from '../lib/ops.ts';
import { parsePathData, pathDataOf, pathPoints, PATH_EDIT_REPEATED, PATH_EDIT_SCRIPTED, PATH_EDIT_UNSUPPORTED, PATH_REFUSALS, type PathMatrix, type PathRun } from '../lib/path-points.ts';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { liveElementOf } from './capture.ts';
import { edit } from './commands.ts';
import { refuseLocked } from './locks.ts';

/** The path being edited: where it is, its runs, and its matrix into the artboard's pixels. */
export interface PathEdit {
  board: string;
  target: Address;
  runs: PathRun[];
  matrix: PathMatrix;
  /** The path data last read or written. */
  d: string;
}

export const usePathEdit = create<{ edit: PathEdit | null }>()(() => ({ edit: null }));

/** The path a double-click on `element` edits: the element when it is a path, or the path a lone-shape svg is drawn with. */
export function pathTargetOf(element: HtmlElement): HtmlElement | null {
  const target = element.tag === 'svg' ? (loneShapeOf(element) ?? element) : element;
  return target.tag === 'path' ? target : null;
}

const repeated = (element: HtmlElement): boolean => {
  for (let node = element.parent; node; node = node.parent) if (node.tag === 'sc-for') return true;
  return false;
};

/**
 * Starts editing the points of the path that `item` of `board` is or is
 * drawn with. Returns false when it is no path (the double-click does what
 * it otherwise does); true when it started, or said why it can't.
 */
export function startPathEdit(board: string, item: ElementSelection): boolean {
  const doc = useDocument.getState();
  const view = useView.getState();
  const source = doc.boards[board]?.source;
  const entry = doc.canvas.boards[board];
  if (doc.readOnly || view.mode !== 'canvas' || !source || !entry) return false;
  const model = templateOf(source);
  const element = model.elements[item.tid];
  const path = element ? pathTargetOf(element) : null;
  if (!path) return false;
  if (isElementLocked(path)) {
    refuseLocked();
    return true;
  }
  if (repeated(path)) {
    toast.add({ title: PATH_EDIT_REPEATED });
    return true;
  }
  const d = attributeValue(path, 'd') ?? '';
  if (!d.trim() || d.includes('{{')) {
    toast.add({ title: PATH_EDIT_UNSUPPORTED });
    return true;
  }
  const target = { tid: model.tidOf.get(path)!, path: elementPath(model, path) };
  const live = liveElementOf(board, { ...target, instance: item.instance }, { descend: false, svg: false });
  if (!live || !('getScreenCTM' in live) || typeof live.getScreenCTM !== 'function') {
    toast.add({ title: PATH_EDIT_UNSUPPORTED });
    return true;
  }
  if (live.getAttribute('d') !== d) {
    toast.add({ title: PATH_EDIT_SCRIPTED });
    return true;
  }
  const ctm = (live as SVGGraphicsElement).getScreenCTM();
  if (!ctm) {
    toast.add({ title: PATH_REFUSALS.bad });
    return true;
  }
  const matrix: PathMatrix = [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f];
  const runs = pathPoints(d, matrix, entry, view.camera.zoom);
  if (typeof runs === 'string') {
    toast.add({ title: PATH_REFUSALS[runs] });
    return true;
  }
  usePathEdit.setState({ edit: { board, target, runs, matrix, d } });
  return true;
}

/** Writes `runs` as the edited path's `d`; edits with the same `key` are one undo step. */
export function writePath(runs: PathRun[], key: string): void {
  const current = usePathEdit.getState().edit;
  if (!current) return;
  const d = pathDataOf(runs);
  usePathEdit.setState({ edit: { ...current, runs, d } });
  if (!edit(current.board, { kind: 'attr', target: current.target, name: 'd', value: d }, { coalesce: key })) endPathEdit();
}

/** Follows the artboard's source (an undo, the agent): its path data read again, or the edit ends when the path is gone. */
export function followPathSource(source: string | null | undefined): void {
  const current = usePathEdit.getState().edit;
  if (!current) return;
  const element = source ? templateOf(source).elements[current.target.tid] : undefined;
  const d = element?.tag === 'path' ? attributeValue(element, 'd') : undefined;
  if (d === current.d) return;
  const runs = d ? parsePathData(d) : null;
  if (!runs || d === undefined) endPathEdit();
  else usePathEdit.setState({ edit: { ...current, runs, d } });
}

export function endPathEdit(): void {
  if (usePathEdit.getState().edit) usePathEdit.setState({ edit: null });
}
