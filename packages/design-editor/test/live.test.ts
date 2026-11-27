import assert from 'node:assert/strict';
import { it } from 'node:test';
import { emptyCanvas } from '@open-artifact/design-core';
import { liveViewportEnabled, nearbyLiveBoards } from '../src/lib/scene.ts';

it('keeps the live view through ordinary zoom and the overview through small reversals at its cutoff', () => {
  const zooms = [0.6, 0.31, 0.3, 0.299, 0.305, 0.298, 0.319, 0.32, 0.301, 0.28, 0.5];
  let live = true;
  const states = zooms.map((zoom) => (live = liveViewportEnabled(zoom, live)));
  assert.deepEqual(states, [true, true, true, false, false, false, false, true, true, false, true]);
});

it('admits only the 16 nearest artboards on the current page of a 100-board canvas', () => {
  const canvas = emptyCanvas();
  canvas.pages = [{ id: 'main', name: 'Main' }, { id: 'other', name: 'Other' }];
  const boardPaths = Array.from({ length: 98 }, (_, i) => `Board-${i}.dc.html`);
  for (const [i, path] of boardPaths.entries()) canvas.boards[path] = { x: 480 + i * 12, y: 480, w: 40, h: 40, page: 'main' };
  canvas.boards['Other.dc.html'] = { x: 480, y: 480, w: 40, h: 40, page: 'other' };
  canvas.boards['Far.dc.html'] = { x: 1500, y: 480, w: 40, h: 40, page: 'main' };
  canvas.order = ['Other.dc.html', 'Far.dc.html', ...boardPaths.toReversed()];

  assert.deepEqual(nearbyLiveBoards(canvas, 'main', { x: 0, y: 0, w: 1000, h: 1000 }), boardPaths.slice(0, 16));
  assert.deepEqual(nearbyLiveBoards(canvas, 'main', { x: 0, y: 0, w: 400, h: 400 }), boardPaths.slice(0, 10));
});
