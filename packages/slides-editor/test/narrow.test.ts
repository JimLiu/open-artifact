import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CORNER_EDGE, CORNER_GAP, RAIL_HYSTERESIS, RAIL_MIN_WIDTH, cornerShift, railFits } from '../src/lib/narrow.ts';

test('the rail fits from 1024px on and hides at 1008px and under', () => {
  assert.equal(railFits(null, RAIL_MIN_WIDTH), true);
  assert.equal(railFits(false, 1400), true);
  assert.equal(railFits(true, RAIL_MIN_WIDTH - RAIL_HYSTERESIS), false);
  assert.equal(railFits(null, 600), false);
});

test('between the two lines the rail keeps its last answer', () => {
  assert.equal(railFits(true, 1015), true);
  assert.equal(railFits(false, 1015), false);
  assert.equal(railFits(null, 1015), false);
});

test('the toolbar stays centred while the pager card fits beside it', () => {
  // Room each side: (1200 - 400) / 2 = 400; the card needs 12 + 200 + 8.
  assert.equal(cornerShift(1200, 400, 200), 0);
});

test('short of room the toolbar moves left just enough', () => {
  // Room 150 each side; the card needs 12 + 200 + 8 = 220: move 70 (150 - 70 = 80 still clears the gap).
  assert.equal(cornerShift(700, 400, 200), 70);
  const shift = cornerShift(700, 400, 200) as number;
  assert.ok((700 - 400) / 2 - shift >= CORNER_GAP);
  assert.equal(CORNER_EDGE, 12);
});

test('shorter still the pager card goes above the toolbar', () => {
  assert.equal(cornerShift(500, 400, 200), 'above');
  assert.equal(cornerShift(380, 400, 200), 'above');
});
