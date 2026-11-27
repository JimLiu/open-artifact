import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { measureGaps, measureTargets } from '../src/lib/distances.ts';

/** The gaps as `axis:from→to@at=value` strings, leads appended. */
function brief(gaps: ReturnType<typeof measureGaps>): string[] {
  return gaps.map((g) => `${g.axis}:${g.from}→${g.to}@${g.at}=${g.value}${g.lead ? ` lead ${g.lead.from}→${g.lead.to}` : ''}`);
}

describe('measureGaps', () => {
  it('measures all four sides of a box inside another', () => {
    const gaps = measureGaps({ x: 100, y: 100, w: 200, h: 100 }, { x: 0, y: 0, w: 1000, h: 500 });
    assert.deepEqual(brief(gaps), ['x:100→0@150=100', 'x:300→1000@150=700', 'y:100→0@200=100', 'y:200→500@200=300']);
  });

  it('measures like edges of two crossing boxes, through the part they share', () => {
    const gaps = measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 });
    assert.deepEqual(brief(gaps), ['x:0→50@75=50', 'x:100→150@75=50', 'y:0→50@75=50', 'y:100→150@75=50']);
  });

  it('measures only the gap between boxes side by side', () => {
    const gaps = measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 20, w: 50, h: 50 });
    assert.deepEqual(brief(gaps), ['x:100→300@45=200']);
  });

  it('draws a lead out to a box the gap line passes beside', () => {
    const gaps = measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 300, w: 50, h: 50 });
    assert.deepEqual(brief(gaps), ['x:100→300@50=200 lead 50→300', 'y:100→300@50=200 lead 50→300']);
  });

  it('leads back up to a box above the line', () => {
    const gaps = measureGaps({ x: 0, y: 200, w: 100, h: 100 }, { x: 300, y: 0, w: 50, h: 50 });
    assert.deepEqual(brief(gaps), ['x:100→300@250=200 lead 50→250', 'y:200→50@50=150 lead 50→300']);
  });

  it('counts a line lying on the other box’s edge as overlapping it', () => {
    const gaps = measureGaps({ x: 100, y: 0, w: 0, h: 200 }, { x: 100, y: 50, w: 200, h: 100 });
    assert.deepEqual(brief(gaps), ['x:100→300@100=200', 'y:0→50@100=50', 'y:200→150@100=50']);
  });

  it('does not count boxes that only touch as overlapping', () => {
    const gaps = measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 100, h: 100 });
    assert.deepEqual(brief(gaps), []);
  });

  it('rounds to whole pixels and leaves out gaps under one', () => {
    assert.deepEqual(brief(measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 100.4, y: 0, w: 50, h: 100 })), []);
    assert.deepEqual(
      measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 100.6, y: 0, w: 50, h: 100 }).map((g) => g.value),
      [1],
    );
  });
});

describe('measureTargets', () => {
  it('starts with the hovered element, then the containers of the first selected', () => {
    assert.deepEqual(measureTargets([[2, 1, 0]], [4]), [[4], [2, 1], [2]]);
  });

  it('skips the hovered element when it is selected', () => {
    assert.deepEqual(measureTargets([[3], [2, 1]], [2, 1]), []);
    assert.deepEqual(measureTargets([[2, 1]], [2, 1]), [[2]]);
  });

  it('leaves a top-level selection with nothing but the slide', () => {
    assert.deepEqual(measureTargets([[0]], null), []);
  });
});
