import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileSlide } from '@open-artifact/slides-core';
import { anchorLocation, describeAnchor, makeAnchor, partFromMarks, readAnchor } from '../src/lib/comment-anchor.ts';

const html = [
  '<section id="a">',
  '  <ul id="todo"><li>Write the brief</li><li>Ship the beta to the first ten teams</li></ul>',
  '  <table id="sales">',
  '    <tr><th>Quarter</th><th>Revenue</th></tr>',
  '    <tr><td>Q3</td><td>4.2m</td></tr>',
  '  </table>',
  '  <div data-text id="notes"><p>Intro</p><ul><li>One</li></ul><ol><li>Two</li><li>Three</li></ol></div>',
  '  <p>Plain words</p>',
  '</section>',
  '',
].join('\n');
const slide = compileSlide(html, { id: 'a', lints: false }).slide;

describe('anchors written before items and cells', () => {
  it('read back unchanged', () => {
    const old = { slide: 'a', el: 'todo', x: 10, y: 20 };
    assert.deepEqual(readAnchor(JSON.stringify(old)), old);
    assert.deepEqual(readAnchor(JSON.stringify({ slide: 'a', x: 1, y: 2, w: 3, h: 4 })), { slide: 'a', x: 1, y: 2, w: 3, h: 4 });
    assert.deepEqual(readAnchor('{}'), {});
    assert.deepEqual(readAnchor('not json'), {});
    assert.deepEqual(readAnchor('null'), {});
  });

  it('keep their labels', () => {
    assert.equal(describeAnchor({}, undefined, 0), 'Whole deck');
    assert.equal(describeAnchor({ slide: 'a' }, slide, 2), 'Slide 2');
    assert.equal(describeAnchor({ slide: 'a', el: 'todo', x: 5, y: 5 }, slide, 2), 'Slide 2 › Write the brief Ship the beta to the fi…');
    assert.equal(describeAnchor({ slide: 'a', el: 'sales' }, slide, 2), 'Slide 2 › Table 2×2');
    assert.equal(describeAnchor({ slide: 'a', x: 1, y: 2, w: 3, h: 4 }, slide, 2), 'Slide 2 › Area');
    assert.equal(describeAnchor({ slide: 'gone', el: 'todo' }, undefined, 0), 'Deleted slide');
  });

  it('keep their location fields', () => {
    assert.deepEqual(anchorLocation({ slide: 'a', el: 'todo', x: 5, y: 6 }, slide, 2), { slideId: 'a', slideIndex: 2, element: 'todo', point: { x: 5, y: 6 } });
    assert.deepEqual(anchorLocation({}, undefined, 0), {});
  });
});

describe('a comment on a list item or a table cell', () => {
  it('names the item and its words', () => {
    const anchor = makeAnchor(slide, [0], { x: 40.4, y: 80.6 }, undefined, { item: 1 });
    assert.deepEqual(anchor, { slide: 'a', el: 'todo', x: 40, y: 81, item: 1 });
    assert.equal(describeAnchor(anchor, slide, 3), 'Slide 3 › List item 2 › Ship the beta to the first ten teams');
    assert.deepEqual(anchorLocation(anchor, slide, 3), {
      slideId: 'a',
      slideIndex: 3,
      element: 'todo',
      point: { x: 40, y: 81 },
      listItem: 2,
      text: 'Ship the beta to the first ten teams',
    });
  });

  it('cuts long item text in the label', () => {
    const long = compileSlide(`<section id="b">\n  <ul id="l"><li>${'word '.repeat(30)}</li></ul>\n</section>\n`, { id: 'b', lints: false }).slide;
    const label = describeAnchor({ slide: 'b', el: 'l', item: 0 }, long, 1);
    assert.ok(label.startsWith('Slide 1 › List item 1 › word word'));
    assert.ok(label.endsWith('…'));
    assert.equal(label.length, 'Slide 1 › List item 1 › '.length + 40);
  });

  it('counts a text box’s items across its lists', () => {
    const anchor = makeAnchor(slide, [2], { x: 1, y: 1 }, undefined, { item: 2 });
    assert.equal(anchor.item, 2);
    assert.equal(describeAnchor(anchor, slide, 1), 'Slide 1 › List item 3 › Three');
  });

  it('names the cell by row and column and its words', () => {
    const anchor = makeAnchor(slide, [1], { x: 1, y: 1 }, undefined, { cell: [1, 1] });
    assert.deepEqual(anchor.cell, [1, 1]);
    assert.equal(describeAnchor(anchor, slide, 1), 'Slide 1 › Row 2, column 2 › 4.2m');
    assert.deepEqual(anchorLocation(anchor, slide, 1).cell, { row: 2, column: 2 });
  });

  it('drops a part the element does not have', () => {
    assert.equal(makeAnchor(slide, [0], { x: 1, y: 1 }, undefined, { item: 5 }).item, undefined);
    assert.equal(makeAnchor(slide, [1], { x: 1, y: 1 }, undefined, { item: 0 }).item, undefined);
    assert.equal(makeAnchor(slide, [0], { x: 1, y: 1 }, undefined, { cell: [0, 0] }).cell, undefined);
    assert.equal(makeAnchor(slide, [3], { x: 1, y: 1 }, undefined, { item: 0 }).item, undefined);
    assert.equal(makeAnchor(slide, null, { x: 1, y: 1 }, undefined, { item: 0 }).item, undefined);
  });

  it('falls back to the element when the item is gone', () => {
    const anchor = { slide: 'a', el: 'todo', item: 9 };
    assert.equal(describeAnchor(anchor, slide, 1), 'Slide 1 › Write the brief Ship the beta to the fi…');
    assert.equal(anchorLocation(anchor, slide, 1).listItem, undefined);
  });

  it('drops a malformed item or cell when read', () => {
    assert.deepEqual(readAnchor('{"slide":"a","el":"todo","item":-1}'), { slide: 'a', el: 'todo' });
    assert.deepEqual(readAnchor('{"slide":"a","el":"todo","item":"2"}'), { slide: 'a', el: 'todo' });
    assert.deepEqual(readAnchor('{"slide":"a","el":"sales","cell":[1]}'), { slide: 'a', el: 'sales' });
    assert.deepEqual(readAnchor('{"slide":"a","el":"sales","cell":[1,1.5]}'), { slide: 'a', el: 'sales' });
    assert.deepEqual(readAnchor('{"slide":"a","el":"sales","cell":[1,0]}'), { slide: 'a', el: 'sales', cell: [1, 0] });
  });

  it('reads the marks the slide view writes', () => {
    assert.deepEqual(partFromMarks('3', null), { item: 3 });
    assert.deepEqual(partFromMarks(null, '2:1'), { cell: [2, 1] });
    assert.equal(partFromMarks(null, null), undefined);
    assert.equal(partFromMarks('x', '1-2'), undefined);
  });
});
