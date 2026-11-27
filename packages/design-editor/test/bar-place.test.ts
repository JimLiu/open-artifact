import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barLeft, barLimit } from '../src/lib/bar-place.ts';

describe('where the selection bar stands', () => {
  it('centres over the selection', () => {
    assert.equal(barLeft({ left: 300, width: 200 }, 100, 1000), 350);
  });

  it('stays inside the room on both sides', () => {
    // Near the right edge: its right side keeps the margin.
    assert.equal(barLeft({ left: 900, width: 200 }, 300, 1000), 692);
    // Near the left edge, or past it.
    assert.equal(barLeft({ left: -200, width: 100 }, 300, 1000), 8);
  });

  it('holds a strip wider than the room to the room, from the left margin', () => {
    assert.equal(barLimit(360), 344);
    assert.equal(barLeft({ left: 200, width: 50 }, 344, 360), 8);
    assert.equal(barLeft({ left: 200, width: 50 }, 500, 360), 8);
    assert.equal(barLimit(10), 0);
  });
});
