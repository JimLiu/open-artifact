import { playSeconds } from '@open-artifact/motion-core';
import type { ClipSoundUse, PlaySeconds } from '@open-artifact/motion-core';
import { duckEnvelope, sampleEnvelope } from '../narration/duck.ts';
import type { DuckPoint } from '../narration/duck.ts';
import { stretchChannels } from './stretch.ts';

/**
 * Footage: the sound of the film's video clips, cut from their files into pieces on the play clock. Each piece is
 * ready to play as it is, already slowed or sped to its stretch of play time.
 */

export interface FootagePiece {
  readonly at: PlaySeconds;
  /** Play seconds; the buffer is this long. */
  readonly dur: number;
  readonly buffer: AudioBuffer;
  readonly gain: number;
}

export interface Footage {
  readonly pieces: readonly FootagePiece[];
  /** The score's level under the footage. */
  readonly duck: readonly DuckPoint[];
}

/** How far the score goes down under a clip's sound, in dB. */
export const FOOTAGE_DUCK_DB = -14;
/** Footage is brought towards this loudness, in LUFS… */
export const FOOTAGE_LOUDNESS = -16;
/** …but raised by this many dB at most, so a quiet room stays quiet. */
export const FOOTAGE_MOST_BOOST_DB = 10;
/** All pieces together play this many seconds at most; the rest is silent. */
export const FOOTAGE_MOST_SECONDS = 600;
/** A piece shorter than this is not heard. */
export const SHORTEST_PIECE_SECONDS = 0.05;
/** A looping file shorter than this is not heard. */
export const SHORTEST_LOOP_SECONDS = 0.5;
/** Each piece fades in and out over this long, so its ends never click. */
export const PIECE_FADE_SECONDS = 0.005;

/**
 * A use held to its file's `length` seconds: one that does not loop stops at the file's end; one that loops starts
 * again from the file's first second each time it gets there.
 */
export function useWithin(use: ClipSoundUse, length: number): ClipSoundUse[] {
  if (!(length > 0)) return [];
  if (!use.loop) {
    if (use.second >= length) return [];
    const dur = Math.min(use.dur, (length - use.second) / use.rate);
    return dur >= SHORTEST_PIECE_SECONDS ? [{ ...use, dur }] : [];
  }
  if (length < SHORTEST_LOOP_SECONDS) return [];
  const out: ClipSoundUse[] = [];
  let at: number = use.at;
  let second = use.second % length;
  let left = use.dur;
  while (left >= SHORTEST_PIECE_SECONDS) {
    const dur = Math.min(left, (length - second) / use.rate);
    if (dur >= SHORTEST_PIECE_SECONDS) out.push({ ...use, at: playSeconds(at), second, dur });
    at += dur;
    left -= dur;
    second = 0;
  }
  return out;
}

/** The samples of `buffer` from second `from`, `seconds` long, faded in and out at the ends. */
export function samplesOf(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'sampleRate' | 'length' | 'getChannelData'>, from: number, seconds: number): Float32Array[] {
  const start = Math.max(0, Math.min(buffer.length, Math.round(from * buffer.sampleRate)));
  const end = Math.max(start, Math.min(buffer.length, Math.round((from + seconds) * buffer.sampleRate)));
  const fade = Math.min(Math.round(PIECE_FADE_SECONDS * buffer.sampleRate), Math.floor((end - start) / 2));
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c).slice(start, end);
    for (let i = 0; i < fade; i++) {
      const level = i / fade;
      channel[i] = (channel[i] ?? 0) * level;
      const j = channel.length - 1 - i;
      channel[j] = (channel[j] ?? 0) * level;
    }
    out.push(channel);
  }
  return out;
}

/** Makes an audio buffer of channels at a sample rate. */
export type BufferMaker = (channels: readonly Float32Array[], sampleRate: number) => AudioBuffer;

export const audioBufferOf: BufferMaker = (channels, sampleRate) => {
  const length = Math.max(1, channels[0]?.length ?? 1);
  const buffer = new AudioBuffer({ length, numberOfChannels: Math.max(1, channels.length), sampleRate });
  channels.forEach((channel, c) => buffer.copyToChannel(new Float32Array(channel), c));
  return buffer;
};

export interface PlaceOptions {
  /** Each clip's gain, by its asset's name; 1 where none is given. */
  readonly gains?: ReadonlyMap<string, number>;
  readonly make?: BufferMaker;
}

/**
 * The footage of `uses` from the decoded `sounds` (by asset name): each use cut to its file, sped or slowed to its play
 * stretch at the file's pitch. A use whose file is missing is silent. Null when nothing is heard.
 */
export function placeFootage(uses: readonly ClipSoundUse[], sounds: ReadonlyMap<string, AudioBuffer>, options: PlaceOptions = {}): Footage | null {
  const make = options.make ?? audioBufferOf;
  const pieces: FootagePiece[] = [];
  let total = 0;
  let over = false;
  for (const use of uses) {
    const sound = sounds.get(use.name);
    if (sound === undefined) continue;
    for (const piece of useWithin(use, sound.duration)) {
      if (total + piece.dur > FOOTAGE_MOST_SECONDS) {
        over = true;
        continue;
      }
      const cut = samplesOf(sound, piece.second, piece.dur * piece.rate);
      const length = Math.max(1, Math.round(piece.dur * sound.sampleRate));
      const channels = stretchChannels(cut, piece.rate, sound.sampleRate, length);
      pieces.push({
        at: piece.at,
        dur: length / sound.sampleRate,
        buffer: make(channels, sound.sampleRate),
        gain: piece.level * (options.gains?.get(use.name) ?? 1),
      });
      total += piece.dur;
    }
  }
  if (over) console.warn(`video: the clips' sound plays ${FOOTAGE_MOST_SECONDS} s in all at most, so the rest is silent`);
  if (pieces.length === 0) return null;
  pieces.sort((first, second) => first.at - second.at);
  return { pieces, duck: duckEnvelope(pieces, FOOTAGE_DUCK_DB) };
}

/** The lower of two levels at every moment: the score under narration and footage at once. */
export function lowerOf(first: readonly DuckPoint[], second: readonly DuckPoint[]): DuckPoint[] {
  if (first.length === 0) return [...second];
  if (second.length === 0) return [...first];
  const times = [...new Set([...first, ...second].map((point) => point.t as number))].sort((a, b) => a - b);
  const points: DuckPoint[] = [];
  let before: { t: number; a: number; b: number } | null = null;
  for (const t of times) {
    const a = sampleEnvelope(first, t);
    const b = sampleEnvelope(second, t);
    // Where the two lines cross between points, the crossing is a point too.
    if (before !== null && (before.a - before.b) * (a - b) < 0) {
      const share = (before.a - before.b) / (before.a - before.b - (a - b));
      points.push({ t: playSeconds(before.t + (t - before.t) * share), v: before.a + (a - before.a) * share });
    }
    points.push({ t: playSeconds(t), v: Math.min(a, b) });
    before = { t, a, b };
  }
  return points;
}
