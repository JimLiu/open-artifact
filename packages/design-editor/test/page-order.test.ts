import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DRAG_SCROLL_STEP, dragScrollStep, dropKeepsOrder, dropLine, pageAfterDrop, pageDropIndex } from '../src/lib/page-order.ts';

// Three 28px rows with 2px between them.
const rows = [
  { top: 0, bottom: 28 },
  { top: 30, bottom: 58 },
  { top: 60, bottom: 88 },
];

describe('page row drag', () => {
  it('lands before a row over its upper half and after it over the lower half', () => {
    assert.equal(pageDropIndex(rows, -20), 0);
    assert.equal(pageDropIndex(rows, 10), 0);
    assert.equal(pageDropIndex(rows, 20), 1);
    assert.equal(pageDropIndex(rows, 29), 1);
    assert.equal(pageDropIndex(rows, 50), 2);
    assert.equal(pageDropIndex(rows, 80), 3);
    assert.equal(pageDropIndex(rows, 400), 3);
  });

  it('knows which drops keep the order', () => {
    assert.equal(dropKeepsOrder(1, 1), true);
    assert.equal(dropKeepsOrder(1, 2), true);
    assert.equal(dropKeepsOrder(1, 0), false);
    assert.equal(dropKeepsOrder(1, 3), false);
  });

  it('turns a gap into the page to follow', () => {
    const ids = ['a', 'b', 'c'];
    assert.equal(pageAfterDrop(ids, 2, 0), null);
    assert.equal(pageAfterDrop(ids, 2, 1), 'a');
    assert.equal(pageAfterDrop(ids, 0, 2), 'b');
    assert.equal(pageAfterDrop(ids, 0, 3), 'c');
    assert.equal(pageAfterDrop(ids, 1, 0), null);
    assert.equal(pageAfterDrop(ids, 1, 1), undefined);
    assert.equal(pageAfterDrop(ids, 1, 2), undefined);
  });

  it('draws the line on the edge of the row it lands by, and none when nothing moves', () => {
    assert.equal(dropLine(rows, 2, 0), 0);
    assert.equal(dropLine(rows, 0, 2), 60);
    assert.equal(dropLine(rows, 0, 3), 88);
    assert.equal(dropLine(rows, 0, 1), null);
    assert.equal(dropLine([], 0, 0), null);
  });

  it('scrolls near the edges and a little past them', () => {
    const list = { top: 100, bottom: 300 };
    assert.equal(dragScrollStep(list, 200), 0);
    assert.equal(dragScrollStep(list, 110), -DRAG_SCROLL_STEP);
    assert.equal(dragScrollStep(list, 90), -DRAG_SCROLL_STEP);
    assert.equal(dragScrollStep(list, 290), DRAG_SCROLL_STEP);
    assert.equal(dragScrollStep(list, 310), DRAG_SCROLL_STEP);
    assert.equal(dragScrollStep(list, 50), 0);
    assert.equal(dragScrollStep(list, 400), 0);
  });
});
