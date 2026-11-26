import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeElement } from '../src/normalize.ts';
import { takeElementGeometry } from '../src/edits.ts';
import { LINKED_FIELD_GROUPS } from '../src/history/board-diff.ts';
import type { BoardElement, StrokeElement } from '../src/schema.ts';
import { elementLayoutBox } from '../src/geometry.ts';
import { hitTestElement, topElementAt } from '../src/hit-test.ts';
import { pressureStrokeOutline, strokeBounds, strokeDrawing } from '../src/ink.ts';
import {
  decodeWidthCode,
  encodeStrokeWidths,
  encodeWidthFactor,
  normalizeStrokeWidths,
  strokeWidestFactor,
  strokeWidthFactors,
  withStrokeWidths,
} from '../src/stroke-widths.ts';

const stroke = (extra: Record<string, unknown>): unknown => ({ type: 'stroke', id: 's1', x: 0, y: 0, points: [0, 0, 10, 0, 20, 5], color: 'ink', width: 4, ...extra });

describe('stroke widths', () => {
  it('decodes one digit per point into a width factor', () => {
    assert.equal(decodeWidthCode('c'), 1);
    assert.equal(decodeWidthCode('0'), 0.25);
    assert.equal(decodeWidthCode('z'), 2.4375);
  });

  it('encodes factors to the nearest digit, clamped to the range', () => {
    assert.equal(encodeWidthFactor(1), 'c');
    assert.equal(encodeWidthFactor(0.1), '0');
    assert.equal(encodeWidthFactor(9), 'z');
    assert.equal(encodeWidthFactor(1.5), 'k');
    assert.equal(decodeWidthCode(encodeWidthFactor(1.5)), 1.5);
  });

  it('writes no widths when every point has the plain width', () => {
    assert.equal(encodeStrokeWidths([1, 1, 1.01]), undefined);
    assert.equal(encodeStrokeWidths([]), undefined);
    assert.equal(encodeStrokeWidths([0.5, 1, 2]), '4cs');
  });

  it('keeps widths that match the points and drops those that do not', () => {
    assert.equal(normalizeStrokeWidths('4cg', 3), '4cg');
    assert.equal(normalizeStrokeWidths('4c', 3), undefined);
    assert.equal(normalizeStrokeWidths('4cG', 3), undefined);
    assert.equal(normalizeStrokeWidths('4c-', 3), undefined);
    assert.equal(normalizeStrokeWidths(42, 3), undefined);
  });

  it('normalizes a stroke with or without its widths', () => {
    const kept = normalizeElement(stroke({ widths: '4cg' })) as StrokeElement;
    assert.equal(kept.widths, '4cg');
    const short = normalizeElement(stroke({ widths: 'cc' })) as StrokeElement;
    assert.equal('widths' in short, false);
    const odd = normalizeElement(stroke({ widths: '4c!' })) as StrokeElement;
    assert.equal('widths' in odd, false);
    const clamped = normalizeElement(stroke({ width: 90, widths: '4cg' })) as StrokeElement;
    assert.equal(clamped.width, 40);
  });

  it('reads factors and the widest one', () => {
    const element = normalizeElement(stroke({ widths: '4cg' })) as StrokeElement;
    assert.deepEqual(strokeWidthFactors(element), [0.5, 1, 1.25]);
    assert.equal(strokeWidestFactor(element), 1.25);
    const plain = normalizeElement(stroke({})) as StrokeElement;
    assert.equal(strokeWidthFactors(plain), undefined);
    assert.equal(strokeWidestFactor(plain), 1);
  });

  it('carries widths with the points when geometry is taken from an earlier version', () => {
    const before = normalizeElement(stroke({ widths: '4cg' })) as StrokeElement;
    const after = withStrokeWidths({ ...before, points: [0, 0, 5, 5] }, undefined);
    const restored = takeElementGeometry(after, before);
    assert.deepEqual(restored.points, before.points);
    assert.equal(restored.widths, '4cg');
    const plain = withStrokeWidths(before, undefined);
    assert.equal(takeElementGeometry(before, plain).widths, undefined);
  });

  it('undoes points and widths together', () => {
    assert.ok(LINKED_FIELD_GROUPS.some((group) => group.includes('points') && group.includes('widths')));
  });
});

describe('strokes drawn with pressure', () => {
  // Thin (factor 0.25) at the left, wide (factor 2.4375) at the right, pen width 10.
  const pressed = normalizeElement({ type: 'stroke', id: 'p', x: 0, y: 0, points: [0, 0, 100, 0, 200, 0], color: 'ink', width: 10, widths: '00z' }) as StrokeElement;
  const below = normalizeElement({ type: 'shape', id: 'b', kind: 'rect', x: -20, y: -40, w: 60, h: 80, color: 'blue' }) as BoardElement;

  it('pads its bounds by half its widest width', () => {
    const bounds = strokeBounds(pressed);
    assert.ok(Math.abs(bounds.y - -12.1875) < 0.01, `top ${bounds.y}`);
    assert.ok(bounds.h > 24);
    const layout = elementLayoutBox(pressed);
    assert.ok(layout && Math.abs(layout.y - -12.1875) < 0.01 && Math.abs(layout.x - -12.1875) < 0.01, `layout ${JSON.stringify(layout)}`);
  });

  it('is hit near its wide part and missed beside its thin part', () => {
    assert.equal(hitTestElement(pressed, 190, 10, 1), true);
    assert.equal(hitTestElement(pressed, 10, 10, 1), false);
    assert.equal(hitTestElement(pressed, 10, 1, 1), true);
  });

  it('lets what is beneath its thin part be picked', () => {
    assert.equal(topElementAt([below, pressed], 10, 10, 1)?.id, 'b');
    assert.equal(topElementAt([below, pressed], 10, 1, 1)?.id, 'p');
  });

  it('draws a filled outline when it has widths and a stroked line otherwise', () => {
    const drawn = strokeDrawing(pressed);
    assert.equal(drawn.filled, true);
    assert.match(drawn.d, /^M /);
    assert.equal((drawn.d.match(/A /g) ?? []).length, 6, 'a disc (two arcs) per point');
    const plain = strokeDrawing({ points: [0, 0, 10, 10], width: 4 });
    assert.equal(plain.filled, false);
    assert.equal(pressureStrokeOutline([5, 5], [1], 4).startsWith('M 7 5 A 2 2'), true);
  });
});
