/**
 * Notes and pieces dragged into an artboard: which artboard takes them,
 * where kept-in-place layers centre, and what the editor says.
 */

import { isLockedObject, type Canvas, type Rect } from '@open-artifact/design-core';

/** What a loose object is called in messages. */
export type JoinNoun = 'image' | 'note' | 'piece';

export const JOIN_FAILED = 'Couldn’t move. Nothing changed.';

export const joinMessages = {
  pieceCount: (count: number) => `Nothing moved. This piece holds ${count} elements. A piece with one element can join an artboard.`,
  nothing: (noun: JoinNoun) => `Nothing moved. This ${noun} has nothing that can go into an artboard.`,
  stuck: (noun: JoinNoun) => `Nothing moved. The ${noun} couldn’t leave the canvas.`,
  moved: (name: string) => `Moved into ${name}`,
};

/** Loose objects on the canvas: notes, and pieces (frameless artboards). */
export interface LooseObjects {
  boards: readonly string[];
  notes: readonly string[];
}

/** True when everything dragged is a note or a piece, and something is. */
export function allLoose(canvas: Canvas, members: LooseObjects): boolean {
  if (!members.boards.length && !members.notes.length) return false;
  return members.boards.every((path) => canvas.boards[path]?.frameless === true);
}

/**
 * The artboard loose objects dragged to `point` would join: the topmost
 * framed artboard under the point (of `order`, back to front), not one of
 * them. `null` when there is none, or it is locked.
 */
export function joinTargetAt(canvas: Canvas, order: readonly string[], point: { x: number; y: number }, members: LooseObjects): string | null {
  if (!allLoose(canvas, members)) return null;
  for (let index = order.length - 1; index >= 0; index--) {
    const path = order[index]!;
    const entry = canvas.boards[path];
    if (!entry || entry.frameless || members.boards.includes(path)) continue;
    if (point.x < entry.x || point.x > entry.x + entry.w || point.y < entry.y || point.y > entry.y + entry.h) continue;
    return isLockedObject(entry) ? null : path;
  }
  return null;
}

/**
 * The centre (in the container's padding box) that keeps layers where they
 * were dropped: `bounds` in world coordinates, the container's padding box
 * in the artboard's pixels, the artboard at `board`.
 */
export function inPlaceCentre(bounds: Rect, board: { x: number; y: number }, box: { x: number; y: number }): { x: number; y: number } {
  return { x: bounds.x + bounds.w / 2 - board.x - box.x, y: bounds.y + bounds.h / 2 - board.y - box.y };
}
