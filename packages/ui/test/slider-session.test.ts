import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { endsDrag, largeStepOf, sliderValueText } from '../src/slider-session.ts';

describe('a slider drag', () => {
  it('ends on a release or cancel of the pointer that started it only', () => {
    assert.equal(endsDrag({ type: 'pointerup', pointerId: 1 }, 1), true);
    assert.equal(endsDrag({ type: 'pointercancel', pointerId: 1 }, 1), true);
    assert.equal(endsDrag({ type: 'pointerup', pointerId: 2 }, 1), false);
    assert.equal(endsDrag({ type: 'pointercancel', pointerId: 2 }, 1), false);
  });

  it('ends on a touch end or cancel and when the window loses focus', () => {
    for (const type of ['touchend', 'touchcancel', 'blur']) assert.equal(endsDrag({ type }, 1), true, type);
    assert.equal(endsDrag({ type: 'pointermove', pointerId: 1 }, 1), false);
  });
});

describe('slider keys and reading', () => {
  it('moves ten steps with PageUp and PageDown', () => {
    assert.equal(largeStepOf(1), 10);
    assert.equal(largeStepOf(0.05), 0.5);
  });

  it('reads "Mixed" for different values, and a percentage in the language’s format', () => {
    assert.equal(sliderValueText(40, { mixed: true, unit: '%' }), 'Mixed');
    assert.equal(sliderValueText(40, { unit: '%', locale: 'en-US' }), '40%');
    assert.equal(sliderValueText(40, { unit: '%', locale: 'de-DE' }), '40\u00a0%');
    assert.equal(sliderValueText(12.5, { unit: '%', locale: 'en-US' }), '12.5%');
    assert.equal(sliderValueText(40), null);
  });
});
