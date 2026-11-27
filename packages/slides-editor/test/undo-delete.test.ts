import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { isFlatSlideHtml, parseDeckIndex, serializeSlide, type DeckIndex, type Slide, type SlideNode, type TextNode } from '@open-artifact/slides-core';
import { configureDeck, deckOrder, isDirty, saveBatch, useDeck, type SentBatch } from '../src/state/deck.ts';

/* Deleting a slide and taking the delete back, around the save that removes its file. */

const CSS = 'section{counter-increment:page} .folio::after{content:"Page " counter(page)}';
const slideHtml = (id: string, title = id): string => `<section id="${id}" class="cover"><h1>${title}</h1><div class="folio"></div></section>`;
const SOURCE = { format: { v: 1, shared: ['project/deck.css'] } };
const indexText = (order: string[], format: object = SOURCE): string => JSON.stringify({ v: 5, lists: 'css', ...format, title: 'Deck', order });
const indexOf = (order: string[]): DeckIndex => parseDeckIndex(indexText(order)).index;
const slidePath = (id: string): string => `project/slides/${id}.html`;
const DECK = 'project/deck.json';

/** The artifact's files, as the host keeps them. */
let disk: Map<string, string>;
let writes = 0;
const hashOf = (path: string): string => `h${++writes}-${path}`;
const hashes = new Map<string, string>();

function put(path: string, text: string): string {
  disk.set(path, text);
  const hash = hashOf(path);
  hashes.set(path, hash);
  return hash;
}

/** Loads a deck from files written first, as the editor does. */
function load(order: string[], files: Record<string, string>, format: object = SOURCE): void {
  const index = indexText(order, format);
  const indexHash = put(DECK, index);
  const slides = Object.fromEntries(Object.entries(files).map(([id, text]) => [id, { text, hash: put(slidePath(id), text) }]));
  configureDeck(parseDeckIndex(index).index, 'format' in format ? CSS : null, Object.keys(files));
  useDeck.getState().load({ title: 'Deck', readOnly: false, index: { text: index, hash: indexHash }, slides });
}

class Conflict extends Error {}

/**
 * The first half of a save, as the sync runs it: the batch is collected and the host writes it (every `ifMatch`
 * checked). Returns the second half, which hands the host's answer to the store; an undo may come between the two.
 */
function send(): () => void {
  const { batch, sent } = saveBatch(useDeck.getState());
  for (const [path, file] of Object.entries(batch)) {
    if (file && file.ifMatch !== undefined && (hashes.get(path) ?? null) !== file.ifMatch) throw new Conflict(`${path}: expected ${file.ifMatch}, is ${hashes.get(path) ?? null}`);
  }
  const published: Record<string, string | null> = {};
  for (const [path, file] of Object.entries(batch)) {
    if (file === null) {
      disk.delete(path);
      hashes.delete(path);
      published[path] = null;
    } else published[path] = put(path, file.content);
  }
  return () => acknowledge(sent, published);
}

function acknowledge(sent: SentBatch, published: Record<string, string | null>): void {
  // Unchanged slides keep their hash.
  for (const id of Object.keys(sent.slides)) if (!(slidePath(id) in published)) published[slidePath(id)] = useDeck.getState().slides[id]?.hash ?? null;
  useDeck.getState().acknowledge(sent, published);
}

/** Saves until nothing is left to save (the sync saves again while the deck is dirty). */
function save(): void {
  for (let round = 0; round < 4 && isDirty(useDeck.getState()); round++) send()();
  assert.equal(isDirty(useDeck.getState()), false, 'the deck is still dirty after saving');
}

const remove = (id: string): void => {
  const state = useDeck.getState();
  state.apply('Delete slide', { slides: { [id]: null }, index: { ...state.index, order: deckOrder(state).filter((other) => other !== id) } }, { focus: id });
};
const undo = (): void => assert.deepEqual(useDeck.getState().undoStep().done, true, 'the undo did not run');
const redo = (): void => assert.deepEqual(useDeck.getState().redoStep().done, true, 'the redo did not run');
const file = (id: string): string | undefined => disk.get(slidePath(id));
const order = (): string[] => JSON.parse(disk.get(DECK)!).order;
const shown = (): string[] => deckOrder(useDeck.getState());

/** The slide with its title retyped, as an edit on the stage leaves it. */
function retitled(id: string, text: string): Slide {
  const slide = useDeck.getState().slides[id]!.slide;
  const [title, ...rest] = slide.children as [TextNode, ...SlideNode[]];
  return { ...slide, children: [{ ...title, runs: [{ text }] }, ...rest] };
}

describe('undoing the delete of a slide', () => {
  beforeEach(() => {
    disk = new Map();
    hashes.clear();
    configureDeck(indexOf([]), null);
    useDeck.setState(useDeck.getInitialState(), true);
  });

  it('leaves the file alone when the delete was never saved', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    const before = hashes.get(slidePath('a'));
    remove('a');
    undo();
    assert.equal(isDirty(useDeck.getState()), false);
    assert.equal(hashes.get(slidePath('a')), before);
  });

  it('writes the file back as it was once the delete was saved', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    remove('a');
    save();
    assert.equal(file('a'), undefined);
    assert.deepEqual(order(), ['b']);

    undo();
    assert.deepEqual(shown(), ['a', 'b']);
    assert.equal(isDirty(useDeck.getState()), true, 'nothing says the file is to be written');
    save();
    // Its own markup, classes and all: not flattened, and the page number is not written into it.
    assert.equal(file('a'), slideHtml('a'));
    assert.deepEqual(order(), ['a', 'b']);
    assert.equal(file('b'), slideHtml('b'));
  });

  it('writes the file back when the undo comes while the delete is on its way', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    remove('a');
    const answer = send();
    assert.equal(file('a'), undefined, 'the host deleted the file');
    // The host has not answered yet.
    undo();
    assert.deepEqual(shown(), ['a', 'b']);
    answer();
    assert.deepEqual(shown(), ['a', 'b'], 'the slide left the editor again');
    save();
    assert.equal(file('a'), slideHtml('a'), 'the slide is in the editor and not on disk');
    assert.deepEqual(order(), ['a', 'b']);
  });

  it('writes an edited slide back when the undo comes while its delete is on its way', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    useDeck.getState().apply('Edit text', { slides: { a: retitled('a', 'Retitled') } });
    remove('a');
    const answer = send();
    undo();
    answer();
    // Written as a file that is not there, not over the one this tab deleted (which would be refused).
    save();
    assert.equal(file('a'), slideHtml('a', 'Retitled'));
    assert.equal(useDeck.getState().slides.a?.conflict, undefined);
  });

  it('keeps a slide whose delete was undone on its way when the host then says the file is gone', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    remove('a');
    const answer = send();
    undo();
    answer();
    // A re-read of the path (another save lost a race, say) finds no file: that is this tab's own delete.
    assert.equal(useDeck.getState().remoteSlide('a', null, null), 'same');
    assert.deepEqual(shown(), ['a', 'b']);
    assert.equal(useDeck.getState().slides.a?.conflict, undefined);
    save();
    assert.equal(file('a'), slideHtml('a'));
  });

  it('keeps what an undo needs when the host reports the delete this tab made', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    remove('a');
    const answer = send();
    // The path is re-read before the answer, and again after it.
    assert.equal(useDeck.getState().remoteSlide('a', null, null), 'applied');
    answer();
    assert.equal(useDeck.getState().remoteSlide('a', null, null), 'same');
    save();
    undo();
    save();
    assert.equal(file('a'), slideHtml('a'));
  });

  it('writes an edit that was deleted with the slide into the slide’s own markup', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    useDeck.getState().apply('Edit text', { slides: { a: retitled('a', 'Retitled') } });
    remove('a');
    save();
    assert.equal(file('a'), undefined);
    undo();
    save();
    assert.equal(file('a'), slideHtml('a', 'Retitled'));
    // The edit is still a step: undone, the file is the one that was read.
    undo();
    save();
    assert.equal(file('a'), slideHtml('a'));
  });

  it('deletes the file again on redo, and brings it back again on undo', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    remove('a');
    save();
    undo();
    save();
    assert.equal(file('a'), slideHtml('a'));
    redo();
    save();
    assert.equal(file('a'), undefined);
    assert.deepEqual(order(), ['b']);
    undo();
    save();
    assert.equal(file('a'), slideHtml('a'));
    assert.deepEqual(order(), ['a', 'b']);
  });

  it('deletes the file when the delete is redone while the first delete is on its way', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    remove('a');
    const answer = send();
    undo();
    redo();
    answer();
    save();
    assert.equal(file('a'), undefined);
    assert.deepEqual(shown(), ['b']);
    undo();
    save();
    assert.equal(file('a'), slideHtml('a'));
  });

  it('forgets a deleted slide once no step of the history can bring it back', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    const state = useDeck.getState();
    state.apply('Add slide', { slides: { n: { ...state.slides.a!.slide, id: 'n' } }, index: { ...state.index, order: ['a', 'b', 'n'] } });
    save();
    const added = file('n');
    assert.ok(added, 'the new slide was not written');
    // Undone, the slide is deleted; the redo step can still bring it back, as its file was.
    undo();
    save();
    assert.equal(file('n'), undefined);
    assert.deepEqual(Object.keys(useDeck.getState().trash), ['n']);
    redo();
    save();
    assert.equal(file('n'), added);
    undo();
    save();
    assert.deepEqual(Object.keys(useDeck.getState().trash), ['n']);
    // A new edit ends the redo: nothing can bring the slide back, and nothing of it is kept.
    useDeck.getState().apply('Edit text', { slides: { b: retitled('b', 'Retitled') } });
    assert.deepEqual(Object.keys(useDeck.getState().trash), []);
    save();
    assert.equal(file('n'), undefined);
    // A deleted slide an undo step holds is kept through later edits.
    remove('a');
    save();
    useDeck.getState().apply('Edit text', { slides: { b: retitled('b', 'Again') } });
    save();
    assert.deepEqual(Object.keys(useDeck.getState().trash), ['a']);
    undo();
    undo();
    save();
    assert.equal(file('a'), slideHtml('a'));
  });

  it('numbers the slide that comes back by the place it comes back to', () => {
    load(['a', 'b', 'c'], { a: slideHtml('a'), b: slideHtml('b'), c: slideHtml('c') });
    const pages = (): string => shown().map((id) => `${id}:${/Page (\d+)/.exec(JSON.stringify(useDeck.getState().slides[id]!.slide))?.[1]}`).join(' ');
    assert.equal(pages(), 'a:1 b:2 c:3');
    remove('b');
    save();
    assert.equal(pages(), 'a:1 c:2');
    undo();
    assert.equal(pages(), 'a:1 b:2 c:3');
    save();
    for (const id of ['a', 'b', 'c']) assert.equal(file(id), slideHtml(id), `${id}.html`);
  });

  it('takes a version someone else wrote while the file was gone', () => {
    load(['a', 'b'], { a: slideHtml('a'), b: slideHtml('b') });
    remove('a');
    save();
    undo();
    // Before this tab's save, the file is written elsewhere.
    const theirs = slideHtml('a', 'Theirs');
    const hash = put(slidePath('a'), theirs);
    assert.throws(() => send(), Conflict, 'the write did not ask that the file be absent');
    useDeck.getState().remoteSlide('a', theirs, hash);
    save();
    assert.equal(file('a'), theirs);
  });

  it('writes a slide of a deck with no shared sheet back as its file was', () => {
    const text = (id: string): string => `<section id="${id}"><h1 style="position:absolute;left:96px;top:96px;width:800px;height:120px">${id}</h1></section>`;
    load(['a', 'b'], { a: text('a'), b: text('b') }, {});
    const read = useDeck.getState().slides.a!;
    assert.equal(read.held, undefined, 'the fixture does not compile');
    remove('a');
    save();
    undo();
    save();
    assert.equal(file('a'), text('a'));
    assert.equal(isFlatSlideHtml(file('a')!), false);
    // The file as written is what the model serializes to, or it is the text that was read: either way it compiles to the same slide.
    assert.equal(serializeSlide(useDeck.getState().slides.a!.slide), serializeSlide(read.slide));
  });
});
