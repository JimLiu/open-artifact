/**
 * Picking a picture from a panel on a touch screen. The system file picker
 * covers the page there, so the panel that opened it stays open until the
 * person has chosen a file or turned the picker away; only then does it
 * close and put its tool down. With a mouse the panel closes at once.
 *
 * On iOS-like systems a tap outside the picker dismisses it and also lands
 * on the page: such taps (at most {@link MAX_KEPT_TAPS}) are kept from the
 * page with everything that follows them until the finger lifts.
 *
 * Pure DOM: unit-tested with plain event targets.
 */

/** How many taps that dismiss the picker are kept from the page. */
export const MAX_KEPT_TAPS = 2;
/** How long after the last finger lifts its mouse events are still kept from the page, ms. */
export const KEPT_TAP_TAIL_MS = 400;
/** The events a kept tap brings along. */
export const KEPT_TAP_EVENTS = [
  'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'gesturestart', 'gesturechange', 'gestureend',
] as const;

/** Schedules `run` after `ms` (tests pass their own). */
export type Later = (run: () => void, ms: number) => void;

const defaultLater: Later = (run, ms) => void setTimeout(run, ms);

/** The pointer id of a pointer event (`undefined` for others). */
function pointerIdOf(event: Event): number | undefined {
  return 'pointerId' in event && typeof event.pointerId === 'number' ? event.pointerId : undefined;
}

/** Whether a pointer event is the primary pointer. */
function isPrimaryPointer(event: Event): boolean {
  return 'isPrimary' in event && event.isPrimary === true;
}

/**
 * Keeps the rest of a press (`pointerId`) from the page: its moves, its
 * lift and the mouse events and click it turns into, until every finger
 * that joined it is up and {@link KEPT_TAP_TAIL_MS} has passed. A key press
 * or a new primary pointer gives the page its events back at once.
 */
export function keepPressFromPage(host: EventTarget, pointerId: number, later: Later = defaultLater): void {
  const fingers = new Set([pointerId]);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const type of KEPT_TAP_EVENTS) host.removeEventListener(type, keep, true);
    host.removeEventListener('pointerdown', join, true);
    host.removeEventListener('keydown', release, true);
  };
  function keep(event: Event): void {
    const id = pointerIdOf(event);
    if (id !== undefined) {
      if (!fingers.has(id)) return;
      event.stopImmediatePropagation();
      if (event.type !== 'pointermove' && fingers.delete(id) && fingers.size === 0) later(release, KEPT_TAP_TAIL_MS);
      return;
    }
    // A click with no press behind it (from the keyboard or a script) is not part of the tap.
    if (event.type === 'click' && 'detail' in event && event.detail === 0) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  }
  function join(event: Event): void {
    const id = pointerIdOf(event);
    if (isPrimaryPointer(event) || fingers.size === 0 || id === undefined) return release();
    fingers.add(id);
    event.stopImmediatePropagation();
  }
  for (const type of KEPT_TAP_EVENTS) host.addEventListener(type, keep, true);
  host.addEventListener('pointerdown', join, true);
  host.addEventListener('keydown', release, true);
}

/** What {@link waitForFileChoice} needs. */
export interface FileChoiceWait {
  /** The file input whose picker is open (it fires `cancel` when turned away). */
  input: EventTarget;
  /** The window. */
  host: EventTarget;
  /** True for a press inside the panel that opened the picker. */
  inPanel(target: EventTarget | null): boolean;
  /** A tap outside the picker dismisses it and reaches the page (iOS-like). */
  tapsDismiss: boolean;
  /** Closes the panel and puts its tool down. */
  close(): void;
  /** The wait is over: the panel stays as it is. */
  over(): void;
  later?: Later;
}

/**
 * Waits for the file picker to be dismissed. The picker turned away
 * (`cancel`) ends the wait, closing the panel if a tap outside it was what
 * dismissed it; so do a key press and, where taps do not dismiss the
 * picker, the window getting focus back or any press. Returns a function
 * that stops waiting without calling either callback (a file was chosen,
 * or the panel went away).
 */
export function waitForFileChoice(wait: FileChoiceWait): () => void {
  const { input, host, tapsDismiss } = wait;
  let taps = 0;
  let outside = false;
  let waiting = true;
  const stop = (): void => {
    if (!waiting) return;
    waiting = false;
    input.removeEventListener('cancel', onCancel);
    host.removeEventListener('pointerdown', onPress, true);
    host.removeEventListener('keydown', onKey, true);
    host.removeEventListener('focus', onFocus);
  };
  const end = (): void => {
    stop();
    wait.over();
  };
  function onCancel(): void {
    const close = outside;
    stop();
    if (close) wait.close();
    else wait.over();
  }
  function onKey(): void {
    end();
  }
  function onFocus(): void {
    if (!tapsDismiss) end();
  }
  function onPress(event: Event): void {
    if (taps > 0 && !isPrimaryPointer(event)) return;
    const id = pointerIdOf(event);
    if (!tapsDismiss || taps === MAX_KEPT_TAPS || id === undefined) return end();
    taps += 1;
    outside = !wait.inPanel(event.target);
    event.stopImmediatePropagation();
    keepPressFromPage(host, id, wait.later);
  }
  input.addEventListener('cancel', onCancel);
  host.addEventListener('pointerdown', onPress, true);
  host.addEventListener('keydown', onKey, true);
  host.addEventListener('focus', onFocus);
  return stop;
}
