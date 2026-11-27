import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DESIGN_ENTRY_WORDS, refusesKey, settleField, stepField } from '../src/lib/number-field.ts';

const opacity = { min: 0, max: 100, unit: '%', strict: true };
const padding = { min: 0, unit: 'px' };
const fontSize = { min: 1, max: 400, unit: 'px' };

describe('committing a number field with limits', () => {
  it('holds a value past a limit at it and says which limit', () => {
    assert.deepEqual(settleField('150', opacity, 'Opacity'), { kind: 'write', text: '100%', shown: '100', say: 'Changed to 100 %. Opacity can’t go higher.' });
    assert.deepEqual(settleField('0', fontSize, 'Size'), { kind: 'write', text: '1px', shown: '1', say: 'Changed to 1 px. Size can’t go lower.' });
    assert.equal(settleField('500', fontSize, undefined).say, 'Changed to 400 px. This field can’t go higher.');
    assert.equal(settleField('-3', { min: 0, max: 12 }, 'Grow').say, 'Minus sign ignored. Grow doesn’t take negative numbers.');
  });

  it('takes the unit typed with the number', () => {
    assert.deepEqual(settleField('150%', opacity, 'Opacity'), { kind: 'write', text: '100%', shown: '100', say: 'Changed to 100 %. Opacity can’t go higher.' });
    assert.deepEqual(settleField('12px', padding, 'Padding'), { kind: 'write', text: '12px', shown: '12', say: null });
  });

  it('leaves out a leading minus sign, whichever dash it is', () => {
    for (const minus of ['-', '−', '－', '‒', '–', '—', '﹣']) {
      assert.deepEqual(settleField(`${minus}8`, padding, 'Padding'), { kind: 'write', text: '8px', shown: '8', say: 'Minus sign ignored. Padding doesn’t take negative numbers.' }, minus);
    }
    assert.equal(settleField('-8', padding, undefined).say, 'Minus sign ignored. This field doesn’t take negative numbers.');
    assert.equal(settleField('-500', opacity, 'Opacity').say, 'Minus sign ignored. Opacity doesn’t take negative numbers. Changed to 100 %. Opacity can’t go higher.');
  });

  it('keeps a number inside the limits as typed', () => {
    assert.deepEqual(settleField('12.50', padding, 'Padding'), { kind: 'write', text: '12.50px', shown: '12.50', say: null });
    assert.deepEqual(settleField('１２', padding, 'Padding'), { kind: 'write', text: '12px', shown: '12', say: null });
  });

  it('refuses text that is no number in a field that takes numbers only', () => {
    assert.deepEqual(settleField('abc', opacity, 'Opacity'), { kind: 'refuse', say: 'Nothing changed. Opacity takes a number in %.' });
    assert.deepEqual(settleField('wide', { min: 0, strict: true }, 'Grow'), { kind: 'refuse', say: 'Nothing changed. Grow takes a number only.' });
    assert.equal(DESIGN_ENTRY_WORDS.notANumber(undefined, 'px'), 'Nothing changed. This field takes a number in px.');
  });

  it('keeps CSS words and other units in a field that takes them, without a refused minus sign', () => {
    assert.deepEqual(settleField('1.5rem', fontSize, 'Size'), { kind: 'write', text: '1.5rem', shown: '1.5rem', say: null });
    assert.deepEqual(settleField('24px', { min: 0 }, 'Line height'), { kind: 'write', text: '24px', shown: '24px', say: null });
    assert.deepEqual(settleField('-1rem', padding, 'Padding'), { kind: 'write', text: '1rem', shown: '1rem', say: 'Minus sign ignored. Padding doesn’t take negative numbers.' });
  });

  it('clears the field when it is emptied', () => {
    assert.deepEqual(settleField('  ', padding, 'Padding'), { kind: 'write', text: '', shown: '', say: null });
  });

  it('lets fields without a lower limit take negative numbers', () => {
    assert.deepEqual(settleField('-8', { unit: 'px' }, 'Margin'), { kind: 'write', text: '-8px', shown: '-8', say: null });
    assert.equal(refusesKey('-', { unit: 'px' }), false);
    assert.equal(refusesKey('-', padding), true);
    assert.equal(refusesKey('−', padding), true);
    assert.equal(refusesKey('ArrowDown', padding), false);
  });
});

describe('stepping a number field with limits', () => {
  it('steps from what the field shows now, typed or not', () => {
    assert.deepEqual(stepField('40', '', 1, opacity, 'Opacity'), { text: '41', say: null });
    assert.deepEqual(stepField('', '12', 10, padding, 'Padding'), { text: '22', say: null });
  });

  it('holds a step at a limit and says so', () => {
    assert.deepEqual(stepField('95', '', 10, opacity, 'Opacity'), { text: '100', say: 'Changed to 100 %. Opacity can’t go higher.' });
    assert.deepEqual(stepField('0', '', -1, padding, 'Padding'), { text: '0', say: 'Changed to 0 px. Padding can’t go lower.' });
  });

  it('steps from the number without a refused minus sign', () => {
    assert.deepEqual(stepField('-5', '', 1, padding, 'Padding'), { text: '6', say: null });
  });

  it('steps fine steps', () => {
    assert.deepEqual(stepField('1.2', '', 0.05, { min: 0 }, 'Line height'), { text: '1.25', say: null });
  });
});
