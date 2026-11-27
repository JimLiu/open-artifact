import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { schema } from '../src/editor/schema.ts';
import { type ChipText, countCharacters, countDoc, countEditor, countLines, countWords } from '../src/topbar/word-count.ts';

const { nodes, marks } = schema;
const para = (...content: (string | PMNode)[]) => nodes.paragraph!.create(null, content.map(part => (typeof part === 'string' ? schema.text(part) : part)));
const doc = (...blocks: PMNode[]) => nodes.doc!.create(null, blocks);
const code = (language: string | null, text: string) => nodes.codeBlock!.create({ language }, text ? schema.text(text) : null);
const cell = (text: string) => nodes.cell!.create(null, para(text));
const table = (...rows: string[][]) => nodes.table!.create(null, rows.map(row => nodes.tableRow!.create(null, row.map(cell))));
const chips: ChipText = node => (node.type === nodes.mention ? `@${node.attrs.label}` : node.type === nodes.date ? 'Mar 4' : null);

describe('counting words', () => {
  it('parts words at spaces and dashes, and counts only pieces with a letter or digit', () => {
    assert.equal(countWords('The plan—in short—works'), 5);
    assert.equal(countWords('  three   spaced\twords \n'), 3);
    assert.equal(countWords('- * 42 ...'), 1);
    assert.equal(countWords("don't re-use e.g."), 3);
    assert.equal(countWords(''), 0);
  });

  it('splits Chinese and Japanese into words, and keeps Latin beside them a word of its own', () => {
    const chinese = countWords('我们明天开会');
    assert.ok(chinese >= 2 && chinese <= 6, `${chinese}`);
    assert.equal(countWords('Q3目标'), 1 + countWords('目标'));
    assert.ok(countWords('こんにちは世界') >= 2);
  });

  it('takes a zero-width space as a gap between words, and other zero-width marks as nothing', () => {
    assert.equal(countWords('one\u200Btwo'), 2);
    assert.equal(countWords('one\u2060two'), 1);
  });
});

describe('counting characters', () => {
  it('counts what a reader sees as one character, without line breaks or zero-width marks', () => {
    assert.equal(countCharacters('abc'), 3);
    assert.equal(countCharacters('ab\ncd'), 4);
    assert.equal(countCharacters('a\u200Bb'), 2);
    assert.equal(countCharacters('👍🏽'), 1);
    assert.equal(countCharacters('é'), 1);
    assert.equal(countCharacters('中文'), 2);
  });
});

describe('counting a tab', () => {
  it('counts each block as its own line, so words at the edges of two blocks stay two', () => {
    const count = countDoc(doc(para('first line'), para('second')), [], chips);
    assert.deepEqual(count, { tab: { words: 3, characters: 16 }, selected: null });
  });

  it('counts code but not a block drawn as a picture, nor a table of contents', () => {
    const count = countDoc(doc(para('one'), code('js', 'let x'), code('mermaid', 'graph TD; A-->B'), code('csv', 'a,b'), code('toc', '')), [], chips);
    assert.equal(count.tab.words, 3);
  });

  it('counts a chip by the words it shows, and a picture as nothing', () => {
    const mention = nodes.mention!.create({ label: 'Ada' });
    const image = nodes.media!.create({ src: 'x.png' });
    const count = countDoc(doc(para('ask ', mention, ' by ', nodes.date!.create({ ts: '2031-03-04' }), image, 'then')), [], chips);
    assert.equal(count.tab.words, 6);
  });

  it('leaves out proposed insertions but keeps proposed deletions, which are still in the text', () => {
    const inserted = schema.text('new words', [marks.suggestIns!.create({ suggestId: 's1' })]);
    const deleted = schema.text('old', [marks.suggestDel!.create({ suggestId: 's2' })]);
    const block = nodes.paragraph!.create({ suggestId: 's3', suggestOp: 'ins' }, schema.text('a whole proposed paragraph'));
    const count = countDoc(doc(para('keep ', inserted, ' ', deleted), block), [], chips);
    assert.equal(count.tab.words, 2);
  });

  it('counts a table cell by cell', () => {
    assert.equal(countDoc(doc(table(['alpha', 'beta'], ['gamma', 'delta'])), [], chips).tab.words, 4);
  });
});

describe('counting a selection', () => {
  const sample = doc(para('one two three'), para('four five'));

  it('counts what the selection covers, across blocks', () => {
    // "two three" in the first paragraph, "four" in the second.
    const count = countDoc(sample, [{ from: 5, to: 20 }], chips);
    assert.deepEqual(count.selected, { words: 3, characters: 13 });
    assert.deepEqual(count.tab, { words: 5, characters: 22 });
  });

  it('has no selection for a caret', () => {
    const state = EditorState.create({ doc: sample, selection: TextSelection.create(sample, 3) });
    assert.equal(countEditor(state, chips).selected, null);
  });

  it('counts half a word as a word', () => {
    assert.deepEqual(countDoc(sample, [{ from: 2, to: 3 }], chips).selected, { words: 1, characters: 1 });
  });

  it('counts a chip whole once the selection touches it', () => {
    const d = doc(para('hi ', nodes.mention!.create({ label: 'Ada Lovelace' })));
    assert.deepEqual(countDoc(d, [{ from: 4, to: 5 }], chips).selected, { words: 2, characters: 13 });
  });

  it('says 0 selected over a proposed insertion alone', () => {
    const d = doc(para('keep ', schema.text('new', [marks.suggestIns!.create({ suggestId: 's1' })])));
    assert.deepEqual(countDoc(d, [{ from: 6, to: 9 }], chips).selected, { words: 0, characters: 0 });
  });

  it('counts each cell of a cell selection on its own', () => {
    const d = doc(table(['alpha', 'beta'], ['gamma', 'delta']));
    let first = -1;
    let last = -1;
    d.descendants((node, pos) => {
      if (node.type === nodes.cell) {
        if (first < 0) first = pos;
        last = pos;
      }
    });
    const state = EditorState.create({ doc: d, selection: CellSelection.create(d, first, last) });
    assert.deepEqual(countEditor(state, chips).selected, { words: 4, characters: 19 });
  });
});

describe('the count in words', () => {
  it('says the tab’s words and characters, in the singular for one', () => {
    assert.deepEqual(countLines({ tab: { words: 1204, characters: 1 }, selected: null }), ['1,204 words in this tab', '1 character']);
    assert.deepEqual(countLines({ tab: { words: 1, characters: 7 }, selected: null }), ['1 word in this tab', '7 characters']);
  });

  it('says what is selected out of the whole', () => {
    assert.deepEqual(countLines({ tab: { words: 30, characters: 160 }, selected: { words: 2, characters: 9 } }), ['2 of 30 words selected', '9 of 160 characters']);
  });
});
