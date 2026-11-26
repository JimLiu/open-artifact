/**
 * Palm rejection on a touch screen with a stylus: a hand resting on the
 * screen while writing must not pan, select or zoom. The rules are in
 * `tools/touch.ts` ({@link isPalmTouch}); this wires them to the page.
 *
 * A palm's pointer events are stopped in the window's capture phase, before
 * the board sees them, and the `touchstart` of the same contact is
 * cancelled so the browser does not scroll or zoom with it. Touches on the
 * page's chrome (toolbars, menus, panels) are never palms. A stylus going
 * down cancels what fingers are doing on the board.
 */

import type { Point } from '../lib/camera.ts';
import { isTouchScreenPen, noteInput } from '../tools/pen-input.ts';
import { isPalmTouch, newPalmWatch, swallowsTouchMove } from '../tools/touch.ts';

/** A dropped palm's `touchstart` is matched within this many pixels of its pointer. */
const TOUCHSTART_MATCH_PX = 4;

const watch = newPalmWatch();
const palms = new Set<number>();

/** True while a stylus or a palm is on the screen (two fingers do not zoom then). */
export function penOrPalmDown(): boolean {
  return watch.pensDown > 0 || palms.size > 0;
}

/** True when a pointer or touch target is on the board itself, not on its chrome or off it. */
function onBoard(surface: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Element && surface.contains(target) && target.closest('[data-wb-chrome],[data-no-pan]') === null;
}

/**
 * Starts palm rejection for the board surface. `cancelFingers` stops what
 * fingers are doing on the board (a stylus went down). Returns a function
 * that stops.
 */
export function installPalmRejection(surface: HTMLElement, cancelFingers: () => void): () => void {
  const pens = new Set<number>();
  /** Where dropped palms went down, for their `touchstart`. */
  let dropped: Point[] = [];
  /** Where each touch started and whether that was on the board. */
  const touches = new Map<number, { start: Point; board: boolean }>();

  const stop = (event: Event): void => {
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  };
  const onDown = (event: PointerEvent): void => {
    noteInput(event);
    if (isTouchScreenPen(event)) {
      pens.add(event.pointerId);
      watch.pensDown = pens.size;
      watch.penSeen = true;
      cancelFingers();
      return;
    }
    if (event.pointerType !== 'touch' || !onBoard(surface, event.target)) return;
    if (!isPalmTouch(watch, { width: event.width, height: event.height }, event.timeStamp)) return;
    palms.add(event.pointerId);
    watch.palmAt = event.timeStamp;
    dropped = [...dropped.slice(-4), { x: event.clientX, y: event.clientY }];
    stop(event);
  };
  const onMove = (event: PointerEvent): void => {
    if (palms.has(event.pointerId)) stop(event);
  };
  const onEnd = (event: PointerEvent): void => {
    if (pens.delete(event.pointerId)) {
      watch.pensDown = pens.size;
      watch.penUpAt = event.timeStamp;
      return;
    }
    if (!palms.delete(event.pointerId)) return;
    watch.palmAt = event.timeStamp;
    stop(event);
  };
  const onTouchStart = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      touches.set(touch.identifier, { start: { x: touch.clientX, y: touch.clientY }, board: onBoard(surface, touch.target) });
      const index = dropped.findIndex((at) => Math.hypot(at.x - touch.clientX, at.y - touch.clientY) <= TOUCHSTART_MATCH_PX);
      if (index < 0) continue;
      dropped.splice(index, 1);
      if (event.cancelable) event.preventDefault();
    }
  };
  const onTouchMove = (event: TouchEvent): void => {
    if (!event.cancelable) return;
    for (const touch of Array.from(event.changedTouches)) {
      const known = touches.get(touch.identifier);
      if (known && swallowsTouchMove(penOrPalmDown(), known.board, known.start, { x: touch.clientX, y: touch.clientY })) {
        event.preventDefault();
        return;
      }
    }
  };
  const onTouchEnd = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) touches.delete(touch.identifier);
  };
  const capture = { capture: true } as const;
  const active = { capture: true, passive: false } as const;
  window.addEventListener('pointerdown', onDown, capture);
  window.addEventListener('pointermove', onMove, capture);
  window.addEventListener('pointerup', onEnd, capture);
  window.addEventListener('pointercancel', onEnd, capture);
  window.addEventListener('touchstart', onTouchStart, active);
  window.addEventListener('touchmove', onTouchMove, active);
  window.addEventListener('touchend', onTouchEnd, capture);
  window.addEventListener('touchcancel', onTouchEnd, capture);
  return () => {
    window.removeEventListener('pointerdown', onDown, capture);
    window.removeEventListener('pointermove', onMove, capture);
    window.removeEventListener('pointerup', onEnd, capture);
    window.removeEventListener('pointercancel', onEnd, capture);
    window.removeEventListener('touchstart', onTouchStart, capture);
    window.removeEventListener('touchmove', onTouchMove, capture);
    window.removeEventListener('touchend', onTouchEnd, capture);
    window.removeEventListener('touchcancel', onTouchEnd, capture);
    pens.clear();
    palms.clear();
    watch.pensDown = 0;
  };
}
