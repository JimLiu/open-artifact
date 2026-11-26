import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommentMessage, CommentThread } from '@open-artifact/runtime';
import {
  freshReads,
  lookedAtTab,
  mergeReads,
  newestUnread,
  parseReads,
  type Reads,
  readThread,
  tabHasNews,
  trimReads,
  unreadIsReply,
  unreadSince,
} from '../src/comments/unread.ts';

const T0 = Date.parse('2026-03-01T10:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const ms = (minutes: number) => T0 + minutes * 60_000;

let next = 0;
const said = (name: string, minutes: number, text = 'Words'): CommentMessage => ({
  id: `m${++next}`,
  author: { kind: name === 'Agent' ? 'agent' : 'person', name },
  text,
  at: at(minutes),
});
const thread = (id: string, messages: CommentMessage[], status: CommentThread['status'] = 'open'): CommentThread => ({ id, anchor: '{}', label: '', location: {}, status, messages });
const reads = (since: number, marks: Record<string, number> = {}, looked: Record<string, number> = {}): Reads => ({ since, marks, looked });

describe('unread threads', () => {
  it('starts a doc opened here for the first time with nothing unread', () => {
    const threads = [thread('a', [said('Bo', 5)]), thread('b', [said('Bo', 1), said('Agent', 30)])];
    const fresh = freshReads(threads, ms(10));
    assert.equal(fresh.since, ms(30), 'a message newer than this clock still counts as seen');
    assert.equal(newestUnread(threads, fresh, 'Ana'), 0);
    assert.equal(freshReads([], ms(10)).since, ms(10));
  });

  it('counts a thread whose latest message someone else wrote after the viewer last read it', () => {
    const r = reads(ms(0), { b: ms(20) });
    assert.equal(unreadSince(thread('a', [said('Bo', 5)]), r, 'Ana'), ms(5));
    assert.equal(unreadSince(thread('a', [said('Ana', 1), said('Agent', 6)]), r, 'Ana'), ms(6), 'the agent counts');
    assert.equal(unreadSince(thread('b', [said('Bo', 15)]), r, 'Ana'), 0, 'read after it came');
    assert.equal(unreadSince(thread('b', [said('Bo', 15), said('Cy', 25)]), r, 'Ana'), ms(25), 'a reply since the read');
  });

  it('leaves out the viewer\'s own last word, resolved threads, lone reactions and old news', () => {
    const r = reads(ms(10));
    assert.equal(unreadSince(thread('a', [said('Bo', 12), said('Ana', 13)]), r, 'Ana'), 0);
    assert.equal(unreadSince(thread('a', [said('Bo', 12)], 'resolved'), r, 'Ana'), 0);
    assert.equal(unreadSince(thread('a', [said('Bo', 12, '👍')]), r, 'Ana'), 0);
    assert.equal(unreadSince(thread('a', [said('Bo', 9)]), r, 'Ana'), 0);
    assert.equal(unreadSince(thread('a', []), r, 'Ana'), 0);
  });

  it('tells a new thread from a new reply', () => {
    assert.equal(unreadIsReply(thread('a', [said('Bo', 1)])), false);
    assert.equal(unreadIsReply(thread('a', [said('Bo', 1), said('Cy', 2)])), true);
  });

  it('reading a thread, or looking at a tab, only ever moves forward', () => {
    const r = reads(ms(0), { a: ms(5) });
    assert.equal(readThread(r, 'a', ms(3)), r);
    assert.equal(readThread(r, 'a', ms(8)).marks.a, ms(8));
    assert.equal(readThread(r, 'b', ms(1)).marks.b, ms(1));
    const looked = lookedAtTab(r, 't1', ms(4));
    assert.equal(looked.looked.t1, ms(4));
    assert.equal(lookedAtTab(looked, 't1', ms(2)), looked);
  });

  it('calls for a look at a tab until its list was open after the news', () => {
    const r = reads(ms(0), {}, { t1: ms(10) });
    assert.equal(tabHasNews(ms(12), r, 't1'), true);
    assert.equal(tabHasNews(ms(8), r, 't1'), false);
    assert.equal(tabHasNews(ms(1), r, 't2'), true);
    assert.equal(tabHasNews(0, r, 't2'), false);
  });

  it('merges another window\'s record by the later of each time', () => {
    const merged = mergeReads(reads(ms(1), { a: ms(5), b: ms(2) }, { t: ms(3) }), reads(ms(2), { a: ms(4), c: ms(6) }, { t: ms(7) }));
    assert.deepEqual(merged, reads(ms(2), { a: ms(5), b: ms(2), c: ms(6) }, { t: ms(7) }));
  });

  it('reads back a kept record, and nothing from one that is not readable', () => {
    const kept = reads(ms(1), { a: ms(5) }, { '': ms(3) });
    assert.deepEqual(parseReads(JSON.stringify(kept)), kept);
    assert.deepEqual(parseReads(JSON.stringify({ since: 5, marks: { a: 'x', b: 7 }, looked: [] })), reads(5, { b: 7 }, {}));
    for (const text of [null, '', 'nope', 'null', '{}', '{"since":"5"}']) assert.equal(parseReads(text), null, String(text));
  });

  it('drops marks that say nothing more than the start', () => {
    assert.deepEqual(trimReads(reads(ms(5), { a: ms(4), b: ms(6) })).marks, { b: ms(6) });
  });
});
