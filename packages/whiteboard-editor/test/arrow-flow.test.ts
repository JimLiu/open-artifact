/**
 * Flowing arrows on the page: the GIF's and the video's frames, the
 * video's size, the Export tab's formats, what a screen reader hears, what
 * the Line menu says, and the file names.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARROW_FLOW, arrowFlowDashOffset, type ArrowElement, type BoardElement } from '@open-artifact/whiteboard-core';
import { describeElement } from '../src/elements/describe.ts';
import { boardPngFilename, exportFrameFor, type ExportFrame } from '../src/export/frame.ts';
import {
  evenVideoFrame,
  FLOW_LOOP_FRAMES,
  FLOW_VIDEO_FPS,
  FLOW_VIDEO_FRAMES,
  FLOW_VIDEO_LOOPS,
  flowGifFrames,
  flowLoopPhases,
  flowVideoFrameIndex,
} from '../src/export/flow-frames.ts';
import { ARROW_LINE_STYLE_MESSAGES } from '../src/services/actions.ts';
import { boardExportFormats, NO_VIDEO_ENCODER_REASON } from '../src/services/export-formats.ts';

describe('the GIF of a flowing board', () => {
  it('has ten frames, one tenth of a dash period apart, together one loop', () => {
    const frames = flowGifFrames();
    assert.equal(FLOW_LOOP_FRAMES, 10);
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
    assert.equal(arrowFlowDashOffset(FLOW_LOOP_FRAMES / FLOW_LOOP_FRAMES), 0);
  });

  it('is named like the PNG', () => {
    assert.equal(boardPngFilename('Release / plan', 'gif'), 'Release plan.gif');
    assert.equal(boardPngFilename(''), 'whiteboard.png');
  });
});

describe('the video of a flowing board', () => {
  it('plays twelve loops at 20 frames a second: 120 frames, 6 seconds', () => {
    assert.equal(FLOW_VIDEO_FPS, 20);
    assert.equal(FLOW_VIDEO_LOOPS, 12);
    assert.equal(FLOW_VIDEO_FRAMES, 120);
    assert.equal(FLOW_VIDEO_FRAMES / FLOW_VIDEO_FPS, 6);
  });

  it('shows frame k of the loop at k / 20 s, round and round', () => {
    const phases = flowLoopPhases();
    const shown = Array.from({ length: FLOW_VIDEO_FRAMES }, (_, n) => flowVideoFrameIndex(n / FLOW_VIDEO_FPS));
    shown.forEach((index, n) => assert.equal(index, n % 10, `frame ${n}`));
    assert.equal(phases[flowVideoFrameIndex(13 / FLOW_VIDEO_FPS)], 0.3);
    // A time a hair off a frame still finds that frame.
    assert.equal(flowVideoFrameIndex(0.35 - 1e-9), 7);
    assert.deepEqual(phases, flowGifFrames().map(({ phase }) => phase), 'the same phases as the GIF');
  });

  it('is an even number of pixels each way, shrinking the board to fit rather than cutting it', () => {
    const odd: ExportFrame = { board: { x: 0, y: 0, w: 1001, h: 501 }, width: 1001, height: 565, scale: 1, titleBar: 64 };
    const even = evenVideoFrame(odd);
    assert.equal(even.width, 1000);
    assert.equal(even.height, 564);
    assert.ok(even.board.w * even.scale <= even.width + 1e-9);
    assert.ok(even.board.h * even.scale + even.titleBar <= even.height + 1e-9);
    assert.ok(even.scale < 1 && even.scale > 0.99);
    const fine: ExportFrame = { ...odd, width: 1000, height: 564 };
    assert.equal(evenVideoFrame(fine), fine);
  });

  it('keeps a real board within 1920 pixels, even each way', () => {
    const elements: BoardElement[] = [{ type: 'note', id: 'n1', x: 0, y: 0, w: 2999, h: 1333, color: 'yellow', text: '', tilt: 0 }];
    const frame = exportFrameFor(elements, undefined, 1920);
    assert.ok(frame);
    const even = evenVideoFrame(frame);
    assert.equal(even.width % 2, 0);
    assert.equal(even.height % 2, 0);
    assert.ok(Math.max(even.width, even.height) <= 1920);
  });

  it('is named like the PNG', () => {
    assert.equal(boardPngFilename('Release / plan', 'mp4'), 'Release plan.mp4');
  });
});

describe('the Export tab of a board', () => {
  const names = (formats: ReturnType<typeof boardExportFormats>): string[] => formats.map(({ format }) => format);

  it('offers the GIF and then the video while the board flows', () => {
    const formats = boardExportFormats({ empty: false, flows: true, video: 'yes' });
    assert.deepEqual(names(formats), ['png', 'gif', 'mp4', 'json']);
    assert.deepEqual(formats[2], { format: 'mp4', label: 'MP4 video' });
    assert.ok(formats.every(({ disabled }) => disabled === undefined));
  });

  it('lists the video while the browser has not yet said whether it can make one', () => {
    const mp4 = boardExportFormats({ empty: false, flows: true, video: 'unknown' }).find(({ format }) => format === 'mp4');
    assert.deepEqual(mp4, { format: 'mp4', label: 'MP4 video' });
  });

  it('disables the video, saying why, in a browser that cannot make one', () => {
    const mp4 = boardExportFormats({ empty: false, flows: true, video: 'no' }).find(({ format }) => format === 'mp4');
    assert.deepEqual(mp4, { format: 'mp4', label: 'MP4 video', disabled: true, disabledReason: NO_VIDEO_ENCODER_REASON });
    assert.ok(NO_VIDEO_ENCODER_REASON.length <= 160);
  });

  it('offers neither the GIF nor the video for a board that does not flow', () => {
    for (const video of ['yes', 'no', 'unknown'] as const)
      assert.deepEqual(names(boardExportFormats({ empty: false, flows: false, video })), ['png', 'json']);
    assert.ok(boardExportFormats({ empty: true, flows: false, video: 'yes' }).every(({ disabled }) => disabled === true));
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
