import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attributeValue, parseTemplate, patchStyle } from '@open-artifact/dc';
import { alignedLookPatch, alignModeFor, alignPatch, alignRefusal, ALIGN_REFUSALS, freeShift, nextAlignment, readAlignment, type BorderAlignment } from '../src/lib/border-align.ts';
import { styleMap } from '@open-artifact/dc';

const element = (style: string, tag = 'div', extra = '', inner = '') => parseTemplate(`<${tag} ${extra} style="${style}">${inner}</${tag}>`).elements[0]!;
const step = (style: string, to: BorderAlignment, tag = 'div', computed: Record<string, string> = {}) => {
  const patch = alignPatch(element(style, tag), to, computed);
  assert.ok(patch, `${style} → ${to}`);
  return patchStyle(style, patch);
};

describe('border alignment', () => {
  it('cycles inside → center → outside → inside', () => {
    assert.equal(nextAlignment('inside'), 'center');
    assert.equal(nextAlignment('outside'), 'inside');
  });

  it('draws center and outside with an outline and comes back exactly', () => {
    const start = 'border: 2px solid red';
    const center = step(start, 'center');
    assert.equal(readAlignment(styleMap(center)).alignment, 'center');
    assert.equal(styleMap(center)['outline-offset'], '-1px');
    assert.equal(styleMap(center)['border-color'], 'transparent');
    const outside = step(center, 'outside');
    assert.equal(readAlignment(styleMap(outside)).alignment, 'outside');
    assert.equal(styleMap(outside)['outline-offset'], '0px');
    assert.equal(step(outside, 'inside'), start);
  });

  it('keeps longhands and writes the color back', () => {
    const start = 'border-width: 4px; border-style: dashed; border-color: #123456';
    const back = step(step(start, 'outside'), 'inside');
    assert.deepEqual(styleMap(back), styleMap(start));
  });

  it('says why it can’t align', () => {
    assert.equal(alignRefusal(element('padding: 4px')), ALIGN_REFUSALS.color);
    assert.equal(alignRefusal(element('border-style: solid; border-width: 1px 2px; border-color: red')), ALIGN_REFUSALS.sides);
    assert.equal(alignRefusal(element('border: 1px solid red; outline: 2px solid blue')), ALIGN_REFUSALS.outline);
    assert.equal(alignRefusal(element('border: 1px solid red !important')), ALIGN_REFUSALS.code);
    assert.equal(alignRefusal(element('border: 1px solid red', 'button')), ALIGN_REFUSALS.focus);
    assert.equal(alignRefusal(element('border: 1px solid red', 'a', 'href="#"')), ALIGN_REFUSALS.focus);
    assert.equal(alignRefusal(element('border: 1px solid red')), null);
    // A border from a class: the rendered top side counts.
    assert.equal(alignRefusal(element(''), { 'border-top-width': '1px', 'border-top-style': 'solid', 'border-top-color': 'rgb(0, 0, 0)' }), null);
  });

  it('edits an aligned border through its outline', () => {
    const center = styleMap(step('border: 2px solid red', 'center'));
    assert.deepEqual(alignedLookPatch(center, { width: '6px' }), { 'outline-width': '6px', 'border-width': '6px', 'outline-offset': '-3px' });
    assert.deepEqual(alignedLookPatch(center, { color: 'blue' }), { 'outline-color': 'blue' });
    assert.equal(alignedLookPatch(styleMap('border: 1px solid red'), { color: 'blue' }), null);
  });

  it('takes the border away where kept space would show as a gap', () => {
    assert.equal(alignModeFor(element('border: 2px solid red', 'img')), 'free');
    assert.equal(alignModeFor(element('border: 2px solid red', 'video')), 'free');
    assert.equal(alignModeFor(element('border: 2px solid red; background-clip: padding-box')), 'free');
    assert.equal(alignModeFor(element('border: 2px solid red'), { 'background-clip': 'content-box' }), 'free');
    assert.equal(alignModeFor(element('border: 2px solid red; width: 40px; height: 40px'), { 'box-sizing': 'border-box' }), 'free');
    // Not empty, not fixed in size, or content-box: the space is kept.
    assert.equal(alignModeFor(element('border: 2px solid red; width: 40px; height: 40px', 'div', '', 'Text'), { 'box-sizing': 'border-box' }), 'kept');
    assert.equal(alignModeFor(element('border: 2px solid red; width: 40px'), { 'box-sizing': 'border-box' }), 'kept');
    assert.equal(alignModeFor(element('border: 2px solid red; width: 40px; height: 40px'), { 'box-sizing': 'content-box' }), 'kept');
    assert.equal(alignModeFor(element('border: 2px solid red')), 'kept');
  });

  it('aligns an image outside without kept space and comes back to a plain border', () => {
    const start = 'border: 4px solid #222; width: 200px; height: 100px';
    const computed = { 'box-sizing': 'content-box' };
    const outside = step(start, 'outside', 'img', computed);
    const map = styleMap(outside);
    assert.equal(map['border-style'], 'none');
    assert.equal(map.border, undefined);
    assert.equal(map['border-color'], undefined);
    assert.equal(map['background-origin'], undefined);
    assert.deepEqual([map['outline-width'], map['outline-style'], map['outline-color'], map['outline-offset']], ['4px', 'solid', '#222', '0px']);
    // A content-box image keeps its outer size: the border goes back into it.
    assert.equal(map.width, '208px');
    assert.equal(map.height, '108px');
    assert.deepEqual(readAlignment(map), { alignment: 'outside', look: { width: '4px', style: 'solid', color: '#222' }, mode: 'free' });
    const center = step(outside, 'center', 'img', computed);
    assert.equal(readAlignment(styleMap(center)).alignment, 'center');
    assert.equal(styleMap(center)['outline-offset'], '-2px');
    assert.deepEqual(styleMap(step(center, 'inside', 'img', computed)), styleMap(start));
  });

  it('moves a positioned free box in by the border on a side without a set size', () => {
    const start = 'position: absolute; left: 10px; top: 20px; border: 3px solid red';
    const computed = { 'box-sizing': 'border-box', position: 'absolute' };
    const outside = styleMap(step(start, 'outside', 'img', computed));
    assert.equal(outside.left, '13px');
    assert.equal(outside.top, '23px');
    assert.deepEqual(styleMap(step(patchStyle(start, alignPatch(element(start, 'img'), 'outside', computed)!), 'inside', 'img', computed)), styleMap(start));
    // A border-box size stays: the box keeps its size and place.
    const sized = styleMap(step('position: absolute; left: 10px; width: 50px; height: 50px; border: 3px solid red', 'outside', 'img', computed));
    assert.equal(sized.left, '10px');
    assert.equal(sized.width, '50px');
    // A right-anchored box moves from the right; a percentage size grows with calc and shrinks back.
    assert.deepEqual(freeShift({ right: '8px', position: 'absolute' }, {}, 2), { right: '10px' });
    assert.deepEqual(freeShift({ width: '50%' }, {}, 2), { width: 'calc(50% + 4px)' });
    assert.deepEqual(freeShift({ width: 'calc(50% + 4px)' }, {}, -2), { width: '50%' });
  });

  it('edits a free-aligned border through its outline and keeps the box in place', () => {
    const computed = { 'box-sizing': 'content-box' };
    const outside = styleMap(step('border: 2px solid red; width: 100px; height: 60px', 'outside', 'img', computed));
    assert.deepEqual(alignedLookPatch(outside, { width: '6px' }, computed), { 'outline-width': '6px', width: '112px', height: '72px', 'outline-offset': '0px' });
    const gone = alignedLookPatch(outside, { style: 'none' }, computed)!;
    assert.equal(gone.width, '100px');
    assert.equal(gone['outline-width'], null);
  });
});
