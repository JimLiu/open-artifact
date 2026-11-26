/**
 * What kind of hand works the board: a mouse, a finger, or a stylus — and
 * whether a stylus is on a touch screen (where it also works the camera
 * and the chrome as a finger would) or on a desktop tablet (where it acts
 * as a mouse, apart from its pressure and its eraser end).
 */

import { create } from 'zustand';

/** The kinds of input the board tells apart. */
export type InputKind = 'mouse' | 'touch' | 'pen';

/** The slops of a stylus on a touch screen: how far a press may miss, how far a tap may drift, and how far a press on an item moves before it drags. */
export const TOUCH_PEN_SLOP = { clickPx: 10, tapPx: 10, grabPx: 6 } as const;

/** Two stylus taps this close in time (ms) and space (screen px) are a double tap. */
export const PEN_DOUBLE_TAP = { ms: 350, px: 30 } as const;

/** True for a stylus on a screen that also takes touch. */
export function isTouchScreenPen(event: Pick<PointerEvent, 'pointerType'>, maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0): boolean {
  return event.pointerType === 'pen' && maxTouchPoints !== 0;
}

/** The pointer kind hit tests take: `touch-pen` for a stylus on a touch screen, else the event's own type. */
export function pressKind(event: Pick<PointerEvent, 'pointerType'>): string {
  return isTouchScreenPen(event) ? 'touch-pen' : event.pointerType;
}

/** True when a pen's eraser end is down (or its eraser button is held). */
export function isPenEraser(event: Pick<PointerEvent, 'pointerType' | 'button' | 'buttons'>): boolean {
  return event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0);
}

/** The last kind of input that pressed on the page. */
export const useLastInput = create<{ kind: InputKind }>()(() => ({ kind: 'mouse' }));

/** Remembers the kind of a press. */
export function noteInput(event: Pick<PointerEvent, 'pointerType'>): void {
  const kind: InputKind = event.pointerType === 'touch' ? 'touch' : event.pointerType === 'pen' ? 'pen' : 'mouse';
  if (useLastInput.getState().kind !== kind) useLastInput.setState({ kind });
}

let penStrokeEndedAt = -Infinity;

/** Notes that a stylus just finished a stroke (a tap right after is a slip, not a click). */
export function notePenStroke(now = performance.now()): void {
  penStrokeEndedAt = now;
}

/** True when a stylus finished a stroke less than `ms` ago. */
export function penStrokeEndedWithin(ms: number, now = performance.now()): boolean {
  return now - penStrokeEndedAt < ms;
}
