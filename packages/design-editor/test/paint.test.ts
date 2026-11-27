import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate } from '@open-artifact/dc';
import { boxSwap, noteSwap, noteUnfill, shapeSwap, swapReport } from '../src/lib/paint.ts';

const first = (html: string, tag?: string) => {
  const elements = parseTemplate(html).elements;
  return tag ? elements.find((element) => element.tag === tag)! : elements[0]!;
};

describe('swap fill and stroke', () => {
  it('swaps a box’s background and border colors', () => {
    assert.deepEqual(boxSwap(first('<div style="background-color: red; border: 2px solid blue"></div>')), { patch: { 'background-color': 'blue', 'border-color': 'red' } });
  });

  it('gives a fill-only box a 1px border and a border-only box no border', () => {
    assert.deepEqual(boxSwap(first('<div style="background: red"></div>')), { patch: { background: null, 'background-color': 'transparent', 'border-width': '1px', 'border-style': 'solid', 'border-color': 'red' } });
    assert.deepEqual(boxSwap(first('<div style="border: 3px dashed green"></div>')), { patch: { 'background-color': 'green', 'border-style': 'none' } });
  });

  it('refuses what it can’t swap', () => {
    assert.deepEqual(boxSwap(first('<div style="background: linear-gradient(red, blue)"></div>')), { refused: 'not-solid' });
    assert.deepEqual(boxSwap(first('<div style="border-style: solid; border-top-color: red; border-left-color: blue"></div>')), { refused: 'not-solid' });
    assert.deepEqual(boxSwap(first('<div style="background-color: red !important"></div>')), { refused: 'in-code' });
    assert.deepEqual(boxSwap(first('<img src="a.png">')), { refused: 'unfit' });
    assert.deepEqual(boxSwap(first('<x-import src="b.dc.html"></x-import>')), { refused: 'component' });
    assert.deepEqual(boxSwap(first('<div style="background: red; border: 1px solid red"></div>')), { refused: 'nothing' });
    assert.deepEqual(boxSwap(first('<div></div>'), { 'background-color': 'rgba(0, 0, 0, 0)', 'border-top-style': 'none' }), { refused: 'nothing' });
  });

  it('uses what a class sets', () => {
    assert.deepEqual(boxSwap(first('<div class="card"></div>'), { 'background-color': 'rgb(255, 0, 0)', 'border-top-style': 'solid', 'border-top-width': '1px', 'border-top-color': 'rgb(0, 0, 255)' }), { patch: { 'background-color': 'rgb(0, 0, 255)', 'border-color': 'rgb(255, 0, 0)' } });
  });

  it('swaps an aligned border through its outline', () => {
    const plan = boxSwap(first('<div style="background-color: red; border: 2px solid blue; border-color: transparent; background-origin: border-box; outline-width: 2px; outline-style: solid; outline-color: blue; outline-offset: 0px"></div>'));
    assert.deepEqual(plan, { patch: { 'background-color': 'blue', 'outline-color': 'red' } });
  });

  it('swaps a shape’s fill and stroke', () => {
    assert.deepEqual(shapeSwap(first('<svg><circle r="4" fill="red" stroke="blue"/></svg>', 'circle')), { patch: { fill: 'blue', stroke: 'red' } });
    assert.deepEqual(shapeSwap(first('<svg><rect width="4" height="4" fill="red"/></svg>', 'rect'), '0.5'), { patch: { fill: 'none', stroke: 'red', 'stroke-width': '0.5' } });
    assert.deepEqual(shapeSwap(first('<svg fill="none" stroke="green"><path d="M0 0L4 0L4 4Z"/></svg>', 'path')), { patch: { fill: 'green', stroke: 'none' } });
    assert.deepEqual(shapeSwap(first('<svg><line x1="0" y1="0" x2="4" y2="4" stroke="red"/></svg>', 'line')), { refused: 'unfit' });
    assert.deepEqual(shapeSwap(first('<svg><path d="M0 0L4 4" stroke="red"/></svg>', 'path')), { refused: 'unfit' });
  });

  it('swaps a shape note and takes its fill away', () => {
    const swapped = noteSwap({ x: 0, y: 0, kind: 'rect', fill: 'blue', color: 'red' });
    assert.ok(typeof swapped === 'object');
    assert.equal(swapped.fill, 'red');
    assert.equal(swapped.color, 'blue');
    const bare = noteSwap({ x: 0, y: 0, kind: 'oval' });
    assert.ok(typeof bare === 'object');
    assert.equal(bare.fill, '#2b2b2b');
    assert.equal(bare.color, 'transparent');
    assert.equal(noteSwap({ x: 0, y: 0, kind: 'sticky' }), 'unfit');
    assert.equal(noteUnfill({ x: 0, y: 0, kind: 'rect', fill: 'blue' })?.fill, undefined);
    assert.equal(noteUnfill({ x: 0, y: 0, kind: 'rect' }), null);
  });
});

describe('fill edits', async () => {
  const { fillColorPatch, removableFill, REMOVE_FILL_PATCH } = await import('../src/lib/paint.ts');

  it('None removes every part of the background; a color drops the layers over it', () => {
    assert.deepEqual(fillColorPatch({ 'background-color': 'red' }, {}, 'transparent'), REMOVE_FILL_PATCH);
    assert.deepEqual(fillColorPatch({ background: 'linear-gradient(red, blue)' }, {}, '#00ff00'), { 'background-color': '#00ff00', background: null });
    assert.deepEqual(fillColorPatch({ 'background-image': 'url(a.png)' }, {}, '#00ff00'), { 'background-color': '#00ff00', 'background-image': 'none' });
    assert.deepEqual(fillColorPatch({}, { 'background-image': 'linear-gradient(red, blue)' }, 'red'), { 'background-color': 'red', 'background-image': 'none' });
    assert.deepEqual(fillColorPatch({ 'background-color': 'red' }, {}, null), { 'background-color': null });
    // A background that paints the text keeps its layers: only the color changes.
    const textFill = { 'background-image': 'linear-gradient(red, blue)', '-webkit-background-clip': 'text' };
    assert.deepEqual(fillColorPatch(textFill, {}, 'transparent'), { 'background-color': 'transparent' });
    assert.deepEqual(fillColorPatch(textFill, {}, '#00ff00'), { 'background-color': '#00ff00' });
  });

  it('offers Remove fill only where there is a fill to remove', () => {
    assert.equal(removableFill(first('<div style="background: red"></div>')), true);
    assert.equal(removableFill(first('<div style="background: linear-gradient(red, blue); background-clip: text; color: transparent"></div>')), false);
    assert.equal(removableFill(first('<div></div>'), { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }), false);
    assert.equal(removableFill(first('<div></div>'), { 'background-color': 'rgb(1, 2, 3)' }), true);
    assert.equal(removableFill(first('<div style="background-color: red !important"></div>')), false);
    assert.equal(removableFill(first('<svg><circle r="2"/></svg>', 'circle')), true);
    assert.equal(removableFill(first('<svg><path d="M0 0L2 2" /></svg>', 'path')), false);
    assert.equal(removableFill(first('<svg fill="none"><rect width="2" height="2"/></svg>', 'rect')), false);
  });
});

describe('swap: a border colour written as a function', () => {
  it('keeps the colour whole', async () => {
    const { boxSwap } = await import('../src/lib/paint.ts');
    const { parseTemplate } = await import('@open-artifact/dc');
    const model = parseTemplate('<div style="background-color: rgb(200, 0, 0); border: 4px solid rgb(0, 0, 200)"></div>');
    assert.deepEqual(boxSwap(model.elements[0]!), { patch: { 'background-color': 'rgb(0, 0, 200)', 'border-color': 'rgb(200, 0, 0)' } });
  });
});

describe('swap report', () => {
  it('announces a full swap and stays quiet when nothing was tried', () => {
    assert.deepEqual(swapReport([], 2), { announce: 'Fill and stroke swapped' });
    assert.equal(swapReport([], 0), null);
  });

  it('gives the first reason as a sentence, then says the rest swapped', () => {
    assert.deepEqual(swapReport(['unfit', 'nothing'], 0), { toast: 'Lines, pictures, notes, and artboards can’t swap fill and stroke.' });
    assert.deepEqual(swapReport(['unfit'], 1), { toast: 'Lines, pictures, notes, and artboards can’t swap fill and stroke. The rest swapped.' });
    assert.deepEqual(swapReport(['hidden'], 0), { toast: 'This isn’t shown on the page right now. Show it first.' });
    assert.deepEqual(swapReport(['in-code'], 1), { toast: 'Colors set in code can’t be swapped here. Ask the agent in chat to swap them. The rest swapped.' });
  });
});
