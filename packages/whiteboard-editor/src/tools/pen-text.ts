/**
 * A stylus on a touch screen pressing while an item's words are being
 * typed (presses on the words themselves go to the editor):
 * - at the edge of the item (within {@link TOUCH_PEN_SLOP}`.clickPx`): the
 *   caret moves to the nearest place in the words;
 * - beside it (see {@link PEN_BESIDE_TEXT}): typing ends and nothing stays
 *   selected;
 * - elsewhere: typing ends and the press goes on as usual.
 * A tap right after a stroke (within {@link PEN_TAP_AFTER_STROKE_MS}) is a
 * slip of the stylus and does nothing.
 */

import { elementBounds, type Box, type ElementId } from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import type { Gesture, PointerSample } from './gesture.ts';
import { TOUCH_PEN_SLOP, penStrokeEndedWithin } from './pen-input.ts';

/** How far beside the words (screen pixels) a stylus tap still ends typing quietly. */
export const PEN_BESIDE_TEXT = { left: 60, right: 420, above: 70, below: 70 } as const;
/** A stylus tap this soon after a stroke is ignored, ms. */
export const PEN_TAP_AFTER_STROKE_MS = 1500;

/** Where a stylus press lands against the box of the words being typed (screen pixels). */
export function penPressNearWords(box: Box, point: Point): 'edge' | 'beside' | 'elsewhere' {
  const slop = TOUCH_PEN_SLOP.clickPx;
  const within = (left: number, right: number, above: number, below: number): boolean =>
    point.x >= box.x - left && point.x <= box.x + box.w + right && point.y >= box.y - above && point.y <= box.y + box.h + below;
  if (within(slop, slop, slop, slop)) return 'edge';
  if (within(PEN_BESIDE_TEXT.left, PEN_BESIDE_TEXT.right, PEN_BESIDE_TEXT.above, PEN_BESIDE_TEXT.below)) return 'beside';
  return 'elsewhere';
}

/** Puts the caret of the open editor at the place nearest a client point. */
function placeCaretNear(clientX: number, clientY: number): void {
  const editor = document.querySelector<HTMLElement>('.wb-edit[role="textbox"]');
  if (!editor) return;
  // A point just inside the editor, so a press beside its words still lands in them.
  const rect = editor.getBoundingClientRect();
  const inside = (value: number, low: number, high: number): number => (value < low + 1 ? low + 1 : value > high - 1 ? high - 1 : value);
  const x = inside(clientX, rect.left, rect.right);
  const y = inside(clientY, rect.top, rect.bottom);
  const range = document.createRange();
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y);
    if (!position || !editor.contains(position.offsetNode)) return;
    range.setStart(position.offsetNode, position.offset);
  } else {
    const found = document.caretRangeFromPoint(x, y);
    if (!found || !editor.contains(found.startContainer)) return;
    range.setStart(found.startContainer, found.startOffset);
  }
  range.collapse(true);
  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * The press of a stylus while `id`'s words are typed, or `null` when the
 * press is elsewhere and goes on as usual (the caller ends typing).
 */
export function penPressWhileTyping(sample: PointerSample, id: ElementId, stopTyping: () => void): Gesture | null {
  const element = useBoard.getState().byId.get(id);
  const bounds = element ? elementBounds(element, currentMeasures()) : undefined;
  if (!bounds) return null;
  const camera = useCamera.getState().camera;
  const box = { x: (bounds.x - camera.x) * camera.zoom, y: (bounds.y - camera.y) * camera.zoom, w: bounds.w * camera.zoom, h: bounds.h * camera.zoom };
  const where = penPressNearWords(box, sample.screen);
  if (where === 'elsewhere') return null;
  if (penStrokeEndedWithin(PEN_TAP_AFTER_STROKE_MS)) return {};
  const { clientX, clientY } = sample.event;
  return {
    up() {
      if (where === 'edge') return placeCaretNear(clientX, clientY);
      stopTyping();
      useSelection.getState().clear();
    },
  };
}
