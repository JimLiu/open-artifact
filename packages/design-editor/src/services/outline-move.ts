/**
 * Layers-list rows dragged onto another artboard's rows: elements move
 * there (out of their own artboard in the same undo step), notes and
 * pieces join it.
 */

import { create } from 'zustand';
import { elementPath } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { JOIN_FAILED, joinMessages, type LooseObjects } from '../lib/join.ts';
import { SOURCE_CHANGED, takesRows } from '../lib/outline-into.ts';
import type { Address } from '../lib/ops.ts';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { elementsPayload, layerPlace } from './clipboard.ts';
import { tryEdit } from './commands.ts';
import { measuredNoteSize } from './engine.ts';
import { joinBoard } from './join.ts';
import { refuseLocked } from './locks.ts';
import { boardDrop, boardName, elementLayers } from './paste-into.ts';
import { fitRect, glideTo, visibleBoards } from './viewport.ts';

/** The artboard whose row shows that dragged rows would drop into it. */
export const useOutlineInto = create<{ into: string | null }>()(() => ({ into: null }));

/** Whether rows dragged from `from` may drop into `target` now (see `takesRows`). */
export function canTakeRows(target: string, from: string | null): boolean {
  const doc = useDocument.getState();
  return !doc.readOnly && takesRows(doc.canvas, target, from, useView.getState());
}

/** Brings an artboard into view when none of it is. */
function reveal(path: string): void {
  if (visibleBoards().includes(path)) return;
  const entry = useDocument.getState().canvas.boards[path];
  if (entry) glideTo(fitRect({ x: entry.x, y: entry.y, w: entry.w, h: entry.h }, 80, Math.max(useView.getState().camera.zoom, 0.1)));
}

/**
 * Moves elements `items` of the artboard `from` into the artboard `to`,
 * as positioned layers on the middle of its part in view. `sourceAtStart`
 * is `from`'s source when the drag began: if it changed, nothing moves.
 */
export function moveElementsInto(from: string, items: readonly ElementSelection[], to: string, sourceAtStart: string): boolean {
  const doc = useDocument.getState();
  const source = doc.boards[from]?.source;
  if (source !== sourceAtStart) {
    toast.add({ title: SOURCE_CHANGED });
    return false;
  }
  if (!canTakeRows(to, from) || !items.length) return false;
  const model = templateOf(source);
  const elements = items.map((item) => model.elements[item.tid]);
  const place = layerPlace(to);
  const drop = boardDrop(to);
  const payload = elements.every((element) => element !== undefined) ? elementsPayload(from, model, elements.filter((element) => element !== undefined), items) : null;
  const markup = payload?.kind === 'elements' && place && drop ? elementLayers(payload, to, place, drop) : null;
  if (!markup || !place) {
    toast.add({ title: JOIN_FAILED });
    return false;
  }
  const container = place.container ? { tid: place.model.tidOf.get(place.container)!, path: elementPath(place.model, place.container) } : null;

  // Set inside the step (the compiler can't see that).
  let created = [] as Address[];
  let refusal = null as string | null;
  doc.transact((cancel) => {
    const stop = (kind: string) => {
      refusal = kind === 'locked' ? 'locked' : JOIN_FAILED;
      cancel();
    };
    const removed = tryEdit(from, { kind: 'remove', targets: items.map(({ tid, path }) => ({ tid, path })) });
    if (removed.kind !== 'done') return stop(removed.kind);
    if (container && place.anchor) {
      const anchored = tryEdit(to, { kind: 'style', targets: [container], patch: { position: 'relative' } });
      if (anchored.kind !== 'done') return stop(anchored.kind);
    }
    const inserted = tryEdit(to, { kind: 'insert', target: container, position: 'last-child', html: markup.html, helmet: markup.helmet });
    if (inserted.kind !== 'done' || !inserted.created.length) return stop(inserted.kind);
    created = inserted.created;
  });
  if (refusal === 'locked') refuseLocked();
  else if (refusal) toast.add({ title: refusal });
  if (refusal) return false;
  useView.getState().select({ kind: 'elements', board: to, items: created.map((address) => ({ ...address, instance: 0 })) });
  reveal(to);
  toast.add({ title: joinMessages.moved(boardName(to)) });
  return true;
}

/** Notes, or a piece, dropped on an artboard's row: they join it as positioned layers. */
export function joinFromOutline(members: LooseObjects, to: string): boolean {
  const from = members.boards.length === 1 ? members.boards[0]! : null;
  if (!canTakeRows(to, from)) return false;
  if (!joinBoard(members, to, 'centre', measuredNoteSize)) return false;
  reveal(to);
  return true;
}
