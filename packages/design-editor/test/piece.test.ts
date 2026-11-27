import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDesignProject } from '@open-artifact/design-core';
import { outlineReach, pieceBox, piecePatch, pieceSource, pieceTitle } from '../src/lib/piece.ts';

describe('a piece made from an element', () => {
  it('is titled by its tag', () => {
    assert.equal(pieceTitle('div'), 'Div');
    assert.equal(pieceTitle('IMG'), 'Img');
  });

  it('takes in the element’s outline', () => {
    assert.equal(outlineReach({ 'outline-style': 'none', 'outline-width': '3px' }), 0);
    assert.equal(outlineReach({ 'outline-style': 'solid', 'outline-width': '2px', 'outline-offset': '4px' }), 6);
    assert.deepEqual(pieceBox({ x: 100, y: 50, w: 80, h: 40 }, 6), { x: 94, y: 44, w: 92, h: 52 });
  });

  it('stands alone at its size, out of the artboard’s positioning and margins', () => {
    assert.deepEqual(piecePatch({ width: 120, height: 30 }, 'static', { 'margin-top': '8px', color: 'red' }), {
      'margin-top': null, 'box-sizing': 'border-box', width: '120px', margin: '0px',
    });
    assert.deepEqual(piecePatch({ width: 120, height: 30 }, 'absolute', {}), {
      position: null, left: null, top: null, right: null, bottom: null, inset: null, 'box-sizing': 'border-box', width: '120px', margin: '0px', height: '30px',
    });
  });

  it('is a file the project check takes, listed frameless on the canvas', () => {
    const source = pieceSource({ title: 'Div', width: 92, height: 52, html: '<div style="width: 80px">Hi</div>', helmet: '<style>\n.card { color: red }\n</style>', reach: 6 });
    assert.match(source, /<helmet><style>body \{ margin: 0; padding: 6px; \}<\/style>\n<style>/);
    const canvas = JSON.stringify({ v: 3, createdOnFiles: { v: 1, at: '2026-11-27T00:00:00Z' }, title: 'T', boards: { 'Piece.dc.html': { x: 0, y: 0, w: 92, h: 52, title: 'Div', frameless: true } }, order: ['Piece.dc.html'], notes: {} });
    const problems = checkDesignProject(new Map([['canvas.json', canvas], ['Piece.dc.html', source]]));
    assert.deepEqual(problems, []);
  });
});
