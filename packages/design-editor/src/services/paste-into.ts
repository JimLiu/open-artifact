/**
 * Pasting copied artboards, notes and elements into one artboard as
 * positioned layers, centred on the part of the artboard in view.
 */

import { elementPath, elementSource, parseTemplate, elementChildren, styleMap, attributeValue, type HtmlElement, type TemplateModel } from '@open-artifact/dc';
import { isLockedObject, type Rect } from '@open-artifact/design-core';
import { toast } from '@open-artifact/ui';
import type { ClipboardPayload } from '../lib/clipboard-data.ts';
import { noteHtml } from '../lib/note-html.ts';
import { arrangeLayers, boundsOf, dropPoint, layerPatch, staysInPlace, styledMarkup, type Layer } from '../lib/paste-layers.ts';
import { writeBackPatch } from '../lib/layout-write-back.ts';
import { withoutLocks } from '../lib/locks.ts';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { tryEdit } from './commands.ts';
import { liveElementOf } from './capture.ts';
import { carriedCss, dependsOnArtboard, helmetFor, renderedMarkup } from './carry.ts';
import { frameOf } from './frames.ts';
import { refuseLocked } from './locks.ts';
import { visibleRect } from './viewport.ts';

/** Where layers go in an artboard. */
export interface LayerPlace {
  model: TemplateModel;
  /** The element the layers go into; `null`: the end of the template. */
  container: HtmlElement | null;
  /** The container's padding box, in the artboard's pixels. */
  box: Rect;
  /** The container is not positioned yet: it is given `position: relative` first. */
  anchor: boolean;
}

/** How a paste into an artboard went: done, not for this path, or the copies go on the canvas at `at`. */
export type LayerPaste = { kind: 'done' } | { kind: 'fallback' } | { kind: 'canvas'; at: { x: number; y: number } };

/** The last paste into an artboard, while what it pasted stays selected. */
let lastInto: { board: string; payload: string; items: string } | null = null;

/** What identifies a payload between pastes (the rendering for other apps aside). */
const payloadKey = (payload: ClipboardPayload): string => JSON.stringify(payload.kind === 'elements' ? { ...payload, standalone: undefined } : payload);

const itemsKey = (items: readonly { tid: number; instance: number }[]): string => items.map((item) => `${item.tid}:${item.instance}`).sort().join(',');

/** An artboard's name as people see it: its file name without the extension. */
export const boardName = (path: string): string => path.replace(/\.dc\.html$/, '').replace(/^.*\//, '');

/**
 * The artboard a paste goes into as layers: the one the context menu was
 * opened on, else the one selected artboard, else (pasting the same thing
 * again while the last paste stays selected) the artboard pasted into last.
 * `null` when there is none, or it is a piece, locked or playing.
 */
export function layerPasteBoard(payload: ClipboardPayload, menuBoard: string | null): string | null {
  const view = useView.getState();
  const { selection } = view;
  let board: string | null = menuBoard;
  if (!board && selection.kind === 'objects' && selection.boards.length === 1 && !selection.notes.length) board = selection.boards[0]!;
  if (!board && lastInto && selection.kind === 'elements' && selection.board === lastInto.board && itemsKey(selection.items) === lastInto.items && lastInto.payload === payloadKey(payload)) {
    board = lastInto.board;
  }
  if (!board) return null;
  const entry = useDocument.getState().canvas.boards[board];
  if (!entry || entry.frameless || isLockedObject(entry) || view.playing === board) return null;
  return board;
}

/** The point layers centre on, in the artboard's pixels. */
export function boardDrop(board: string): { x: number; y: number } | null {
  const entry = useDocument.getState().canvas.boards[board];
  if (!entry) return null;
  const view = useView.getState();
  return dropPoint({ x: entry.x, y: entry.y, w: entry.w, h: entry.h }, view.mode === 'focused' ? null : visibleRect(view.camera));
}

/** Ids for arrow heads that no element of the artboard uses yet. */
function idMaker(source: string): () => string {
  let n = 0;
  return () => {
    let id: string;
    do id = `arrow-head-${++n}`;
    while (source.includes(`"${id}"`));
    return id;
  };
}

/** The single top-level element of a template, if it has one. */
function soleRoot(model: TemplateModel): HtmlElement | null {
  const tops = elementChildren(model.nodes).filter((el) => el.tag !== 'helmet');
  return tops.length === 1 ? tops[0]! : null;
}

/** Layers for copied artboards and notes; `null` when one has no HTML, 'roots' when an artboard has several roots. */
function objectLayers(payload: Extract<ClipboardPayload, { kind: 'objects' }>, source: string): { layers: Layer[]; css: string[] } | null | 'roots' {
  const layers: Layer[] = [];
  const freshId = idMaker(source);
  for (const note of payload.notes) {
    const layer = noteHtml(note, { freshId });
    if (!layer) return null;
    layers.push({ html: layer.html, box: layer.box, groups: note.groups });
  }
  const css: string[] = [];
  for (const { path, entry, source: boardSource } of payload.boards) {
    const model = templateOf(boardSource);
    const root = soleRoot(model);
    if (!root) return 'roots';
    let html = withoutLocks(elementSource(model, root));
    // A root drawn from its own artboard's values is pasted as it renders, when that artboard is open here.
    if (useDocument.getState().boards[path]?.source === boardSource) {
      const live = liveElementOf(path, { tid: model.tidOf.get(root)!, path: elementPath(model, root), instance: 0 }, { descend: false, svg: false });
      if (live) {
        if (dependsOnArtboard(html)) html = withoutLocks(renderedMarkup(model, live));
        css.push(...carriedCss([live]));
      }
    }
    layers.push({ html, box: { x: entry.x, y: entry.y, w: entry.w, h: entry.h }, root: true });
  }
  return { layers, css };
}

/** Copied elements placed around `drop` (or where they were), each written back as a positioned layer. */
export function elementLayers(payload: Extract<ClipboardPayload, { kind: 'elements' }>, board: string, place: LayerPlace, drop: { x: number; y: number }): { html: string; helmet?: string } | null {
  const boxes = payload.boxes;
  if (!boxes || boxes.length !== payload.html.length) return null;
  const same = payload.board === board && (payload.from ?? location.pathname) === location.pathname;
  const markups = payload.html.map((html, index) => (same ? html : (payload.rendered?.[index] ?? html)));
  const group = boundsOf(boxes.map((box) => ({ x: box.left, y: box.top, w: box.width, h: box.height })));
  const stay = same && staysInPlace(group, { x: place.box.x, y: place.box.y, w: place.box.w, h: place.box.h });
  const shift = stay
    ? { x: -place.box.x, y: -place.box.y }
    : { x: drop.x - place.box.x - group.w / 2 - group.x, y: drop.y - place.box.y - group.h / 2 - group.y };
  const out: string[] = [];
  for (const [index, markup] of markups.entries()) {
    const box = boxes[index]!;
    const element = elementChildren(parseTemplate(markup.trim()).nodes)[0];
    if (!element) return null;
    const left = box.left + shift.x, top = box.top + shift.y;
    const patch = writeBackPatch({ tag: element.tag, inline: styleMap(attributeValue(element, 'style') ?? ''), box: { left, top, width: box.width, height: box.height }, computed: box.computed })
      ?? layerPatch(markup, left, top);
    const placed = styledMarkup(markup, patch);
    if (placed === null) return null;
    out.push(placed);
  }
  return { html: out.join('\n'), helmet: same ? undefined : helmetFor(payload.css, frameOf(board)?.contentDocument) };
}

/**
 * Pastes `payload` into `board` as positioned layers. `place` is where they
 * go (`null` when the artboard is not loaded). Copies of an artboard with
 * several roots go on the canvas instead (`canvas`); notes without HTML
 * and elements copied without their boxes take the ordinary paste.
 */
export function pasteAsLayers(payload: ClipboardPayload, board: string, place: LayerPlace | null): LayerPaste {
  const name = boardName(board);
  const source = useDocument.getState().boards[board]?.source;
  const drop = boardDrop(board);
  if (!drop) return { kind: 'fallback' };
  if (!place || !source) {
    toast.add({ title: `Couldn’t paste into ${name}: it isn’t loaded yet. Click it, then paste again.` });
    return { kind: 'done' };
  }
  let markup: { html: string; helmet?: string } | null;
  if (payload.kind === 'objects') {
    const made = objectLayers(payload, source);
    if (made === null) return { kind: 'fallback' };
    if (made === 'roots') {
      const entry = useDocument.getState().canvas.boards[board]!;
      return { kind: 'canvas', at: { x: entry.x + drop.x, y: entry.y + drop.y } };
    }
    const html = arrangeLayers(made.layers, { x: drop.x - place.box.x, y: drop.y - place.box.y });
    if (html === null) return { kind: 'fallback' };
    markup = { html, helmet: helmetFor(made.css, frameOf(board)?.contentDocument) };
  } else {
    markup = elementLayers(payload, board, place, drop);
    if (!markup) return { kind: 'fallback' };
  }
  try {
    const key = `paste-into-${Date.now()}`;
    const target = place.container ? { tid: place.model.tidOf.get(place.container)!, path: elementPath(place.model, place.container) } : null;
    if (target && place.anchor) {
      const anchored = tryEdit(board, { kind: 'style', targets: [target], patch: { position: 'relative' } }, { coalesce: key });
      if (anchored.kind === 'locked') {
        refuseLocked();
        return { kind: 'done' };
      }
    }
    const outcome = tryEdit(board, { kind: 'insert', target, position: 'last-child', html: markup.html, helmet: markup.helmet }, { coalesce: key });
    if (outcome.kind === 'locked') refuseLocked();
    else if (outcome.kind !== 'done' || !outcome.created.length) toast.add({ title: 'Could not paste: nothing changed.' });
    else {
      const items: ElementSelection[] = outcome.created.map((address) => ({ ...address, instance: 0 }));
      useView.getState().select({ kind: 'elements', board, items });
      lastInto = { board, payload: payloadKey(payload), items: itemsKey(items) };
      toast.add({ title: `Pasted into ${name}` });
    }
  } catch {
    toast.add({ title: 'Couldn’t paste.' });
  }
  return { kind: 'done' };
}
