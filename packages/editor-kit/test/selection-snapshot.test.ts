/**
 * `selectionSnapshotOf`: the selection a request names, shaped for the app that shows it beside the person's words.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectionSnapshotOf } from '../src/agent.ts';

test('a label from the noun and count, items kept to 20, count at least the items', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, kind: 'text' }));
  const snapshot = selectionSnapshotOf({ kind: 'elements', noun: 'element', count: 25, items, where: 'Page "Home"' })!;
  assert.equal(snapshot.label, '25 selected elements');
  assert.equal(snapshot.items!.length, 20);
  assert.equal(snapshot.count, 25);
  assert.equal(snapshot.where, 'Page "Home"');
  assert.equal(selectionSnapshotOf({ kind: 'elements', noun: 'element', items: [{ id: 'a' }] })!.label, '1 selected element');
  assert.equal(selectionSnapshotOf({ kind: 'elements', count: 1, items: [{ id: 'a' }, { id: 'b' }] })!.count, 2);
});

test('a given label wins; nothing selected is null', () => {
  assert.deepEqual(selectionSnapshotOf({ kind: 'cells', label: 'B2:C4', count: 1 }), { kind: 'cells', label: 'B2:C4', count: 1 });
  assert.equal(selectionSnapshotOf({ kind: 'elements', items: [] }), null);
  assert.equal(selectionSnapshotOf({ kind: 'elements', items: [{ id: '' }] }), null);
});
