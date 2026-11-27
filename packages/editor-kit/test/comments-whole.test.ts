/**
 * Tests of comments on the whole artifact: the anchor a type gives for them, the threads they make (stored with the
 * empty anchor), and what the controller does not do for them (bring a spot into view, call one gone).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommentsCapability, CommentThread } from '@open-artifact/runtime';
import { createComments, WHOLE_ARTIFACT, type CommentsAdapter } from '../src/index.ts';

interface Spot {
  at: string;
  label?: string;
}

const thread = (id: string, anchor: string): CommentThread =>
  ({
    id,
    anchor,
    label: anchor || 'Whole artifact',
    location: {},
    status: 'open',
    messages: [{ id: `${id}m`, author: { id: 'u', name: 'Ana', kind: 'person' }, at: new Date(0).toISOString(), text: 'hi' }],
  }) as unknown as CommentThread;

function fakeCapability(initial: CommentThread[] = []) {
  const created: Record<string, unknown>[] = [];
  const sent: string[] = [];
  const capability = {
    list: async () => initial,
    create: async (input: Record<string, unknown>) => (created.push(input), thread('new', String(input.anchor))),
    sendToAgent: async (id: string) => (sent.push(id), thread(id, '')),
    onChange: () => () => {},
  } as unknown as CommentsCapability;
  return { capability, created, sent };
}

function adapter(revealed: string[], overrides: Partial<CommentsAdapter<Spot>> = {}): CommentsAdapter<Spot> {
  return {
    parse: (text) => ({ at: text }),
    serialize: (anchor) => anchor.at,
    label: (anchor) => anchor.label ?? `on ${anchor.at}`,
    location: (anchor) => ({ file: 'page.html', ...(anchor.at ? { at: anchor.at } : {}) }),
    state: (anchor) => (anchor.at === 'here' ? 'ok' : 'orphaned'),
    reveal: (anchor) => void revealed.push(anchor.at),
    canComment: () => true,
    canSendToAgent: () => true,
    wholeArtifact: () => ({ at: WHOLE_ARTIFACT, label: 'Whole artifact' }),
    parksDrafts: true,
    ...overrides,
  };
}

describe('comments on the whole artifact', () => {
  it('stores them with the empty anchor and the type’s label and location, and sends them like any other', async () => {
    const comments = createComments(adapter([]));
    const fake = fakeCapability();
    await comments.start(fake.capability);
    const whole = comments.wholeArtifact();
    assert.ok(whole);
    assert.equal(comments.isWholeAnchor(whole), true);
    comments.store.getState().setDraft(whole);
    assert.equal(await comments.create(whole, 'Make it calmer', { send: true, to: ['agent'] }), true);
    assert.deepEqual(fake.created, [{ anchor: '', label: 'Whole artifact', location: { file: 'page.html' }, text: 'Make it calmer', to: ['agent'] }]);
    assert.deepEqual(fake.sent, ['new']);
    const state = comments.store.getState();
    assert.equal(state.draft, null);
    assert.equal(state.active, 'new');
  });

  it('sets a comment begun on the page aside when the panel composer opens, and takes it up again from its spot', async () => {
    const comments = createComments(adapter([]));
    await comments.start(fakeCapability().capability);
    const state = () => comments.store.getState();
    // Empty: it just gives way.
    state().setDraft({ at: 'here' });
    assert.equal(comments.composeWhole(), null);
    assert.equal(comments.isWholeAnchor(state().draft!), true);
    assert.equal(state().parked, null);
    state().setDraft(null);
    // With words: set aside, words and box kept; the panel composer starts empty.
    state().setDraft({ at: 'here' });
    state().setDraftText('Too small');
    state().setSendNew(true);
    assert.equal(comments.composeWhole(), null);
    assert.deepEqual(state().parked, { anchor: { at: 'here' }, text: 'Too small', send: true });
    assert.equal(state().draftText, '');
    assert.equal(state().sendNew, false);
    // Words in the panel composer hold the page: no spot, no card.
    state().setDraftText('Calmer');
    state().setDraft({ at: 'here' });
    state().setActive('t1');
    assert.equal(comments.isWholeAnchor(state().draft!), true);
    assert.equal(state().active, null);
    // Emptied, it gives way; another spot waits for the one set aside, which comes back with its words.
    state().setDraftText('');
    state().setDraft({ at: 'there' });
    assert.equal(comments.isWholeAnchor(state().draft!), true);
    state().setDraft({ at: 'here' });
    assert.deepEqual(state().draft, { at: 'here' });
    assert.equal(state().draftText, 'Too small');
    assert.equal(state().sendNew, true);
    assert.equal(state().parked, null);
    // Opening a card sets it aside too.
    state().setActive('t1');
    assert.deepEqual(state().parked, { anchor: { at: 'here' }, text: 'Too small', send: true });
    assert.equal(state().active, 't1');
    assert.equal(state().draftText, '');
  });

  it('sets nothing aside where nothing shows it: the words go on into what opens next', async () => {
    const comments = createComments(adapter([], { parksDrafts: false }));
    await comments.start(fakeCapability().capability);
    const state = () => comments.store.getState();
    state().setDraft({ at: 'here' });
    state().setDraftText('Too small');
    // The panel composer opens with them; nothing is refused and nothing is set aside.
    assert.equal(comments.composeWhole(), null);
    assert.equal(comments.isWholeAnchor(state().draft!), true);
    assert.equal(state().parked, null);
    assert.equal(state().draftText, 'Too small');
    state().setDraftText('');
    state().setDraft({ at: 'here' });
    state().setDraftText('Too small');
    // A card closes it as before, its words going on to the next one; a spot elsewhere is taken.
    state().setActive('t1');
    assert.equal(state().parked, null);
    assert.equal(state().draftText, 'Too small');
    state().setDraft({ at: 'there' });
    assert.deepEqual(state().draft, { at: 'there' });
    assert.equal(state().draftText, 'Too small');
  });

  it('keeps the panel composer shut while a write is on its way or an edit has changes, and says why', async () => {
    const fake = fakeCapability([thread('t1', 'here')]);
    let answer: (value: CommentThread) => void = () => {};
    (fake.capability as unknown as { reply: unknown }).reply = () => new Promise<CommentThread>((resolve) => (answer = resolve));
    const comments = createComments(adapter([]));
    await comments.start(fake.capability);
    const state = () => comments.store.getState();
    const posting = comments.reply('t1', 'More');
    assert.deepEqual(state().writing, ['reply:t1']);
    assert.equal(comments.composeWhole(), 'posting');
    assert.equal(state().draft, null);
    answer(thread('t1', 'here'));
    assert.equal(await posting, true);
    assert.deepEqual(state().writing, []);
    // An edit with changes holds it (and another card); one without changes is closed by it.
    state().setActive('t1');
    state().setEditing({ thread: 't1', message: 't1m', send: false, changed: true });
    assert.equal(comments.composeWhole(), 'editing');
    state().setActive('t2');
    assert.equal(state().active, 't1');
    state().setEditing({ thread: 't1', message: 't1m', send: false, changed: false });
    assert.equal(comments.composeWhole(), null);
    assert.equal(state().editing, null);
    assert.equal(state().active, null);
    // The edit ends with its card, so nothing is left holding the composer.
    state().setActive('t1');
    state().setEditing({ thread: 't1', message: 't1m', send: false, changed: true });
    state().setActive(null);
    assert.equal(state().editing, null);
    assert.equal(comments.composeRefusal(), null);
    // An edit with changes beside a comment being written (an item's cards show both) names the comment being written.
    state().setDraft({ at: 'here' });
    state().setEditing({ thread: 't1', message: 't1m', send: false, changed: true });
    assert.equal(comments.composeWhole(), 'writing');
    assert.deepEqual(state().draft, { at: 'here' });
  });

  it('lets a write that fails go', async () => {
    const fake = fakeCapability();
    (fake.capability as unknown as { create: unknown }).create = () => Promise.reject(new Error('down'));
    const comments = createComments(adapter([]));
    await comments.start(fake.capability);
    assert.equal(await comments.create({ at: 'here' }, 'hi'), false);
    assert.deepEqual(comments.store.getState().writing, []);
    assert.equal(createComments(adapter([], { wholeArtifact: undefined })).composeWhole(), null);
  });

  it('opens their card without bringing a spot into view, and never calls them gone', async () => {
    const revealed: string[] = [];
    const comments = createComments(adapter(revealed));
    const spot = thread('s', 'here');
    const whole = thread('w', '');
    await comments.start(fakeCapability([spot, whole]).capability);
    assert.equal(comments.isWhole(whole), true);
    assert.equal(comments.isWhole(spot), false);
    comments.show(whole);
    assert.deepEqual(revealed, []);
    assert.equal(comments.store.getState().active, 'w');
    comments.show(spot);
    assert.deepEqual(revealed, ['here']);
    assert.equal(comments.stateOf(comments.anchorOf(whole)), 'ok');
    assert.equal(comments.stateOf({ at: 'gone' }), 'orphaned');
  });

  it('knows a type’s own anchor for the whole artifact as well as the empty one', async () => {
    const comments = createComments(adapter([], { wholeArtifact: () => ({ at: 'root' }) }));
    await comments.start(fakeCapability().capability);
    assert.equal(comments.isWhole(thread('a', 'root')), true);
    assert.equal(comments.isWhole(thread('b', '')), true);
    assert.equal(comments.isWhole(thread('c', 'here')), false);
    assert.equal(comments.isWholeAnchor({ at: 'root' }), true);
  });

  it('has none for a type without them: the empty anchor is an ordinary one', async () => {
    const revealed: string[] = [];
    const comments = createComments(adapter(revealed, { wholeArtifact: undefined }));
    const empty = thread('e', '');
    await comments.start(fakeCapability([empty]).capability);
    assert.equal(comments.wholeArtifact(), null);
    assert.equal(comments.isWhole(empty), false);
    assert.equal(comments.isWholeAnchor({ at: '' }), false);
    comments.reveal(empty);
    assert.deepEqual(revealed, ['']);
  });
});
