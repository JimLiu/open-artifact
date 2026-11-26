import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { outlineReach, outlineRect, visibleOutline, type OutlineStyle } from '../src/outline.ts';

const style = (overrides: Partial<OutlineStyle> = {}): OutlineStyle => ({
  outlineStyle: 'solid',
  outlineWidth: '4px',
  outlineOffset: '2px',
  outlineColor: 'rgb(200, 20, 50)',
  visibility: 'visible',
  opacity: '1',
  borderTopLeftRadius: '0px',
  ...overrides,
});

describe('outlines in captures', () => {
  it('draws only an outline that shows', () => {
    assert.deepEqual(visibleOutline(style()), { width: 4, offset: 2, color: 'rgb(200, 20, 50)', dash: 'solid' });
    assert.equal(visibleOutline(style({ outlineStyle: 'none' })), null);
    assert.equal(visibleOutline(style({ outlineStyle: 'auto' })), null, 'a focus ring is the browser’s own');
    assert.equal(visibleOutline(style({ outlineWidth: '0px' })), null);
    assert.equal(visibleOutline(style({ outlineColor: 'rgba(0, 0, 0, 0)' })), null);
    assert.equal(visibleOutline(style({ outlineColor: 'transparent' })), null);
    assert.equal(visibleOutline(style({ visibility: 'hidden' })), null);
    assert.equal(visibleOutline(style({ outlineStyle: 'double' }))?.dash, 'solid');
  });

  it('reaches past the box by width and offset, never less than nothing', () => {
    assert.equal(outlineReach(visibleOutline(style())), 6);
    assert.equal(outlineReach(visibleOutline(style({ outlineOffset: '-10px' }))), 0);
    assert.equal(outlineReach(null), 0);
  });

  it('strokes a rect centred on the outline', () => {
    const outline = visibleOutline(style())!;
    assert.deepEqual(outlineRect({ x: 10, y: 20, width: 100, height: 50 }, outline, { borderTopLeftRadius: '0px', opacity: '1' }), {
      x: '6', y: '16', width: '108', height: '58', fill: 'none', stroke: 'rgb(200, 20, 50)', 'stroke-width': '4',
    });
  });

  it('dashes and dots like the outline', () => {
    const box = { x: 0, y: 0, width: 40, height: 40 };
    const dashed = outlineRect(box, visibleOutline(style({ outlineStyle: 'dashed', outlineWidth: '3px' }))!, style());
    assert.equal(dashed?.['stroke-dasharray'], '6 3');
    assert.equal(dashed?.['stroke-linecap'], undefined);
    const dotted = outlineRect(box, visibleOutline(style({ outlineStyle: 'dotted', outlineWidth: '3px' }))!, style());
    assert.equal(dotted?.['stroke-dasharray'], '0 6');
    assert.equal(dotted?.['stroke-linecap'], 'round');
  });

  it('rounds its corners as the box’s, grown with it', () => {
    const box = { x: 0, y: 0, width: 100, height: 40 };
    const outline = visibleOutline(style())!;
    assert.deepEqual(pick(outlineRect(box, outline, { borderTopLeftRadius: '8px', opacity: '1' })), { rx: '12', ry: '12' });
    assert.deepEqual(pick(outlineRect(box, outline, { borderTopLeftRadius: '50%', opacity: '1' })), { rx: '54', ry: '24' }, 'a percentage of each side, at most half of it');
    assert.deepEqual(pick(outlineRect(box, outline, { borderTopLeftRadius: '200px', opacity: '1' })), { rx: '54', ry: '24' });
    assert.deepEqual(pick(outlineRect(box, outline, { borderTopLeftRadius: '10px 4px', opacity: '1' })), { rx: '14', ry: '8' });
    assert.deepEqual(pick(outlineRect(box, outline, { borderTopLeftRadius: '0px', opacity: '1' })), {}, 'square corners stay square');
  });

  it('carries the element’s opacity, and draws nothing for an empty box', () => {
    const outline = visibleOutline(style())!;
    assert.equal(outlineRect({ x: 0, y: 0, width: 10, height: 10 }, outline, { borderTopLeftRadius: '0px', opacity: '0.5' })?.opacity, '0.5');
    assert.equal(outlineRect({ x: 0, y: 0, width: 0, height: 10 }, outline, style()), null);
    const inside = visibleOutline(style({ outlineOffset: '-20px' }))!;
    assert.equal(outlineRect({ x: 0, y: 0, width: 30, height: 30 }, inside, style()), null, 'an outline pulled in past the middle');
  });
});

function pick(attributes: Record<string, string> | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (attributes?.rx) out.rx = attributes.rx;
  if (attributes?.ry) out.ry = attributes.ry;
  return out;
}
