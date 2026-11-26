import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stackMessage, stackOrderOf } from '../src/lib/stacking.ts';

const press = (key: string, code: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key, code, meta: false, shift: false, alt: false, ...mods });

describe('stacking shortcuts', () => {
  it('steps one layer with ⌘ and goes to the end with ⇧⌘ or ⌥⌘ on a Mac', () => {
    assert.equal(stackOrderOf(press(']', 'BracketRight', { meta: true }), true), 'forward');
    assert.equal(stackOrderOf(press('[', 'BracketLeft', { meta: true }), true), 'backward');
    assert.equal(stackOrderOf(press('}', 'BracketRight', { meta: true, shift: true }), true), 'front');
    assert.equal(stackOrderOf(press('“', 'BracketLeft', { meta: true, alt: true }), true), 'back');
    assert.equal(stackOrderOf(press('‘', 'BracketRight', { meta: true, alt: true }), true), 'front');
  });

  it('uses Ctrl and Ctrl+Shift elsewhere, never Ctrl+Alt', () => {
    assert.equal(stackOrderOf(press(']', 'BracketRight', { meta: true }), false), 'forward');
    assert.equal(stackOrderOf(press('{', 'BracketLeft', { meta: true, shift: true }), false), 'back');
    assert.equal(stackOrderOf(press(']', 'BracketRight', { meta: true, alt: true }), false), null);
  });

  it('reads the key when there is no physical key, and the bare brackets go to the end', () => {
    assert.equal(stackOrderOf({ key: '}', meta: true, shift: true, alt: false }, false), 'front');
    assert.equal(stackOrderOf(press(']', 'BracketRight'), true), 'front');
    assert.equal(stackOrderOf(press('{', 'BracketLeft', { shift: true }), true), 'back');
    assert.equal(stackOrderOf(press('[', 'BracketLeft', { alt: true }), true), null);
    assert.equal(stackOrderOf(press('x', 'KeyX', { meta: true }), true), null);
  });

  it('says what happened', () => {
    assert.equal(stackMessage('forward', true), 'Brought forward');
    assert.equal(stackMessage('backward', true), 'Sent backward');
    assert.equal(stackMessage('front', true), 'Brought to the front');
    assert.equal(stackMessage('back', true), 'Sent to the back');
    assert.equal(stackMessage('forward', false), 'Already at the front');
    assert.equal(stackMessage('back', false), 'Already at the back');
  });
});
