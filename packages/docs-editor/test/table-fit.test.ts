import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { schema } from '../src/editor/schema.ts';
import { LEFT_GUTTER, SIDE_GUTTER, TABLE_LEAD, cellFit, columnWidths, fitStyle, fitTable, longestLine, longestWord, measureColumns, tableLead, tableRoom } from '../src/tables/fit.ts';

const cell = (text: string, attrs: Record<string, unknown> = {}) => schema.nodes.cell!.create(attrs, schema.nodes.paragraph!.create(null, text ? schema.text(text) : null));
const row = (...cells: ReturnType<typeof cell>[]) => schema.nodes.tableRow!.create(null, cells);

describe('a table fitting the page', () => {
  it('keeps a short cell on one line', () => {
    assert.deepEqual(cellFit(cell('Design System'), [0]), { wrap: 'words', chars: 13, min: null });
    assert.deepEqual(cellFit(cell('Slides'), [0]), { wrap: 'short', chars: 0, min: null });
    assert.deepEqual(cellFit(cell(''), [0]), { wrap: 'short', chars: 0, min: null });
  });

  it('wraps a long cell between words, or anywhere when a word is too long', () => {
    assert.deepEqual(cellFit(cell('A 1920×1080 deck: rail, overview, speaker notes'), [0]), { wrap: 'words', chars: 47, min: null });
    assert.equal(cellFit(cell('see https://example.com/a/very/long/path/to/somewhere'), [0]).wrap, null);
  });

  it('measures lines and words in characters, a line at most 99', () => {
    const lines = schema.nodes.cell!.create(null, schema.nodes.paragraph!.create(null, [schema.text('one two'), schema.nodes.hardBreak!.create(), schema.text('three')]));
    assert.equal(longestLine(lines), 7);
    assert.equal(longestWord(lines), 5);
    assert.equal(longestLine(cell('x'.repeat(300))), 99);
    assert.equal(longestLine(cell('表格默认')), 4);
  });

  it('keeps the set widths of its columns as the least, with 48 px for each other', () => {
    assert.equal(cellFit(cell('Slides'), [200]).min, 200);
    assert.equal(cellFit(cell('A long cell over two columns', { colspan: 2 }), [120, 0]).min, 168);
    // A cell over two columns is never "short".
    assert.equal(cellFit(cell('Hi', { colspan: 2 }), [0, 0]).wrap, 'words');
  });

  it('reads each column\'s set width from the cells over it', () => {
    const table = schema.nodes.table!.create(null, [
      row(cell('wide', { colspan: 2, colwidth: [120, 0] }), cell('c')),
      row(cell('a'), cell('b', { colwidth: [90] }), cell('c', { colwidth: [60] })),
    ]);
    assert.deepEqual(columnWidths(table), [120, 90, 60]);
  });

  it('leaves a table whose columns all have set widths as it is', () => {
    const set = schema.nodes.table!.create(null, [row(cell('a', { colwidth: [100] }), cell('b', { colwidth: [200] }))]);
    const some = schema.nodes.table!.create(null, [row(cell('a', { colwidth: [100] }), cell('Some longer words here'))]);
    assert.deepEqual(fitTable(set), []);
    assert.deepEqual(
      fitTable(some).map(({ left, right, wrap, style }) => ({ left, right, wrap, style })),
      [
        { left: 0, right: 1, wrap: 'short', style: '--fit-min: 100px' },
        { left: 1, right: 2, wrap: 'words', style: '--fit-chars: 22' },
      ],
    );
  });

  it('draws the measures for the stylesheet', () => {
    assert.equal(fitStyle({ wrap: 'words', chars: 47, min: null }), '--fit-chars: 47');
    assert.equal(fitStyle({ wrap: 'short', chars: 0, min: 200 }), '--fit-min: 200px');
  });
});

describe('how far a table of its own may grow', () => {
  it('reaches the comments column, from the text\'s left edge', () => {
    // Text 680 px wide from x 200; the box scrolls from x 0, 1600 wide, the comments column taking its last 320.
    assert.equal(tableRoom({ left: 200, width: 680 }, { left: 0, contentWidth: 1600, paddingRight: 320 }, 'rail'), 1600 - 320 - 200);
  });

  it('keeps a gutter for the markers, or at the page\'s edge', () => {
    assert.equal(tableRoom({ left: 200, width: 680 }, { left: 0, contentWidth: 1200, paddingRight: 0 }, 'icons'), 1200 - 200 - SIDE_GUTTER.icons);
    assert.equal(tableRoom({ left: 200, width: 680 }, { left: 0, contentWidth: 1200, paddingRight: 0 }, 'none'), 1200 - 200 - SIDE_GUTTER.none);
  });

  it('is never narrower than the text', () => {
    assert.equal(tableRoom({ left: 40, width: 680 }, { left: 0, contentWidth: 700, paddingRight: 0 }, 'none'), 680);
  });
});

describe('how far left of the text a table of its own may scroll', () => {
  it('reaches the left edge of the page\'s scrolling box, less a gutter', () => {
    // Text from x 457 in a box that scrolls from x 0 (or from x 240, beside a column of tabs).
    assert.equal(tableLead({ left: 457 }, { left: 0 }), 457 - LEFT_GUTTER);
    assert.equal(tableLead({ left: 697.6 }, { left: 240 }), Math.floor(697.6 - 240 - LEFT_GUTTER));
  });

  it('keeps at least the room for the row handles in a narrow window', () => {
    assert.equal(tableLead({ left: 52 }, { left: 0 }), TABLE_LEAD);
  });
});

describe('the widths a table keeps while the caret is in it', () => {
  it('takes each column from a cell over it alone', () => {
    assert.deepEqual(measureColumns([{ left: 0, right: 1, width: 120.4 }, { left: 1, right: 2, width: 30 }], 2), [120.4, 48]);
  });

  it('shares what a cell over several columns leaves among those not measured', () => {
    const cells = [
      { left: 0, right: 3, width: 300 },
      { left: 0, right: 1, width: 100 },
    ];
    assert.deepEqual(measureColumns(cells, 3), [100, 100, 100]);
  });

  it('measures nothing when a cell is not drawn', () => {
    assert.equal(measureColumns([{ left: 0, right: 1, width: null }], 1), null);
  });
});
