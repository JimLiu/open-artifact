import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DocState, applyOps } from '@open-artifact/docs-core';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { CellSelection, TableMap } from 'prosemirror-tables';
import { rangeOfIds } from '../src/comments/anchor-map.ts';
import { pmDocOf } from '../src/editor/binding.ts';
import { blockPlaceHref, findPlace, parseDocHref, placeFragment } from '../src/selbar/fragments.ts';
import { washDecorations } from '../src/selbar/place-wash.ts';
import { selectionPlace } from '../src/selbar/selection-place.ts';

const session = { sess: 's1', next: 1 };

function docOf(markdown: string): DocState {
  const doc: DocState = { rev: 0, blocks: [{ id: 's0.0', type: 'paragraph', inline: [] }] };
  return applyOps(doc, [{ op: 'replace', target: { kind: 'blocks', ids: ['s0.0'] }, with: { as: 'markdown', from: { kind: 'inline', content: markdown } } }], session).doc;
}

function find(doc: PMNode, words: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const at = node.text!.indexOf(words);
    if (at >= 0) found = { from: pos + at, to: pos + at + words.length };
    return false;
  });
  assert.ok(found, `no "${words}"`);
  return found;
}

const bidAt = (doc: PMNode, pos: number) => doc.resolve(pos).parent.attrs.bid as string;

describe('links to words', () => {
  it('reads a block link naming words by their first and last characters', () => {
    assert.deepEqual(parseDocHref('#ab.3~ab.5-ab.9'), { block: 'ab.3', words: ['ab.5', 'ab.9'] });
    assert.deepEqual(parseDocHref('#0123abcd-4567.ab.3~s1.5-s2.19'), { tab: '0123abcd-4567', block: 'ab.3', words: ['s1.5', 's2.19'] });
  });

  it('keeps reading a slug after a block id as a slug, hyphens and all', () => {
    assert.deepEqual(parseDocHref('#ab.3~getting-started'), { block: 'ab.3', slug: 'getting-started' });
    assert.deepEqual(parseDocHref('#ab.3~step-2-of-3'), { block: 'ab.3', slug: 'step-2-of-3' });
    assert.deepEqual(parseDocHref('#ab.3~ab.5-'), { block: 'ab.3', slug: 'ab.5-' });
  });

  it('writes the link and its fragment back the same way', () => {
    assert.equal(blockPlaceHref('ab.3'), '#ab.3');
    assert.equal(blockPlaceHref('ab.3', ['ab.5', 'ab.9']), '#ab.3~ab.5-ab.9');
    for (const href of ['#ab.3~ab.5-ab.9', '#ab.3~intro', '#ab.3', '#intro']) assert.equal(`#${placeFragment(parseDocHref(href)!)}`, href);
    assert.equal(placeFragment({ tab: '0123abcd-4567' }), '');
  });
});

describe('the place a selection names', () => {
  const shadow = docOf('Hello brave new world\n\nSecond line here');
  const doc = pmDocOf(shadow);

  it('names the selected words in the block they start in, and finds them again', () => {
    const words = find(doc, 'brave new');
    const place = selectionPlace(doc, TextSelection.create(doc, words.from, words.to), shadow)!;
    assert.equal(place.block, bidAt(doc, words.from));
    assert.ok(place.words);
    assert.deepEqual(rangeOfIds(doc, shadow, place.words), words);
    const parsed = parseDocHref(blockPlaceHref(place.block, place.words))!;
    assert.deepEqual(parsed, { block: place.block, words: place.words });
    assert.equal(findPlace(doc, parsed), doc.resolve(words.from).before());
  });

  it('names words across blocks by the block they start in', () => {
    const from = find(doc, 'world').from;
    const to = find(doc, 'Second').to;
    const place = selectionPlace(doc, TextSelection.create(doc, from, to), shadow)!;
    assert.equal(place.block, bidAt(doc, from));
    assert.deepEqual(rangeOfIds(doc, shadow, place.words!), { from, to });
  });

  it('names the paragraph alone for a caret, or while the model has not caught up', () => {
    const at = find(doc, 'line').from;
    assert.deepEqual(selectionPlace(doc, TextSelection.create(doc, at), shadow), { block: bidAt(doc, at) });
    const words = find(doc, 'brave');
    assert.deepEqual(selectionPlace(doc, TextSelection.create(doc, words.from, words.to), null), { block: bidAt(doc, words.from) });
  });

  it('names nothing in a block that has no id yet', () => {
    const { nodes } = doc.type.schema;
    const fresh = nodes.doc!.create(null, [nodes.paragraph!.create(null, doc.type.schema.text('Not saved yet'))]);
    assert.equal(selectionPlace(fresh, TextSelection.create(fresh, 2, 5), shadow), null);
  });

  it('names the first of the selected cells', () => {
    const tableShadow = docOf(['Before', '', '| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'].join('\n'));
    const tdoc = pmDocOf(tableShadow);
    let table: { pos: number; node: PMNode } | null = null;
    tdoc.descendants((node, pos) => {
      if (node.type.name === 'table') table ??= { pos, node };
      return !table;
    });
    const map = TableMap.get(table!.node);
    const cell = (row: number, col: number) => table!.pos + 1 + map.map[row * map.width + col]!;
    const selection = CellSelection.create(tdoc, cell(2, 1), cell(1, 0));
    const first = tdoc.nodeAt(cell(1, 0))!;
    assert.deepEqual(selectionPlace(tdoc, selection, tableShadow), { block: first.attrs.bid });
  });
});

describe('the wash over linked words', () => {
  it('washes the words and outlines their block', () => {
    const shadow = docOf('Hello brave new world');
    const doc = pmDocOf(shadow);
    const state = EditorState.create({ doc });
    const words = find(doc, 'brave');
    const found = washDecorations(state, words.from, words.to).find();
    assert.deepEqual(found.map(deco => [deco.from, deco.to, (deco as unknown as { type: { attrs: { class: string } } }).type.attrs.class]), [
      [doc.resolve(words.from).before(), doc.resolve(words.from).after(), 'doc-place-block'],
      [words.from, words.to, 'doc-place-wash'],
    ]);
  });
});
