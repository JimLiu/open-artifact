import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flowGroupStyle, isTablePart, pixels, positionedGroup, staysByPosition, writeBackPatch, type MeasuredElement } from '../src/lib/layout-write-back.ts';

const element = (over: Partial<MeasuredElement> = {}): MeasuredElement => ({
  tag: 'div',
  inline: {},
  box: { left: 10, top: 20, width: 100, height: 50 },
  computed: { position: 'static', display: 'block', 'margin-left': '0px', 'margin-top': '0px' },
  ...over,
});

describe('writing a layout back', () => {
  it('takes a flow element out of the flow at its box', () => {
    assert.deepEqual(writeBackPatch(element({ inline: { 'margin-top': '8px' } })), { position: 'absolute', 'margin-top': null, margin: '0px', width: '100px', left: '10px', top: '20px' });
  });

  it('turns a percentage or pinned size into pixels, and frees the far sides', () => {
    const patch = writeBackPatch(element({ inline: { position: 'absolute', height: '50%', left: '0', right: '0', top: '5%' }, computed: { position: 'absolute', 'margin-left': '0px', 'margin-top': '0px' } }));
    assert.equal(patch?.width, '100px');
    assert.equal(patch?.height, '50px');
    assert.equal(patch?.right, 'auto');
    assert.equal(patch?.top, '20px');
  });

  it('places a positioned element by its margin box unless the margin centres it', () => {
    const margined = { position: 'absolute', 'margin-left': '4px', 'margin-top': '6px' };
    assert.equal(writeBackPatch(element({ inline: { position: 'absolute' }, computed: margined }))?.left, '6px');
    assert.equal(writeBackPatch(element({ inline: { position: 'absolute', margin: 'auto' }, computed: margined }))?.left, '10px');
  });

  it('clears grid placement and insets', () => {
    const patch = writeBackPatch(element({ inline: { 'grid-column': '2 / 3', inset: '0' } }));
    assert.equal(patch?.['grid-column'], null);
    assert.equal(patch?.inset, null);
    assert.equal(patch?.['grid-area'], 'auto');
  });

  it('keeps text styles the new place would change, not for components', () => {
    const computed = { position: 'absolute', 'margin-left': '0px', 'margin-top': '0px', color: 'rgb(255, 0, 0)', 'font-size': '16px' };
    const there = { color: 'rgb(0, 0, 0)', 'font-size': '16px' };
    assert.equal(writeBackPatch(element({ computed }), there)?.color, 'rgb(255, 0, 0)');
    assert.equal(writeBackPatch(element({ computed }), there)?.['font-size'], undefined);
    assert.equal(writeBackPatch(element({ tag: 'x-import', computed }), there)?.color, undefined);
  });

  it('gives up rather than take away an expression', () => {
    assert.equal(writeBackPatch(element({ inline: { left: '{{x}}px', position: 'absolute' }, computed: { position: 'absolute' } })), null);
  });

  it('writes whole pixels when nearly whole, else two decimals', () => {
    assert.equal(pixels(12.004), '12px');
    assert.equal(pixels(12.345), '12.35px');
    assert.equal(pixels(-0.001), '0px');
  });
});

describe('groups', () => {
  it('copies the flex layout of the shared parent, with its defaults', () => {
    assert.equal(flowGroupStyle(null), 'box-sizing: border-box');
    assert.equal(flowGroupStyle({ 'flex-direction': 'column', gap: '12px' }), 'box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; justify-content: flex-start; align-items: stretch');
  });

  it('puts a positioned group around its members and places them inside it', () => {
    const plan = positionedGroup([
      element({ box: { left: 40, top: 30, width: 20, height: 20 }, computed: { position: 'absolute', 'z-index': '2' } }),
      element({ box: { left: 10, top: 60, width: 30, height: 10 }, computed: { position: 'absolute', 'z-index': '5' } }),
    ]);
    assert.equal(plan?.style, 'box-sizing: border-box; position: absolute; margin: 0px; left: 10px; top: 30px; width: 50px; height: 40px; z-index: 5');
    assert.deepEqual([plan?.members[0]?.left, plan?.members[0]?.top, plan?.members[1]?.left, plan?.members[1]?.top], ['30px', '0px', '0px', '30px']);
  });

  it('knows list and table parts, and which containers are free', () => {
    assert.equal(isTablePart('li'), true);
    assert.equal(isTablePart('div', 'table-cell'), true);
    const block = { tag: 'div', display: 'block', repeated: false };
    assert.equal(staysByPosition(block, { display: 'block', positioned: false, root: false, others: ['absolute'] }), true);
    assert.equal(staysByPosition(block, { display: 'grid', positioned: true, root: false, others: [] }), false);
    assert.equal(staysByPosition(block, { display: 'block', positioned: false, root: true, others: [] }), true);
    assert.equal(staysByPosition({ ...block, repeated: true }, { display: 'block', positioned: true, root: false, others: [] }), false);
  });
});
