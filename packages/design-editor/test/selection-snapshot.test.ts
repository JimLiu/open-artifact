/**
 * The selection a Design "Send to agent" names, as its `selectionSnapshot`: the selected elements with the view
 * context's labels and the page, else the selected artboards, else none.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesignViewContext } from '@open-artifact/design-core';
import { designSelectionSnapshot } from '../src/lib/selection-snapshot.ts';

const context = (over: Partial<DesignViewContext>): DesignViewContext => ({ selected: [], selectedArtboards: [], pageName: 'Home', ...over }) as DesignViewContext;

test('selected elements: labelled, counted, on their page', () => {
  const snapshot = designSelectionSnapshot(
    context({
      selected: ['board/hero', 'board/cta', 'board/logo'],
      selection: [
        { id: 'board/hero', kind: 'text', label: 'Welcome' },
        { id: 'board/cta', kind: 'button', label: 'Start' },
      ],
    } as Partial<DesignViewContext>),
    3,
  );
  assert.deepEqual(snapshot, {
    kind: 'elements',
    label: '3 selected elements',
    count: 3,
    items: [
      { id: 'board/hero', kind: 'text', label: 'Welcome' },
      { id: 'board/cta', kind: 'button', label: 'Start' },
      { id: 'board/logo' },
    ],
    where: 'Page "Home"',
  });
});

test('selected artboards, else nothing', () => {
  assert.deepEqual(designSelectionSnapshot(context({ selectedArtboards: ['a.dc', 'b.dc'] }), 0), {
    kind: 'artboards',
    label: '2 selected artboards',
    count: 2,
    items: [{ id: 'a.dc' }, { id: 'b.dc' }],
    where: 'Page "Home"',
  });
  assert.equal(designSelectionSnapshot(context({}), 0), null);
});
