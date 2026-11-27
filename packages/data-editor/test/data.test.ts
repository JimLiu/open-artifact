import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { Dataset, DatasetRun, LoadResult } from '@open-artifact/data-core';
import { isFlakyLoad } from '../src/data/retry.ts';
import { connectionFixAriaLabel, connectionFixLabel, connectorSetupRequest, getConnectionFixAction } from '../src/data/fixes.ts';
import { fetchDataFileText, loadDatasetFile, resolveStoredFileUrl } from '../src/data/files.ts';
import { sha256Hex } from '../src/data/hash.ts';
import { getDatasetLoadKey, getConnectionFix } from '../src/data/query-store.ts';
import {
  describeLoadFailure,
  formatTimeAgo,
  formatUpdatedAgo,
  getDashboardNotice,
  getDatasetStatus,
  getToolbarText,
} from '../src/data/status.ts';
import { TOOL_CACHE_MAX_AGE_MS, TOOL_CACHE_MIN_GC_MS, createToolResultCache, getToolCacheGcTime } from '../src/data/tool-cache.ts';

class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  quota = Infinity;
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    const used = [...this.items.values()].reduce((sum, text) => sum + text.length, 0);
    if (used + value.length > this.quota) throw new DOMException('Full', 'QuotaExceededError');
    this.items.set(key, value);
  }
}

const BLOB = '/_blob/0123456789abcdef0123456789abcdef';

function fakeFetch(files: Record<string, string | number>) {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, init });
    const body = files[url];
    if (body === undefined) return new Response('', { status: 404 });
    if (typeof body === 'number') throw new TypeError('network');
    return new Response(body);
  }) as typeof fetch;
  return { fetcher, asked };
}

const fileDataset = (fields: Partial<Dataset> = {}): Dataset => ({
  id: 'signups',
  title: 'Signups',
  description: '',
  source: { kind: 'file', url: BLOB, name: 'signups.csv', format: 'csv' },
  updated: { at: 0, by: 'Ada' },
  schedule: '',
  staleAfterHours: null,
  ...fields,
});

describe('sha256', () => {
  it('matches node’s hash for text and bytes', () => {
    for (const text of ['', 'abc', 'é€😀', 'x'.repeat(1000)])
      assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'));
    const bytes = new Uint8Array([0, 1, 2, 255]);
    assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'));
  });
});

describe('stored files', () => {
  it('resolves `_blob` paths against the page', () => {
    assert.equal(resolveStoredFileUrl(BLOB, 'https://example.test/a/b/index.html'), `https://example.test${BLOB}`);
    assert.equal(resolveStoredFileUrl(BLOB.slice(1), 'https://example.test/a/'), `https://example.test${BLOB}`);
    assert.equal(resolveStoredFileUrl(BLOB), BLOB);
    assert.equal(resolveStoredFileUrl('blob:https://example.test/x'), 'blob:https://example.test/x');
  });

  it('reads a CSV file into rows', async () => {
    const { fetcher, asked } = fakeFetch({ [`https://example.test${BLOB}`]: 'month,count\n2026-01,4\n2026-02,6\n' });
    const result = await loadDatasetFile(BLOB, 'csv', undefined, { fetch: fetcher, base: () => 'https://example.test/' });
    assert.ok(result.ok);
    assert.deepEqual(result.table.columns, ['month', 'count']);
    assert.equal(result.table.rows.length, 2);
    assert.equal(asked[0].init?.credentials, 'same-origin');
  });

  it('reads a JSON value and runs a loader over a file', async () => {
    const files = { [`https://example.test${BLOB}`]: '{"targets":[{"region":"North","goal":5}]}' };
    const { fetcher } = fakeFetch(files);
    const env = { fetch: fetcher, base: () => 'https://example.test/' };
    const loaded = await loadDatasetFile(BLOB, 'json', { fn: ({ answer }) => (answer as { targets: unknown[] }).targets }, env);
    assert.ok(loaded.ok);
    assert.deepEqual(loaded.table.rows.map((row) => ({ ...row })), [{ region: 'North', goal: 5 }]);
  });

  it('says why a file didn’t load', async () => {
    const { fetcher } = fakeFetch({ [`https://example.test${BLOB}`]: 0 });
    const env = { fetch: fetcher, base: () => 'https://example.test/' };
    const missing = await fetchDataFileText('/_blob/ffffffffffffffffffffffffffffffff', env);
    assert.deepEqual('ok' in missing && missing.wording, { code: 'fileStatus', status: '404' });
    const failed = await fetchDataFileText(BLOB, env);
    assert.equal('ok' in failed && failed.message, 'Couldn’t load the file.');
    const refused = await fetchDataFileText('https://elsewhere.test/data.csv', env);
    assert.equal('ok' in refused && refused.kind, 'refused');
  });

  it('counts a network failure or a server error as likely passing, and a missing file not', async () => {
    const { fetcher } = fakeFetch({ [`https://example.test${BLOB}`]: 0 });
    const env = { fetch: fetcher, base: () => 'https://example.test/' };
    assert.equal(isFlakyLoad((await fetchDataFileText(BLOB, env)) as LoadResult), true);
    assert.equal(isFlakyLoad((await fetchDataFileText('/_blob/ffffffffffffffffffffffffffffffff', env)) as LoadResult), false);
    for (const status of [429, 503]) {
      const busy = (async () => new Response('', { status })) as unknown as typeof fetch;
      assert.equal(isFlakyLoad((await fetchDataFileText(BLOB, { fetch: busy })) as LoadResult), true);
    }
  });

  it('asks again for a missing file while the page was shown only just now', async () => {
    let time = 0;
    let asked = 0;
    const fetcher = (async () => (++asked < 3 ? new Response('', { status: 404 }) : new Response('[{"n":1}]'))) as unknown as typeof fetch;
    const clock = { now: () => time, sleep: async (ms: number) => void (time += ms), random: () => 0 };
    const visibility = { shownAt: () => 0, hidden: () => false, whenShown: async () => undefined };
    const loaded = await loadDatasetFile(BLOB, 'json', undefined, { fetch: fetcher, clock, visibility });
    assert.ok(loaded.ok);
    assert.equal(asked, 3);
    asked = -100;
    time = 0;
    const late = await loadDatasetFile(BLOB, 'json', undefined, { fetch: fetcher, clock, visibility });
    assert.equal(!late.ok && late.message, 'Couldn’t load the file (404).');
    assert.equal(time, 26_000);
  });

  it('keys a file load on its url, format and loader', () => {
    assert.equal(getDatasetLoadKey(fileDataset()), `f|${BLOB}|csv`);
    assert.equal(getDatasetLoadKey(fileDataset({ loader: { description: '', fn: () => 1, code: 'x' } })), `f|${BLOB}|csv|x`);
  });
});

describe('tool answer cache', () => {
  const answer = { content: [{ type: 'text', text: '[{"n":1}]' }] };

  it('keeps answers for at least a day and at most a week', () => {
    assert.equal(getToolCacheGcTime(0), TOOL_CACHE_MIN_GC_MS);
    assert.equal(getToolCacheGcTime(3 * TOOL_CACHE_MIN_GC_MS), 3 * TOOL_CACHE_MIN_GC_MS);
    assert.equal(getToolCacheGcTime(30 * TOOL_CACHE_MIN_GC_MS), TOOL_CACHE_MAX_AGE_MS);
  });

  it('reads an answer back within its age, marked with when it was stored', () => {
    const storage = new MemoryStorage();
    let time = 1000;
    const cache = createToolResultCache({ storage: () => storage, scope: 'a', now: () => time });
    cache.write('sales', 'run', { q: 1 }, answer);
    time += 5000;
    const cached = cache.read('sales', 'run', { q: 1 }, 10_000);
    assert.equal(cached?.at, 1000);
    assert.deepEqual(cached?.result.cache, { storedAt: 1000 });
    assert.deepEqual(cached?.result.content, answer.content);
    assert.equal(cache.read('sales', 'run', { q: 1 }, 1000), null);
    assert.equal(cache.read('sales', 'run', { q: 2 }, 10_000), null);
    const other = createToolResultCache({ storage: () => storage, scope: 'b', now: () => time });
    assert.equal(other.read('sales', 'run', { q: 1 }, 10_000), null);
  });

  it('doesn’t keep tool errors, and survives storage that throws', () => {
    const storage = new MemoryStorage();
    const cache = createToolResultCache({ storage: () => storage, now: () => 1 });
    cache.write('sales', 'run', {}, { ...answer, isError: true });
    assert.equal(storage.length, 0);
    const broken = createToolResultCache({
      storage: () => {
        throw new Error('blocked');
      },
    });
    broken.write('sales', 'run', {}, answer);
    assert.equal(broken.read('sales', 'run', {}, 1000), null);
  });

  it('drops old answers when storage is full', () => {
    const storage = new MemoryStorage();
    let time = 1;
    const cache = createToolResultCache({ storage: () => storage, now: () => time });
    cache.write('sales', 'run', { q: 1 }, answer);
    storage.quota = [...storage.items.values()][0].length + 10;
    time = 2;
    cache.write('sales', 'run', { q: 2 }, answer);
    assert.equal(cache.read('sales', 'run', { q: 2 }, 1000)?.at, 2);
    assert.equal(cache.read('sales', 'run', { q: 1 }, 1000), null);
  });
});

describe('statuses and words', () => {
  const NOW = 10 * 86_400_000;

  it('formats the toolbar text', () => {
    assert.equal(getToolbarText({ loading: 'first', loadingNow: 1, updatedAt: null, now: NOW }), 'Loading 1 source');
    assert.equal(getToolbarText({ loading: 'first', loadingNow: 3, updatedAt: null, now: NOW }), 'Loading 3 sources');
    assert.equal(getToolbarText({ loading: 'again', loadingNow: 1, updatedAt: NOW, now: NOW }), 'Refreshing…');
    assert.equal(getToolbarText({ loading: null, loadingNow: 0, updatedAt: NOW - 1000, now: NOW }), 'Updated now');
    assert.equal(getToolbarText({ loading: null, loadingNow: 0, updatedAt: NOW - 5 * 60_000, now: NOW }), 'Updated 5 mins ago');
    assert.equal(formatUpdatedAgo(NOW - 3 * 3_600_000, NOW), 'Updated 3 hours ago');
    assert.equal(getToolbarText({ loading: null, loadingNow: 0, updatedAt: null, now: NOW }), null);
    assert.equal(formatTimeAgo(NOW - 2 * 86_400_000, NOW), '2d ago');
    assert.equal(formatTimeAgo(NOW - 30_000, NOW, true), 'just now');
  });

  it('describes a source’s status', () => {
    const ok: DatasetRun = { status: 'ok', at: NOW, table: { columns: ['n'], rows: [{ n: 1 }], cut: 'rows' } };
    assert.equal(getDatasetStatus(fileDataset({ updated: null }), { ...ok, table: { columns: [], rows: [] } }, NOW).status, 'Update time not recorded');
    assert.equal(getDatasetStatus(fileDataset({ updated: null }), ok, NOW).status, 'Update time not recorded, first 1 row only');
    const stale = getDatasetStatus(fileDataset({ staleAfterHours: 1 }), { status: 'idle' }, NOW);
    assert.equal(stale.tone, 'busy');
    const cut = getDatasetStatus(fileDataset({ updated: { at: NOW, by: 'Ada' } }), ok, NOW);
    assert.equal(cut.tone, 'warn');
    assert.match(cut.status, /1 row/i);
  });

  it('words failures and notices without a brand', () => {
    assert.match(describeLoadFailure({ message: '', wording: { code: 'turnedOff', connector: 'sales' } }), /sales/);
    const query: Dataset = {
      ...fileDataset({ id: 'orders' }),
      source: { kind: 'query', call: true, connector: 'sales', tool: 'run', args: '{}' },
    };
    const run: DatasetRun = { status: 'absent', at: NOW, message: 'sales isn’t connected.' };
    const notice = getDashboardNotice([query], () => run);
    assert.ok(notice !== null);
    assert.deepEqual(notice.fix, { connector: 'sales', fix: getConnectionFix(run) });
  });

  it('counts the sources that didn’t load and lists them', () => {
    const orders: Dataset = { ...fileDataset({ id: 'orders' }), source: { kind: 'query', call: true, connector: 'sales', tool: 'run', args: '{}' } };
    const prices: Dataset = fileDataset({ id: 'prices' });
    const run: DatasetRun = { status: 'failed', at: NOW, message: 'It broke.' };
    const one = getDashboardNotice([orders], () => run);
    assert.equal(one?.text, '1 source didn’t load.');
    assert.deepEqual(one?.failed?.map((ds) => ds.id), ['orders']);
    assert.deepEqual(one?.ask?.map((ds) => ds.id), ['orders']);
    const two = getDashboardNotice([orders, prices], () => run);
    assert.equal(two?.text, '2 sources didn’t load.');
    assert.deepEqual(two?.failed?.map((ds) => ds.id), ['orders', 'prices']);
  });

  it('says it is retrying ahead of anything else in the toolbar', () => {
    assert.equal(getToolbarText({ loading: 'again', loadingNow: 1, updatedAt: NOW, now: NOW, retrying: 1 }), '1 source didn’t load. Retrying…');
    assert.equal(getToolbarText({ loading: null, loadingNow: 0, updatedAt: NOW, now: NOW, retrying: 3 }), '3 sources didn’t load. Retrying…');
    assert.equal(getToolbarText({ loading: null, loadingNow: 0, updatedAt: null, now: NOW, retrying: 0 }), null);
  });
});

describe('connection fixes', () => {
  it('asks the agent to set up a missing or signed-out connector', () => {
    assert.equal(getConnectionFixAction('add', true), 'agent');
    assert.equal(getConnectionFixAction('reconnect', true), 'agent');
    assert.equal(getConnectionFixAction('add', false), 'retry');
    assert.equal(getConnectionFixAction('allow', true), 'retry');
    assert.equal(connectionFixLabel('reconnect', true), 'Reconnect');
    assert.equal(connectionFixLabel('add', false), 'Try again');
    assert.equal(connectionFixAriaLabel('add', 'sales', true), 'Connect sales');
    const request = connectorSetupRequest('sales', 'reconnect');
    assert.equal(request.title, 'Reconnect sales');
    assert.deepEqual(request.context, { connector: 'sales', fix: 'reconnect' });
    assert.match(request.text, /I’ll add the server and its credentials myself/);
  });
});
