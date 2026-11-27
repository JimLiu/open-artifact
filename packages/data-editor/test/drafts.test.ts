import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_DASHBOARD_CONTENT, type DashboardContent, type DraftDocs, type RemixDraftHead, type UnknownRecord } from '@open-artifact/data-core';
import { DRAFT_OVERDUE_MS, contentHash, deriveDraftView, isDraftBarShown, isDraftWorkingShown, nextDraftAt, type DraftFlowInputs } from '../src/drafts/draft-state.ts';
import { EDIT_OFF, EDIT_ON, changedElsewhere, editUnavailableReason, reduceEditState, type EditState } from '../src/drafts/edit-state.ts';
import { editKeyOf } from '../src/drafts/keys.ts';
import { askDescription, cancelChangesTip, discardDescription, draftQuestionTitle, draftWaitingMessage, saveChangesLabel } from '../src/drafts/words.ts';
import { areDraftsFree, deriveShownContent, isPencilFree, NO_SHOWN_INPUTS, type ShownInputs } from '../src/state/shown.ts';

const head = (id: string, by: string, at: number, extra: Partial<RemixDraftHead> = {}): RemixDraftHead => ({ id, kind: 'remix', form: 'dashboard', by, at, base: '', ...extra });

const pageDocs = (text = '<main>Draft</main>'): DraftDocs => new Map<string, UnknownRecord>([['files/index.html', { text }]]);

function inputs(patch: Partial<DraftFlowInputs> = {}): DraftFlowInputs {
  return {
    heads: [],
    hidden: new Set(),
    viewer: 'me',
    artifact: null,
    followedId: null,
    docs: new Map(),
    heard: false,
    startedId: null,
    opened: null,
    askedId: null,
    asked: false,
    saving: false,
    agentWorking: false,
    content: EMPTY_DASHBOARD_CONTENT,
    free: true,
    savedBase: null,
    now: 1_000_000,
    ...patch,
  };
}

describe('hand-edit state', () => {
  it('turns the pencil on, or asks to convert an older page', () => {
    assert.deepEqual(reduceEditState(EDIT_OFF, { type: 'pencil', editable: true }), EDIT_ON);
    assert.deepEqual(reduceEditState(EDIT_OFF, { type: 'pencil', editable: false }), { phase: 'off', dialog: 'convert' });
    assert.deepEqual(reduceEditState({ phase: 'off', dialog: 'convert' }, { type: 'answer', choice: 'confirm' }), EDIT_OFF);
    assert.deepEqual(reduceEditState({ phase: 'off', dialog: 'convert' }, { type: 'answer', choice: 'stay' }), EDIT_OFF);
  });

  it('asks before discarding unsaved changes', () => {
    assert.deepEqual(reduceEditState(EDIT_ON, { type: 'cancel', dirty: false }), EDIT_OFF);
    const asking = reduceEditState(EDIT_ON, { type: 'cancel', dirty: true });
    assert.deepEqual(asking, { phase: 'editing', dialog: 'discard' });
    assert.deepEqual(reduceEditState(asking, { type: 'answer', choice: 'stay' }), EDIT_ON);
    assert.deepEqual(reduceEditState(asking, { type: 'answer', choice: 'confirm' }), EDIT_OFF);
    assert.deepEqual(reduceEditState(asking, { type: 'save' }), asking);
  });

  it('asks Save and ask / Discard and ask / Keep editing before asking the agent', () => {
    assert.deepEqual(reduceEditState(EDIT_ON, { type: 'ask', dirty: false }), EDIT_ON);
    const asking = reduceEditState(EDIT_ON, { type: 'ask', dirty: true });
    assert.deepEqual(asking, { phase: 'editing', dialog: 'ask' });
    assert.deepEqual(reduceEditState(asking, { type: 'answer', choice: 'confirm' }), EDIT_ON);
    assert.deepEqual(reduceEditState(asking, { type: 'answer', choice: 'other' }), EDIT_OFF);
    assert.deepEqual(reduceEditState(asking, { type: 'answer', choice: 'stay' }), EDIT_ON);
  });

  it('saves, then leaves edit mode; a failed save keeps editing', () => {
    const saving: EditState = reduceEditState(EDIT_ON, { type: 'save' });
    assert.deepEqual(saving, { phase: 'saving', dialog: null });
    assert.deepEqual(reduceEditState(saving, { type: 'cancel', dirty: true }), saving);
    assert.deepEqual(reduceEditState(saving, { type: 'saved' }), EDIT_OFF);
    assert.deepEqual(reduceEditState(saving, { type: 'failed' }), EDIT_ON);
    assert.deepEqual(reduceEditState(EDIT_ON, { type: 'leave', dirty: true }), EDIT_ON);
    assert.deepEqual(reduceEditState(EDIT_ON, { type: 'leave', dirty: false }), EDIT_OFF);
  });

  it('sees a change saved elsewhere, but not its own save', () => {
    assert.equal(changedElsewhere('a', 'a', null), false);
    assert.equal(changedElsewhere('b', 'a', null), true);
    assert.equal(changedElsewhere('b', 'a', 'b'), false);
    assert.equal(changedElsewhere('c', 'a', 'b'), true);
    assert.equal(changedElsewhere(null, 'a', null), false);
    assert.equal(changedElsewhere('a', null, null), false);
  });

  it('names what keeps the pencil off, in order', () => {
    const free = { viewingVersion: false, agentWorking: false, draftShown: false, commenting: false };
    assert.equal(editUnavailableReason(free), null);
    assert.equal(editUnavailableReason({ ...free, commenting: true, agentWorking: true }), 'agent_working');
    assert.equal(editUnavailableReason({ ...free, viewingVersion: true, agentWorking: true }), 'older_version');
    assert.equal(editUnavailableReason({ ...free, draftShown: true, commenting: true }), 'draft_open');
  });
});

describe('edit keys', () => {
  const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  it('reads save, undo and redo', () => {
    assert.equal(editKeyOf(key('s', { metaKey: true })), 'save');
    assert.equal(editKeyOf(key('S', { ctrlKey: true })), 'save');
    assert.equal(editKeyOf(key('z', { metaKey: true })), 'undo');
    assert.equal(editKeyOf(key('Z', { metaKey: true, shiftKey: true })), 'redo');
    assert.equal(editKeyOf(key('y', { ctrlKey: true })), 'redo');
    assert.equal(editKeyOf(key('y', { metaKey: true })), null);
    assert.equal(editKeyOf(key('z')), null);
    assert.equal(editKeyOf(key('s', { metaKey: true, altKey: true })), null);
  });
  it('reads the physical key on a non-Latin layout', () => {
    assert.equal(editKeyOf({ ...key('ы', { metaKey: true }), code: 'KeyS' }), 'save');
    assert.equal(editKeyOf({ ...key('я', { ctrlKey: true }), code: 'KeyZ' }), 'undo');
    assert.equal(editKeyOf({ ...key('я', { metaKey: true, shiftKey: true }), code: 'KeyZ' }), 'redo');
    // A Latin layout keeps its own letters: on Dvorak the key that types "s" saves, wherever it sits.
    assert.equal(editKeyOf({ ...key('s', { metaKey: true }), code: 'Semicolon' }), 'save');
    assert.equal(editKeyOf({ ...key('o', { metaKey: true }), code: 'KeyS' }), null);
  });
});

describe('shown content', () => {
  const live = EMPTY_DASHBOARD_CONTENT;
  const other: DashboardContent = { ...EMPTY_DASHBOARD_CONTENT, lang: 'fr' };
  const draft = { id: 'd1', content: other };
  const version = { n: 4, content: { ...EMPTY_DASHBOARD_CONTENT, lang: 'de' } };
  const shown = (patch: Partial<ShownInputs>) => deriveShownContent(live, { ...NO_SHOWN_INPUTS, ...patch });

  it('shows the live dashboard by default', () => {
    assert.deepEqual(shown({}), { mode: 'live', content: live });
  });

  it('shows a draft only while drafts are free', () => {
    assert.deepEqual(shown({ draft }), { mode: 'draft', content: other, draftId: 'd1' });
    assert.equal(shown({ draft, editing: true }).mode, 'live');
    assert.equal(shown({ draft, commenting: true }).mode, 'live');
    assert.equal(shown({ draft, sourceDirty: true }).mode, 'live');
  });

  it('shows a version over anything else', () => {
    assert.deepEqual(shown({ draft, version }), { mode: 'version', content: version.content, version: 4 });
    assert.equal(areDraftsFree({ ...NO_SHOWN_INPUTS, version }), false);
  });

  it('frees the pencil only with no version, shown draft or comments', () => {
    assert.equal(isPencilFree(NO_SHOWN_INPUTS), true);
    assert.equal(isPencilFree({ ...NO_SHOWN_INPUTS, draft }), false);
    assert.equal(isPencilFree({ ...NO_SHOWN_INPUTS, draft, editing: true }), true);
    assert.equal(isPencilFree({ ...NO_SHOWN_INPUTS, version }), false);
    assert.equal(isPencilFree({ ...NO_SHOWN_INPUTS, commenting: true }), false);
  });
});

describe('draft view', () => {
  it('has nothing to show without drafts', () => {
    const view = deriveDraftView(inputs());
    assert.equal(view.id, null);
    assert.equal(view.showing, false);
    assert.equal(isDraftBarShown(view, true), false);
  });

  it('shows my ready draft, with Undo and Save', () => {
    const view = deriveDraftView(inputs({ heads: [head('d1', 'me', 10)], followedId: 'd1', docs: pageDocs(), heard: true }));
    assert.equal(view.mine, true);
    assert.equal(view.ready, true);
    assert.equal(view.showing, true);
    assert.equal(view.applied?.files.some((file) => file.name === 'index.html'), true);
    assert.deepEqual(view.can, { undo: true, redo: false, save: true });
    assert.equal(isDraftBarShown(view, true), true);
    assert.equal(isDraftBarShown(view, false), false);
  });

  it('hides a draft flipped off, which Redo shows again', () => {
    const view = deriveDraftView(inputs({ heads: [head('d1', 'me', 10)], followedId: 'd1', docs: pageDocs(), heard: true, opened: { id: 'd1', open: false } }));
    assert.equal(view.showing, false);
    assert.deepEqual(view.can, { undo: false, redo: true, save: false });
  });

  it('holds someone else’s draft only once this viewer opened it', () => {
    const base = inputs({ heads: [head('d1', 'other', 10)], followedId: 'd1', docs: pageDocs(), heard: true });
    const unseen = deriveDraftView(base);
    assert.equal(unseen.mine, false);
    assert.equal(unseen.showing, false);
    assert.equal(unseen.held, false);
    assert.equal(isDraftBarShown(unseen, true), false);
    const opened = deriveDraftView({ ...base, opened: { id: 'd1', open: true } });
    assert.equal(opened.showing, true);
    assert.equal(isDraftBarShown(opened, true), true);
  });

  it('offers to cancel my request that has no page yet, and drops it after a day', () => {
    const pending = deriveDraftView(inputs({ heads: [head('d1', 'me', 10)], followedId: 'd1', heard: true, now: 20 }));
    assert.equal(pending.unstarted, true);
    assert.equal(isDraftBarShown(pending, true), true);
    assert.equal(isDraftWorkingShown(pending, true), false);
    const working = deriveDraftView(inputs({ heads: [head('d1', 'me', 10)], followedId: 'd1', heard: true, agentWorking: true, now: 20 }));
    assert.equal(isDraftBarShown(working, true), false);
    assert.equal(isDraftWorkingShown(working, true), true);
    const overdue = deriveDraftView(inputs({ heads: [head('d1', 'me', 10)], followedId: 'd1', heard: true, now: 11 + DRAFT_OVERDUE_MS }));
    assert.equal(overdue.unstarted, false);
    assert.equal(overdue.overdueId, 'd1');
  });

  it('sees the dashboard change after the draft was made', () => {
    const content = EMPTY_DASHBOARD_CONTENT;
    const same = deriveDraftView(inputs({ heads: [head('d1', 'me', 10, { base: contentHash(content) })], followedId: 'd1', docs: pageDocs(), heard: true, content }));
    assert.equal(same.changedSince, false);
    const moved = deriveDraftView(inputs({ heads: [head('d1', 'me', 10, { base: 'older' })], followedId: 'd1', docs: pageDocs(), heard: true, content }));
    assert.equal(moved.changedSince, true);
  });

  it('marks older drafts of mine and saved drafts to drop', () => {
    const view = deriveDraftView(
      inputs({ heads: [head('d1', 'me', 10), head('d2', 'me', 20), head('d0', 'x', 5, { saved: true })], followedId: 'd2', docs: pageDocs(), heard: true }),
    );
    assert.equal(view.id, 'd2');
    assert.deepEqual(view.older, ['d1']);
    assert.equal(view.dropOlder, true);
    assert.equal(view.spentId, 'd0');
  });

  it('leaves out hidden drafts and drafts of other artifacts', () => {
    const heads = [head('d1', 'me', 10), head('d2', 'me', 20, { artifact: 'other' })];
    assert.equal(deriveDraftView(inputs({ heads })).id, 'd1');
    assert.equal(deriveDraftView(inputs({ heads, hidden: new Set(['d1']) })).id, null);
  });

  it('puts a new head just after my newest', () => {
    assert.equal(nextDraftAt([head('d1', 'me', 50), head('d2', 'x', 90)], 'me', 40), 51);
    assert.equal(nextDraftAt([], 'me', 40), 40);
  });
});

describe('draft and edit words', () => {
  it('counts changes', () => {
    assert.equal(discardDescription(1), '1 change hasn’t been saved.');
    assert.equal(discardDescription(3), '3 changes haven’t been saved.');
    assert.equal(askDescription(1), 'The agent works from the saved artifact, so it won’t see your 1 unsaved change.');
    assert.equal(askDescription(2), 'The agent works from the saved artifact, so it won’t see your 2 unsaved changes.');
    assert.ok(saveChangesLabel(2).length > 0);
    assert.ok(cancelChangesTip(2).length > 0);
  });

  it('names a draft’s owner', () => {
    assert.equal(draftQuestionTitle('save', 'Ann'), 'Save Ann’s draft?');
    assert.equal(draftQuestionTitle('save', ''), 'Save someone else’s draft?');
    assert.equal(draftQuestionTitle('discard', null), 'Discard this draft?');
    assert.equal(draftQuestionTitle('discard', ''), 'Discard someone else’s draft?');
    assert.equal(draftWaitingMessage(''), 'Someone else has a draft waiting.');
    assert.equal(draftWaitingMessage('Ann'), 'Ann has a draft waiting.');
  });
});
