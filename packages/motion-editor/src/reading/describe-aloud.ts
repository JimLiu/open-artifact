/**
 * Describe scenes aloud: while the film plays, as it reaches a scene the browser's own speech reads that scene's
 * description; the film pauses while it speaks and plays on after. A seek, a pause, playing again or another scene
 * stops the voice, and the film then stays as the person left it. Only a voice on this device is used; without
 * speech or such a voice the More menu leaves the choice out. This browser remembers it (off unless turned on).
 */

import { create } from 'zustand';
import { useComments } from '../comments/comments.ts';
import { pause, play } from '../engine/actions.ts';
import { selectParts, useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { readSwitch, writeSwitch } from '../stores/switches.ts';
import { localVoice, sceneReached, sceneWords, speakingLimitMs } from './aloud.ts';

const KEY = 'video-describe-aloud';

export const useDescribeAloud = create<{ on: boolean; voice: boolean }>()(() => ({ on: readSwitch(KEY, false), voice: false }));

export function setDescribeAloud(on: boolean): void {
  useDescribeAloud.setState({ on });
  writeSwitch(KEY, on);
}

const speech = (): SpeechSynthesis | null => (typeof globalThis.speechSynthesis === 'object' ? globalThis.speechSynthesis : null);
const pageLanguage = (): string => document.documentElement.lang || navigator.language || 'en';

export function startDescribeAloud(): () => void {
  const synth = speech();
  if (synth === null || typeof SpeechSynthesisUtterance !== 'function') return () => undefined;
  let voice: SpeechSynthesisVoice | null = null;
  const findVoice = (): void => {
    voice = localVoice(synth.getVoices(), pageLanguage());
    useDescribeAloud.setState({ voice: voice !== null });
  };
  findVoice();
  synth.addEventListener('voiceschanged', findVoice);

  /** The film is held for the voice: it plays on when the voice ends, unless the person moved it meanwhile. */
  let held: { at: number; limit: ReturnType<typeof setTimeout> } | null = null;
  let quiet = false;
  let resuming = false;

  const release = (playOn: boolean): void => {
    if (held === null) return;
    clearTimeout(held.limit);
    const at = held.at;
    held = null;
    quiet = true;
    synth.cancel();
    quiet = false;
    if (playOn && !usePlayback.getState().playing && Math.abs(usePlayback.getState().time - at) < 1e-3) {
      // Playing on from the scene just described does not describe it again.
      resuming = true;
      play();
      resuming = false;
    }
  };

  const say = (text: string): void => {
    if (voice === null) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    pause();
    const at = usePlayback.getState().time;
    held = { at, limit: setTimeout(() => release(true), speakingLimitMs(text)) };
    const done = (): void => {
      if (!quiet) release(true);
    };
    utterance.addEventListener('end', done);
    utterance.addEventListener('error', done);
    synth.cancel();
    synth.speak(utterance);
  };

  const wanted = (): boolean => useDescribeAloud.getState().on && voice !== null && !useComments.getState().on;

  const stopPlayback = usePlayback.subscribe((state, before) => {
    if (held !== null) {
      // Played again, or moved while the voice speaks: the voice stops and the film stays where it is put.
      if (state.playing || Math.abs(state.time - held.at) > 1e-3) release(false);
      return;
    }
    if (!state.playing || resuming || !wanted()) return;
    const film = useFilm.getState();
    const parts = selectParts(film);
    const index = sceneReached(parts, before.time, state.time, !before.playing);
    if (index < 0) return;
    const text = sceneWords(parts, film.scenes?.scenes ?? null, index);
    if (text !== '') say(text);
  });
  const stopSetting = useDescribeAloud.subscribe((state, before) => {
    if (before.on && !state.on) release(false);
  });

  return () => {
    stopPlayback();
    stopSetting();
    synth.removeEventListener('voiceschanged', findVoice);
    release(false);
  };
}
