import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCardExit, pressAgainMessage } from '../src/lib/card-exit.ts';

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
  it('names the key', () => {
    assert.equal(pressAgainMessage('Backspace', false), 'Address field closed. Press Backspace again to delete');
    assert.equal(pressAgainMessage('Backspace', true), 'Address field closed. Press Delete again to delete');
  });
});
