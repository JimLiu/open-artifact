/**
 * Moving the view to things on the board: fit the whole board, zoom to the
 * selection, go to a section, bring a box into view, and the board point at
 * the middle of the view (where new things go when nothing says otherwise).
 */

import {
  centerCameraOn,
  elementBoundsWithTitle,
  elementsBounds,
  fitsInViewport,
  orderElementsForReading,
  panCameraToReveal,
  rotatableSelection,
  unionBounds,
  type Box,
  type BoardElement,
  type ContainerElement,
  type ElementId,
  type ElementMeasures,
} from '@open-artifact/whiteboard-core';
import { screenToBoard, type Point } from '../lib/camera.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { fitTo, glideCamera, setCamera } from './viewport.ts';
import { useLastInput } from '../tools/pen-input.ts';

/** Most a selection is zoomed to (a small sticker should not fill the screen). */
const SELECTION_MAX_ZOOM = 2;

/** The bounds of elements as drawn, section titles included. */
export function contentBounds(elements: readonly BoardElement[], measures: ElementMeasures = currentMeasures()): Box | undefined {
  const titles = elements.filter((element) => element.type === 'container').map((element) => elementBoundsWithTitle(element, measures, true));
  return unionBounds([elementsBounds(elements, measures), ...titles].filter((box): box is Box => box !== undefined));
}

/** Fits the whole board in the view (an empty board centers on the origin at 100%). */
export function fitBoard(): void {
  fitTo(contentBounds(useBoard.getState().board.content.elements) ?? null);
}

/** The sections that have a title, in reading order (outer sections before the ones inside them). */
export function titledSections(elements: readonly BoardElement[], measures: ElementMeasures = currentMeasures()): ContainerElement[] {
  return orderElementsForReading(
    elements.filter((element) => element.type === 'container' && element.text.trim() !== ''),
    measures,
  ) as ContainerElement[];
}

/** Glides the view to a section, its title included (fitted, never past 100%). The selection stays as it is. */
export function goToSection(id: ElementId): void {
  const section = useBoard.getState().board.content.elements.find((element) => element.id === id && element.type === 'container');
  const bounds = section ? contentBounds([section]) : undefined;
  if (bounds) fitTo(bounds, { glide: true });
}

/** Room kept below a selection for the turn knob (a finger or stylus turns from it), screen pixels. */
const TURN_KNOB_ROOM_PX = 58 + 22;

/** Zooms to the selected elements (leaving room for the turn knob when it shows). */
export function fitSelection(): void {
  const ids = new Set(useSelection.getState().ids);
  if (ids.size === 0) return;
  const elements = useBoard.getState().board.content.elements;
  const selected = elements.filter((element) => ids.has(element.id));
  const bounds = contentBounds(selected);
  const knob = useLastInput.getState().kind !== 'mouse' && rotatableSelection(elements, ids).items.length > 0;
  if (bounds) fitTo(bounds, { maxZoom: SELECTION_MAX_ZOOM, ...(knob ? { bottomRoom: TURN_KNOB_ROOM_PX } : {}) });
}

/** The view's size and the chrome insets, in the shape the core geometry takes. */
function viewGeometry() {
  const state = useCamera.getState();
  return { camera: state.camera, viewport: { w: state.width, h: state.height }, insets: { top: state.insets.top, bottom: state.insets.bottom } };
}

/**
 * Brings a board box into view: the least pan that shows it when it fits at
 * this zoom, else centered on it.
 */
export function revealBox(box: Box): void {
  const { camera, viewport, insets } = viewGeometry();
  setCamera(fitsInViewport(camera, box, viewport, insets) ? panCameraToReveal(camera, box, viewport, insets) : centerCameraOn(camera, box, viewport, insets));
}

/** Glides the view just far enough to show a board box (no centring, no zoom). */
export function glideToReveal(box: Box): void {
  const { camera, viewport, insets } = viewGeometry();
  glideCamera(panCameraToReveal(camera, box, viewport, insets));
}

/** Brings elements into view. */
export function revealElements(elements: readonly BoardElement[]): void {
  const bounds = contentBounds(elements);
  if (bounds) revealBox(bounds);
}

/** The board point at the middle of the view (between the chrome insets). */
export function viewCenter(): Point {
  const state = useCamera.getState();
  return screenToBoard(state.camera, {
    x: state.insets.left + (state.width - state.insets.left - state.insets.right) / 2,
    y: state.insets.top + (state.height - state.insets.top - state.insets.bottom) / 2,
  });
}
