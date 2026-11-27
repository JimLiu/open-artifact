import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { committedFieldPasses, endsCommitted, textHandoffMessage, textHandoffOf } from '../src/lib/input-handoff.ts';

const press = (key: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean; code?: string } = {}) => ({ key, meta: false, shift: false, alt: false, ...mods });

describe('a committed field', () => {
  it('hands shortcuts with a modifier to the canvas', () => {
    assert.equal(committedFieldPasses(press('X', { shift: true, code: 'KeyX' })), true);
    assert.equal(committedFieldPasses(press('l', { meta: true })), true);
    assert.equal(committedFieldPasses(press(']', { meta: true })), true);
    assert.equal(committedFieldPasses(press('“', { alt: true, code: 'BracketLeft' })), true);
  });

  it('keeps typing, select all, the clipboard and Shift+arrows in the field', () => {
    assert.equal(committedFieldPasses(press('2')), false);
    assert.equal(committedFieldPasses(press('a', { meta: true })), false);
    assert.equal(committedFieldPasses(press('v', { meta: true })), false);
    assert.equal(committedFieldPasses(press('ArrowLeft', { shift: true })), false);
    assert.equal(committedFieldPasses(press('Shift', { shift: true })), false);
  });

  it('ends on a key that stays in the field, not on a modifier or a handed-off key', () => {
    assert.equal(endsCommitted(press('2')), true);
    assert.equal(endsCommitted(press('Enter')), true);
    assert.equal(endsCommitted(press('Shift', { shift: true })), false);
    assert.equal(endsCommitted(press('X', { shift: true })), false);
    assert.equal(endsCommitted(press('z', { meta: true })), false);
  });
});

describe('an open text box and canvas shortcuts', () => {
  it('writes the words first for keys that act on the selection', () => {
    for (const p of [press('Delete'), press('ArrowLeft'), press(']'), press('X', { shift: true, code: 'KeyX' }), press('ч', { shift: true, code: 'KeyX' }), press('d', { meta: true }), press('l', { meta: true }), press('A', { meta: true, shift: true }), press(']', { meta: true })]) {
      assert.equal(textHandoffOf(p, true), 'commit', JSON.stringify(p));
    }
    assert.equal(textHandoffOf(press('c', { meta: true }), false), 'commit');
    assert.equal(textHandoffOf(press('c', { meta: true }), true), null);
  });

  it('only writes the words for cut and paste', () => {
    assert.equal(textHandoffOf(press('x', { meta: true }), true), 'hold');
    assert.equal(textHandoffOf(press('v', { meta: true }), true), 'hold');
    assert.equal(textHandoffOf(press('v', { meta: true, shift: true }), true), null);
    assert.equal(textHandoffMessage(press('x', { meta: true }), true, true), 'Text updated. Press ⌘X again to cut');
    assert.equal(textHandoffMessage(press('v', { meta: true }), false, true), 'Text updated. Press Ctrl+V again to paste');
    assert.equal(textHandoffMessage(press('v', { meta: true }), true, false), 'Text updated');
  });

  it('leaves other keys alone', () => {
    assert.equal(textHandoffOf(press('a'), true), null);
    assert.equal(textHandoffOf(press('z', { meta: true }), true), null);
    assert.equal(textHandoffOf(press('Shift', { shift: true }), true), null);
  });
});
