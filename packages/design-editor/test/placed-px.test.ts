import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placedPx } from '../src/lib/placed-px.ts';

describe('where a moved element starts', () => {
  it('reads a plain px inline value as it is', () => {
    assert.equal(placedPx('120px', '999px'), 120);
    assert.equal(placedPx('-3.5px', '0px'), -3.5);
    assert.equal(placedPx('40', '0px'), 40);
  });

  it('reads the computed px for any other inline value', () => {
    // 2026-11-27: `left: 50%` read as 50, so the first step of a drag jumped hundreds of px.
    assert.equal(placedPx('50%', '600px'), 600);
    assert.equal(placedPx('2rem', '32px'), 32);
    assert.equal(placedPx('calc(50% - 20px)', '580px'), 580);
    assert.equal(placedPx('auto', '75px'), 75);
    assert.equal(placedPx(undefined, '12px'), 12);
    assert.equal(placedPx('', '12px'), 12);
  });

  it('falls back to 0 with nothing to read', () => {
    assert.equal(placedPx(undefined, undefined), 0);
    assert.equal(placedPx('50%', 'auto'), 0);
  });
});
