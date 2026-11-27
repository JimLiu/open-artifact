import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isMinusSign,
  leadsNumber,
  limitsKept,
  numberLimitMessage,
  readTypedNumber,
  refusesMinus,
  settleNumber,
  settleTypedText,
  startsWithMinus,
} from '../src/number-limits.ts';

const corners = { min: 0, max: 32 };

describe('minus signs', () => {
  it('knows every minus sign a keyboard types', () => {
    for (const sign of ['-', '−', '－', '‒', '–', '—', '﹣']) assert.ok(isMinusSign(sign), sign);
    assert.equal(isMinusSign('+'), false);
    assert.equal(isMinusSign('Minus'), false);
  });

  it('looks past format characters and spaces for a leading one', () => {
    assert.ok(startsWithMinus('-5'));
    assert.ok(startsWithMinus('‎ −5'));
    assert.equal(startsWithMinus('5-'), false);
    assert.ok(leadsNumber(' ‎5', 2));
    assert.equal(leadsNumber('10', 2), false);
  });

  it('is refused only where the minimum is zero or more', () => {
    assert.ok(refusesMinus({ min: 0 }));
    assert.equal(refusesMinus({ min: -1 }), false);
    assert.equal(refusesMinus({}), false);
  });
});

describe('typed numbers', () => {
  it('reads grouping, the decimal separator and full-width digits', () => {
    assert.equal(readTypedNumber('1,250.5'), 1250.5);
    assert.equal(readTypedNumber('1.250,5', ','), 1250.5);
    assert.equal(readTypedNumber('１２'), 12);
    assert.equal(readTypedNumber('−3'), -3);
    assert.equal(readTypedNumber('abc'), null);
  });

  it('drops a refused minus sign instead of going to the minimum', () => {
    assert.deepEqual(settleTypedText('-5', corners), { value: 5, limits: [{ reason: 'no-minus', limit: 0 }] });
    assert.deepEqual(settleTypedText('-5', { min: -10, max: 32 }), { value: -5, limits: [] });
  });

  it('holds a value past a bound and says which', () => {
    assert.deepEqual(settleTypedText('50', corners), { value: 32, limits: [{ reason: 'max', limit: 32 }] });
    assert.deepEqual(settleTypedText('2', { min: 4 }), { value: 4, limits: [{ reason: 'min', limit: 4 }] });
    assert.deepEqual(settleTypedText('-50', corners), {
      value: 32,
      limits: [
        { reason: 'no-minus', limit: 0 },
        { reason: 'max', limit: 32 },
      ],
    });
    assert.deepEqual(settleNumber(12, false, corners), { value: 12, limits: [] });
  });

  it('keeps a bound only when the field ended there', () => {
    const limits = settleTypedText('-50', corners)!.limits;
    assert.deepEqual(limitsKept(limits, 32), limits);
    assert.deepEqual(limitsKept(limits, 30), [{ reason: 'no-minus', limit: 0 }]);
  });
});

describe('limit messages', () => {
  it('names the field and the bound', () => {
    assert.equal(numberLimitMessage([{ reason: 'max', limit: 32 }], { name: 'Corners' }), 'Changed to 32. Corners can’t go higher.');
    assert.equal(numberLimitMessage([{ reason: 'min', limit: 0 }], { name: 'Corners' }), 'Changed to 0. Corners can’t go lower.');
    assert.equal(numberLimitMessage([{ reason: 'no-minus', limit: 0 }], { name: 'Corners' }), 'Minus sign ignored. Corners doesn’t take negative numbers.');
  });

  it('says "This field" without a name and writes the unit after a space', () => {
    assert.equal(numberLimitMessage([{ reason: 'max', limit: 100 }], { unit: 'px', format: String }), 'Changed to 100 px. This field can’t go higher.');
    assert.equal(numberLimitMessage([{ reason: 'no-minus', limit: 0 }], { name: '  ' }), 'Minus sign ignored. This field doesn’t take negative numbers.');
  });

  it('says several changes together, in order', () => {
    const limits = settleTypedText('-50', corners)!.limits;
    assert.equal(numberLimitMessage(limits, { name: 'Corners' }), 'Minus sign ignored. Corners doesn’t take negative numbers. Changed to 32. Corners can’t go higher.');
    assert.equal(numberLimitMessage([]), '');
  });
});
