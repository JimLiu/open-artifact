import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDesignProject, cleanNoteCss, emptyCanvas, noteBorderDeclarations, noteCssValue, normalizeCanvas, serializeCanvas } from '../src/index.ts';

describe('a note’s css', () => {
  it('keeps only the keys a note takes', () => {
    assert.deepEqual(cleanNoteCss({ 'background-color': '#ff0000', color: 'red', margin: '4px', opacity: '0.5' }), { 'background-color': '#ff0000', opacity: '0.5' });
    assert.equal(cleanNoteCss({ color: 'red' }), undefined);
    assert.equal(cleanNoteCss('red'), undefined);
    assert.equal(cleanNoteCss(['opacity']), undefined);
  });

  it('takes letters, digits and a few marks, 1–1200 of them', () => {
    assert.equal(noteCssValue('background', '  #fff  '), '#fff');
    assert.equal(noteCssValue('background', 'red; color: blue'), null);
    assert.equal(noteCssValue('background', '"red"'), null);
    assert.equal(noteCssValue('box-shadow', '{}'), null);
    assert.equal(noteCssValue('background', ''), null);
    assert.equal(noteCssValue('background', `linear-gradient(${'#fff,'.repeat(240)}#000)`), null, 'longer than 1200');
    assert.equal(noteCssValue('background', 12), null);
  });

  it('calls only colour, gradient and filter functions', () => {
    assert.equal(noteCssValue('background', 'linear-gradient(90deg, rgb(255 0 0), oklch(0.7 0.1 200))'), 'linear-gradient(90deg, rgb(255 0 0), oklch(0.7 0.1 200))');
    assert.equal(noteCssValue('filter', 'blur(4px) drop-shadow(0 2px 4px rgba(0,0,0,.2))'), 'blur(4px) drop-shadow(0 2px 4px rgba(0,0,0,.2))');
    assert.equal(noteCssValue('background', 'url(x.png)'), null);
    assert.equal(noteCssValue('background-color', 'var(--accent)'), null);
    assert.equal(noteCssValue('border-width', 'calc(1px + 2px)'), null);
    assert.equal(noteCssValue('background', '(red)'), null);
  });

  it('checks the keys with their own formats', () => {
    assert.equal(noteCssValue('border-style', 'dashed'), 'dashed');
    assert.equal(noteCssValue('border-style', 'groove'), null);
    assert.equal(noteCssValue('border-position', 'outside'), 'outside');
    assert.equal(noteCssValue('border-position', 'inside'), null, 'inside is the default and not written');
    assert.equal(noteCssValue('object-fit', 'scale-down'), 'scale-down');
    assert.equal(noteCssValue('object-fit', 'stretch'), null);
    assert.equal(noteCssValue('opacity', '.5'), '.5');
    assert.equal(noteCssValue('opacity', '0.123456'), '0.123456');
    assert.equal(noteCssValue('opacity', '0.1234567'), null);
    assert.equal(noteCssValue('opacity', '5'), '1');
    assert.equal(noteCssValue('opacity', '50%'), '50%');
    assert.equal(noteCssValue('opacity', '50.1234%'), null);
    assert.equal(noteCssValue('stroke-width', '2.345px'), '2.35px');
    assert.equal(noteCssValue('stroke-width', '3'), '3');
    assert.equal(noteCssValue('stroke-width', '1000'), null);
    assert.equal(noteCssValue('stroke-dasharray', '6 4'), '6 4');
    assert.equal(noteCssValue('stroke-dasharray', '1 2 3 4'), '1 2 3 4');
    assert.equal(noteCssValue('stroke-dasharray', '1 2 3 4 5'), null);
    assert.equal(noteCssValue('stroke-dasharray', '7.5 6'), null);
    assert.equal(noteCssValue('stroke-dasharray', '6  4'), null);
    assert.equal(noteCssValue('stroke', 'none'), null);
    assert.equal(noteCssValue('stroke', 'linear-gradient(red, blue)'), null);
    assert.equal(noteCssValue('stroke', '#333'), '#333');
  });

  it('is read the same way from canvas.json, and check names what is dropped', () => {
    const canvas = emptyCanvas('T');
    const raw = JSON.parse(serializeCanvas(canvas));
    raw.notes = { a: { x: 0, y: 0, w: 100, h: 80, kind: 'rect', css: { 'border-style': 'dashed', margin: '4px', background: 'url(x.png)' } } };
    const read = normalizeCanvas(raw);
    assert.deepEqual(read.notes.a!.css, { 'border-style': 'dashed' });
    const warnings = checkDesignProject(new Map([['canvas.json', JSON.stringify(raw)]])).filter((d) => d.level === 'warning').map((d) => d.message);
    assert.ok(warnings.some((m) => m.includes('Note "a" css "margin" is ignored')), warnings.join('\n'));
    assert.ok(warnings.some((m) => m.includes('Note "a" css "background" is ignored')), warnings.join('\n'));
    assert.ok(!warnings.some((m) => m.includes('"border-style"')));
  });

  it('moves an older file’s css fill to the note’s fill', () => {
    const read = normalizeCanvas({ notes: { a: { x: 0, y: 0, kind: 'rect', css: { fill: 'blue', opacity: '0.5' } } } });
    assert.equal(read.notes.a!.fill, 'blue');
    assert.deepEqual(read.notes.a!.css, { opacity: '0.5' });
  });

  it('writes a pen’s dash in whole numbers, and reads it back', () => {
    const canvas = emptyCanvas('T');
    canvas.notes.p = { x: 10, y: 10, kind: 'pen', stroke: 3, dash: 'dashed', points: [[0, 0], [40, 20]] };
    canvas.notes.q = { x: 10, y: 10, kind: 'pen', stroke: 2.5, dash: 'dotted', points: [[0, 0], [40, 20]] };
    canvas.notes.r = { x: 0, y: 0, w: 100, h: 80, kind: 'rect', fill: 'blue', css: { 'border-radius': '12px' } };
    const again = normalizeCanvas(JSON.parse(serializeCanvas(canvas)));
    assert.deepEqual(again.notes.p!.css, { 'stroke-width': '3px', 'stroke-dasharray': '9 8' });
    assert.deepEqual(again.notes.q!.css, { 'stroke-width': '2.5px', 'stroke-dasharray': '1 7' });
    assert.equal(again.notes.p!.dash, 'dashed');
    assert.equal(again.notes.r!.fill, 'blue');
    assert.deepEqual(again.notes.r!.css, { 'border-radius': '12px' });
  });
});

describe('a note’s border alignment', () => {
  const border = { 'border-style': 'dashed', 'border-width': '2px', 'border-color': '#ff0000' };

  it('draws a uniform border outside the edge as an outline', () => {
    assert.deepEqual(noteBorderDeclarations({ ...border, 'border-position': 'outside' }), { outline: '2px dashed #ff0000', 'outline-offset': '0' });
  });

  it('draws one at the centre of the edge as an outline pulled in by half its width', () => {
    assert.deepEqual(noteBorderDeclarations({ ...border, 'border-width': '3px', 'border-position': 'center' }), { outline: '3px dashed #ff0000', 'outline-offset': '-1.5px' });
    assert.deepEqual(noteBorderDeclarations({ 'border-style': 'solid', 'border-width': 'thick', 'border-position': 'center' }), { outline: 'thick solid', 'outline-offset': '-2.5px' });
    assert.deepEqual(noteBorderDeclarations({ 'border-style': 'solid', 'border-position': 'center' }), { outline: 'medium solid', 'outline-offset': '-1.5px' }, 'only a style: medium');
    assert.deepEqual(noteBorderDeclarations({ 'border-style': 'solid', 'border-width': '0.333em', 'border-position': 'center' })['outline-offset'], '-0.167em');
  });

  it('falls back to a border inside when the sides differ, or the border cannot be one outline', () => {
    const inside = (css: Record<string, string>) => noteBorderDeclarations({ ...border, ...css, 'border-position': 'outside' });
    assert.deepEqual(inside({ 'border-left-width': '4px' }), { ...border, 'border-left-width': '4px' });
    assert.deepEqual(inside({ 'border-style': 'none' }), { ...border, 'border-style': 'none' });
    assert.deepEqual(inside({ 'border-width': '0px' }), { ...border, 'border-width': '0px' });
    assert.deepEqual(inside({ 'border-width': '10%' }), { ...border, 'border-width': '10%' });
    assert.deepEqual(inside({ 'border-color': 'red blue' }), { ...border, 'border-color': 'red blue' });
    assert.deepEqual(noteBorderDeclarations({ ...border, 'border-radius': '8px' }), border, 'inside: radius is not a border key here');
  });
});
