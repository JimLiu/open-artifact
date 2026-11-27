/**
 * Dragging layers-list rows onto another artboard's rows: which artboards
 * take them.
 */

import type { TemplateModel } from '@open-artifact/dc';
import { isLockedObject, type Canvas } from '@open-artifact/design-core';
import { isHiddenLayer } from './outline.ts';

/** What the view is showing, as far as dropping into an artboard goes. */
export interface IntoView {
  mode: 'canvas' | 'focused';
  focused: string | null;
  playing: string | null;
}

export const SOURCE_CHANGED = 'Couldn’t drop that: the artboard it came from just changed. Drag it again.';

/**
 * Whether rows dragged from `from` (the artboard the elements are in, or the
 * piece or `null` for notes) may drop into the artboard `target`: not into
 * where they are, a piece, a locked artboard, the one in the focused view
 * or the one playing.
 */
export function takesRows(canvas: Canvas, target: string, from: string | null, view: IntoView): boolean {
  const entry = canvas.boards[target];
  if (!entry || entry.frameless || isLockedObject(entry) || target === from) return false;
  if (view.mode === 'focused' && view.focused === target) return false;
  return view.playing !== target;
}

/** Whether elements `tids` may leave their artboard from the layers list: none hidden, none drawn inside an svg. */
export function rowsCanLeave(model: TemplateModel, tids: readonly number[]): boolean {
  return tids.every((tid) => {
    const element = model.elements[tid];
    if (!element || isHiddenLayer(element)) return false;
    for (let node = element.parent; node; node = node.parent) if (node.tag === 'svg') return false;
    return true;
  });
}
