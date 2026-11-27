import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDismissMode, getLandingMark, isRingShowingKey, isWatchEndingKey } from '../src/app/dismiss-focus.ts';

const key = (fields: Partial<Parameters<typeof isRingShowingKey>[0]> = {}) => ({
  key: 'a',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 65,
  ...fields,
});

describe('focus after Dismiss', () => {
  it('tells a key press from a pointer press', () => {
    assert.equal(getDismissMode({ detail: 0 }), 'keyboard');
    assert.equal(getDismissMode({ detail: 1, pointerType: 'mouse' }), 'mouse');
    assert.equal(getDismissMode({ detail: 1, pointerType: 'touch' }), 'touch');
    assert.equal(getDismissMode({ detail: 0, pointerType: 'pen' }), 'pen');
  });

  it('rings a heading, insets anything else, and stays quiet after a pointer', () => {
    assert.equal(getLandingMark('keyboard', true), 'ring');
    assert.equal(getLandingMark('keyboard', false), 'inset');
    assert.equal(getLandingMark('mouse', true), 'quiet');
  });

  it('ends the watch on a real key, and shows the ring on a plain one', () => {
    assert.equal(isWatchEndingKey({ key: 'Tab', repeat: false }), true);
    assert.equal(isWatchEndingKey({ key: 'Shift', repeat: false }), false);
    assert.equal(isWatchEndingKey({ key: 'a', repeat: true }), false);
    assert.equal(isRingShowingKey(key()), true);
    assert.equal(isRingShowingKey(key({ metaKey: true })), false);
    assert.equal(isRingShowingKey(key({ key: 'Shift' })), false);
    assert.equal(isRingShowingKey(key({ isComposing: true })), false);
    assert.equal(isRingShowingKey(key({ keyCode: 229 })), false);
  });
});
