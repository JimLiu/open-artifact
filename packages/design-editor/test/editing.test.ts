import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDcDocument } from '@open-artifact/dc';
import { applyOp } from '../src/lib/ops.ts';
import { clipboardData, joinedPayload, payloadFromHtml, type ClipboardPayload, type ElementsPayload } from '../src/lib/clipboard-data.ts';
import { combineSelection, flowDrop, marqueeHits, type MarqueeCandidate } from '../src/lib/gestures.ts';

const board = (template: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>${template}</x-dc>
<script type="text/x-dc" data-dc-script data-props='{}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;

const templateOf = (source: string) => parseDcDocument(source).template!.text;

describe('styles op', () => {
  it('patches each element with its own style, as one edit', () => {
    const source = board('<div style="position: relative"><i style="position: absolute; left: 10px"></i><b style="position: absolute; right: 4px"></b></div>');
    const result = applyOp(source, {
      kind: 'styles',
      edits: [
        { target: { tid: 1, path: [0, 0] }, patch: { left: '12px', top: '3px' } },
        { target: { tid: 2, path: [0, 1] }, patch: { right: '2px' } },
      ],
    });
    assert.ok(result);
    assert.equal(templateOf(result.source), '<div style="position: relative"><i style="position: absolute; left: 12px; top: 3px"></i><b style="position: absolute; right: 2px"></b></div>');
    assert.deepEqual(result.created, []);
  });

  it('drops the edit when a target is stale', () => {
    const source = board('<div><i></i></div>');
    assert.equal(applyOp(source, { kind: 'styles', edits: [{ target: { tid: 1, path: [0, 3] }, patch: { left: '1px' } }] }), null);
  });
});

describe('clipboard', () => {
  it('round-trips a payload through clipboard HTML, unicode included', () => {
    const payload: ClipboardPayload = { kind: 'elements', board: 'A.dc.html', html: ['<p>Hello — 你好</p>', '<div></div>'] };
    const { html, text } = clipboardData(payload);
    assert.equal(text, '<p>Hello — 你好</p>\n<div></div>');
    assert.ok(html.endsWith(text));
    assert.deepEqual(payloadFromHtml(html), payload);
  });

  it('gives other apps the standalone HTML and keeps it out of the marker', () => {
    const payload: ClipboardPayload = { kind: 'elements', board: 'A.dc.html', html: ['<p class="x">{{name}}</p>'], rendered: ['<p class="x">Ann</p>'], css: ['.x { color: red; }'], standalone: '<p style="color: red">Ann</p>' };
    const { html, text } = clipboardData(payload);
    assert.equal(text, '<p style="color: red">Ann</p>');
    assert.ok(html.endsWith(text));
    const { standalone: _dropped, ...kept } = payload;
    assert.deepEqual(payloadFromHtml(html), kept);
  });

  it('keeps the elements of a selection across files in one payload, each artboard\'s apart', () => {
    const a: ElementsPayload = { kind: 'elements', board: 'A.dc.html', html: ['<p>One</p>'], standalone: '<p style="color: red">One</p>', at: { x: 0, y: 0 } };
    const b: ElementsPayload = { kind: 'elements', board: 'B.dc.html', html: ['<div>Two</div>'], at: { x: 900, y: 0 } };
    const payload = joinedPayload([a, b])!;
    assert.equal(payload.kind, 'mixed');
    const { html, text } = clipboardData(payload);
    // Other apps get the elements.
    assert.ok(html.endsWith('<p style="color: red">One</p>\n<div>Two</div>'));
    assert.equal(text, '<p style="color: red">One</p>\n<div>Two</div>');
    const back = payloadFromHtml(html)!;
    assert.equal(back.kind, 'mixed');
    assert.deepEqual(back.kind === 'mixed' && back.elements.map((part) => [part.board, part.html, part.at, part.standalone]), [['A.dc.html', ['<p>One</p>'], { x: 0, y: 0 }, undefined], ['B.dc.html', ['<div>Two</div>'], { x: 900, y: 0 }, undefined]]);
  });

  it('gives copied elements of several artboards the simplest payload that holds them', () => {
    const a: ElementsPayload = { kind: 'elements', board: 'A.dc.html', html: ['<p>One</p>'] };
    const empty: ElementsPayload = { kind: 'elements', board: 'B.dc.html', html: [] };
    assert.equal(joinedPayload([a, empty]), a);
    assert.equal(joinedPayload([empty]), null);
    assert.equal(joinedPayload([]), null);
  });

  it('ignores foreign HTML', () => {
    assert.equal(payloadFromHtml('<p>from another app</p>'), null);
    assert.equal(payloadFromHtml('<meta data-open-artifact-design="not base64!">'), null);
  });
});

describe('marquee', () => {
  const candidates: MarqueeCandidate[] = [
    { tid: 1, path: [0, 0], rects: [{ x: 0, y: 0, w: 100, h: 100 }] },
    { tid: 2, path: [0, 0, 0], rects: [{ x: 10, y: 10, w: 20, h: 20 }] },
    { tid: 3, path: [0, 1], rects: [{ x: 200, y: 0, w: 50, h: 50 }, { x: 200, y: 100, w: 50, h: 50 }] },
  ];

  it('selects what the box touches', () => {
    const hits = marqueeHits(candidates, { x: 90, y: 90, w: 120, h: 20 }, false);
    assert.deepEqual(hits.map((h) => [h.tid, h.instance]), [[1, 0], [3, 1]]);
  });

  it('deep: selects what is fully inside, without ancestors of other hits', () => {
    assert.deepEqual(marqueeHits(candidates, { x: -5, y: -5, w: 120, h: 120 }, true).map((h) => h.tid), [2]);
    assert.deepEqual(marqueeHits(candidates, { x: 5, y: 5, w: 30, h: 30 }, true).map((h) => h.tid), [2]);
  });

  it('shift toggles against the earlier selection', () => {
    const a = { tid: 1, path: [0], instance: 0 };
    const b = { tid: 2, path: [1], instance: 0 };
    const c = { tid: 3, path: [2], instance: 0 };
    assert.deepEqual(combineSelection([a, b], [b, c], true), [a, c]);
    assert.deepEqual(combineSelection([a, b], [c], false), [c]);
  });
});

describe('flow drop', () => {
  const siblings = [
    { address: { tid: 1, path: [0] }, rect: { x: 0, y: 0, w: 100, h: 40 } },
    { address: { tid: 2, path: [1] }, rect: { x: 0, y: 50, w: 100, h: 40 } },
  ];

  it('lands before or after the nearest sibling of a column', () => {
    const drop = flowDrop({ board: 'b', siblings, layout: 'column' }, { x: 50, y: 85 });
    assert.deepEqual([drop!.target.tid, drop!.position], [2, 'after']);
    assert.deepEqual(drop!.line, { x1: 0, y1: 90, x2: 100, y2: 90 });
    const top = flowDrop({ board: 'b', siblings, layout: 'column' }, { x: 50, y: -30 });
    assert.deepEqual([top!.target.tid, top!.position], [1, 'before']);
  });

  it('does nothing over the dragged elements themselves', () => {
    assert.equal(flowDrop({ board: 'b', siblings, layout: 'column', origin: [{ x: 0, y: 100, w: 100, h: 40 }] }, { x: 50, y: 120 }), null);
  });

  it('uses the horizontal axis in a row', () => {
    const row = [
      { address: { tid: 1, path: [0] }, rect: { x: 0, y: 0, w: 40, h: 40 } },
      { address: { tid: 2, path: [1] }, rect: { x: 50, y: 0, w: 40, h: 40 } },
    ];
    const drop = flowDrop({ board: 'b', siblings: row, layout: 'row' }, { x: 55, y: 20 });
    assert.deepEqual([drop!.target.tid, drop!.position, drop!.line!.x1], [2, 'before', 50]);
  });
});
