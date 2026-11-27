import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyCanvas, type Canvas } from '@open-artifact/design-core';
import { parseTemplate } from '@open-artifact/dc';
import { rowsCanLeave, takesRows, type IntoView } from '../src/lib/outline-into.ts';

const canvas = (): Canvas => ({
  ...emptyCanvas(),
  boards: {
    'A.dc.html': { x: 0, y: 0, w: 400, h: 400 },
    'B.dc.html': { x: 500, y: 0, w: 400, h: 400 },
    'Locked.dc.html': { x: 1000, y: 0, w: 200, h: 200, locked: true },
    'Piece.dc.html': { x: 0, y: 500, w: 20, h: 20, frameless: true },
  },
  order: ['A.dc.html', 'B.dc.html', 'Locked.dc.html', 'Piece.dc.html'],
});
const view: IntoView = { mode: 'canvas', focused: null, playing: null };

describe('which artboard takes rows dragged in the layers list', () => {
  it('takes rows from another artboard, and notes', () => {
    assert.equal(takesRows(canvas(), 'B.dc.html', 'A.dc.html', view), true);
    assert.equal(takesRows(canvas(), 'B.dc.html', null, view), true);
    assert.equal(takesRows(canvas(), 'B.dc.html', 'Piece.dc.html', view), true);
  });

  it('refuses the artboard the rows are in, pieces, locked and missing artboards', () => {
    assert.equal(takesRows(canvas(), 'A.dc.html', 'A.dc.html', view), false);
    assert.equal(takesRows(canvas(), 'Piece.dc.html', 'A.dc.html', view), false);
    assert.equal(takesRows(canvas(), 'Locked.dc.html', 'A.dc.html', view), false);
    assert.equal(takesRows(canvas(), 'Gone.dc.html', 'A.dc.html', view), false);
  });

  it('refuses the artboard in the focused view and the one playing', () => {
    assert.equal(takesRows(canvas(), 'B.dc.html', 'A.dc.html', { mode: 'focused', focused: 'B.dc.html', playing: null }), false);
    assert.equal(takesRows(canvas(), 'B.dc.html', 'A.dc.html', { mode: 'canvas', focused: null, playing: 'B.dc.html' }), false);
  });
});

describe('which rows may leave their artboard', () => {
  it('keeps hidden layers and shapes inside a drawing where they are', () => {
    const model = parseTemplate('<div><p id="a">A</p><p style="display: none">B</p><svg><circle r="4"></circle><rect width="2" height="2"></rect></svg></div>');
    const tid = (tag: string, nth = 0) => [...model.tidOf.entries()].filter(([element]) => element.tag === tag)[nth]![1];
    assert.equal(rowsCanLeave(model, [tid('p')]), true);
    assert.equal(rowsCanLeave(model, [tid('p'), tid('p', 1)]), false);
    assert.equal(rowsCanLeave(model, [tid('circle')]), false);
    assert.equal(rowsCanLeave(model, [tid('svg')]), true);
  });
});
