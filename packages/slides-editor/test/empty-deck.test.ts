import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyDeckMessage, emptyDeckToolbar } from '../src/lib/empty-deck.ts';

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

describe('the line a deck without slides shows', () => {
  it('offers the agent by name when one can be asked', () => {
    assert.equal(emptyDeckMessage({ editable: true, agent: 'Claude' }), 'This presentation has no slides yet. Add one, or let Claude add some.');
  });

  it('asks for a first slide when no agent is there, and only waits when read-only', () => {
    assert.equal(emptyDeckMessage({ editable: true, agent: null }), 'This presentation has no slides yet. Add one to get started.');
    assert.equal(emptyDeckMessage({ editable: false, agent: 'Claude' }), 'This presentation has no slides yet. Slides will show here once they are added.');
  });
});
