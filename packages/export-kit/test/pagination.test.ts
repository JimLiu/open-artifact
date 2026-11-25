import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { breakMargin, flowPages, flowPagesWithBreaks, PAPER, type Interval } from '../src/pagination.ts';

const PAGE = PAPER.letter.height;
const MARGIN = breakMargin(PAGE);

/** Text lines `height` tall every `step` px from `from` to `to`. */
const lines = (from: number, to: number, step = 24, height = 20): Interval[] => {
  const out: Interval[] = [];
  for (let y = from; y + height <= to; y += step) out.push([y, y + height]);
  return out;
};

describe('pagination with forced breaks', () => {
  it('is plain pagination when no break falls inside the content', () => {
    const measured = { contentHeight: 2400, bands: lines(40, 2380), blocks: [] };
    assert.deepEqual(flowPagesWithBreaks(measured, PAGE, []), flowPages(measured, PAGE));
    // At the top, past the end, and at the very end: nothing to break.
    assert.deepEqual(flowPagesWithBreaks(measured, PAGE, [0, 0.5, 2400, 5000]), flowPages(measured, PAGE));
  });

  it('starts a new page at a break, under the break margin', () => {
    const pages = flowPagesWithBreaks({ contentHeight: 900, bands: [...lines(40, 380), ...lines(400, 880)], blocks: [] }, PAGE, [400]);
    assert.deepEqual(pages, [
      { top: 0, bottom: 400, offset: 0 },
      { top: 400, bottom: 900, offset: MARGIN },
    ]);
  });

  it('takes breaks in any order and drops one within a pixel of another', () => {
    const pages = flowPagesWithBreaks({ contentHeight: 900, bands: [], blocks: [] }, PAGE, [600, 300, 300.4]);
    assert.deepEqual(pages.map((page) => [page.top, page.bottom]), [[0, 300], [300, 600], [600, 900]]);
  });

  it('paginates a long section between breaks on its own, covering the content once, with no cut inside a line', () => {
    const bands = [...lines(40, 380), ...lines(400, 3000)];
    const pages = flowPagesWithBreaks({ contentHeight: 3020, bands, blocks: [] }, PAGE, [400]);
    assert.ok(pages.length >= 4, JSON.stringify(pages));
    assert.equal(pages[0]!.bottom, 400);
    assert.equal(pages[1]!.top, 400);
    for (const [index, page] of pages.entries()) {
      if (index > 0) assert.equal(page.top, pages[index - 1]!.bottom, 'the pages leave a gap or overlap');
      assert.ok(page.offset + page.bottom - page.top <= PAGE + 0.5, `page ${index} holds more than a sheet: ${JSON.stringify(page)}`);
      assert.ok(!bands.some(([a, b]) => a < page.top && page.top < b), `page ${index} starts inside a line`);
    }
    assert.equal(pages.at(-1)!.bottom, 3020);
  });

  it('stops at the page limit', () => {
    const pages = flowPagesWithBreaks({ contentHeight: 5000, bands: [], blocks: [] }, PAGE, [1000, 2000, 3000, 4000], 3);
    assert.equal(pages.length, 3);
    assert.deepEqual(pages.map((page) => page.top), [0, 1000, 2000]);
  });

  it('keeps a heading with what follows inside a section', () => {
    // A heading at the foot of the section's first page moves to the next page with its first line.
    const heading = { top: 400 + 930, bottom: 400 + 960, from: 400 + 930, next: true, prev: false };
    const bands: Interval[] = [...lines(420, 400 + 920), [heading.top, heading.bottom], ...lines(400 + 970, 2600)];
    const pages = flowPagesWithBreaks({ contentHeight: 2620, bands, blocks: [heading] }, PAGE, [400]);
    assert.equal(pages[1]!.top, 400);
    assert.equal(pages[2]!.top, heading.top, JSON.stringify(pages));
  });
});
