import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commandLetter, holdsLayerKeyInField, isLinkKey, layerAnnouncement, layerMoveKey, undoRedoKey } from '../src/lib/shortcut-keys.ts';

const press = (key: string, code: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key,
  code,
  metaKey: Boolean(mods.meta),
  ctrlKey: Boolean(mods.ctrl),
  shiftKey: Boolean(mods.shift),
  altKey: Boolean(mods.alt),
});

describe('undo and redo keys', () => {
  it('reads ⌘Z, ⇧⌘Z and Ctrl+Z', () => {
    assert.equal(undoRedoKey(press('z', 'KeyZ', { meta: true })), 'undo');
    assert.equal(undoRedoKey(press('Z', 'KeyZ', { meta: true, shift: true })), 'redo');
    assert.equal(undoRedoKey(press('z', 'KeyZ', { ctrl: true })), 'undo');
  });

  it('works on Cyrillic and Greek layouts', () => {
    assert.equal(undoRedoKey(press('я', 'KeyZ', { meta: true })), 'undo');
    assert.equal(undoRedoKey(press('Я', 'KeyZ', { meta: true, shift: true })), 'redo');
    assert.equal(undoRedoKey(press('ζ', 'KeyZ', { ctrl: true })), 'undo');
    assert.equal(undoRedoKey(press('н', 'KeyY', { ctrl: true })), 'redo');
  });

  it('takes Y as redo only with Ctrl and without ⌘', () => {
    assert.equal(undoRedoKey(press('y', 'KeyY', { ctrl: true })), 'redo');
    assert.equal(undoRedoKey(press('y', 'KeyY', { meta: true })), null);
    assert.equal(undoRedoKey(press('y', 'KeyY', { meta: true, ctrl: true })), null);
    assert.equal(undoRedoKey(press('Y', 'KeyY', { ctrl: true, shift: true })), null);
  });

  it('ignores Alt combinations and plain letters', () => {
    assert.equal(undoRedoKey(press('Ω', 'KeyZ', { meta: true, alt: true })), null);
    assert.equal(undoRedoKey(press('z', 'KeyZ')), null);
    assert.equal(undoRedoKey(press('x', 'KeyX', { meta: true })), null);
  });
});

describe('⌘ letter shortcuts', () => {
  it('reads the letter of ⌘ and Ctrl shortcuts, on any layout', () => {
    assert.equal(commandLetter(press('d', 'KeyD', { meta: true })), 'd');
    assert.equal(commandLetter(press('в', 'KeyD', { ctrl: true })), 'd');
    assert.equal(commandLetter(press('G', 'KeyG', { meta: true, shift: true })), 'g');
  });

  it('does not take ⌥⌘D, ⌥⌘M, ⌥⌘A or ⌥⌘G for their ⌘ shortcut', () => {
    for (const [typed, code] of [['∂', 'KeyD'], ['µ', 'KeyM'], ['å', 'KeyA'], ['©', 'KeyG']]) {
      assert.equal(commandLetter(press(typed, code, { meta: true, alt: true })), null, code);
    }
    assert.equal(commandLetter(press('d', 'KeyD')), null);
  });
});

describe('stacking-order keys', () => {
  const mac = (event: ReturnType<typeof press>) => layerMoveKey(event, true);
  const pc = (event: ReturnType<typeof press>) => layerMoveKey(event, false);

  it('moves one layer with ⌘] / ⌘[ and all the way with ⌥⌘] / ⌥⌘[', () => {
    assert.equal(mac(press(']', 'BracketRight', { meta: true })), 'forward');
    assert.equal(mac(press('[', 'BracketLeft', { meta: true })), 'backward');
    assert.equal(mac(press('‘', 'BracketRight', { meta: true, alt: true })), 'front', 'Option changes the typed character');
    assert.equal(mac(press('“', 'BracketLeft', { meta: true, alt: true })), 'back');
    assert.equal(mac(press('’', 'BracketRight', { meta: true, alt: true, shift: true })), null);
  });

  it('uses Ctrl and Ctrl+Shift off Apple platforms, and Ctrl never on them', () => {
    assert.equal(pc(press(']', 'BracketRight', { ctrl: true })), 'forward');
    assert.equal(pc(press('[', 'BracketLeft', { ctrl: true })), 'backward');
    assert.equal(pc(press('}', 'BracketRight', { ctrl: true, shift: true })), 'front');
    assert.equal(pc(press('{', 'BracketLeft', { ctrl: true, shift: true })), 'back');
    assert.equal(pc(press('*', 'BracketRight', { ctrl: true, shift: true })), 'front', 'read by the physical key');
    assert.equal(pc(press('}', 'Digit0', { ctrl: true, shift: true })), 'front', 'or by the typed brace');
    assert.equal(mac(press(']', 'BracketRight', { ctrl: true })), null);
    assert.equal(mac(press('}', 'BracketRight', { ctrl: true, shift: true })), null);
  });

  it('lets Ctrl+Shift bracket keys that type another shortcut through', () => {
    for (const typed of ['+', '=', '_', '?', '`', '-']) {
      assert.equal(pc(press(typed, 'BracketRight', { ctrl: true, shift: true })), null, typed);
    }
  });

  it('never takes Ctrl+Alt, which is AltGr typing', () => {
    assert.equal(pc(press(']', 'BracketRight', { ctrl: true, alt: true })), null);
    assert.equal(pc(press('[', 'Digit8', { ctrl: true, alt: true })), null, 'AltGr+8 types [');
    assert.equal(pc(press('}', 'BracketRight', { ctrl: true, alt: true, shift: true })), null);
  });

  it('goes by the typed bracket where the layout puts it on another key', () => {
    assert.equal(mac(press(']', 'Digit9', { meta: true })), 'forward');
    assert.equal(mac(press('х', 'BracketLeft', { meta: true })), null);
    assert.equal(mac(press('+', 'BracketRight', { meta: true })), null, 'the zoom-in key of a German layout');
  });

  it('leaves ⇧⌘ and plain brackets alone', () => {
    assert.equal(mac(press('}', 'BracketRight', { meta: true, shift: true })), null);
    assert.equal(pc(press(']', 'BracketRight')), null);
  });

  it('holds back in a field exactly the keys it takes', () => {
    assert.equal(holdsLayerKeyInField(press('[', 'BracketLeft', { meta: true }), true), true);
    assert.equal(holdsLayerKeyInField(press('“', 'BracketLeft', { meta: true, alt: true }), true), true);
    assert.equal(holdsLayerKeyInField(press('[', 'BracketLeft', { ctrl: true }), false), true);
    assert.equal(holdsLayerKeyInField(press('{', 'BracketLeft', { ctrl: true, shift: true }), false), true);
    assert.equal(holdsLayerKeyInField(press('ß', 'BracketLeft', { ctrl: true, alt: true }), false), false);
    assert.equal(holdsLayerKeyInField(press('[', 'BracketLeft', { ctrl: true }), true), false);
    assert.equal(holdsLayerKeyInField(press('a', 'KeyA', { meta: true }), true), false);
  });

  it('reads out each outcome in its own words', () => {
    const said = (['front', 'back', 'forward', 'backward'] as const).map((move) => layerAnnouncement(move, 1));
    assert.equal(new Set(said).size, 4);
    assert.equal(layerAnnouncement('front', 1), 'Element moved to the front');
    assert.equal(layerAnnouncement('backward', 3), '3 elements moved down one layer');
  });
});

describe('the link key', () => {
  it('is ⌘K on a Mac and Ctrl+K elsewhere', () => {
    assert.equal(isLinkKey(press('k', 'KeyK', { meta: true }), true), true);
    assert.equal(isLinkKey(press('k', 'KeyK', { ctrl: true }), false), true);
    assert.equal(isLinkKey(press('k', 'KeyK', { ctrl: true }), true), false);
    assert.equal(isLinkKey(press('k', 'KeyK', { meta: true }), false), false);
  });

  it('works whatever the keyboard layout', () => {
    assert.equal(isLinkKey(press('л', 'KeyK', { meta: true }), true), true);
    assert.equal(isLinkKey(press('κ', 'KeyK', { ctrl: true }), false), true);
  });

  it('ignores Shift, Option, both modifiers and a plain K', () => {
    assert.equal(isLinkKey(press('K', 'KeyK', { meta: true, shift: true }), true), false);
    assert.equal(isLinkKey(press('˚', 'KeyK', { meta: true, alt: true }), true), false);
    assert.equal(isLinkKey(press('k', 'KeyK', { meta: true, ctrl: true }), true), false);
    assert.equal(isLinkKey(press('k', 'KeyK'), true), false);
  });
});
