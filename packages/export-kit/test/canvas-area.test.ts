import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canvasArea, SAFE_CANVAS_AREA } from '../src/canvas-area.ts';

const FULL = 120_000_000;
const LOWERED = SAFE_CANVAS_AREA - 12001;
const LARGE = 9000 * 9000;

describe('the canvas area captures draw on', () => {
  it('starts full and lowers once after a large empty canvas', () => {
    const area = canvasArea(FULL, LOWERED);
    assert.equal(area.limit, FULL);
    assert.equal(area.lowerFor(LARGE), true);
    assert.equal(area.limit, LOWERED);
    assert.equal(area.lowerFor(LARGE), false, 'already lowered');
    assert.equal(area.limit, LOWERED);
  });

  it('does not lower for a canvas any browser draws', () => {
    const area = canvasArea(FULL, LOWERED);
    assert.equal(area.lowerFor(SAFE_CANVAS_AREA), false);
    assert.equal(area.limit, FULL);
  });

  it('does not lower once a canvas that large was drawn', () => {
    const area = canvasArea(FULL, LOWERED);
    area.drawn(LARGE);
    assert.equal(area.lowerFor(LARGE + 1), false);
    assert.equal(area.limit, FULL);
  });

  it('goes back to full when the smaller drawing failed too, or a large one worked', () => {
    const area = canvasArea(FULL, LOWERED);
    area.lowerFor(LARGE);
    area.reset();
    assert.equal(area.limit, FULL);
    area.lowerFor(LARGE);
    area.drawn(1000 * 1000);
    assert.equal(area.limit, LOWERED, 'a small drawing proves nothing');
    area.drawn(LARGE);
    assert.equal(area.limit, FULL);
  });
});
