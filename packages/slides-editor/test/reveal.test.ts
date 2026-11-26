import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { caretRoom, insetBox, overlaps, revealOffset } from '../src/lib/reveal.ts';

const view = { left: 0, top: 100, right: 1000, bottom: 600 };
const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

describe('scrolling something into view', () => {
  it('stays put when the target already shows', () => {
    assert.deepEqual(revealOffset(view, box(100, 200, 200, 100)), { x: 0, y: 0 });
    assert.deepEqual(revealOffset(view, box(0, 100, 1000, 500)), { x: 0, y: 0 }, 'exactly the view');
  });

  it('moves just enough to bring it to the nearest edge', () => {
    assert.deepEqual(revealOffset(view, box(1100, 200, 100, 50)), { x: 200, y: 0 });
    assert.deepEqual(revealOffset(view, box(-300, 200, 100, 50)), { x: -300, y: 0 });
    assert.deepEqual(revealOffset(view, box(100, 580, 100, 50)), { x: 0, y: 30 });
    assert.deepEqual(revealOffset(view, box(100, 40, 100, 50)), { x: 0, y: -60 });
  });

  it('keeps a margin when there is room for it', () => {
    assert.deepEqual(revealOffset(view, box(950, 200, 40, 20), 16), { x: 6, y: 0 });
    assert.deepEqual(revealOffset(view, box(900, 200, 40, 20), 16), { x: 0, y: 0 });
  });

  it('shrinks the margin to what the view can spare', () => {
    // 1000 wide, 960 wide target: 20 to spare on each side.
    assert.deepEqual(revealOffset(view, box(50, 200, 960, 20), 100), { x: 30, y: 0 });
  });

  it('shows the start of a target larger than the view', () => {
    assert.deepEqual(revealOffset(view, box(200, 300, 1500, 900)), { x: 200, y: 200 });
    assert.deepEqual(revealOffset(view, box(-400, -100, 1500, 900)), { x: -400, y: -200 });
  });

  it('does nothing in a view with no room', () => {
    assert.deepEqual(revealOffset({ left: 0, top: 0, right: 0, bottom: 0 }, box(10, 10, 5, 5)), { x: 0, y: 0 });
  });
});

describe('the view and the caret', () => {
  it('leaves out what the floating cards cover', () => {
    assert.deepEqual(insetBox({ left: 0, top: 0, right: 800, bottom: 600 }, { top: 60, bottom: 60 }), { left: 0, top: 60, right: 800, bottom: 540 });
  });

  it('keeps the caret a fifth of the view from its edges', () => {
    assert.deepEqual(caretRoom(view), { x: 200, y: 100 });
    assert.deepEqual(revealOffset(view, box(950, 300, 1, 20), caretRoom(view)), { x: 151, y: 0 });
    assert.deepEqual(revealOffset(view, box(500, 590, 1, 20), caretRoom(view)), { x: 0, y: 110 });
  });

  it('tells whether a target shows at all', () => {
    assert.equal(overlaps(view, box(990, 590, 50, 50)), true);
    assert.equal(overlaps(view, box(1000, 200, 50, 50)), false);
    assert.equal(overlaps(view, box(100, 0, 50, 100)), false);
  });
});
