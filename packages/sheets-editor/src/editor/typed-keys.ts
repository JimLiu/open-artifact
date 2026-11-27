import type { EditingMode } from '../state/transitions.ts';
import type { KeyPress } from '../state/event-reducer.ts';
import { dropLastGrapheme } from '../chips/people-list.ts';
export function entryTextAfterKey(text: string, keyPress: KeyPress): string | null {
  if (keyPress.isModifierHeld) return null;
  if (keyPress.key.length === String.fromCodePoint(keyPress.key.codePointAt(0) ?? 0).length) return text + keyPress.key;
  if (keyPress.isAltHeld) return null;
  if (keyPress.key === 'Backspace') return dropLastGrapheme(text);
  return KEYS_THAT_KEEP_ENTRY_TEXT.has(keyPress.key) ? text : null;
}
export const BLANK_AND_FORMULA_ENTRY_MODES = ['', '=A1'].map(
  (text): EditingMode => ({
    kind: 'editing',
    text,
    textAtStart: '',
    typingIn: 'cell',
  }),
);
export const KEYS_THAT_KEEP_ENTRY_TEXT = new Set<string>(['Delete', 'End', 'ArrowRight', 'F4']);
