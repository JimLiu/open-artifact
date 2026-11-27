import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { noteCssValue } from '@open-artifact/design-core';
import {
  borderStyleFor,
  copyBoardStyle,
  copyElementStyle,
  copyNoteStyle,
  dashesFor,
  drawnBorder,
  groupOf,
  hasValues,
  nearestNoteColor,
  NOTE_GROUPS,
  noteClass,
  pastedBoardRadius,
  pastedElementStyle,
  pastedNote,
  pasteReport,
  readCopiedStyle,
  RESET_VALUES,
  STYLE_CLIPBOARD_KEY,
  withOpacity,
  writeCopiedStyle,
} from '../src/lib/style-clipboard.ts';

const BOX_COMPUTED = {
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  'border-top-style': 'none', 'border-right-style': 'none', 'border-bottom-style': 'none', 'border-left-style': 'none',
  'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px',
  'outline-style': 'none',
  'border-top-left-radius': '0px', 'border-top-right-radius': '0px', 'border-bottom-right-radius': '0px', 'border-bottom-left-radius': '0px',
  'box-shadow': 'none', filter: 'none', 'backdrop-filter': 'none', 'mix-blend-mode': 'normal', opacity: '1',
};

describe('copying an element’s look', () => {
  it('takes what is written inline, by group, and leaves size and place out', () => {
    const copied = copyElementStyle('box', { width: '200px', 'background-color': '#ff0000', border: '2px dashed #00f', top: '4px' }, BOX_COMPUTED);
    assert.deepEqual(copied.groups.fill, { 'background-color': '#ff0000' });
    assert.deepEqual(copied.groups.border, { border: '2px dashed #00f' });
    assert.deepEqual(copied.groups.shadow, {});
    assert.equal(copied.groups.text, undefined, 'a box has no text group');
    assert.ok(hasValues(copied));
  });

  it('reads what a class gives from the computed style, only where it differs from the default', () => {
    const copied = copyElementStyle('box', {}, {
      ...BOX_COMPUTED,
      'background-color': 'rgb(1, 2, 3)',
      'border-top-style': 'solid', 'border-right-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid',
      'border-top-width': '1px', 'border-right-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px',
      'border-top-color': 'red', 'border-right-color': 'red', 'border-bottom-color': 'red', 'border-left-color': 'red',
      'border-top-left-radius': '8px', 'border-top-right-radius': '8px', 'border-bottom-right-radius': '8px', 'border-bottom-left-radius': '8px',
      opacity: '0.5',
    });
    assert.deepEqual(copied.groups.fill, { 'background-color': 'rgb(1, 2, 3)' });
    assert.deepEqual(copied.groups.border, { 'border-width': '1px', 'border-style': 'solid', 'border-color': 'red' });
    assert.deepEqual(copied.groups.radius, { 'border-radius': '8px' });
    assert.deepEqual(copied.groups.opacity, { opacity: '0.5' });
    assert.deepEqual(copied.groups.outline, {});
  });

  it('a gradient fill brings its size, position and repeat', () => {
    const copied = copyElementStyle('box', {}, { ...BOX_COMPUTED, 'background-image': 'linear-gradient(red, blue)', 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'repeat' });
    assert.deepEqual(copied.groups.fill, { 'background-image': 'linear-gradient(red, blue)', 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'repeat' });
  });

  it('text: line height as a ratio of the size, defaults left out', () => {
    const copied = copyElementStyle('text', {}, { ...BOX_COMPUTED, 'font-family': 'Inter', 'font-size': '16px', 'font-weight': '400', 'font-style': 'normal', 'line-height': '24px', color: 'rgb(0, 0, 0)', 'letter-spacing': 'normal', 'text-align': 'start', 'text-transform': 'none', 'text-decoration-line': 'underline', 'text-shadow': 'none' });
    assert.deepEqual(copied.groups.text, { 'font-family': 'Inter', 'font-size': '16px', 'font-weight': '400', 'font-style': 'normal', 'line-height': '1.5', color: 'rgb(0, 0, 0)', 'text-decoration-line': 'underline' });
  });

  it('a shape’s paint folds fill and stroke opacity into the colour', () => {
    const copied = copyElementStyle('shape', {}, { fill: 'rgb(255, 0, 0)', 'fill-opacity': '0.5', stroke: 'none', 'stroke-width': '1px', 'stroke-dasharray': 'none', 'stroke-linecap': 'round' });
    assert.deepEqual(copied.groups.paint, { fill: '#ff000080', stroke: 'none', 'stroke-width': '1px', 'stroke-linecap': 'round' });
    assert.equal(withOpacity('#00ff00', '50%'), '#00ff0080');
    const inline = copyElementStyle('shape', { fill: '#0000ff', 'fill-opacity': '0.25' }, {});
    assert.deepEqual(inline.groups.paint, { fill: '#0000ff40' });
  });

  it('groups each property', () => {
    assert.equal(groupOf('border-top-left-radius'), 'radius');
    assert.equal(groupOf('border-left-color'), 'border');
    assert.equal(groupOf('-webkit-backdrop-filter'), 'backdrop');
    assert.equal(groupOf('text-decoration-line'), 'text');
    assert.equal(groupOf('stroke-linejoin'), 'paint');
    assert.equal(groupOf('width'), null);
  });
});

describe('boxes and shapes', () => {
  it('a border’s style as dashes at its width, and back', () => {
    assert.equal(dashesFor('solid', 4), 'none');
    assert.equal(dashesFor('dashed', 2), '6 6');
    assert.equal(dashesFor('dotted', 2), '1 5');
    assert.equal(dashesFor('dashed', 0.2), '3 3', 'the width is at least 1');
    assert.equal(dashesFor('dashed', 900), '900 900', 'and at most 300');
    assert.equal(borderStyleFor(undefined), 'solid');
    assert.equal(borderStyleFor('none'), 'solid');
    assert.equal(borderStyleFor('0 0'), 'solid');
    assert.equal(borderStyleFor('1 5'), 'dotted');
    assert.equal(borderStyleFor('6 6'), 'dashed');
    assert.equal(borderStyleFor('4 2 1'), 'dashed');
  });

  it('the drawn border: the first drawn side’s style and colour, the widest width', () => {
    assert.deepEqual(drawnBorder({ 'border-top': '1px solid red', 'border-left': '4px dashed blue' }), { width: 4, style: 'solid', color: 'red' });
    assert.equal(drawnBorder({ border: 'none' }), null);
    assert.equal(drawnBorder({ 'border-width': '0', 'border-style': 'solid' }), null);
  });

  it('a box’s fill and border land on a shape as fill and stroke', () => {
    const copied = copyElementStyle('box', { 'background-color': 'rgb(255, 0, 0)', border: '2px dashed #0000ff' }, BOX_COMPUTED);
    assert.deepEqual(pastedElementStyle(copied, 'shape', {}, {}), { fill: '#ff0000', stroke: '#0000ff', 'stroke-width': '2px', 'stroke-dasharray': '6 6' });
  });

  it('a shape’s fill and stroke land on a box as background and border', () => {
    const copied = copyElementStyle('shape', { fill: '#00ff00', stroke: '#000', 'stroke-width': '3', 'stroke-dasharray': '1 7' }, {});
    assert.deepEqual(pastedElementStyle(copied, 'box', { width: '10px' }, BOX_COMPUTED), { width: '10px', 'background-color': '#00ff00', 'border-width': '3px', 'border-style': 'dotted', 'border-color': '#000000' });
  });

  it('a line element takes a border on one edge over no fill', () => {
    const copied = copyElementStyle('box', { border: '3px solid red' }, BOX_COMPUTED);
    assert.deepEqual(pastedElementStyle(copied, 'rule', {}, {}, 'across'), { 'background-color': 'transparent', 'border-width': '3px 0px 0px', 'border-style': 'solid', 'border-color': 'red' });
    assert.equal(pastedElementStyle(copied, 'rule', {}, {}, 'down')!['border-width'], '0px 0px 0px 3px');
  });
});

describe('pasting replaces each group', () => {
  it('drops the target’s own declarations of the group, keeps the others', () => {
    const copied = copyElementStyle('box', { 'background-color': 'red' }, BOX_COMPUTED);
    assert.deepEqual(pastedElementStyle(copied, 'box', { background: 'blue', 'box-shadow': '0 0 1px red', height: '4px' }, BOX_COMPUTED), { height: '4px', 'background-color': 'red' });
  });

  it('resets what a class gives the target that the copy does not set', () => {
    const copied = copyElementStyle('box', {}, BOX_COMPUTED);
    const target = { ...BOX_COMPUTED, 'box-shadow': 'rgb(0, 0, 0) 0px 1px 2px 0px', 'background-color': 'rgb(9, 9, 9)', 'border-top-style': 'solid', opacity: '0.4', 'mix-blend-mode': 'multiply' };
    assert.deepEqual(pastedElementStyle(copied, 'box', {}, target), { background: 'none', border: 'none', 'box-shadow': 'none', 'mix-blend-mode': 'normal', opacity: '1' });
  });

  it('a shorthand reset comes before the copied longhands', () => {
    const copied = copyElementStyle('box', { 'background-color': 'red' }, BOX_COMPUTED);
    const out = pastedElementStyle(copied, 'box', {}, { ...BOX_COMPUTED, 'background-image': 'linear-gradient(red, blue)' })!;
    assert.deepEqual(Object.entries(out), [['background', 'none'], ['background-color', 'red']]);
  });

  it('the reset table', () => {
    const expected = {
      fill: { background: 'none', 'background-clip': 'border-box', '-webkit-background-clip': 'border-box', '-webkit-text-fill-color': 'currentcolor' },
      lines: { border: 'none', outline: 'none', 'border-radius': '0' },
      effects: { 'backdrop-filter': 'none', 'box-shadow': 'none', filter: 'none', 'mix-blend-mode': 'normal', opacity: '1' },
      text: { 'font-style': 'normal', 'letter-spacing': 'normal', 'line-height': 'normal', 'text-align': 'start', 'text-decoration': 'none', 'text-shadow': 'none', 'text-transform': 'none' },
      paint: { 'fill-opacity': '1', 'stroke-dasharray': 'none', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-opacity': '1' },
    };
    assert.deepEqual(RESET_VALUES, Object.assign({}, ...Object.values(expected)));
  });

  it('a kind that takes none of the groups gets nothing', () => {
    const copied = { source: 'text' as const, groups: { text: { color: 'red' } } };
    assert.equal(pastedElementStyle(copied, 'shape', {}, {}), null);
    assert.equal(pastedElementStyle(copied, 'image', {}, {}), null);
  });
});

describe('notes and artboards', () => {
  const valid = (key: string, value: string) => noteCssValue(key, value);

  it('picks the nearest palette colour', () => {
    assert.equal(nearestNoteColor('#2f6fd6', 'text'), 'blue', 'the same colour');
    assert.equal(nearestNoteColor('#1d4ed8', 'text'), 'blue', 'the nearest hue');
    assert.equal(nearestNoteColor('#e11d48', 'text') === 'red' || nearestNoteColor('#e11d48', 'text') === 'pink', true);
    assert.equal(nearestNoteColor('#777777', 'text'), 'gray', 'no hue, mid lightness');
    assert.equal(nearestNoteColor('#111111', 'text'), undefined, 'no hue, dark: the default');
    assert.equal(nearestNoteColor('#ffffff', 'fill'), 'gray', 'a fill without hue is gray');
    assert.equal(nearestNoteColor('#fdf0b2', 'fill'), undefined, 'the default sticky colour');
    assert.equal(nearestNoteColor('#d6e6fb', 'fill'), 'blue');
  });

  it('a text note: size, weight, slant, colour and fill', () => {
    const copied = copyNoteStyle({ x: 0, y: 0, text: 'a', size: 'l', bold: true, fill: 'blue' })!;
    assert.deepEqual(copied.groups.text, { 'font-size': '40px', 'font-weight': '700', 'font-style': 'normal', color: '#1d1d1b' });
    assert.deepEqual(copied.groups.fill, { 'background-color': '#d6e6fb' });
    const element = copyElementStyle('text', { 'font-size': '20px', 'font-weight': '600', 'font-style': 'italic', color: '#2f6fd6', 'background-color': '#fbd9d5' }, BOX_COMPUTED);
    assert.deepEqual(pastedNote(element, { x: 0, y: 0, kind: 'title1', text: 'b' }, valid), { x: 0, y: 0, kind: 'title1', text: 'b', size: 20, bold: true, italic: true, color: 'blue', fill: 'red' });
  });

  it('a shape note’s css takes a box’s groups; an oval takes no radius', () => {
    const copied = copyElementStyle('box', { 'background-color': '#ff0000', border: '2px dotted #000', 'border-radius': '12px' }, BOX_COMPUTED);
    const rect = pastedNote(copied, { x: 0, y: 0, kind: 'rect', css: { opacity: '0.5', 'box-shadow': '0 0 1px red' } }, valid)!;
    assert.deepEqual(rect.css, { 'background-color': '#ff0000', 'border-width': '2px', 'border-style': 'dotted', 'border-color': '#000', 'border-radius': '12px' });
    const oval = pastedNote(copied, { x: 0, y: 0, kind: 'oval' }, valid)!;
    assert.equal(oval.css?.['border-radius'], undefined);
  });

  it('a shape note copies its palette look when its css sets none', () => {
    const copied = copyNoteStyle({ x: 0, y: 0, kind: 'rect', fill: 'green', color: 'red' })!;
    assert.deepEqual(copied.groups.fill, { 'background-color': '#d7efd2' });
    assert.deepEqual(copied.groups.border, { 'border-width': '3px', 'border-style': 'solid', 'border-color': '#d4483b' });
    assert.deepEqual(copied.groups.radius, { 'border-radius': '6px' });
    assert.deepEqual(pastedElementStyle(copied, 'shape', {}, {}), { fill: '#d7efd2', stroke: '#d4483b', 'stroke-width': '3px', 'stroke-dasharray': 'none' });
  });

  it('a line takes a stroke, its width and dashes', () => {
    const copied = copyElementStyle('box', { border: '4px dashed #123456' }, BOX_COMPUTED);
    const line = pastedNote(copied, { x: 0, y: 0, kind: 'line', points: [[0, 0], [10, 10]] }, valid)!;
    assert.equal(line.color, '#123456');
    assert.equal(line.stroke, 4);
    assert.equal(line.dash, 'dashed');
    assert.deepEqual(copyNoteStyle({ x: 0, y: 0, kind: 'arrow', stroke: 2, dash: 'dotted', color: '#ff0000' })!.groups.paint, { stroke: '#ff0000', 'stroke-width': '2px', 'stroke-dasharray': '1 5' });
  });

  it('a link note has nothing to copy or take', () => {
    assert.equal(copyNoteStyle({ x: 0, y: 0, kind: 'link', href: 'https://example.com' }), null);
    assert.equal(pastedNote(copyBoardStyle(8, { 'background-color': '#ffffff' }), { x: 0, y: 0, kind: 'link' }, valid), null);
  });

  it('an artboard: its page background and radius', () => {
    assert.deepEqual(copyBoardStyle(8, { 'background-color': '#ffffff' }).groups, { fill: { 'background-color': '#ffffff' }, radius: { 'border-radius': '8px' } });
    assert.deepEqual(copyBoardStyle(undefined, { 'background-color': '#ffffff' }).groups.radius, { 'border-radius': '0px' });
    assert.equal(pastedBoardRadius(copyBoardStyle(8, { 'background-color': '#ffffff' })), 8);
    assert.equal(pastedBoardRadius(copyBoardStyle(undefined, { 'background-color': '#ffffff' })), undefined, 'a copy without radius takes it away');
    assert.equal(pastedBoardRadius({ source: 'text', groups: { text: {} } }), null);
    assert.equal(pastedBoardRadius({ source: 'box', groups: { radius: { 'border-radius': '50%' } } }), null, 'only px corners');
    assert.equal(pastedBoardRadius({ source: 'box', groups: { radius: { 'border-radius': '4px 8px' } } }), 4);
  });

  it('an image note: border, corners and effects, no fill', () => {
    const image = { x: 0, y: 0, kind: 'image' as const, src: 'a.png' };
    assert.equal(noteClass(image), 'image-note');
    assert.ok(!NOTE_GROUPS['image-note'].includes('fill'));
    assert.deepEqual(copyNoteStyle(image)!.groups, { border: {}, radius: { 'border-radius': '0px' }, shadow: {}, filter: {}, backdrop: {}, opacity: {} });
    const rect = copyNoteStyle({ x: 0, y: 0, kind: 'rect', fill: 'green', css: { 'border-width': '4px', 'border-style': 'dashed', 'border-color': '#123456' } })!;
    const pasted = pastedNote(rect, { ...image, css: { 'background-color': '#ff0000' } }, valid)!;
    assert.equal(pasted.css?.['border-width'], '4px');
    assert.equal(pasted.css?.['border-style'], 'dashed');
    assert.equal(pasted.css?.['background-color'], '#ff0000', 'the fill is not pasted');
  });
});

describe('what is said and kept', () => {
  it('the paste report', () => {
    assert.equal(pasteReport(1, 0), 'Properties pasted');
    assert.equal(pasteReport(3, 0), 'Properties pasted onto 3 elements');
    assert.equal(pasteReport(0, 1), 'The copied properties can’t be pasted onto this element.');
    assert.equal(pasteReport(0, 2), 'The copied properties can’t be pasted onto these elements.');
    assert.equal(pasteReport(2, 1), 'Properties pasted. 1 element couldn’t take them.');
    assert.equal(pasteReport(1, 2), 'Properties pasted. 2 elements couldn’t take them.');
  });

  it('keeps the copy in storage, and survives storage that fails', () => {
    const items = new Map<string, string>();
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) } as unknown as Storage;
    assert.equal(readCopiedStyle(() => storage), null);
    assert.ok(writeCopiedStyle(copyBoardStyle(4, { 'background-color': '#ffffff' }), () => storage));
    assert.ok(items.has(STYLE_CLIPBOARD_KEY));
    assert.deepEqual(readCopiedStyle(() => storage), copyBoardStyle(4, { 'background-color': '#ffffff' }));
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } } as unknown as Storage;
    assert.equal(readCopiedStyle(() => broken), null);
    assert.equal(writeCopiedStyle(copyBoardStyle(4, { 'background-color': '#ffffff' }), () => broken), false);
    items.set(STYLE_CLIPBOARD_KEY, '{not json');
    assert.equal(readCopiedStyle(() => storage), null);
  });
});
