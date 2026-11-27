import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boardTitleRect, revealCamera } from '../src/services/viewport.ts';

const size = { width: 1000, height: 800 };
const top = 56;

describe('Revealing an artboard title to rename it', () => {
  it('sits just above the artboard and keeps its screen size at any zoom', () => {
    assert.deepEqual(boardTitleRect({ x: 100, y: 200, w: 800, h: 600 }, 2), { x: 100, y: 184, w: 120, h: 20 });
    assert.deepEqual(boardTitleRect({ x: 0, y: 0, w: 100, h: 50 }, 1), { x: 0, y: -32, w: 100, h: 40 });
  });

  it('leaves the camera alone when the title is already in view', () => {
    const camera = { x: 0, y: 100, zoom: 1 };
    assert.equal(revealCamera(camera, { x: 100, y: 0, w: 240, h: 40 }, size, top), camera);
  });

  it('centres the title below the toolbar at the same zoom when it is off screen', () => {
    const next = revealCamera({ x: 0, y: -2000, zoom: 2 }, { x: 100, y: -16, w: 120, h: 20 }, size, top);
    assert.equal(next.zoom, 2);
    assert.equal(next.x + 160 * 2, size.width / 2);
    assert.equal(next.y + -6 * 2, top + (size.height - top) / 2);
  });

  it('counts the space under the toolbar as hidden', () => {
    const camera = { x: 0, y: 30, zoom: 1 };
    assert.notEqual(revealCamera(camera, { x: 100, y: 0, w: 240, h: 40 }, size, top), camera);
  });

  it('settles for the centre of a title box wider than the window', () => {
    const camera = { x: 0, y: 100, zoom: 1 };
    assert.equal(revealCamera(camera, { x: -400, y: 0, w: 2000, h: 40 }, size, top), camera);
  });
});
