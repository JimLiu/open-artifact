/**
 * The Library tool: a click places the shape picked in the Library panel,
 * centered on the pointer, as an unframed picture with an empty label
 * under it that shows the shape's name (both in one new group). Without a
 * picked shape (the panel is open) the tool acts like Select.
 *
 * {@link placeShapeFromLibrary} is also what Enter with the tool uses.
 */

import { placeLibraryShape, type LibraryShape } from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';
import { announce } from '../services/announce.ts';
import { addElements } from '../services/actions.ts';
import { useTool } from '../state/tool.ts';
import type { Gesture, PointerSample } from './gesture.ts';
import { ensureRoom } from './place.ts';
import { forgetTap, selectPress } from './select.ts';

/** Places a library shape centered on `center` and selects it; `false` when the board is read-only or full. */
export function placeShapeFromLibrary(shape: LibraryShape, center: Point): boolean {
  if (!ensureRoom(2)) return false;
  const { image, label } = placeLibraryShape(shape, center);
  if (!addElements([image, label], `Add ${shape.name}`)) return false;
  announce(`${shape.name} added`);
  useTool.getState().placed();
  return true;
}

/** The Library tool's press. */
export function libraryPress(sample: PointerSample): Gesture | null {
  const shape = useTool.getState().libraryShape;
  if (shape === undefined) return selectPress(sample);
  forgetTap();
  if (!ensureRoom(2)) return null;
  return {
    cursor: 'copy',
    up(end) {
      placeShapeFromLibrary(shape, end.board);
    },
  };
}
