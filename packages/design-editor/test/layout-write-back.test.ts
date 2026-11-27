import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canLeaveFlow, carriedStyles, flowGroupStyle, isTablePart, liftedOnUngroup, pixels, positionedGroup, staysByPosition, writeBackPatch, type MeasuredElement } from '../src/lib/layout-write-back.ts';

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

  it('lifts flowing children out of an ungrouped group only when it was absolute or fixed and all of them can go', () => {
    const flow = { tag: 'p', position: 'static', display: 'block', repeated: false };
    const placed = { tag: 'div', position: 'absolute', display: 'block', repeated: false };
    assert.deepEqual(liftedOnUngroup({ position: 'absolute' }, [flow, placed]), [true, true]);
    assert.deepEqual(liftedOnUngroup({ position: 'fixed' }, [flow]), [true]);
    // A group in the flow, or a relative one, leaves its flowing children to the flow.
    assert.deepEqual(liftedOnUngroup({ position: 'static' }, [flow, placed]), [false, true]);
    assert.deepEqual(liftedOnUngroup({ position: 'relative' }, [flow]), [false]);
    // One child that cannot leave the flow keeps all of them in it.
    assert.deepEqual(liftedOnUngroup({ position: 'absolute' }, [flow, { ...flow, repeated: true }, placed]), [false, false, true]);
    assert.deepEqual(liftedOnUngroup({ position: 'absolute' }, [flow, { ...flow, tag: 'span', display: 'inline' }]), [false, false]);
    assert.deepEqual(liftedOnUngroup({ position: 'absolute', blocked: true }, [flow]), [false]);
    // Hidden children neither stop the others nor are written.
    assert.deepEqual(liftedOnUngroup({ position: 'absolute' }, [flow, { ...flow, display: 'none' }]), [true, false]);
    assert.equal(canLeaveFlow({ tag: 'li', display: 'list-item', repeated: false }), false);
  });
});

describe('styles an element takes with it', () => {
  const box = { 'background-color': 'rgb(255, 0, 0)', 'border-style': 'solid', 'border-color': 'rgb(0, 0, 255)', 'border-top-width': '2px', 'border-right-width': '2px', 'border-bottom-width': '2px', 'border-left-width': '2px', 'border-top-left-radius': '8px', 'border-top-right-radius': '8px', 'border-bottom-right-radius': '8px', 'border-bottom-left-radius': '8px' };
  const bare = { 'background-color': 'rgba(0, 0, 0, 0)', 'border-style': 'none', 'border-color': 'rgb(0, 0, 0)', 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'border-top-left-radius': '0px', 'border-top-right-radius': '0px', 'border-bottom-right-radius': '0px', 'border-bottom-left-radius': '0px' };

  it('keeps the background, a whole border and all four corners its old place gave it', () => {
    assert.deepEqual(carriedStyles(element({ computed: { ...element().computed, ...box }, there: bare })), box);
  });

  it('takes nothing where the new place shows the same, or when nothing was measured there', () => {
    assert.deepEqual(carriedStyles(element({ computed: { ...element().computed, ...box }, there: box })), {});
    assert.deepEqual(carriedStyles(element({ computed: { ...element().computed, ...box } })), {});
  });

  it('leaves what the author wrote, and a border with no width to show', () => {
    const own = element({ inline: { background: 'red', 'border-radius': '8px' }, computed: { ...element().computed, ...box }, there: bare });
    assert.deepEqual(Object.keys(carriedStyles(own)), ['border-style', 'border-color', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']);
    const unseen = element({ computed: { ...element().computed, ...box, 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'border-color': 'rgb(9, 9, 9)' }, there: bare });
    assert.equal(carriedStyles(unseen)['border-color'], undefined);
  });

  it('carries a border or corners only when every part reads', () => {
    const partial = element({ computed: { ...element().computed, ...box, 'border-style': '', 'border-top-right-radius': '' }, there: bare });
    assert.deepEqual(carriedStyles(partial), { 'background-color': 'rgb(255, 0, 0)' });
  });

  it('compares text styles with the copy measured there, else with the new parent', () => {
    const text = { ...element().computed, color: 'rgb(1, 2, 3)', 'font-size': '20px' };
    assert.deepEqual(carriedStyles(element({ computed: text, there: { color: 'rgb(1, 2, 3)', 'font-size': '16px' } })), { 'font-size': '20px' });
    assert.deepEqual(carriedStyles(element({ computed: text }), { color: 'rgb(0, 0, 0)', 'font-size': '20px' }), { color: 'rgb(1, 2, 3)' });
  });

  it('gives a component only its place and size', () => {
    const patch = writeBackPatch(element({ tag: 'x-import', computed: { ...element().computed, ...box, color: 'red' }, there: { ...bare, color: 'blue' } }));
    assert.deepEqual(Object.keys(patch ?? {}).sort(), ['left', 'margin', 'position', 'top', 'width']);
  });

  it('writes the carried styles with the place, unless that would take away an expression', () => {
    const patch = writeBackPatch(element({ computed: { ...element().computed, ...box }, there: bare }));
    assert.equal(patch?.['background-color'], 'rgb(255, 0, 0)');
    assert.equal(writeBackPatch(element({ inline: { left: '{{x}}px', position: 'absolute' }, computed: { position: 'absolute', 'margin-left': '0px', 'margin-top': '0px' } })), null);
  });
});
