import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { clipSpeed, heardAtSpeed } from '@open-artifact/motion-core';
import { clipAttributes, clipClock, clipSecondAt, narrationOverlaps, playedClipSound } from '../src/runtime/clips.ts';
import type { SoundingClip } from '../src/runtime/clips.ts';
import { count, readFigure, writeFigure } from '../src/runtime/kit/count.ts';
import type { SceneClock } from '../src/runtime/recut.ts';
import { isClipSoundUse } from '../src/protocol/clip-guards.ts';
import { isStageToHost } from '../src/protocol/guards.ts';

const warnings: string[] = [];
const originalWarn = console.warn;
beforeEach(() => {
  warnings.length = 0;
  console.warn = (...parts: unknown[]): void => {
    warnings.push(parts.map(String).join(' '));
  };
});
afterEach(() => {
  console.warn = originalWarn;
});

/** Enough of a video element for the clip timing: its data attributes. */
function clip(attrs: Record<string, string>): HTMLVideoElement {
  return { getAttribute: (name: string) => attrs[name] ?? null } as unknown as HTMLVideoElement;
}

/** A scene clock of parts: [film start, film length, play start, play length]. */
function clockOf(parts: ReadonlyArray<[number, number, number, number]>): SceneClock {
  return {
    parts: parts.map(([a0, nat, p0, dur], i) => ({ key: 's' + i, label: 's' + i, own: 's' + i, a0, nat, p0, dur })),
  } as unknown as SceneClock;
}

const sounding = (over: Partial<SoundingClip> = {}): SoundingClip => ({ name: 'clip.mp4', level: 1, loop: false, start: 2, from: 10, speed: 1, lo: 2, hi: 6, ...over });

describe('a clip’s timing', () => {
  it('writes start, from, dur and speed, and holds speed to 0.25–4', () => {
    assert.deepEqual(clipAttributes({ start: 2, from: 10, dur: 4, speed: 2 }), { 'data-start': '2', 'data-from': '10', 'data-dur': '4', 'data-speed': '2' });
    assert.deepEqual(clipAttributes({}), { 'data-start': '0' });
    assert.equal(clipAttributes({ speed: 9 })['data-speed'], '4');
    assert.equal(clipAttributes({ speed: -1 })['data-speed'], undefined);
    assert.equal(warnings.length, 2);
    assert.equal(clipSpeed(0.1), 0.25);
    assert.equal(clipSpeed('x'), 1);
    assert.ok(heardAtSpeed(0.5) && heardAtSpeed(2) && !heardAtSpeed(0.25) && !heardAtSpeed(3));
  });

  it('shows second from + (t − start) × speed while its dur is on, and holds at the ends', () => {
    const video = clip({ 'data-start': '2', 'data-from': '10', 'data-dur': '4', 'data-speed': '2' });
    assert.deepEqual(clipSecondAt(video, 1), { second: 10, on: false });
    assert.deepEqual(clipSecondAt(video, 3), { second: 12, on: true });
    assert.deepEqual(clipSecondAt(video, 7), { second: 18, on: false });
    assert.deepEqual(clipSecondAt(clip({ 'data-start': '0' }), 5), { second: 5, on: true });
  });

  it('plays on a clock faster or slower by its speed', () => {
    const clock = { rate: 1, retimed: false } as never;
    assert.equal(clipClock(clip({ 'data-start': '0' }), clock), clock);
    const fast = clipClock(clip({ 'data-start': '0', 'data-speed': '2' }), clock) as unknown as { rate: number; retimed: boolean };
    assert.equal(fast.rate, 2);
    assert.equal(fast.retimed, true);
  });
});

describe('a clip’s sound on the play clock', () => {
  it('passes through an unretimed film as it is', () => {
    assert.deepEqual(playedClipSound([sounding()], clockOf([[0, 10, 0, 10]])), [{ name: 'clip.mp4', level: 1, loop: false, at: 2, dur: 4, second: 10, rate: 1 }]);
  });

  it('plays slower, from the right second, in a scene a person made longer', () => {
    // The first scene (0–4) plays over 8 s; the second (4–10) as it was, after it.
    const uses = playedClipSound([sounding({ hi: 6 })], clockOf([[0, 4, 0, 8], [4, 6, 8, 6]]));
    assert.deepEqual(uses, [
      { name: 'clip.mp4', level: 1, loop: false, at: 4, dur: 4, second: 10, rate: 0.5 },
      { name: 'clip.mp4', level: 1, loop: false, at: 8, dur: 2, second: 12, rate: 1 },
    ]);
  });

  it('is silent where its scene was cut, and sounds once where two uses are the same', () => {
    assert.deepEqual(playedClipSound([sounding()], clockOf([[6, 4, 0, 4]])), []);
    const twice = playedClipSound([sounding({ level: 0.4 }), sounding({ level: 0.8 })], clockOf([[0, 10, 0, 10]]));
    assert.equal(twice.length, 1);
    assert.equal(twice[0]?.level, 0.8);
  });
});

describe('narration and a clip’s sound', () => {
  it('says when a narration line plays seconds the clip’s own sound plays too', () => {
    const narration = { lines: [{ at: 0, dur: 2, audio: 'clip.mp4', from: 11 }, { at: 3, dur: 2, audio: 'clip.mp4', from: 30 }, { at: 6, dur: 1, audio: 'take.mp3' }] };
    const found = narrationOverlaps(narration, [sounding()]);
    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /narration line 1 .*heard twice/);
    assert.deepEqual(narrationOverlaps(narration, []), []);
    assert.deepEqual(narrationOverlaps(null, [sounding()]), []);
  });
});

describe('kit.count', () => {
  it('reads the one figure as written, or none', () => {
    assert.deepEqual(readFigure('$1,234.50 saved'), { before: '$', sign: '', group: ',', mark: '.', places: 2, after: ' saved', value: 1234.5, pad: 0 });
    assert.equal(readFigure('1.234.567')?.value, 1234567);
    assert.equal(readFigure('3,5 %')?.value, 3.5);
    assert.equal(readFigure('−40°')?.value, -40);
    for (const text of ['Q3 results', 'B2B', 'Top 10', '1st place', '3 of 4', 'no figure', '1234567890123456', '2026']) assert.equal(readFigure(text), null, text);
    assert.equal(readFigure('2026', true)?.value, 2026);
    assert.equal(readFigure('in 2026, sales'), null);
    assert.equal(readFigure('2026 users')?.value, 2026);
  });

  it('writes a value the way the figure is written, never "-0"', () => {
    const figure = readFigure('€1.234,50');
    assert.ok(figure !== null);
    assert.equal(writeFigure(figure, 617.25), '€617,25');
    assert.equal(writeFigure(figure, 1234.5), '€1.234,50');
    const signed = readFigure('-12');
    assert.ok(signed !== null);
    assert.equal(writeFigure(signed, -0.2), '0');
    assert.equal(writeFigure(readFigure('007') ?? signed, 3), '003');
  });

  it('counts up from half, then shows the words as written, and takes a retype', () => {
    const el = { textContent: '1,200 users', children: { length: 0 } } as unknown as Element;
    assert.equal(count(el, 0, 0, 1), '600 users');
    assert.equal(count(el, 1, 0, 1), '1,200 users');
    assert.equal(count(el, 0, 0, 1, { from: 0 }), '0 users');
    el.textContent = '50 people';
    assert.equal(count(el, 0, 0, 1), '25 people');
    assert.equal(count(el, 2, 0, 1), '50 people');
  });

  it('never writes into an element with children, nor a figure it cannot count', () => {
    const parent = { textContent: '1,200', children: { length: 1 } } as unknown as Element;
    assert.equal(count(parent, 0, 0, 1), '1,200');
    assert.equal(parent.textContent, '1,200');
    const label = { textContent: 'Q3', children: { length: 0 } } as unknown as Element;
    assert.equal(count(label, 0, 0, 1), 'Q3');
    const huge = { textContent: '999999999999999', children: { length: 0 } } as unknown as Element;
    assert.doesNotMatch(count(huge, 0.5, 0, 1, { from: Number.NaN }), /NaN|e\+/);
  });
});

describe('the ready message’s clips', () => {
  const meta = {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 4,
    filmDuration: 4,
    chapters: [],
    scenes: null,
    background: ['rgb(255, 255, 255)', 'none'],
    parts: [],
  };
  it('accepts a list of clip uses, and refuses a wrong one', () => {
    const use = { name: 'clip.mp4', level: 1, loop: false, at: 0, dur: 2, second: 10, rate: 1 };
    assert.ok(isClipSoundUse(use));
    assert.ok(!isClipSoundUse({ ...use, rate: 0 }));
    assert.ok(!isClipSoundUse({ ...use, level: 2 }));
    const ready = { type: 'ready', meta, score: null, narration: null, loadMs: 1 };
    assert.ok(isStageToHost({ ...ready, clips: [use] }));
    assert.ok(!isStageToHost({ ...ready, clips: [{ ...use, dur: -1 }] }));
    assert.ok(!isStageToHost({ ...ready, clips: 'clip.mp4' }));
  });
});
