/**
 * Plays sound faster or slower at its own pitch: short windowed grains are taken from the input at the new pace and
 * laid down overlapping by half, each grain moved a few milliseconds to where it best continues the one before
 * (waveform-similarity overlap-add). Good for speech and most footage from half to twice the speed.
 */

/** Grain length in seconds. */
const GRAIN_SECONDS = 0.03;
/** How far a grain may move to fit, in seconds, each way. */
const SEEK_SECONDS = 0.008;
/** The coarse fit compares every this many samples. */
const COARSE = 4;

/** A periodic Hann window: two of them half a window apart add up to exactly 1. */
function hann(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
  return window;
}

/** The sum of the samples of `a` from `i` and `b` from `j`, every `step`, over `count` samples. */
function likeness(a: Float32Array, i: number, b: Float32Array, j: number, count: number, step: number): number {
  let sum = 0;
  for (let k = 0; k < count; k += step) sum += (a[i + k] ?? 0) * (b[j + k] ?? 0);
  return sum;
}

/** The input position near `aim` (within ±seek, inside [0, last]) whose next `count` samples are most like those at `follow`. */
function bestFit(mono: Float32Array, aim: number, follow: number, count: number, seek: number, last: number): number {
  const lo = Math.max(0, aim - seek);
  const hi = Math.min(last, aim + seek);
  if (hi <= lo) return Math.max(0, Math.min(last, aim));
  let best = Math.max(0, Math.min(last, aim));
  let score = -Infinity;
  for (let at = lo; at <= hi; at += COARSE) {
    const s = likeness(mono, at, mono, follow, count, COARSE);
    if (s > score) {
      score = s;
      best = at;
    }
  }
  const near = best;
  for (let at = Math.max(lo, near - COARSE + 1); at <= Math.min(hi, near + COARSE - 1); at++) {
    const s = likeness(mono, at, mono, follow, count, 2);
    if (s > score) {
      score = s;
      best = at;
    }
  }
  return best;
}

/**
 * The channels played `rate` times as fast (2: twice as fast, half as long) at the same pitch, `length` samples long
 * (by default the input's length over the rate). The same grains are taken from every channel, so stereo stays whole.
 */
export function stretchChannels(channels: readonly Float32Array[], rate: number, sampleRate: number, length?: number): Float32Array[] {
  const input = channels[0]?.length ?? 0;
  const outLength = Math.max(0, Math.round(length ?? input / rate));
  if (Math.abs(rate - 1) < 1e-6 || input === 0) {
    return channels.map((channel) => {
      const out = new Float32Array(outLength);
      out.set(channel.subarray(0, Math.min(outLength, channel.length)));
      return out;
    });
  }
  const grain = Math.max(8, Math.round((GRAIN_SECONDS * sampleRate) / 2) * 2);
  const hop = grain / 2;
  const seek = Math.round(SEEK_SECONDS * sampleRate);
  const window = hann(grain);
  const mono = new Float32Array(input);
  for (const channel of channels) for (let i = 0; i < input; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / channels.length;
  const outs = channels.map(() => new Float32Array(outLength));
  const last = Math.max(0, input - grain);
  let previous = 0;
  for (let k = 0; k * hop < outLength; k++) {
    const aim = Math.round(k * hop * rate);
    // The first grain starts where the sound does; each later one fits onto what the one before would have played next.
    const from = k === 0 ? 0 : bestFit(mono, aim, Math.min(last, previous + hop), hop, seek, last);
    previous = from;
    const to = k * hop;
    outs.forEach((out, c) => {
      const channel = channels[c] ?? mono;
      for (let i = 0; i < grain && to + i < outLength; i++) out[to + i] = (out[to + i] ?? 0) + (channel[from + i] ?? 0) * (window[i] ?? 0);
    });
  }
  return outs;
}
