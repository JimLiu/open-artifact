/**
 * Dragging a canvas with the right mouse button. A right press that travels a
 * few pixels pans the view and does nothing else: the selection stays as it
 * was and no menu opens. One that does not travel is the right-click it always
 * was: once the button is up, the press goes on to the editor and the menu
 * opens where it was pressed.
 *
 * Browsers ask for the menu at different times: macOS and Linux send
 * `contextmenu` right after the press, Windows after the release. So the press
 * is held back until it is known which it is, the menu asked for meanwhile is
 * stopped, and on a release without travel the press is sent again (and, when
 * the menu was already asked for, the menu too). A `contextmenu` that follows
 * a pan is stopped.
 *
 * {@link rightPressStep} is the decision, without a DOM; {@link installRightDragPan}
 * wires it to a canvas element.
 */

/** Distance a right press travels before it pans, CSS px. */
export const RIGHT_PAN_THRESHOLD = 4;
/** How long after a pan a late `contextmenu` (Windows sends it after the release) is still stopped, ms. */
export const RIGHT_PAN_QUIET_MS = 500;

/** Where a right press stands. */
export type RightPress =
  /** No right press. `quietUntil`: a pan ended, and a `contextmenu` before then is stopped. */
  | { phase: 'idle'; quietUntil: number }
  /** Pressed, not yet travelled. `menu`: the browser asked for the menu meanwhile. */
  | { phase: 'held'; id: number; x: number; y: number; menu: boolean }
  /** Panning; (x, y) is where the pointer last was. */
  | { phase: 'panning'; id: number; x: number; y: number };

/** No right press. */
export const RIGHT_PRESS_IDLE: RightPress = { phase: 'idle', quietUntil: Number.NEGATIVE_INFINITY };

/** What reached the canvas. `time` is a clock in ms (the event's `timeStamp` or `performance.now()`). */
export type RightPressInput =
  /** A right press on the canvas that may pan. */
  | { type: 'press'; id: number; x: number; y: number; time: number }
  | { type: 'move'; id: number; x: number; y: number; time: number }
  | { type: 'release'; id: number; x: number; y: number; time: number }
  | { type: 'cancel'; id: number; time: number }
  /** The browser asks for the context menu. */
  | { type: 'menu'; time: number };

/** What to do with the event. */
export type RightPressEffect =
  /** Not this press's: let it through. */
  | { do: 'pass' }
  /** Stop it (a `contextmenu`'s default too). */
  | { do: 'stop' }
  /** Stop it and move the view by (dx, dy); `start` on the first move of a pan. */
  | { do: 'pan'; dx: number; dy: number; start: boolean }
  /** Stop it: the pan is over. */
  | { do: 'end' }
  /** A right-click: send the press again, let the release through, and open the menu if it was already asked for. */
  | { do: 'click'; menu: boolean };

/** The next state of a right press, and what to do with the event that moved it there. */
export function rightPressStep(state: RightPress, input: RightPressInput): { state: RightPress; effect: RightPressEffect } {
  switch (input.type) {
    case 'press':
      // A second press while one is held (another pointer) is let alone.
      if (state.phase === 'held' || state.phase === 'panning') return { state, effect: { do: 'pass' } };
      return { state: { phase: 'held', id: input.id, x: input.x, y: input.y, menu: false }, effect: { do: 'stop' } };
    case 'move':
      if (state.phase === 'held' && state.id === input.id) {
        const dx = input.x - state.x;
        const dy = input.y - state.y;
        if (Math.hypot(dx, dy) < RIGHT_PAN_THRESHOLD) return { state, effect: { do: 'stop' } };
        return { state: { phase: 'panning', id: input.id, x: input.x, y: input.y }, effect: { do: 'pan', dx, dy, start: true } };
      }
      if (state.phase === 'panning' && state.id === input.id) {
        return { state: { ...state, x: input.x, y: input.y }, effect: { do: 'pan', dx: input.x - state.x, dy: input.y - state.y, start: false } };
      }
      return { state, effect: { do: 'pass' } };
    case 'release':
      if (state.phase === 'held' && state.id === input.id) {
        // Not asked for yet (Windows): the browser asks after the release, and that is let through.
        return { state: RIGHT_PRESS_IDLE, effect: { do: 'click', menu: state.menu } };
      }
      if (state.phase === 'panning' && state.id === input.id) {
        return { state: { phase: 'idle', quietUntil: input.time + RIGHT_PAN_QUIET_MS }, effect: { do: 'end' } };
      }
      return { state, effect: { do: 'pass' } };
    case 'cancel':
      if ((state.phase === 'held' || state.phase === 'panning') && state.id === input.id) {
        return { state: { phase: 'idle', quietUntil: input.time + RIGHT_PAN_QUIET_MS }, effect: { do: state.phase === 'panning' ? 'end' : 'stop' } };
      }
      return { state, effect: { do: 'pass' } };
    case 'menu':
      if (state.phase === 'held') return { state: { ...state, menu: true }, effect: { do: 'stop' } };
      if (state.phase === 'panning') return { state, effect: { do: 'stop' } };
      return input.time < state.quietUntil ? { state: RIGHT_PRESS_IDLE, effect: { do: 'stop' } } : { state, effect: { do: 'pass' } };
  }
}

/** Options of {@link installRightDragPan}. */
export interface RightDragPanOptions {
  /** Moves the view by a screen distance, CSS px: what is under the pointer follows it. */
  pan(dx: number, dy: number): void;
  /**
   * Whether this right press on the canvas may pan. Presses in fields and text
   * being typed never do (their own menu opens as usual); this narrows it further.
   */
  accepts?(event: PointerEvent): boolean;
  /** A pan starts (`true`) or ends (`false`). */
  onPanning?(panning: boolean): void;
}

/** Set on `<html>` while a right-button pan runs; the grabbing cursor is drawn from it. */
export const RIGHT_PAN_ATTRIBUTE = 'data-right-drag-pan';

const RIGHT_BUTTON = 2;
const RIGHT_BUTTONS_MASK = 2;
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Events this module sent itself: they go through untouched. */
const sentAgain = new WeakSet<Event>();

function grabbingStyle(doc: Document): void {
  if (doc.getElementById('open-artifact-right-drag-pan')) return;
  const style = doc.createElement('style');
  style.id = 'open-artifact-right-drag-pan';
  style.textContent = `html[${RIGHT_PAN_ATTRIBUTE}], html[${RIGHT_PAN_ATTRIBUTE}] * { cursor: grabbing !important; }`;
  doc.head.append(style);
}

/**
 * Lets the right mouse button drag `surface` (see the top of this file).
 * Listens on the window, in the capture phase, so the press is held back
 * before the editor's own handlers (React's included) see it. Returns the
 * uninstaller.
 */
export function installRightDragPan(surface: HTMLElement, options: RightDragPanOptions): () => void {
  const doc = surface.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => {};
  grabbingStyle(doc);
  let state: RightPress = RIGHT_PRESS_IDLE;
  /** The held press, to send again on a right-click. */
  let press: PointerEvent | null = null;
  let menuTimer: ReturnType<typeof setTimeout> | undefined;

  const panning = (on: boolean, pointerId?: number): void => {
    if (on) {
      doc.documentElement.setAttribute(RIGHT_PAN_ATTRIBUTE, '');
      try {
        if (pointerId !== undefined) surface.setPointerCapture(pointerId);
      } catch {
        // The pointer is gone already.
      }
    } else {
      doc.documentElement.removeAttribute(RIGHT_PAN_ATTRIBUTE);
      try {
        if (pointerId !== undefined && surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
      } catch {
        // Nothing to release.
      }
    }
    options.onPanning?.(on);
  };

  /** The held press goes on to the editor, and the menu opens if it was asked for. */
  const click = (menu: boolean): void => {
    const held = press;
    press = null;
    if (!held) return;
    const at = held.target instanceof Node && held.target.isConnected ? held.target : doc.elementFromPoint(held.clientX, held.clientY);
    if (!at) return;
    const again = new PointerEvent('pointerdown', held);
    sentAgain.add(again);
    at.dispatchEvent(again);
    if (!menu) return;
    // After the release has reached the editor, as a right-click on Windows would have it.
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => {
      const target = at.isConnected ? at : doc.elementFromPoint(held.clientX, held.clientY);
      if (!target) return;
      const ask = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: win,
        button: RIGHT_BUTTON,
        buttons: 0,
        clientX: held.clientX,
        clientY: held.clientY,
        screenX: held.screenX,
        screenY: held.screenY,
        shiftKey: held.shiftKey,
        altKey: held.altKey,
        ctrlKey: held.ctrlKey,
        metaKey: held.metaKey,
      });
      sentAgain.add(ask);
      target.dispatchEvent(ask);
    });
  };

  const apply = (event: Event, input: RightPressInput): void => {
    const before = state;
    const step = rightPressStep(state, input);
    state = step.state;
    const { effect } = step;
    switch (effect.do) {
      case 'pass':
        return;
      case 'stop':
        event.stopPropagation();
        if (event.type === 'contextmenu') event.preventDefault();
        if (input.type === 'cancel') press = null;
        return;
      case 'pan':
        event.stopPropagation();
        if (effect.start) panning(true, before.phase === 'held' ? before.id : undefined);
        options.pan(effect.dx, effect.dy);
        return;
      case 'end':
        event.stopPropagation();
        press = null;
        panning(false, before.phase === 'panning' ? before.id : undefined);
        return;
      case 'click':
        // The release itself goes on, after the press it follows.
        click(effect.menu);
        return;
    }
  };

  const onDown = (event: PointerEvent): void => {
    if (sentAgain.has(event) || event.button !== RIGHT_BUTTON || event.pointerType === 'touch') return;
    const target = event.target;
    if (!(target instanceof Element) || !surface.contains(target) || target.closest(TYPING)) return;
    if (options.accepts && !options.accepts(event)) return;
    if (state.phase === 'held' || state.phase === 'panning') return;
    press = event;
    apply(event, { type: 'press', id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp });
  };
  const onMove = (event: PointerEvent): void => {
    if (state.phase !== 'held' && state.phase !== 'panning') return;
    if (event.pointerId !== state.id) return;
    // The release happened where no one heard it: a pan ends, a press opens no menu.
    if ((event.buttons & RIGHT_BUTTONS_MASK) === 0) {
      apply(event, { type: 'cancel', id: event.pointerId, time: event.timeStamp });
      return;
    }
    apply(event, { type: 'move', id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp });
  };
  const onUp = (event: PointerEvent): void => {
    if (sentAgain.has(event)) return;
    apply(event, { type: 'release', id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp });
  };
  const onCancel = (event: PointerEvent): void => {
    apply(event, { type: 'cancel', id: event.pointerId, time: event.timeStamp });
  };
  const onMenu = (event: MouseEvent): void => {
    if (sentAgain.has(event)) return;
    apply(event, { type: 'menu', time: event.timeStamp });
  };
  const onBlur = (): void => {
    if (state.phase === 'panning') panning(false, state.id);
    state = RIGHT_PRESS_IDLE;
    press = null;
  };

  const capture = { capture: true } as const;
  win.addEventListener('pointerdown', onDown, capture);
  win.addEventListener('pointermove', onMove, capture);
  win.addEventListener('pointerup', onUp, capture);
  win.addEventListener('pointercancel', onCancel, capture);
  win.addEventListener('contextmenu', onMenu, capture);
  win.addEventListener('blur', onBlur);
  return () => {
    clearTimeout(menuTimer);
    onBlur();
    win.removeEventListener('pointerdown', onDown, capture);
    win.removeEventListener('pointermove', onMove, capture);
    win.removeEventListener('pointerup', onUp, capture);
    win.removeEventListener('pointercancel', onCancel, capture);
    win.removeEventListener('contextmenu', onMenu, capture);
    win.removeEventListener('blur', onBlur);
  };
}
