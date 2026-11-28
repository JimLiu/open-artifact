import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DocState, applyOps } from '@open-artifact/docs-core';
import type { CommentThread } from '@open-artifact/runtime';
import { idsOfRange, rangeOfBlock, rangeOfIds, textUnits, unitRange, unitsCovering } from '../src/comments/anchor-map.ts';
import { parseAnchor, quoteLabel, serializeAnchor, withPlace, withoutPlace } from '../src/comments/anchor.ts';
import { stackCards } from '../src/margin/stack.ts';
import { insertMention, matchCandidates, mentionQuery, mentionsIn, splitMentions, type MentionCandidate } from '../src/comments/mentions.ts';
import { canDeleteThread, commentInLink, commentLink, isEmoji, isReactionThread, reactionCount } from '../src/comments/threads.ts';
import { pmDocOf } from '../src/editor/binding.ts';

const session = { sess: 's1', next: 1 };

function docOf(markdown: string): DocState {
  const doc: DocState = { rev: 0, blocks: [{ id: 's0.0', type: 'paragraph', inline: [] }] };
  return applyOps(doc, [{ op: 'replace', target: { kind: 'blocks', ids: ['s0.0'] }, with: { as: 'markdown', from: { kind: 'inline', content: markdown } } }], session).doc;
}

/** The position of `words` in the editor's doc. */
function find(doc: ReturnType<typeof pmDocOf>, words: string): { from: number; to: number } {
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

describe('comment anchors in the doc model', () => {
  it('keeps a range of words as the ids of its first and last character, and finds it again', () => {
    const shadow = docOf('Hello brave new world\n\nSecond line here');
    const doc = pmDocOf(shadow);
    const words = find(doc, 'brave new');
    const ids = idsOfRange(doc, shadow, words.from, words.to);
    assert.ok(ids);
    assert.deepEqual(rangeOfIds(doc, shadow, ids), words);
    assert.equal(doc.textBetween(words.from, words.to), 'brave new');
  });

  it('spans text blocks', () => {
    const shadow = docOf('Hello brave new world\n\nSecond line here');
    const doc = pmDocOf(shadow);
    const from = find(doc, 'world').from;
    const to = find(doc, 'Second').to;
    const ids = idsOfRange(doc, shadow, from, to)!;
    assert.deepEqual(rangeOfIds(doc, shadow, ids), { from, to });
    assert.equal(doc.textBetween(from, to, '\n'), 'world\nSecond');
  });

  it('counts a character outside the basic plane as one', () => {
    const shadow = docOf('Go 🎉 team');
    const doc = pmDocOf(shadow);
    const words = find(doc, '🎉 team');
    const ids = idsOfRange(doc, shadow, words.from, words.to)!;
    const block = shadow.blocks[0]!;
    assert.equal(ids[0], block.inline![3]!.id);
    assert.equal(ids[1], block.inline!.at(-1)!.id);
    assert.deepEqual(rangeOfIds(doc, shadow, ids), words);
  });

  it('loses the range once an end of it is deleted', () => {
    const shadow = docOf('Hello brave new world');
    const doc = pmDocOf(shadow);
    const words = find(doc, 'brave');
    const ids = idsOfRange(doc, shadow, words.from, words.to)!;
    const after = applyOps(shadow, [{ op: 'delete', target: { kind: 'chars', range: [ids[1], ids[1]] } }], session).doc;
    assert.equal(rangeOfIds(pmDocOf(after), after, ids), null);
  });

  it('finds a table cell by its block id', () => {
    const shadow = docOf('| a | b |\n|---|---|\n| 1 | 2 |');
    const doc = pmDocOf(shadow);
    let cell: string | null = null;
    doc.descendants(node => {
      if (!cell && node.type.name === 'cell' && node.textContent === '2') cell = node.attrs.bid as string;
      return !cell;
    });
    assert.ok(cell);
    const range = rangeOfBlock(doc, cell)!;
    assert.equal(range.node.type.name, 'cell');
    assert.equal(doc.textBetween(range.from, range.to), '2');
  });

  it('finds copied words again in the units of what was pasted', () => {
    const shadow = docOf('One two three\n\nfour five');
    const doc = pmDocOf(shadow);
    const from = find(doc, 'two').from;
    const to = find(doc, 'four').to;
    const units = textUnits(doc, from, to);
    assert.equal(units.text, 'two three\nfour');
    const hit = unitsCovering(units, find(doc, 'three').from, find(doc, 'three').to)!;
    assert.deepEqual(unitRange(units, hit[0], hit[1]), find(doc, 'three'));
  });
});

describe('the stored anchor', () => {
  it('reads what it writes, and anything else as the whole doc', () => {
    const words = { kind: 'words', tab: 't1', range: ['a.1', 'a.4'], places: [{ id: 'p1', range: ['b.1', 'b.2'] }] } as const;
    assert.deepEqual(parseAnchor(serializeAnchor({ ...words, range: [...words.range], places: [{ id: 'p1', range: ['b.1', 'b.2'] }] })), words);
    assert.deepEqual(parseAnchor(serializeAnchor({ kind: 'cell', tab: 't1', cell: 'c.1' })), { kind: 'cell', tab: 't1', cell: 'c.1' });
    assert.deepEqual(parseAnchor('not json'), { kind: 'doc', tab: null });
    assert.deepEqual(parseAnchor('{"tab":"t1","range":[1,2]}'), { kind: 'doc', tab: 't1' });
  });

  it('adds a place once and removes it, the next place taking the first range', () => {
    const base = parseAnchor('{"tab":"t","range":["a","b"]}');
    const twice = withPlace(withPlace(base, ['c', 'd']), ['c', 'd']);
    assert.equal(twice.kind === 'words' && twice.places.length, 1);
    assert.deepEqual(withoutPlace(twice, null), { kind: 'words', tab: 't', range: ['c', 'd'], places: [] });
    const placeId = twice.kind === 'words' ? twice.places[0]!.id : '';
    assert.deepEqual(withoutPlace(twice, placeId), base);
  });

  it('labels with one short line', () => {
    assert.equal(quoteLabel('  a\n b  '), 'a b');
    assert.equal(quoteLabel('x'.repeat(200)).length, 80);
  });
});

describe('the margin', () => {
  it('pushes overlapping cards down', () => {
    const tops = stackCards(
      [
        { id: 'a', top: 0, height: 100 },
        { id: 'b', top: 50, height: 40 },
        { id: 'c', top: 400, height: 40 },
      ],
      null,
    );
    assert.deepEqual(Object.fromEntries(tops), { a: 0, b: 108, c: 400 });
  });

  it('keeps the open card level with its words, pushing the ones before it up', () => {
    const tops = stackCards(
      [
        { id: 'a', top: 0, height: 100 },
        { id: 'b', top: 50, height: 40 },
        { id: 'c', top: 60, height: 40 },
      ],
      'b',
    );
    assert.deepEqual(Object.fromEntries(tops), { b: 50, c: 98, a: -58 });
  });
});

describe('mentions', () => {
  const people: MentionCandidate[] = [
    { key: 'Ann Lee', name: 'Ann Lee', kind: 'person' },
    { key: 'agent', name: 'Agent', kind: 'agent' },
  ];

  it('finds the name being typed', () => {
    assert.deepEqual(mentionQuery('hi @an', 6), { start: 3, query: 'an' });
    assert.equal(mentionQuery('mail@an', 7), null);
    assert.deepEqual(matchCandidates(people, 'le').map(item => item.key), ['Ann Lee']);
    assert.deepEqual(matchCandidates(people, '').map(item => item.key), ['agent', 'Ann Lee']);
  });

  it('puts the whole name in', () => {
    assert.deepEqual(insertMention('hi @an there', 3, 6, 'Ann Lee'), { text: 'hi @Ann Lee there', caret: 12 });
  });

  it('tells who a message names', () => {
    assert.deepEqual(mentionsIn('@agent can you fix this? cc @Ann Lee.', people), ['Ann Lee', 'agent']);
    assert.deepEqual(mentionsIn('email ann@agent.com', people), []);
    assert.deepEqual(splitMentions('ask @Agent now', ['Agent']), [
      { text: 'ask ', mention: false },
      { text: '@Agent', mention: true },
      { text: ' now', mention: false },
    ]);
  });

  it('reads @names in Chinese text: after a Han letter or punctuation, and before full-width punctuation or more words', () => {
    const named: MentionCandidate[] = [
      { key: '宝', name: '宝', kind: 'person' },
      { key: '宝玉', name: '宝玉', kind: 'person' },
      { key: 'Ann', name: 'Ann', kind: 'person' },
      { key: 'agent', name: 'Agent', kind: 'agent' },
    ];
    assert.deepEqual(mentionsIn('@宝玉，请看一下', named), ['宝玉']);
    assert.deepEqual(mentionsIn('请@宝玉看一下。', named), ['宝玉']);
    assert.deepEqual(mentionsIn('（@宝）好的', named), ['宝']);
    assert.deepEqual(mentionsIn('@Agent，帮我改一下', named), ['agent']);
    assert.deepEqual(mentionsIn('谢谢@Ann。', named), ['Ann']);
    // A name of a script with spaces still ends at its last letter, and an address names no one.
    assert.deepEqual(mentionsIn('@Anna 和 ann@Ann.com', named), []);
    assert.deepEqual(mentionQuery('请@宝', 3), { start: 1, query: '宝' });
    assert.equal(mentionQuery('ann@an', 6), null);
    assert.deepEqual(splitMentions('请@宝玉看，@Ann。', ['宝', '宝玉', 'Ann']), [
      { text: '请', mention: false },
      { text: '@宝玉', mention: true },
      { text: '看，', mention: false },
      { text: '@Ann', mention: true },
      { text: '。', mention: false },
    ]);
  });
});

describe('threads', () => {
  const thread = (texts: string[], names = texts.map(() => 'Me')): CommentThread => ({
    id: 'th',
    anchor: '{}',
    label: '',
    location: {},
    status: 'open',
    messages: texts.map((text, index) => ({ id: `m${index}`, text, at: '2026-11-18T00:00:00Z', author: { kind: 'person', name: names[index]! } })),
  });

  it('tells a reaction from a comment', () => {
    assert.equal(isEmoji('👍'), true);
    assert.equal(isEmoji('👍🏽'), true);
    assert.equal(isEmoji('👍 nice'), false);
    assert.equal(isReactionThread(thread(['🎉'])), true);
    assert.equal(isReactionThread(thread(['🎉', 'why'])), false);
    const joined = thread(['🎉']);
    joined.messages[0]!.reactions = [{ emoji: '🎉', authors: [{ kind: 'person', name: 'Bo' }] }];
    assert.equal(reactionCount(joined), 2);
  });

  it('lets a thread’s author delete it while it is all theirs', () => {
    assert.equal(canDeleteThread(thread(['a', 'b']), 'Me', true, false), true);
    assert.equal(canDeleteThread(thread(['a', 'b'], ['Me', 'Bo']), 'Me', true, false), false);
    assert.equal(canDeleteThread(thread(['a', 'b'], ['Me', 'Bo']), 'Me', true, true), true);
  });

  it('links to a thread', () => {
    const link = commentLink('https://example.com/doc?tab=t1#x', 'th1', 't2');
    assert.equal(link, 'https://example.com/doc?tab=t2&comment=th1');
    assert.equal(commentInLink(link), 'th1');
  });
});
