import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drawSpan, drawStart, drewShape, hoverGuides, snapTargets, spanBox } from '../src/lib/draw-snap.ts';

// One box from (100, 100) to (300, 200): vertical lines at 100, 200, 300; horizontal at 100, 150, 200.
const targets = snapTargets([{ x: 100, y: 100, w: 200, h: 100 }]);

describe('snapping while drawing', () => {
  it('snaps the press point to the nearest edge or centre line within the threshold', () => {
    const start = drawStart(targets, { x: 303, y: 60 }, 5);
    assert.deepEqual(start.at, { x: 300, y: 60 });
    assert.deepEqual(start.snapped, { x: true, y: false });
    assert.deepEqual(drawStart(targets, { x: 198, y: 152 }, 5).at, { x: 200, y: 150 });
  });

  it('does not snap with no threshold (⌘ / Ctrl held) or out of reach', () => {
    assert.deepEqual(drawStart(targets, { x: 303, y: 60 }, null).at, { x: 303, y: 60 });
    assert.deepEqual(drawStart(targets, { x: 310, y: 60 }, 5).snapped, { x: false, y: false });
  });

  it('snaps the end only on the axes the press point snapped on', () => {
    const start = drawStart(targets, { x: 303, y: 60 }, 5);
    const span = drawSpan(targets, start, { x: 98, y: 148 }, { tool: 'rect', shift: false, threshold: 5 });
    assert.deepEqual(span.from, { x: 300, y: 60 });
    // x snaps to 100; y stays the raw pointer (the start did not snap on y).
    assert.deepEqual(span.to, { x: 100, y: 148 });
    assert.ok(span.guides.every((g) => g.vertical));
    assert.deepEqual(span.guides.map((g) => g.at).sort((a, b) => a - b), [100, 300]);
  });

  it('turns snapping off for the end with no threshold', () => {
    const start = drawStart(targets, { x: 303, y: 60 }, 5);
    const span = drawSpan(targets, start, { x: 98, y: 148 }, { tool: 'rect', shift: false, threshold: null });
    assert.deepEqual(span.to, { x: 98, y: 148 });
    assert.equal(span.guides.length, 0);
  });

  it('draws a square on the larger side under Shift, following the drag direction', () => {
    const start = drawStart(targets, { x: 500, y: 500 }, 5);
    const down = drawSpan(targets, start, { x: 540, y: 520 }, { tool: 'rect', shift: true, threshold: 5 });
    assert.deepEqual(down.to, { x: 540, y: 540 });
    const upLeft = drawSpan(targets, start, { x: 480, y: 430 }, { tool: 'oval', shift: true, threshold: 5 });
    assert.deepEqual(upLeft.to, { x: 430, y: 430 });
    assert.deepEqual(spanBox(upLeft), { x: 430, y: 430, w: 70, h: 70 });
  });

  it('keeps a Shift line on a multiple of 45° with its length', () => {
    const start = drawStart(targets, { x: 500, y: 500 }, 5);
    const span = drawSpan(targets, start, { x: 560, y: 530 }, { tool: 'line', shift: true, threshold: 5 });
    const length = Math.hypot(60, 30);
    assert.ok(Math.abs(span.to.x - (500 + length / Math.SQRT2)) < 1e-9);
    assert.ok(Math.abs(span.to.y - (500 + length / Math.SQRT2)) < 1e-9);
    const flat = drawSpan(targets, start, { x: 600, y: 510 }, { tool: 'arrow', shift: true, threshold: 5 });
    assert.equal(flat.to.y, 500);
    assert.ok(Math.abs(flat.to.x - (500 + Math.hypot(100, 10))) < 1e-9);
  });

  it('slides a Shift square along its diagonal onto a line, leaving out lines through the press point', () => {
    // Press on the box's left edge (x snaps to 100); the square's corner lands near x = 200.
    const start = drawStart(targets, { x: 101, y: 300 }, 5);
    assert.equal(start.at.x, 100);
    const span = drawSpan(targets, start, { x: 197, y: 320 }, { tool: 'rect', shift: true, threshold: 5 });
    assert.deepEqual(span.to, { x: 200, y: 400 });
    assert.deepEqual(span.guides.map((g) => [g.vertical, g.at]), [[true, 200]]);
  });

  it('counts a drag as drawn past the minimum on both axes, or either for lines and under Shift', () => {
    const from = { x: 0, y: 0 };
    assert.equal(drewShape({ from, to: { x: 10, y: 2 } }, { tool: 'rect', shift: false, zoom: 1 }), false);
    assert.equal(drewShape({ from, to: { x: 10, y: 5 } }, { tool: 'rect', shift: false, zoom: 1 }), true);
    assert.equal(drewShape({ from, to: { x: 10, y: 0 } }, { tool: 'line', shift: false, zoom: 1 }), true);
    assert.equal(drewShape({ from, to: { x: 10, y: 0 } }, { tool: 'rect', shift: true, zoom: 1 }), true);
    // Artboards take 8 screen pixels, so 6 world units at zoom 1 is a click and at zoom 2 a drag.
    assert.equal(drewShape({ from, to: { x: 6, y: 6 } }, { tool: 'board', shift: false, zoom: 1 }), false);
    assert.equal(drewShape({ from, to: { x: 6, y: 6 } }, { tool: 'board', shift: false, zoom: 2 }), true);
  });

  it('shows the guides a press would snap to while hovering', () => {
    const guides = hoverGuides(targets, { x: 302, y: 148 }, 5);
    assert.deepEqual(guides.map((g) => [g.vertical, g.at]).sort(), [[false, 150], [true, 300]]);
    assert.equal(hoverGuides(targets, { x: 302, y: 148 }, null).length, 0);
  });
});
