import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nearEdge, scrollsToward, swipeStep } from '../src/lib/swipe.ts';

describe('artboard swipe', () => {
  it('pages on a quick, mostly sideways move', () => {
    assert.equal(swipeStep(-80, 10, 200), 1);
    assert.equal(swipeStep(80, -10, 200), -1);
    assert.equal(swipeStep(-30, 0, 200), 0, 'too short');
    assert.equal(swipeStep(-80, 70, 200), 0, 'too steep');
    assert.equal(swipeStep(-80, 0, 900), 0, 'too slow');
  });

  it('leaves touches at the screen edges alone', () => {
    assert.equal(nearEdge(10, 400), true);
    assert.equal(nearEdge(390, 400), true);
    assert.equal(nearEdge(200, 400), false);
  });

  it('lets a box that can still scroll that way take the swipe', () => {
    const start = { scrollLeft: 0, scrollWidth: 600, clientWidth: 300 };
    const end = { scrollLeft: 300, scrollWidth: 600, clientWidth: 300 };
    assert.equal(scrollsToward(start, 1), true);
    assert.equal(scrollsToward(start, -1), false);
    assert.equal(scrollsToward(end, 1), false);
    assert.equal(scrollsToward(end, -1), true);
    assert.equal(scrollsToward({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }, 1), false);
  });

  it('reads right-to-left boxes from the right', () => {
    const start = { scrollLeft: 0, scrollWidth: 600, clientWidth: 300 };
    const end = { scrollLeft: -300, scrollWidth: 600, clientWidth: 300 };
    assert.equal(scrollsToward(start, -1, true), true);
    assert.equal(scrollsToward(start, 1, true), false);
    assert.equal(scrollsToward(end, 1, true), true);
    assert.equal(scrollsToward(end, -1, true), false);
  });
});
