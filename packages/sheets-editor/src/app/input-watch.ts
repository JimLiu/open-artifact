import { MODIFIER_KEYS } from '../state/escape.ts';
import { isKeyForCells } from '../debug/input-hold-back.ts';
/** What a key or press was: nothing to count, one for the cells, or another. */
export type InputKind = 'nothing' | 'forCells' | 'other';
export function inputKindOfEvent(event: Event): InputKind {
  if (!(Reflect.get(event, 'isTrusted') === true && Reflect.get(event, 'isReplay') !== true) || MODIFIER_KEYS.has(String(Reflect.get(event, 'key'))))
    return 'nothing';
  return isKeyForCells(event) ? 'forCells' : 'other';
}
export function createPersonInputWatch(win: Window, now: () => number, kindOfInput: (event: Event) => InputKind = inputKindOfEvent) {
  let hasInputCome = false;
  let lastInputAt = -1 / 0;
  let hadRested = false;
  let wasPointerPressedLast = false;
  let lostAtSwap: InputKind = 'nothing';
  let mayStillBeLost = true;
  let noteLost = (kind: InputKind) => {
    if (mayStillBeLost && (kind === 'forCells' || lostAtSwap === 'nothing')) lostAtSwap = kind;
  };
  // Only keydown events carry `key` and `repeat`.
  let onInput = (event: Event & { key?: string; repeat?: boolean }) => {
    hasInputCome = true;
    noteLost(kindOfInput(event));
    if (MODIFIER_KEYS.has(String(Reflect.get(event, 'key')))) return;
    let time = Math.min(event.timeStamp, now());
    hadRested = Reflect.get(event, 'repeat') !== true && time - lastInputAt >= INPUT_REST_MS;
    lastInputAt = Math.max(lastInputAt, time);
  };
  for (let eventType of PERSON_INPUT_EVENTS) win.addEventListener(eventType, onInput, true);
  return {
    hasAnyCome: () => hasInputCome || win.navigator.userActivation?.hasBeenActive !== false,
    /** The input that came before this page took over from the one it swapped in for, which may have been lost. */
    lostAtSwap: () => lostAtSwap,
    pageBeforeLost: (isForCells: boolean) => noteLost(isForCells ? 'forCells' : 'other'),
    nothingIsLostAnyMore() {
      mayStillBeLost = false;
      lostAtSwap = 'nothing';
    },
    hadRestedBeforeLast: () => hadRested,
    restBeginsNow: () => void (lastInputAt = now()),
    notePointerPressedLast: (isPointer: boolean) => void (wasPointerPressedLast = isPointer),
    wasPointerPressedLast: () => wasPointerPressedLast,
  };
}
export const PERSON_INPUT_EVENTS = ['keydown', 'pointerdown', 'mousedown'];
export const INPUT_REST_MS = 1000;

/** Hears whether, and how, the person has used keys or pointer in the page. */
export type PersonInputWatch = ReturnType<typeof createPersonInputWatch>;
