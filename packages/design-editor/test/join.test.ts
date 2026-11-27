import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyCanvas, type Canvas } from '@open-artifact/design-core';
import { allLoose, inPlaceCentre, joinMessages, joinTargetAt } from '../src/lib/join.ts';

const canvas = (): Canvas => ({
  ...emptyCanvas(),
  boards: {
    'Back.dc.html': { x: 0, y: 0, w: 400, h: 400 },
    'Front.dc.html': { x: 100, y: 100, w: 200, h: 200 },
    'Locked.dc.html': { x: 1000, y: 0, w: 200, h: 200, locked: true },
    'Piece.dc.html': { x: 150, y: 150, w: 20, h: 20, frameless: true },
  },
  order: ['Back.dc.html', 'Front.dc.html', 'Locked.dc.html', 'Piece.dc.html'],
});

describe('which artboard dragged notes and pieces join', () => {
  it('takes the topmost framed artboard under the pointer, looking past pieces', () => {
    const c = canvas();
    const notes = { boards: [], notes: ['n1'] };
    assert.equal(joinTargetAt(c, c.order, { x: 160, y: 160 }, notes), 'Front.dc.html');
    assert.equal(joinTargetAt(c, c.order, { x: 50, y: 50 }, notes), 'Back.dc.html');
    assert.equal(joinTargetAt(c, c.order, { x: 600, y: 50 }, notes), null);
  });

  it('refuses a locked artboard instead of falling through to one below', () => {
    const c = canvas();
    assert.equal(joinTargetAt(c, c.order, { x: 1100, y: 100 }, { boards: [], notes: ['n1'] }), null);
  });

  it('only takes notes and pieces, never a framed artboard dragged with them', () => {
    const c = canvas();
    assert.equal(allLoose(c, { boards: ['Piece.dc.html'], notes: [] }), true);
    assert.equal(allLoose(c, { boards: ['Front.dc.html'], notes: ['n1'] }), false);
    assert.equal(allLoose(c, { boards: [], notes: [] }), false);
    assert.equal(joinTargetAt(c, c.order, { x: 50, y: 50 }, { boards: ['Front.dc.html'], notes: [] }), null);
  });
});

describe('joining in place', () => {
  it('centres the layers where they were dropped, in the container’s padding box', () => {
    // Dropped at 140..180 × 120..140 on an artboard at (100, 100) whose container starts 8px in.
    assert.deepEqual(inPlaceCentre({ x: 140, y: 120, w: 40, h: 20 }, { x: 100, y: 100 }, { x: 8, y: 8 }), { x: 52, y: 22 });
  });

  it('says why nothing moved', () => {
    assert.equal(joinMessages.pieceCount(3), 'Nothing moved. This piece holds 3 elements. A piece with one element can join an artboard.');
    assert.equal(joinMessages.nothing('note'), 'Nothing moved. This note has nothing that can go into an artboard.');
    assert.equal(joinMessages.stuck('image'), 'Nothing moved. The image couldn’t leave the canvas.');
    assert.equal(joinMessages.moved('Home'), 'Moved into Home');
  });
});
