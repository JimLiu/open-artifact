import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate, elementChildren } from '@open-artifact/dc';
import { noteHtml, noteTransformCss } from '../src/lib/note-html.ts';

const ids = () => {
  let n = 0;
  return { freshId: () => `head-${++n}` };
};

describe('a note as artboard HTML', () => {
  it('writes a one-line sticky as its words, with the sticky’s size and colour', () => {
    const layer = noteHtml({ x: 10, y: 20, text: 'Hello **there**', w: 200, h: 90, fill: 'blue' }, ids());
    assert.ok(layer);
    assert.deepEqual(layer.box, { x: 10, y: 20, w: 200, h: 90 });
    assert.match(layer.html, /^<div style="margin: 0; box-sizing: border-box; width: 200px; min-height: 90px; padding: 12px; border-radius: 2px; background-color: #d6e6fb;/);
    assert.match(layer.html, /font-size: 14px; white-space: pre-wrap;">Hello <strong>there<\/strong><\/div>$/);
  });

  it('writes paragraphs as divs, blank lines as an empty div, and lists as ul and ol', () => {
    const layer = noteHtml({ x: 0, y: 0, text: 'One\n\n- a\n- b\n3. c\n4. d\n# Head' }, ids());
    assert.ok(layer);
    assert.ok(layer.html.includes('<div>One</div><div><br></div><ul><li>a</li><li>b</li></ul><ol start="3"><li>c</li><li>d</li></ol><div style="font-size: 1.15em; font-weight: 700;">Head</div>'));
  });

  it('keeps only web links and escapes the words', () => {
    const layer = noteHtml({ x: 0, y: 0, text: 'a <b> & [site](https://example.com/?q="x") `x<y`' }, ids());
    assert.ok(layer);
    assert.ok(layer.html.includes('a &lt;b&gt; &amp; <a href="https://example.com/?q=&quot;x&quot;">site</a> <code>x&lt;y</code>'));
  });

  it('has no HTML for an empty text, text with an expression, or a link card', () => {
    assert.equal(noteHtml({ x: 0, y: 0, text: '  ' }, ids()), null);
    assert.equal(noteHtml({ x: 0, y: 0, text: 'Hi {{ name }}' }, ids()), null);
    assert.equal(noteHtml({ x: 0, y: 0, kind: 'title1', text: '{{a}}' }, ids()), null);
    assert.equal(noteHtml({ x: 0, y: 0, kind: 'link', href: 'https://example.com', text: 'x' }, ids()), null);
  });

  it('writes a title with its line height, width limit, weight and colour, lines joined by br', () => {
    const layer = noteHtml({ x: 0, y: 0, kind: 'title1', text: 'Big\nIdea', size: 'l', color: 'red', maxW: 600 }, ids());
    assert.ok(layer);
    assert.equal(layer.html, '<div style="margin: 0; line-height: 1.35; max-width: 600px; overflow-wrap: break-word; font-size: 40px; font-weight: 700; color: #d4483b; white-space: pre-wrap;">Big<br>Idea</div>');
  });

  it('writes a rectangle and an oval as empty boxes with the note’s fill, border and corner', () => {
    const rect = noteHtml({ x: 0, y: 0, kind: 'rect', w: 160, h: 100, fill: 'green' }, ids());
    assert.equal(rect?.html, '<div style="box-sizing: border-box; display: flex; flex-direction: column; width: 160px; height: 100px; background-color: #d7efd2; border-width: 3px; border-style: solid; border-color: #2b2b2b; border-radius: 6px;"></div>');
    const oval = noteHtml({ x: 0, y: 0, kind: 'oval', w: 80, h: 80, css: { 'background-color': '#ff0000' } }, ids());
    assert.ok(oval?.html.includes('align-items: center; justify-content: center;'));
    assert.ok(oval?.html.includes('background-color: #ff0000;'));
    assert.ok(oval?.html.includes('border-radius: 50%'));
  });

  it('writes a rotated, flipped note’s transform', () => {
    assert.equal(noteTransformCss({ x: 0, y: 0, rotate: 15, flipX: true }), ' transform: rotate(15deg) scale(-1, 1);');
    assert.equal(noteTransformCss({ x: 0, y: 0 }), '');
    const layer = noteHtml({ x: 0, y: 0, kind: 'rect', rotate: 90 }, ids());
    assert.ok(layer?.html.includes('transform: rotate(90deg);'));
  });

  it('writes an arrow as one path with a marker per head, the line pulled back from a filled head', () => {
    const layer = noteHtml({ x: 100, y: 50, kind: 'arrow', points: [[0, 0], [100, 0]], color: 'blue' }, ids());
    assert.ok(layer);
    assert.deepEqual(layer.box, { x: 100, y: 50, w: 100, h: 1 });
    const model = parseTemplate(layer.html);
    const [svg] = elementChildren(model.nodes);
    assert.equal(svg?.tag, 'svg');
    assert.ok(layer.html.includes('viewBox="0 0 100 1"'));
    assert.ok(layer.html.includes('stroke: #2f6fd6; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round;'));
    assert.ok(layer.html.includes('<defs><marker id="head-1"'));
    assert.ok(layer.html.includes('<path d="M0 0 L89.2 0" marker-end="url(#head-1)"></path>'));
    const both = noteHtml({ x: 0, y: 0, kind: 'line', points: [[0, 0], [0, 50]], headStart: 'open', headEnd: 'filled', dash: 'dashed' }, ids());
    assert.ok(both?.html.includes('marker-start="url(#head-1)" marker-end="url(#head-2)"'));
    assert.ok(both?.html.includes('M0 0 L0 39.2'));
    assert.ok(both?.html.includes('stroke-dasharray: 9 7.5;'));
    const plain = noteHtml({ x: 0, y: 0, kind: 'line', points: [[0, 0], [10, 10]] }, ids());
    assert.ok(!plain?.html.includes('marker'));
  });

  it('writes a pen stroke with a non-scaling stroke over its own box', () => {
    const layer = noteHtml({ x: 0, y: 0, kind: 'pen', points: [[5, 5], [20, 30], [40, 10]] }, ids());
    assert.ok(layer);
    assert.deepEqual(layer.box, { x: 5, y: 5, w: 35, h: 25 });
    assert.ok(layer.html.includes('viewBox="5 5 35 25"'));
    assert.ok(layer.html.includes('<path d="M5 5 L20 30 L40 10" vector-effect="non-scaling-stroke"></path>'));
  });

  it('writes an image with its alt and fit, and refuses an address that reads as template syntax', () => {
    const layer = noteHtml({ x: 0, y: 0, kind: 'image', src: 'uploads/a "b".png', alt: 'A cat', w: 320, h: 240 }, ids());
    assert.equal(layer?.html, '<img src="uploads/a &quot;b&quot;.png" alt="A cat" width="320" height="240" style="width: 320px; height: 240px; object-fit: fill;">');
    assert.equal(noteHtml({ x: 0, y: 0, kind: 'image', src: 'uploads/{{x}}.png' }, ids()), null);
    assert.equal(noteHtml({ x: 0, y: 0, kind: 'image', src: 'a.png', alt: '{{x}}' }, ids()), null);
  });

  it('writes a cropped picture as a clipping frame with the picture in percent inside', () => {
    const layer = noteHtml({ x: 0, y: 0, kind: 'image', src: '/_blob/aa', alt: 'Team', w: 400, h: 200, crop: { zoom: 2, x: 0.25, y: 1 }, css: { 'object-fit': 'cover', 'border-width': '2px', 'border-radius': '12px' } }, ids());
    assert.equal(
      layer?.html,
      '<div style="box-sizing: border-box; position: relative; contain: layout; overflow: hidden; width: 400px; height: 200px; border-width: 2px; border-style: solid; border-radius: 12px;">' +
        '<img src="/_blob/aa" alt="Team" style="position: absolute; width: 200%; height: 200%; left: -25%; top: -100%; max-width: none; max-height: none; object-fit: cover; object-position: 25% 100%;"></div>',
    );
    const plain = noteHtml({ x: 0, y: 0, kind: 'image', src: '/_blob/aa', w: 100, h: 100, crop: { zoom: 1.5, x: 0.5, y: 0.5 }, rotate: 10 }, ids());
    assert.match(plain!.html, /^<div style="position: relative; contain: layout; overflow: hidden; width: 100px; height: 100px; transform: rotate\(10deg\);">/);
  });

  it('writes a video note as a video with only the play attributes it needs', () => {
    const autoplay = noteHtml({ x: 0, y: 0, kind: 'image', src: '/_blob/c', video: '/_blob/v', alt: 'Demo', w: 320, h: 180 }, ids());
    assert.equal(autoplay?.html, '<video src="/_blob/v" poster="/_blob/c" aria-label="Demo" autoplay loop muted playsinline style="width: 320px; height: 180px; object-fit: fill;"></video>');
    const click = noteHtml({ x: 0, y: 0, kind: 'image', src: '/_blob/c', video: '/_blob/v', videoStart: 'click', videoLoop: 'off', videoSound: 'on', videoCover: 'custom', w: 320, h: 180 }, ids());
    assert.equal(click?.html, '<video src="/_blob/v" poster="/_blob/c" playsinline style="width: 320px; height: 180px; object-fit: cover;"></video>');
    assert.ok(!click!.html.includes('autoplay'));
  });

  it('never lets an expression into the template', () => {
    for (const note of [
      { x: 0, y: 0, text: 'see [x](https://a.com/{{b}})' },
      { x: 0, y: 0, kind: 'pen' as const, d: 'M0 0 L{{x}} 1' },
    ]) {
      const layer = noteHtml(note, ids());
      assert.ok(!layer || !layer.html.includes('{{'), layer?.html);
    }
  });
});
