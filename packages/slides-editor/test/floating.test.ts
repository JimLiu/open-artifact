import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeFloatingAcross, placeFloatingToolbar, stripMiddle, type FloatingLayout } from '../src/lib/floating.ts';

const base: Omit<FloatingLayout, 'selTop' | 'selBottom'> = { menuH: 40, bandTop: 60, bandBottom: 700, caret: () => null };

describe('placeFloatingToolbar', () => {
  it('sits 10px above the selection when there is room', () => {
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 300, selBottom: 400 }), { top: 250, placed: 'above', overlaps: false });
  });

  it('goes below when the selection is near the top', () => {
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 90, selBottom: 400 }), { top: 410, placed: 'below', overlaps: false });
  });

  it('pins to the top when the selection fills the view and no caret is known', () => {
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 70, selBottom: 690 }), { top: 68, placed: 'above', overlaps: true });
  });

  it('stays clear of the caret line inside a tall selection', () => {
    const caret = (): { top: number; bottom: number } => ({ top: 80, bottom: 110 });
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 70, selBottom: 690, caret }), { top: 120, placed: 'below', overlaps: true });
  });

  it('keeps above the caret when the caret is low enough', () => {
    const caret = (): { top: number; bottom: number } => ({ top: 400, bottom: 430 });
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 70, selBottom: 690, caret }), { top: 68, placed: 'above', overlaps: true });
  });
});

describe('placeFloatingAcross', () => {
  it('centers the toolbar on the middle it is given', () => {
    assert.equal(placeFloatingAcross(500, 300, 100, 900), 350);
  });

  it('keeps 8px inside the band on both sides', () => {
    assert.equal(placeFloatingAcross(150, 300, 100, 900), 108);
    assert.equal(placeFloatingAcross(850, 300, 100, 900), 592);
  });

  it('starts at the band’s left margin when it is wider than the band', () => {
    assert.equal(placeFloatingAcross(500, 1000, 100, 900), 108);
  });

  it('rounds to whole pixels', () => {
    assert.equal(placeFloatingAcross(500.4, 301, 100, 900), 350);
  });
});

describe('stripMiddle', () => {
  const spot = { key: 'a', left: 100, width: 200, middle: 200 };

  it('is the selection’s middle when nothing holds the strip', () => {
    assert.equal(stripMiddle(spot, 'a', 140, 260, false), 270);
    assert.equal(stripMiddle(null, 'a', 140, 260, true), 270);
  });

  it('follows a held selection that moved', () => {
    assert.equal(stripMiddle(spot, 'a', 130, 200, true), 230);
  });

  it('stays put when a held selection changes size', () => {
    assert.equal(stripMiddle(spot, 'a', 100, 320, true), 200);
    assert.equal(stripMiddle(spot, 'a', 60, 280, true), 200);
  });

  it('keeps an off-center spot while the selection only moves', () => {
    const off = { key: 'a', left: 100, width: 320, middle: 200 };
    assert.equal(stripMiddle(off, 'a', 110, 320, true), 210);
  });

  it('recenters over another selection', () => {
    assert.equal(stripMiddle(spot, 'b', 400, 100, true), 450);
  });
});
