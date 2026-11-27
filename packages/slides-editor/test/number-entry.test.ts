import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entryAnnouncement, minusRefusal } from '../src/lib/number-entry.ts';

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
