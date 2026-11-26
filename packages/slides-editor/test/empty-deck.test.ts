import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyDeckToolbar } from '../src/lib/empty-deck.ts';

const deck = { editable: true, writing: false, slides: 0, maxSlides: 200 };

describe('the bottom toolbar of a deck without slides', () => {
  it('shows where a slide can be added', () => {
    assert.equal(emptyDeckToolbar(deck), true);
  });

  it('stays hidden read-only, while the agent writes the deck, or once there are slides', () => {
    assert.equal(emptyDeckToolbar({ ...deck, editable: false }), false);
    assert.equal(emptyDeckToolbar({ ...deck, writing: true }), false);
    assert.equal(emptyDeckToolbar({ ...deck, slides: 1 }), false);
    assert.equal(emptyDeckToolbar({ ...deck, maxSlides: 0 }), false);
  });
});
