/**
 * Tests of `@` in comment boxes: what counts as a name being typed, who the list offers for it, what a pick puts in the
 * text, whom a message names when it is sent, and the controller passing that on to the host.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { CommentsCapability, CommentThread, Peer } from '@open-artifact/runtime';
import { createComments, type CommentsAdapter } from '../src/index.ts';
import {
  AGENT_KEY,
  applyMention,
  leadsWithAgent,
  MENTION_PEOPLE_LIMIT,
  MENTION_ROWS,
  mentionLimitText,
  mentionName,
  mentionOptions,
  mentionPieces,
  mentionsName,
  mentionTargets,
  optionPosition,
  sentMentionNames,
  stillClosed,
  typedMention,
  type MentionPerson,
} from '../src/collab/mentions.ts';

const person = (name: string, id?: string): MentionPerson => ({ key: name, name, ...(id ? { id } : {}) });
const options = (query: string, people: MentionPerson[], more: Partial<Parameters<typeof mentionOptions>[0]> = {}) =>
  mentionOptions({ query, agentName: 'Codex', agentListed: true, people, self: { name: 'Me' }, ...more }).map((row) => row.label);

describe('typedMention', () => {
  it('finds an @ at the start, after a space or an opening bracket', () => {
    assert.deepEqual(typedMention('@', 1), { start: 0, end: 1, query: '' });
    assert.deepEqual(typedMention('hi @Bo', 6), { start: 3, end: 6, query: 'Bo' });
    assert.deepEqual(typedMention('see (@Ana', 9), { start: 5, end: 9, query: 'Ana' });
    assert.equal(typedMention('mail@host', 9), null);
    assert.equal(typedMention('hi @Bo', 4)?.query, '');
  });

  it('takes up to three words of a name, and letters of any script', () => {
    assert.equal(typedMention('@Mary Ann Lee', 13)?.query, 'Mary Ann Lee');
    assert.equal(typedMention('@Mary Ann Lee Smith', 19), null);
    assert.equal(typedMention('@小宝', 3)?.query, '小宝');
    assert.equal(typedMention("@O'Neil-Ross", 12)?.query, "O'Neil-Ross");
    assert.equal(typedMention('@Mary ', 6)?.query, 'Mary ');
    assert.equal(typedMention('@Bo\nx', 5), null);
    assert.equal(typedMention(`@${'a'.repeat(41)}`, 42), null);
  });
});

describe('mentionOptions', () => {
  it('puts the agent first when its name starts with the query', () => {
    assert.deepEqual(options('', [person('Ana')]), ['Codex', 'Ana']);
    assert.deepEqual(options('co', [person('Cole')]), ['Codex', 'Cole']);
    assert.deepEqual(options('an', [person('Ana')]), ['Ana']);
    assert.deepEqual(options('', [person('Ana')], { agentListed: false }), ['Ana']);
  });

  it('matches any word of a name, leaves out the viewer, look-alikes of the agent and repeats', () => {
    const people = [person('Ana Silva'), person('Me', 'u1'), person('Codex Bot'), person('ana silva'), person('Bob'), person('Other', 'me-id')];
    assert.deepEqual(options('sil', people), ['Ana Silva']);
    assert.deepEqual(options('', people, { self: { id: 'me-id', name: 'Me' } }), ['Codex', 'Ana Silva', 'Bob']);
  });

  it('shows at most eight rows', () => {
    const people = Array.from({ length: 20 }, (_, i) => person(`P${i}`));
    assert.equal(options('', people).length, MENTION_ROWS);
  });
});

describe('applyMention and mentionTargets', () => {
  it('replaces the typed name with @Name and a space, and puts the caret after it', () => {
    const typed = typedMention('ask @an please', 7)!;
    assert.deepEqual(applyMention('ask @an please', typed, { kind: 'person', key: 'Ana', label: 'Ana' }), { text: 'ask @Ana  please', caret: 9, name: 'Ana' });
    assert.equal(mentionName('<b>@x</b>'), 'bx/b');
    assert.equal(mentionName('@<>'), 'someone');
  });

  it('names the agent when the text mentions it, and picked people while their @Name stays', () => {
    const picks = [
      { key: 'Ana', name: 'Ana' },
      { key: 'Bob', name: 'Bob' },
    ];
    const agent = { name: 'Codex', listed: true };
    assert.deepEqual(mentionTargets('@Codex look, @Ana', picks, agent), [AGENT_KEY, 'Ana']);
    assert.deepEqual(mentionTargets('@Codex look', picks, { ...agent, listed: false }), []);
    assert.deepEqual(mentionTargets('@Bobby and @Ana', picks, agent), ['Ana']);
    assert.deepEqual(mentionTargets('typed @Cat by hand', picks, agent), []);
  });

  it('a longer picked name takes its words: a Bob picked, then deleted, is not named by @Bob Smith', () => {
    const picks = [{ key: 'Bob', name: 'Bob' }, { key: 'Bob Smith', name: 'Bob Smith' }];
    const agent = { name: 'Codex', listed: true };
    assert.deepEqual(mentionTargets('ask @Bob Smith', picks, agent), ['Bob Smith']);
    assert.deepEqual(mentionTargets('ask @Bob Smith and @Bob', picks, agent), ['Bob', 'Bob Smith']);
  });

  it('matches whole names, and CJK names that run into the next word', () => {
    assert.equal(mentionsName('hi @codex!', 'Codex'), true);
    assert.equal(mentionsName('hi @Codexes', 'Codex'), false);
    assert.equal(mentionsName('mail@Codex', 'Codex'), false);
    assert.equal(mentionsName('@小宝帮我看看', '小宝'), true);
  });
});

describe('the list closing and the screen reader', () => {
  it('stays closed while the same @ grows from where it was closed', () => {
    const closed = { start: 3, query: 'An' };
    assert.equal(stillClosed(closed, { start: 3, end: 7, query: 'Ana' }), true);
    assert.equal(stillClosed(closed, { start: 3, end: 5, query: 'A' }), false);
    assert.equal(stillClosed(closed, { start: 9, end: 12, query: 'Ana' }), false);
    assert.equal(stillClosed(closed, null), false);
  });

  it('says the highlighted row and where it is', () => {
    assert.equal(optionPosition('Ana', 1, 4), 'Ana, 2 of 4');
  });
});

describe('mentions in sent messages', () => {
  it('cuts the text into plain runs and @names, the longest name first', () => {
    assert.deepEqual(mentionPieces('hey @Ana Lee and @Ana', ['Ana', 'Ana Lee']), [
      { text: 'hey ', mention: false },
      { text: '@Ana Lee', mention: true },
      { text: ' and ', mention: false },
      { text: '@Ana', mention: true },
    ]);
    assert.deepEqual(mentionPieces('no names', ['Ana']), [{ text: 'no names', mention: false }]);
  });

  it('draws the agent only for a message that went to it', () => {
    assert.deepEqual(sentMentionNames([AGENT_KEY, 'Ana'], 'Codex'), ['Codex', 'Ana']);
    assert.deepEqual(sentMentionNames(['Ana'], 'Codex'), ['Ana']);
    assert.deepEqual(sentMentionNames(undefined, 'Codex'), []);
  });

  it('leads with the agent tag only for a person’s message sent to the agent that does not name it', () => {
    const person = { kind: 'person' };
    assert.equal(leadsWithAgent({ text: 'tighten this', to: [AGENT_KEY], author: person }, 'Codex'), true);
    assert.equal(leadsWithAgent({ text: '@codex tighten this', to: [AGENT_KEY], author: person }, 'Codex'), false);
    assert.equal(leadsWithAgent({ text: 'tighten this', to: ['Ana'], author: person }, 'Codex'), false);
    assert.equal(leadsWithAgent({ text: 'tighten this', author: person }, 'Codex'), false);
    assert.equal(leadsWithAgent({ text: 'done', to: [AGENT_KEY], author: { kind: 'agent' } }, 'Codex'), false);
  });
});

const thread = (id: string, messages: CommentThread['messages'] = []): CommentThread =>
  ({ id, anchor: 'a', label: 'a', location: {}, status: 'open', messages }) as unknown as CommentThread;

function fakeCapability(initial: CommentThread[] = []) {
  const calls: unknown[][] = [];
  const capability = {
    list: async () => initial,
    create: async (input: unknown) => (calls.push(['create', input]), thread('new')),
    reply: async (...args: unknown[]) => (calls.push(['reply', ...args]), thread(String(args[0]))),
    edit: async (...args: unknown[]) => (calls.push(['edit', ...args]), thread(String(args[0]))),
    setResolved: async (id: string) => thread(id),
    sendToAgent: async (id: string) => (calls.push(['send', id]), thread(id)),
    onChange: () => () => {},
  } as unknown as CommentsCapability;
  return { capability, calls };
}

const adapter = (overrides: Partial<CommentsAdapter<string>> = {}): CommentsAdapter<string> => ({
  parse: (text) => text,
  serialize: (anchor) => anchor,
  label: (anchor) => anchor,
  canComment: () => true,
  canSendToAgent: () => true,
  viewerName: () => 'Me',
  ...overrides,
});

describe('the controller and whom a message names', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('passes `to` with a new thread, a reply and an edit, and leaves it out when no one is named', async () => {
    const comments = createComments(adapter());
    const fake = fakeCapability();
    await comments.start(fake.capability);
    await comments.create('a', 'hi @Ana', { to: ['Ana', 'Ana'] });
    await comments.reply('t1', 'plain');
    await comments.reply('t1', '@Codex go', { send: true, to: [AGENT_KEY] });
    await comments.edit('t1', 'm1', 'now plain');
    assert.deepEqual(fake.calls, [
      ['create', { anchor: 'a', label: 'a', location: {}, text: 'hi @Ana', to: ['Ana'] }],
      ['reply', 't1', 'plain'],
      ['reply', 't1', '@Codex go', { to: [AGENT_KEY] }],
      ['send', 't1'],
      ['edit', 't1', 'm1', 'now plain', { to: [] }],
    ]);
  });

  it('refuses a message that names more than 32 people, and says why', async () => {
    const said: string[] = [];
    const comments = createComments(adapter({ notify: (message) => said.push(message.title) }));
    const fake = fakeCapability();
    await comments.start(fake.capability);
    const many = Array.from({ length: MENTION_PEOPLE_LIMIT + 1 }, (_, i) => `P${i}`);
    assert.equal(await comments.create('a', 'hi', { to: many }), false);
    assert.equal(await comments.edit('t1', 'm1', 'hi', { to: many }), false);
    assert.equal(await comments.create('a', 'hi', { to: [AGENT_KEY, ...many.slice(1)] }), true);
    assert.deepEqual(said, [mentionLimitText('post'), mentionLimitText('save')]);
  });

  it('lets the viewer edit only what they wrote', async () => {
    const comments = createComments(adapter());
    await comments.start(fakeCapability().capability);
    assert.equal(comments.canEdit({ id: 'u', name: 'Me', kind: 'person' } as never), true);
    assert.equal(comments.canEdit({ id: 'u', name: 'Ana', kind: 'person' } as never), false);
    assert.equal(comments.canEdit({ id: 'a', name: 'Me', kind: 'agent' } as never), false);
  });

  it('lists who has the artifact (owner first), who is here, then who the threads name', async () => {
    let peersListener: ((peers: Peer[]) => void) | null = null;
    const room = {
      self: async () => 'peer-me',
      participants: async () => [
        { id: 'g1', name: 'Guest Gil' },
        { id: 'o', name: 'Olive', owner: true },
      ],
      peers: async () => [
        { id: 'peer-me', name: 'Me', kind: 'person' },
        { id: 'p2', name: 'Pat', kind: 'person' },
        { id: 'p3', name: 'Bot', kind: 'agent' },
      ],
      onPeers: (fn: (peers: Peer[]) => void) => {
        peersListener = fn;
        return () => {
          peersListener = null;
        };
      },
    };
    const user = { me: async () => ({ id: 'me-id', name: 'Me' }) };
    (globalThis as { window?: unknown }).window = { openartifact: { use: async (name: string) => (name === 'room' ? room : name === 'user' ? user : null) } };
    const comments = createComments(adapter());
    const first = { id: 'm', author: { id: 'x', name: 'Ana', kind: 'person' }, at: '', text: 'hi', to: ['Zed', AGENT_KEY] };
    await comments.start(fakeCapability([thread('t', [first] as never)]).capability);
    comments.followPeople();
    for (let i = 0; i < 10 && comments.store.getState().known.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(comments.store.getState().self, { id: 'me-id', name: 'Me' });
    assert.deepEqual(
      comments.mentionPeople().map((p) => p.name),
      ['Olive', 'Guest Gil', 'Pat', 'Ana', 'Zed'],
    );
    peersListener!([{ id: 'p4', name: 'Quinn', kind: 'person' } as Peer]);
    assert.deepEqual(
      comments.store.getState().known.map((p) => p.name),
      ['Olive', 'Guest Gil', 'Quinn'],
    );
    comments.stop();
    assert.equal(peersListener, null);
  });

  it('still lists who is here when the host cannot say who has the artifact', async () => {
    const room = {
      self: async () => 'peer-me',
      participants: async () => {
        throw new Error('not here');
      },
      peers: async () => [{ id: 'p2', name: 'Pat', kind: 'person' }],
      onPeers: () => () => {},
    };
    (globalThis as { window?: unknown }).window = { openartifact: { use: async (name: string) => (name === 'room' ? room : null) } };
    const comments = createComments(adapter());
    await comments.start(fakeCapability().capability);
    comments.followPeople();
    for (let i = 0; i < 10 && comments.store.getState().known.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(
      comments.mentionPeople().map((p) => p.name),
      ['Pat'],
    );
    comments.stop();
  });
});
