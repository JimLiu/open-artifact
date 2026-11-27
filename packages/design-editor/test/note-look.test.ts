import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IMAGE_PLACEHOLDER, imageLook, rememberedRadius, shapeLook, withRectRadius } from '../src/lib/note-look.ts';
import { noteItem } from '../src/lib/scene.ts';
import { noteSwap, noteUnfill } from '../src/lib/paint.ts';

describe('a shape note’s look', () => {
  it('keeps the palette look when its css sets no border, with a 6px corner on a rectangle', () => {
    const look = shapeLook({ x: 0, y: 0, kind: 'rect', fill: 'blue', color: 'red' });
    assert.deepEqual(look.dom, { background: '#d6e6fb', 'border-width': '3px', 'border-style': 'solid', 'border-color': '#d4483b', 'border-radius': '6px' });
    assert.deepEqual(look.engine, { fill: '#d6e6fb', stroke: '#d4483b', strokeWidth: 3, radius: 6 });
    assert.equal(shapeLook({ x: 0, y: 0, kind: 'oval' }).dom['border-radius'], '50%');
  });

  it('draws its css: fill, border inside the edge, radius and opacity', () => {
    const look = shapeLook({ x: 0, y: 0, kind: 'rect', fill: 'blue', css: { 'background-color': '#ff0000', 'border-style': 'dashed', 'border-width': '2px', 'border-color': '#000000', 'border-radius': '12px', opacity: '0.5' } });
    assert.equal(look.dom.background, '#ff0000');
    assert.equal(look.dom['border-style'], 'dashed');
    assert.equal(look.dom['border-radius'], '12px');
    assert.deepEqual(look.engine, { fill: '#ff0000', stroke: '#000000', strokeWidth: 2, radius: 12, dash: [6, 6], opacity: 0.5 });
  });

  it('leaves to the DOM what the GPU scene cannot draw', () => {
    const dom = (css: Record<string, string>) => shapeLook({ x: 0, y: 0, kind: 'rect', css }).engine;
    assert.equal(dom({ background: 'linear-gradient(red, blue)' }), null);
    assert.equal(dom({ 'box-shadow': '0 2px 4px #0003' }), null);
    assert.equal(dom({ filter: 'blur(2px)' }), null);
    assert.equal(dom({ 'border-top-left-radius': '4px' }), null);
    assert.equal(dom({ 'border-style': 'solid', 'border-width': '2px', 'border-left-width': '6px' }), null);
    assert.equal(dom({ 'border-style': 'double', 'border-width': '4px' }), null);
  });

  it('draws a uniform border set outside the edge as an outline, in the DOM', () => {
    const look = shapeLook({ x: 0, y: 0, kind: 'rect', css: { 'border-style': 'dashed', 'border-width': '2px', 'border-color': '#000000', 'border-position': 'outside' } });
    assert.equal(look.dom.outline, '2px dashed #000000');
    assert.equal(look.dom['outline-offset'], '0');
    assert.equal(look.dom['border-style'], 'none');
    assert.equal(look.engine, null);
  });
});

describe('fill and stroke of a shape note with css', () => {
  it('swaps a css fill and border color in place', () => {
    const swapped = noteSwap({ x: 0, y: 0, kind: 'rect', css: { 'background-color': '#ff0000', 'border-style': 'solid', 'border-color': '#0000ff' } });
    assert.ok(typeof swapped === 'object');
    assert.deepEqual(swapped.css, { 'border-style': 'solid', 'border-color': '#ff0000', 'background-color': '#0000ff' });
    assert.equal(noteSwap({ x: 0, y: 0, kind: 'rect', css: { background: 'linear-gradient(red, blue)' } }), 'not-solid');
  });

  it('takes a css fill away', () => {
    assert.deepEqual(noteUnfill({ x: 0, y: 0, kind: 'rect', css: { background: '#fff', opacity: '0.5' } })?.css, { opacity: '0.5' });
  });
});

describe('the radius a new rectangle takes', () => {
  it('remembers a finite, non-negative radius rounded to 0.01, and nothing else', () => {
    assert.equal(rememberedRadius(12.345), 12.35);
    assert.equal(rememberedRadius(0), 0);
    assert.equal(rememberedRadius(-1), null);
    assert.equal(rememberedRadius(Number.NaN), null);
  });

  it('writes the remembered radius on a new rectangle only, the default as no css, and keeps a radius already set', () => {
    assert.deepEqual(withRectRadius({ x: 0, y: 0, kind: 'rect', text: '' }, 20).css, { 'border-radius': '20px' });
    assert.equal(withRectRadius({ x: 0, y: 0, kind: 'rect', text: '' }, 6).css, undefined);
    assert.equal(withRectRadius({ x: 0, y: 0, kind: 'oval', text: '' }, 20).css, undefined);
    assert.deepEqual(withRectRadius({ x: 0, y: 0, kind: 'rect', text: '', css: { 'border-radius': '3px', opacity: '0.5' } }, 20).css, { 'border-radius': '3px', opacity: '0.5' });
    assert.deepEqual(withRectRadius({ x: 0, y: 0, kind: 'rect', text: '', css: { opacity: '0.5' } }, 0).css, { opacity: '0.5', 'border-radius': '0px' });
  });
});

describe('an image note’s look', () => {
  const image = { x: 0, y: 0, kind: 'image' as const, src: 'a.png' };

  it('fills its box with square corners and no border, drawn by the scene', () => {
    const look = imageLook(image);
    assert.equal(look.dom['object-fit'], 'fill');
    assert.equal(look.dom['border-radius'], '0px');
    assert.equal(look.dom['border-style'], 'none');
    assert.equal(look.dom['background-color'], undefined);
    assert.equal(look.engine, true);
  });

  it('a border at the edge’s outside is an outline; a width alone is solid', () => {
    const outside = imageLook({ ...image, css: { 'border-width': '4px', 'border-style': 'dashed', 'border-color': '#123456', 'border-position': 'outside' } }).dom;
    assert.equal(outside.outline, '4px dashed #123456');
    assert.equal(outside['outline-offset'], '0');
    assert.equal(outside['border-style'], 'none');
    const width = imageLook({ ...image, css: { 'border-width': '2px' } });
    assert.equal(width.dom['border-style'], 'solid');
    assert.equal(width.engine, false);
  });

  it('shows the placeholder only without a picture and a background', () => {
    assert.equal(imageLook({ ...image, src: undefined }).dom['background-color'], IMAGE_PLACEHOLDER);
    assert.equal(imageLook({ ...image, src: undefined, css: { 'background-color': '#ff0000' } }).dom['background-color'], '#ff0000');
    assert.equal(imageLook(image).dom['background-color'], undefined);
  });

  it('a look the scene can’t draw leaves it a clear box to hit', () => {
    const styled = { ...image, css: { 'border-radius': '4px', 'box-shadow': '0px 4px 12px rgba(0,0,0,0.2)' } };
    assert.equal(imageLook(styled).engine, false);
    const item = noteItem('n', styled, { z: 0, editable: true, locked: false } as Parameters<typeof noteItem>[2]);
    assert.equal(item.kind, 'rect');
    assert.equal(item.fill, 'transparent');
    assert.equal(noteItem('n', image, { z: 0, editable: true, locked: false } as Parameters<typeof noteItem>[2]).kind, 'image');
  });
});
