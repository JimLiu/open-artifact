/**
 * The page's pure parts: the list's filters, the words, and how a type's thumbnail is taken.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countByType, inRange, NO_FILTERS, visibleArtifacts } from '../src/filters.ts';
import { en, translator, zh } from '../src/i18n.ts';
import { captureRecipe } from '../src/library/capture.ts';
import type { PageArtifact } from '../src/library/routes.ts';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

const item = (id: string, over: Partial<PageArtifact> = {}): PageArtifact => ({
  id,
  root: `/work/${id}`,
  type: 'design',
  typeTitle: 'Design',
  sessionId: '',
  ownerStatus: null,
  title: id,
  openedAt: '2026-11-14T11:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  pinned: false,
  shared: false,
  thumbnail: null,
  openable: true,
  viewUrl: '',
  ...over,
});

describe('filters', () => {
  const list = [
    item('Bravo', { pinned: true, openedAt: '2026-11-14T10:00:00.000Z' }),
    item('alpha', { shared: true, sessionId: 's1', openedAt: '2026-11-14T11:30:00.000Z' }),
    item('Charlie', { type: 'other', openedAt: '2026-09-01T00:00:00.000Z' }),
  ];
  const query = { filters: NO_FILTERS, query: '', now: NOW, locale: 'en' };
  const ids = (l: PageArtifact[]) => l.map((a) => a.id);

  it('lists the most recently opened first', () => {
    assert.deepEqual(ids(visibleArtifacts(list, query)), ['alpha', 'Bravo', 'Charlie']);
  });

  it('sorts by name, ignoring case', () => {
    assert.deepEqual(ids(visibleArtifacts(list, { ...query, filters: { ...NO_FILTERS, sort: 'name' } })), ['alpha', 'Bravo', 'Charlie']);
  });

  it('narrows by type, pin, sharing and date', () => {
    assert.deepEqual(ids(visibleArtifacts(list, { ...query, filters: { ...NO_FILTERS, types: ['other'] } })), ['Charlie']);
    assert.deepEqual(ids(visibleArtifacts(list, { ...query, filters: { ...NO_FILTERS, pinned: true } })), ['Bravo']);
    assert.deepEqual(ids(visibleArtifacts(list, { ...query, filters: { ...NO_FILTERS, sharing: 'private' } })), ['Bravo', 'Charlie']);
    assert.deepEqual(ids(visibleArtifacts(list, { ...query, filters: { ...NO_FILTERS, date: 'week' } })), ['alpha', 'Bravo']);
  });

  it("searches titles, folders and the session's title", () => {
    assert.deepEqual(ids(visibleArtifacts(list, { ...query, query: 'CHAR' })), ['Charlie']);
    assert.deepEqual(ids(visibleArtifacts(list, { ...query, query: '/work/bra' })), ['Bravo']);
    assert.deepEqual(ids(visibleArtifacts(list, { ...query, query: 'landing', sessionTitle: (id) => (id === 's1' ? 'Landing page work' : '') })), ['alpha']);
  });

  it('reads ranges and counts', () => {
    assert.equal(inRange('not a date', 'today', NOW), false);
    assert.equal(inRange('not a date', 'any', NOW), true);
    assert.deepEqual([...countByType(list)], [['design', 2], ['other', 1]]);
  });
});

describe('words', () => {
  it('has every key in both languages', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
    for (const [key, text] of Object.entries(en)) assert.ok(text.length > 0, key);
  });

  it("falls back to English when the host has no words for a key, and fills placeholders", () => {
    const t = translator((key) => (key === 'panel' ? '作品' : key));
    assert.equal(t('panel'), '作品');
    assert.equal(t('search'), en.search);
    assert.equal(translator(undefined)('open.failed', { message: 'gone' }), en['open.failed'].replace('{message}', 'gone'));
  });

  it('includes the motion type labels and thumbnail recipe', () => {
    assert.ok(en['type.motion'] && zh['type.motion']);
    assert.ok(en['about.motion'] && zh['about.motion']);
    assert.match(captureRecipe('motion').find, /data-video-stage/);
  });
});
