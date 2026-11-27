import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitWithinLimit, hasLowerStep, lowerStep, OverLimit, projectedBytes, type StepTry } from '../src/services/export/budget.ts';
import { ExportNotes } from '../src/services/export/notes.ts';

const MB = 1024 * 1024;
const ladder = [{ scale: 2 }, { scale: 1.5 }, { scale: 1 }];

describe('stepping an export down to fit the download limit', () => {
  it('takes the sharpest lower step whose estimate fits', () => {
    // 300 MB at 2×: 1.5× is about 169 MB, under 200.
    assert.equal(lowerStep(ladder, 0, 300 * MB, 200 * MB), 1);
    // 500 MB at 2×: 1.5× is about 281 MB, 1× about 125 MB.
    assert.equal(lowerStep(ladder, 0, 500 * MB, 200 * MB), 2);
    // 260 MB at 1.5×: 1× is about 116 MB.
    assert.equal(lowerStep(ladder, 1, 260 * MB, 200 * MB), 2);
  });

  it('falls back to the lowest step when no estimate fits', () => {
    assert.equal(lowerStep(ladder, 0, 2000 * MB, 200 * MB), 2);
  });

  it('has nothing below the lowest step', () => {
    assert.equal(lowerStep(ladder, 2, 300 * MB, 200 * MB), undefined);
    assert.equal(hasLowerStep(ladder, 2), false);
    assert.equal(hasLowerStep(ladder, 1), true);
  });

  it('goes from pictures as they are to the sharpest step', () => {
    assert.equal(lowerStep(ladder, null, 2000 * MB, 200 * MB), 0);
    assert.equal(hasLowerStep(ladder, null), true);
    assert.equal(hasLowerStep([], null), false);
  });

  it('uses the given exponent for the estimate', () => {
    // Linear: 300 MB at 2× is 225 MB at 1.5×, too much; 150 MB at 1×.
    assert.equal(lowerStep(ladder, 0, 300 * MB, 200 * MB, 1), 2);
  });

  it('projects the whole file from the slides written so far', () => {
    assert.equal(projectedBytes(100, 2, 10), 500);
    assert.equal(projectedBytes(100, 10, 10), 100);
    assert.equal(projectedBytes(100, 0, 10), 100);
  });

  it('carries the estimate and the limit on the stop', () => {
    const stop = new OverLimit(300, 200);
    assert.ok(stop instanceof Error);
    assert.equal(stop.projected, 300);
    assert.equal(stop.limit, 200);
  });

  it('lists the smaller-pictures note first', () => {
    const notes = new ExportNotes();
    notes.add('hidden', 2);
    notes.add('picturesReduced');
    assert.deepEqual(notes.list(), ['Pictures were made smaller so the file fits the 200 MB download limit.', 'Hidden slides were left out (slide 2).']);
  });
});

describe('making a file that fits the download limit', () => {
  /** A maker that passes the limit at the steps in `over`, with the estimate given there. */
  function maker(over: Map<number | null, number>) {
    const tries: StepTry[] = [];
    const make = async (at: StepTry): Promise<string> => {
      tries.push(at);
      const projected = over.get(at.step);
      if (projected !== undefined && at.canStepDown) throw new OverLimit(projected, 200 * MB);
      return `file at ${at.step}`;
    };
    return { tries, make };
  }

  it('makes the file once when it fits', async () => {
    const { tries, make } = maker(new Map());
    let retries = 0;
    assert.equal(await fitWithinLimit(ladder, null, make, () => (retries += 1)), 'file at null');
    assert.deepEqual(tries, [{ step: null, canStepDown: true, steppedDown: false }]);
    assert.equal(retries, 0);
  });

  it('steps from pictures as they are to the step the estimate picks', async () => {
    // Too big as they are; at 2× it is 500 MB, so 1.5× (about 281 MB) is skipped for 1×.
    const { tries, make } = maker(new Map<number | null, number>([[null, 900 * MB], [0, 500 * MB]]));
    let retries = 0;
    assert.equal(await fitWithinLimit(ladder, null, make, () => (retries += 1)), 'file at 2');
    assert.deepEqual(
      tries.map((at) => [at.step, at.steppedDown]),
      [[null, false], [0, true], [2, true]],
    );
    assert.equal(retries, 2);
  });

  it('may not stop at the lowest step', async () => {
    const { tries, make } = maker(new Map<number | null, number>([[0, 260 * MB], [1, 260 * MB], [2, 260 * MB]]));
    assert.equal(await fitWithinLimit(ladder, 0, make), 'file at 2');
    assert.deepEqual(
      tries.map((at) => [at.step, at.canStepDown]),
      [[0, true], [1, true], [2, false]],
    );
  });

  it('passes on any other failure without stepping down', async () => {
    let tries = 0;
    let retries = 0;
    const make = async (): Promise<string> => {
      tries += 1;
      throw new Error('capture failed');
    };
    await assert.rejects(fitWithinLimit(ladder, null, make, () => (retries += 1)), /capture failed/);
    assert.equal(tries, 1);
    assert.equal(retries, 0);
  });
});
