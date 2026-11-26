import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { playSeconds } from '@open-artifact/motion-core';
import type { ClipSoundUse } from '@open-artifact/motion-core';
import { FOOTAGE_DUCK_DB, lowerOf, placeFootage, samplesOf, useWithin } from '../src/clips/footage.ts';
import type { BufferMaker } from '../src/clips/footage.ts';
import { footageGain, loadFootage } from '../src/clips/load.ts';
import { stretchChannels } from '../src/clips/stretch.ts';
import { sampleEnvelope } from '../src/narration/duck.ts';

const RATE = 8000;

/** Enough of an AudioBuffer: its channels, length and rate. */
function fakeBuffer(channels: Float32Array[], sampleRate = RATE): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    duration: length / sampleRate,
    length,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel] ?? new Float32Array(length),
  } as unknown as AudioBuffer;
}

const make: BufferMaker = (channels, sampleRate) => fakeBuffer(channels.map((channel) => new Float32Array(channel)), sampleRate);

function tone(seconds: number, hz: number, level = 0.5, sampleRate = RATE): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_unused, i) => level * Math.sin((2 * Math.PI * hz * i) / sampleRate));
}

/** Upward zero crossings per second over the middle of the samples: a tone's pitch. */
function pitch(samples: Float32Array, sampleRate = RATE): number {
  const from = Math.floor(samples.length / 4);
  const to = Math.floor((samples.length * 3) / 4);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if ((samples[i - 1] ?? 0) < 0 && (samples[i] ?? 0) >= 0) crossings++;
  return crossings / ((to - from) / sampleRate);
}

const use = (over: Partial<ClipSoundUse> = {}): ClipSoundUse => ({ name: 'clip.mp4', level: 1, loop: false, at: playSeconds(1), dur: 2, second: 0, rate: 1, ...over });

describe('a clip’s sound held to its file', () => {
  it('stops at the file’s end, or starts again from its first second when it loops', () => {
    assert.deepEqual(useWithin(use({ second: 3 }), 4), [use({ second: 3, dur: 1 })]);
    assert.deepEqual(useWithin(use({ second: 5 }), 4), []);
    const looped = useWithin(use({ loop: true, second: 3, dur: 3 }), 2);
    assert.deepEqual(
      looped.map((piece) => [piece.at, piece.second, piece.dur]),
      [
        [1, 1, 1],
        [2, 0, 2],
      ],
    );
    assert.deepEqual(useWithin(use({ loop: true }), 0.2), []);
  });

  it('counts the file in its own seconds at a rate other than 1', () => {
    assert.deepEqual(useWithin(use({ second: 2, rate: 2, dur: 5 }), 4), [use({ second: 2, rate: 2, dur: 1 })]);
  });
});

describe('cutting and stretching', () => {
  it('cuts samples with short fades at both ends', () => {
    const buffer = fakeBuffer([new Float32Array(RATE).fill(1)]);
    const [cut] = samplesOf(buffer, 0.25, 0.5);
    assert.ok(cut !== undefined);
    assert.equal(cut.length, RATE / 2);
    assert.equal(cut[0], 0);
    assert.equal(cut[cut.length / 2], 1);
    assert.ok((cut[cut.length - 1] ?? 1) < 0.05);
  });

  it('makes a sound shorter or longer at the same pitch', () => {
    const source = tone(1, 440);
    for (const rate of [0.5, 2]) {
      const [out] = stretchChannels([source], rate, RATE);
      assert.ok(out !== undefined);
      assert.equal(out.length, Math.round(RATE / rate));
      assert.ok(Math.abs(pitch(out) - 440) < 25, `pitch at rate ${rate}: ${pitch(out)}`);
    }
  });

  it('keeps every channel to the same grains', () => {
    const left = tone(0.5, 300);
    const [a, b] = stretchChannels([left, left.slice()], 1.5, RATE);
    assert.deepEqual(a, b);
  });
});

describe('placing footage', () => {
  it('cuts each use from its file, loudness gain times level, and ducks the score under it', () => {
    const sounds = new Map([['clip.mp4', fakeBuffer([tone(4, 220)])]]);
    const footage = placeFootage([use({ level: 0.5, second: 1 })], sounds, { gains: new Map([['clip.mp4', 2]]), make });
    assert.ok(footage !== null);
    assert.equal(footage.pieces.length, 1);
    const [piece] = footage.pieces;
    assert.equal(piece?.at, 1);
    assert.equal(piece?.gain, 1);
    assert.ok(Math.abs((piece?.buffer.duration ?? 0) - 2) < 1e-3);
    const low = Math.pow(10, FOOTAGE_DUCK_DB / 20);
    assert.ok(Math.abs(sampleEnvelope(footage.duck, 2) - low) < 1e-9);
    assert.equal(sampleEnvelope(footage.duck, 10), 1);
  });

  it('is null when no file is there', () => {
    assert.equal(placeFootage([use()], new Map(), { make }), null);
  });

  it('keeps the score at the lower level where narration and footage meet', () => {
    const a = [
      { t: playSeconds(0), v: 1 },
      { t: playSeconds(2), v: 0.2 },
    ];
    const b = [
      { t: playSeconds(0), v: 0.5 },
      { t: playSeconds(2), v: 0.5 },
    ];
    const lower = lowerOf(a, b);
    for (const t of [0, 0.5, 1, 1.5, 2]) assert.ok(Math.abs(sampleEnvelope(lower, t) - Math.min(sampleEnvelope(a, t), sampleEnvelope(b, t))) < 1e-9, String(t));
    assert.deepEqual(lowerOf([], b), b);
  });
});

describe('loading footage', () => {
  it('decodes each file once, and is silent for a file with no sound', async () => {
    let decodes = 0;
    const decoder = {
      decodeAudioData: async (bytes: ArrayBuffer): Promise<AudioBuffer> => {
        decodes++;
        if (bytes.byteLength === 1) throw new Error('no audio track');
        return fakeBuffer([tone(3, 220)]);
      },
    };
    const files = new Map([
      ['a.mp4', new ArrayBuffer(8)],
      ['mute.mp4', new ArrayBuffer(1)],
    ]);
    const bytesOf = async (name: string): Promise<ArrayBuffer | null> => files.get(name) ?? null;
    const uses = [use({ name: 'a.mp4' }), use({ name: 'a.mp4', at: playSeconds(5) }), use({ name: 'mute.mp4' }), use({ name: 'gone.mp4' })];
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...parts: unknown[]): void => void warned.push(parts.map(String).join(' '));
    try {
      const footage = await loadFootage(uses, bytesOf, { decoder, make });
      assert.equal(footage?.pieces.length, 2);
      assert.equal(decodes, 2);
      await loadFootage(uses, bytesOf, { decoder, make });
      assert.equal(decodes, 2);
      assert.equal(warned.filter((line) => line.includes('mute.mp4')).length, 1);
      assert.equal(await loadFootage(uses, bytesOf, { decoder, make, isCurrent: () => false }), null);
    } finally {
      console.warn = warn;
    }
  });

  it('raises a quiet clip by 10 dB at most', () => {
    assert.ok(Math.abs(footageGain(fakeBuffer([tone(2, 1000, 0.001)])) - Math.pow(10, 10 / 20)) < 1e-6);
    assert.equal(footageGain(fakeBuffer([new Float32Array(RATE)])), 1);
  });
});

describe('playing footage in a session', () => {
  /** An automated parameter that records its events. */
  class Param {
    value = 1;
    readonly events: Array<[string, number, number]> = [];
    setValueAtTime(v: number, t: number): void {
      this.events.push(['set', v, t]);
    }
    linearRampToValueAtTime(v: number, t: number): void {
      this.events.push(['ramp', v, t]);
    }
    cancelScheduledValues(t: number): void {
      this.events.push(['cancel', 0, t]);
    }
  }
  class Node extends EventTarget {
    readonly gain = new Param();
    readonly playbackRate = new Param();
    buffer: AudioBuffer | null = null;
    onended: (() => void) | null = null;
    started: [number, number] | null = null;
    connect(node: unknown): unknown {
      return node;
    }
    disconnect(): void {}
    start(when: number, offset: number): void {
      this.started = [when, offset];
    }
    stop(): void {}
  }
  const sources: Node[] = [];
  const context = {
    currentTime: 0,
    sampleRate: RATE,
    createGain: () => new Node(),
    createBufferSource: () => {
      const source = new Node();
      sources.push(source);
      return source;
    },
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({ ...fakeBuffer([new Float32Array(length)], sampleRate), copyToChannel: () => undefined }),
  };

  it('starts each piece from where playback is, at the pass’s rate, and ducks the score under it', async () => {
    const { createScoreSession } = await import('../src/session.ts');
    const piece = (at: number) => ({ at: playSeconds(at), dur: 2, buffer: fakeBuffer([new Float32Array(2 * RATE)]), gain: 0.5 });
    const footage = { pieces: [piece(1), piece(10)], duck: [{ t: playSeconds(0.75), v: 1 }, { t: playSeconds(1), v: 0.2 }, { t: playSeconds(3), v: 0.2 }, { t: playSeconds(3.5), v: 1 }] };
    const duck = new Node();
    const master = { context, duck, speech: new Node(), input: new Node(), reverbInput: new Node() } as never;
    const session = createScoreSession(master, { master: { gain: 0, fadeOut: 0 }, speech: null, footage, duration: playSeconds(20), origin: 0, rate: 2 });
    session.speak(playSeconds(2));
    assert.equal(sources.length, 2);
    assert.deepEqual(sources[0]?.started, [1, 1]);
    assert.equal(sources[0]?.playbackRate.value, 2);
    assert.deepEqual(sources[1]?.started, [5, 0]);
    assert.ok(duck.gain.events.some(([kind, v]) => kind === 'set' && Math.abs(v - 0.2) < 1e-9));
    assert.ok(duck.gain.events.some(([kind, v, t]) => kind === 'ramp' && v === 1 && t === 1.75));
  });
});
