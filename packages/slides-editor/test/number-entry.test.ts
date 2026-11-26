import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  entryAnnouncement,
  isMinusKey,
  minusRefusal,
  parseEntry,
  refusesMinus,
  settleEntry,
  startsWithMinus,
  stepWithoutMinus,
} from '../src/lib/number-entry.ts';

const opacity = { min: 0, max: 100 };
const offset = { min: -64, max: 64 };

describe('typing into a number field', () => {
  it('reads plain, signed, full-width and comma-decimal numbers', () => {
    assert.equal(parseEntry('42'), 42);
    assert.equal(parseEntry(' 2.5 '), 2.5);
    assert.equal(parseEntry('-7'), -7);
    assert.equal(parseEntry('−7'), -7);
    assert.equal(parseEntry('－１２'), -12);
    assert.equal(parseEntry('1,5', ','), 1.5);
    assert.equal(parseEntry('1,500'), 1500);
    assert.equal(parseEntry('.5'), 0.5);
    assert.equal(parseEntry('abc'), null);
    assert.equal(parseEntry(''), null);
    assert.equal(parseEntry('5-'), null);
  });

  it('refuses the minus sign only where the lowest value is zero or more', () => {
    assert.equal(refusesMinus(opacity), true);
    assert.equal(refusesMinus({ min: 1 }), true);
    assert.equal(refusesMinus(offset), false);
    assert.equal(refusesMinus({ max: 10 }), false);
    assert.equal(isMinusKey('-'), true);
    assert.equal(isMinusKey('−'), true);
    assert.equal(isMinusKey('－'), true);
    assert.equal(isMinusKey('ArrowDown'), false);
    assert.equal(isMinusKey('5'), false);
    assert.equal(startsWithMinus(' -5'), true);
    assert.equal(startsWithMinus('‎−5'), true);
    assert.equal(startsWithMinus('5'), false);
  });

  it('keeps a value inside the limits as typed', () => {
    assert.deepEqual(settleEntry('40', opacity), { value: 40, minusDropped: false, limit: null });
    assert.deepEqual(settleEntry('-20', offset), { value: -20, minusDropped: false, limit: null });
  });

  it('holds a value past a limit at that limit', () => {
    assert.deepEqual(settleEntry('250', opacity), { value: 100, minusDropped: false, limit: 'max' });
    assert.deepEqual(settleEntry('-90', offset), { value: -64, minusDropped: false, limit: 'min' });
    assert.deepEqual(settleEntry('0', { min: 1 }), { value: 1, minusDropped: false, limit: 'min' });
  });

  it('leaves out a refused minus sign, then holds the number inside the limits', () => {
    assert.deepEqual(settleEntry('-5', opacity), { value: 5, minusDropped: true, limit: null });
    assert.deepEqual(settleEntry('-500', opacity), { value: 100, minusDropped: true, limit: 'max' });
    assert.deepEqual(settleEntry('-0', opacity), { value: 0, minusDropped: true, limit: null });
  });

  it('has nothing to keep when the text is no number', () => {
    assert.equal(settleEntry('-', opacity), null);
  });

  it('steps from the number without a refused minus sign', () => {
    assert.equal(stepWithoutMinus('-5', 1, opacity), 6);
    assert.equal(stepWithoutMinus('-5', -1, opacity), 4);
    assert.equal(stepWithoutMinus('-0.2', 0.1, opacity), 0.3);
    assert.equal(stepWithoutMinus('-100', 10, opacity), 100);
    assert.equal(stepWithoutMinus('5', 1, opacity), null);
    assert.equal(stepWithoutMinus('-5', 1, offset), null);
  });
});

describe('what a number field says when it changed what was typed', () => {
  it('names the field, or speaks of "this setting" when it has no name', () => {
    assert.equal(minusRefusal('Opacity'), "Opacity can't be negative");
    assert.equal(minusRefusal(undefined), "This setting can't be negative");
    assert.equal(minusRefusal('  '), "This setting can't be negative");
  });

  it('gives the value it was held at, and which limit', () => {
    assert.equal(entryAnnouncement({ value: 100, minusDropped: false, limit: 'max' }, 'Opacity', '100%'), 'Opacity is now at its maximum, 100%');
    assert.equal(entryAnnouncement({ value: 1, minusDropped: false, limit: 'min' }, undefined, '1 px'), 'This setting is now at its minimum, 1 px');
  });

  it('says the minus sign was left out, with the value kept', () => {
    assert.equal(entryAnnouncement({ value: 5, minusDropped: true, limit: null }, 'Blur', '5 px'), "Blur can't be negative, so it's 5 px");
    assert.equal(entryAnnouncement({ value: 100, minusDropped: true, limit: 'max' }, 'Opacity', '100%'), "Opacity can't be negative, so it's at its maximum, 100%");
  });

  it('says nothing when the value was kept as typed', () => {
    assert.equal(entryAnnouncement({ value: 40, minusDropped: false, limit: null }, 'Opacity', '40%'), null);
  });
});
