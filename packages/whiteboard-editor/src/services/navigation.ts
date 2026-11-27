/**
 * Moving the view to things on the board: fit the whole board, zoom to the
 * selection, go to an element or a section (a link to an element follows
 * it; Back returns), bring a box into view, and the board point at the
 * middle of the view (where new things go when nothing says otherwise).
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
import { sameCamera, screenToBoard, type Camera, type Point } from '../lib/camera.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { MAX_JUMP_BACK, useJump } from '../state/jump.ts';
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

/** Fits the whole board in the view (an empty board centers on the origin at 100%). Back has nowhere left to go. */
export function fitBoard(): void {
  clearJumpBack();
  fitTo(contentBounds(useBoard.getState().board.content.elements) ?? null);
}

/** The sections that have a title, in reading order (outer sections before the ones inside them). */
export function titledSections(elements: readonly BoardElement[], measures: ElementMeasures = currentMeasures()): ContainerElement[] {
  return orderElementsForReading(
    elements.filter((element) => element.type === 'container' && element.text.trim() !== ''),
    measures,
  ) as ContainerElement[];
}

/** How long the ring around the element the view went to shows, ms. */
export const JUMP_FLASH_MS = 1400;

/** Told when a link points at an element that is no longer on the board. */
export const MISSING_LINK_TARGET_MESSAGE = "That item isn't on this board anymore";

let flashTimer: ReturnType<typeof setTimeout> | undefined;
let flashSerial = 0;

/** Rings `id` briefly (see `state/jump.ts`). */
function flashElement(id: ElementId): void {
  clearTimeout(flashTimer);
  flashSerial += 1;
  useJump.setState({ flash: { id, serial: flashSerial } });
  flashTimer = setTimeout(() => useJump.setState({ flash: null }), JUMP_FLASH_MS);
}

/** Remembers `camera` for Back (the same view twice in a row once). */
function pushJumpBack(camera: Camera): void {
  const back = useJump.getState().back;
  const last = back.at(-1);
  if (last !== undefined && sameCamera(last, camera)) return;
  useJump.setState({ back: [...back, camera].slice(-MAX_JUMP_BACK) });
}

/**
 * Takes the view to an element of the board: fitted with its title (never
 * past 100%), gliding unless `glide` is false, then rings it briefly. The
 * view it leaves is remembered for Back unless `back` is false. The
 * selection stays as it is. Returns `false` when the element is not on
 * the board.
 */
export function goToElement(id: ElementId, options: { glide?: boolean; back?: boolean } = {}): boolean {
  const element = useBoard.getState().byId.get(id);
  const bounds = element ? contentBounds([element]) : undefined;
  if (!bounds) return false;
  if (options.back !== false) pushJumpBack(useCamera.getState().camera);
  fitTo(bounds, { glide: options.glide !== false });
  flashElement(id);
  return true;
}

/** Glides the view to a section, its title included (see {@link goToElement}). */
export function goToSection(id: ElementId): void {
  if (useBoard.getState().byId.get(id)?.type === 'container') goToElement(id);
}

/** Glides back to the view the viewer last went to an element from. Returns whether there was one. */
export function jumpBack(): boolean {
  const back = useJump.getState().back;
  const camera = back.at(-1);
  if (camera === undefined) return false;
  useJump.setState({ back: back.slice(0, -1) });
  glideCamera(camera);
  return true;
}

/** Forgets the views Back would return to. */
export function clearJumpBack(): void {
  if (useJump.getState().back.length > 0) useJump.setState({ back: [] });
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
