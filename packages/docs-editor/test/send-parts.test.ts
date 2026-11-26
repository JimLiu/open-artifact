/**
 * What a doc comment sent to the agent shows (`wake.request.parts`): the person's words and what the comment is on
 * (the line of an Ask Agent chip, the words, a paragraph or table cells), with its tab when the doc has several.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Node as PMNode } from 'prosemirror-model';
import { agentChip, lineText } from '../src/ask/ask.ts';
import type { DocAnchor } from '../src/comments/anchor.ts';
import { docsSelectionSnapshot, sendParts, tabWhere } from '../src/comments/send-parts.ts';
import { schema } from '../src/editor/schema.ts';

const { nodes } = schema;
const para = (...content: (string | PMNode)[]) => nodes.paragraph!.create(null, content.map(part => (typeof part === 'string' ? schema.text(part) : part)));
const words: DocAnchor = { kind: 'words', tab: 't1', range: ['a', 'b'], places: [] };

describe('lineText', () => {
  it('is the line without its mention chips', () => {
    assert.equal(lineText(para('The ferry leaves at nine. ', agentChip('Agent'))), 'The ferry leaves at nine.');
    assert.equal(lineText(para(agentChip('Agent'))), '');
  });
});

describe('docsSelectionSnapshot', () => {
  it('an Ask Agent chip: the line it went into', () => {
    assert.deepEqual(docsSelectionSnapshot({ anchor: words, label: '@Agent', quote: 'The ferry leaves at nine.', chip: true, block: 'b1' }, tabWhere('Notes')), {
      kind: 'line',
      label: 'The ferry leaves at nine.',
      count: 1,
      items: [{ id: 'b1', kind: 'block' }],
      where: 'Tab "Notes"',
      text: 'The ferry leaves at nine.',
    });
  });

  it('an Ask Agent chip on an empty line, or in an empty doc: nothing', () => {
    assert.equal(docsSelectionSnapshot({ anchor: words, label: '@Agent', quote: '', chip: true, block: 'b1' }), undefined);
  });

  it('selected words: their label and the words, cut to the limit', () => {
    const long = 'word '.repeat(500);
    const snapshot = docsSelectionSnapshot({ anchor: words, label: 'word word…', quote: long, block: 'b2' });
    assert.equal(snapshot?.kind, 'text');
    assert.equal(snapshot?.label, 'word word…');
    assert.equal(snapshot?.text?.length, 1800);
    assert.deepEqual(snapshot?.items, [{ id: 'b2', kind: 'block' }]);
    assert.equal(snapshot?.where, undefined);
  });

  it('an empty paragraph, one cell and several cells', () => {
    assert.deepEqual(docsSelectionSnapshot({ anchor: { kind: 'block', tab: 't1', block: 'b3' }, label: 'Empty paragraph' }), {
      kind: 'block',
      label: 'Empty paragraph',
      count: 1,
      items: [{ id: 'b3', kind: 'block' }],
    });
    assert.deepEqual(docsSelectionSnapshot({ anchor: { kind: 'cell', tab: 't1', cell: 'c1' }, label: '“9:00”', quote: '9:00' }), {
      kind: 'cell',
      label: '“9:00”',
      count: 1,
      items: [{ id: 'c1', kind: 'cell' }],
      text: '9:00',
    });
    const cells = docsSelectionSnapshot({ anchor: { kind: 'cells', tab: 't1', cells: ['c1', 'c2', 'c3'] }, label: '3 cells', quote: '9:00 | 10:00 | 11:00' });
    assert.equal(cells?.kind, 'cells');
    assert.equal(cells?.count, 3);
    assert.equal(cells?.items?.length, 3);
  });

  it('a comment on the whole doc: nothing', () => {
    assert.equal(docsSelectionSnapshot({ anchor: { kind: 'doc', tab: 't1' }, label: 'The doc' }), undefined);
  });
});

describe('sendParts', () => {
  it('keeps the typed words, line breaks too, and leaves out what is empty', () => {
    assert.deepEqual(sendParts('  Say when\nit leaves  '), { userText: 'Say when\nit leaves' });
    assert.deepEqual(sendParts('   '), {});
  });

  it('names a tab only by its name', () => {
    assert.equal(tabWhere('  Q3   plan '), 'Tab "Q3 plan"');
    assert.equal(tabWhere(''), undefined);
  });
});
