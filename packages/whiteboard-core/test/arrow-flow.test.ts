/**
 * Flowing arrows: `flow` is kept only on a dashed arrow and only as `true`,
 * survives edits, is reported by the check when the board would drop it,
 * and moves its dashes towards the arrow's head.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARROW_FLOW, ARROW_STROKE, arrowFlowDashOffset } from '../src/arrows/labels.ts';
import { arrowFlowFindings, checkBoardDocuments } from '../src/check.ts';
import { normalizeArrow, setArrowHeads } from '../src/edits.ts';
import { normalizeElement } from '../src/normalize.ts';
import { arrowFlowsBackward, arrowLineStyle, hasFlowingArrow, withArrowLineStyle, type ArrowElement, type BoardElement } from '../src/schema.ts';

const arrow = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'arrow', id: 'a1', from: [0, 0], to: [200, 0], head: 'end', dash: true, color: 'ink', ...extra });
const read = (extra: Record<string, unknown> = {}): ArrowElement => {
  const element = normalizeElement(arrow(extra));
  assert.equal(element?.type, 'arrow');
  return element as ArrowElement;
};

describe('flow when read', () => {
  it('keeps flow: true on a dashed arrow', () => {
    assert.equal(read({ flow: true }).flow, true);
  });

  it('drops flow on a solid arrow', () => {
    assert.equal('flow' in read({ dash: false, flow: true }), false);
    assert.equal('flow' in read({ dash: undefined, flow: true }), false);
  });

  it('drops flow that is not exactly true', () => {
    for (const flow of ['true', 1, 'yes', {}, false, null]) assert.equal('flow' in read({ flow }), false, JSON.stringify(flow));
  });

  it('leaves a plain dashed arrow without flow', () => {
    assert.equal('flow' in read(), false);
  });
});

describe('flow through edits', () => {
  it('normalizeArrow keeps flow on a dashed arrow, after dash and before color', () => {
    const flowing = read({ flow: true });
    const normalized = normalizeArrow(flowing);
    assert.equal(normalized.flow, true);
    const keys = Object.keys(normalized);
    assert.equal(keys.indexOf('flow'), keys.indexOf('dash') + 1);
    assert.equal(setArrowHeads(flowing, ['arrow', 'none']).flow, true);
  });

  it('normalizeArrow drops flow from a solid arrow', () => {
    assert.equal('flow' in normalizeArrow({ ...read({ flow: true }), dash: false }), false);
  });
});

describe('line styles', () => {
  it('reads solid, dashed and flowing', () => {
    assert.equal(arrowLineStyle({ dash: false }), 'solid');
    assert.equal(arrowLineStyle({ dash: false, flow: true }), 'solid');
    assert.equal(arrowLineStyle({ dash: true }), 'dashed');
    assert.equal(arrowLineStyle({ dash: true, flow: true }), 'flowing');
  });

  it('writes dash and flow from a style', () => {
    const dashed = read();
    const flowing = withArrowLineStyle(dashed, 'flowing');
    assert.deepEqual([flowing.dash, flowing.flow], [true, true]);
    const still = withArrowLineStyle(flowing, 'dashed');
    assert.deepEqual([still.dash, 'flow' in still], [true, false]);
    const solid = withArrowLineStyle(flowing, 'solid');
    assert.deepEqual([solid.dash, 'flow' in solid], [false, false]);
    assert.equal(withArrowLineStyle(flowing, 'flowing'), flowing, 'unchanged when it already has the style');
  });

  it('finds a flowing arrow among elements', () => {
    const elements: BoardElement[] = [read()];
    assert.equal(hasFlowingArrow(elements), false);
    assert.equal(hasFlowingArrow([...elements, read({ id: 'a2', flow: true })]), true);
  });
});

describe('flow direction', () => {
  it('flows from → to unless the only head is at the start', () => {
    assert.equal(arrowFlowsBackward({ head: 'end' }), false);
    assert.equal(arrowFlowsBackward({ head: 'both' }), false);
    assert.equal(arrowFlowsBackward({ head: 'none' }), false);
    assert.equal(arrowFlowsBackward({ head: 'end', heads: ['arrow', 'none'] }), true);
    assert.equal(arrowFlowsBackward({ head: 'end', heads: ['arrow', 'circle'] }), true);
    assert.equal(arrowFlowsBackward({ head: 'end', heads: ['arrow', 'arrow'] }), false);
  });

  it('moves one dash period per loop, negative towards the to end', () => {
    assert.equal(ARROW_FLOW.period, ARROW_STROKE.dash[0]! + ARROW_STROKE.dash[1]!);
    assert.equal(ARROW_FLOW.period, 11);
    assert.equal(ARROW_FLOW.seconds, 0.5);
    assert.equal(arrowFlowDashOffset(0), 0);
    assert.equal(arrowFlowDashOffset(0, true), 0);
    assert.ok(Math.abs(arrowFlowDashOffset(0.3) + 3.3) < 1e-9);
    assert.ok(Math.abs(arrowFlowDashOffset(0.3, true) - 3.3) < 1e-9);
    assert.equal(arrowFlowDashOffset(1), 0, 'a whole period is back at the start');
  });
});

describe('flow in the check', () => {
  it('says flow without a dashed line is dropped', () => {
    const [finding] = arrowFlowFindings({ type: 'arrow', flow: true, dash: false });
    assert.equal(finding?.[0], 'warning');
    assert.match(finding?.[1] ?? '', /"dash": true/);
    assert.equal(arrowFlowFindings({ type: 'arrow', flow: true }).length, 1);
  });

  it('says flow that is not true is dropped', () => {
    assert.match(arrowFlowFindings({ type: 'arrow', flow: 'yes', dash: true })[0]?.[1] ?? '', /"yes"/);
  });

  it('passes a flowing dashed arrow and an arrow without flow', () => {
    assert.deepEqual(arrowFlowFindings({ type: 'arrow', flow: true, dash: true }), []);
    assert.deepEqual(arrowFlowFindings({ type: 'arrow', dash: false }), []);
  });

  it('reports it on the stored arrow of a board', () => {
    const findings = checkBoardDocuments(
      new Map<string, Record<string, unknown>>([
        ['board/meta', { v: 1, title: 'Board', order: ['a1', 'a2'] }],
        ['elements/a1', { type: 'arrow', from: [0, 0], to: [100, 0], head: 'end', dash: false, flow: true, color: 'ink' }],
        ['elements/a2', { type: 'arrow', from: [0, 50], to: [100, 50], head: 'end', dash: true, flow: true, color: 'ink' }],
      ]),
    );
    assert.deepEqual(
      findings.map(({ path, level }) => [path, level]),
      [['elements/a1', 'warning']],
    );
  });
});
