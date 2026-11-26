/**
 * Two fingers tapped on the board undo the last change; three redo it
 * (see `tools/touch.ts` {@link fingerUp}). The fingers' brief pinch is
 * taken back, the long-press menu they may raise is swallowed, and a
 * notice says what happened when the history actually moved.
 */

import { useTool } from '../state/tool.ts';
import { useSelection } from '../state/selection.ts';
import { useHistory } from '../state/history.ts';
import { useCamera } from '../state/camera.ts';
import type { Camera } from '../lib/camera.ts';
import { useInteraction } from '../selection/store.ts';
import { fingerDown, fingerMoved, fingerUp, type FingerTaps } from '../tools/touch.ts';
import { showGestureNotice } from '../ui/GestureNotice.tsx';
import { canEditBoard } from './actions.ts';
import { redo, undo } from './commands.ts';
import { useVersionHistory } from './version-history.ts';
import { setCamera } from './viewport.ts';

/** A tap this soon after leaving a crop is the end of the crop, not an undo, ms. */
const AFTER_CROP_MS = 500;
/** How long after the tap a long-press menu is swallowed, ms. */
const SWALLOW_MENU_MS = 1000;

/** Whether the board takes a multi-finger tap now. */
function takesFingerTaps(cropEndedAt: number, now: number): boolean {
  const selection = useSelection.getState();
  return (
    canEditBoard() &&
    !useTool.getState().commentMode &&
    useVersionHistory.getState().previewing === null &&
    selection.editing === null &&
    selection.cropping === null &&
    now - cropEndedAt > AFTER_CROP_MS &&
    useInteraction.getState().transform === null
  );
}

/** Listens for multi-finger taps on `surface`; returns a function that stops. */
export function installFingerTaps(surface: HTMLElement): () => void {
  let taps: FingerTaps | null = null;
  let camera: Camera | null = null;
  let swallowMenuUntil = Number.NEGATIVE_INFINITY;
  let cropEndedAt = Number.NEGATIVE_INFINITY;
  const stopCropWatch = useSelection.subscribe((state, previous) => {
    if (previous.cropping !== null && state.cropping === null) cropEndedAt = performance.now();
  });

  const onBoard = (target: EventTarget | null): boolean =>
    target instanceof Element && surface.contains(target) && target.closest('[data-wb-chrome],[data-no-pan]') === null;

  const onDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    if (taps === null) {
      if (!onBoard(event.target)) return;
      camera = useCamera.getState().camera;
    }
    taps = fingerDown(taps, event.pointerId, { x: event.clientX, y: event.clientY }, event.timeStamp);
  };
  const onMove = (event: PointerEvent): void => {
    if (taps !== null && event.pointerType === 'touch') fingerMoved(taps, event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onEnd = (event: PointerEvent): void => {
    if (taps === null || event.pointerType !== 'touch') return;
    const outcome = fingerUp(taps, event.pointerId, event.timeStamp, event.type === 'pointercancel');
    if (outcome === null) return;
    const start = camera;
    taps = null;
    camera = null;
    if (outcome === 'none' || !takesFingerTaps(cropEndedAt, performance.now())) return;
    if (start) setCamera(start);
    swallowMenuUntil = performance.now() + SWALLOW_MENU_MS;
    const before = useHistory.getState().redoDepth;
    if (outcome === 'undo') undo();
    else redo();
    const after = useHistory.getState().redoDepth;
    if (outcome === 'undo' && after > before) showGestureNotice('Last change undone');
    else if (outcome === 'redo' && after < before) showGestureNotice('Last change redone');
  };
  const onContextMenu = (event: MouseEvent): void => {
    if (performance.now() > swallowMenuUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove, { capture: true });
  window.addEventListener('pointerup', onEnd, { capture: true });
  window.addEventListener('pointercancel', onEnd, { capture: true });
  window.addEventListener('contextmenu', onContextMenu, { capture: true });
  return () => {
    stopCropWatch();
    window.removeEventListener('pointerdown', onDown, { capture: true });
    window.removeEventListener('pointermove', onMove, { capture: true });
    window.removeEventListener('pointerup', onEnd, { capture: true });
    window.removeEventListener('pointercancel', onEnd, { capture: true });
    window.removeEventListener('contextmenu', onContextMenu, { capture: true });
  };
}
