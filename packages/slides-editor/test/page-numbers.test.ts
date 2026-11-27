import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { parseDeckIndex, type DeckIndex, type Slide, type SlideNode, type TextNode } from '@open-artifact/slides-core';
import { configureDeck, slideText, useDeck, type SentBatch } from '../src/state/deck.ts';

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

/** The slide with its title retyped, as an edit on the stage leaves it. */
function retitled(id: string, text: string): Slide {
  const slide = useDeck.getState().slides[id]!.slide;
  const [title, ...rest] = slide.children as [TextNode, ...SlideNode[]];
  return { ...slide, children: [{ ...title, runs: [{ text }] }, ...rest] };
}

/** Saves what is unsaved, as the sync does: the texts are written, then acknowledged. Returns the texts written. */
function save(): Record<string, string> {
  const state = useDeck.getState();
  const sent: SentBatch = { index: null, slides: {}, deleted: [] };
  const hashes: Record<string, string> = {};
  const written: Record<string, string> = {};
  for (const [id, entry] of Object.entries(state.slides)) {
    if (entry.slide === entry.saved || entry.held || entry.conflict) continue;
    const text = slideText(entry.slide, entry);
    sent.slides[id] = { slide: entry.slide, text };
    if (text !== entry.savedText) {
      hashes[`project/slides/${id}.html`] = `h-${id}-${text.length}`;
      written[id] = text;
    }
  }
  state.acknowledge(sent, hashes);
  return written;
}

const reorder = (order: string[]): void => {
  const state = useDeck.getState();
  state.apply('Move slide', { index: { ...state.index, order } });
};
const unsaved = (): string[] => Object.entries(useDeck.getState().slides).filter(([, entry]) => entry.slide !== entry.saved).map(([id]) => id);

const resetDeck = (): void => {
  configureDeck(indexOf([]), null);
  useDeck.setState(useDeck.getInitialState(), true);
};

describe('page numbers of a source deck', () => {
  beforeEach(resetDeck);

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

  it('renumbers a slide with unsaved edits, keeps the edits, and still writes them into its own markup', () => {
    load(['n', 'a', 'b'], ['a', 'b']);
    const state = useDeck.getState();
    const slide = state.slides.b!.slide;
    const [title, ...rest] = slide.children as [TextNode, ...SlideNode[]];
    const edited = { ...slide, children: [{ ...title, runs: [{ text: 'Retitled' }] }, ...rest] };
    state.apply('Retitle', { slides: { b: edited } });
    useDeck.getState().remoteSlide('n', slideHtml('n'), 'h-n');
    const entry = useDeck.getState().slides.b!;
    assert.equal(((entry.slide.children[0] as TextNode).runs[0]!).text, 'Retitled', 'the edit was dropped');
    assert.notEqual(entry.slide, entry.saved, 'the edit is still to be saved');
    // Only the number is taken from the file; the edit is still patched into the file as written, not flattened.
    assert.deepEqual(pageNumbers(), { n: '1', a: '2', b: '3' });
    assert.equal(slideText(entry.slide, entry), '<section id="b"><h1>Retitled</h1><div class="folio"></div></section>');
  });
});

describe('page numbers after a change made in this tab', () => {
  beforeEach(resetDeck);

  it('follow a reorder, and its undo and redo', () => {
    load(['a', 'b', 'c'], ['a', 'b', 'c']);
    reorder(['c', 'a', 'b']);
    assert.deepEqual(pageNumbers(), { a: '2', b: '3', c: '1' });
    assert.deepEqual(unsaved(), [], 'a new page number is nothing to save');
    assert.deepEqual(useDeck.getState().undoStep(), { done: true, focus: undefined });
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', c: '3' });
    assert.deepEqual(useDeck.getState().redoStep(), { done: true, focus: undefined });
    assert.deepEqual(pageNumbers(), { a: '2', b: '3', c: '1' });
  });

  it('follow a slide deleted here, and its undo', () => {
    load(['a', 'b', 'c'], ['a', 'b', 'c']);
    useDeck.getState().apply('Delete slide', { slides: { a: null } });
    assert.deepEqual(pageNumbers(), { b: '1', c: '2' });
    assert.equal(useDeck.getState().undoStep().done, true);
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', c: '3' });
    assert.deepEqual(unsaved(), []);
  });

  it('follow a slide added here', () => {
    load(['a', 'b'], ['a', 'b']);
    const state = useDeck.getState();
    const added: Slide = { id: 'n', hidden: false, style: {}, children: [], notes: '', flat: true };
    state.apply('Add slide', { slides: { n: added }, index: { ...state.index, order: ['a', 'n', 'b'] } });
    assert.deepEqual(pageNumbers(), { a: '1', b: '3', n: '' });
    assert.deepEqual(unsaved(), ['n']);
  });

  it('undo an edit made before a reorder without a warning, once the reorder is undone', () => {
    load(['a', 'b', 'c'], ['a', 'b', 'c']);
    useDeck.getState().apply('Retitle', { slides: { c: retitled('c', 'Third') } });
    assert.deepEqual(Object.keys(save()), ['c']);
    reorder(['c', 'a', 'b']);
    assert.deepEqual(pageNumbers(), { a: '2', b: '3', c: '1' });
    assert.equal(useDeck.getState().undoStep().done, true);
    // The edit's own undo: no "someone else changed this slide".
    assert.deepEqual(useDeck.getState().undoStep(), { done: true, focus: 'c' });
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', c: '3' });
    assert.deepEqual(save(), { c: slideHtml('c') }, 'the undone edit is written into the slide’s own markup');
    assert.deepEqual(useDeck.getState().redoStep(), { done: true, focus: 'c' });
    assert.deepEqual(useDeck.getState().redoStep(), { done: true, focus: undefined });
    assert.deepEqual(pageNumbers(), { a: '2', b: '3', c: '1' });
    assert.deepEqual(save(), { c: slideHtml('c', 'Third') });
  });

  it('renumber a slide with unsaved edits, keep the edits, and take them back to the saved slide', () => {
    load(['a', 'b', 'c'], ['a', 'b', 'c']);
    useDeck.getState().apply('Retitle', { slides: { c: retitled('c', 'Third') } });
    reorder(['c', 'a', 'b']);
    assert.deepEqual(pageNumbers(), { a: '2', b: '3', c: '1' });
    assert.deepEqual(unsaved(), ['c']);
    assert.equal(slideText(useDeck.getState().slides.c!.slide, useDeck.getState().slides.c!), slideHtml('c', 'Third'));
    assert.equal(useDeck.getState().undoStep().done, true);
    assert.deepEqual(useDeck.getState().undoStep(), { done: true, focus: 'c' });
    assert.deepEqual(pageNumbers(), { a: '1', b: '2', c: '3' });
    assert.deepEqual(unsaved(), [], 'the slide is the saved one again');
  });

  it('save a slide whose place moved while its save was on the way into its own markup', () => {
    load(['a', 'b', 'c'], ['a', 'b', 'c']);
    useDeck.getState().apply('Retitle', { slides: { c: retitled('c', 'Third') } });
    const entry = useDeck.getState().slides.c!;
    const sent: SentBatch = { index: null, slides: { c: { slide: entry.slide, text: slideText(entry.slide, entry) } }, deleted: [] };
    reorder(['c', 'a', 'b']);
    useDeck.getState().acknowledge(sent, { 'project/slides/c.html': 'h-c2' });
    assert.deepEqual(pageNumbers(), { a: '2', b: '3', c: '1' });
    // What is left to save is the file as it is: nothing flat.
    assert.deepEqual(save(), {});
    assert.deepEqual(unsaved(), []);
    useDeck.getState().apply('Retitle', { slides: { c: retitled('c', 'Third again') } });
    assert.deepEqual(save(), { c: slideHtml('c', 'Third again') });
  });

  it('undo an edit after a slide arrived before it: no warning, the number of its place now', () => {
    load(['n', 'a', 'b'], ['a', 'b']);
    useDeck.getState().apply('Retitle', { slides: { b: retitled('b', 'Second') } });
    save();
    useDeck.getState().remoteSlide('n', slideHtml('n'), 'h-n');
    assert.deepEqual(pageNumbers(), { n: '1', a: '2', b: '3' });
    assert.deepEqual(useDeck.getState().undoStep(), { done: true, focus: 'b' });
    assert.deepEqual(pageNumbers(), { n: '1', a: '2', b: '3' });
    assert.deepEqual(save(), { b: slideHtml('b') });
  });
});
