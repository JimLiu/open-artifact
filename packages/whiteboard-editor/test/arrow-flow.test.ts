/**
 * Flowing arrows on the page: the GIF's frames, what a screen reader hears,
 * what the Line menu says, and the GIF's file name.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARROW_FLOW, arrowFlowDashOffset, type ArrowElement, type BoardElement } from '@open-artifact/whiteboard-core';
import { describeElement } from '../src/elements/describe.ts';
import { boardPngFilename } from '../src/export/frame.ts';
import { FLOW_GIF_FRAMES, flowGifFrames } from '../src/export/gif-frames.ts';
import { ARROW_LINE_STYLE_MESSAGES } from '../src/services/actions.ts';

describe('the GIF of a flowing board', () => {
  it('has ten frames, one tenth of a dash period apart, together one loop', () => {
    const frames = flowGifFrames();
    assert.equal(FLOW_GIF_FRAMES, 10);
    assert.equal(frames.length, 10);
    assert.deepEqual(
      frames.map(({ phase }) => phase),
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    );
    assert.ok(frames.every(({ delayCs }) => delayCs === 5), 'each frame shows 5/100 s');
    assert.equal(frames.reduce((sum, { delayCs }) => sum + delayCs, 0) / 100, ARROW_FLOW.seconds);
  });

  it('moves the dashes 1.1 board units a frame, and starts where a still dashed line is', () => {
    const offsets = flowGifFrames().map(({ phase }) => arrowFlowDashOffset(phase));
    assert.equal(offsets[0], 0);
    offsets.forEach((offset, k) => assert.ok(Math.abs(offset + k * 1.1) < 1e-9, `frame ${k}: ${offset}`));
    // The frame after the last is the first again: the loop has no seam.
    assert.equal(arrowFlowDashOffset(FLOW_GIF_FRAMES / FLOW_GIF_FRAMES), 0);
  });

  it('is named like the PNG', () => {
    assert.equal(boardPngFilename('Release / plan', 'gif'), 'Release plan.gif');
    assert.equal(boardPngFilename(''), 'whiteboard.png');
  });
});

describe('a flowing arrow on the page', () => {
  const note: BoardElement = { type: 'note', id: 'n1', x: 0, y: 0, w: 100, h: 100, color: 'yellow', text: 'Queue', tilt: 0 };
  const arrow: ArrowElement = { type: 'arrow', id: 'a1', from: 'n1', to: [300, 0], head: 'end', dash: true, flow: true, color: 'ink' };
  const byId = new Map<string, BoardElement>([note, arrow].map((element) => [element.id, element]));

  it('is read out as flowing', () => {
    assert.match(describeElement(arrow, byId), /^Flowing arrow from /);
    const { flow: _flow, ...dashed } = arrow;
    assert.match(describeElement(dashed, byId), /^Dashed arrow from /);
    assert.match(describeElement({ ...dashed, dash: false }, byId), /^Arrow from /);
  });

  it('says the line style picked', () => {
    assert.deepEqual(ARROW_LINE_STYLE_MESSAGES, { solid: 'Solid', dashed: 'Dashed', flowing: 'Flowing' });
  });
});
