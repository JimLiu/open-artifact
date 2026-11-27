/**
 * Dragging elements out of an artboard onto the empty canvas: each becomes
 * a piece, a frameless artboard file of its own, in one undo step with its
 * leaving the artboard.
 */

import { applySplices, attributeValue, elementChildren, elementSource, parseTemplate, setStyle, styleMap } from '@open-artifact/dc';
import { pageOf, type Rect } from '@open-artifact/design-core';
import { toast } from '@open-artifact/ui';
import { JOIN_FAILED } from '../lib/join.ts';
import { withoutLocks } from '../lib/locks.ts';
import { dirOf, freeBoardName } from '../lib/frame.ts';
import { outlineReach, pieceBox, piecePatch, pieceSource, pieceTitle } from '../lib/piece.ts';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { liveElementOf } from './capture.ts';
import { carriedCss, dependsOnArtboard, helmetFor, renderedMarkup } from './carry.ts';
import { tryEdit } from './commands.ts';
import { boardApi } from './frames.ts';
import { refuseLocked } from './locks.ts';

/** True when a world point is on no artboard of the page: where a dragged element becomes a piece. */
export function onEmptyCanvas(point: { x: number; y: number }): boolean {
  const { canvas } = useDocument.getState();
  const { page } = useView.getState();
  return !canvas.order.some((path) => {
    const entry = canvas.boards[path];
    if (!entry || (page !== null && pageOf(canvas, entry) !== page)) return false;
    return point.x >= entry.x && point.x <= entry.x + entry.w && point.y >= entry.y && point.y <= entry.y + entry.h;
  });
}

/** One element written as a piece: its markup standing alone, and where it goes. */
interface Cut {
  html: string;
  helmet?: string;
  title: string;
  box: Rect;
  reach: number;
}

/**
 * Makes each selected element of `board` a piece `offset` away from where
 * it is, and takes it out of the artboard. Returns whether anything moved.
 */
export function makePieces(board: string, items: readonly ElementSelection[], offset: { x: number; y: number }): boolean {
  const doc = useDocument.getState();
  const source = doc.boards[board]?.source;
  const entry = doc.canvas.boards[board];
  const api = boardApi(board);
  if (doc.readOnly || !source || !entry || !api || !items.length) return false;
  const model = templateOf(source);
  const cuts: Cut[] = [];
  for (const item of items) {
    const element = model.elements[item.tid];
    const info = api.inspect(item.tid);
    if (!element || !info) {
      toast.add({ title: JOIN_FAILED });
      return false;
    }
    const live = liveElementOf(board, item, { descend: false, svg: false });
    let markup = withoutLocks(elementSource(model, element));
    if (live && dependsOnArtboard(markup)) markup = withoutLocks(renderedMarkup(model, live));
    const parsed = parseTemplate(markup.trim());
    const root = elementChildren(parsed.nodes)[0];
    if (!root) {
      toast.add({ title: JOIN_FAILED });
      return false;
    }
    const html = applySplices(parsed.text, setStyle(parsed, root, piecePatch(info.rect, info.computed.position, styleMap(attributeValue(root, 'style') ?? ''))));
    const reach = outlineReach(info.computed);
    const box = pieceBox({ x: entry.x + info.rect.x + offset.x, y: entry.y + info.rect.y + offset.y, w: info.rect.width, h: info.rect.height }, reach);
    cuts.push({ html, helmet: live ? helmetFor(carriedCss([live]), null) : undefined, title: pieceTitle(element.tag), box, reach });
  }

  const taken = new Set([...Object.keys(doc.boards), ...Object.keys(doc.canvas.boards)].map((path) => path.slice(dirOf(path).length)));
  const page = pageOf(doc.canvas, entry);
  const made: string[] = [];
  let refusal = null as string | null;
  doc.transact((cancel) => {
    const removed = tryEdit(board, { kind: 'remove', targets: items.map(({ tid, path }) => ({ tid, path })) });
    if (removed.kind !== 'done') {
      refusal = removed.kind === 'locked' ? 'locked' : JOIN_FAILED;
      cancel();
      return;
    }
    for (const cut of cuts) {
      const name = freeBoardName('Piece', taken);
      taken.add(name);
      const path = `${dirOf(board)}${name}`;
      const w = Math.max(1, Math.round(cut.box.w));
      const h = Math.max(1, Math.round(cut.box.h));
      useDocument.getState().createBoard(path, pieceSource({ title: cut.title, width: w, height: h, html: cut.html, helmet: cut.helmet, reach: cut.reach }), {
        x: Math.round(cut.box.x),
        y: Math.round(cut.box.y),
        w,
        h,
        title: cut.title,
        frameless: true,
        ...(page ? { page } : {}),
      });
      made.push(path);
    }
  });
  if (refusal === 'locked') refuseLocked();
  else if (refusal) toast.add({ title: refusal });
  if (refusal) return false;
  useView.getState().select({ kind: 'objects', boards: made, notes: [] });
  return true;
}
