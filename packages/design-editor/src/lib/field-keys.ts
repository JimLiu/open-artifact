/** Keys of the properties panel's text fields. */

import { historyShortcutOf } from './physical-keys.ts';

/** The parts of a key press {@link historyKeyOf} reads. */
export interface HistoryKey {
  key: string;
  /** Physical key, so non-Latin layouts work too. */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The canvas's undo and redo keys (see `historyShortcutOf`), read from a field's key event. */
export function historyKeyOf(event: HistoryKey): 'undo' | 'redo' | null {
  return historyShortcutOf({
    key: event.key,
    ...(event.code === undefined ? {} : { code: event.code }),
    meta: event.metaKey || event.ctrlKey,
    ctrl: event.ctrlKey && !event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  });
}

/**
 * The number in a CSS length stepped by `delta`, keeping its unit. An empty
 * field steps from what it shows in grey (`placeholder`); a number field
 * (`numeric`, one with a unit) whose placeholder is no number steps from 0.
 * `null` when there is nothing to step.
 */
export function stepLength(text: string, placeholder: string, delta: number, numeric = false): string | null {
  const step = (from: string) => {
    const match = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(from.trim());
    return match ? `${Math.round((Number(match[1]) + delta) * 100) / 100}${match[2]}` : null;
  };
  if (text.trim()) return step(text);
  return step(placeholder) ?? (numeric ? step('0') : null);
}
