/** What Describe scenes aloud decides: the voice, the scene the film has just reached and what to say. Pure. */

import type { ClockPart, SceneEntry } from '@open-artifact/motion-core';
import { partIndexAt } from '../layers/stretch.ts';
import { plainWords } from './film-text.ts';

/** A voice as the choice reads it. */
export interface VoiceLike {
  lang: string;
  localService: boolean;
  default: boolean;
}

/** A voice on this device for the language `lang` (its first part decides), the device's default first; else null. */
export function localVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  const base = lang.toLowerCase().split(/[-_]/)[0] ?? '';
  const mine = voices.filter((voice) => voice.localService && voice.lang.toLowerCase().split(/[-_]/)[0] === base);
  return mine.find((voice) => voice.default) ?? mine[0] ?? null;
}

/** The longest a description may take to say before the film plays on anyway: about two words a second, and some. */
export function speakingLimitMs(text: string): number {
  const count = text.split(/\s+/).filter(Boolean).length;
  return 4000 + count * 600;
}

/**
 * The scene the film has just played into, or -1: the playhead moved forward by playing (not a seek) into another
 * part, or playing began at a part's start.
 */
export function sceneReached(parts: readonly ClockPart[], from: number, to: number, began: boolean): number {
  const index = partIndexAt(parts, to);
  if (index < 0) return -1;
  if (began) return Math.abs(to - parts[index]!.playStart) < 0.1 ? index : -1;
  if (to < from || to - from > 1) return -1;
  return partIndexAt(parts, from) !== index ? index : -1;
}

/** What to say for a scene: its description, else nothing. */
export function sceneWords(parts: readonly ClockPart[], scenes: readonly SceneEntry[] | null, index: number): string {
  const key = parts[index]?.key ?? null;
  if (key === null) return '';
  return plainWords(scenes?.find((scene) => scene.id === key)?.desc ?? '');
}
