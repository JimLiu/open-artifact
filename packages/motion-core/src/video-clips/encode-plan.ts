import { MAX_VIDEO_UPLOAD_BYTES } from '../clip-sound.ts';

/** What a video added on the page is converted to before it is stored. */
export interface VideoEncodePlan {
  width: number;
  height: number;
  /** Bits per second of the picture. */
  bitrate: number;
  fps: number;
  audioBitrate: number;
}

/** The size a conversion aims at, under the upload limit with room for the container. */
export const VIDEO_ENCODE_TARGET_BYTES = Math.floor(MAX_VIDEO_UPLOAD_BYTES * 0.92);
export const VIDEO_ENCODE_AUDIO_BITRATE = 128_000;
export const VIDEO_ENCODE_MAX_FPS = 30;
/** Tries before a part is called too long to store. */
export const VIDEO_ENCODE_ATTEMPTS = 3;

/** Short sides the picture is brought down to, each with the bitrates it is given. */
const SIZES: ReadonlyArray<{ side: number; low: number; high: number }> = [
  { side: 1080, low: 4_000_000, high: 6_000_000 },
  { side: 720, low: 2_000_000, high: 4_000_000 },
  { side: 480, low: 1_000_000, high: 2_000_000 },
];
const FLOOR_BITRATE = 400_000;

const even = (value: number): number => Math.max(2, 2 * Math.round(value / 2));

/**
 * How to convert `seconds` of a `width` × `height` video so the file fits: the largest size whose lowest bitrate
 * the byte budget pays for, at no more than 30 frames a second. Each later `attempt` (from 0) aims smaller; `null`
 * past the last.
 */
export function videoEncodePlan(source: { width: number; height: number; fps: number | null }, seconds: number, attempt: number): VideoEncodePlan | null {
  if (attempt >= VIDEO_ENCODE_ATTEMPTS || !(seconds > 0) || !(source.width > 0 && source.height > 0)) return null;
  const budget = (VIDEO_ENCODE_TARGET_BYTES * 0.8 ** attempt * 8) / seconds - VIDEO_ENCODE_AUDIO_BITRATE;
  const short = Math.min(source.width, source.height);
  const fitting = SIZES.filter((size) => size.side <= short || size === SIZES[SIZES.length - 1]);
  const sizes = fitting.length > 0 ? fitting : SIZES.slice(-1);
  const size = sizes.slice(attempt).find((candidate) => budget >= candidate.low) ?? sizes[sizes.length - 1]!;
  const side = Math.min(short, size.side);
  const scale = side / short;
  return {
    width: even(source.width * scale),
    height: even(source.height * scale),
    bitrate: Math.round(Math.max(FLOOR_BITRATE, Math.min(size.high, budget))),
    fps: Math.min(VIDEO_ENCODE_MAX_FPS, source.fps !== null && source.fps > 0 ? source.fps : VIDEO_ENCODE_MAX_FPS),
    audioBitrate: VIDEO_ENCODE_AUDIO_BITRATE,
  };
}
