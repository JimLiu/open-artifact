/**
 * Canvas locks. An artboard or note marked `"locked": true` in canvas.json
 * stays where it is: it can't be moved, resized or deleted until it is
 * unlocked, which removes the key (it is never written as `false`).
 */

import type { Canvas } from './canvas.ts';

/** True for an artboard or note entry that is locked. */
export function isLockedObject(entry: { locked?: unknown } | undefined): boolean {
  return entry?.locked === true;
}

/** The artboards and notes of a list that are not locked. */
export function unlockedObjects(canvas: Canvas, boards: readonly string[], notes: readonly string[]): { boards: string[]; notes: string[] } {
  return {
    boards: boards.filter((path) => !isLockedObject(canvas.boards[path])),
    notes: notes.filter((id) => !isLockedObject(canvas.notes[id])),
  };
}

/** True when any of the artboards or notes is locked. */
export function anyLockedObject(canvas: Canvas, boards: readonly string[], notes: readonly string[]): boolean {
  return boards.some((path) => isLockedObject(canvas.boards[path])) || notes.some((id) => isLockedObject(canvas.notes[id]));
}

/** An entry without its lock (copies of locked artboards and notes start unlocked). */
export function withoutLock<T extends { locked?: boolean }>(entry: T): T {
  if (!('locked' in entry)) return entry;
  const copy = { ...entry };
  delete copy.locked;
  return copy;
}

/**
 * The canvas with the artboards and notes locked (`locked: true`) or
 * unlocked (the key removed). Returns the same canvas when nothing changes.
 */
export function setObjectLocks(canvas: Canvas, boards: readonly string[], notes: readonly string[], locked: boolean): Canvas {
  let nextBoards = canvas.boards;
  let nextNotes = canvas.notes;
  for (const path of boards) {
    const entry = nextBoards[path];
    if (!entry || (isLockedObject(entry) === locked && (locked || !('locked' in entry)))) continue;
    if (nextBoards === canvas.boards) nextBoards = { ...canvas.boards };
    nextBoards[path] = locked ? { ...entry, locked: true } : withoutLock(entry);
  }
  for (const id of notes) {
    const note = nextNotes[id];
    if (!note || (isLockedObject(note) === locked && (locked || !('locked' in note)))) continue;
    if (nextNotes === canvas.notes) nextNotes = { ...canvas.notes };
    nextNotes[id] = locked ? { ...note, locked: true } : withoutLock(note);
  }
  return nextBoards === canvas.boards && nextNotes === canvas.notes ? canvas : { ...canvas, boards: nextBoards, notes: nextNotes };
}
