/**
 * Comments on the design: the Design adapter of the shared comments
 * controller (`@open-artifact/editor-kit`, comments.ts). The host stores the threads
 * (`comments.json` beside `project/`, the `comments` capability); this file
 * says what a design anchor is (`lib/comment-anchors.ts`), resolves it
 * against the live document and shows it.
 *
 * Comment mode (the Shell's Comments button or C) turns
 * presses on the canvas into new threads: a click on an element, an
 * artboard, a note or the empty canvas, or a drag that draws an area.
 * Commenters can comment; viewers only read. Only the owner hands threads
 * to the agent.
 */

import { elementPath, formatAddress } from '@open-artifact/dc';
import { boardsOnPage, notesOnPage, type Rect } from '@open-artifact/design-core';
import { useCapability, type CommentThread, type JsonRecord } from '@open-artifact/runtime';
import { toast } from '@open-artifact/ui';
import { createComments, openCount } from '@open-artifact/editor-kit';
import type { PinPlace } from '@open-artifact/editor-kit';
import {
  anchorHighlight,
  anchorDetail,
  anchorLabel,
  anchorLocation,
  boardAnchor,
  boardsInArea,
  elementAnchor,
  keepRow,
  noteAnchor,
  onPage,
  parseAnchor,
  rowOf,
  pinWorld,
  resolveAnchor,
  serializeAnchor,
  type DesignAnchor,
  type PinContext,
  type ResolvedAnchor,
} from '../lib/comment-anchors.ts';
import { noteRect } from '../lib/scene.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { templateOf, useAgent } from './agent.ts';
import { boardApi } from './frames.ts';
import { session } from './session.ts';
import { glideTo, viewportSize } from './viewport.ts';
import { leadMember } from '../lib/selection.ts';

export { openCount };

/** The design's comments. */
export const designComments = createComments<DesignAnchor>({
  parse: parseAnchor,
  serialize: serializeAnchor,
  label: (anchor) => labelOf(anchor),
  detail: (anchor) => anchorDetail(liveRow(anchor)),
  location: (anchor) => locationOf(anchor),
  state: (anchor) => resolveNow(anchor).state,
  stateNote: (state) => (state === 'detached' ? 'The element this was on is gone; shown on its artboard.' : state === 'orphaned' ? 'What this was on has been deleted.' : null),
  reveal: (anchor) => revealAnchor(anchor),
  canComment: () => session().viewer.role !== 'viewer',
  canSendToAgent: () => session().viewer.role === 'owner' && Boolean(session().agent),
  agentName: () => useAgent.getState().status.name,
  agentWakesIdle: () => useAgent.getState().status.wakesIdle,
  onModeChange(on) {
    if (!on) return;
    const view = useView.getState();
    view.setTextEdit(null);
    view.setNoteEdit(null);
    if (view.tool !== 'select' && view.tool !== 'hand') view.setTool('select');
  },
  noun: 'design',
  notify: (message) => toast.add(message),
});

/** The comments store. */
export const useComments = designComments.store;

/** The comments capability, once {@link startComments} found it. */
export const commentsCapability = designComments.capability;
/** True when this viewer may write comments (commenters and up). */
export const canComment = designComments.canComment;
/** True when this viewer may hand threads to the agent (the owner, with an agent connected). */
export const canSendToAgent = designComments.canSendToAgent;

/** Loads the threads and keeps them current; `?comment=<id>` (the protocol's `SHELL_PARAMS.comment`) opens one. */
export async function startComments(): Promise<void> {
  await designComments.start(await useCapability('comments'), new URLSearchParams(location.search).get('comment'));
}

/* -------------------------------------------------------------------------- */
/* Anchors against the live design                                             */
/* -------------------------------------------------------------------------- */

/** A thread's anchor. */
export const anchorOf = designComments.anchorOf;

/** Resolves an anchor against the current document. */
export function resolveNow(anchor: DesignAnchor): ResolvedAnchor {
  const { canvas, boards } = useDocument.getState();
  return resolveAnchor(anchor, {
    canvas,
    model: (board) => {
      const source = boards[board]?.source;
      if (!source) return null;
      try {
        return templateOf(source);
      } catch {
        return null;
      }
    },
  });
}

/** An element's rendered box in artboard px, from its live frame. */
export function liveElementRect(board: string, tid: number): Rect | null {
  const api = boardApi(board);
  if (!api) return null;
  try {
    const rect = api.rects([tid])[tid]?.[0];
    return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
  } catch {
    return null;
  }
}

/** The pin context of the current document. */
export function pinContext(): PinContext {
  const { canvas } = useDocument.getState();
  return { boards: canvas.boards, notes: canvas.notes, noteRect: (note) => noteRect(note), elementRect: liveElementRect };
}

/** A short label of an anchor. */
export function labelOf(anchor: DesignAnchor): string {
  return anchorLabel(liveRow(anchor), useDocument.getState().canvas);
}

/** The repeated rows a rendered element instance sits in (none when its artboard is not live). */
function rowAt(board: string, tid: number, instance: number) {
  try {
    return rowOf(boardApi(board)?.repeatedRows(tid, instance) ?? []);
  } catch {
    return undefined;
  }
}

/** An anchor with its row dropped when the live artboard no longer repeats every layer of it. */
function liveRow(anchor: DesignAnchor): DesignAnchor {
  if (anchor.kind !== 'element' || !anchor.row) return anchor;
  const api = boardApi(anchor.board);
  if (!api) return anchor;
  // Repeated in any copy: a nested list can hold one item in its first row and more in the next.
  return keepRow(anchor, (tid) => {
    try {
      const copies = Math.min(api.rects([tid])[tid]?.length ?? 1, 50);
      for (let instance = 0; instance < copies; instance++) if (api.repeatedRows(tid, instance).at(-1)?.tid === tid) return true;
      return false;
    } catch {
      return true;
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Placing new threads                                                         */
/* -------------------------------------------------------------------------- */

/** What lies under a world point of the current page: a note, an element of an artboard, an artboard, or nothing. */
export function anchorAt(world: { x: number; y: number }): DesignAnchor {
  const { canvas, boards } = useDocument.getState();
  const page = useView.getState().page;
  const inside = (r: Rect): boolean => world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h;
  // Notes are drawn over artboards; later ones over earlier ones.
  const noteIds = notesOnPage(canvas, page);
  for (const id of [...noteIds].reverse()) {
    const rect = noteRect(canvas.notes[id]!);
    if (inside(rect)) return noteAnchor(page, id, rect, world);
  }
  for (const path of [...boardsOnPage(canvas, page)].reverse()) {
    const entry = canvas.boards[path]!;
    if (!inside(entry)) continue;
    const local = { x: world.x - entry.x, y: world.y - entry.y };
    const api = boardApi(path);
    const source = boards[path]?.source;
    let tid: number | null = null;
    let instance = 0;
    try {
      const hit = api?.pick(local.x, local.y);
      tid = hit?.tid ?? null;
      instance = hit?.instance ?? 0;
    } catch {
      tid = null;
    }
    if (tid !== null && source) {
      const model = templateOf(source);
      const element = model.elements[tid];
      if (element) {
        return elementAnchor({ page, board: path, tid, path: elementPath(model, element), model, box: liveElementRect(path, tid), local, row: rowAt(path, tid, instance) });
      }
    }
    return boardAnchor(page, path, local);
  }
  return { kind: 'point', page, x: Math.round(world.x), y: Math.round(world.y) };
}

/** Starts a thread on the selection when requested by the global frame shell. */
export function commentOnSelection(): void {
  if (!canComment()) {
    toast.add({ title: 'You can only view this design' });
    return;
  }
  const view = useView.getState();
  const { canvas, boards } = useDocument.getState();
  const selection = view.selection;
  let anchor: DesignAnchor | null = null;
  const lead = leadMember(selection);
  if (lead?.kind === 'element') {
    const { board, item } = lead;
    const source = boards[board]?.source;
    if (source) {
      const box = liveElementRect(board, item.tid);
      anchor = elementAnchor({ page: view.page, board, tid: item.tid, path: item.path, model: templateOf(source), box, row: rowAt(board, item.tid, item.instance) });
    }
  } else if (lead?.kind === 'board' && canvas.boards[lead.board]) anchor = boardAnchor(view.page, lead.board);
  else if (lead?.kind === 'note' && canvas.notes[lead.note]) anchor = noteAnchor(view.page, lead.note, null);
  const comments = useComments.getState();
  if (!anchor) {
    comments.setOn(true);
    return;
  }
  comments.setOn(true);
  comments.setDraft(anchor);
}

/* -------------------------------------------------------------------------- */
/* Thread actions                                                              */
/* -------------------------------------------------------------------------- */

/** Location details the agent reads with a thread. */
function locationOf(anchor: DesignAnchor): JsonRecord {
  const { canvas } = useDocument.getState();
  const location = anchorLocation(liveRow(anchor), (board, tid, path) => formatAddress(board, tid, path)) as JsonRecord;
  if (anchor.kind === 'area') {
    const covered = boardsInArea(anchor, canvas.boards, boardsOnPage(canvas, anchor.page));
    if (covered.length) location.artboards = covered.slice(0, 20);
  }
  const page = anchor.kind !== 'canvas' ? canvas.pages.find((p) => p.id === anchor.page) : undefined;
  if (page) location.pageName = page.name;
  return location;
}

export const createThread = designComments.create;
export const replyThread = designComments.reply;
export const resolveThread = designComments.resolve;
export const removeComment = designComments.remove;
export const moveThread = designComments.move;
export const sendThreadToAgent = designComments.sendToAgent;
export const sendAllToAgent = designComments.sendAllToAgent;
/** Shows a thread: its page, its pin in view and its card open. */
export const revealThread = (thread: CommentThread): void => designComments.reveal(thread);

/** Brings an anchor into view: its page, and its pin a little left of centre so the card fits. */
function revealAnchor(anchor: DesignAnchor): void {
  const view = useView.getState();
  if (view.mode === 'focused') view.focus(null);
  if (anchor.kind === 'canvas') return;
  const { canvas } = useDocument.getState();
  const page = anchor.page && canvas.pages.some((p) => p.id === anchor.page) ? anchor.page : (canvas.pages[0]?.id ?? null);
  if (page !== view.page) view.setPage(page);
  const world = pinWorld(resolveNow(anchor), pinContext());
  if (!world) return;
  const camera = useView.getState().camera;
  const zoom = Math.max(camera.zoom, 0.5);
  glideTo({ zoom, x: viewportSize.width * 0.4 - world.x * zoom, y: viewportSize.height * 0.4 - world.y * zoom });
}

/* -------------------------------------------------------------------------- */
/* Placing pins (what the shared views ask of the design)                      */
/* -------------------------------------------------------------------------- */

/** Where an anchor's pin sits on a page, or `null` (another page, or no pin). */
export function placeOnPage(anchor: DesignAnchor, page: string | null, ctx: PinContext = pinContext()): PinPlace | null {
  if (!onPage(anchor, page, useDocument.getState().canvas.pages[0]?.id ?? null)) return null;
  const resolved = resolveNow(anchor);
  const world = pinWorld(resolved, ctx);
  return world ? { world, state: resolved.state } : null;
}

/** The world box an open thread's anchor highlights. */
export function highlightOf(anchor: DesignAnchor): (Rect & { area?: boolean }) | null {
  const box = anchorHighlight(resolveNow(anchor), pinContext());
  return box && anchor.kind === 'area' ? { ...box, area: true } : box;
}
