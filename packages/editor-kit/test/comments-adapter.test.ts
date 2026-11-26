/**
 * Tests of the comments controller's optional adapter hooks (the editor's
 * own text check, detail, delete permission, agent requests and hearing of
 * threads) and of stopping it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommentsCapability, CommentThread } from '@open-artifact/runtime';
import { COMMENT_TEXT_BYTES, COMMENT_TOO_LONG, commentTextBytes, createComments, type CommentsAdapter } from '../src/index.ts';

const thread = (id: string, anchor: string): CommentThread =>
  ({
    id,
    anchor,
    label: anchor,
    location: {},
    status: 'open',
    messages: [{ id: `${id}m`, author: { id: 'u', name: 'Ana', kind: 'person' }, at: new Date(0).toISOString(), text: 'hi' }],
  }) as unknown as CommentThread;

/** A fake capability recording calls; `change` plays a change from the host. */
function fakeCapability(initial: CommentThread[]) {
  const calls: string[] = [];
  let listener: ((threads: CommentThread[]) => void) | null = null;
  const capability = {
    list: async () => initial,
    create: async (input: { anchor: string; detail?: string; text: string }) => (calls.push(`create ${input.anchor} ${input.detail ?? '-'} ${input.text}`), thread('new', input.anchor)),
    reply: async (id: string, text: string) => (calls.push(`reply ${id} ${text}`), thread(id, 'x')),
    setResolved: async (id: string) => thread(id, 'x'),
    move: async (id: string, anchor: string) => thread(id, anchor),
    remove: async (id: string) => void calls.push(`remove ${id}`),
    sendToAgent: async (id: string) => (calls.push(`send ${id}`), thread(id, 'x')),
    onChange: (fn: (threads: CommentThread[]) => void) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  } as unknown as CommentsCapability;
  return { capability, calls, change: (threads: CommentThread[]) => listener?.(threads) };
}

function adapter(overrides: Partial<CommentsAdapter<string>> = {}): CommentsAdapter<string> {
  return {
    parse: (text) => text,
    serialize: (anchor) => anchor,
    label: (anchor) => `on ${anchor}`,
    canComment: () => true,
    canSendToAgent: () => true,
    ...overrides,
  };
}

describe('comments adapter hooks', () => {
  it('checks text the editor’s way, stores a detail and resolves whether a write was saved', async () => {
    const comments = createComments(adapter({ checkText: (text) => (text.length > 5 ? undefined : text.trim()), detail: (anchor) => `about ${anchor}` }));
    const fake = fakeCapability([]);
    await comments.start(fake.capability);
    assert.equal(await comments.create('A', 'far too long'), false);
    assert.equal(await comments.create('A', ' ok '), true);
    assert.deepEqual(fake.calls, ['create A about A ok']);
    assert.equal(await comments.reply('new', 'no, too long'), false);
    assert.equal(await comments.reply('new', 'yes'), true);
  });

  it('keeps the default text check without one', async () => {
    const comments = createComments(adapter());
    const fake = fakeCapability([]);
    await comments.start(fake.capability);
    assert.equal(await comments.create('A', '   '), false);
    assert.equal(fake.calls.length, 0);
  });

  it('refuses a comment over the UTF-8 byte limit by default, with the draft kept and nothing cut', async () => {
    const told: string[] = [];
    const comments = createComments(adapter({ notify: (message) => void told.push(message.title) }));
    const fake = fakeCapability([]);
    await comments.start(fake.capability);
    comments.store.getState().setDraftText('draft');
    // Exactly COMMENT_TEXT_BYTES: the emoji is 4 bytes and 2 UTF-16 units.
    const fits = 'Make it blue 🟦'.padStart(COMMENT_TEXT_BYTES - 2, 'x');
    assert.equal(commentTextBytes(fits), COMMENT_TEXT_BYTES);
    // 1,366 CJK characters are 4,098 bytes, though far under 4,096 UTF-16 units.
    const wide = '蓝'.repeat(Math.ceil((COMMENT_TEXT_BYTES + 1) / 3));
    for (const text of [`${fits}!`, wide]) {
      assert.equal(await comments.create('A', text), false);
      assert.equal(await comments.reply('t', text), false);
    }
    assert.deepEqual(told, Array(4).fill(COMMENT_TOO_LONG));
    assert.equal(fake.calls.length, 0);
    assert.equal(comments.store.getState().draftText, 'draft');
    assert.equal(await comments.create('A', ` ${fits}\n`), true);
    assert.deepEqual(fake.calls, [`create A - ${fits}`]);
  });

  it('deletes only for those the adapter allows', async () => {
    let may = false;
    const comments = createComments(adapter({ canRemove: () => may }));
    const fake = fakeCapability([thread('t1', 'A')]);
    await comments.start(fake.capability);
    assert.equal(comments.canRemove(), false);
    await comments.remove('t1');
    assert.deepEqual(fake.calls, []);
    may = true;
    await comments.remove('t1');
    assert.deepEqual(fake.calls, ['remove t1']);
    // Without the hook, whoever may comment may delete.
    const open = createComments(adapter());
    await open.start(fakeCapability([]).capability);
    assert.equal(open.canRemove(), true);
  });

  it('hands threads to the agent through the adapter when it has a way', async () => {
    const sent: string[] = [];
    const comments = createComments(adapter({ sendToAgent: async (t, anchor) => (sent.push(`${t.id} ${anchor}`), true) }));
    const fake = fakeCapability([thread('t1', 'A')]);
    await comments.start(fake.capability);
    assert.equal(await comments.sendToAgent('t1'), true);
    assert.deepEqual(sent, ['t1 A']);
    assert.deepEqual(fake.calls, [], 'the capability is not called directly');
    assert.equal(await comments.sendToAgent('gone'), false);
  });

  it('sends every open thread at once, with one notice', async () => {
    const notices: string[] = [];
    const comments = createComments(adapter({ notify: (m) => void notices.push(m.title) }));
    const fake = fakeCapability([thread('t1', 'A'), thread('t2', 'B'), thread('t3', 'C')]);
    // Each send stays pending until all three have started: one after another, this would never finish.
    const started: Array<() => void> = [];
    const send = fake.capability.sendToAgent;
    fake.capability.sendToAgent = (id) =>
      new Promise<void>((go) => {
        started.push(go);
        if (started.length === 3) for (const next of started) next();
      }).then(() => send(id));
    await comments.start(fake.capability);
    await comments.sendAllToAgent();
    assert.deepEqual(fake.calls, ['send t1', 'send t2', 'send t3']);
    assert.equal(notices.length, 1, 'one "Sent to" notice for all of them');
  });

  it('tells the adapter of every thread it hears of, until stopped', async () => {
    const heard: string[] = [];
    const comments = createComments(adapter({ heard: (threads) => void heard.push(threads.map((t) => t.id).join(',')) }));
    const fake = fakeCapability([thread('t1', 'A'), thread('t2', 'B')]);
    await comments.start(fake.capability);
    await comments.reply('t1', 'hey');
    fake.change([thread('t1', 'A')]);
    assert.deepEqual(heard, ['t1,t2', 't1', 't1']);
    comments.stop();
    fake.change([]);
    assert.equal(comments.store.getState().threads.length, 1, 'changes after stop are ignored');
  });
});
