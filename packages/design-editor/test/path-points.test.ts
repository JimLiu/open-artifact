import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { controlBounds, inverseMove, parsePathData, pathDataOf, pathPoints, type PathMatrix } from '../src/lib/path-points.ts';

const identity: PathMatrix = [1, 0, 0, 1, 0, 0];

describe('reading path data as nodes', () => {
  it('reads absolute and relative lines and curves', () => {
    assert.deepEqual(parsePathData('M10 10 L20 10 h5 v5 l-5,5'), [{ nodes: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 25, y: 10 }, { x: 25, y: 15 }, { x: 20, y: 20 }], closed: false }]);
    assert.deepEqual(parsePathData('M0 0 c10 0 20 10 20 20'), [{ nodes: [{ x: 0, y: 0, out: [10, 0] }, { x: 20, y: 20, in: [0, -10] }], closed: false }]);
    // Pairs after a move are lines.
    assert.deepEqual(parsePathData('m1 1 2 2')?.[0]?.nodes, [{ x: 1, y: 1 }, { x: 3, y: 3 }]);
  });

  it('turns smooth and quadratic curves into cubic ones', () => {
    const [run] = parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0')!;
    assert.deepEqual(run!.nodes[1], { x: 10, y: 0, in: [0, 10], out: [0, -10] });
    const [quad] = parsePathData('M0 0 Q15 30 30 0')!;
    assert.deepEqual(quad!.nodes, [{ x: 0, y: 0, out: [10, 20] }, { x: 30, y: 0, in: [-10, 20] }]);
  });

  it('closes a run, merging a last point back on the first', () => {
    assert.deepEqual(parsePathData('M0 0 L10 0 L10 10 L0 0 Z'), [{ nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true }]);
    const runs = parsePathData('M0 0 L10 0 L10 10 Z M20 20 L30 20 L30 30 Z');
    assert.equal(runs?.length, 2);
    assert.equal(runs?.[1]?.nodes[0]?.x, 20);
  });

  it('refuses arcs, holes, a lone move and stray text', () => {
    assert.equal(parsePathData('M0 0 A5 5 0 0 1 10 10'), null);
    assert.equal(parsePathData('M0 0 L{{x}} 10'), null);
    assert.equal(parsePathData('M0 0'), null);
    assert.equal(parsePathData('10 10 L20 20'), null);
  });

  it('writes the same shape back, stable through a second read', () => {
    for (const d of ['M10 10 L20 10 h5 v5', 'M0 0 c10 0 20 10 20 20', 'M0 0 L10 0 L10 10 Z', 'M0 0 C0 10 10 10 10 0 S20 -10 20 0', 'M0 0 C5 -5 15 -5 20 0 C15 5 5 5 0 0 Z']) {
      const once = pathDataOf(parsePathData(d)!);
      assert.equal(pathDataOf(parsePathData(once)!), once, d);
    }
    assert.equal(pathDataOf(parsePathData('M0 0 L10 0 L10 10 Z')!), 'M0 0L10 0L10 10Z');
    assert.equal(pathDataOf([{ nodes: [{ x: 0.123456, y: -0.001 }, { x: 1, y: 1 }], closed: false }]), 'M0.12 0L1 1');
  });
});

describe('where a path may be edited point by point', () => {
  it('maps moves back through the path’s matrix, rotated and scaled', () => {
    const back = inverseMove([0, 2, -2, 0, 5, 5])!;
    assert.deepEqual(back(0, 2).map((n) => Math.round(n * 1e9) / 1e9), [1, 0]);
    assert.equal(inverseMove([1, 0, 0, 0, 0, 0]), null);
  });

  it('measures anchors and handles through the matrix', () => {
    const runs = parsePathData('M0 0 C0 -10 10 -10 10 0')!;
    assert.deepEqual(controlBounds(runs, [2, 0, 0, 2, 100, 100]), { x0: 100, y0: 80, x1: 120, y1: 100 });
  });

  it('says why a path can’t be edited', () => {
    const board = { w: 400, h: 300 };
    assert.equal(pathPoints('M0 0 A5 5 0 0 1 10 10', identity, board, 1), 'bad');
    assert.equal(pathPoints('M0 0 L1000 0', identity, board, 1), 'far');
    assert.equal(pathPoints(`M0 0${' L1 1'.repeat(6000)}`, identity, board, 1), 'long');
    assert.equal(pathPoints('M0 0 L20 20', identity, board, 1), 'small');
    assert.ok(Array.isArray(pathPoints('M0 0 L20 20', identity, board, 2)), 'zoomed in it is big enough');
    assert.ok(Array.isArray(pathPoints('M0 0 L40 40', identity, board, 1)));
    assert.ok(Array.isArray(pathPoints('M0 0 L20 20', [2, 0, 0, 2, 0, 0], board, 1)));
  });
});
