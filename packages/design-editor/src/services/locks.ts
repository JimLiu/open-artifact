/**
 * Locking the selection, and the checks commands, menus and panels share.
 *
 * Elements lock through `data-locked` in their artboard's source; artboards
 * and notes through `locked` in canvas.json. The rules are in `lib/locks.ts`
 * and design-core `locks.ts`; this module reads them against the stores.
 */

import { useMemo } from 'react';
import { isLockedObject, setObjectLocks, type Canvas } from '@open-artifact/design-core';
import { resolveElement, type HtmlElement } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { deleteLockReason, isElementLocked, isLockable, LOCKED_MESSAGE, LOCKED_REASON, nextLockState, UNLOCKABLE_MESSAGE } from '../lib/locks.ts';
import type { Address } from '../lib/ops.ts';
import { useDocument, type BoardDoc } from '../state/document.ts';
import { useView, type Selection } from '../state/view.ts';
import { boardTakesPart, elementGroupsOf, selectedBoardsOf, selectedNotesOf } from '../lib/selection.ts';
import { templateOf } from './agent.ts';
import { announce } from './announce.ts';
import { boardApi } from './frames.ts';

/** How locked the selection is. */
export interface SelectionLock {
  /** Selected things that can take a lock. */
  lockable: number;
  /** Lockable things that are locked. */
  locked: number;
  /** What toggling does: lock (`true`), unlock (`false`), nothing (`null`). */
  next: boolean | null;
}

const NO_LOCK: SelectionLock = { lockable: 0, locked: 0, next: null };

/** Selected elements of one artboard that resolve in its source. */
interface ResolvedElements {
  board: string;
  elements: HtmlElement[];
  addresses: Address[];
}

/** The selected elements that resolve in their artboards' sources, by artboard. */
function resolvedElements(boards: Record<string, BoardDoc>, selection: Selection): ResolvedElements[] {
  const out: ResolvedElements[] = [];
  for (const group of elementGroupsOf(selection)) {
    const source = boards[group.board]?.source;
    if (!source) continue;
    const model = templateOf(source);
    const resolved: ResolvedElements = { board: group.board, elements: [], addresses: [] };
    for (const { tid, path } of group.items) {
      const element = resolveElement(model, tid, path);
      if (!element) continue;
      resolved.elements.push(element);
      resolved.addresses.push({ tid, path });
    }
    out.push(resolved);
  }
  return out;
}

/** How locked a selection is, against a document. */
export function lockOf(canvas: Canvas, boards: Record<string, BoardDoc>, selection: Selection): SelectionLock {
  const objects = [
    ...selectedBoardsOf(selection).filter((path) => canvas.boards[path]).map((path) => isLockedObject(canvas.boards[path])),
    ...selectedNotesOf(selection).filter((id) => canvas.notes[id]).map((id) => isLockedObject(canvas.notes[id])),
  ];
  const elements = resolvedElements(boards, selection).flatMap((resolved) => resolved.elements.filter(isLockable).map(isElementLocked));
  const states = [...objects, ...elements];
  if (!states.length) return NO_LOCK;
  return { lockable: states.length, locked: states.filter(Boolean).length, next: nextLockState(states) };
}

/** How locked the current selection is. */
export function selectionLock(): SelectionLock {
  const { canvas, boards } = useDocument.getState();
  return lockOf(canvas, boards, useView.getState().selection);
}

/** The selection's lock, kept current (for menus, bars and panels). */
export function useSelectionLock(): SelectionLock {
  const canvas = useDocument((state) => state.canvas);
  const boards = useDocument((state) => state.boards);
  const selection = useView((state) => state.selection);
  return useMemo(() => lockOf(canvas, boards, selection), [canvas, boards, selection]);
}

/**
 * Why changes that place, size, delete or restructure the selection are
 * disabled: `LOCKED_REASON` when any of it is locked, else `null`.
 */
export function useLockedWhy(): string | null {
  return useSelectionLock().locked ? LOCKED_REASON : null;
}

/** Why Delete is disabled by locks, kept current; `null` when it isn't. */
export function useDeleteLockedWhy(): string | null {
  const lock = useSelectionLock();
  const kind = useView((state) => state.selection.kind);
  return kind === 'none' ? null : deleteLockReason(kind, lock);
}

/** True when anything selected is locked. */
export function selectionHasLock(): boolean {
  return selectionLock().locked > 0;
}

/** Shows that an action was refused because something is locked. */
export function refuseLocked(): void {
  toast.add({ title: LOCKED_MESSAGE });
}

/** Refuses (with the toast) when anything selected is locked; returns true then. */
export function refuseIfLocked(): boolean {
  if (!selectionHasLock()) return false;
  refuseLocked();
  return true;
}

/** True when the artboard is selected, or something in it is. */
export function boardIsActive(selection: Selection, path: string): boolean {
  return boardTakesPart(selection, path);
}

/**
 * True for a locked artboard nothing is selected in: it is no hover target,
 * and a press on it counts as a press on the empty canvas.
 */
export function boardPassesThrough(path: string): boolean {
  return isBoardLocked(path) && !boardIsActive(useView.getState().selection, path);
}

/** True when an artboard is locked. */
export function isBoardLocked(path: string): boolean {
  return isLockedObject(useDocument.getState().canvas.boards[path]);
}

/**
 * Locks everything selected, or unlocks it when all of it is locked (⌘L),
 * as one undo step.
 */
export function toggleSelectionLock(): void {
  const doc = useDocument.getState();
  const { selection } = useView.getState();
  if (doc.readOnly || selection.kind === 'none') return;
  const lock = lockOf(doc.canvas, doc.boards, selection);
  if (lock.next === null) {
    toast.add({ title: UNLOCKABLE_MESSAGE });
    return;
  }
  const locked = lock.next;
  const resolved = resolvedElements(doc.boards, selection);
  // Words being typed are written first: the edit re-renders the board.
  const typing = useView.getState().textEdit?.board;
  if (typing && resolved.some((group) => group.board === typing)) boardApi(typing)?.endTextEdit(true);
  let changed = false;
  doc.transact(() => {
    const next = setObjectLocks(doc.canvas, selectedBoardsOf(selection), selectedNotesOf(selection), locked);
    if (next !== doc.canvas) {
      doc.updateCanvas(() => next);
      changed = true;
    }
    for (const group of resolved) {
      const targets = group.addresses.filter((_, i) => isLockable(group.elements[i]!));
      if (targets.length && useDocument.getState().editBoard(group.board, { kind: 'lock', targets, locked })) changed = true;
    }
  });
  if (changed) announce(locked ? 'Locked' : 'Unlocked');
}

/** Unlocks one element (the outline's lock button). */
export function unlockElement(board: string, target: Address): void {
  const doc = useDocument.getState();
  if (doc.readOnly) return;
  if (doc.editBoard(board, { kind: 'lock', targets: [target], locked: false })) announce('Unlocked');
}

/** Unlocks artboards and notes (the outline's lock button). */
export function unlockObjects(boards: readonly string[], notes: readonly string[]): void {
  const doc = useDocument.getState();
  if (doc.readOnly) return;
  const next = setObjectLocks(doc.canvas, boards, notes, false);
  if (next === doc.canvas) return;
  doc.updateCanvas(() => next);
  announce('Unlocked');
}
