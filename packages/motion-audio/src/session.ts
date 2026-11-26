import type { PlaySeconds, ScoreMaster } from '@open-artifact/motion-core';
import { fadeLevel, masterGain } from './mixer.ts';
import type { MasterBus } from './mixer.ts';
import type { Footage } from './clips/footage.ts';
import { lowerOf } from './clips/footage.ts';
import { sampleEnvelope } from './narration/duck.ts';
import type { Speech } from './narration/speech.ts';
import { noiseBuffer } from './synth/noise.ts';
import type { VoiceBus } from './synth/nodes.ts';
import { contextTimeOf, playTimeAt } from './window.ts';

/** One pass of playback on a master bus: the score's sends and the narration, from one origin at one rate. */
export interface ScoreSession {
  readonly bus: VoiceBus;
  /** The context time play time 0 stands at. */
  readonly origin: number;
  readonly rate: number;
  contextTime(play: number): number;
  /** Starts the narration's takes and the score's duck from play time `from`. */
  speak(from: PlaySeconds): void;
  /** Fades everything out over a few milliseconds and stops every source. */
  stop(): void;
}

export interface SessionOptions {
  readonly master: ScoreMaster;
  readonly speech: Speech | null;
  /** The video clips' own sound, played with the narration. */
  readonly footage?: Footage | null;
  readonly duration: PlaySeconds;
  readonly origin: number;
  readonly rate: number;
}

const SPEECH_FADE_SECONDS = 0.02;
const SPEECH_TAIL_SECONDS = 0.03;
const STOP_FADE_SECONDS = 0.03;
const DUCK_RECOVERY_SECONDS = 0.5;
const DISCONNECT_DELAY_MS = 120;

export function createScoreSession(masterBus: MasterBus, options: SessionOptions): ScoreSession {
  const { context } = masterBus;
  const { origin, rate, duration, speech } = options;
  const footage = options.footage ?? null;
  const contextTime = (play: number): number => contextTimeOf(play, origin, rate);
  const level = masterGain(options.master.gain);
  const fadeOut = Math.max(0, Math.min(duration, options.master.fadeOut));
  const endTime = contextTime(duration);

  const dry = context.createGain();
  dry.gain.value = level;
  if (duration > 0 && fadeOut > 0) {
    const now = playTimeAt(context.currentTime, origin, rate);
    const fadeStart = duration - fadeOut;
    if (now <= fadeStart) {
      dry.gain.setValueAtTime(level, contextTime(fadeStart));
      dry.gain.linearRampToValueAtTime(0, endTime);
    } else if (now < duration) {
      dry.gain.setValueAtTime(fadeLevel(level, fadeOut, duration, now), context.currentTime);
      dry.gain.linearRampToValueAtTime(0, endTime);
    } else {
      dry.gain.value = 0;
    }
  }
  dry.connect(masterBus.input);

  const reverb = context.createGain();
  reverb.gain.value = level;
  reverb.connect(masterBus.reverbInput);
  if (duration > 0 && fadeOut > 0) {
    reverb.gain.setValueAtTime(level, Math.max(context.currentTime, contextTime(duration - fadeOut)));
    reverb.gain.linearRampToValueAtTime(0, Math.max(context.currentTime, endTime));
  }

  const sources = new Set<AudioScheduledSourceNode>();
  const bus: VoiceBus = {
    context,
    dry,
    reverb,
    noise: noiseBuffer(context),
    track(source) {
      sources.add(source);
      source.onended = () => sources.delete(source);
    },
  };

  const speechGain = speech === null ? null : context.createGain();
  if (speechGain !== null) {
    speechGain.gain.value = 0;
    speechGain.connect(masterBus.speech);
  }
  const footageGain = footage === null ? null : context.createGain();
  if (footageGain !== null) {
    footageGain.gain.value = 0;
    footageGain.connect(masterBus.speech);
  }
  // Under narration and footage at once the score sits at the lower of the two levels.
  const ducked = lowerOf(speech?.duck ?? [], footage?.duck ?? []);
  const duck = masterBus.duck.gain;

  return {
    bus,
    origin,
    rate,
    contextTime,
    speak(from) {
      const now = context.currentTime;
      if ((speech === null || speechGain === null) && (footage === null || footageGain === null)) {
        duck.cancelScheduledValues(now);
        duck.setValueAtTime(1, now);
        return;
      }
      const start = Math.max(now, contextTime(from));
      if (footage !== null && footageGain !== null) {
        footageGain.gain.setValueAtTime(0, start);
        footageGain.gain.linearRampToValueAtTime(1, start + SPEECH_FADE_SECONDS);
        if (endTime - SPEECH_TAIL_SECONDS > start + SPEECH_FADE_SECONDS) {
          footageGain.gain.setValueAtTime(1, endTime - SPEECH_TAIL_SECONDS);
          footageGain.gain.linearRampToValueAtTime(0, endTime);
        }
        for (const piece of footage.pieces) {
          // Each piece is already cut to its stretch of play time; it starts part way in when playback starts inside it.
          const offset = Math.max(0, from - piece.at);
          if (offset >= piece.buffer.duration) continue;
          const level = context.createGain();
          level.gain.value = piece.gain;
          level.connect(footageGain);
          const source = context.createBufferSource();
          source.buffer = piece.buffer;
          source.playbackRate.value = rate;
          source.connect(level);
          bus.track(source);
          source.addEventListener('ended', () => level.disconnect());
          source.start(Math.max(now, contextTime(piece.at + offset)), offset);
        }
      }
      const level = sampleEnvelope(ducked, from);
      duck.cancelScheduledValues(now);
      duck.setValueAtTime(level, now);
      duck.setValueAtTime(level, start);
      for (const point of ducked) if (point.t > from) duck.linearRampToValueAtTime(point.v, contextTime(point.t));
      if (speech === null || speechGain === null) return;
      speechGain.gain.setValueAtTime(0, start);
      speechGain.gain.linearRampToValueAtTime(speech.gain, start + SPEECH_FADE_SECONDS);
      if (endTime - SPEECH_TAIL_SECONDS > start + SPEECH_FADE_SECONDS) {
        speechGain.gain.setValueAtTime(speech.gain, endTime - SPEECH_TAIL_SECONDS);
        speechGain.gain.linearRampToValueAtTime(0, endTime);
      }
      for (const clip of speech.clips) {
        // At a rate other than 1 a take plays faster or slower with the picture, its pitch moving with it.
        const offset = Math.max(0, from - clip.at);
        if (offset >= clip.buffer.duration) continue;
        const source = context.createBufferSource();
        source.buffer = clip.buffer;
        source.playbackRate.value = rate;
        source.connect(speechGain);
        bus.track(source);
        source.start(Math.max(now, contextTime(clip.at + offset)), offset);
      }
    },
    stop() {
      const now = context.currentTime;
      try {
        const tail = Math.max(0, Math.min(1, (endTime - now) / SPEECH_TAIL_SECONDS));
        if (speechGain !== null && speech !== null) {
          speechGain.gain.cancelScheduledValues(now);
          speechGain.gain.setValueAtTime(speech.gain * tail, now);
          speechGain.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
        }
        if (footageGain !== null) {
          footageGain.gain.cancelScheduledValues(now);
          footageGain.gain.setValueAtTime(footageGain.gain.value * tail, now);
          footageGain.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
        }
        if (speechGain !== null || footageGain !== null) {
          duck.cancelScheduledValues(now);
          duck.setValueAtTime(sampleEnvelope(ducked, playTimeAt(now, origin, rate)), now);
          duck.linearRampToValueAtTime(1, now + DUCK_RECOVERY_SECONDS);
        }
        dry.gain.cancelScheduledValues(now);
        dry.gain.setValueAtTime(dry.gain.value, now);
        dry.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
        reverb.gain.cancelScheduledValues(now);
        reverb.gain.setValueAtTime(0, now);
      } catch {
        // A closed context refuses automation; its sources are stopped below all the same.
      }
      for (const source of sources) {
        try {
          source.stop(now + 0.05);
        } catch {
          // A source that never started cannot be stopped.
        }
      }
      setTimeout(() => {
        dry.disconnect();
        reverb.disconnect();
        speechGain?.disconnect();
        footageGain?.disconnect();
      }, DISCONNECT_DELAY_MS);
    },
  };
}
