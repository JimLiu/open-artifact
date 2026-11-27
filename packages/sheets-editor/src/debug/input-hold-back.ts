import { isComposingKey } from '@open-artifact/ui/keys';

/** What input is held back on: the page's window, or a stand-in where there is none. */
export interface HoldBackTarget extends EventTarget {
  document?: Document;
}

/** The press a pointer began before input was held back, to be called off once it is let through. */
interface PointerPressed {
  path: EventTarget[];
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
}

/** Holds back the person's input to the page for a while, and lets it through again. */
export interface InputHoldBack {
  /** Holds input back; `onInput` hears of the first key or press that would start input, and whether it was for the cells. */
  holdBack(onInput: (isForCells: boolean) => void): void;
  letThrough(): void;
  isHeldBack(): boolean;
}

/** Whether a held-back key is one for the cells (typing, moving, editing, pasting) rather than a shortcut or another named key. */
export function isKeyForCells(event: Event): boolean {
  let key: unknown = Reflect.get(event, 'key');
  if (typeof key !== 'string') return false;
  let isSet = (flag: string) => Reflect.get(event, flag) === true;
  let isComposing = isComposingKey({ isComposing: isSet('isComposing'), keyCode: Number(Reflect.get(event, 'keyCode')) });
  if (KEYS_FOR_CELLS.has(key) || isComposing) return true;
  if (NAMED_KEY_PATTERN.test(key)) return false;
  return !(isSet('metaKey') || (isSet('ctrlKey') && !isSet('altKey'))) || key.toLowerCase() === 'v';
}

export function createInputHoldBack(
  target: HoldBackTarget,
  makePointerEvent: (kind: string, init: PointerEventInit) => Event = (kind, init) => new PointerEvent(kind, init),
  nowMs: () => number = () => performance.now(),
): InputHoldBack {
  let letGo: ((isForCells: boolean) => void) | null = null;
  let pointerDown: PointerPressed | null = null;
  let pointerTarget: PointerPressed | null = null;
  let typingUntil = -1 / 0;
  let wasBlurred = false;
  let wasUnfocused = false;
  let notePointer = (event: Event) => {
    let pointerId = Number(Reflect.get(event, 'pointerId') ?? 0);
    if (event.type === 'pointerdown')
      pointerDown = {
        path: event.composedPath(),
        pointerId,
        pointerType: String(Reflect.get(event, 'pointerType') ?? ''),
        isPrimary: Reflect.get(event, 'isPrimary') === true,
      };
    else if (
      ((event.type === 'pointerup' || event.type === 'pointercancel') && pointerId === pointerDown?.pointerId) ||
      (event.type === 'blur' && event.target === target)
    )
      pointerDown = null;
  };
  let onEvent = (event: Event) => {
    let isKey = event.type.startsWith('key');
    if (isKey && Reflect.get(event, 'key') === 'Escape') return;
    let at = Math.min(event.timeStamp, nowMs());
    if (letGo === null) {
      notePointer(event);
      if (!isKey && EVENTS_THAT_START_INPUT.has(event.type) && Reflect.get(event, 'isReplay') !== true) typingUntil = -1 / 0;
      if (!isKey || at >= typingUntil) return;
    }
    let startsInput = EVENTS_THAT_START_INPUT.has(event.type) && !HOLD_BACK_MODIFIER_KEYS.has(String(Reflect.get(event, 'key')));
    if (event.type === 'keydown' && startsInput) typingUntil = at + 1000;
    if (event.type === 'blur' && event.target === target && wasUnfocused) return;
    if (event.type === 'blur' && event.target === target) wasBlurred = true;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (startsInput) letGo?.(!isKey || isKeyForCells(event));
  };
  for (let kind of HELD_BACK_EVENT_KINDS)
    target.addEventListener(kind, onEvent, {
      capture: true,
    });
  return {
    holdBack(onInput) {
      let wasHolding = letGo !== null;
      letGo = onInput;
      if (wasHolding) return;
      pointerTarget = pointerDown;
      pointerDown = null;
      wasBlurred = false;
      wasUnfocused = target.document?.hasFocus() === false;
      for (let kind of EVENT_KINDS_HELD_WHILE_HOLDING)
        target.addEventListener(kind, onEvent, {
          capture: true,
          passive: false,
        });
    },
    letThrough() {
      if (letGo === null) return;
      letGo = null;
      for (let kind of EVENT_KINDS_HELD_WHILE_HOLDING)
        target.removeEventListener(kind, onEvent, {
          capture: true,
        });
      if (pointerTarget !== null) {
        let { path, ...init } = pointerTarget;
        pointerTarget = null;
        let firstConnected = path.find((node) => node !== undefined && Reflect.get(node, 'isConnected') === true) ?? target;
        for (let kind of ['pointercancel', 'lostpointercapture'])
          firstConnected.dispatchEvent(
            makePointerEvent(kind, {
              ...init,
              bubbles: true,
            }),
          );
      }
      if (wasBlurred && target.document?.hasFocus() === false) target.dispatchEvent(new Event('blur'));
    },
    isHeldBack: () => letGo !== null,
  };
}
export const HELD_BACK_EVENT_KINDS = [
  'pointerdown',
  'mousedown',
  'pointermove',
  'pointerup',
  'mouseup',
  'pointercancel',
  'lostpointercapture',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'keydown',
  'keyup',
  'beforeinput',
  'input',
  'change',
  'submit',
  'blur',
  'focusout',
  'cut',
  'paste',
  'drop',
  'dragstart',
  'dragover',
];
export const EVENT_KINDS_HELD_WHILE_HOLDING = ['wheel', 'touchstart', 'gesturestart', 'gesturechange'];
export const EVENTS_THAT_START_INPUT = new Set(['keydown', 'pointerdown', 'mousedown']);
export const HOLD_BACK_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);
export const NAMED_KEY_PATTERN = /^[A-Z][A-Za-z0-9]+$/;
export const KEYS_FOR_CELLS = new Set([
  'Backspace',
  'Delete',
  'Enter',
  'Tab',
  'F2',
  'F6',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Process',
  'Dead',
  'Unidentified',
]);
export const pageInputHoldBack = createInputHoldBack(typeof window > 'u' ? new EventTarget() : window);
