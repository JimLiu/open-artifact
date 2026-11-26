import type { ClipSoundUse } from '@open-artifact/motion-core';
import { loudnessGain, measureIntegratedLoudness } from '../loudness.ts';
import type { PcmSource } from '../loudness.ts';
import type { TakeDecoder } from '../narration/decode.ts';
import { FOOTAGE_LOUDNESS, FOOTAGE_MOST_BOOST_DB, placeFootage } from './footage.ts';
import type { BufferMaker, Footage } from './footage.ts';

/** A clip's file larger than this is not decoded for its sound. */
export const MOST_FOOTAGE_FILE_BYTES = 64 * 1024 * 1024;
/** A clip's sound longer than this, decoded, is not played. */
export const MOST_FOOTAGE_FILE_SECONDS = 1800;
/** A clip's loudness is measured on this much of its sound at most. */
const MEASURE_SECONDS = 120;

export interface FootageOptions {
  /** False once the film has moved on, so a stale decode stops early. */
  readonly isCurrent?: () => boolean;
  readonly decoder?: TakeDecoder | null;
  readonly make?: BufferMaker;
}

/** What a decoded file's sound comes to, kept by its name and size so a reload of the same file is not decoded again. */
interface Decoded {
  readonly buffer: AudioBuffer | null;
  readonly gain: number;
}

const decodedFiles = new Map<string, Decoded>();
/** Decoded files kept, newest last. */
const FILES_KEPT = 8;
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function defaultDecoder(): TakeDecoder | null {
  return typeof OfflineAudioContext === 'undefined' ? null : new OfflineAudioContext(1, 1, 48000);
}

/** The first `seconds` of a buffer, as the meter reads it. */
function firstOf(buffer: PcmSource, seconds: number): PcmSource {
  const length = Math.min(buffer.length, Math.round(seconds * buffer.sampleRate));
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    length,
    getChannelData: (channel) => buffer.getChannelData(channel).subarray(0, length),
  };
}

/** The gain that brings a clip's sound towards the footage loudness, raising a quiet one only so far. */
export function footageGain(buffer: PcmSource): number {
  const measured = measureIntegratedLoudness(firstOf(buffer, MEASURE_SECONDS));
  if (!Number.isFinite(measured.lufs)) return 1;
  return Math.min(loudnessGain(measured, FOOTAGE_LOUDNESS), Math.pow(10, FOOTAGE_MOST_BOOST_DB / 20));
}

async function decodeFile(name: string, bytes: ArrayBuffer, decoder: TakeDecoder): Promise<Decoded> {
  const key = `${name}\n${bytes.byteLength}`;
  const kept = decodedFiles.get(key);
  if (kept !== undefined) return kept;
  let decoded: Decoded = { buffer: null, gain: 1 };
  if (bytes.byteLength > MOST_FOOTAGE_FILE_BYTES) {
    warnOnce(`big:${name}`, `video "${name}": the file is too large to play its sound`);
  } else {
    const buffer = await decoder.decodeAudioData(bytes.slice(0)).catch((): null => null);
    if (buffer === null || buffer.length === 0) warnOnce(`none:${name}`, `video "${name}": the file has no sound to play`);
    else if (buffer.duration > MOST_FOOTAGE_FILE_SECONDS) warnOnce(`long:${name}`, `video "${name}": the file's sound is too long to play`);
    else decoded = { buffer, gain: footageGain(buffer) };
  }
  decodedFiles.set(key, decoded);
  for (const oldest of decodedFiles.keys()) {
    if (decodedFiles.size <= FILES_KEPT) break;
    decodedFiles.delete(oldest);
  }
  return decoded;
}

/**
 * Decodes the files the sounding clips name, once each, and cuts their footage. `bytesOf` gives a file's bytes by its
 * asset name, or null where there are none. Null when nothing is heard, or when the film moved on meanwhile.
 */
export async function loadFootage(
  uses: readonly ClipSoundUse[],
  bytesOf: (name: string) => Promise<ArrayBuffer | null>,
  options: FootageOptions = {},
): Promise<Footage | null> {
  if (uses.length === 0) return null;
  const decoder = options.decoder === undefined ? defaultDecoder() : options.decoder;
  if (decoder === null) return null;
  const isCurrent = options.isCurrent ?? (() => true);
  const names = [...new Set(uses.map((use) => use.name))];
  const sounds = new Map<string, AudioBuffer>();
  const gains = new Map<string, number>();
  for (const name of names) {
    if (!isCurrent()) return null;
    const bytes = await bytesOf(name).catch((): null => null);
    if (bytes === null) continue;
    const decoded = await decodeFile(name, bytes, decoder);
    if (decoded.buffer === null) continue;
    sounds.set(name, decoded.buffer);
    gains.set(name, decoded.gain);
  }
  if (!isCurrent() || sounds.size === 0) return null;
  return placeFootage(uses, sounds, { gains, ...(options.make ? { make: options.make } : {}) });
}
