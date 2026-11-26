import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UndoStack, type UndoDeclined } from '../src/engine/undo-stack.ts';

test('an undo that declines says why, and the entry stays or goes as it asks', () => {
  const stack = new UndoStack();
  let answer: UndoDeclined | undefined = { said: 'not now', keep: true };
  let undone = 0;
  stack.push({ label: 'trim', undo: () => answer ?? void undone++, redo: () => undefined });
  assert.equal(stack.undo()?.label, 'trim');
  assert.deepEqual(stack.declined, { said: 'not now', keep: true });
  assert.equal(stack.canUndo, true, 'kept: it can be tried again');
  assert.equal(stack.canRedo, false);
  answer = undefined;
  stack.undo();
  assert.equal(stack.declined, null);
  assert.equal(undone, 1);
  assert.equal(stack.canRedo, true);
});

test('a redo that declines without keeping drops the entry', () => {
  const stack = new UndoStack();
  stack.push({ label: 'split', undo: () => undefined, redo: () => ({ said: 'changed since', keep: false }) });
  stack.undo();
  assert.equal(stack.redo()?.label, 'split');
  assert.equal(stack.declined?.said, 'changed since');
  assert.equal(stack.canRedo, false);
  assert.equal(stack.canUndo, false);
});
