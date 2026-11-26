import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileSlide, insertTableColumn, updateNodeAt, type TableNode } from '@open-artifact/slides-core';
import { tableTarget } from '../src/lib/table-target.ts';
import { cellSelector, outlinedCell } from '../src/lib/menu-cell.ts';

const slide = compileSlide('<section id="s">\n  <table>\n    <tr><th>Year</th><th>Total</th></tr>\n    <tr><td>2024</td><td>12</td></tr>\n  </table>\n</section>\n', { id: 's', lints: false }).slide;
const table = slide.children[0] as TableNode;

describe('the cell outlined under a table menu', () => {
  it('is the cell being typed in while its table is unchanged', () => {
    assert.deepEqual(outlinedCell(tableTarget('s', [0], table, [1, 0]), 's', slide), [1, 0]);
  });

  it('is none when the menu acts on the whole table, or nothing is open', () => {
    assert.equal(outlinedCell(tableTarget('s', [0], table), 's', slide), null);
    assert.equal(outlinedCell(null, 's', slide), null);
  });

  it('goes away once the table is reshaped or another slide is shown', () => {
    const target = tableTarget('s', [0], table, [1, 1]);
    const wider = updateNodeAt(slide, [0], (node) => (node.kind === 'table' ? insertTableColumn(node, 0) : node));
    assert.equal(outlinedCell(target, 's', wider), null);
    assert.equal(outlinedCell(target, 'other', slide), null);
  });

  it('finds the cell by its row and column', () => {
    assert.equal(cellSelector([1, 0]), '[data-open-artifact-cell="1:0"]');
  });
});
