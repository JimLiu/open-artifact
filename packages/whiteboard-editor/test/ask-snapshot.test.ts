/**
 * What a whiteboard ask is about, as its `selectionSnapshot`: the selected elements, an area, a point, or (the whole
 * board) none.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askScopeSnapshot } from '../src/collab/ask-snapshot.ts';

test('a selection, an area and a point, each with their elements', () => {
  assert.deepEqual(askScopeSnapshot({ kind: 'selection', ids: ['n1', 'n2'], items: [{ id: 'n1', kind: 'sticky', label: 'Idea' }] }), {
    kind: 'elements',
    label: '2 selected elements',
    count: 2,
    items: [{ id: 'n1', kind: 'sticky', label: 'Idea' }, { id: 'n2' }],
  });
  assert.equal(askScopeSnapshot({ kind: 'area', ids: ['n1'] })!.label, 'Area with 1 element');
  assert.equal(askScopeSnapshot({ kind: 'point', ids: ['n1', 'n2', 'n3'] })!.label, '3 elements at a point');
});

test('the whole board, or an empty area: none', () => {
  assert.equal(askScopeSnapshot({ kind: 'board' }), null);
  assert.equal(askScopeSnapshot({ kind: 'area', ids: [] }), null);
});
