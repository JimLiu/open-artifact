import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileSlide, nodeAt, pinnedRectOf, type NodePath, type Slide, type SlideNode } from '@open-artifact/slides-core';
import {
  anchorShift,
  formatScale,
  gripAnchor,
  gripFactor,
  parseScaleInput,
  scaleGrips,
  scaleInRange,
  scaleLengths,
  scaleLimits,
  scaleSlide,
  stepScale,
  type Measured,
  type ScaleTarget,
  type ScaleUnit,
} from '../src/lib/scale.ts';

const slide = (): Slide =>
  compileSlide(
    `<section id="scale">
  <h1 style="position:absolute;left:100px;top:100px;width:400px;height:80px;font-size:40px;padding:10px 20px;letter-spacing:0.5px">Title</h1>
  <div data-group style="position:absolute;left:600px;top:200px;width:300px;height:200px;border-radius:12px">
    <p style="position:absolute;left:20px;top:30px;width:200px;height:40px;font-size:20px">Inside</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:16px;padding:40px">
    <p style="font-size:24px">First in the flow</p>
    <p style="font-size:24px">Second in the flow</p>
  </div>
</section>`,
    { id: 'scale', lints: false },
  ).slide;

const node = (s: Slide, path: NodePath): SlideNode => nodeAt(s, path)!;

/** A unit for a pinned element at the slide's top level (its host is the slide). */
function pinnedUnit(s: Slide, path: NodePath, measured = new Map<string, Measured>()): ScaleUnit {
  const rect = pinnedRectOf(node(s, path))!;
  return { path, host: { x: 0, y: 0 }, rect, measured };
}

function targetOf(units: ScaleUnit[]): ScaleTarget {
  const x = Math.min(...units.map((u) => u.host.x + u.rect.x));
  const y = Math.min(...units.map((u) => u.host.y + u.rect.y));
  const right = Math.max(...units.map((u) => u.host.x + u.rect.x + u.rect.w));
  const bottom = Math.max(...units.map((u) => u.host.y + u.rect.y + u.rect.h));
  return { units, box: { x, y, w: right - x, h: bottom - y } };
}

describe('scale input', () => {
  it('reads percentages, multiples and widths in px', () => {
    assert.equal(parseScaleInput('150%'), 1.5);
    assert.equal(parseScaleInput('150'), 1.5);
    assert.equal(parseScaleInput('%150'), 1.5);
    assert.equal(parseScaleInput(' 1.5x '), 1.5);
    assert.equal(parseScaleInput('2×'), 2);
    assert.equal(parseScaleInput('800px', 400), 2);
    assert.equal(parseScaleInput('800px'), null);
  });

  it('reads digits of other scripts and a comma for the decimal point, but not thousands', () => {
    assert.equal(parseScaleInput('１５０％'), 1.5);
    assert.equal(parseScaleInput('١٥٠٪'), 1.5);
    assert.equal(parseScaleInput('1,5x'), 1.5);
    assert.equal(parseScaleInput('1,500%'), null);
  });

  it('refuses what is no positive amount', () => {
    for (const text of ['', 'abc', '0', '-50%', '%150x', '1.5.0', '150%%']) assert.equal(parseScaleInput(text, 400), null, text);
  });

  it('says whether a factor is usable, shows it as a percentage and steps it', () => {
    const limits = { min: 0.5, max: 2 };
    assert.equal(scaleInRange(null, limits), false);
    assert.equal(scaleInRange(0.4, limits), false);
    assert.equal(scaleInRange(2, limits), true);
    assert.equal(formatScale(1.2345), '123.5%');
    assert.equal(stepScale(1, true, false, limits), 1.01);
    assert.equal(stepScale(1, false, true, limits), 0.9);
    assert.equal(stepScale(1.95, true, true, limits), 2);
  });
});

describe('scale lengths', () => {
  it('scales absolute lengths and leaves the rest', () => {
    assert.equal(scaleLengths('10px 20px', 2), '20px 40px');
    assert.equal(scaleLengths('0 2px 4px rgba(0,0,0,.2)', 1.5), '0 3px 6px rgba(0,0,0,.2)');
    assert.equal(scaleLengths('50%', 2), '50%');
    assert.equal(scaleLengths('1.5', 2), '1.5');
    assert.equal(scaleLengths('url(a-10px.png)', 2), 'url(a-10px.png)');
  });
});

describe('scale a selection', () => {
  it('changes nothing at 100%', () => {
    const s = slide();
    assert.equal(scaleSlide(s, targetOf([pinnedUnit(s, [0])]), 1, { x: 0, y: 0 }), s);
  });

  it('scales a pinned element about its top-left, text and spacing included', () => {
    const s = slide();
    const next = scaleSlide(s, targetOf([pinnedUnit(s, [0])]), 1.5, { x: 0, y: 0 });
    const title = node(next, [0]);
    assert.deepEqual(pinnedRectOf(title), { x: 100, y: 100, w: 600, h: 120 });
    assert.equal(title.style['font-size'], '60px');
    assert.equal(title.style.padding, '15px 30px');
    assert.equal(title.style['letter-spacing'], '0.75px');
  });

  it('scales a group and what is inside it, leaving the inner positions relative to the group', () => {
    const s = slide();
    const next = scaleSlide(s, targetOf([pinnedUnit(s, [1])]), 2, { x: 0, y: 0 });
    const group = node(next, [1]);
    assert.deepEqual(pinnedRectOf(group), { x: 600, y: 200, w: 600, h: 400 });
    assert.equal(group.style['border-radius'], '24px');
    const inner = node(next, [1, 0]);
    assert.deepEqual(pinnedRectOf(inner), { x: 40, y: 60, w: 400, h: 80 });
    assert.equal(inner.style['font-size'], '40px');
  });

  it('keeps several elements where they are relative to each other', () => {
    const s = slide();
    const next = scaleSlide(s, targetOf([pinnedUnit(s, [0]), pinnedUnit(s, [1])]), 0.5, { x: 0, y: 0 });
    // The box's top-left (100, 100) stays; the group moves halfway towards it.
    assert.deepEqual(pinnedRectOf(node(next, [0])), { x: 100, y: 100, w: 200, h: 40 });
    assert.deepEqual(pinnedRectOf(node(next, [1])), { x: 350, y: 150, w: 150, h: 100 });
  });

  it('moves the box by the shift a grip asks for', () => {
    const s = slide();
    const unit = pinnedUnit(s, [0]);
    const target = targetOf([unit]);
    // The top-left grip keeps the bottom-right corner in place.
    const shift = anchorShift(target.box, gripAnchor('nw'), 1, 2);
    assert.deepEqual(shift, { x: -400, y: -80 });
    const next = scaleSlide(s, target, 2, shift);
    assert.deepEqual(pinnedRectOf(node(next, [0])), { x: -300, y: 20, w: 800, h: 160 });
  });

  it('leaves a height the text sets for itself to the text', () => {
    const s = compileSlide(`<section id="t"><p style="position:absolute;left:10px;top:20px;width:200px;font-size:20px">Words</p></section>`, { id: 't', lints: false }).slide;
    const unit: ScaleUnit = { path: [0], host: { x: 0, y: 0 }, rect: { x: 10, y: 20, w: 200, h: 30 }, measured: new Map() };
    const next = node(scaleSlide(s, { units: [unit], box: { x: 10, y: 20, w: 200, h: 30 } }, 2, { x: 0, y: 0 }), [0]);
    assert.equal(next.style.width, '400px');
    assert.equal(next.style.height, undefined);
    assert.equal(next.style.left, '10px');
    assert.equal(next.style['font-size'], '40px');
  });

  it('writes down measured sizes for elements the layout sizes', () => {
    const s = slide();
    const measured = new Map<string, Measured>([['2.0', { fontSize: 24 }], ['2', { fontSize: 16 }]]);
    const unit: ScaleUnit = { path: [2, 0], host: { x: 0, y: 0 }, rect: { x: 40, y: 40, w: 500, h: 30 }, measured };
    const next = scaleSlide(s, { units: [unit], box: { x: 40, y: 40, w: 500, h: 30 } }, 2, { x: 0, y: 0 });
    const first = node(next, [2, 0]);
    assert.equal(first.style['font-size'], '48px');
    assert.equal(first.style.position, undefined, 'an element in the flow stays in the flow');
  });
});

describe('scale grips', () => {
  it('turns with the box: a grip pulled along its own axis', () => {
    assert.equal(gripFactor({ w: 200, h: 100 }, 'se', 200, 100), 2);
    assert.equal(gripFactor({ w: 200, h: 100 }, 'e', 100, 0), 1.5);
    // Turned 90°: dragging the right side down widens it.
    assert.ok(Math.abs(gripFactor({ w: 200, h: 100 }, 'e', 0, 100, 90) - 1.5) < 1e-9);
  });

  it('keeps the turned box’s opposite corner in place', () => {
    const box = { w: 100, h: 50 };
    const shift = anchorShift(box, gripAnchor('se'), 1, 2, 90);
    // Its own top-left corner sits at (75, -25) on the slide, before and after.
    assert.ok(Math.abs(shift.x - -75) < 1e-9 && Math.abs(shift.y - 25) < 1e-9, JSON.stringify(shift));
  });

  it('offers every grip for a pinned element, the far one in a flow that keeps the top-left, none for several', () => {
    const s = slide();
    assert.equal(scaleGrips(s, [[0]], nodeAt), 'all');
    assert.equal(scaleGrips(s, [[1, 0]], nodeAt), 'all');
    assert.equal(scaleGrips(s, [[2, 0]], nodeAt), 'far');
    assert.equal(scaleGrips(s, [[2, 1]], nodeAt), 'far');
    assert.equal(scaleGrips(s, [[0], [1]], nodeAt), 'none');
  });
});

describe('scale limits', () => {
  it('keeps type inside the font size range and the box large enough to grab', () => {
    const s = slide();
    const limits = scaleLimits(s, targetOf([pinnedUnit(s, [0])]), nodeAt);
    // 40px type: 8px at 20%, 400px at 1000%. The box's 400px side stays at 24px or more (6%).
    assert.deepEqual(limits, { min: 0.2, max: 10 });
  });

  it('always allows 100%', () => {
    const s = compileSlide(`<section id="t"><p style="position:absolute;left:0;top:0;width:10px;height:10px;font-size:500px">x</p></section>`, { id: 't', lints: false }).slide;
    const limits = scaleLimits(s, targetOf([pinnedUnit(s, [0])]), nodeAt);
    assert.equal(limits.max, 1);
    assert.equal(limits.min, 1);
  });
});
