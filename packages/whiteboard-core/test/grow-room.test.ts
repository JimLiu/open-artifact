import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { BoardElement, ImageElement, NoteElement, ShapeElement, StrokeElement } from '../src/schema.ts';
import { autoFitPatchWithRoom, createFontFitContent } from '../src/text/fit.ts';
import { growthMeetsNeighbor, grownSizeMeetsNeighbor } from '../src/text/grow-room.ts';
import { setTextMeasurer } from '../src/text/measure.ts';

after(() => setTextMeasurer());
beforeEach(() => setTextMeasurer((text, font) => [...text].length * font.px * 0.5));

/** A 40×20 shape at (100, 100) whose text needs a box of 64×63. */
const crowded: ShapeElement = { type: 'shape', id: 's', kind: 'rect', color: 'white', text: 'hello world', size: 'body', x: 100, y: 100, w: 40, h: 20 };
const picture = (id: string, x: number, y: number, w = 30, h = 30): ImageElement => ({ type: 'image', id, src: 'data:image/png;base64,AAAA', x, y, w, h });

describe('room to grow', () => {
  it('counts only items the growth newly runs into', () => {
    const before = { x: 0, y: 0, w: 50, h: 50 };
    const after = { x: 0, y: 0, w: 120, h: 50 };
    assert.equal(growthMeetsNeighbor([picture('p', 100, 10)], 's', before, after), true);
    assert.equal(growthMeetsNeighbor([picture('p', 40, 10)], 's', before, after), false, 'already overlapping');
    assert.equal(growthMeetsNeighbor([picture('p', 130, 10)], 's', before, after), false, 'still clear');
    const stroke: StrokeElement = { type: 'stroke', id: 'k', x: 0, y: 0, points: [100, 10, 110, 20], color: 'ink', width: 4 };
    assert.equal(growthMeetsNeighbor([stroke], 's', before, after), false, 'strokes are not in the way');
  });

  it('checks a font-fit growth both from the corner and from the center', () => {
    const size = { w: 64, h: 63 };
    assert.equal(grownSizeMeetsNeighbor([crowded], crowded, size), false);
    assert.equal(grownSizeMeetsNeighbor([crowded, picture('below', 100, 150)], crowded, size), true, 'from the corner');
    assert.equal(grownSizeMeetsNeighbor([crowded, picture('above', 100, 60)], crowded, size), true, 'from the center');
  });

  it('refuses an edit that would grow a shape into a neighbor', () => {
    const neighbor = picture('p', 100, 130);
    assert.deepEqual(autoFitPatchWithRoom(crowded, [crowded]), { x: 88, y: 78.5, w: 64, h: 63 });
    assert.equal(autoFitPatchWithRoom(crowded, [crowded, neighbor]), undefined);
    const already = { ...neighbor, y: 110 };
    assert.deepEqual(autoFitPatchWithRoom(crowded, [crowded, already]), { x: 88, y: 78.5, w: 64, h: 63 });
  });

  it('refuses a note widening into a neighbor', () => {
    const note: NoteElement = { type: 'note', id: 'n', color: 'yellow', text: 'hello world', tilt: 0, size: 'body', x: 0, y: 0, w: 50, h: 50 };
    assert.deepEqual(autoFitPatchWithRoom(note, [note]), { w: 88 });
    assert.equal(autoFitPatchWithRoom(note, [note, picture('p', 70, 0)]), undefined);
  });

  it('leaves a blocked shape at its size on font load and tries again once there is room', () => {
    const fit = createFontFitContent();
    const blocked = { elements: [crowded, picture('below', 100, 150)] satisfies BoardElement[] };
    assert.equal(fit(blocked), blocked);
    assert.equal(fit({ ...blocked }).elements[0], crowded, 'still blocked on the next call');
    const moved = { elements: [crowded, picture('below', 100, 400)] };
    const grown = fit(moved).elements[0];
    assert.ok(grown?.type === 'shape');
    assert.deepEqual([grown.x, grown.y, grown.w, grown.h], [100, 100, 64, 63]);
  });
});
