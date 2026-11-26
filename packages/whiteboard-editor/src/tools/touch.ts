/**
 * One finger on the board with the Select tool, on a touch screen.
 *
 * A finger works the camera first, so a board can be explored without
 * moving things by accident:
 * - dragging pans, unless the finger pressed something already selected
 *   (that drags it, as a mouse would);
 * - holding still for {@link TOUCH_LONG_PRESS_MS} picks the item up: it is
 *   selected and drawn lifted ({@link TOUCH_LIFT_FEEDBACK}), and dragging
 *   then moves it; lifting the finger without moving opens the context
 *   menu instead (see `ui/ContextMenu.tsx`);
 * - a tap selects (or, on empty board, clears the selection); a quick one
 *   ({@link isQuickTap}) on a text showing only its placeholder also starts
 *   typing into it, as a click does.
 *
 * Two fingers always zoom and pan (`services/viewport.ts`).
 *
 * The decisions are a pure reducer ({@link reduceTouchPress}), unit-tested;
 * `tools/select.ts` runs the gestures they lead to.
 */

import type { Point } from '../lib/camera.ts';

/** A touch held this long (ms) without moving counts as a long press. */
export const TOUCH_LONG_PRESS_MS = 450;

/** How far (screen pixels, across plus down) a finger moves before it counts as moving. */
export const TOUCH_MOVE_SLOP_PX = 9;

/** The look of an item picked up by a long press (and of items dragged by touch). */
export const TOUCH_LIFT_FEEDBACK = { scale: 1.1, opacity: 0.75, ms: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' } as const;

/** True once a finger moved past {@link TOUCH_MOVE_SLOP_PX} from `start`. */
export function movedPastTouchSlop(start: Point, point: Point): boolean {
  return Math.abs(point.x - start.x) + Math.abs(point.y - start.y) >= TOUCH_MOVE_SLOP_PX;
}

/** The longest (ms) and farthest (screen pixels) a quick tap lasts and drifts. */
export const TOUCH_QUICK_TAP = { ms: 400, px: 10 } as const;

/** True when a tap that went down at `start` (`startMs`) and lifted at `end` (`endMs`) is quick. */
export function isQuickTap(start: Point, startMs: number, end: Point, endMs: number): boolean {
  return endMs - startMs <= TOUCH_QUICK_TAP.ms && Math.hypot(end.x - start.x, end.y - start.y) <= TOUCH_QUICK_TAP.px;
}

/** A one-finger press still deciding what it is. */
export interface TouchPress {
  /** Where the finger went down, screen pixels. */
  start: Point;
  /** The finger pressed something already selected (dragging moves it). */
  selected: boolean;
  /** A long press picked the item up. */
  popped: boolean;
}

/** What happened to a press. */
export type TouchPressEvent = { kind: 'move'; at: Point } | { kind: 'hold' } | { kind: 'up' } | { kind: 'cancel' };

/**
 * What a press turns into:
 * - `pan`: move the camera from now on;
 * - `drag`: move the pressed item (and the selection it is part of);
 * - `pop`: pick the item up (select it, draw it lifted);
 * - `tap`: the finger lifted without moving or holding;
 * - `cancel`: the press was cancelled;
 * - `none`: nothing yet.
 */
export type TouchPressOutcome = 'pan' | 'drag' | 'pop' | 'tap' | 'cancel' | 'none';

/**
 * The next state of a press (`null` once it is decided) and what it
 * turned into. A picked-up item drags once the finger moves past the slop;
 * lifting a picked-up item is `none` (the context menu takes it).
 */
export function reduceTouchPress(press: TouchPress, event: TouchPressEvent): { press: TouchPress | null; outcome: TouchPressOutcome } {
  switch (event.kind) {
    case 'move':
      if (!movedPastTouchSlop(press.start, event.at)) return { press, outcome: 'none' };
      return { press: null, outcome: press.popped || press.selected ? 'drag' : 'pan' };
    case 'hold':
      return press.popped ? { press, outcome: 'none' } : { press: { ...press, popped: true }, outcome: 'pop' };
    case 'up':
      return { press: null, outcome: press.popped ? 'none' : 'tap' };
    case 'cancel':
      return { press: null, outcome: 'cancel' };
  }
}

/* ------------------------------------------------------------------------ */
/* Palms                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * When a touch on the board is a hand resting on the screen, not a finger:
 * any touch while a stylus is down; once a stylus was seen, a touch within
 * {@link PALM_RULES}`.penLiftMs` of it lifting or a contact wider than
 * `contactPx`; and any touch within `afterPalmMs` of the last palm.
 */
export const PALM_RULES = { penLiftMs: 500, contactPx: 90, afterPalmMs: 300 } as const;

/** What palm rejection remembers about the stylus and the last palm. */
export interface PalmWatch {
  /** Styluses down now. */
  pensDown: number;
  /** A stylus was used on this page. */
  penSeen: boolean;
  /** When the last stylus lifted, ms. */
  penUpAt: number;
  /** When the last palm touched or lifted, ms. */
  palmAt: number;
}

/** A fresh watch: no stylus seen, no palm. */
export function newPalmWatch(): PalmWatch {
  return { pensDown: 0, penSeen: false, penUpAt: -Infinity, palmAt: -Infinity };
}

/** True when a touch landing at `now` with a contact of `width × height` CSS pixels is a palm. */
export function isPalmTouch(watch: PalmWatch, contact: { width: number; height: number }, now: number): boolean {
  if (watch.pensDown > 0) return true;
  if (now - watch.palmAt < PALM_RULES.afterPalmMs) return true;
  return watch.penSeen && (now - watch.penUpAt < PALM_RULES.penLiftMs || Math.max(contact.width, contact.height) > PALM_RULES.contactPx);
}

/**
 * Whether a touch's `touchmove` is held back from the page while a stylus
 * or palm is down: not for a touch that started on a control or off the
 * board until it moved past {@link TOUCH_MOVE_SLOP_PX}, so controls still
 * get their taps and small scrolls.
 */
export function swallowsTouchMove(busy: boolean, startedOnBoard: boolean, start: Point, at: Point): boolean {
  if (!busy) return false;
  return startedOnBoard || movedPastTouchSlop(start, at);
}

/* ------------------------------------------------------------------------ */
/* Two- and three-finger taps                                               */
/* ------------------------------------------------------------------------ */

/**
 * Two fingers tapped together undo; three redo. Every finger must lift
 * within {@link FINGER_TAP}`.ms` of the first one landing, none moving
 * `px` or more.
 */
export const FINGER_TAP = { ms: 300, px: 10 } as const;

/** Fingers on the screen since the first one landed. */
export interface FingerTaps {
  /** When the first finger landed, ms. */
  startedAt: number;
  /** Where each finger still down landed. */
  down: Map<number, Point>;
  /** The most fingers down at once. */
  most: number;
  /** A finger moved too far or the fingers stayed too long. */
  spoiled: boolean;
}

/** A finger landed; starts the count when it is the first. */
export function fingerDown(taps: FingerTaps | null, id: number, at: Point, now: number): FingerTaps {
  const next = taps ?? { startedAt: now, down: new Map(), most: 0, spoiled: false };
  next.down.set(id, at);
  next.most = Math.max(next.most, next.down.size);
  return next;
}

/** A finger moved; too far spoils the tap. */
export function fingerMoved(taps: FingerTaps, id: number, at: Point): void {
  const start = taps.down.get(id);
  if (start && Math.hypot(at.x - start.x, at.y - start.y) >= FINGER_TAP.px) taps.spoiled = true;
}

/**
 * A finger lifted (or was cancelled). Once the last one is up: `undo` for
 * a two-finger tap, `redo` for three, else `none`; `null` while fingers
 * are still down.
 */
export function fingerUp(taps: FingerTaps, id: number, now: number, cancelled = false): 'undo' | 'redo' | 'none' | null {
  if (!taps.down.delete(id)) return taps.down.size === 0 ? 'none' : null;
  if (cancelled || now - taps.startedAt > FINGER_TAP.ms) taps.spoiled = true;
  if (taps.down.size > 0) return null;
  if (taps.spoiled) return 'none';
  return taps.most === 2 ? 'undo' : taps.most === 3 ? 'redo' : 'none';
}
