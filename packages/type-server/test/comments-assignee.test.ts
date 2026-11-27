/**
 * A person's message can assign its thread (`assignee`, `null` to unassign): kept with the message, shown to the page
 * and to the agent. Only people assign, and the agent is never assigned.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AGENT_AUTHOR, CommentStore, agentView } from '@open-artifact/server-sdk/comments';
import { pageThread } from '../src/db-host.ts';

const ana = { kind: 'user' as const, name: 'Ana' };

describe('a message that assigns its thread', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-assignee-'));
  after(() => rm(dir, { recursive: true, force: true }));

  it('keeps who it assigns, on a new thread and on a reply', () => {
    const store = new CommentStore(dir);
    const thread = store.create({ anchor: '{}', label: 'Intro', text: 'Fix this, @Bo', to: ['Bo'], assignee: 'Bo', author: ana });
    assert.equal(thread.messages[0]?.assignee, 'Bo');
    const { thread: later } = store.addMessage(thread.id, ana, 'This comment is no longer assigned.', { assignee: null });
    assert.equal(later.messages[1]?.assignee, null);
    const { thread: plain } = store.addMessage(thread.id, ana, 'Thanks');
    assert.equal('assignee' in plain.messages[2]!, false);

    const page = pageThread(new CommentStore(dir).threads({ all: true }).find(saved => saved.id === thread.id)!);
    assert.deepEqual(page.messages.map(message => message.assignee), ['Bo', null, undefined]);
    const seen = agentView(plain).messages as Array<Record<string, unknown>>;
    assert.deepEqual(seen.map(message => message.assignee), ['Bo', null, undefined]);
  });

  it('refuses one from the agent, one naming the agent, and one that is not a name', () => {
    const store = new CommentStore(dir);
    const thread = store.create({ anchor: '{}', label: 'Intro', text: 'Look', author: ana });
    assert.throws(() => store.addMessage(thread.id, { ...AGENT_AUTHOR }, 'Mine now', { assignee: 'Ana' }), { code: 'invalid_argument' });
    assert.throws(() => store.addMessage(thread.id, ana, 'Over to you', { assignee: 'agent' }), { code: 'invalid_argument' });
    assert.throws(() => store.addMessage(thread.id, ana, 'Over to you', { assignee: 3 }), { code: 'invalid_argument' });
    assert.throws(() => store.create({ anchor: '{}', label: 'Intro', text: 'Look', assignee: 'Bo' }), { code: 'invalid_argument' }, 'a thread the agent starts');
  });
});
