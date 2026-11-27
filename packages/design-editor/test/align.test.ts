import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alignActionOfKey, alignOffsets, alignShortcut, alignTip, isAligned, parentAlign, type AlignSubject } from '../src/lib/align.ts';

const boxes = [
  { left: 10, top: 20, width: 100, height: 40 },
  { left: 50.04, top: 5, width: 30, height: 10 },
];

describe('aligning elements to each other', () => {
  it('lines the boxes up on the box around them all', () => {
    assert.deepEqual(alignOffsets(boxes, 'left'), [{ dx: 0, dy: 0 }, { dx: -40, dy: 0 }]);
    assert.deepEqual(alignOffsets(boxes, 'right'), [{ dx: 0, dy: 0 }, { dx: 30, dy: 0 }]);
    assert.deepEqual(alignOffsets(boxes, 'top'), [{ dx: 0, dy: -15 }, { dx: 0, dy: 0 }]);
    assert.deepEqual(alignOffsets(boxes, 'bottom'), [{ dx: 0, dy: 0 }, { dx: 0, dy: 45 }]);
    // Centres: the outer box spans 10–110 and 5–60.
    assert.deepEqual(alignOffsets(boxes, 'hcenter'), [{ dx: 0, dy: 0 }, { dx: -5, dy: 0 }]);
    assert.deepEqual(alignOffsets(boxes, 'vcenter'), [{ dx: 0, dy: -7.5 }, { dx: 0, dy: 22.5 }]);
  });

  it('rounds each move to 0.1px', () => {
    const [, second] = alignOffsets([{ left: 0, top: 0, width: 10, height: 10 }, { left: 3.333, top: 0, width: 10, height: 10 }], 'left');
    assert.equal(second!.dx, -3.3);
  });

  it('counts boxes within rounding of the line as already aligned', () => {
    assert.equal(isAligned(alignOffsets([{ left: 10, top: 0, width: 5, height: 5 }, { left: 10.04, top: 9, width: 8, height: 2 }], 'left')), true);
    assert.equal(isAligned(alignOffsets(boxes, 'left')), false);
  });

  it('takes Alt alone with a letter, from the key or else the physical key', () => {
    const press = { key: 'a', code: 'KeyA', alt: true, ctrl: false, meta: false, shift: false };
    assert.equal(alignActionOfKey(press), 'left');
    assert.equal(alignActionOfKey({ ...press, key: 'å' }), 'left');
    assert.equal(alignActionOfKey({ ...press, key: 'ф', code: 'KeyH' }), 'hcenter');
    assert.equal(alignActionOfKey({ ...press, key: 'd', code: 'KeyD' }), 'right');
    assert.equal(alignActionOfKey({ ...press, key: 'w', code: 'KeyW' }), 'top');
    assert.equal(alignActionOfKey({ ...press, key: 'v', code: 'KeyV' }), 'vcenter');
    assert.equal(alignActionOfKey({ ...press, key: 's', code: 'KeyS' }), 'bottom');
    assert.equal(alignActionOfKey({ ...press, shift: true }), null);
    assert.equal(alignActionOfKey({ ...press, meta: true }), null);
    assert.equal(alignActionOfKey({ ...press, alt: false }), null);
    assert.equal(alignActionOfKey({ ...press, key: 'q', code: 'KeyQ' }), null);
    assert.equal(alignShortcut('vcenter'), '⌥V');
  });
});

const subject = (over: Partial<AlignSubject> = {}): AlignSubject => ({ inline: {}, position: 'static', display: 'block', parentDisplay: 'block', translated: false, ...over });
const free = { readOnly: false, blocked: null };

describe('aligning inside the parent', () => {
  it('says why each action is off', () => {
    assert.equal(parentAlign([subject()], { readOnly: true, blocked: null }).left.reason, 'Read-only selection');
    assert.equal(parentAlign([subject(), subject({ position: 'absolute' })], free).left.reason, 'The selection mixes positioned and in-flow elements — align them one at a time');
    assert.equal(parentAlign([subject({ inline: { transform: 'rotate(4deg)' } }), subject()], free).top.reason, 'The selected elements carry different transforms — align them one at a time');
    assert.equal(parentAlign([subject({ translated: true })], free).left.reason, 'This element is shifted with the translate property — remove it (Code) or align it by hand');
    assert.equal(parentAlign([subject({ parentDisplay: 'flex' })], free).left.reason, 'Placed by its parent — select the parent and use its Align');
    assert.equal(parentAlign([subject({ inline: { width: '100px' } }), subject({ inline: { width: '100px' } })], free).left.reason, 'In-flow elements align one at a time — select one');
    assert.equal(parentAlign([subject()], free).hcenter.reason, 'give it a Fixed width first (an auto width would stretch edge to edge)');
    assert.equal(parentAlign([subject({ inline: { width: '100px' } })], free).top.reason, 'position it first (Absolute or Fixed) to align it vertically');
    assert.equal(alignTip('top', 'Read-only selection'), 'Align top — Read-only selection');
  });

  it('lets a positioned element align on both axes, centres needing a fixed size', () => {
    const actions = parentAlign([subject({ position: 'absolute', inline: { position: 'absolute', width: '80px', left: '4px' } })], free);
    assert.equal(actions.left.reason, null);
    assert.equal(actions.left.on, true);
    assert.equal(actions.hcenter.reason, null);
    assert.equal(actions.top.reason, null);
    assert.equal(actions.vcenter.reason, 'give it a Fixed height first (an auto height would stretch edge to edge)');
    assert.deepEqual(actions.right.patch, { left: null, right: '0', 'margin-left': null, 'margin-right': null });
  });
});
