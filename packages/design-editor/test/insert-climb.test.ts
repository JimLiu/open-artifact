import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getAttribute, parseTemplate, type HtmlElement, type TemplateModel } from '@open-artifact/dc';
import { climbInsert, insertedText, insertMoves, markedText, type InsertSpot } from '../src/lib/insert-climb.ts';

/** A stand-in for the browser: a p holds no block, a link holds no link. */
function parserMoves(model: TemplateModel, html: string) {
  return (spot: InsertSpot): boolean => {
    const holder = spot.position === 'first-child' || spot.position === 'last-child' ? spot.target : spot.target?.parent ?? null;
    let node = holder;
    if (/^<(div|p|ul|section)/.test(html) && holder?.tag === 'p') return true;
    while (node) {
      if (node.tag === 'a' && /<a[\s>]/.test(html)) return true;
      node = node.parent;
    }
    void model;
    return false;
  };
}

const byId = (model: TemplateModel, id: string) => model.elements.find((element) => getAttribute(element, 'id')?.value === id)!;

describe('where an insert climbs to', () => {
  it('puts a block pasted into a paragraph after the paragraph', () => {
    const model = parseTemplate('<div id="root"><p id="p">Hi</p></div>');
    const p = byId(model, 'p');
    const html = '<div>x</div>';
    const spot = climbInsert(model, { target: p, position: 'last-child' }, html, parserMoves(model, html));
    assert.equal(spot.target, p);
    assert.equal(spot.position, 'after');
  });

  it('keeps an insert the parser leaves alone', () => {
    const model = parseTemplate('<div id="root"><section id="s"></section></div>');
    const s = byId(model, 's');
    const spot = climbInsert(model, { target: s, position: 'last-child' }, '<div>x</div>', () => false);
    assert.deepEqual(spot, { target: s, position: 'last-child' });
  });

  it('puts a link pasted inside a link after the outermost link', () => {
    const model = parseTemplate('<div id="root"><a id="outer" href="#"><span id="in"><a id="inner">x</a></span></a></div>');
    const html = '<a href="https://example.com">site</a>';
    const spot = climbInsert(model, { target: byId(model, 'in'), position: 'after' }, html, parserMoves(model, html));
    assert.equal(spot.target, byId(model, 'outer'));
    assert.equal(spot.position, 'after');
  });

  it('climbs before or after the parent, keeping the side', () => {
    const model = parseTemplate('<div id="root"><p id="p"><span id="a">a</span></p></div>');
    const html = '<div>x</div>';
    const spot = climbInsert(model, { target: byId(model, 'a'), position: 'before' }, html, parserMoves(model, html));
    assert.equal(spot.target, byId(model, 'p'));
    assert.equal(spot.position, 'before');
  });

  it('stays at the first spot when the parent can’t be edited or the top is reached', () => {
    const locked = parseTemplate('<div id="root" data-uneditable><p id="p">Hi</p></div>');
    const p = byId(locked, 'p');
    const html = '<div>x</div>';
    assert.deepEqual(climbInsert(locked, { target: p, position: 'last-child' }, html, parserMoves(locked, html)), { target: p, position: 'last-child' });
    const top = parseTemplate('<p id="p">Hi</p>');
    const only = byId(top, 'p');
    assert.deepEqual(climbInsert(top, { target: only, position: 'last-child' }, html, () => true), { target: only, position: 'last-child' });
  });
});

describe('telling whether the parser moved an insert', () => {
  it('labels every element where its start tag ends', () => {
    const model = parseTemplate('<div><img src="a.png"/><p>x</p></div>');
    assert.equal(markedText(model), '<div data-insert-mark="0"><img src="a.png" data-insert-mark="1"/><p data-insert-mark="2">x</p></div>');
  });

  /** A small parser that closes a p before a block and lifts a loop out of a table, as a browser does. */
  const browserLike = (marked: string) => {
    const model = parseTemplate(marked);
    const parents = new Map<string, string | null>();
    const label = (element: HtmlElement | null) => (element ? getAttribute(element, 'data-insert-mark')?.value ?? null : null);
    for (const element of model.elements) {
      let parent = element.parent;
      if (parent?.tag === 'p' && /^(div|section|ul)$/.test(element.tag)) parent = parent.parent;
      if (element.tag === 'sc-for' && parent?.tag === 'table') parent = parent.parent;
      if (element.tag === 'tr' && parent?.tag === 'sc-for' && parent.parent?.tag === 'table') parent = parent.parent;
      parents.set(label(element)!, label(parent));
    }
    return { parents, repeated: new Set<string>() };
  };

  it('sees a block put inside a paragraph moved, and the same block after it kept', () => {
    const model = parseTemplate('<div id="root"><p id="p">Hi <span id="s">x</span></p></div>');
    assert.equal(insertMoves(model, { target: byId(model, 's'), position: 'after' }, '<div>y</div>', browserLike), true);
    assert.equal(insertMoves(model, { target: byId(model, 'p'), position: 'after' }, '<div>y</div>', browserLike), false);
  });

  it('keeps a row next to a row the parser already lifts out of its loop', () => {
    const model = parseTemplate('<table id="t"><sc-for each="rows"><tr id="r"><td>x</td></tr></sc-for></table>');
    assert.equal(insertMoves(model, { target: byId(model, 'r'), position: 'after' }, '<tr><td>y</td></tr>', browserLike), false);
    const html = '<tr><td>y</td></tr>';
    const spot = climbInsert(model, { target: byId(model, 'r'), position: 'after' }, html, (at) => insertMoves(model, at, html, browserLike));
    assert.equal(spot.target, byId(model, 'r'));
  });

  it('sees an element already there that changes parent, and an inserted element the parser drops', () => {
    const model = parseTemplate('<div id="root"><p id="p">a</p></div>');
    const dropped = (marked: string) => {
      const parsed = browserLike(marked);
      for (const label of [...parsed.parents.keys()]) if (label.startsWith('n')) parsed.parents.delete(label);
      return parsed;
    };
    assert.equal(insertMoves(model, { target: byId(model, 'p'), position: 'after' }, '<span>y</span>', dropped), true);
    const pulled = (marked: string) => {
      const parsed = browserLike(marked);
      if (parsed.parents.has('n0')) parsed.parents.set('1', null);
      return parsed;
    };
    assert.equal(insertMoves(model, { target: byId(model, 'p'), position: 'after' }, '<span>y</span>', pulled), true);
  });

  it('writes the insert where the spot says', () => {
    const model = parseTemplate('<div id="root"><p id="p">Hi</p></div>');
    const { text, start, end } = insertedText(model, { target: byId(model, 'p'), position: 'after' }, '<div>x</div>');
    assert.equal(text, '<div id="root"><p id="p">Hi</p><div>x</div></div>');
    assert.equal(text.slice(start, end), '<div>x</div>');
  });
});
