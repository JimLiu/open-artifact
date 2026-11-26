import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pinnedAxes, shiftDragDelta } from '../src/lib/drag-axis.ts';

describe('shift drag directions', () => {
  it('keeps a mostly level or upright drag on its axis', () => {
    assert.deepEqual(shiftDragDelta(100, 30), { x: 100, y: 0 });
    assert.deepEqual(shiftDragDelta(-20, 90), { x: 0, y: 90 });
  });
  it('puts a slanted drag on the nearest diagonal', () => {
    assert.deepEqual(shiftDragDelta(100, 80), { x: 90, y: 90 });
    assert.deepEqual(shiftDragDelta(100, -60), { x: 80, y: -80 });
    assert.deepEqual(shiftDragDelta(-50, -50), { x: -50, y: -50 });
  });
});

describe('pinned axes', () => {
  it('holds an element set from both sides', () => {
    assert.deepEqual(pinnedAxes({ left: '0', right: '0', top: '10px' }), { x: true, y: false });
    assert.deepEqual(pinnedAxes({ top: '0', bottom: '4px' }), { x: false, y: true });
    assert.deepEqual(pinnedAxes({ left: '0', right: 'auto' }), { x: false, y: false });
  });
});
