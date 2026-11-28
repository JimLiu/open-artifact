import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CanvasNote } from '@open-artifact/design-core';
import { lineColorPatch, lineStyleOf, lineStylePatch, readTextStyle, restylePatch, shapeFillPatch } from '../src/lib/note-style.ts';

const sticky: CanvasNote = { x: 0, y: 0, text: 'Hi', w: 240 };
const title: CanvasNote = { x: 0, y: 0, text: 'Flows', kind: 'title1', maxW: 880 };

describe('readTextStyle', () => {
  it('reads a plain sticky as small, regular, default ink and yellow', () => {
    const style = readTextStyle(sticky);
    assert.equal(style.kind, 'sticky');
    assert.equal(style.px, 14);
    assert.equal(style.preset?.key, 's');
    assert.equal(style.bold, false);
    assert.equal(style.ink, undefined);
    assert.equal(style.fill, undefined);
  });

  it('reads a title as bold 72px, and its fill as none', () => {
    const style = readTextStyle({ ...title, fill: 'blue' });
    assert.equal(style.px, 72);
    assert.equal(style.preset?.key, 'xl');
    assert.equal(style.bold, true);
    assert.equal(style.fill, undefined);
  });

  it('reads a size of its own as no preset', () => {
    assert.equal(readTextStyle({ ...sticky, size: 30 }).preset, null);
    assert.equal(readTextStyle({ ...sticky, size: 30 }).px, 30);
  });

  it('reads a sticky’s ink from color and its background from fill', () => {
    const style = readTextStyle({ ...sticky, color: 'red', fill: 'blue' });
    assert.equal(style.ink, 'red');
    assert.equal(style.fill, 'blue');
  });
});

describe('restylePatch', () => {
  it('writes a named size by its name and any other size as clamped px', () => {
    assert.deepEqual(restylePatch(sticky, { size: 'l' }), { size: 'l' });
    assert.deepEqual(restylePatch({ ...sticky, size: 'l' }, { size: 's' }), { size: 's' });
    assert.deepEqual(restylePatch(sticky, { size: 30.4 }), { size: 30 });
    assert.deepEqual(restylePatch(sticky, { size: 2 }), { size: 8 });
    assert.deepEqual(restylePatch(sticky, { size: 999 }), { size: 400 });
    assert.deepEqual(restylePatch(sticky, { size: 40 }), { size: 'l' });
  });

  it('drops the bold key when it matches the kind’s own weight', () => {
    assert.deepEqual(restylePatch(sticky, { bold: true }), { bold: true });
    assert.deepEqual(restylePatch({ ...sticky, bold: true }, { bold: false }), { bold: undefined });
    assert.deepEqual(restylePatch(title, { bold: false }), { bold: false });
    assert.deepEqual(restylePatch({ ...title, bold: false }, { bold: true }), { bold: undefined });
  });

  it('writes italic only when on', () => {
    assert.deepEqual(restylePatch(sticky, { italic: true }), { italic: true });
    assert.deepEqual(restylePatch({ ...sticky, italic: true }, { italic: false }), { italic: undefined });
  });

  it('writes ink to color and a sticky’s fill to fill; null is the default', () => {
    assert.deepEqual(restylePatch(sticky, { ink: 'red' }), { color: 'red' });
    assert.deepEqual(restylePatch({ ...sticky, color: 'red' }, { ink: null }), { color: undefined });
    assert.deepEqual(restylePatch(sticky, { fill: 'teal' }), { fill: 'teal' });
    assert.deepEqual(restylePatch({ ...sticky, fill: 'teal' }, { fill: null }), { fill: undefined });
    assert.deepEqual(restylePatch(title, { fill: 'teal' }), {});
  });

  it('starts a new kind from its own look and drops the old box limits', () => {
    const styled: CanvasNote = { ...sticky, size: 'l', bold: true, italic: true, color: 'red', fill: 'blue', h: 200, maxW: 400, maxH: 300 };
    assert.deepEqual(restylePatch(styled, { kind: 'title1' }), {
      kind: 'title1', size: undefined, bold: undefined, italic: undefined, color: undefined, fill: undefined, h: undefined, maxW: undefined, maxH: undefined,
    });
    assert.equal(restylePatch(title, { kind: 'sticky' }).kind, undefined);
    assert.ok('kind' in restylePatch(title, { kind: 'sticky' }));
  });

  it('changes nothing when the kind is the same', () => {
    assert.deepEqual(restylePatch(sticky, { kind: 'sticky' }), {});
    assert.deepEqual(restylePatch(title, { kind: 'title1' }), {});
  });
});

describe('shape and line patches', () => {
  it('a shape fill replaces a css background; no fill removes both', () => {
    const rect: CanvasNote = { x: 0, y: 0, kind: 'rect', w: 10, h: 10, css: { background: 'linear-gradient(red, blue)', 'border-radius': '4px' } };
    assert.deepEqual(shapeFillPatch(rect, 'green'), { fill: 'green', css: { 'border-radius': '4px' } });
    assert.deepEqual(shapeFillPatch({ ...rect, css: { 'background-color': '#fff' }, fill: 'red' }, null), { fill: undefined, css: undefined });
  });

  it('a line colour replaces a css stroke', () => {
    const line: CanvasNote = { x: 0, y: 0, kind: 'line', points: [[0, 0], [10, 0]], css: { stroke: '#f00', 'stroke-width': '2' } };
    assert.deepEqual(lineColorPatch(line, 'blue'), { color: 'blue', css: { 'stroke-width': '2' } });
    assert.deepEqual(lineColorPatch({ ...line, css: undefined, color: 'blue' }, null), { color: undefined, css: undefined });
  });

  it('a line style writes dash and drops a css dash pattern', () => {
    const pen: CanvasNote = { x: 0, y: 0, kind: 'pen', d: 'M0 0L1 1', css: { 'stroke-dasharray': '6 4' } };
    assert.equal(lineStyleOf(pen), 'dashed');
    assert.equal(lineStyleOf({ ...pen, css: { 'stroke-dasharray': '0.01 6' } }), 'dotted');
    assert.equal(lineStyleOf({ ...pen, css: undefined }), 'solid');
    assert.equal(lineStyleOf({ ...pen, dash: 'dotted' }), 'dotted');
    assert.deepEqual(lineStylePatch(pen, 'dotted'), { dash: 'dotted', css: undefined });
    assert.deepEqual(lineStylePatch({ ...pen, dash: 'dotted', css: undefined }, 'solid'), { dash: undefined, css: undefined });
  });
});
