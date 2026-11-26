import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardElement, ContainerElement, ElementMeasure, ShapeElement, TextElement } from '@open-artifact/whiteboard-core';
import { guideLines, nearbyBoxes, stillBoxes, type SnapBox } from '../src/tools/snap.ts';

const VIEW = { x: -5000, y: -5000, w: 10000, h: 10000 };
const text = (id: string, x: number, y: number): TextElement => ({ type: 'text', id, x, y, text: id, size: 'body', color: 'ink' });
const measured = (...ids: string[]) => new Map(ids.map((id): [string, ElementMeasure] => [id, { w: 100, h: 20 }]));
const shape = (id: string, x: number, y: number): ShapeElement => ({ type: 'shape', id, kind: 'rect', x, y, w: 100, h: 60, color: 'blue', text: '' });
const section = (id: string, x: number, y: number, w: number, h: number): ContainerElement => ({ type: 'container', id, x, y, w, h, color: 'blue', text: id });
const at = (boxes: readonly SnapBox[], x: number, y: number) => boxes.find((box) => box.x === x && box.y === y);

describe('snap references', () => {
  it('marks far texts only while words alone move, and sections', () => {
    const elements: BoardElement[] = [text('a', 0, 0), text('b', 3000, 0), shape('s', 3000, 300), section('sec', -100, -100, 400, 400)];
    const words = stillBoxes(elements, new Set(['a']), measured('a', 'b'));
    assert.equal(at(words, 3000, 0)?.far, true);
    assert.equal(at(words, 3000, 300)?.far, undefined);
    assert.equal(at(words, -100, -100)?.section, true);
    const mixed = stillBoxes([...elements, shape('m', 0, 100)], new Set(['a', 'm']), measured('a', 'b'));
    assert.equal(at(mixed, 3000, 0)?.far, undefined, 'a shape moving along takes far texts out');
  });

  it('snaps to neighbours, far texts and whatever shares the smallest section around the box', () => {
    const box = { x: 0, y: 0, w: 100, h: 60 };
    const boxes: SnapBox[] = [
      { x: 150, y: 0, w: 100, h: 60 },
      { x: 2000, y: 0, w: 100, h: 60 },
      { x: 2000, y: 400, w: 100, h: 20, far: true },
      { x: -50, y: -50, w: 1600, h: 1000, section: true },
      { x: -500, y: -500, w: 4000, h: 4000, section: true },
      { x: 1200, y: 700, w: 100, h: 60 },
      { x: 3000, y: 3000, w: 100, h: 60 },
    ];
    const found = nearbyBoxes(boxes, box, VIEW, 1);
    assert.deepEqual(found.map((each) => [each.x, each.y]), [[150, 0], [2000, 400], [-50, -50], [-500, -500], [1200, 700]]);
    assert.deepEqual(nearbyBoxes(boxes, box, { x: 1000, y: 0, w: 500, h: 500 }, 1), [boxes[3], boxes[4]], 'only boxes in view');
  });

  it('draws a guide to its neighbours, or with none only to the nearest box on it', () => {
    const box = { x: 0, y: 0, w: 100, h: 20 };
    const near = { x: 0, y: 100, w: 100, h: 20, far: true as const };
    const mid = { x: 0, y: 2000, w: 100, h: 20, far: true as const };
    const last = { x: 0, y: 4000, w: 100, h: 20, far: true as const };
    const guide = { axis: 'x' as const, pos: 0, kind: 'edge' as const };
    assert.deepEqual(guideLines([guide], [near, mid, last], box, VIEW, 1)[0], { ...guide, from: 0, to: 120 });
    assert.deepEqual(guideLines([guide], [last, mid], box, VIEW, 1)[0], { ...guide, from: 0, to: 2020 });
  });
});
