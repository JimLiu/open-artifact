/**
 * Dragging notes and pieces into an artboard: the artboard under the
 * pointer lights up while they hover it, and letting go there turns them
 * into the artboard's elements, in one undo step with their leaving the
 * canvas.
 */

import { create } from 'zustand';
import { elementChildren, elementPath, elementSource } from '@open-artifact/dc';
import { boardsOnPage, type Rect } from '@open-artifact/design-core';
import { toast } from '@open-artifact/ui';
import { allLoose, inPlaceCentre, JOIN_FAILED, joinMessages, joinTargetAt, type JoinNoun, type LooseObjects } from '../lib/join.ts';
import { noteHtml } from '../lib/note-html.ts';
import { arrangeLayers, boundsOf, type Layer } from '../lib/paste-layers.ts';
import type { Address, BoardOp } from '../lib/ops.ts';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { layerPlace } from './clipboard.ts';
import { tryEdit } from './commands.ts';
import { flowSpotAt, type FlowDrop } from './gestures.ts';
import { settledInsert } from './insert-place.ts';
import { refuseLocked } from './locks.ts';
import { boardDrop, boardName } from './paste-into.ts';

/** The artboard dragged things would join, and how. */
export interface JoinPreview {
  target: string;
  /** Where a single thing goes in flow; `null` when kept in place. */
  drop: FlowDrop | null;
  /** The dragged things where they are now (world coordinates). */
  rings: Rect[];
}

export const useJoin = create<{ preview: JoinPreview | null }>()(() => ({ preview: null }));

/** Sizes notes rendered at, for notes whose size comes from their text. */
export type NoteSizes = (id: string) => { w: number; h: number } | undefined;

/** The artboard under `pointer` that `members` would join, or `null`. */
function targetFor(members: LooseObjects, pointer: { x: number; y: number }): string | null {
  const doc = useDocument.getState();
  const view = useView.getState();
  if (doc.readOnly || view.mode !== 'canvas') return null;
  const target = joinTargetAt(doc.canvas, boardsOnPage(doc.canvas, view.page), pointer, members);
  return target && target !== view.playing ? target : null;
}

const countOf = (members: LooseObjects) => members.boards.length + members.notes.length;

/**
 * Shows (or clears) the join preview for `members` dragged so that the
 * pointer is at `pointer`; `rects` are where they are now, `inPlace` keeps
 * them there (Ctrl). Returns the artboard they would join.
 */
export function joinHover(members: LooseObjects, rects: readonly Rect[], pointer: { x: number; y: number }, inPlace: boolean): string | null {
  const target = targetFor(members, pointer);
  if (!target) {
    endJoinHover();
    return null;
  }
  const drop = countOf(members) === 1 && !inPlace ? flowSpotAt(target, pointer) : null;
  useJoin.setState({ preview: { target, drop, rings: [...rects] } });
  return target;
}

export function endJoinHover(): void {
  if (useJoin.getState().preview) useJoin.setState({ preview: null });
}

/** True when `members` dragged now could join an artboard (all of them notes or pieces). */
export function canJoin(members: LooseObjects): boolean {
  return !useDocument.getState().readOnly && allLoose(useDocument.getState().canvas, members);
}

interface MemberLayer extends Layer {
  noun: JoinNoun;
  helmet?: string;
}

/** The members as artboard markup, moved by `offset`; or why one can’t be. */
function memberLayers(members: LooseObjects, offset: { x: number; y: number }, sizes: NoteSizes, source: string): MemberLayer[] | string {
  const doc = useDocument.getState();
  const layers: MemberLayer[] = [];
  let n = 0;
  const freshId = () => {
    let id: string;
    do id = `arrow-head-${++n}`;
    while (source.includes(`"${id}"`));
    return id;
  };
  for (const id of members.notes) {
    const note = doc.canvas.notes[id];
    const noun: JoinNoun = note?.kind === 'image' ? 'image' : 'note';
    const layer = note ? noteHtml(note, { freshId, measured: sizes(id) }) : null;
    if (!layer) return joinMessages.nothing(noun);
    layers.push({ html: layer.html, box: { ...layer.box, x: layer.box.x + offset.x, y: layer.box.y + offset.y }, groups: note!.groups, noun });
  }
  for (const path of members.boards) {
    const entry = doc.canvas.boards[path];
    const text = doc.boards[path]?.source;
    if (!entry || !text) return joinMessages.nothing('piece');
    const model = templateOf(text);
    const tops = elementChildren(model.nodes);
    const roots = tops.filter((element) => element.tag !== 'helmet');
    if (roots.length > 1) return joinMessages.pieceCount(roots.length);
    if (!roots.length) return joinMessages.nothing('piece');
    const helmet = tops.find((element) => element.tag === 'helmet');
    const carried = helmet && helmet.closeStart >= 0 ? model.text.slice(helmet.openEnd, helmet.closeStart).trim() : '';
    layers.push({
      // Moved, not copied: locked layers inside stay locked.
      html: elementSource(model, roots[0]!),
      box: { x: entry.x + offset.x, y: entry.y + offset.y, w: entry.w, h: entry.h },
      noun: 'piece',
      ...(carried ? { helmet: carried } : {}),
    });
  }
  return layers;
}

/**
 * Lets go of `members` (moved by `offset`) with the pointer at `pointer`.
 * Over an artboard that takes them, they become its elements: one in flow
 * where the preview showed (or kept in place with `inPlace`), several as
 * positioned layers. Returns false when no artboard is under the pointer
 * (an ordinary move); true when handled, moved or refused.
 */
export function joinInto(members: LooseObjects, offset: { x: number; y: number }, pointer: { x: number; y: number }, inPlace: boolean, sizes: NoteSizes): boolean {
  endJoinHover();
  const target = targetFor(members, pointer);
  if (!target) return false;
  joinBoard(members, target, { pointer, inPlace, offset }, sizes);
  return true;
}

/** Where joined things go: by the pointer (in flow, or kept in place), or as layers on the middle of the artboard’s part in view. */
export type JoinSpot = { pointer: { x: number; y: number }; inPlace: boolean; offset: { x: number; y: number } } | 'centre';

/** Turns `members` into elements of `target` (see `joinInto`); says how it went. Returns whether they moved. */
export function joinBoard(members: LooseObjects, target: string, spotAt: JoinSpot, sizes: NoteSizes): boolean {
  const doc = useDocument.getState();
  const offset = spotAt === 'centre' ? { x: 0, y: 0 } : spotAt.offset;
  const source = doc.boards[target]?.source;
  const entry = doc.canvas.boards[target];
  const place = layerPlace(target);
  const drop = spotAt === 'centre' ? boardDrop(target) : null;
  if (!source || !entry || !place || (spotAt === 'centre' && !drop)) {
    toast.add({ title: JOIN_FAILED });
    return false;
  }
  const layers = memberLayers(members, offset, sizes, source);
  if (typeof layers === 'string') {
    toast.add({ title: layers });
    return false;
  }
  const noun = layers[0]!.noun;
  const helmet = layers.flatMap((layer) => (layer.helmet ? [layer.helmet] : [])).join('\n') || undefined;
  const spot = spotAt !== 'centre' && layers.length === 1 && !spotAt.inPlace ? flowSpotAt(target, spotAt.pointer) : null;
  let insert: Extract<BoardOp, { kind: 'insert' }>;
  let anchor: Address | null = null;
  if (spot) {
    const html = layers[0]!.html;
    insert = { kind: 'insert', ...settledInsert(target, { target: spot.target, position: spot.position }, html), html, helmet, keepLocks: true };
  } else {
    const centre = drop ? { x: drop.x - place.box.x, y: drop.y - place.box.y } : inPlaceCentre(boundsOf(layers.map((layer) => layer.box)), entry, place.box);
    const html = arrangeLayers(layers, centre);
    if (html === null) {
      toast.add({ title: joinMessages.nothing(noun) });
      return false;
    }
    const container = place.container ? { tid: place.model.tidOf.get(place.container)!, path: elementPath(place.model, place.container) } : null;
    if (container && place.anchor) anchor = container;
    insert = { kind: 'insert', target: container, position: 'last-child', html, helmet, keepLocks: true };
  }

  // Set inside the step (the compiler can't see that).
  let created = [] as Address[];
  let refusal = null as string | null;
  doc.transact((cancel) => {
    const stop = (why: string) => {
      refusal = why;
      cancel();
    };
    if (anchor) {
      const anchored = tryEdit(target, { kind: 'style', targets: [anchor], patch: { position: 'relative' } });
      if (anchored.kind !== 'done') return stop(anchored.kind === 'locked' ? 'locked' : JOIN_FAILED);
    }
    const outcome = tryEdit(target, insert);
    if (outcome.kind !== 'done' || !outcome.created.length) return stop(outcome.kind === 'locked' ? 'locked' : JOIN_FAILED);
    created = outcome.created;
    const store = useDocument.getState();
    if (members.notes.length) {
      store.updateCanvas((canvas) => {
        const notes = { ...canvas.notes };
        for (const id of members.notes) delete notes[id];
        return { ...canvas, notes };
      });
    }
    if (members.boards.length) store.deleteBoards([...members.boards]);
    const after = useDocument.getState().canvas;
    if (members.notes.some((id) => id in after.notes) || members.boards.some((path) => path in after.boards)) stop(joinMessages.stuck(noun));
  });
  if (refusal === 'locked') refuseLocked();
  else if (refusal) toast.add({ title: refusal });
  else {
    const items: ElementSelection[] = created.map((address) => ({ ...address, instance: 0 }));
    useView.getState().select({ kind: 'elements', board: target, items });
    toast.add({ title: joinMessages.moved(boardName(target)) });
  }
  return !refusal;
}
