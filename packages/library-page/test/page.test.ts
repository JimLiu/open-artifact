/**
 * The page's pure parts: the list's filters, the words, and how a type's thumbnail is taken.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countByType, inRange, isFiltered, NO_FILTERS, NO_PROJECT, projectChoices, projectName, visibleArtifacts } from '../src/filters.ts';
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

  it('narrows by project, wherever the folders are, and searches the project too', () => {
    const shop = '/code/shop';
    const byProject = [
      item('Plan', { project: shop, root: '/home/me/OpenArtifact/shop/plan' }),
      item('Board', { project: shop, root: `${shop}/artifacts/board`, openedAt: '2026-11-14T09:00:00.000Z' }),
      item('Deck', { project: '/code/site', root: '/home/me/OpenArtifact/site/deck', openedAt: '2026-11-14T08:00:00.000Z' }),
      item('Note', { openedAt: '2026-11-14T07:00:00.000Z' }),
      item('Old', { project: '', openedAt: '2026-11-14T06:00:00.000Z' }),
    ];
    const pick = (projects: string[]) => ids(visibleArtifacts(byProject, { ...query, filters: { ...NO_FILTERS, projects } }));
    assert.deepEqual(pick([shop]), ['Plan', 'Board']);
    assert.deepEqual(pick([shop, '/code/site']), ['Plan', 'Board', 'Deck']);
    assert.deepEqual(pick([NO_PROJECT]), ['Note', 'Old']);
    assert.deepEqual(pick([]), ['Plan', 'Board', 'Deck', 'Note', 'Old']);
    assert.deepEqual(ids(visibleArtifacts(byProject, { ...query, query: 'code/SITE' })), ['Deck']);
    assert.equal(isFiltered({ ...NO_FILTERS, projects: [shop] }), true);
  });

  it('lists the projects to choose from, by name, telling two of one name apart, with the artifacts of none last', () => {
    assert.equal(projectName('/code/shop'), 'shop');
    assert.equal(projectName('C:\\code\\shop\\'), 'shop');
    const list = [
      item('a', { project: '/code/shop' }),
      item('b', { project: '/code/shop' }),
      item('c', { project: '/work/app' }),
      item('d', { project: '/play/app' }),
      item('e'),
    ];
    assert.deepEqual(projectChoices(list, 'en'), [
      { project: '/play/app', label: 'app (play)', count: 1 },
      { project: '/work/app', label: 'app (work)', count: 1 },
      { project: '/code/shop', label: 'shop', count: 2 },
      { project: NO_PROJECT, label: '', count: 1 },
    ]);
    // Nothing to choose between when no artifact has a project.
    assert.deepEqual(projectChoices([item('x'), item('y', { project: '' })], 'en'), []);
    assert.deepEqual(projectChoices([item('x', { project: '/code/shop' })], 'en'), [{ project: '/code/shop', label: 'shop', count: 1 }]);
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
