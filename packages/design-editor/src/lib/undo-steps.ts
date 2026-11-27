/**
 * Undo steps of the document store, and how one step is gathered from
 * changes to `canvas.json` and several artboard files.
 *
 * A change the user sees as one action (delete elements on two artboards
 * and a note, move artboards with elements of others) touches several
 * files. While a step is open the store notes what each file looked like
 * before its first change; closing the step turns that into one entry.
 */

import type { Canvas } from '@open-artifact/design-core';
import type { BoardOp } from './ops.ts';

/** An artboard file as undo sees it. */
export interface BoardState {
  source: string;
  pending: BoardOp[];
}

/** One artboard's change. */
export interface BoardHistory {
  scope: 'board';
  path: string;
  before: BoardState;
  after: BoardState;
  key?: string;
}

/** Changes to the canvas and artboard files taken back together. */
export interface FilesHistory {
  scope: 'files';
  canvas: { before: Canvas; after: Canvas } | null;
  changes: BoardHistory[];
  /** Steps with the same key that follow each other join (a held arrow, a drag). */
  key?: string;
}

/** One undo step. */
export type HistoryEntry =
  | { scope: 'canvas'; before: Canvas; after: Canvas }
  | BoardHistory
  | { scope: 'boards'; changes: BoardHistory[] }
  | FilesHistory;

/** What an open step has noted: each file before its first change. */
export interface OpenStep {
  canvas: Canvas | null;
  boards: Map<string, BoardState>;
}

export const openStep = (): OpenStep => ({ canvas: null, boards: new Map() });

/** Notes an artboard before a change (only its first change counts). */
export function noteBoard(step: OpenStep, path: string, before: BoardState): void {
  if (!step.boards.has(path)) step.boards.set(path, before);
}

/** Notes the canvas before a change (only its first change counts). */
export function noteCanvas(step: OpenStep, before: Canvas): void {
  if (!step.canvas) step.canvas = before;
}

/**
 * The entry an open step closes into, given the files now; `null` when
 * nothing changed. Without a key the entry takes the simplest scope that
 * holds it; with one it is always `files`, so the next step with that key
 * can join it.
 */
export function closeStep(
  step: OpenStep,
  now: { canvas: Canvas; board: (path: string) => BoardState | null },
  key?: string,
): HistoryEntry | null {
  const changes: BoardHistory[] = [];
  for (const [path, before] of step.boards) {
    const after = now.board(path);
    if (after && after.source !== before.source) changes.push({ scope: 'board', path, before, after });
  }
  const canvas = step.canvas && step.canvas !== now.canvas ? { before: step.canvas, after: now.canvas } : null;
  if (!canvas && !changes.length) return null;
  if (key) return { scope: 'files', canvas, changes, key };
  if (canvas && !changes.length) return { scope: 'canvas', ...canvas };
  if (!canvas && changes.length === 1) return changes[0]!;
  if (!canvas) return { scope: 'boards', changes };
  return { scope: 'files', canvas, changes };
}

/**
 * `next` added onto `last` when they are steps of one action: the same
 * key, and every file `next` changed is where `last` left it. `null` when
 * they stay apart.
 */
export function joinSteps(last: HistoryEntry | undefined, next: HistoryEntry): FilesHistory | null {
  if (last?.scope !== 'files' || next.scope !== 'files' || !next.key || last.key !== next.key) return null;
  if (next.canvas && last.canvas && last.canvas.after !== next.canvas.before) return null;
  for (const change of next.changes) {
    const earlier = last.changes.find((step) => step.path === change.path);
    if (earlier && earlier.after.source !== change.before.source) return null;
  }
  const changes = last.changes.map((earlier) => {
    const later = next.changes.find((step) => step.path === earlier.path);
    return later ? { ...earlier, after: later.after } : earlier;
  });
  for (const change of next.changes) if (!last.changes.some((step) => step.path === change.path)) changes.push(change);
  const canvas = last.canvas && next.canvas ? { before: last.canvas.before, after: next.canvas.after } : (last.canvas ?? next.canvas);
  return { scope: 'files', canvas, changes, key: next.key };
}

/** The artboard changes of an entry. */
export function boardChanges(entry: HistoryEntry): BoardHistory[] {
  if (entry.scope === 'canvas') return [];
  return entry.scope === 'board' ? [entry] : entry.changes;
}

/** The canvas change of an entry. */
export function canvasChange(entry: HistoryEntry): { before: Canvas; after: Canvas } | null {
  if (entry.scope === 'canvas') return { before: entry.before, after: entry.after };
  return entry.scope === 'files' ? entry.canvas : null;
}

/** Whether an entry changes this artboard. */
export const touchesBoard = (entry: HistoryEntry, path: string): boolean => boardChanges(entry).some((step) => step.path === path);
