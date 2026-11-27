import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDcDocument, parseTemplate } from '@open-artifact/dc';
import { applyOp, type BoardOp } from '../src/lib/ops.ts';
import { acceptsChildren, isHiddenLayer, renameOp, reorderOp, visibilityOps } from '../src/lib/outline.ts';

const board = (template: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Test</title><script src="./support.js"></script></head>
<body>
<x-dc>${template}</x-dc>
<script type="text/x-dc" data-dc-script data-props='{}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;
const templateText = (source: string) => parseDcDocument(source).template!.text;
const modelOf = (source: string) => parseTemplate(templateText(source));
const apply = (source: string, ops: BoardOp[]) => ops.reduce((current, op) => applyOp(current, op)!.source, source);

// tids: div 0, h1 1, p 2, ul 3, li 4, img 5
const SOURCE = board('<div><h1>Title</h1><p>Body</p><ul><li>One</li></ul><img src="a.png"></div>');

describe('layers: reorder', () => {
  it('moves an element after another', () => {
    const op = reorderOp(modelOf(SOURCE), [1], 2, 'after');
    assert.ok(op);
    assert.match(templateText(applyOp(SOURCE, op)!.source), /<div><p>Body<\/p><h1>Title<\/h1><ul>/);
  });

  it('moves several elements inside a container, in document order', () => {
    const op = reorderOp(modelOf(SOURCE), [2, 1], 3, 'inside');
    assert.ok(op);
    assert.match(templateText(applyOp(SOURCE, op)!.source), /<ul><li>One<\/li><h1>Title<\/h1>\s*<p>Body<\/p><\/ul>/);
  });

  it('refuses drops into itself, into a void element, and no-ops', () => {
    const model = modelOf(SOURCE);
    assert.equal(reorderOp(model, [3], 4, 'before'), null, 'into its own child');
    assert.equal(reorderOp(model, [0], 1, 'after'), null, 'the root into itself');
    assert.equal(reorderOp(model, [1], 5, 'inside'), null, 'inside an image');
    assert.equal(reorderOp(model, [1], 2, 'before'), null, 'already there');
    assert.equal(reorderOp(model, [2], 1, 'after'), null, 'already there');
    assert.equal(reorderOp(model, [99], 1, 'after'), null, 'unknown element');
    assert.equal(acceptsChildren(model.elements[3]!), true);
    assert.equal(acceptsChildren(model.elements[5]!), false);
  });
});

describe('layers: rename and hide', () => {
  it('names a layer with data-label and clears it with an empty name', () => {
    const named = apply(SOURCE, [renameOp(modelOf(SOURCE), 2, '  Intro   copy ')!]);
    assert.match(templateText(named), /<p data-label="Intro copy">Body<\/p>/);
    assert.equal(renameOp(modelOf(named), 2, 'Intro copy'), null, 'unchanged');
    assert.match(templateText(apply(named, [renameOp(modelOf(named), 2, '')!])), /<p>Body<\/p>/);
  });

  it('hides with display:none and shows again', () => {
    const hidden = apply(SOURCE, visibilityOps(modelOf(SOURCE), 1));
    assert.match(templateText(hidden), /<h1 style="display: none;?">Title<\/h1>/);
    assert.equal(isHiddenLayer(modelOf(hidden).elements[1]!), true);
    const shown = apply(hidden, visibilityOps(modelOf(hidden), 1));
    assert.match(templateText(shown), /<h1>Title<\/h1>/);
  });

  it('keeps an inline display while hidden', () => {
    const source = board('<div style="display: flex; gap: 4px"><p>A</p></div>');
    const hidden = apply(source, visibilityOps(modelOf(source), 0));
    assert.match(templateText(hidden), /display: none/);
    assert.match(templateText(hidden), /data-display="flex"/);
    const shown = apply(hidden, visibilityOps(modelOf(hidden), 0));
    assert.match(templateText(shown), /display: flex/);
    assert.doesNotMatch(templateText(shown), /data-display/);
  });
});

describe('whole-source op', () => {
  it('replaces the source and survives replay', () => {
    const result = applyOp(SOURCE, { kind: 'source', text: board('<p>New</p>') });
    assert.ok(result);
    assert.match(templateText(result.source), /<p>New<\/p>/);
  });
});

describe('layers: rows follow their element', async () => {
  const { carryTids, climbAfter, draggedAncestorSteps, dropLevels, levelsLeft } = await import('../src/lib/outline.ts');

  it('maps tids across an insert, a delete and a style edit', () => {
    const before = parseTemplate('<div><h1>Title</h1><p>Body</p><ul><li>One</li></ul></div>');
    // tids: div 0, h1 1, p 2, ul 3, li 4
    const inserted = parseTemplate('<div><h2>New</h2><h1>Title</h1><p>Body</p><ul><li>One</li></ul></div>');
    assert.deepEqual([...carryTids(before, inserted)], [[0, 0], [1, 2], [2, 3], [3, 4], [4, 5]]);
    const removed = parseTemplate('<div><h1>Title</h1><ul><li>One</li></ul></div>');
    assert.deepEqual([...carryTids(before, removed)], [[0, 0], [1, 1], [3, 2], [4, 3]]);
    const styled = parseTemplate('<div><h1 style="color: red">Title</h1><p>Body</p><ul><li>One</li></ul></div>');
    assert.deepEqual([...carryTids(before, styled)], [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  });

  it('climbs out of last children only, and not out of a repeat', () => {
    const model = parseTemplate('<div><section><p>A</p><p>B</p></section><footer></footer></div><sc-for each="x"><span>1</span></sc-for>');
    // tids: div 0, section 1, p 2, p 3, footer 4, sc-for 5, span 6
    assert.deepEqual(climbAfter(model, 3, 5), [3, 1]);
    assert.deepEqual(climbAfter(model, 2, 5), [2]);
    assert.deepEqual(climbAfter(model, 4, 1), [4, 0]);
    assert.deepEqual(climbAfter(model, 6, 3), [6]);
    assert.equal(levelsLeft(100, 70, 16), 2);
    assert.equal(levelsLeft(100, 120, 16), 0);
  });

  it('below its own last row, a dragged container climbs to itself first, then by how far left it moved', () => {
    const model = parseTemplate('<div><section><p>A</p><p>B</p></section></div>');
    // tids: div 0, section 1, p 2, p 3
    assert.equal(draggedAncestorSteps(model, 3, [1]), 1);
    assert.equal(draggedAncestorSteps(model, 3, [0]), 2);
    assert.equal(draggedAncestorSteps(model, 3, [2]), null);
    // Not an ancestor: the indent rule.
    assert.equal(dropLevels({ indentStart: 100, pointerX: 70, startX: 200, indent: 16, ancestorSteps: null }), 2);
    // Dragging the section past its last p: back to the section (no move) until pulled a full step left of the start.
    assert.equal(dropLevels({ indentStart: 100, pointerX: 60, startX: 70, indent: 16, ancestorSteps: 1 }), 1);
    assert.equal(dropLevels({ indentStart: 100, pointerX: 54, startX: 70, indent: 16, ancestorSteps: 1 }), 2);
    assert.equal(dropLevels({ indentStart: 100, pointerX: 90, startX: 70, indent: 16, ancestorSteps: 1 }), 0);
    assert.deepEqual(climbAfter(model, 3, dropLevels({ indentStart: 100, pointerX: 54, startX: 70, indent: 16, ancestorSteps: 1 })), [3, 1, 0]);
  });
});

describe('layers: a graphic of one shape', async () => {
  const { buildOutline, loneLabelOp, rowTidOf } = await import('../src/lib/outline.ts');
  const source = board('<div><svg viewBox="0 0 10 10" data-label="Pointer"><path d="M0 0L10 10" stroke="#000" data-label="old"/></svg></div>');
  const model = modelOf(source);

  it('shows as one row named for the shape, labelled by the graphic', () => {
    const [root] = buildOutline(model);
    const row = root!.children[0]!;
    assert.equal(row.children.length, 0);
    assert.equal(row.glyph, 'shape');
    assert.equal(row.detail, 'Pointer');
    assert.equal(model.elements[row.tid]!.tag, 'svg');
  });

  it('selects the graphic row for its shape, and renaming clears the shape name', () => {
    const svgTid = buildOutline(model)[0]!.children[0]!.tid;
    const shapeTid = model.elements.findIndex((element) => element.tag === 'path');
    assert.equal(rowTidOf(model, shapeTid), svgTid);
    const op = loneLabelOp(model, svgTid)!;
    assert.ok(!apply(source, [op]).includes('data-label="old"'));
  });
});

describe('layers: rows follow their element through a move', async () => {
  const { carryTids } = await import('../src/lib/outline.ts');
  it('keeps the elements a move passes over', () => {
    const before = modelOf(board('<div><p>a</p><svg><rect/></svg><h2>b</h2></div>'));
    const after = modelOf(board('<div><svg><rect/></svg><h2>b</h2><p>a</p></div>'));
    const svg = (model: typeof before) => model.elements.findIndex((element) => element.tag === 'svg');
    const p = (model: typeof before) => model.elements.findIndex((element) => element.tag === 'p');
    const map = carryTids(before, after);
    assert.equal(map.get(svg(before)), svg(after));
    assert.equal(map.get(p(before)), p(after));
  });
});
