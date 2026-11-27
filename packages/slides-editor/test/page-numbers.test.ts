import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { parseDeckIndex, type DeckIndex, type SlideNode, type TextNode } from '@open-artifact/slides-core';
import { configureDeck, slideText, useDeck } from '../src/state/deck.ts';

/* A source deck whose sheet numbers its pages: `counter(page)` is each slide's place in the deck. */

const CSS = 'section{counter-increment:page} .folio::after{content:counter(page)}';
const slideHtml = (id: string, title = id): string => `<section id="${id}"><h1>${title}</h1><div class="folio"></div></section>`;
const indexText = (order: string[]): string =>
  JSON.stringify({ v: 5, lists: 'css', format: { v: 1, shared: ['project/deck.css'] }, title: 'Deck', order });
const indexOf = (order: string[]): DeckIndex => parseDeckIndex(indexText(order)).index;

/** Loads the deck as the editor does: the sheet and places first, then the files. */
function load(order: string[], ids: string[]): void {
  const files = Object.fromEntries(ids.map((id) => [id, { text: slideHtml(id), hash: `h-${id}` }]));
  const index = indexText(order);
  configureDeck(parseDeckIndex(index).index, CSS, ids);
  useDeck.getState().load({ title: 'Deck', readOnly: false, index: { text: index, hash: 'h-index' }, slides: files });
}

/** A new `deck.json` arriving, as the sync applies it. */
function remoteIndex(order: string[]): void {
  useDeck.getState().remoteIndex(indexText(order), `h-index-${order.join('')}`);
  const state = useDeck.getState();
  if (configureDeck(state.index, CSS, Object.keys(state.slides))) state.rereadSlides();
}

function generatedText(nodes: readonly SlideNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'text') return node.origin === -1 ? [(node as TextNode).runs.map((run) => run.text).join('')] : [];
    return 'children' in node ? generatedText(node.children as SlideNode[]) : [];
  });
}

/** The page number each slide shows, by id. */
function pageNumbers(): Record<string, string> {
  return Object.fromEntries(Object.entries(useDeck.getState().slides).map(([id, entry]) => [id, generatedText(entry.slide.children).join('|')]));
}

describe('page numbers of a source deck', () => {
  beforeEach(() => {
    configureDeck(indexOf([]), null);
    useDeck.setState(useDeck.getInitialState(), true);
  });

  it('numbers a deck loaded whole by its order', () => {
    load(['a', 'b', 'c'], ['a', 'b', 'c']);
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', c: '3' });
  });

  it('numbers slides that arrive after the outline that lists them', () => {
    // The agent writes deck.json with the whole order, then the slides one at a time, into the open page.
    load(['a', 'b', 'c', 'd'], []);
    for (const id of ['a', 'b', 'c', 'd']) {
      assert.equal(useDeck.getState().remoteSlide(id, slideHtml(id), `h-${id}`), 'applied');
    }
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', c: '3', d: '4' });
  });

  it('numbers slides that arrive out of order, renumbering the ones after them', () => {
    load(['a', 'b', 'c'], ['a']);
    useDeck.getState().remoteSlide('c', slideHtml('c'), 'h-c');
    // Only a and c exist: c is the second page for now.
    assert.deepEqual(pageNumbers(), { a: '1', c: '2' });
    useDeck.getState().remoteSlide('b', slideHtml('b'), 'h-b');
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', c: '3' });
  });

  it('numbers a slide that arrives before the outline lists it, and again once it does', () => {
    load(['a', 'b'], ['a', 'b']);
    useDeck.getState().remoteSlide('n', slideHtml('n'), 'h-n');
    // Not in the order yet: unlisted slides come last.
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', n: '3' });
    remoteIndex(['a', 'n', 'b']);
    assert.deepEqual(pageNumbers(), { a: '1', n: '2', b: '3' });
  });

  it('renumbers the slides after one that was deleted elsewhere', () => {
    load(['a', 'b', 'c'], ['a', 'b', 'c']);
    assert.equal(useDeck.getState().remoteSlide('a', null, null), 'applied');
    assert.deepEqual(pageNumbers(), { b: '1', c: '2' });
  });

  it('keeps a slide’s number when its file changes elsewhere', () => {
    load(['a', 'b', 'c'], ['a', 'b', 'c']);
    assert.equal(useDeck.getState().remoteSlide('c', slideHtml('c', 'Third'), 'h-c2'), 'applied');
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', c: '3' });
  });

  it('leaves a slide that shows no number the slide it was when its place moves', () => {
    load(['n', 'a', 'b'], ['a', 'b']);
    useDeck.getState().remoteSlide('a', '<section id="a"><h1>No number here</h1></section>', 'h-a2');
    const before = useDeck.getState().slides.a!;
    useDeck.getState().remoteSlide('n', slideHtml('n'), 'h-n');
    const after = useDeck.getState().slides.a!;
    assert.equal(after.slide, before.slide, 'a slide that reads the same was replaced');
    assert.equal(after.saved, before.saved);
    assert.deepEqual([before.place, after.place], [0, 1]);
    assert.deepEqual(pageNumbers(), { n: '1', a: '', b: '3' });
  });

  it('keeps the unsaved edits of a slide whose place moved, and still writes them into its own markup', () => {
    load(['n', 'a', 'b'], ['a', 'b']);
    const state = useDeck.getState();
    const slide = state.slides.b!.slide;
    const [title, ...rest] = slide.children as [TextNode, ...SlideNode[]];
    const edited = { ...slide, children: [{ ...title, runs: [{ text: 'Retitled' }] }, ...rest] };
    state.apply('Retitle', { slides: { b: edited } });
    useDeck.getState().remoteSlide('n', slideHtml('n'), 'h-n');
    const entry = useDeck.getState().slides.b!;
    assert.equal(entry.slide, edited, 'the edit was dropped');
    // Its number waits for the next read; the edit is still patched into the file as written, not flattened.
    assert.equal(slideText(entry.slide, entry), '<section id="b"><h1>Retitled</h1><div class="folio"></div></section>');
    assert.deepEqual(pageNumbers(), { n: '1', a: '2', b: '2' });
  });
});
