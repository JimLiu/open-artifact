import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCardExit, pressAgainMessage, cardTabTarget } from '../src/lib/card-exit.ts';

describe('first Delete after the address field closes', () => {
  it('swallows the first press and its repeats, then lets the next one through', () => {
    const exit = createCardExit();
    exit.arm();
    assert.equal(exit.keyDown({ key: 'Backspace' }), 'first');
    assert.equal(exit.keyDown({ key: 'Backspace', repeat: true }), 'held');
    exit.keyUp('Backspace');
    assert.equal(exit.keyDown({ key: 'Backspace' }), null);
  });
  it('ends on another key or a click, not on a modifier', () => {
    const exit = createCardExit();
    exit.arm();
    assert.equal(exit.keyDown({ key: 'Shift' }), null);
    assert.equal(exit.keyDown({ key: 'a' }), null);
    assert.equal(exit.keyDown({ key: 'Delete' }), null);
    exit.arm();
    exit.cancel();
    assert.equal(exit.keyDown({ key: 'Delete' }), null);
  });
  it('tells a Delete landing in the closing card, until cancelled', () => {
    const field = new EventTarget();
    const elsewhere = new EventTarget();
    const tab = { key: 'Tab' };
    const del = { key: 'Delete' };
    const exit = createCardExit();
    exit.arm({ by: tab, closing: (target) => target === field });
    assert.equal(exit.keyDown(tab), null, 'the key that closed it is not the next key');
    assert.equal(exit.leftIn(del, field), true);
    assert.equal(exit.leftIn(del, elsewhere), false);
    assert.equal(exit.leftIn({ key: 'a' }, field), false, 'other keys stay with the field');
    assert.equal(exit.keyDown(del), 'first');
    exit.cancel();
    assert.equal(exit.leftIn(del, field), false);
    exit.arm();
    assert.equal(exit.leftIn(del, field), false, 'no card given');
  });
  it('names the key', () => {
    assert.equal(pressAgainMessage('Backspace', false), 'Address field closed. Press Backspace again to delete');
    assert.equal(pressAgainMessage('Backspace', true), 'Address field closed. Press Delete again to delete');
  });
});

describe('Tab in an address card', () => {
  it('moves among the controls and closes past either end', () => {
    assert.equal(cardTabTarget(3, 0, false), 1);
    assert.equal(cardTabTarget(3, 2, false), null);
    assert.equal(cardTabTarget(3, 0, true), null);
    assert.equal(cardTabTarget(3, 2, true), 1);
  });

  it('starts at an end when focus is on none of them, and closes an empty card', () => {
    assert.equal(cardTabTarget(3, -1, false), 0);
    assert.equal(cardTabTarget(3, -1, true), 2);
    assert.equal(cardTabTarget(0, -1, false), null);
  });
});
