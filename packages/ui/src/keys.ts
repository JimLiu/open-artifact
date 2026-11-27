/**
 * Keyboard guards shared by the kit's controls.
 *
 * A key held down auto-repeats: without a guard, holding Enter on a button,
 * a menu row that keeps its menu open or a switch presses it again and again,
 * and a press that moves focus (closing a toast, opening a dialog) lands the
 * repeats on whatever gets focus next.
 */

/** The fields of a keyboard event the guards read. */
export interface KeyLike {
  key: string;
  repeat: boolean;
}

/** The fields of a keyboard event that tell an input method is composing. */
export interface ComposingLike {
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * True while an input method composes (Chinese, Japanese, Korean…): the
 * Enter or Escape it sees picks or drops the candidate, so a field must not
 * also commit or cancel on it. Safari reports the end of a composition as
 * key code 229 with `isComposing` already false.
 */
export function isComposingKey(event: ComposingLike): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229;
}

/** True for an auto-repeated Enter or Space. */
export function isRepeatedActivation(event: KeyLike): boolean {
  return event.repeat && (event.key === 'Enter' || event.key === ' ');
}

/** A keydown event as the guards see it. */
export type GuardedKeyEvent = KeyLike & { target: unknown; currentTarget: unknown; preventDefault(): void };

/**
 * A keydown handler that keeps a held Enter or Space from pressing the
 * focused control again: the repeats have their default (the native click,
 * or Base UI's activation) prevented.
 */
export function preventRepeatedActivation(event: GuardedKeyEvent): void {
  if (isRepeatedActivation(event) && event.target === event.currentTarget) event.preventDefault();
}

/**
 * Wraps a keydown handler so a held Enter or Space presses the control once:
 * the repeats have their default (the native click, or Base UI's activation)
 * prevented. The wrapped handler still runs (and sees `defaultPrevented`).
 */
export function withRepeatGuard<E extends GuardedKeyEvent>(handler?: (event: E) => void): (event: E) => void {
  if (!handler) return preventRepeatedActivation;
  return (event) => {
    preventRepeatedActivation(event);
    handler(event);
  };
}

/** The parts of a window {@link guardHeldActivation} listens on. */
export interface KeyGuardWindow {
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyGuardEvent) => void, capture: boolean): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyGuardEvent) => void, capture: boolean): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** The parts of a keyboard event {@link guardHeldActivation} reads. */
export interface KeyGuardEvent extends KeyLike {
  type: string;
  target: unknown;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

/** How long the guard stays after the first key is released. */
export const HELD_KEY_SETTLE_MS = 200;
/** The guard never lasts longer than this. */
export const HELD_KEY_GUARD_MAX_MS = 2000;

/**
 * After an Enter or Space press that closes something (a toast's close
 * button), keeps the activation keys from pressing what gets focus next:
 * until the pressed key is released, plus a short settle, Enter and Space
 * keydowns outside `isInside` are swallowed at the window, and so are Space
 * keyups (a native button acts on Space's keyup). Lasts at most 2 s.
 * Returns a function that ends the guard early.
 */
export function guardHeldActivation(
  win: KeyGuardWindow,
  firstKey: string,
  isInside: (target: unknown) => boolean,
): () => void {
  let settling: number | null = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('keyup', onKey, true);
    win.clearTimeout(limit);
    if (settling !== null) win.clearTimeout(settling);
  };
  const onKey = (event: KeyGuardEvent) => {
    const activation = event.key === 'Enter' || event.key === ' ';
    if (event.type === 'keyup') {
      if (event.key === ' ' && !isInside(event.target)) event.preventDefault();
      if (event.key === firstKey && settling === null) settling = win.setTimeout(end, HELD_KEY_SETTLE_MS);
      return;
    }
    if (activation && !isInside(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const limit = win.setTimeout(end, HELD_KEY_GUARD_MAX_MS);
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('keyup', onKey, true);
  return end;
}

/** The parts of a window {@link guardComposingKeys} listens on. */
export interface ComposingGuardWindow {
  addEventListener(type: 'keydown', listener: (event: ComposingGuardEvent) => void, capture: boolean): void;
  removeEventListener(type: 'keydown', listener: (event: ComposingGuardEvent) => void, capture: boolean): void;
}

/** The parts of a keydown {@link guardComposingKeys} reads. */
export interface ComposingGuardEvent extends ComposingLike {
  key: string;
  target: unknown;
  stopImmediatePropagation(): void;
}

/** The keys an input method uses to pick, drop or move between candidates. */
export const COMPOSING_COMMIT_KEYS: readonly string[] = ['Enter', 'Escape', 'Tab'];

/** True when `target` is an element inside one that matches `selector`. */
function insideSelector(target: unknown, selector: string): boolean {
  const closest = (target as { closest?: unknown } | null)?.closest;
  return typeof closest === 'function' && (closest as (selector: string) => unknown).call(target, selector) !== null;
}

/**
 * Keeps the page's shortcuts off the keys an input method composes with:
 * an Enter, Escape or Tab pressed while it composes (see {@link isComposingKey})
 * is stopped at the window, before any other handler sees it, so it only
 * picks or drops the candidate. Its default is left alone. Keys inside
 * `skip` (a rich-text editor that reads composition itself) pass. Returns a
 * function that removes the guard.
 */
export function guardComposingKeys(win: ComposingGuardWindow, skip = '.ProseMirror'): () => void {
  const onKey = (event: ComposingGuardEvent) => {
    if (!COMPOSING_COMMIT_KEYS.includes(event.key) || !isComposingKey(event)) return;
    if (skip && insideSelector(event.target, skip)) return;
    event.stopImmediatePropagation();
  };
  win.addEventListener('keydown', onKey, true);
  return () => win.removeEventListener('keydown', onKey, true);
}

/** The fields of a keyboard event {@link shortcutLetter} reads. */
export interface ShortcutKeyLike {
  key: string;
  code?: string;
}

/**
 * The letter a shortcut means, lower-cased. A Latin letter is taken as typed,
 * so remapped layouts (Dvorak, AZERTY) keep their own letters; any other
 * character (Cyrillic, Greek, a symbol the Option key makes) falls back to the
 * physical key, so ⌘S still saves on a Russian layout. Keys that are not
 * letters (`Escape`, `Enter`) come back lower-cased.
 */
export function shortcutLetter(event: ShortcutKeyLike): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const physical = /^Key([A-Z])$/.exec(event.code ?? '');
  if (physical && event.key.length === 1) return physical[1]!.toLowerCase();
  return event.key.toLowerCase();
}

/**
 * A dangerous confirmation ignores Enter and Space while it appears, so the
 * press that opened it (a held Enter or Delete) can't confirm it too. The
 * window runs from opening until the dialog has been fully shown for
 * {@link EARLY_PRESS_SETTLE_MS}, and never past {@link EARLY_PRESS_MAX_MS}.
 */
export const EARLY_PRESS_SETTLE_MS = 300;
/** The early-press window never lasts longer than this after opening. */
export const EARLY_PRESS_MAX_MS = 3000;

/** When a guarded dialog opened and when it was fully shown (`null`: still appearing). */
export interface EarlyPressTimes {
  opened: number;
  shown: number | null;
}

/** The time the early-press window closes. */
export function earlyPressEnds(times: EarlyPressTimes): number {
  const limit = times.opened + EARLY_PRESS_MAX_MS;
  return times.shown === null ? limit : Math.min(limit, Math.max(times.opened, times.shown) + EARLY_PRESS_SETTLE_MS);
}

/**
 * True when a key event must not activate anything in a guarded dialog: an
 * Enter or Space from the user (synthetic events pass) inside the window, or
 * an auto-repeat at any time.
 */
export function blocksEarlyPress(times: EarlyPressTimes, now: number, event: KeyLike & { isTrusted?: boolean }): boolean {
  if (event.key !== 'Enter' && event.key !== ' ') return false;
  if (event.repeat) return true;
  if (event.isTrusted === false) return false;
  return now < earlyPressEnds(times);
}
