/**
 * Tests of the stylus and multi-finger decisions: palms, held-back touch
 * moves, two- and three-finger taps, the lasso, the eraser, stylus taps
 * while typing and the turn knob's snapping.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeElement, type BoardElement, type StrokeElement } from '@open-artifact/whiteboard-core';
import { snapKnobTurn } from '../src/selection/transform.ts';
import { strokesSwept } from '../src/tools/eraser.ts';
import { insidePolygon, lassoPick, lassoSamples, lassoTakes } from '../src/tools/lasso.ts';
import { penPressNearWords } from '../src/tools/pen-text.ts';
import { FINGER_TAP, PALM_RULES, fingerDown, fingerMoved, fingerUp, isPalmTouch, newPalmWatch, swallowsTouchMove } from '../src/tools/touch.ts';

const at = (x: number, y: number) => ({ x, y });
const finger = { width: 20, height: 20 };

describe('palms', () => {
  it('lets fingers through until a stylus is seen', () => {
    assert.equal(isPalmTouch(newPalmWatch(), { width: 200, height: 200 }, 1000), false);
  });

  it('drops any touch while a stylus is down', () => {
    assert.equal(isPalmTouch({ ...newPalmWatch(), pensDown: 1, penSeen: true }, finger, 1000), true);
  });

  it('drops a touch just after the stylus lifted, or a wide one', () => {
    const watch = { ...newPalmWatch(), penSeen: true, penUpAt: 1000 };
    assert.equal(isPalmTouch(watch, finger, 1000 + PALM_RULES.penLiftMs - 1), true);
    assert.equal(isPalmTouch(watch, finger, 1000 + PALM_RULES.penLiftMs + 1), false);
    assert.equal(isPalmTouch(watch, { width: PALM_RULES.contactPx + 1, height: 10 }, 5000), true);
  });

  it('drops a touch right after the last palm', () => {
    const watch = { ...newPalmWatch(), palmAt: 1000 };
    assert.equal(isPalmTouch(watch, finger, 1000 + PALM_RULES.afterPalmMs - 1), true);
    assert.equal(isPalmTouch(watch, finger, 1000 + PALM_RULES.afterPalmMs + 1), false);
  });

  it('holds back board touch moves, and control touch moves only past the slop', () => {
    assert.equal(swallowsTouchMove(false, true, at(0, 0), at(50, 0)), false);
    assert.equal(swallowsTouchMove(true, true, at(0, 0), at(1, 0)), true);
    assert.equal(swallowsTouchMove(true, false, at(0, 0), at(4, 4)), false, 'a tap on a control still goes through');
    assert.equal(swallowsTouchMove(true, false, at(0, 0), at(9, 0)), true);
  });
});

describe('multi-finger taps', () => {
  it('undoes with two fingers and redoes with three', () => {
    let taps = fingerDown(null, 1, at(0, 0), 0);
    taps = fingerDown(taps, 2, at(50, 0), 20);
    assert.equal(fingerUp(taps, 1, 120), null);
    assert.equal(fingerUp(taps, 2, 150), 'undo');
    let three = fingerDown(null, 1, at(0, 0), 0);
    three = fingerDown(three, 2, at(50, 0), 10);
    three = fingerDown(three, 3, at(100, 0), 20);
    fingerUp(three, 3, 100);
    fingerUp(three, 2, 110);
    assert.equal(fingerUp(three, 1, 120), 'redo');
  });

  it('is not a tap when a finger moves or the fingers stay', () => {
    const moved = fingerDown(fingerDown(null, 1, at(0, 0), 0), 2, at(50, 0), 0);
    fingerMoved(moved, 2, at(50 + FINGER_TAP.px, 0));
    fingerUp(moved, 1, 50);
    assert.equal(fingerUp(moved, 2, 60), 'none');
    const slow = fingerDown(fingerDown(null, 1, at(0, 0), 0), 2, at(50, 0), 0);
    fingerUp(slow, 1, 50);
    assert.equal(fingerUp(slow, 2, FINGER_TAP.ms + 1), 'none');
    const one = fingerDown(null, 1, at(0, 0), 0);
    assert.equal(fingerUp(one, 1, 50), 'none');
  });
});

describe('lasso', () => {
  const square = [at(0, 0), at(100, 0), at(100, 100), at(0, 100)];
  const note = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
    normalizeElement({ type: 'note', id, x, y, w: 40, h: 40, text: '', color: 'yellow', ...extra }) as BoardElement;

  it('tests points against the loop', () => {
    assert.equal(insidePolygon(at(50, 50), square), true);
    assert.equal(insidePolygon(at(150, 50), square), false);
  });

  it('samples a 5 × 5 grid over a box and at most 40 points along a stroke', () => {
    assert.equal(lassoSamples(note('n', 0, 0)).length, 25);
    const long = normalizeElement({ type: 'stroke', id: 's', x: 0, y: 0, points: Array.from({ length: 400 }, (_, i) => i), color: 'ink', width: 4 }) as StrokeElement;
    assert.ok(lassoSamples(long).length <= 40);
  });

  it('takes an item more than half inside', () => {
    assert.equal(lassoTakes(note('in', 30, 30), square), true);
    assert.equal(lassoTakes(note('half', 80, 30), square), false);
  });

  it('skips a section around its start, keeps locked items out unless alone, and picks groups whole', () => {
    const section = normalizeElement({ type: 'container', id: 'sec', x: -10, y: -10, w: 120, h: 120, text: '' }) as BoardElement;
    const inside = note('a', 30, 30);
    const locked = note('l', 10, 10, { locked: true });
    const member = note('g1', 50, 50, { groups: ['grp'] });
    const partner = note('g2', 400, 400, { groups: ['grp'] });
    const elements = [section, inside, locked, member, partner];
    const picked = lassoPick(elements, square, at(5, 5));
    assert.deepEqual([...picked].sort(), ['a', 'g1', 'g2']);
    assert.deepEqual([...lassoPick([locked], square, at(5, 5))], ['l']);
  });
});

describe('eraser', () => {
  const stroke = (id: string, y: number) => normalizeElement({ type: 'stroke', id, x: 0, y, points: [0, 0, 100, 0], color: 'ink', width: 2 }) as StrokeElement;

  it('sweeps strokes within reach along the whole movement', () => {
    const strokes = [stroke('near', 0), stroke('far', 200)];
    assert.deepEqual(strokesSwept(strokes, at(50, -40), at(50, 40), 5, new Set()), ['near']);
    assert.deepEqual(strokesSwept(strokes, at(50, -40), at(50, 40), 5, new Set(['near'])), []);
    assert.deepEqual(strokesSwept(strokes, at(50, 20), at(50, 30), 5, new Set()), []);
  });
});

describe('stylus taps while typing', () => {
  const box = { x: 100, y: 100, w: 200, h: 40 };
  it('tells the edge, beside and elsewhere apart', () => {
    assert.equal(penPressNearWords(box, at(95, 120)), 'edge');
    assert.equal(penPressNearWords(box, at(150, 120)), 'edge');
    assert.equal(penPressNearWords(box, at(60, 120)), 'beside');
    assert.equal(penPressNearWords(box, at(700, 120)), 'beside');
    assert.equal(penPressNearWords(box, at(200, 200)), 'beside');
    assert.equal(penPressNearWords(box, at(200, 260)), 'elsewhere');
    assert.equal(penPressNearWords(box, at(30, 120)), 'elsewhere');
  });
});

describe('turn knob', () => {
  it('snaps to multiples of 15° only when close', () => {
    assert.equal(snapKnobTurn(44), 45);
    assert.equal(snapKnobTurn(-3), 0);
    assert.equal(snapKnobTurn(37), 37);
  });
});
