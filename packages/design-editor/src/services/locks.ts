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
import { isElementLocked, isLockable, LOCKED_MESSAGE, LOCKED_REASON, nextLockState, UNLOCKABLE_MESSAGE } from '../lib/locks.ts';
import type { Address } from '../lib/ops.ts';
import { useDocument, type BoardDoc } from '../state/document.ts';
import { useView, type Selection } from '../state/view.ts';
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

/** The selected elements that resolve in their artboard's source. */
function resolvedElements(boards: Record<string, BoardDoc>, selection: Selection): { board: string; elements: HtmlElement[]; addresses: Address[] } | null {
  if (selection.kind !== 'elements') return null;
  const source = boards[selection.board]?.source;
  if (!source) return null;
  const model = templateOf(source);
  const elements: HtmlElement[] = [];
  const addresses: Address[] = [];
  for (const { tid, path } of selection.items) {
    const element = resolveElement(model, tid, path);
    if (!element) continue;
    elements.push(element);
    addresses.push({ tid, path });
  }
  return { board: selection.board, elements, addresses };
}

/** How locked a selection is, against a document. */
export function lockOf(canvas: Canvas, boards: Record<string, BoardDoc>, selection: Selection): SelectionLock {
  let states: boolean[] = [];
  if (selection.kind === 'objects') {
    states = [
      ...selection.boards.filter((path) => canvas.boards[path]).map((path) => isLockedObject(canvas.boards[path])),
      ...selection.notes.filter((id) => canvas.notes[id]).map((id) => isLockedObject(canvas.notes[id])),
    ];
  } else {
    const resolved = resolvedElements(boards, selection);
    if (!resolved) return NO_LOCK;
    states = resolved.elements.filter(isLockable).map(isElementLocked);
  }
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
  return selection.kind === 'objects' ? selection.boards.includes(path) : selection.kind === 'elements' && selection.board === path;
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
  if (selection.kind === 'objects') {
    const next = setObjectLocks(doc.canvas, selection.boards, selection.notes, locked);
    if (next === doc.canvas) return;
    doc.updateCanvas(() => next);
  } else {
    const resolved = resolvedElements(doc.boards, selection);
    if (!resolved) return;
    const targets = resolved.addresses.filter((_, i) => isLockable(resolved.elements[i]!));
    // Words being typed are written first: the edit re-renders the board.
    if (useView.getState().textEdit?.board === resolved.board) boardApi(resolved.board)?.endTextEdit(true);
    if (!useDocument.getState().editBoard(resolved.board, { kind: 'lock', targets, locked })) return;
  }
  announce(locked ? 'Locked' : 'Unlocked');
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
