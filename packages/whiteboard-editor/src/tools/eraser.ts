/**
 * A stylus's eraser end (or its eraser button) sweeps away pen strokes:
 * every unlocked stroke it passes within {@link ERASER_REACH_PX} of
 * disappears from view while the eraser is down, and all of them go in
 * one Delete step when it lifts. It does nothing on a read-only board, in
 * comment mode or while an image is being cropped.
 */

import { hitTestElement, isElementLocked, removeElements, type BoardElement, type ElementId, type StrokeElement } from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';
import { announce, deletedMessage } from '../services/announce.ts';
import { boardElements, canEditBoard, editContent } from '../services/actions.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { setErasingElements } from '../elements/view-state.ts';
import type { Gesture, PointerSample } from './gesture.ts';

/** How far from the eraser a stroke is swept, screen pixels. */
export const ERASER_REACH_PX = 10;

/**
 * The strokes in `strokes` that a sweep from `from` to `to` passes within
 * `reach` of (board units), skipping those already in `taken`. The sweep
 * is checked every half reach, so a fast stroke of the eraser skips none.
 */
export function strokesSwept(strokes: readonly StrokeElement[], from: Point, to: Point, reach: number, taken: ReadonlySet<ElementId>): ElementId[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = length > 0 ? Math.ceil((2 * length) / reach) : 1;
  const swept: ElementId[] = [];
  for (const stroke of strokes) {
    if (taken.has(stroke.id)) continue;
    for (let step = 0; step <= steps; step++) {
      const x = from.x + ((to.x - from.x) * step) / steps;
      const y = from.y + ((to.y - from.y) * step) / steps;
      if (hitTestElement(stroke, x, y, reach)) {
        swept.push(stroke.id);
        break;
      }
    }
  }
  return swept;
}

/** The eraser's press, or `null` when the board can't be erased now. */
export function eraserPress(sample: PointerSample): Gesture | null {
  if (!canEditBoard() || useTool.getState().commentMode || useSelection.getState().cropping !== null) return null;
  const strokes = boardElements().filter((element): element is StrokeElement => element.type === 'stroke' && !isElementLocked(element));
  const erasing = new Set<ElementId>();
  let last = sample.board;
  const sweep = (to: Point): void => {
    const reach = ERASER_REACH_PX / useCamera.getState().camera.zoom;
    const swept = strokesSwept(strokes, last, to, reach, erasing);
    last = to;
    if (swept.length === 0) return;
    for (const id of swept) erasing.add(id);
    setErasingElements(new Set(erasing));
  };
  sweep(sample.board);
  return {
    cursor: 'cell',
    move(next) {
      sweep(next.board);
    },
    up() {
      setErasingElements(null);
      if (erasing.size === 0) return;
      const gone: BoardElement[] = useBoard.getState().board.content.elements.filter((element) => erasing.has(element.id));
      if (!editContent((content) => removeElements(content, erasing), { label: 'Delete' })) return;
      const selection = useSelection.getState().ids;
      if (selection.some((id) => erasing.has(id))) useSelection.getState().select(selection.filter((id) => !erasing.has(id)));
      announce(deletedMessage(gone));
    },
    cancel() {
      setErasingElements(null);
    },
  };
}
