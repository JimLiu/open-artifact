import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeElement, strokeWidthFactors, type StrokeElement } from '@open-artifact/whiteboard-core';
import { encodeGestureFrame, readGestureFrame } from '../src/collab/gesture-wire.ts';
import { handSketches } from '../src/collab/peer-hands.ts';
import { appendPressureSample, matchFactors, penWidthShare, smoothPenShare, strokeFromSamples } from '../src/tools/pen.ts';
import { isPenEraser, isTouchScreenPen } from '../src/tools/pen-input.ts';

const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

describe('pen pressure', () => {
  it('widens with pressure and with tilt', () => {
    close(penWidthShare(0, 0, 0), 0.4);
    close(penWidthShare(0.5, 0, 0), 1);
    close(penWidthShare(3, 0, 0), 1.6);
    close(penWidthShare(1, 90, 0), 1.6 * 1.7);
    close(penWidthShare(1, 0, 45), 1.6 * (1 + 0.7 * 0.25));
  });

  it('smooths each width towards the last one', () => {
    assert.equal(smoothPenShare(undefined, 1.4), 1.4);
    close(smoothPenShare(1, 2), 1.4);
  });

  it('skips a sample within a fifth of a pixel unless its width changed', () => {
    const samples = [0, 0];
    const factors = [1];
    assert.equal(appendPressureSample(samples, factors, 0.1, 0, 1, 1), false);
    assert.equal(appendPressureSample(samples, factors, 0.1, 0, 1.5, 1), true);
    assert.equal(appendPressureSample(samples, factors, 0.5, 0, 1.5, 1), true);
    assert.equal(appendPressureSample(samples, factors, 0.55, 0, 1.5, 2), false, 'distance is measured on screen');
    assert.deepEqual(samples, [0, 0, 0.1, 0, 0.5, 0]);
    assert.deepEqual(factors, [1, 1.5, 1.5]);
  });

  it('keeps one factor per point after the tail is straightened', () => {
    const factors = [1, 1.2, 1.4];
    matchFactors(factors, 5, 1.2);
    assert.deepEqual(factors, [1, 1.2, 1.4, 1.2, 1.2]);
    matchFactors(factors, 2, 1);
    assert.deepEqual(factors, [1, 1.2]);
  });

  it('writes widths that survive normalizing', () => {
    const stroke = strokeFromSamples([10, 10, 20, 15, 30, 30], 'ink', 4, [0.5, 1, 2]);
    assert.ok(stroke);
    assert.equal(stroke.widths, '4cs');
    const stored = normalizeElement(JSON.parse(JSON.stringify(stroke))) as StrokeElement;
    assert.equal(stored.widths, '4cs');
    assert.deepEqual(strokeWidthFactors(stored), [0.5, 1, 2]);
  });

  it('gives a lone pressed sample two points of the same width', () => {
    const dot = strokeFromSamples([10, 20], 'ink', 4, [2]);
    assert.ok(dot);
    assert.equal(dot.widths, 'ss');
  });

  it('writes no widths for an even pressure or a mouse', () => {
    assert.equal(strokeFromSamples([0, 0, 10, 10], 'ink', 4, [1, 1])?.widths, undefined);
    assert.equal(strokeFromSamples([0, 0, 10, 10], 'ink', 4)?.widths, undefined);
  });
});

describe('stylus kinds', () => {
  it('tells a stylus on a touch screen from one on a tablet', () => {
    assert.equal(isTouchScreenPen({ pointerType: 'pen' }, 5), true);
    assert.equal(isTouchScreenPen({ pointerType: 'pen' }, 0), false);
    assert.equal(isTouchScreenPen({ pointerType: 'touch' }, 5), false);
  });

  it('knows the eraser end', () => {
    assert.equal(isPenEraser({ pointerType: 'pen', button: 5, buttons: 32 }), true);
    assert.equal(isPenEraser({ pointerType: 'pen', button: -1, buttons: 32 }), true);
    assert.equal(isPenEraser({ pointerType: 'pen', button: 0, buttons: 1 }), false);
    assert.equal(isPenEraser({ pointerType: 'mouse', button: 5, buttons: 32 }), false);
  });
});

describe('peers drawing with pressure', () => {
  it('sends widths with the stroke and keeps the tail of both', () => {
    const points = Array.from({ length: 2000 }, (_, index) => index);
    const widths = 'c'.repeat(999) + 'z';
    const parts = encodeGestureFrame(1, 1, { elements: [], ink: { color: 'ink', width: 4, points, widths } });
    assert.ok(parts);
    const frame = readGestureFrame(parts.map((part) => part.d).join(''));
    assert.ok(frame?.ink);
    assert.equal(frame.ink.widths?.length, frame.ink.points.length / 2);
    assert.equal(frame.ink.widths?.at(-1), 'z');
  });

  it('drops widths that do not fit and still draws the stroke', () => {
    const frame = readGestureFrame(JSON.stringify({ elements: [], ink: { color: 'ink', width: 4, points: [0, 0, 10, 10], widths: 'c' } }));
    assert.ok(frame?.ink);
    assert.equal(frame.ink.widths, undefined);
    assert.equal(handSketches(frame)[0]?.kind, 'ink');
  });

  it('draws a peer’s stroke as a filled outline when it has widths', () => {
    const [sketch] = handSketches({ elements: [], ink: { color: 'ink', width: 4, points: [0, 0, 10, 10], widths: '4s' } });
    assert.ok(sketch?.kind === 'ink');
    assert.equal(sketch.filled, true);
    const [plain] = handSketches({ elements: [], ink: { color: 'ink', width: 4, points: [0, 0, 10, 10] } });
    assert.ok(plain?.kind === 'ink');
    assert.equal(plain.filled, false);
  });
});
