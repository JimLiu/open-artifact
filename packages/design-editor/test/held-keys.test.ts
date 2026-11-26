import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { altHeldAfter, spacePanAfter } from '../src/lib/held-keys.ts';

describe('space panning', () => {
  it('pans while Space is down', () => {
    assert.equal(spacePanAfter(false, { type: 'keydown', key: ' ' }), true);
    assert.equal(spacePanAfter(true, { type: 'keyup', key: ' ' }), false);
    assert.equal(spacePanAfter(true, { type: 'keydown', key: 'a' }), true);
  });

  it('stops when a modifier joins in, or when ⌘ comes up', () => {
    assert.equal(spacePanAfter(true, { type: 'keydown', key: 'Meta', metaKey: true }), false);
    assert.equal(spacePanAfter(true, { type: 'keydown', key: 'Shift' }), false);
    assert.equal(spacePanAfter(true, { type: 'keyup', key: 'Meta' }), false);
    assert.equal(spacePanAfter(true, { type: 'keyup', key: 'Shift' }), true);
  });

  it('does not start for ⌘Space', () => {
    assert.equal(spacePanAfter(false, { type: 'keydown', key: ' ', metaKey: true }), false);
    assert.equal(spacePanAfter(false, { type: 'keydown', key: 'Meta' }), false);
  });
});

describe('Alt held', () => {
  it('follows Alt itself and the modifier state of other keys', () => {
    assert.equal(altHeldAfter({ type: 'keydown', key: 'Alt', altKey: true }), true);
    assert.equal(altHeldAfter({ type: 'keyup', key: 'Alt', altKey: false }), false);
    assert.equal(altHeldAfter({ type: 'keydown', key: 'a', altKey: true }), true);
    assert.equal(altHeldAfter({ type: 'keyup', key: 'a' }), false);
  });
});
