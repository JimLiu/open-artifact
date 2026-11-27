import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { outlineKeepsKey, outlineKeyStep, parentRowOf, type OutlinePress } from '../src/lib/outline-keys.ts';

const press = (key: string, mods: Partial<OutlinePress> = {}): OutlinePress => ({ key, shift: false, meta: false, alt: false, ...mods });
// An open artboard with an open frame holding two layers, then a closed artboard.
const rows = [
  { level: 1, expandable: true, open: true },
  { level: 2, expandable: true, open: true },
  { level: 3, expandable: false, open: false },
  { level: 3, expandable: false, open: false },
  { level: 1, expandable: true, open: false },
];

describe('keys on a row of the layers list', () => {
  it('walks the visible rows and stops at the ends', () => {
    assert.deepEqual(outlineKeyStep(rows, 0, press('ArrowDown')), { kind: 'focus', index: 1 });
    assert.deepEqual(outlineKeyStep(rows, 3, press('ArrowUp')), { kind: 'focus', index: 2 });
    assert.equal(outlineKeyStep(rows, 4, press('ArrowDown')), null);
    assert.equal(outlineKeyStep(rows, 0, press('ArrowUp')), null);
    assert.deepEqual(outlineKeyStep(rows, 2, press('Home')), { kind: 'focus', index: 0 });
    assert.deepEqual(outlineKeyStep(rows, 2, press('End')), { kind: 'focus', index: 4 });
  });

  it('opens a closed row, then steps into it; closes an open one, then steps out', () => {
    assert.deepEqual(outlineKeyStep(rows, 4, press('ArrowRight')), { kind: 'open', open: true });
    assert.deepEqual(outlineKeyStep(rows, 1, press('ArrowRight')), { kind: 'focus', index: 2 });
    assert.equal(outlineKeyStep(rows, 2, press('ArrowRight')), null);
    assert.deepEqual(outlineKeyStep(rows, 1, press('ArrowLeft')), { kind: 'open', open: false });
    assert.deepEqual(outlineKeyStep(rows, 3, press('ArrowLeft')), { kind: 'focus', index: 1 });
    assert.equal(outlineKeyStep(rows, 4, press('ArrowLeft')), null);
  });

  it('selects with Enter, adds with Shift or ⌘ Space, and renames with F2', () => {
    assert.deepEqual(outlineKeyStep(rows, 2, press('Enter')), { kind: 'select', additive: false });
    assert.equal(outlineKeyStep(rows, 2, press('Enter', { shift: true })), null);
    assert.deepEqual(outlineKeyStep(rows, 2, press(' ')), { kind: 'select', additive: false });
    assert.deepEqual(outlineKeyStep(rows, 2, press(' ', { shift: true })), { kind: 'select', additive: true });
    assert.deepEqual(outlineKeyStep(rows, 2, press(' ', { meta: true })), { kind: 'select', additive: true });
    assert.deepEqual(outlineKeyStep(rows, 2, press('F2')), { kind: 'rename' });
  });

  it('leaves the canvas its keys', () => {
    assert.equal(outlineKeepsKey(press('Delete')), false);
    assert.equal(outlineKeepsKey(press('c', { meta: true })), false);
    assert.equal(outlineKeepsKey(press('ArrowUp', { meta: true })), false);
    assert.equal(outlineKeepsKey(press('ArrowUp', { alt: true })), false);
    assert.equal(outlineKeepsKey(press('ArrowUp', { shift: true })), true);
    assert.equal(outlineKeepsKey(press(' ')), true);
  });

  it('finds the row a row sits in', () => {
    assert.equal(parentRowOf(rows, 3), 1);
    assert.equal(parentRowOf(rows, 1), 0);
    assert.equal(parentRowOf(rows, 4), -1);
  });
});
