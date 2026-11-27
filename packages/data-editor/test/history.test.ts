import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NO_HISTORY_BEFORE_MESSAGE,
  datasetTitleOf,
  describeDataVersion,
  describeVersionDiffChange,
  describeVersionRowLabel,
  formatVersionDate,
  formatVersionDay,
  formatVersionTime,
  hadPageBefore,
  listVersionChanges,
  restoreEarlierDescription,
  restoreVersionLabel,
  storePathOf,
  versionByline,
  versionChangeName,
  versionDayLabel,
  versionDiffSides,
  versionWho,
  type DescribedVersion,
  type VersionAuthor,
} from '../src/history/describe.ts';

const person: VersionAuthor = { kind: 'person', id: 'u1', name: 'Ann' };
const agent: VersionAuthor = { kind: 'agent', id: 'agent', name: 'Agent' };
const system: VersionAuthor = { kind: 'system', id: 'system', name: '' };

type Op = 'added' | 'edited' | 'deleted';

function version(files: [string, Op][], extra: Partial<DescribedVersion> = {}): DescribedVersion {
  return { n: 5, at: new Date(2026, 10, 17, 14, 5).toISOString(), author: person, files: files.map(([path, op]) => ({ path, op })), ...extra };
}

const NOW = new Date(2026, 10, 17, 18, 0).getTime();

describe('version descriptions', () => {
  it('says the page was created when it had none before', () => {
    assert.equal(describeDataVersion(version([['db/files/index.html', 'added']]), { pageBefore: false, now: NOW }), 'Created the page');
    assert.equal(describeDataVersion(version([['db/files/index.html', 'added']]), { now: NOW }), 'Created the page');
    assert.equal(describeDataVersion(version([['db/files/index.html', 'edited']]), { pageBefore: true, now: NOW }), 'Edited the page');
  });

  it('names one source added, removed or edited', () => {
    const titles = { 'datasets/sales': 'Sales by month' };
    assert.equal(describeDataVersion(version([['db/datasets/sales', 'added']]), { titles, now: NOW }), 'Added Sales by month');
    assert.equal(describeDataVersion(version([['db/datasets/sales', 'deleted']]), { titles, now: NOW }), 'Removed Sales by month');
    assert.equal(describeDataVersion(version([['db/datasets/sales', 'edited']]), { now: NOW }), 'Edited sales');
  });

  it('counts several sources and lists several kinds of change', () => {
    assert.equal(describeDataVersion(version([['db/datasets/a', 'edited'], ['db/datasets/b', 'edited']]), { now: NOW }), 'Edited 2 sources');
    assert.equal(describeDataVersion(version([['db/dash/params', 'edited']]), { now: NOW }), 'Edited the filters');
    assert.equal(describeDataVersion(version([['db/dash/meta', 'edited']]), { now: NOW }), 'Edited the title');
    assert.equal(
      describeDataVersion(version([['db/files/index.html', 'edited'], ['db/datasets/a', 'edited'], ['db/dash/params', 'edited']]), { pageBefore: true, titles: { 'datasets/a': 'Orders' }, now: NOW }),
      'Edited the page, Orders, and the filters',
    );
    assert.equal(describeDataVersion(version([['db/dash/look', 'edited']]), { now: NOW }), 'Edited the look');
    assert.equal(describeDataVersion(version([['project/notes.md', 'edited']]), { now: NOW }), 'Edited the artifact');
  });

  it('describes a restore by the restored version’s time or date', () => {
    const restore = version([['db/files/index.html', 'edited']], { restoredFrom: 2 });
    const sameDay = new Date(2026, 10, 17, 9, 30).getTime();
    assert.equal(describeDataVersion(restore, { restoredAt: sameDay, now: NOW }), `Restored the ${formatVersionTime(sameDay)} version`);
    const earlier = new Date(2026, 10, 3, 9, 30).getTime();
    assert.equal(describeDataVersion(restore, { restoredAt: earlier, now: NOW }), `Restored the ${formatVersionDate(earlier, NOW)} version`);
    assert.equal(describeDataVersion(restore, { now: NOW }), 'Restored version 2');
  });

  it('has nothing before the oldest version the system made', () => {
    assert.equal(describeDataVersion(version([['db/files/index.html', 'added']], { author: system }), { oldest: true, now: NOW }), NO_HISTORY_BEFORE_MESSAGE);
  });
});

describe('version changes', () => {
  it('lists dashboard documents, page files last', () => {
    assert.deepEqual(
      listVersionChanges(version([['db/files/index.html', 'edited'], ['db/datasets/b', 'deleted'], ['db/dash/meta', 'added'], ['db/drafts/x', 'added'], ['project/a', 'added']])),
      [
        { path: 'dash/meta', kind: 'added' },
        { path: 'datasets/b', kind: 'removed' },
        { path: 'files/index.html', kind: 'edited' },
      ],
    );
  });

  it('names each change', () => {
    assert.equal(versionChangeName({ path: 'files/index.html', kind: 'edited' }), 'index.html');
    assert.equal(versionChangeName({ path: 'datasets/a', kind: 'edited' }, { 'datasets/a': 'Orders' }), 'Orders');
    assert.equal(versionChangeName({ path: 'datasets/a', kind: 'edited' }), 'a');
    assert.equal(versionChangeName({ path: 'dash/meta', kind: 'edited' }), 'Title');
    assert.equal(versionChangeName({ path: 'dash/params', kind: 'edited' }), 'Filters');
  });

  it('works out whether a page was there before', () => {
    const created = version([['db/files/index.html', 'added']]);
    assert.equal(hadPageBefore(created, ['db/files/index.html', 'db/dash/meta']), false);
    assert.equal(hadPageBefore(version([['db/files/index.html', 'edited']]), ['db/files/index.html']), true);
    assert.equal(hadPageBefore(version([['db/files/old.html', 'deleted']]), []), true);
    assert.equal(storePathOf('db/datasets/a'), 'datasets/a');
    assert.equal(storePathOf('project/a'), null);
  });

  it('compares page text, a query’s one changed argument, or sorted JSON without the edit stamp', () => {
    assert.deepEqual(versionDiffSides('files/index.html', JSON.stringify({ text: 'a' }), JSON.stringify({ text: 'b' })), ['a', 'b']);
    assert.deepEqual(versionDiffSides('files/index.html', null, JSON.stringify({ text: 'b' })), ['', 'b']);
    const query = (sql: string, at: number) => JSON.stringify({ source: { connector: 'db', tool: 'q', args: { sql, limit: 5 } }, edit: { by: 'u', byAt: at } });
    assert.deepEqual(versionDiffSides('datasets/a', query('select 1', 1), query('select 2', 2)), ['select 1', 'select 2']);
    const [was, now] = versionDiffSides('datasets/a', query('select 1', 1), query('select 1', 2));
    assert.equal(was, now);
    assert.equal(was.includes('edit'), false);
    const [left, right] = versionDiffSides('dash/meta', JSON.stringify({ title: 'A', lang: 'en' }), JSON.stringify({ lang: 'en', title: 'B' }));
    assert.equal(left, '{\n  "lang": "en",\n  "title": "A"\n}');
    assert.equal(right, '{\n  "lang": "en",\n  "title": "B"\n}');
    assert.equal(datasetTitleOf(JSON.stringify({ title: ' Orders ' })), 'Orders');
    assert.equal(datasetTitleOf('not json'), '');
  });

  it('says a folded diff aloud', () => {
    assert.equal(describeVersionDiffChange('index.html', 'edited', { added: 3, removed: 1 }), 'index.html: edited, 3 lines added, 1 line removed');
    assert.equal(describeVersionDiffChange('index.html', 'added', { added: 0, removed: 0 }), 'index.html: added');
    assert.equal(describeVersionDiffChange('index.html', 'removed', null), 'index.html: removed');
  });
});

describe('version authors and times', () => {
  it('names who made a version', () => {
    assert.equal(versionWho(agent), 'Agent');
    assert.equal(versionWho(person), 'Ann');
    assert.equal(versionWho({ ...person, name: '' }), 'Someone');
    assert.equal(versionWho(person, { withAgent: true }), 'Ann + Agent');
    assert.equal(versionWho(system), '');
    assert.equal(versionByline('Ann', 'Edited the page'), 'Ann · Edited the page');
    assert.equal(versionByline('', 'Edited the page'), 'Edited the page');
  });

  it('words the list row’s Restore and its question', () => {
    assert.equal(restoreVersionLabel('Today at 2:05 PM'), 'Restore the version from Today at 2:05 PM');
    assert.equal(restoreEarlierDescription('Yesterday at 9:30 AM'), 'Yesterday at 9:30 AM. Everyone will see it.');
  });

  it('labels rows', () => {
    assert.equal(describeVersionRowLabel('Today at 2:05 PM', true, 'Ann'), 'Today at 2:05 PM, current version, Ann');
    assert.equal(describeVersionRowLabel('Today at 2:05 PM', false, 'Ann'), 'Today at 2:05 PM, Ann');
    assert.equal(describeVersionRowLabel('Today at 2:05 PM', true, ''), 'Today at 2:05 PM, current version');
    assert.equal(describeVersionRowLabel('Today at 2:05 PM', false, ''), 'Today at 2:05 PM');
  });

  it('names the day', () => {
    const at = (day: number) => new Date(2026, 10, day, 14, 5).getTime();
    assert.equal(versionDayLabel(at(17), NOW), 'Today');
    assert.equal(versionDayLabel(at(16), NOW), 'Yesterday');
    assert.equal(versionDayLabel(at(14), NOW), new Date(at(14)).toLocaleDateString(undefined, { weekday: 'long' }));
    assert.equal(versionDayLabel(at(3), NOW), new Date(at(3)).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }));
    const lastYear = new Date(2025, 10, 3, 14, 5).getTime();
    assert.equal(versionDayLabel(lastYear, NOW), new Date(lastYear).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    assert.equal(formatVersionDay(at(17), NOW), `Today at ${formatVersionTime(at(17))}`);
  });
});
