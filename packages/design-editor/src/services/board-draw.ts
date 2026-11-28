/**
 * Drawing inside an artboard: a press of Text, Rectangle, Oval, Line, Arrow
 * or the Pencil on an artboard writes an absolutely positioned element into its
 * page. Outside the artboard being edited it goes at the end of the page;
 * in the artboard holding the element selection, into the container under
 * the press. The element is selected afterwards, and new text is edited
 * at once.
 */

import { elementChildren, elementPath, type TemplateModel } from '@open-artifact/dc';
import { isLockedObject, type Rect } from '@open-artifact/design-core';
import { toast } from '@open-artifact/ui';
import {
  CLICK_SIZES,
  EMPTY_TEXT_REMOVED,
  PATH_FAILED,
  PATH_TOO_LARGE,
  PLACE_FAILED,
  drawContainer,
  notLoadedMessage,
  pencilHtml,
  placedHtml,
  placementOps,
  type DrawDirection,
  type PlaceBox,
  type PlaceTool,
} from '../lib/board-draw.ts';
import { boardSnapTargets, type SnapTargets } from '../lib/draw-snap.ts';
import { isElementLocked } from '../lib/locks.ts';
import type { Address } from '../lib/ops.ts';
import { elementsIn } from '../lib/selection.ts';
import { useDocument } from '../state/document.ts';
import { NO_SELECTION, useView, type ElementSelection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { announce } from './announce.ts';
import { edit, startTextEdit, tryEdit } from './commands.ts';
import { boardApi, frameOf } from './frames.ts';
import { refuseLocked } from './locks.ts';
import { idMaker } from './paste-into.ts';
import { recalledRadius } from './radius-memory.ts';

/** Whether the artboard is being edited: it holds the element selection. */
export function editingInside(board: string): boolean {
  return elementsIn(useView.getState().selection, board).length > 0;
}

/** Whether a drawing press on this artboard goes into it (a piece only while it is being edited). */
export function drawsInside(board: string): boolean {
  const entry = useDocument.getState().canvas.boards[board];
  return Boolean(entry) && (!entry!.frameless || editingInside(board));
}

/** The top-level boxes last read for snapping, per artboard (read again after half a second). */
let snapCache: { board: string; at: number; targets: SnapTargets } | null = null;

/** Lines a drawing inside `board` snaps to, in world coordinates. */
export function boardDrawTargets(board: string): SnapTargets {
  const now = performance.now();
  if (snapCache?.board === board && now - snapCache.at < 500) return snapCache.targets;
  const entry = useDocument.getState().canvas.boards[board];
  if (!entry) return { xs: [], ys: [] };
  const frame: Rect = { x: entry.x, y: entry.y, w: entry.w, h: entry.h };
  const source = useDocument.getState().boards[board]?.source;
  const api = boardApi(board);
  let boxes: Rect[] = [];
  if (source && api) {
    const model = templateOf(source);
    const tids = elementChildren(model.nodes).filter((element) => !['helmet', 'script', 'style', 'link', 'meta', 'title'].includes(element.tag)).map((element) => model.tidOf.get(element)!);
    const rects = api.rects(tids);
    boxes = tids.flatMap((tid) => rects[tid]?.[0] ?? []).map((r) => ({ x: entry.x + r.x, y: entry.y + r.y, w: r.width, h: r.height }));
  }
  const targets = boardSnapTargets(frame, boxes);
  snapCache = { board, at: now, targets };
  return targets;
}

/** The family of the first visible paragraph, label or link of the page, for new text. */
function firstTextFont(board: string): string | null {
  try {
    const doc = frameOf(board)?.contentDocument;
    const view = doc?.defaultView;
    if (!doc || !view) return null;
    for (const element of Array.from(doc.querySelectorAll('p, label, a'))) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > view.innerHeight || rect.right < 0 || rect.left > view.innerWidth) continue;
      return view.getComputedStyle(element).fontFamily || null;
    }
  } catch {
    // A frame that can't be read has no font to offer.
  }
  return null;
}

/** Where a drawing lands: the container (`null`: the page) and the offset of its padding box. */
interface Landing {
  target: Address | null;
  anchor: boolean;
  origin: { x: number; y: number };
}

/** The container under `press` (artboard pixels) in an artboard being edited. */
function landingAt(board: string, model: TemplateModel, press: { x: number; y: number }, placed: 'div' | 'svg'): Landing {
  const page: Landing = { target: null, anchor: false, origin: { x: 0, y: 0 } };
  const api = boardApi(board);
  const pick = api?.pickAll(press.x, press.y)[0];
  const under = pick ? model.elements[pick.tid] ?? null : null;
  const container = drawContainer(under, placed, isElementLocked);
  if (!api || !container) return page;
  const tid = model.tidOf.get(container)!;
  const info = api.inspect(tid);
  // The instance under the press, else the first.
  const rects = api.rects([tid])[tid] ?? [];
  const rect = rects.find((r) => press.x >= r.x && press.x <= r.x + r.width && press.y >= r.y && press.y <= r.y + r.height) ?? rects[0] ?? info?.rect;
  if (!info || !rect) return page;
  const border = (side: string) => parseFloat(info.computed[`border-${side}-width`] ?? '0') || 0;
  return {
    target: { tid, path: elementPath(model, container) },
    // The computed position alone decides: an inline `position: static` still needs `relative` to anchor the drawing.
    anchor: (info.computed.position ?? 'static') === 'static',
    origin: { x: rect.x + border('left'), y: rect.y + border('top') },
  };
}

/** The new text element, while its first edit is open: emptied, it goes away. */
let placedText: { board: string; tid: number } | null = null;

/** Writes `html` where `landing` says, as one undo step; the created elements, or null with a toast. */
function place(board: string, landing: Landing, html: string, failure: string): ElementSelection[] | null {
  const doc = useDocument.getState();
  let created: Address[] = [];
  let refusal: 'locked' | 'failed' | null = null;
  doc.transact((cancel) => {
    for (const op of placementOps(landing.target, landing.anchor, html)) {
      const outcome = tryEdit(board, op);
      if (outcome.kind !== 'done') {
        refusal = outcome.kind;
        cancel();
        return;
      }
      created = outcome.created;
    }
    if (!created.length) {
      refusal = 'failed';
      cancel();
    }
  });
  if (refusal === 'locked') refuseLocked();
  else if (refusal) toast.add({ title: failure });
  if (refusal) return null;
  const items = created.map((address) => ({ ...address, instance: 0 }));
  useView.getState().select({ kind: 'elements', board, items });
  return items;
}

/** What a drawing tool did on an artboard: where it was pressed and the box it drew, in artboard pixels. */
export interface BoardDraw {
  tool: PlaceTool;
  /** Where the press went down. */
  press: { x: number; y: number };
  /** The drawn box; `null` for a click (the tool's size at the press). */
  box: PlaceBox | null;
  /** Which way a line was drawn. */
  dir?: DrawDirection;
}

/** The artboard's source and runtime, or null after saying why a drawing can't go there. */
function drawable(board: string, tool: PlaceTool | 'pen'): { source: string; model: TemplateModel } | null {
  const doc = useDocument.getState();
  const source = doc.boards[board]?.source;
  if (isLockedObject(doc.canvas.boards[board])) {
    refuseLocked();
    return null;
  }
  if (!source || !boardApi(board)) {
    if (tool !== 'frame') toast.add({ title: notLoadedMessage(tool) });
    return null;
  }
  return { source, model: templateOf(source) };
}

/** Places what a drawing tool drew on an artboard and selects it; new text is edited at once. */
export function drawInBoard(board: string, draw: BoardDraw): boolean {
  const ready = drawable(board, draw.tool);
  if (!ready) return false;
  const inside = editingInside(board);
  const placed = draw.tool === 'line' || draw.tool === 'arrow' ? 'svg' : 'div';
  const landing: Landing = inside ? landingAt(board, ready.model, draw.press, placed) : { target: null, anchor: false, origin: { x: 0, y: 0 } };
  const at = draw.box ?? { ...draw.press, ...(draw.tool === 'frame' ? { w: 0, h: 0 } : CLICK_SIZES[draw.tool]) };
  const box = { ...at, x: Math.round(at.x - landing.origin.x), y: Math.round(at.y - landing.origin.y) };
  // A drag flat one way (straight across, or tiny at a high zoom) still sizes both sides: a side left out
  // would keep the template's size (a rectangle's 120px) or, for a frame, its content's.
  if (draw.box && (draw.tool === 'rect' || draw.tool === 'oval' || draw.tool === 'frame')) {
    box.w = Math.max(1, box.w);
    box.h = Math.max(1, box.h);
  }
  const html = placedHtml(draw.tool, box, {
    dir: draw.dir,
    freshId: idMaker(ready.source),
    ...(draw.tool === 'rect' ? { radius: recalledRadius() } : {}),
    ...(draw.tool === 'text' ? { font: firstTextFont(board) } : {}),
  });
  const items = place(board, landing, html, PLACE_FAILED);
  if (!items) return false;
  if (draw.tool === 'text' && items[0]) editWhenShown(board, items[0]);
  return true;
}

/** Starts editing the new text once the artboard shows it, its words selected. */
function editWhenShown(board: string, item: ElementSelection): void {
  placedText = { board, tid: item.tid };
  const started = performance.now();
  const attempt = (): void => {
    const view = useView.getState();
    const selected = elementsIn(view.selection, board);
    // Something else was selected or edited meanwhile.
    if (view.textEdit || selected.length !== 1 || selected[0]!.tid !== item.tid) {
      if (placedText?.tid === item.tid && !view.textEdit) placedText = null;
      return;
    }
    if (boardApi(board)?.rects([item.tid])[item.tid]?.length) {
      if (!startTextEdit(board, item, 'all')) placedText = null;
      return;
    }
    if (performance.now() - started < 2000) requestAnimationFrame(attempt);
    else placedText = null;
  };
  requestAnimationFrame(attempt);
}

/**
 * Ends the first edit of new text: emptied, the element is removed (its
 * own undo step). True when that happened.
 */
export function endPlacedText(board: string, tid: number, empty: boolean): boolean {
  const placed = placedText;
  if (!placed || placed.board !== board || placed.tid !== tid) return false;
  placedText = null;
  if (!empty) return false;
  const source = useDocument.getState().boards[board]?.source;
  const model = source ? templateOf(source) : null;
  const element = model?.elements[tid];
  if (!model || !element) return false;
  if (!edit(board, { kind: 'remove', targets: [{ tid, path: elementPath(model, element) }] })) return false;
  useView.getState().select(NO_SELECTION);
  announce(EMPTY_TEXT_REMOVED);
  return true;
}

/** Points of a Pencil stroke over an artboard, in world coordinates from `start`. */
export interface BoardStroke {
  start: { x: number; y: number };
  points: readonly (readonly [number, number])[];
}

/** Writes a Pencil stroke drawn over an artboard into it, with the Pencil's width and dashes. */
export function drawPenInBoard(board: string, stroke: BoardStroke, pen: { width: number; dash: string }): boolean {
  const ready = drawable(board, 'pen');
  const entry = useDocument.getState().canvas.boards[board];
  if (!ready || !entry) return false;
  const press = { x: stroke.start.x - entry.x, y: stroke.start.y - entry.y };
  const landing: Landing = editingInside(board) ? landingAt(board, ready.model, press, 'svg') : { target: null, anchor: false, origin: { x: 0, y: 0 } };
  const html = pencilHtml({ x: press.x - landing.origin.x, y: press.y - landing.origin.y, points: stroke.points }, pen);
  if (!html) {
    toast.add({ title: PATH_TOO_LARGE });
    return false;
  }
  return place(board, landing, html, PATH_FAILED) !== null;
}
