/** The geometry of edit mode's layer: marks, washes, the card grip and tips (pure: plain boxes). */

import { rectOf, type Box, type Rect } from './geometry.ts';

export type EditMarkLook = 'over' | 'picked' | 'caret';
export type TipSide = 'top' | 'bottom';

/** A box in a layer's coordinates, used as an element's style. */
export type LayerBox = { left: number; top: number; width: number; height: number };

export const EDIT_REFUSAL_MS = 4000;
export const EDIT_TIP_DELAY = 100;
export const EDIT_TIP_SIZE = { width: 240, height: 84, least: 28 } as const;
/** How far around the pointer a tip that follows it keeps clear. */
export const TIP_NEAR_PAD = 12;
export const EDIT_PORT_SLACK = 8;
export const EDIT_MARK_INFLATE: Readonly<Record<EditMarkLook, number>> = { over: 0, picked: 2, caret: 1.5 };

export const CARD_GRIP_CLASS = 'dash-edit-grip';
export const IBEAM_ATTRIBUTE = 'data-dash-ibeam';
export const KEPT_ATTRIBUTE = 'data-dash-kept';
export const WORDS_ATTRIBUTE = 'data-dash-words';
export const STICKY_ATTRIBUTE = 'data-dash-sticky';
export const STACKING_CONTEXT_PROPERTIES = ['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter', 'backdropFilter', 'clipPath', 'maskImage'] as const;

/** How far a mark sits outside its piece: none for a card, 5px for a drawing, 3–4px for text. */
export function editMarkInset(kind: 'words' | 'drawing' | 'block', text: boolean, look: EditMarkLook): number {
  if (kind === 'block') return 0;
  if (!text) return 5;
  return look === 'picked' ? 3 : 4;
}

export const toLayerBox = (box: Box, room: Pick<Box, 'left' | 'top'>): LayerBox => ({
  left: box.left - room.left,
  top: box.top - room.top,
  width: box.width,
  height: box.height,
});

/** A row that shows in the room (8px of it at least). */
export const isRowInRoom = (box: { top: number; bottom: number }, room: Box): boolean => box.bottom >= room.top + 8 && box.top <= room.top + room.height - 8;

/** The part of `rect` inside `bounds`, or null when none is. */
export function clipRectToBounds(rect: Rect, bounds: Box): Box | null {
  const left = Math.max(rect.left, bounds.left);
  const top = Math.max(rect.top, bounds.top);
  const width = Math.min(rect.right, bounds.left + bounds.width) - left;
  const height = Math.min(rect.bottom, bounds.top + bounds.height) - top;
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

/** A clip path for the whole room with a hole where the lifted card's copy is. */
export function cutOutClipPath(hole: Box | undefined, room: Box): string | undefined {
  if (hole === undefined) return undefined;
  const left = hole.left - room.left;
  const top = hole.top - room.top;
  return `path(evenodd, "M0 0H${room.width}V${room.height}H0Z M${left} ${top}h${hole.width}v${hole.height}h${-hole.width}Z")`;
}

/** Above the element unless it is near the room's top; the other side when the bottom strip is in the way; null when both are. */
export function pickTipSide(box: Rect, room: Box, strip: Rect | null): TipSide | null {
  const side: TipSide = box.top < room.top + 48 ? 'bottom' : 'top';
  if (strip === null) return side;
  const apart = Math.abs(box.left + box.right - strip.left - strip.right) / 2;
  const blocked = (at: TipSide): boolean => {
    const top = at === 'top' ? box.top - EDIT_TIP_SIZE.height : box.bottom;
    return (
      (at === 'bottom' && top + EDIT_TIP_SIZE.height > room.top + room.height) ||
      (top < strip.bottom && top + EDIT_TIP_SIZE.height > strip.top && apart < (EDIT_TIP_SIZE.width + strip.width) / 2)
    );
  };
  const other: TipSide = side === 'top' ? 'bottom' : 'top';
  return !blocked(side) ? side : !blocked(other) ? other : null;
}

/** Where a tip goes: against the box, or against the pointer when no side of the box has room for it. */
export interface EditTipPlace {
  anchor: Rect;
  side: TipSide | null;
  /** The tip follows the pointer (and can't be hovered into). */
  follow: boolean;
}

/**
 * Places a tip for `box`. A tip that would be forced above a box near the room's top, or that has no side of the box
 * left, goes by the pointer instead: around a {@link TIP_NEAR_PAD} box at `pointer`, on a side picked inside the part
 * of the box in the room. With no pointer, or no side by the pointer either, the box's own pick stands.
 */
export function placeEditTip(box: Rect, room: Box, strip: Rect | null, pointer: { x: number; y: number } | null): EditTipPlace {
  const side = pickTipSide(box, room, strip);
  const stick =
    side === 'top' && box.top < room.top + 48 ? box.bottom + EDIT_TIP_SIZE.least > room.top + room.height : side !== null;
  const own: EditTipPlace = { anchor: box, side, follow: false };
  if (stick || pointer === null) return own;
  const near = rectOf({ left: pointer.x - TIP_NEAR_PAD, top: pointer.y - TIP_NEAR_PAD, width: 2 * TIP_NEAR_PAD, height: 2 * TIP_NEAR_PAD });
  const nearSide = pickTipSide(near, clipRectToBounds(box, room) ?? room, strip);
  return nearSide === null ? own : { anchor: near, side: nearSide, follow: true };
}

/** An inline run's client rects merged into one per line (rects whose middle falls in the last line join it). */
export function mergeLineRects(rects: readonly Rect[]): Rect[] {
  const lines: Rect[] = [];
  for (const rect of rects) {
    if (rect.width === 0) continue;
    const last = lines.at(-1);
    if (last === undefined || (rect.top + rect.bottom) / 2 > last.bottom) {
      lines.push(rect);
      continue;
    }
    const left = Math.min(last.left, rect.left);
    const top = Math.min(last.top, rect.top);
    const right = Math.max(last.right, rect.right);
    const bottom = Math.max(last.bottom, rect.bottom);
    lines[lines.length - 1] = { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  return lines;
}

/** The washes of a run that wraps: each line widened by `inset`, the first raised and the last lowered by it. */
export function insetLineRects(lines: readonly Rect[], inset: number): Box[] {
  return lines.map((rect, index) => ({
    left: rect.left - inset,
    top: rect.top - (index === 0 ? inset : 0),
    width: rect.width + 2 * inset,
    height: rect.height + (index === 0 ? inset : 0) + (index === lines.length - 1 ? inset : 0),
  }));
}

/** Where a card's grip sits in the layer: on its left edge, 14px down (kept in view when the card's top scrolled off). */
export function cardGripAt(card: Rect, room: Box): { left: number; top: number } {
  const drop = Math.max(14, Math.min(card.height - 38, room.top - card.top + 10));
  return { left: card.left - room.left - 7, top: card.top - room.top + drop };
}
