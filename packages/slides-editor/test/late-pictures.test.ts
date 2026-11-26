import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  drawUntilStill,
  holdsInlinedPictures,
  SETTLE_LIMIT_MS,
  SETTLE_ROUND_MS,
  samePixels,
  settleBudget,
  type SettleClock,
} from '../src/lib/late-pictures.ts';

/** A clock that only moves when the redraw loop sleeps. */
function fakeClock(): SettleClock & { slept: number } {
  let time = 0;
  const clock = {
    slept: 0,
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
      clock.slept += 1;
    },
  };
  return clock;
}

describe('late pictures in exports', () => {
  it('only counts pictures inlined into the markup', () => {
    assert.equal(holdsInlinedPictures('<img src="data:image/png;base64,AAAA">'), true);
    assert.equal(holdsInlinedPictures('<div style="background-image:url(&quot;data:image/jpeg;base64,AA&quot;)"></div>'), true);
    assert.equal(holdsInlinedPictures('<img src="data:application/octet-stream;base64,AAAA">'), true);
    assert.equal(holdsInlinedPictures('<svg><image href="data:;base64,AAAA"/></svg>'), true);
    assert.equal(holdsInlinedPictures('<p>Plain text</p>'), false);
    assert.equal(holdsInlinedPictures('<p>Raw data: 42 rows</p>'), false);
    assert.equal(holdsInlinedPictures('<img src="https://example.com/a.png">'), false);
  });

  it('compares reads pixel by pixel', () => {
    assert.equal(samePixels(new Uint8ClampedArray([1, 2, 3, 4]), new Uint8ClampedArray([1, 2, 3, 4])), true);
    assert.equal(samePixels(new Uint8ClampedArray([1, 2, 3, 4]), new Uint8ClampedArray([1, 2, 3, 5])), false);
    assert.equal(samePixels(new Uint8ClampedArray([1, 2]), new Uint8ClampedArray([1, 2, 3, 4])), false);
  });

  it('redraws only slides with pictures, in browsers that draw them late', () => {
    assert.equal(settleBudget({ drawsLate: false, holdsPictures: true }), 0);
    assert.equal(settleBudget({ drawsLate: true, holdsPictures: false }), 0);
    assert.equal(settleBudget({ drawsLate: true, holdsPictures: true }), SETTLE_LIMIT_MS);
  });

  it('skips the redraws when the export is short of time', () => {
    assert.equal(settleBudget({ drawsLate: true, holdsPictures: true, timeLeft: 60_000 }), SETTLE_LIMIT_MS);
    assert.equal(settleBudget({ drawsLate: true, holdsPictures: true, timeLeft: 1500 }), 0);
    assert.equal(settleBudget({ drawsLate: true, holdsPictures: true, timeLeft: -10 }), 0);
  });

  it('keeps redrawing past blank reads until the picture holds still', async () => {
    const reads = [[0, 0], [0, 0], [9, 9], [9, 9], [9, 9], [1, 1]];
    let draws = 0;
    const clock = fakeClock();
    const settled = await drawUntilStill(() => new Uint8ClampedArray(reads[draws++]!), SETTLE_LIMIT_MS, clock);
    assert.equal(settled, true);
    assert.equal(draws, 5);
  });

  it('gives up when the time runs out', async () => {
    let draws = 0;
    const clock = fakeClock();
    const settled = await drawUntilStill(() => new Uint8ClampedArray([draws++]), SETTLE_LIMIT_MS, clock);
    assert.equal(settled, false);
    assert.equal(draws, SETTLE_LIMIT_MS / SETTLE_ROUND_MS);
  });
});
