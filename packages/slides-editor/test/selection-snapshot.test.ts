/**
 * The selection a Slides "Send to agent" names, as its `selectionSnapshot`: selected elements on their slide,
 * selected slides, else the slide on stage.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SlidesViewContext } from '@open-artifact/slides-core';
import { slidesSelectionSnapshot } from '../src/lib/selection-snapshot.ts';

const context = (over: Partial<SlidesViewContext>): SlidesViewContext =>
  ({ slideId: 's2', slideIndex: 2, slideCount: 8, selected: [], ...over }) as SlidesViewContext;

test('selected elements: labelled, counted, on their slide', () => {
  const snapshot = slidesSelectionSnapshot(
    context({ selected: ['s2/title', 's2/chart'], selection: [{ id: 's2/title', kind: 'text', label: 'Q3 results' }, { id: 's2/chart', kind: 'chart' }] } as Partial<SlidesViewContext>),
    2,
  );
  assert.deepEqual(snapshot, {
    kind: 'elements',
    label: '2 selected elements',
    count: 2,
    items: [{ id: 's2/title', kind: 'text', label: 'Q3 results' }, { id: 's2/chart', kind: 'chart' }],
    where: 'Slide 2 of 8',
  });
});

test('selected slides in the rail', () => {
  assert.deepEqual(slidesSelectionSnapshot(context({ selectedSlides: ['s1', 's3', 's4'], selectedCount: 3 }), 0), {
    kind: 'slides',
    label: '3 selected slides',
    count: 3,
    items: [{ id: 's1' }, { id: 's3' }, { id: 's4' }],
  });
});

test('nothing selected: the slide on stage; no slide: none', () => {
  assert.deepEqual(slidesSelectionSnapshot(context({ slideTitle: 'Q3 results' }), 0), {
    kind: 'slide',
    label: 'Slide 2 of 8',
    count: 1,
    items: [{ id: 's2', kind: 'slide', label: 'Q3 results' }],
  });
  assert.equal(slidesSelectionSnapshot(context({ slideId: null }), 0), null);
});
