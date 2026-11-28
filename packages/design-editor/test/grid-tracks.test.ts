import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readSpan, spanValue, trackCount, tracksShown, tracksValue } from '../src/lib/grid-tracks.ts';

describe('grid tracks', () => {
  it('reads equal tracks as a count', () => {
    assert.equal(trackCount('repeat(3, minmax(0, 1fr))'), 3);
    assert.equal(trackCount('repeat(4,minmax(0,1fr))'), 4);
    assert.equal(trackCount('repeat(2, 1fr)'), 2);
    assert.equal(trackCount('1fr 1fr 1fr'), 3);
    assert.equal(trackCount('100px 100px'), 2);
    assert.equal(trackCount('160px 1fr'), null);
    assert.equal(trackCount('repeat(auto-fill, minmax(120px, 1fr))'), null);
    assert.equal(trackCount(''), null);
    // A bare number or a negative one is no track: the browser drops such a list.
    assert.equal(trackCount('-2'), null);
    assert.equal(trackCount('2 2'), null);
    assert.equal(trackCount('0 0'), 2);
    assert.equal(tracksShown('160px 1fr'), '160px 1fr');
    assert.equal(tracksShown('1fr 1fr'), '2');
  });

  it('writes a count as equal tracks and keeps any other list', () => {
    assert.equal(tracksValue('3'), 'repeat(3, minmax(0, 1fr))');
    assert.equal(tracksValue('0'), 'repeat(1, minmax(0, 1fr))');
    assert.equal(tracksValue('40'), 'repeat(12, minmax(0, 1fr))');
    assert.equal(tracksValue('2.6'), 'repeat(3, minmax(0, 1fr))');
    assert.equal(tracksValue('160px 1fr'), '160px 1fr');
    assert.equal(tracksValue(' '), null);
    // Before, "-2" was written as it was (`grid-template-columns: -2`, which the browser drops) and the field showed 1.
    assert.equal(tracksValue('-2'), 'repeat(2, minmax(0, 1fr))');
    assert.equal(tracksValue('+4'), 'repeat(4, minmax(0, 1fr))');
  });

  it('reads a span with or without its start line', () => {
    assert.deepEqual(readSpan('auto'), { start: null, span: null });
    assert.deepEqual(readSpan(undefined), { start: null, span: null });
    assert.deepEqual(readSpan('3'), { start: '3', span: 1 });
    assert.deepEqual(readSpan('span 2'), { start: null, span: 2 });
    assert.deepEqual(readSpan('3 / span 2'), { start: '3', span: 2 });
    assert.deepEqual(readSpan('1 / 4'), { start: '1', span: 3 });
    // Lines counted from the end (or named) give no span the field could write back.
    assert.deepEqual(readSpan('1 / -1'), { start: '1', span: null });
    assert.deepEqual(readSpan('-3 / -1'), { start: '-3', span: null });
    assert.deepEqual(readSpan('0 / 2'), { start: '0', span: null });
  });

  it('writes a span, keeping the start line', () => {
    assert.equal(spanValue(undefined, '2'), 'span 2');
    assert.equal(spanValue('3', '2'), '3 / span 2');
    assert.equal(spanValue('3 / span 4', '1'), '3 / span 1');
    assert.equal(spanValue('span 4', ''), null);
    assert.equal(spanValue('3 / span 4', ''), '3');
    assert.equal(spanValue(undefined, '99'), 'span 12');
  });
});
