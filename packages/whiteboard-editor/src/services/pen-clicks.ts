/**
 * Stylus taps on the page's controls (buttons, menus, tabs, links), on a
 * touch screen. Such taps don't reliably become clicks, so a short, still
 * tap the browser has not clicked within {@link PEN_CLICK}`.delayMs` is
 * replayed as a mouse click (a second tap on the same control within
 * `doubleMs` also gets a `dblclick`), and the browser's own click that may
 * still follow within `ghostMs` is swallowed so the control is not
 * pressed twice.
 */

import { TOUCH_PEN_SLOP, isTouchScreenPen } from '../tools/pen-input.ts';

/** Timings of replayed stylus clicks, ms. */
export const PEN_CLICK = { delayMs: 60, doubleMs: 350, ghostMs: 700 } as const;

/** What counts as a control a stylus tap clicks. */
const CONTROL =
  'button,a[href],summary,label,select,input[type="checkbox"],input[type="radio"],input[type="button"],input[type="submit"],[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"]';

/** The control a stylus pressed, if any (the board itself is not one). */
export function penControlAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest<HTMLElement>(CONTROL);
  return control && !control.matches(':disabled,[aria-disabled="true"]') ? control : null;
}

/** A stylus tap on a control, from going down until its click. */
interface PenTap {
  id: number;
  control: HTMLElement;
  x: number;
  y: number;
  /** The browser sent its own mouse press for it. */
  mouse: boolean;
  /** The browser clicked it itself (nothing to replay). */
  clicked: boolean;
}

/** Starts replaying stylus taps on controls as clicks; returns a function that stops. */
export function installPenClicks(): () => void {
  let tap: PenTap | null = null;
  let lastReplay: { control: HTMLElement; at: number } | null = null;
  let ghost: { control: HTMLElement; until: number } | null = null;
  let replaying = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const fire = (control: HTMLElement, type: string, x: number, y: number, detail: number): void => {
    control.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, detail, button: 0, buttons: type === 'mousedown' ? 1 : 0, view: window }),
    );
  };
  const replay = (pressed: PenTap, x: number, y: number): void => {
    const now = performance.now();
    const second = lastReplay !== null && lastReplay.control === pressed.control && now - lastReplay.at <= PEN_CLICK.doubleMs;
    lastReplay = second ? null : { control: pressed.control, at: now };
    ghost = { control: pressed.control, until: now + PEN_CLICK.ghostMs };
    const detail = second ? 2 : 1;
    replaying = true;
    try {
      if (!pressed.mouse) fire(pressed.control, 'mousedown', x, y, detail);
      if (!pressed.mouse) fire(pressed.control, 'mouseup', x, y, detail);
      pressed.control.click();
      if (second) fire(pressed.control, 'dblclick', x, y, 2);
    } finally {
      replaying = false;
    }
  };

  const onDown = (event: PointerEvent): void => {
    tap = null;
    if (!isTouchScreenPen(event) || event.button !== 0) return;
    const control = penControlAt(event.target);
    if (control) tap = { id: event.pointerId, control, x: event.clientX, y: event.clientY, mouse: false, clicked: false };
  };
  const onMouseDown = (event: MouseEvent): void => {
    if (tap && event.isTrusted) tap.mouse = true;
  };
  const onUp = (event: PointerEvent): void => {
    const pressed = tap;
    if (!pressed || pressed.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > TOUCH_PEN_SLOP.tapPx) {
      tap = null;
      return;
    }
    const { clientX: x, clientY: y } = event;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (tap === pressed) tap = null;
      if (!pressed.clicked && pressed.control.isConnected) replay(pressed, x, y);
    }, PEN_CLICK.delayMs);
    timers.add(timer);
  };
  const onClick = (event: MouseEvent): void => {
    if (replaying || !event.isTrusted || !(event.target instanceof Node)) return;
    // The browser clicked the tap itself before the replay: let it through.
    if (tap && tap.control.contains(event.target)) {
      tap.clicked = true;
      return;
    }
    // A late click after a replay.
    if (ghost && performance.now() <= ghost.until && ghost.control.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onCancel = (event: PointerEvent): void => {
    if (tap?.id === event.pointerId) tap = null;
  };

  window.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('mousedown', onMouseDown, { capture: true });
  window.addEventListener('pointerup', onUp, { capture: true });
  window.addEventListener('pointercancel', onCancel, { capture: true });
  window.addEventListener('click', onClick, { capture: true });
  return () => {
    for (const timer of timers) clearTimeout(timer);
    window.removeEventListener('pointerdown', onDown, { capture: true });
    window.removeEventListener('mousedown', onMouseDown, { capture: true });
    window.removeEventListener('pointerup', onUp, { capture: true });
    window.removeEventListener('pointercancel', onCancel, { capture: true });
    window.removeEventListener('click', onClick, { capture: true });
  };
}
