import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { parseDeckIndex, reorderNode, removeNodes, isFlatSlideHtml, type DeckIndex, type Slide, type SlideNode } from '@open-artifact/slides-core';
import { configureDeck, isDirty, saveBatch, useDeck } from '../src/state/deck.ts';

/* Edits to a source slide after a save that moved its elements in the file. */

const CSS = '.box { position: absolute; width: 300px; height: 200px; background: #2670a0; color: #fff; }';
const SOURCE = { format: { v: 1, shared: ['project/deck.css'] } };
const indexText = (order: string[]): string => JSON.stringify({ v: 5, lists: 'css', ...SOURCE, title: 'Deck', order });
const indexOf = (order: string[]): DeckIndex => parseDeckIndex(indexText(order)).index;
const slidePath = (id: string): string => `project/slides/${id}.html`;
const DECK = 'project/deck.json';
const BOXES =
  '<section id="free"><div class="box" style="left:200px;top:300px">One</div><div class="box" style="left:700px;top:500px;background:#a02670">Two</div>' +
  '<div class="box" style="left:1200px;top:300px;background:#26a070">Three</div></section>';

let disk: Map<string, string>;
let writes = 0;
function put(path: string, text: string): string {
  disk.set(path, text);
  return `h${++writes}`;
}

function load(): void {
  const index = indexText(['free']);
  const indexHash = put(DECK, index);
  configureDeck(parseDeckIndex(index).index, CSS, ['free']);
  useDeck.getState().load({ title: 'Deck', readOnly: false, index: { text: index, hash: indexHash }, slides: { free: { text: BOXES, hash: put(slidePath('free'), BOXES) } } });
}

function save(): void {
  for (let round = 0; round < 4 && isDirty(useDeck.getState()); round++) {
    const { batch, sent } = saveBatch(useDeck.getState());
    const published: Record<string, string | null> = {};
    for (const [path, file] of Object.entries(batch)) published[path] = file === null ? null : put(path, file.content);
    for (const id of Object.keys(sent.slides)) if (!(slidePath(id) in published)) published[slidePath(id)] = useDeck.getState().slides[id]?.hash ?? null;
    useDeck.getState().acknowledge(sent, published);
  }
  assert.equal(isDirty(useDeck.getState()), false, 'the deck is still dirty after saving');
}

const slide = (): Slide => useDeck.getState().slides.free!.slide;
const edit = (label: string, next: Slide): void => useDeck.getState().apply(label, { slides: { free: next } });
const file = (): string => disk.get(slidePath('free'))!;
/** The boxes of the file in order: their words and their own style. */
const boxes = (): string[] => [...file().matchAll(/<div class="box"(?: style="([^"]*)")?>([^<]*)<\/div>/g)].map((m) => `${m[2]}|${m[1] ?? ''}`);
const recolored = (s: Slide, index: number, background: string): Slide => ({
  ...s,
  children: s.children.map((node, i) => (i === index ? ({ ...node, style: { ...node.style, background } } as SlideNode) : node)),
});

describe('editing a source slide after a save that moved its elements', () => {
  beforeEach(() => {
    disk = new Map();
    configureDeck(indexOf([]), null);
    useDeck.setState(useDeck.getInitialState(), true);
  });

  it('restacks back and forth with each element keeping its own tag', () => {
    load();
    edit('Send backward', reorderNode(slide(), [1], 'backward').slide);
    save();
    assert.deepEqual(boxes(), ['Two|left:700px;top:500px;background:#a02670', 'One|left:200px;top:300px', 'Three|left:1200px;top:300px;background:#26a070']);
    edit('Bring forward', reorderNode(slide(), [0], 'forward').slide);
    save();
    assert.equal(isFlatSlideHtml(file()), false);
    assert.deepEqual(boxes(), ['One|left:200px;top:300px', 'Two|left:700px;top:500px;background:#a02670', 'Three|left:1200px;top:300px;background:#26a070']);
  });

  it('writes a change to the element it was made on after an element before it was deleted', () => {
    load();
    edit('Delete', removeNodes(slide(), [[0]]));
    save();
    assert.deepEqual(boxes(), ['Two|left:700px;top:500px;background:#a02670', 'Three|left:1200px;top:300px;background:#26a070']);
    edit('Fill', recolored(slide(), 1, '#000000'));
    save();
    assert.deepEqual(boxes(), ['Two|left:700px;top:500px;background:#a02670', 'Three|left:1200px;top:300px;background:#000000']);
  });

  it('writes an undo after the save back into the tags as they were', () => {
    load();
    edit('Send backward', reorderNode(slide(), [1], 'backward').slide);
    save();
    assert.equal(useDeck.getState().undoStep().done, true);
    save();
    assert.equal(file().replace(/\s*\n\s*/g, ''), BOXES);
  });

  it('keeps each element on its own tag over several saves', () => {
    load();
    edit('Send to back', reorderNode(slide(), [2], 'back').slide);
    save();
    edit('Delete', removeNodes(slide(), [[1]]));
    save();
    assert.deepEqual(boxes(), ['Three|left:1200px;top:300px;background:#26a070', 'Two|left:700px;top:500px;background:#a02670']);
    edit('Fill', recolored(slide(), 1, '#000000'));
    save();
    edit('Bring to front', reorderNode(slide(), [0], 'front').slide);
    save();
    assert.deepEqual(boxes(), ['Two|left:700px;top:500px;background:#000000', 'Three|left:1200px;top:300px;background:#26a070']);
  });
});
