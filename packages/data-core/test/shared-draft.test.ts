import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoPublishBlock,
  changedOnlyByDraft,
  draftDocsMoved,
  draftFileCopy,
  EMPTY_DASHBOARD_CONTENT,
  filesToCopy,
  hasSharedChanges,
  hasStaleCopies,
  isUntouchedCopy,
  mergeDraftFiles,
  parseDashboardContent,
  parseDraftHead,
  pastDraftsToDrop,
  pickDraftHead,
  planSharedPublish,
  restoreClashes,
  restoreWrites,
  settledDocs,
  toDraftHeadRecord,
  withoutCopies,
} from '../src/index.ts';
import type { DashboardContent, DraftDocs, DraftHead, PastDraftHead, UnknownRecord } from '../src/index.ts';

const docs = (entries: Record<string, UnknownRecord>): DraftDocs => new Map(Object.entries(entries));
const past = (id: string, at: number, what: 'saved' | 'discarded', bytes = 0, extra: Partial<PastDraftHead> = {}): PastDraftHead => ({
  id,
  kind: 'past',
  what,
  by: 'u1',
  at,
  base: '',
  bytes,
  ...extra,
});
const content = (files: Record<string, string>): DashboardContent => ({
  ...EMPTY_DASHBOARD_CONTENT,
  files: Object.entries(files).map(([name, text]) => ({ name, text })),
});

describe('shared draft heads', () => {
  it('reads the shared draft and past drafts, editors as a sorted list', () => {
    assert.deepEqual(
      parseDraftHead('shared', { v: 1, kind: 'edit', by: 'u1', at: 5, base: '', editors: { u2: true, u1: true, u3: false }, agent: true, held: true, changed: 9 }),
      { id: 'shared', kind: 'edit', by: 'u1', at: 5, base: '', editors: ['u1', 'u2'], agent: true, held: true, changed: 9 },
    );
    assert.deepEqual(parseDraftHead('p1', { kind: 'past', what: 'discarded', by: 'u1', at: 5, bytes: 40, left: true }), {
      id: 'p1',
      kind: 'past',
      what: 'discarded',
      by: 'u1',
      at: 5,
      base: '',
      left: true,
      bytes: 40,
    });
    assert.equal(parseDraftHead('p1', { kind: 'past', what: 'kept', by: 'u1', at: 5 }), null);
    assert.equal(parseDraftHead('p1', { kind: 'other', by: 'u1', at: 5 }), null);
  });

  it('stores editors as a map', () => {
    const head = parseDraftHead('shared', { kind: 'edit', by: 'u1', at: 5, editors: { u1: true } })!;
    assert.deepEqual(toDraftHeadRecord(head), { v: 1, kind: 'edit', by: 'u1', at: 5, base: '', editors: { u1: true } });
  });

  it('picks my remix first, then the shared draft, and never a past one', () => {
    const heads: DraftHead[] = [
      { id: 'shared', kind: 'edit', by: 'u2', at: 1, base: '' },
      { id: 'r1', kind: 'remix', form: 'dashboard', by: 'u2', at: 3, base: '' },
      past('p1', 9, 'saved'),
    ];
    assert.equal(pickDraftHead(heads, 'u1')?.id, 'shared');
    assert.equal(pickDraftHead(heads, 'u2')?.id, 'r1');
    assert.equal(pickDraftHead([past('p1', 9, 'saved')], 'u1'), null);
  });
});

describe('copies', () => {
  it('counts an untouched copy as no change', () => {
    const copy = draftFileCopy('<p>a</p>');
    assert.equal(isUntouchedCopy(copy), true);
    assert.equal(isUntouchedCopy({ ...copy, text: '<p>b</p>' }), false);
    const held = docs({ 'files/index.html': copy });
    assert.equal(hasSharedChanges(held), false);
    assert.equal(withoutCopies(held).size, 0);
    assert.equal(hasSharedChanges(docs({ 'files/index.html': { ...copy, text: '<p>b</p>' } })), true);
  });

  it('copies missing and stale files, and tells a copy the live page moved past', () => {
    const held = docs({ 'files/a.html': draftFileCopy('old'), 'files/b.html': { text: 'mine' } });
    const live = [
      { name: 'a.html', text: 'new' },
      { name: 'b.html', text: 'live' },
      { name: 'c.html', text: 'c' },
    ];
    assert.deepEqual(filesToCopy(held, live).map((file) => file.name), ['a.html', 'c.html']);
    assert.equal(hasStaleCopies(held, live), true);
    assert.equal(hasStaleCopies(docs({ 'files/a.html': { ...draftFileCopy('old'), text: 'edited' } }), [{ name: 'a.html', text: 'old' }]), false);
  });
});

describe('publishing', () => {
  it('writes the draft with the entry page last and removes nothing', () => {
    const plan = planSharedPublish(
      docs({
        'files/index.html': { text: '<p>x</p>', copy: 'nope' },
        'files/about.html': draftFileCopy('same'),
        'datasets/sales': { title: 'Sales', source: { kind: 'inline', columns: [], rows: [] } },
        'datasets/bad': { title: 1 },
        'dash/params': { region: { value: 'EU' } },
      }),
    );
    assert.deepEqual(
      plan.write.map(([path]) => path),
      ['datasets/sales', 'dash/params', 'files/index.html'],
    );
    assert.deepEqual(plan.write.at(-1)?.[1], { text: '<p>x</p>' });
    assert.deepEqual(plan.remove, []);
  });

  it('shows the live files joined by the draft’s', () => {
    assert.deepEqual(
      mergeDraftFiles(
        [
          { name: 'index.html', text: 'live' },
          { name: 'b.html', text: 'b' },
        ],
        [{ name: 'index.html', text: 'draft' }],
      ),
      [
        { name: 'b.html', text: 'b' },
        { name: 'index.html', text: 'draft' },
      ],
    );
  });

  it('settles only the documents still as shown', () => {
    const shown = docs({ 'files/index.html': { text: 'a' }, 'datasets/x': { title: 'X' } });
    const stored = docs({ 'files/index.html': { text: 'a' }, 'datasets/x': { title: 'Y' }, 'dash/params': {} });
    assert.deepEqual(settledDocs(stored, shown).map(([path]) => path), ['files/index.html']);
  });
});

describe('past drafts', () => {
  it('keeps five published and twenty discarded drafts', () => {
    const heads = Array.from({ length: 7 }, (_, index) => past(`s${index}`, 100 + index, 'saved'));
    const added = past('new', 200, 'saved');
    assert.deepEqual(pastDraftsToDrop([...heads, added], added).map((head) => head.id), ['s2', 's1', 's0']);
  });

  it('lets discarded drafts go past ten million bytes, and those left from another artifact', () => {
    const added = past('new', 200, 'discarded', 6_000_000, { artifact: 'a' });
    const heads = [past('d1', 150, 'discarded', 3_000_000, { artifact: 'a' }), past('d2', 100, 'discarded', 2_000_000, { artifact: 'a' }), past('o', 120, 'discarded', 9e9, { artifact: 'b' })];
    assert.deepEqual(pastDraftsToDrop(heads, added).map((head) => head.id), ['o', 'd2']);
    assert.deepEqual(pastDraftsToDrop([past('n', 120, 'discarded')], added).map((head) => head.id), []);
  });
});

describe('restoring', () => {
  it('writes what differs and clashes with changes the draft holds', () => {
    const before = docs({ 'files/index.html': { text: 'old', edit: { by: 'u1', byAt: 1 } }, 'dash/params': { a: 1 } });
    assert.deepEqual(restoreWrites(new Map(), before).map(([path]) => path), ['dash/params', 'files/index.html']);
    assert.equal(restoreClashes(docs({ 'files/index.html': draftFileCopy('x') }), before), false);
    assert.equal(restoreClashes(docs({ 'files/index.html': { text: 'newer' } }), before), true);
    assert.deepEqual(restoreWrites(docs({ 'files/index.html': { text: 'old', edit: { by: 'u2', byAt: 5 } } }), before).map(([path]) => path), ['dash/params']);
  });

  it('tells a person’s change from a new stamp alone', () => {
    const before = docs({ 'files/index.html': { text: 'a', edit: { by: 'u1', byAt: 1 } } });
    assert.equal(draftDocsMoved(before, docs({ 'files/index.html': { text: 'b' } })), true);
    assert.equal(draftDocsMoved(before, docs({ 'files/index.html': { text: 'b', edit: { by: 'u1', byAt: 1 } } })), true);
    assert.equal(draftDocsMoved(before, docs({ 'files/index.html': { text: 'b', edit: { by: 'u2', byAt: 3 } } })), false);
    assert.equal(draftDocsMoved(before, before), false);
  });
});

describe('publishing by itself', () => {
  it('says why not', () => {
    assert.equal(autoPublishBlock({ autoPublish: false, others: [], changedSince: false }), 'off');
    assert.equal(autoPublishBlock({ autoPublish: true, others: ['u2'], changedSince: false }), 'others');
    assert.equal(autoPublishBlock({ autoPublish: true, others: [], changedSince: true }), 'changed');
    assert.equal(autoPublishBlock({ autoPublish: true, others: [], changedSince: false }), null);
  });

  it('reads auto-publish from dash/settings, on unless stored false', () => {
    assert.equal(parseDashboardContent({ settings: {} }).autoPublish, true);
    assert.equal(parseDashboardContent({ settings: { autoPublish: false } }).autoPublish, false);
  });

  it('tells a change the draft explains from someone else’s', () => {
    const before = content({ 'index.html': 'a' });
    const draft = content({ 'index.html': 'b' });
    const held = docs({ 'files/index.html': { text: 'b' } });
    assert.equal(changedOnlyByDraft(before, content({ 'index.html': 'b' }), draft, held), true);
    assert.equal(changedOnlyByDraft(before, content({ 'index.html': 'c' }), draft, held), false);
    assert.equal(changedOnlyByDraft(before, content({ 'index.html': 'a', 'x.html': 'x' }), draft, held), false);
  });
});
