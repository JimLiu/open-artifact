import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Block, type DocState, applyOps, isAtom, walk } from '@open-artifact/docs-core';
import { describeParts, describeSuggestion, quote, sentenceText, suggestionParts } from '../src/suggest/summary.ts';

const session = { sess: 's1', next: 1 };
const info = { by: 'agent', at: '2026-11-18T00:00:00Z', via: 'agent' };

function docOf(markdown: string): DocState {
  const doc: DocState = { rev: 0, blocks: [{ id: 's0.0', type: 'paragraph', inline: [] }] };
  return applyOps(doc, [{ op: 'replace', target: { kind: 'blocks', ids: ['s0.0'] }, with: { as: 'markdown', from: { kind: 'inline', content: markdown } } }], session).doc;
}

const suggest = (doc: DocState, ops: unknown[], id = 'sg1') => applyOps(doc, ops, session, { suggest: { id, info } }).doc;
const text = (doc: DocState, id = 'sg1') => sentenceText(describeSuggestion(doc, id));

const textBlocks = (doc: DocState): Block[] => [...walk(doc.blocks)].map(place => place.block).filter(block => block.inline);

/** The char ids of `words` inside the first text block holding them. */
function rangeOf(doc: DocState, words: string): [string, string] {
  for (const block of textBlocks(doc)) {
    const inline = block.inline!;
    const spelled = inline.map(item => (isAtom(item) ? '\uFFFC' : item.ch)).join('');
    const at = spelled.indexOf(words);
    if (at < 0) continue;
    const points = [...spelled.slice(0, at)].length;
    const length = [...words].length;
    return [inline[points]!.id, inline[points + length - 1]!.id];
  }
  throw new Error(`no ${words}`);
}

const blockWith = (doc: DocState, words: string) => textBlocks(doc).find(block => block.inline!.map(item => (isAtom(item) ? '' : item.ch)).join('').includes(words))!;

describe('quote', () => {
  it('keeps short words as they are', () => assert.equal(quote('Hello there'), 'Hello there'));
  it('collapses whitespace and strips control chars', () => assert.equal(quote('  a \t b\u0007 c  '), 'a b c'));
  it('shows a paragraph break as ¶ and a line break as ↵', () => assert.equal(quote('one\ntwo\u2028three'), 'one ¶ two ↵ three'));
  it('shows an atom as a space', () => assert.equal(quote('see\uFFFCnow'), 'see now'));
  it('is empty when only breaks are left', () => assert.equal(quote('\n\u2028\n'), ''));
  it('cuts at 80 code points', () => {
    const shown = quote('x'.repeat(100));
    assert.equal([...shown].length, 80);
    assert.ok(shown.endsWith('…'));
    assert.equal(quote('x'.repeat(80)), 'x'.repeat(80));
  });
  it('counts code points, not UTF-16 units', () => assert.equal([...quote('😀'.repeat(90))].length, 80));
});

describe('words', () => {
  const base = docOf('The quick brown fox jumps.');

  it('names added words', () => {
    const [from] = rangeOf(base, 'quick');
    const doc = suggest(base, [{ op: 'insert', target: { kind: 'chars', range: [from, from] }, side: 'before', with: { as: 'markdown', from: { kind: 'inline', content: 'very ' } } }]);
    assert.equal(text(doc), 'Add “very”');
  });

  it('names struck words', () => {
    const doc = suggest(base, [{ op: 'delete', target: { kind: 'chars', range: rangeOf(base, 'quick ') } }]);
    assert.equal(text(doc), 'Delete “quick”');
  });

  it('names replaced words', () => {
    const doc = suggest(base, [{ op: 'replace', target: { kind: 'chars', range: rangeOf(base, 'quick') }, with: { as: 'markdown', from: { kind: 'inline', content: 'slow' } } }]);
    assert.equal(text(doc), 'Replace “quick” with “slow”');
    assert.deepEqual(describeSuggestion(doc, 'sg1'), [{ text: 'Replace' }, { text: 'quick', quote: true }, { text: 'with' }, { text: 'slow', quote: true }]);
  });

  it('names a change of look as a format', () => {
    const doc = suggest(base, [{ op: 'replace', target: { kind: 'chars', range: rangeOf(base, 'brown') }, with: { as: 'markdown', from: { kind: 'inline', content: '**brown**' } } }]);
    assert.equal(text(doc), 'Format: Bold “brown”');
  });

  it('knows nothing of a suggestion that is not there', () => assert.equal(text(base, 'nope'), '(unrecognised change)'));
});

describe('format from parts', () => {
  const run = (op: 'ins' | 'del', marks?: Record<string, unknown>) => ({ op, block: 'b', text: 'word', chars: 4, atoms: [], ...(marks ? { marks } : {}) });
  const said = (old?: Record<string, unknown>, next?: Record<string, unknown>) => sentenceText(describeParts({ blocks: [], runs: [run('del', old), run('ins', next)] }));

  it('removes a mark', () => assert.equal(said({ italic: true }), 'Remove format: Italic “word”'));
  it('adds and removes marks at once', () => assert.equal(said({ italic: true }, { bold: true }), 'Format: +Bold, −Italic “word”'));
  it('names a text color', () => assert.equal(said(undefined, { textColor: 'red' }), 'Format: Text color (red) “word”'));
  it('adds a link by its host', () => assert.equal(said(undefined, { link: 'https://example.com/a' }), 'Add link (example.com) “word”'));
  it('removes a link', () => assert.equal(said({ link: 'https://example.com' }), 'Remove link “word”'));
  it('changes a link', () => assert.equal(said({ link: 'https://a.example' }, { link: 'https://b.example' }), 'Change link: a.example → b.example “word”'));
  it('replaces when the words differ', () => {
    const sentence = describeParts({ blocks: [], runs: [run('del'), { ...run('ins'), text: 'other' }] });
    assert.equal(sentenceText(sentence), 'Replace “word” with “other”');
  });
  it('names atoms', () => {
    const atoms = describeParts({ blocks: [], runs: [{ op: 'ins', block: 'b', text: '\uFFFC', chars: 0, atoms: ['mention'] }] });
    assert.equal(sentenceText(atoms), 'Add a mention');
    const images = describeParts({ blocks: [], runs: [{ op: 'del', block: 'b', text: '\uFFFC\uFFFC', chars: 0, atoms: ['media', 'media'] }] });
    assert.equal(sentenceText(images), 'Delete 2 images');
  });
  it('falls back to "Add text" when only breaks are added', () => {
    const breaks = describeParts({ blocks: [], runs: [{ op: 'ins', block: 'b', text: '\u2028', chars: 0, atoms: [] }] });
    assert.equal(sentenceText(breaks), 'Add line break');
  });
});

describe('blocks', () => {
  const base = docOf('# Plan\n\nFirst paragraph.\n\nSecond paragraph.');
  const ids = (doc: DocState, ...words: string[]) => words.map(word => blockWith(doc, word).id);

  it('names an added paragraph with its words', () => {
    const doc = suggest(base, [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: 'A new one.' } } }]);
    assert.equal(text(doc), 'Add paragraph “A new one.”');
  });

  it('counts added paragraphs', () => {
    const doc = suggest(base, [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: 'One.\n\nTwo.' } } }]);
    assert.equal(text(doc), 'Add 2 paragraphs');
  });

  it('counts blocks of different kinds', () => {
    const doc = suggest(base, [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: '## Next\n\nOne.\n\nTwo.' } } }]);
    assert.equal(text(doc), 'Add 3 blocks');
  });

  it('names a struck heading', () => {
    const doc = suggest(base, [{ op: 'delete', target: { kind: 'blocks', ids: ids(base, 'Plan') } }]);
    assert.equal(text(doc), 'Delete heading “Plan”');
  });

  it('counts struck paragraphs', () => {
    const doc = suggest(base, [{ op: 'delete', target: { kind: 'blocks', ids: ids(base, 'First', 'Second') } }]);
    assert.equal(text(doc), 'Delete 2 paragraphs');
  });

  it('names a paragraph made a heading as a format', () => {
    const doc = suggest(base, [{ op: 'replace', target: { kind: 'blocks', ids: ids(base, 'First') }, with: { as: 'markdown', from: { kind: 'inline', content: '## First paragraph.' } } }]);
    assert.equal(text(doc), 'Format: Heading 2 “First paragraph.”');
  });

  it('names a replaced paragraph by its words', () => {
    const doc = suggest(base, [{ op: 'replace', target: { kind: 'blocks', ids: ids(base, 'First') }, with: { as: 'markdown', from: { kind: 'inline', content: 'Another paragraph.' } } }]);
    assert.equal(text(doc), 'Replace “First paragraph.” with “Another paragraph.”');
  });

  it('names a paragraph replaced by a list', () => {
    const doc = suggest(base, [{ op: 'replace', target: { kind: 'blocks', ids: ids(base, 'Second') }, with: { as: 'markdown', from: { kind: 'inline', content: '- a\n- b' } } }]);
    assert.equal(text(doc), 'Replace paragraph with list');
  });

  it('reads parts in document order and topmost first', () => {
    const doc = suggest(base, [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: '- a\n- b' } } }]);
    const parts = suggestionParts(doc, 'sg1');
    assert.equal(parts.blocks.length, 1);
    assert.equal(parts.blocks[0]!.name, 'list');
    assert.equal(parts.runs.length, 0);
    assert.equal(text(doc), 'Add list “a ¶ b”');
  });

  it('names paragraph breaks from parts', () => {
    const part = { op: 'ins' as const, name: 'paragraph' as const, text: 'moved', isBreak: true };
    assert.equal(sentenceText(describeParts({ blocks: [part], runs: [] })), 'Add paragraph break');
    assert.equal(sentenceText(describeParts({ blocks: [part, part], runs: [] })), 'Add 2 paragraph breaks');
  });
});

describe('tables of contents', () => {
  const base = docOf('# Plan\n\nFirst paragraph.\n\n## Steps');

  it('names an added table of contents', () => {
    const doc = suggest(base, [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: '```toc\n```' } } }]);
    assert.equal(text(doc), 'Add table of contents');
  });

  it('names a struck table of contents', () => {
    const withContents = docOf('Intro\n\n```toc\n```\n\n## Steps');
    const contents = withContents.blocks.find(block => block.type === 'codeBlock')!;
    const doc = suggest(withContents, [{ op: 'delete', target: { kind: 'blocks', ids: [contents.id] } }]);
    assert.equal(text(doc), 'Delete table of contents');
  });
});
