import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { holdHandle, isHandlePress, moveHandle, pressedWidth } from '../src/lib/panel-width.ts';

const presets = { home: 300, min: 280, max: 520, dragged: null };

describe('pressing the panel handle', () => {
  it('goes from the default to the widest, the narrowest and back', () => {
    assert.equal(pressedWidth(300, presets), 520);
    assert.equal(pressedWidth(520, presets), 280);
    assert.equal(pressedWidth(280, presets), 300);
  });

  it('takes in the last dragged width after the narrowest', () => {
    const withDrag = { ...presets, dragged: 410 };
    assert.equal(pressedWidth(280, withDrag), 410);
    assert.equal(pressedWidth(410, withDrag), 300);
  });

  it('keeps a dragged width inside the limits and skips it when it is a preset already', () => {
    assert.equal(pressedWidth(280, { ...presets, dragged: 900 }), 300);
    assert.equal(pressedWidth(280, { ...presets, dragged: 300 }), 300);
  });

  it('goes to the widest from a width off the round', () => {
    assert.equal(pressedWidth(333, presets), 520);
  });

  it('copes with a window so narrow that the presets meet', () => {
    const squeezed = { home: 280, min: 280, max: 280, dragged: null };
    assert.equal(pressedWidth(280, squeezed), 280);
  });
});

describe('a pointer held on the panel handle', () => {
  it('resizes only past a few pixels along the axis', () => {
    const held = holdHandle(100, 50);
    assert.equal(moveHandle(held, 103, 50).dragging, false);
    assert.equal(moveHandle(held, 96, 50).dragging, true);
  });

  it('is a press while it neither drags nor wanders off across the axis', () => {
    const held = holdHandle(100, 50);
    assert.equal(isHandlePress(moveHandle(held, 102, 57)), true);
    assert.equal(isHandlePress(moveHandle(held, 100, 60)), false);
    assert.equal(isHandlePress(moveHandle(held, 110, 50)), false);
  });

  it('stays a drag once it started, even back where it began', () => {
    const moved = moveHandle(moveHandle(holdHandle(100, 50), 120, 50), 100, 50);
    assert.equal(moved.dragging, true);
    assert.equal(isHandlePress(moved), false);
  });
});
