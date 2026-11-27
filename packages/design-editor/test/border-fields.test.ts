import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { patchStyle, styleMap } from '@open-artifact/dc';
import { borderColorPatch, borderSidesPatch, borderStyleOf, borderStylePatch, borderWidthPatch, borderWidthsOf } from '../src/lib/border-fields.ts';

const apply = (style: string, patch: (inline: Record<string, string>) => Record<string, string | null>) => patchStyle(style, patch(styleMap(style)));

describe('border fields', () => {
  it('reads the style, color and widths as written', () => {
    const inline = styleMap('border: 2px dashed red; border-left-width: 4px');
    assert.equal(borderStyleOf(inline, {}), 'dashed');
    assert.deepEqual(borderWidthsOf(inline), ['2px', '2px', '2px', '4px']);
    assert.equal(borderStyleOf({}, { 'border-top-style': 'none' }), 'none');
  });

  it('changes a part of a shorthand in the shorthand', () => {
    assert.equal(apply('border: 2px solid red', (i) => borderStylePatch(i, {}, 'dotted')), 'border: 2px dotted red');
    assert.equal(apply('border: 2px solid red', (i) => borderStylePatch(i, {}, 'none')), 'border: 2px none red');
    assert.equal(apply('border: 2px solid red', (i) => borderColorPatch(i, 'blue')), 'border: 2px solid blue');
    assert.equal(apply('border: 2px solid red', (i) => borderWidthPatch(i, '5px')), 'border: 5px solid red');
  });

  it('gives a new border 1px when no width is written', () => {
    assert.equal(apply('color: red', (i) => borderStylePatch(i, { 'border-top-width': '0px' }, 'solid')), 'color: red; border-style: solid; border-width: 1px');
    assert.equal(apply('border-width: 3px', (i) => borderStylePatch(i, { 'border-top-width': '0px' }, 'solid')), 'border-width: 3px; border-style: solid');
  });

  it('writes each side’s width without border-width', () => {
    assert.equal(apply('border-width: 2px; border-style: solid', (i) => borderSidesPatch(i, ['1px', '2px', '3px', '4px'])), 'border-style: solid; border-top-width: 1px; border-right-width: 2px; border-bottom-width: 3px; border-left-width: 4px');
    assert.equal(apply('border: 2px solid red', (i) => borderSidesPatch(i, ['0px', '2px', '2px', '2px'])), 'border: solid red; border-top-width: 0px; border-right-width: 2px; border-bottom-width: 2px; border-left-width: 2px');
    assert.equal(apply('border-top-width: 1px; border-style: solid', (i) => borderWidthPatch(i, '3px')), 'border-style: solid; border-width: 3px');
  });
});
