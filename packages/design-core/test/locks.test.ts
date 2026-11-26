import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  anyLockedObject,
  emptyCanvas,
  isLockedObject,
  mergeCanvas,
  normalizeCanvas,
  serializeCanvas,
  setObjectLocks,
  unlockedObjects,
  withoutLock,
  type Canvas,
} from '../src/index.ts';

function canvasWith(): Canvas {
  const canvas = emptyCanvas('T');
  canvas.boards['A.dc.html'] = { x: 0, y: 0, w: 400, h: 300 };
  canvas.boards['B.dc.html'] = { x: 500, y: 0, w: 400, h: 300, locked: true };
  canvas.order = ['A.dc.html', 'B.dc.html'];
  canvas.notes = { n1: { x: 0, y: 400, text: 'One' }, n2: { x: 300, y: 400, text: 'Two', locked: true } };
  return canvas;
}

describe('canvas locks', () => {
  it('reads only `true` as locked', () => {
    assert.equal(isLockedObject({ locked: true }), true);
    assert.equal(isLockedObject({ locked: false }), false);
    assert.equal(isLockedObject({}), false);
    assert.equal(isLockedObject(undefined), false);
  });

  it('lists what is locked and what is not', () => {
    const canvas = canvasWith();
    assert.deepEqual(unlockedObjects(canvas, ['A.dc.html', 'B.dc.html'], ['n1', 'n2']), { boards: ['A.dc.html'], notes: ['n1'] });
    assert.equal(anyLockedObject(canvas, ['A.dc.html'], ['n1']), false);
    assert.equal(anyLockedObject(canvas, ['A.dc.html'], ['n2']), true);
  });

  it('locks with `true` and unlocks by removing the key', () => {
    const canvas = canvasWith();
    const locked = setObjectLocks(canvas, ['A.dc.html'], ['n1'], true);
    assert.equal(locked.boards['A.dc.html']!.locked, true);
    assert.equal(locked.notes.n1!.locked, true);
    const unlocked = setObjectLocks(locked, ['A.dc.html', 'B.dc.html'], ['n1', 'n2'], false);
    for (const entry of [...Object.values(unlocked.boards), ...Object.values(unlocked.notes)]) assert.equal('locked' in entry, false);
    assert.equal(serializeCanvas(unlocked).includes('"locked"'), false);
  });

  it('removes a `false` lock when unlocking and returns the same canvas when nothing changes', () => {
    const canvas = canvasWith();
    assert.equal(setObjectLocks(canvas, ['B.dc.html'], ['n2'], true), canvas);
    assert.equal(setObjectLocks(canvas, ['A.dc.html'], ['n1'], false), canvas);
    canvas.notes.n1 = { ...canvas.notes.n1!, locked: false };
    const next = setObjectLocks(canvas, [], ['n1'], false);
    assert.notEqual(next, canvas);
    assert.equal('locked' in next.notes.n1!, false);
  });

  it('copies entries without their lock', () => {
    const entry = { x: 1, y: 2, w: 3, h: 4, locked: true };
    assert.deepEqual(withoutLock(entry), { x: 1, y: 2, w: 3, h: 4 });
    assert.equal(entry.locked, true);
    const plain: { x: number; locked?: boolean } = { x: 1 };
    assert.equal(withoutLock(plain), plain);
  });

  it('keeps locks through normalizing, serializing and merging', () => {
    const canvas = normalizeCanvas(JSON.parse(serializeCanvas(canvasWith())));
    assert.equal(canvas.boards['B.dc.html']!.locked, true);
    assert.equal(canvas.notes.n2!.locked, true);
    const ours = setObjectLocks(canvas, ['A.dc.html'], [], true);
    const theirs = setObjectLocks(canvas, [], ['n2'], false);
    const merged = mergeCanvas(canvas, ours, theirs);
    assert.equal(merged.boards['A.dc.html']!.locked, true);
    assert.equal(merged.boards['B.dc.html']!.locked, true);
    assert.equal('locked' in merged.notes.n2!, false);
  });
});
