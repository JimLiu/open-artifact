import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommentMessage, CommentThread } from '@open-artifact/runtime';
import { EMPTY_FILTER, filterSaid, inFilter, involvesMe } from '../src/comments/threads.ts';

let next = 0;
const said = (name: string, text: string, extra: Partial<CommentMessage> = {}): CommentMessage => ({
  id: `m${++next}`,
  author: { kind: name === 'agent' ? 'agent' : 'person', name },
  text,
  at: '2026-01-02T10:00:00.000Z',
  ...extra,
});
const thread = (messages: CommentMessage[], status: CommentThread['status'] = 'open'): CommentThread => ({
  id: `t${++next}`,
  anchor: '{}',
  label: '',
  location: {},
  status,
  messages,
});

describe('threads involving the viewer', () => {
  it('takes in an open thread the viewer started or replied in', () => {
    assert.ok(involvesMe(thread([said('Ana', 'Mine')]), 'Ana'));
    assert.ok(involvesMe(thread([said('Bo', 'Look'), said('Ana', 'Done')]), 'Ana'));
  });

  it('takes in a thread whose words @mention the viewer, or that asks them', () => {
    assert.ok(involvesMe(thread([said('Bo', 'What do you think, @Ana Lee?')]), 'Ana Lee'));
    assert.ok(involvesMe(thread([said('Bo', 'ping @ana lee')]), 'Ana Lee'));
    assert.ok(involvesMe(thread([said('Bo', 'Look', { to: ['Ana'] })]), 'Ana'));
  });

  it('leaves out threads of others, a name inside a word, and the agent writing under the same name', () => {
    assert.ok(!involvesMe(thread([said('Bo', 'Looks fine'), said('agent', 'Agreed')]), 'Ana'));
    assert.ok(!involvesMe(thread([said('Bo', 'mail me@Ana.dev')]), 'Ana'));
    assert.ok(!involvesMe(thread([said('agent', 'Ana asked for this')]), 'agent'));
  });

  it('leaves out resolved threads, lone reactions, and everything while the viewer is not known', () => {
    assert.ok(!involvesMe(thread([said('Ana', 'Mine')], 'resolved'), 'Ana'));
    assert.ok(!involvesMe(thread([said('Ana', '👍')]), 'Ana'));
    assert.ok(!involvesMe(thread([said('Ana', 'Mine')]), null));
  });
});

describe('the list filters', () => {
  const open = thread([said('Bo', 'Open one')]);
  const mine = thread([said('Ana', 'My own')]);
  const done = thread([said('Ana', 'Closed')], 'resolved');
  const all = [open, mine, done];
  const shown = (filter: Parameters<typeof inFilter>[1], me: string | null) => all.filter(each => inFilter(each, filter, me)).map(each => each.id);

  it('shows the open, those involving the viewer, the resolved, or all', () => {
    assert.deepEqual(shown('open', 'Ana'), [open.id, mine.id]);
    assert.deepEqual(shown('mine', 'Ana'), [mine.id]);
    assert.deepEqual(shown('resolved', 'Ana'), [done.id]);
    assert.deepEqual(shown('all', 'Ana'), [open.id, mine.id, done.id]);
    assert.deepEqual(shown('mine', null), []);
  });

  it('says what is missing when a filter leaves nothing', () => {
    assert.deepEqual(EMPTY_FILTER, { open: 'No open comments', mine: 'No comments involving you', resolved: 'No resolved comments', all: 'No comments' });
  });

  it('says how many a picked filter holds', () => {
    assert.equal(filterSaid('mine', 3), '3 comments involving you');
    assert.equal(filterSaid('mine', 1), '1 comment involving you');
    assert.equal(filterSaid('open', 1), '1 open comment');
    assert.equal(filterSaid('resolved', 2), '2 resolved comments');
    assert.equal(filterSaid('all', 5), '5 comments');
    assert.equal(filterSaid('mine', 0), 'No comments involving you');
  });
});
