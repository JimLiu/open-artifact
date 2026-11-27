import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_DASHBOARD_CONTENT, draftFileCopy, type DashboardContent, type DraftDocs, type SharedDraftHead, type UnknownRecord } from '@open-artifact/data-core';
import { SHARED_DRAFT_PATH, deriveSharedDraftView, sharedWriteTo, type SharedDraftInputs } from '../src/drafts/shared-state.ts';
import { draftQuestionTitle, sharedQuestionDescription, sharedSettledMessage, versionMadeBy } from '../src/drafts/words.ts';
import { deriveShownContent, isPencilFree, NO_SHOWN_INPUTS, SHARED_SHOWN_ID, type ShownInputs } from '../src/state/shown.ts';

const live: DashboardContent = { ...EMPTY_DASHBOARD_CONTENT, files: [{ name: 'index.html', text: '<main>Live</main>' }] };
const head = (extra: Partial<SharedDraftHead> = {}): SharedDraftHead => ({ id: 'shared', kind: 'edit', by: 'me', at: 1, base: 'b', ...extra });
const docs = (entries: Record<string, UnknownRecord>): DraftDocs => new Map(Object.entries(entries));
const changed = docs({ 'files/index.html': { text: '<main>Draft</main>' } });

function inputs(patch: Partial<SharedDraftInputs> = {}): SharedDraftInputs {
  return {
    head: head(),
    docs: new Map(),
    heard: true,
    looks: false,
    open: null,
    content: live,
    free: true,
    turn: false,
    publishing: false,
    restoring: false,
    me: 'me',
    ...patch,
  };
}

describe('shared draft view', () => {
  it('offers the version menu while the draft holds nothing', () => {
    const view = deriveSharedDraftView(inputs());
    assert.equal(view.ready, false);
    assert.equal(view.showing, false);
    assert.equal(view.shows, 'none');
    assert.equal(view.drawn, true);
  });

  it('counts an untouched copy as no change', () => {
    const view = deriveSharedDraftView(inputs({ docs: docs({ 'files/index.html': draftFileCopy('<main>Live</main>') }) }));
    assert.equal(view.ready, false);
    assert.equal(view.docs.size, 0);
  });

  it('shows the draft to an editor, with Publish', () => {
    const view = deriveSharedDraftView(inputs({ docs: changed }));
    assert.equal(view.ready, true);
    assert.equal(view.showing, true);
    assert.equal(view.shows, 'draft');
    assert.equal(view.applied?.files.find((file) => file.name === 'index.html')?.text, '<main>Draft</main>');
    assert.equal(view.showingPath, SHARED_DRAFT_PATH);
  });

  it('shows the published artifact to someone who only looks, with See draft', () => {
    const view = deriveSharedDraftView(inputs({ docs: changed, looks: true }));
    assert.equal(view.showing, false);
    assert.equal(view.shows, 'published');
    const opened = deriveSharedDraftView(inputs({ docs: changed, looks: true, open: true }));
    assert.equal(opened.shows, 'viewing');
  });

  it('draws nothing for a viewer while there is no draft', () => {
    assert.equal(deriveSharedDraftView(inputs({ looks: true })).drawn, false);
  });

  it('holds the control while the draft is read, restored, or can’t show', () => {
    assert.equal(deriveSharedDraftView(inputs({ heard: false })).shows, 'held');
    assert.equal(deriveSharedDraftView(inputs({ restoring: true })).shows, 'held');
    assert.equal(deriveSharedDraftView(inputs({ docs: changed, free: false })).shows, 'held');
  });

  it('names the others who changed it', () => {
    assert.deepEqual(deriveSharedDraftView(inputs({ head: head({ editors: ['me', 'ana'] }) })).others, ['ana']);
  });

  it('lets See published / See draft flip only while nothing else runs', () => {
    assert.equal(deriveSharedDraftView(inputs({ docs: changed })).canSee, true);
    assert.equal(deriveSharedDraftView(inputs({ docs: changed, turn: true })).canSee, false);
    assert.equal(deriveSharedDraftView(inputs({ docs: changed, publishing: true })).canSee, false);
  });
});

describe('where the agent writes', () => {
  it('writes live with auto-publish on and nothing waiting', () => {
    assert.equal(sharedWriteTo({ on: true, autoPublish: true, readyAtStart: false, editing: false }), null);
  });

  it('writes into the draft otherwise', () => {
    assert.equal(sharedWriteTo({ on: true, autoPublish: false, readyAtStart: false, editing: false }), SHARED_DRAFT_PATH);
    assert.equal(sharedWriteTo({ on: true, autoPublish: true, readyAtStart: true, editing: false }), SHARED_DRAFT_PATH);
    assert.equal(sharedWriteTo({ on: true, autoPublish: true, readyAtStart: false, editing: true }), SHARED_DRAFT_PATH);
    assert.equal(sharedWriteTo({ on: false, autoPublish: false, readyAtStart: true, editing: false }), null);
  });
});

describe('shown content with a shared draft', () => {
  const other: DashboardContent = { ...EMPTY_DASHBOARD_CONTENT, lang: 'fr' };
  const shown = (patch: Partial<ShownInputs>) => deriveShownContent(live, { ...NO_SHOWN_INPUTS, ...patch });

  it('shows it, also while the page is edited by hand', () => {
    assert.deepEqual(shown({ shared: { content: other } }), { mode: 'draft', content: other, draftId: SHARED_SHOWN_ID });
    assert.equal(shown({ shared: { content: other }, editing: true }).draftId, SHARED_SHOWN_ID);
  });

  it('gives way to a version, comments and unsaved sources', () => {
    assert.equal(shown({ shared: { content: other }, version: { n: 2, content: live } }).mode, 'version');
    assert.equal(shown({ shared: { content: other }, commenting: true }).mode, 'live');
    assert.equal(shown({ shared: { content: other }, sourceDirty: true }).mode, 'live');
  });

  it('leaves the pencil free', () => {
    assert.equal(isPencilFree({ ...NO_SHOWN_INPUTS, shared: { content: other } }), true);
  });
});

describe('shared draft words', () => {
  it('asks before publishing or discarding', () => {
    assert.equal(draftQuestionTitle('save', null), 'Publish this draft?');
    assert.equal(draftQuestionTitle('discard', null), 'Discard this draft?');
    assert.equal(sharedQuestionDescription('save', 'Ana'), 'It holds changes by Ana. Everyone with access will see them.');
    assert.equal(sharedQuestionDescription('discard', null), 'The artifact stays as it is. The draft can be restored from History.');
  });

  it('tells others what someone did with the draft', () => {
    assert.equal(sharedSettledMessage('saved', false, 'Ana'), 'Ana published the draft.');
    assert.equal(sharedSettledMessage('discarded', true, 'Ana'), 'Ana discarded the draft. Some changes are still in it.');
  });

  it('names who made a version', () => {
    assert.equal(versionMadeBy('Today at 2:05 PM', 'you'), 'Today at 2:05 PM by you');
    assert.equal(versionMadeBy('Today at 2:05 PM', ''), 'Today at 2:05 PM');
  });
});
