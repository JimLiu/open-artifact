/**
 * Shift presses on the canvas and in the outline, against the stores.
 * The rules are in `lib/selection.ts`; this module supplies which
 * artboards are fragments and writes the result.
 */

import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { toggleBoard, toggleElement, toggleNotes, type ElementSelection, type Selection } from '../lib/selection.ts';

/** True for an artboard drawn without a frame. */
export const isFragmentBoard = (path: string): boolean => Boolean(useDocument.getState().canvas.boards[path]?.frameless);

/** Shift on an artboard: in or out of the selection. */
export function shiftBoard(path: string): Selection {
  const next = toggleBoard(useView.getState().selection, path);
  useView.getState().select(next);
  return next;
}

/** Shift on an element: in or out, or its artboard instead (see `toggleElement`). */
export function shiftElement(board: string, item: ElementSelection): Selection {
  const next = toggleElement(useView.getState().selection, board, item, isFragmentBoard);
  useView.getState().select(next);
  return next;
}

/** Shift on notes (one, or a group): in or out together. */
export function shiftNotes(ids: readonly string[], selected: boolean): Selection {
  const next = toggleNotes(useView.getState().selection, ids, selected);
  useView.getState().select(next);
  return next;
}
