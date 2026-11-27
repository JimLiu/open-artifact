import assert from 'node:assert/strict';
import { it } from 'node:test';
import { boardChromeBox } from '../src/lib/overlay.ts';

const viewport = { width: 1200, height: 800 };
const board = { x: 80, y: -20, w: 128, h: 100 };

it('projects artboard chrome and switches its actions at 64 CSS pixels', () => {
  assert.deepEqual(boardChromeBox({ x: 12.25, y: 25.5, zoom: 0.5 }, board, viewport), {
    left: 52.25, top: 15.5, width: 64, height: 50, compact: false,
  });
  assert.equal(boardChromeBox({ x: 12.25, y: 25.5, zoom: 0.499 }, board, viewport)?.compact, true);
  assert.equal(boardChromeBox({ x: 0, y: 0, zoom: 0.1875 }, board, viewport)?.width, 24);
  assert.equal(boardChromeBox({ x: 0, y: 0, zoom: 0.187 }, board, viewport), null);
});

it('clips artboard chrome at the viewport margin using the current camera', () => {
  assert.ok(boardChromeBox({ x: 1360, y: 1060, zoom: 1 }, board, viewport));
  assert.equal(boardChromeBox({ x: 1361, y: 1060, zoom: 1 }, board, viewport), null);
  assert.equal(boardChromeBox({ x: 1360, y: 1061, zoom: 1 }, board, viewport), null);
  assert.ok(boardChromeBox({ x: -448, y: -320, zoom: 1 }, board, viewport));
  assert.equal(boardChromeBox({ x: -449, y: -320, zoom: 1 }, board, viewport), null);
  assert.equal(boardChromeBox({ x: -448, y: -321, zoom: 1 }, board, viewport), null);
});
