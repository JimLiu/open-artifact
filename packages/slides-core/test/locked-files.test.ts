import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  checkSlidesProject,
  compileSlide,
  createSourceDeck,
  duplicateNodes,
  flattenSlide,
  isFlatSlideHtml,
  nodeAt,
  patchSourceSlide,
  readSourceSlide,
  serializeSlide,
  setListKind,
  setTextTag,
  type BoxNode,
  type NodePath,
  type Slide,
  type SlideNode,
  type TextNode,
} from '../src/index.ts';

/** A plain deck slide written in the serializer's own spelling, so a clean save gives it back byte for byte. */
const PLAIN = `<section id="pinned" style="background:#fff">
  <div data-locked style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:linear-gradient(90deg, #123456, #abcdef)"></div>
  <h1 data-locked style="position:absolute;left:120px;top:100px;width:900px">Title</h1>
  <p style="position:absolute;left:120px;top:300px;width:900px">Body</p>
  <div data-locked style="position:relative;width:600px;height:400px;background:#eee">
    <p style="position:absolute;left:20px;top:20px;width:200px">Layer</p>
  </div>
  <svg data-locked style="position:absolute;left:100px;top:700px;width:100px;height:100px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#f00"/></svg>
  <table data-locked style="position:absolute;left:300px;top:700px;width:600px">
    <tr><th>A</th><td>B</td></tr>
  </table>
  <div data-locked data-text style="position:absolute;left:1000px;top:800px;width:400px">
    <p>One</p>
  </div>
</section>
`;

const compile = (source: string, id = 'pinned'): ReturnType<typeof compileSlide> => compileSlide(source, { id, lints: false });
const at = (slide: Slide, ...path: number[]): SlideNode => nodeAt(slide, path)!;
const lockMessages = (result: { diagnostics: ReadonlyArray<{ message: string }> }): string[] =>
  result.diagnostics.map((d) => d.message).filter((m) => m.includes('data-locked'));

function withLock(slide: Slide, path: NodePath, locked: boolean): Slide {
  const copy = structuredClone(slide);
  let list = copy.children;
  let node: SlideNode | undefined;
  for (const i of path) {
    node = list[i];
    if (node?.kind === 'box') list = node.children;
  }
  if (!node) throw new Error('no node');
  if (locked) node.locked = true;
  else delete node.locked;
  return copy;
}

describe('data-locked in a plain deck', () => {
  it('reads the lock onto element nodes and writes the slide back unchanged', () => {
    const result = compile(PLAIN);
    assert.equal(result.held, false);
    assert.deepEqual(lockMessages(result), []);
    const { slide } = result;
    assert.equal(at(slide, 0).locked, true);
    assert.equal(at(slide, 1).locked, true);
    assert.equal(at(slide, 2).locked, undefined);
    assert.equal(at(slide, 3).locked, true);
    assert.equal(at(slide, 3, 0).locked, undefined);
    assert.equal(at(slide, 4).locked, true);
    assert.equal(at(slide, 5).locked, true);
    assert.equal(at(slide, 6).locked, true);
    assert.equal(serializeSlide(slide), PLAIN);
  });

  it('keeps the lock out of an inline drawing and keeps one written inside it as drawing markup', () => {
    const svg = at(compile(PLAIN).slide, 4);
    assert.equal(svg.kind, 'svg');
    if (svg.kind === 'svg') assert.doesNotMatch(svg.markup, /data-locked/);
    const inner = PLAIN.replace('<circle cx', '<circle data-locked cx');
    const read = compile(inner);
    const drawing = at(read.slide, 4);
    assert.equal(drawing.locked, true);
    if (drawing.kind === 'svg') assert.match(drawing.markup, /^<svg[^>]*>(?:(?!data-locked).)*<circle data-locked cx/);
    assert.equal(serializeSlide(read.slide), inner);
  });

  it('accepts the lock without a value and writes it bare', () => {
    const read = compile(PLAIN.replace('<h1 data-locked', '<h1 data-locked="true"'));
    assert.equal(at(read.slide, 1).locked, true);
    assert.equal(serializeSlide(read.slide), PLAIN);
  });

  it('drops a lock on parts of an element (cells, rows, lines, items, spans) quietly, and says so on the section', () => {
    const parts = `<section id="parts" data-locked>
  <table style="width:600px"><tr data-locked><th data-locked>A</th><td>B</td></tr></table>
  <div data-text style="width:400px"><p data-locked>One <span data-locked style="color:#f00">red</span></p><ul data-locked><li data-locked>Item</li></ul></div>
  <ul style="font-size:32px"><li data-locked>Loose item</li></ul>
</section>`;
    const result = compile(parts, 'parts');
    assert.deepEqual(lockMessages(result), ['slide "parts": <section> data-locked= is ignored: lock the elements on the slide']);
    assert.doesNotMatch(serializeSlide(result.slide), /data-locked/);
    for (let i = 0; i < 3; i++) assert.equal(at(result.slide, i).locked, undefined);
  });

  it('adds or removes only that attribute when a lock is set or cleared', () => {
    const { slide } = compile(PLAIN);
    assert.equal(serializeSlide(withLock(slide, [2], true)), PLAIN.replace('<p style="position:absolute;left:120px;top:300px', '<p data-locked style="position:absolute;left:120px;top:300px'));
    assert.equal(serializeSlide(withLock(slide, [1], false)), PLAIN.replace('<h1 data-locked', '<h1'));
    assert.equal(serializeSlide(withLock(slide, [3], false)), PLAIN.replace('<div data-locked style="position:relative', '<div style="position:relative'));
  });

  it("keeps a lock when a locked element's neighbours are edited", () => {
    const edited = structuredClone(compile(PLAIN).slide);
    const body = edited.children[2] as TextNode;
    body.runs = [{ text: 'Other words' }];
    body.style.left = '160px';
    edited.children.splice(2, 0, { kind: 'text', tag: 'p', style: { position: 'absolute', left: '0', top: '0' }, runs: [{ text: 'New' }] });
    const out = serializeSlide(edited);
    assert.match(out, /<div data-locked style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:linear-gradient/);
    assert.match(out, /<h1 data-locked /);
    assert.match(out, /<div data-locked style="position:relative/);
    assert.equal((out.match(/data-locked/g) ?? []).length, 6);
  });

  it('keeps a locked full-slide backdrop and a locked layered box as elements of their own', () => {
    const back = compile(serializeSlide(compile(PLAIN).slide)).slide;
    assert.deepEqual(back.style, { background: '#fff' });
    assert.equal(at(back, 0).kind, 'box');
    assert.equal(at(back, 0).locked, true);
    assert.equal(at(back, 3).kind, 'box');
    assert.equal(at(back, 3).locked, true);
    assert.equal((at(back, 3) as BoxNode).children.length, 1);
  });

  it('keeps the lock through edits that rebuild a node', () => {
    const text: TextNode = { kind: 'text', tag: 'p', style: {}, runs: [{ text: 'a\nb' }], locked: true };
    const list = setListKind(text, 'ul');
    assert.equal(list.locked, true);
    assert.equal(setListKind(list, null).locked, true);
    assert.equal(setTextTag(text, 'h2', {}).locked, true);
  });

  it('makes duplicates without the lock', () => {
    const { slide } = compile(PLAIN);
    const result = duplicateNodes(slide, [[3]]);
    const copy = nodeAt(result.slide, result.paths[0]!)!;
    assert.equal(copy.locked, undefined);
    assert.equal(at(result.slide, 3).locked, true);
  });

  it('is not reported by the project check', () => {
    const files = new Map([
      ['deck.json', JSON.stringify({ v: 4, title: 'Locks', order: ['pinned'] })],
      ['slides/pinned.html', PLAIN],
    ]);
    assert.deepEqual(checkSlidesProject(files, { lints: false }).filter((d) => d.message.includes('data-locked')), []);
  });
});

describe('data-locked in a source deck', () => {
  const FIXTURE = new URL('./fixtures/source-deck/project/', import.meta.url);
  const deck = createSourceDeck(readFileSync(new URL('deck.css', FIXTURE), 'utf8'));
  const source = `<section id="plan">
  <h2 style="font-size:64px">The plan</h2>
  <div class="cards">
    <div class="card" data-locked>
      <h3>First</h3>
      <p>Read the sheet.</p>
    </div>
    <div class="card wide">
      <h3>Second</h3>
      <p data-locked>Write edits back.</p>
    </div>
  </div>
  <svg class="mark" data-locked viewBox="0 0 10 10" style="position:absolute;left:1600px;top:80px;width:120px;height:120px"><circle cx="5" cy="5" r="4"/></svg>
</section>
`;
  const read = (html: string): Slide => readSourceSlide(html, deck, { id: 'plan', index: 1, lints: false }).slide;
  const saved = read(source);
  const patchTo = (edited: Slide): string | undefined => patchSourceSlide(source, saved, edited, deck, { id: 'plan', index: 1 });
  const patch = (edit: (s: Slide) => void): string | undefined => {
    const edited = structuredClone(saved);
    edit(edited);
    return patchTo(edited);
  };
  const cards = (s: Slide): BoxNode => s.children[1] as BoxNode;

  it('reads the lock and reports nothing about it', () => {
    const result = readSourceSlide(source, deck, { id: 'plan', index: 1, lints: false });
    assert.equal(result.held, false);
    assert.deepEqual(lockMessages(result), []);
    assert.equal(at(saved, 1, 0).locked, true);
    assert.equal(at(saved, 1, 1).locked, undefined);
    assert.equal(at(saved, 1, 1, 1).locked, true);
    assert.equal(at(saved, 2).locked, true);
  });

  it('writes nothing when nothing changed, and keeps locks through edits beside them', () => {
    assert.equal(patchTo(saved), source);
    const out = patch((s) => ((s.children[0] as TextNode).runs = [{ text: 'The new plan' }]));
    assert.equal(out, source.replace('The plan', 'The new plan'));
    const styled = patch((s) => (cards(s).children[1]!.style.background = '#ffeedd'));
    assert.equal(styled, source.replace('<div class="card wide">', '<div class="card wide" style="background:#ffeedd">'));
  });

  it('adds or removes only the attribute when just the lock changes', () => {
    assert.equal(patchTo(withLock(saved, [1, 1], true)), source.replace('<div class="card wide">', '<div class="card wide" data-locked>'));
    assert.equal(patchTo(withLock(saved, [1, 0], false)), source.replace('<div class="card" data-locked>', '<div class="card">'));
    assert.equal(patchTo(withLock(saved, [2], false)), source.replace('<svg class="mark" data-locked', '<svg class="mark"'));
    assert.equal(patchTo(withLock(saved, [1, 1, 1], false)), source.replace('<p data-locked>', '<p>'));
  });

  it('moves a locked drawing in place, keeping its lock and its markup', () => {
    const edited = structuredClone(saved);
    edited.children[2]!.style.left = '1500px';
    const out = patchTo(edited);
    assert.ok(out, 'patched');
    assert.match(out!, /<svg class="mark" data-locked [^>]*left:1500px/);
    assert.match(out!, /<circle cx="5" cy="5" r="4"\/?>(<\/circle>)?<\/svg>/);
    const back = read(out!);
    assert.equal(at(back, 2).locked, true);
    assert.equal(at(back, 2).style.left, '1500px');
    assert.equal(at(back, 1, 0).locked, true);
  });

  it('carries the lock onto an element written anew when its type changes', () => {
    const out = patch((s) => {
      const second = cards(s).children[1] as BoxNode;
      second.children[1] = setListKind(second.children[1] as TextNode, 'ul');
    });
    assert.ok(out, 'patched');
    assert.match(out!, /<ul data-locked/);
    assert.equal(at(read(out!), 1, 1, 1).locked, true);
  });

  it('keeps locks on kept and new elements when the children are rebuilt', () => {
    const out = patch((s) => {
      cards(s).children.reverse();
      s.children.splice(1, 0, { kind: 'text', tag: 'p', style: { 'font-size': '40px' }, runs: [{ text: 'Added' }], locked: true });
    });
    assert.ok(out, 'patched');
    assert.match(out!, /<p data-locked style="font-size:40px">Added<\/p>/);
    assert.match(out!, /<div class="card" data-locked>/);
    const back = read(out!);
    assert.equal(at(back, 1).locked, true);
    assert.equal(at(back, 2, 1).locked, true);
    assert.equal(at(back, 2, 0, 1).locked, true);
  });

  it('keeps every lock when the slide falls back to a flat file', () => {
    // An edit to the generated page number can't be written into the markup.
    const edited = structuredClone(saved);
    const generated = edited.children.findIndex((n) => n.origin === -1);
    assert.ok(generated >= 0);
    edited.children[generated]!.style.right = '10px';
    assert.equal(patchSourceSlide(source, saved, edited, deck, { id: 'plan', index: 1 }), undefined);
    const flat = flattenSlide(edited);
    assert.ok(isFlatSlideHtml(flat));
    assert.equal((flat.match(/data-locked/g) ?? []).length, 3);
    const back = compileSlide(flat, { id: 'plan', lints: false });
    assert.deepEqual(lockMessages(back), []);
    assert.equal(at(back.slide, 1, 0).locked, true);
    assert.equal(serializeSlide(back.slide), flat);
  });

  it('flattens a slide when a generated element is locked (it has no markup of its own to hold the lock)', () => {
    const generated = saved.children.findIndex((n) => n.origin === -1);
    const edited = withLock(saved, [generated], true);
    assert.equal(patchSourceSlide(source, saved, edited, deck, { id: 'plan', index: 1 }), undefined);
    const back = compileSlide(flattenSlide(edited), { id: 'plan', lints: false }).slide;
    assert.equal(at(back, generated).locked, true);
  });

  it('round-trips the lock on a data-flat page of the deck', () => {
    const flat = flattenSlide(saved);
    const page = compileSlide(flat, { id: 'plan', lints: false });
    assert.equal(page.slide.flat, true);
    assert.equal(at(page.slide, 1, 0).locked, true);
    assert.equal(serializeSlide(page.slide), flat);
    const unlocked = serializeSlide(withLock(page.slide, [1, 0], false));
    assert.equal((flat.match(/data-locked/g) ?? []).length - (unlocked.match(/data-locked/g) ?? []).length, 1);
    assert.equal(flat.replace(/ data-locked/, ''), unlocked);
  });
});
