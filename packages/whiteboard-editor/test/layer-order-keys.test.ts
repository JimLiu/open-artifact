import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layerOrderShortcutOf } from '../src/lib/tools.ts';

type Press = Parameters<typeof layerOrderShortcutOf>[0];

const press = (key: string, code: string, mods: Partial<Omit<Press, 'key' | 'code'>> = {}): Press => ({
  key,
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('layer order keys', () => {
  it('moves one step with ⌘ and all the way with ⌘⌥ on Apple platforms', () => {
    assert.equal(layerOrderShortcutOf(press(']', 'BracketRight', { metaKey: true }), true, true), 'forward');
    assert.equal(layerOrderShortcutOf(press('[', 'BracketLeft', { metaKey: true }), true, true), 'backward');
    assert.equal(layerOrderShortcutOf(press('‘', 'BracketRight', { metaKey: true, altKey: true }), true, true), 'front');
  });

  it('does not take Ctrl for ⌘ on Apple platforms', () => {
    assert.equal(layerOrderShortcutOf(press(']', 'BracketRight', { ctrlKey: true }), true, true), undefined);
    assert.equal(layerOrderShortcutOf(press('}', 'BracketRight', { ctrlKey: true, shiftKey: true }), true, true), undefined);
  });

  it('reads the typed brace with Ctrl+Shift elsewhere', () => {
    assert.equal(layerOrderShortcutOf(press('}', 'BracketRight', { ctrlKey: true, shiftKey: true }), true, false), 'front');
    assert.equal(layerOrderShortcutOf(press('{', 'BracketLeft', { ctrlKey: true, shiftKey: true }), true, false), 'back');
    assert.equal(layerOrderShortcutOf(press('}', 'Backslash', { ctrlKey: true, shiftKey: true }), true, false), 'front', 'wherever the layout puts the brace');
    assert.equal(layerOrderShortcutOf(press('?', 'BracketRight', { ctrlKey: true, shiftKey: true }), true, false), undefined, 'another symbol does nothing');
    assert.equal(layerOrderShortcutOf(press('Ü', 'BracketLeft', { ctrlKey: true, shiftKey: true }), true, false), 'back', 'a letter falls back to the key place');
    assert.equal(layerOrderShortcutOf(press(']', 'BracketRight', { ctrlKey: true }), true, false), 'forward');
  });

  it('takes single brackets only while single keys are on', () => {
    assert.equal(layerOrderShortcutOf(press(']', 'BracketRight'), true, true), 'front');
    assert.equal(layerOrderShortcutOf(press('[', 'BracketLeft'), false, false), undefined);
  });
});
