import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { measureLines, rectWithin } from '../src/lib/measure.ts';

const lines = (from: Parameters<typeof measureLines>[0], to: Parameters<typeof measureLines>[1]) =>
  measureLines(from, to).map(({ axis, x1, y1, x2, y2, length }) => `${axis} ${x1},${y1}→${x2},${y2} ${length}`);

describe('Alt distances', () => {
  it('measures the gap to an object beside or below, at the height they share', () => {
    assert.deepEqual(lines({ x: 0, y: 0, w: 100, h: 100 }, { x: 140, y: 50, w: 100, h: 100 }), ['x 100,75→140,75 40']);
    assert.deepEqual(lines({ x: 0, y: 0, w: 100, h: 100 }, { x: 20, y: 130, w: 50, h: 10 }), ['y 45,100→45,130 30']);
    assert.deepEqual(lines({ x: 200, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 150, h: 100 }), ['x 150,50→200,50 50']);
  });

  it('measures both axes to an object off at a corner, from the middle of the selection', () => {
    assert.deepEqual(lines({ x: 0, y: 0, w: 100, h: 100 }, { x: 150, y: 120, w: 10, h: 10 }), ['x 100,50→150,50 50', 'y 50,100→50,120 20']);
  });

  it('measures to every edge of an object that holds the selection', () => {
    assert.deepEqual(lines({ x: 10, y: 20, w: 30, h: 40 }, { x: 0, y: 0, w: 100, h: 100 }), [
      'x 0,40→10,40 10',
      'x 40,40→100,40 60',
      'y 25,0→25,20 20',
      'y 25,60→25,100 40',
    ]);
  });

  it('leaves out lines that are zero long and partial overlaps', () => {
    assert.deepEqual(lines({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 }), []);
    assert.deepEqual(lines({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 }), []);
  });

  it('knows when one rect lies within another', () => {
    const outer = { x: 0, y: 0, w: 100, h: 100 };
    assert.equal(rectWithin({ x: 10, y: 10, w: 20, h: 20 }, outer), true);
    assert.equal(rectWithin(outer, outer), true);
    assert.equal(rectWithin({ x: 90, y: 10, w: 20, h: 20 }, outer), false);
    assert.equal(rectWithin({ x: -1, y: 10, w: 20, h: 20 }, outer), false);
  });
});
