import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { staysTap, TOUCH_TAP_SLOP } from '../src/lib/touch.ts';

describe('touch tap slop', () => {
  it('keeps a wobbling finger a tap and turns a real move into a pan', () => {
    const start = { x: 100, y: 100 };
    assert.equal(staysTap(start, start), true);
    assert.equal(staysTap(start, { x: 105, y: 104 }), true);
    assert.equal(staysTap(start, { x: 100 + TOUCH_TAP_SLOP, y: 100 }), true);
    assert.equal(staysTap(start, { x: 107, y: 107 }), false);
    assert.equal(staysTap(start, { x: 80, y: 100 }), false);
  });
});
