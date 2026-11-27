import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attributeValue, parseTemplate, patchStyle } from '@open-artifact/dc';
import { alignedLookEdit, alignedLookPatch, alignEdit, alignModeFor, alignPatch, alignRefusal, ALIGN_REFUSALS, focusRing, nextAlignment, plusPx, readAlignment, type AlignContext, type BorderAlignment } from '../src/lib/border-align.ts';
import { styleMap } from '@open-artifact/dc';

const element = (style: string, tag = 'div', extra = '', inner = '') => parseTemplate(`<${tag} ${extra} style="${style}">${inner}</${tag}>`).elements[0]!;
const step = (style: string, to: BorderAlignment, tag = 'div', computed: Record<string, string> = {}, context: AlignContext = {}) => {
  const patch = alignPatch(element(style, tag), to, computed, context);
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
    // Outside is the outline's own offset: nothing to write.
    assert.equal(styleMap(outside)['outline-offset'], undefined);
    assert.equal(step(outside, 'inside'), start);
    assert.equal(step(step(start, 'outside'), 'inside'), start);
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
    // A focusable element aligns too (it gets a focus ring of its own).
    assert.equal(alignRefusal(element('border: 1px solid red', 'button')), null);
    assert.equal(alignRefusal(element('border: 1px solid red', 'a', 'href="#"')), null);
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
    // Nothing draws a border once the inline one goes: no border-style needed.
    assert.equal(map['border-style'], undefined);
    assert.equal(map.border, undefined);
    assert.equal(map['border-color'], undefined);
    assert.equal(map['background-origin'], undefined);
    assert.deepEqual([map['outline-width'], map['outline-style'], map['outline-color'], map['outline-offset']], ['4px', 'solid', '#222', undefined]);
    // A content-box image keeps its outer size: the border goes back into it.
    assert.equal(map.width, '208px');
    assert.equal(map.height, '108px');
    assert.deepEqual(readAlignment(map), { alignment: 'outside', look: { width: '4px', style: 'solid', color: '#222' }, mode: 'free' });
    const center = step(outside, 'center', 'img', computed);
    assert.equal(readAlignment(styleMap(center)).alignment, 'center');
    assert.equal(styleMap(center)['outline-offset'], '-2px');
    assert.deepEqual(styleMap(step(center, 'inside', 'img', computed)), styleMap(start));
  });

  it('writes border-style none only where a border would still show', () => {
    assert.equal(styleMap(step('border: 4px solid #222', 'outside', 'img'))['border-style'], undefined);
    assert.equal(styleMap(step('border: 4px solid #222', 'outside', 'img', {}, { classBorder: true }))['border-style'], 'none');
    assert.equal(styleMap(step('border-width: 4px; border-color: #222', 'outside', 'img', { 'border-top-style': 'solid' }))['border-style'], 'none');
  });

  it('leaves out outline parts the classes already give', () => {
    const map = styleMap(step('border: 2px solid red', 'center', 'img', {}, { classOutline: { style: 'solid', color: 'red', width: '0px', offset: '0px' } }));
    assert.equal(map['outline-style'], undefined);
    assert.equal(map['outline-color'], undefined);
    assert.equal(map['outline-width'], '2px');
    assert.equal(readAlignment(map, { 'outline-style': 'solid', 'outline-color': 'red' }).alignment, 'center');
  });

  it('gives a pinned side’s space to the opposite side', () => {
    const pinned = { top: false, right: false, bottom: false, left: true };
    const outside = styleMap(step('border: 2px solid red', 'outside', 'div', {}, { pinned }));
    assert.equal(outside['border-left-width'], '0px');
    assert.equal(outside['border-right-width'], '4px');
    assert.equal(outside['border-top-width'], undefined);
    assert.equal(outside['border-color'], 'transparent');
    assert.equal(outside['background-origin'], 'border-box');
    assert.equal(step(patchStyle('border: 2px solid red', alignPatch(element('border: 2px solid red'), 'outside', {}, { pinned })!), 'inside'), 'border: 2px solid red');
    // Both sides of an axis pinned: their space goes, and a content-box size takes it back.
    const both = styleMap(step('border: 2px solid red; width: 100px', 'outside', 'div', {}, { pinned: { top: false, right: true, bottom: false, left: true } }));
    assert.deepEqual([both['border-left-width'], both['border-right-width'], both.width], ['0px', '0px', '104px']);
    assert.deepEqual(styleMap(step(patchStyle('border: 2px solid red; width: 100px', alignPatch(element('border: 2px solid red; width: 100px'), 'outside', {}, { pinned: { top: false, right: true, bottom: false, left: true } })!), 'inside')), styleMap('border: 2px solid red; width: 100px'));
    // Every side pinned: the border goes.
    const all = styleMap(step('border: 2px solid red', 'outside', 'div', {}, { pinned: { top: true, right: true, bottom: true, left: true } }));
    assert.equal(all.border, undefined);
    assert.equal(alignModeFor(element('border: 2px solid red'), {}, { top: true, right: true, bottom: true, left: true }), 'free');
  });

  it('changes a content-box size only in px, never with calc', () => {
    const map = styleMap(step('border: 2px solid red; width: 50%; height: 40px', 'outside', 'img', { 'box-sizing': 'content-box' }));
    assert.equal(map.width, '50%');
    assert.equal(map.height, '44px');
    assert.equal(plusPx('50%', 4), null);
    assert.equal(plusPx('2px', -4), null);
    assert.equal(plusPx('0', 4), '4px');
    // An earlier version wrote calc; it still comes back.
    assert.equal(plusPx('calc(50% + 4px)', -4), '50%');
    const legacy = 'border-style: none; outline-width: 2px; outline-style: solid; outline-color: red; outline-offset: 0px; width: calc(50% + 4px)';
    assert.deepEqual(styleMap(step(legacy, 'inside', 'img')), styleMap('width: 50%; border: 2px solid red'));
  });

  it('moves a placed box on a frameless artboard so its outer edge stays', () => {
    const start = 'position: absolute; left: 10px; top: 20px; border: 3px solid red';
    const placed = { placed: true };
    const outside = styleMap(step(start, 'outside', 'img', { 'box-sizing': 'border-box' }, placed));
    assert.equal(outside.left, '13px');
    assert.equal(outside.top, '23px');
    assert.deepEqual(styleMap(step(serialize(outside), 'inside', 'img', { 'box-sizing': 'border-box' }, placed)), styleMap(start));
    const center = styleMap(step(start, 'center', 'img', { 'box-sizing': 'border-box' }, placed));
    assert.equal(center.left, '11.5px');
    assert.equal(styleMap(step(serialize(center), 'outside', 'img', { 'box-sizing': 'border-box' }, placed)).left, '13px');
    // Not placed (a framed artboard): it stays.
    assert.equal(styleMap(step(start, 'outside', 'img', { 'box-sizing': 'border-box' })).left, '10px');
    // Never past the artboard's start.
    assert.equal(styleMap(step('position: absolute; left: 0px; border: 3px solid red', 'outside', 'img', {}, placed)).left, '3px');
  });

  it('gives a focusable element its own focus ring, kept in step and taken away inside', () => {
    const edit = alignEdit(element('border: 2px solid red', 'button', '', 'Go'), 'outside');
    assert.ok(edit);
    assert.equal(edit.focus, 'box-shadow: 0 0 0 calc(2px + 0px + 2px) #fff, 0 0 0 calc(2px + 0px + 4px) #101010');
    const style = patchStyle('border: 2px solid red', edit.style);
    const focused = element(style, 'button', `style-focus-visible="${edit.focus}"`, 'Go');
    assert.equal(alignEdit(focused, 'inside')!.focus, null);
    assert.equal(alignEdit(focused, 'center')!.focus, focusRing('2px', '-1px'));
    assert.equal(alignedLookEdit(focused, { width: '4px' })!.focus, focusRing('4px', '0px'));
    assert.equal(focusRing('thin', '0px'), 'outline: revert; outline-offset: revert');
    // Its own focus style, or one from a stylesheet, stays.
    assert.equal(alignEdit(element('border: 2px solid red', 'button', 'style-focus-visible="outline: 2px solid blue"', 'Go'), 'outside')!.focus, undefined);
    assert.equal(alignEdit(element('border: 2px solid red', 'button', '', 'Go'), 'outside', {}, { focusStyled: true })!.focus, undefined);
    assert.equal(alignEdit(element('border: 2px solid red', 'div', '', 'Go'), 'outside')!.focus, undefined);
  });

  it('edits a free-aligned border through its outline and keeps the box in place', () => {
    const computed = { 'box-sizing': 'content-box' };
    const outside = styleMap(step('border: 2px solid red; width: 100px; height: 60px', 'outside', 'img', computed));
    assert.deepEqual(alignedLookPatch(outside, { width: '6px' }, computed), { 'outline-width': '6px', width: '112px', height: '72px' });
    const gone = alignedLookPatch(outside, { style: 'none' }, computed)!;
    assert.equal(gone['outline-width'], null);
  });
});

const serialize = (map: Record<string, string>) => Object.entries(map).map(([key, value]) => `${key}: ${value}`).join('; ');
