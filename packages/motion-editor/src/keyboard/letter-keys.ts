/**
 * Single-key shortcuts (a letter, a digit or a mark with no Cmd, Ctrl or Alt) can be turned off from the toolbar's
 * More menu, so speech input and stray presses do not play, mute or go full screen. On unless turned off; this
 * browser remembers the choice.
 */

import { create } from 'zustand';
import { readSwitch, writeSwitch } from '../stores/switches.ts';

const KEY = 'video-letter-keys';

/** A press of one character key alone: Shift may be held (a capital), Space is not a character key. */
export function isCharacterKey(press: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return [...press.key].length === 1 && press.key !== ' ' && !press.metaKey && !press.ctrlKey && !press.altKey;
}

export const useLetterKeys = create<{ on: boolean }>()(() => ({ on: readSwitch(KEY, true) }));

export function setLetterKeys(on: boolean): void {
  useLetterKeys.setState({ on });
  writeSwitch(KEY, on);
}
