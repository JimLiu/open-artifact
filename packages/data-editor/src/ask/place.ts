/** Where the selection pill goes (pure). */

import type { Box } from '../edit/geometry.ts';

export const ASK_PILL_GAP = 8;
export const ASK_PILL_MARGIN = 12;
/** A text selection whose first line moves further than this is taken as a new selection. */
export const MAX_SELECTION_VERTICAL_MOVEMENT = 100;
export const SELECTION_UPDATE_DELAY_MS = 250;
export const ASK_PILL_SELECTOR = '.dash-ask-pill';

export interface PillWords {
  text: string;
  /** Where the selection's first line was when the pill first showed for it. */
  top: number;
}

export interface PillGeometry {
  anchor: { left: number; top: number; width: number };
  /** Where the pill's top goes when it sits below. */
  under: number;
  room: Box;
  /** The selected text, or null for a picked piece. */
  words: PillWords | null;
}

export interface PillPlace {
  left: number;
  top: number;
  placed: 'above' | 'below';
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Above the anchor when it fits (a picked piece prefers below), centred on it, kept inside the room. Given `side`
 * (where the pill was for the same selection), it stays there while it fits.
 */
export function positionSelectionPill({ anchor, under, room, words }: PillGeometry, width: number, height: number, side?: 'above' | 'below'): PillPlace {
  const above = anchor.top - height - ASK_PILL_GAP;
  const fitsAbove = above >= room.top + ASK_PILL_MARGIN;
  const fitsBelow = under + height + ASK_PILL_MARGIN <= room.top + room.height;
  const prefersBelow = side === undefined ? words === null : side === 'below';
  const below = prefersBelow ? fitsBelow || !fitsAbove : !fitsAbove;
  const half = ASK_PILL_MARGIN + width / 2;
  const centre = clamp(anchor.left + anchor.width / 2, room.left + half, room.left + room.width - half);
  const top = clamp(below ? under : above, room.top + ASK_PILL_MARGIN, room.top + room.height - height - ASK_PILL_MARGIN);
  return { left: centre - width / 2, top, placed: below ? 'below' : 'above' };
}

/** The selection's first line, kept where it was when it moved only a little (so the pill doesn't jump as the selection grows). */
export function settleWordsTop(previous: PillWords | null, next: PillWords): PillWords | null {
  const top = previous !== null && previous.text === next.text ? previous.top : next.top;
  return Math.abs(next.top - top) <= MAX_SELECTION_VERTICAL_MOVEMENT ? { ...next, top } : null;
}
