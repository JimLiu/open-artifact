import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Dataset, LoadResult, PollClock } from '@open-artifact/data-core';
import { createLiveDatasetStore } from '../src/data/query-store.ts';
import { markFlaky } from '../src/data/retry.ts';

/** A clock whose sleeps wait until the test lets them go. */
class HeldClock implements PollClock {
  time = 0;
  readonly sleeps: { ms: number; go: () => void }[] = [];
  now(): number {
    return this.time;
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.sleeps.push({ ms, go: resolve }));
  }
  random(): number {
    return 0;
  }
  /** Lets the oldest sleep go, after moving the time on by its length. */
  async next(): Promise<number> {
    const sleep = this.sleeps.shift();
    assert.ok(sleep !== undefined, 'nothing is waiting');
    this.time += sleep.ms;
    sleep.go();
    await flush();
    return sleep.ms;
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const orders: Dataset = {
  id: 'orders',
  title: 'Orders',
  description: '',
  source: { kind: 'query', call: true, connector: 'sales', tool: 'run', args: '{}' },
  staleAfterHours: null,
  updated: null,
} as unknown as Dataset;

const ok: LoadResult = { ok: true, table: { columns: ['n'], rows: [{ n: 1 }] }, ms: 1 } as LoadResult;
const flaky = (message = 'It broke.'): LoadResult => markFlaky({ ok: false, kind: 'failed', message });

function storeWith(answers: LoadResult[], working = false) {
  const clock = new HeldClock();
  let calls = 0;
  let aside = false;
  const store = createLiveDatasetStore({
    load: async () => answers[Math.min(calls++, answers.length - 1)] as LoadResult,
    clock,
    now: () => clock.time,
    isAgentWorking: () => working,
    aside: () => aside,
  });
  return {
    store,
    clock,
    calls: () => calls,
    setAside(value: boolean) {
      aside = value;
    },
  };
}

describe('live store retries', () => {
  it('tries a flaky failure again after about 6 s while it counts as retrying', async () => {
    const { store, clock, calls } = storeWith([flaky(), ok]);
    store.sync([orders]);
    await flush();
    assert.equal(store.retrying('orders'), true);
    assert.equal(store.get('orders').status, 'running');
    assert.equal(await clock.next(), 6000);
    await store.settled();
    assert.equal(calls(), 2);
    assert.equal(store.get('orders').status, 'ok');
    assert.equal(store.retrying('orders'), false);
  });

  it('shows a second flaky failure while it tries once more quietly, and keeps it when that fails alike', async () => {
    const { store, clock, calls } = storeWith([flaky(), flaky(), flaky()]);
    store.sync([orders]);
    await flush();
    await clock.next();
    const shown = store.get('orders');
    assert.equal(shown.status, 'failed');
    assert.equal(store.retrying('orders'), true);
    assert.equal(await clock.next(), 12000);
    await store.settled();
    assert.equal(calls(), 3);
    assert.equal(store.get('orders'), shown);
    assert.equal(store.retrying('orders'), false);
  });

  it('runs at once when asked during a quiet retry', async () => {
    const { store, clock, calls } = storeWith([flaky(), flaky(), ok]);
    store.sync([orders]);
    await flush();
    await clock.next();
    assert.equal(store.get('orders').status, 'failed');
    void store.run(orders);
    assert.equal(store.get('orders').status, 'running');
    await flush();
    assert.equal(store.get('orders').status, 'ok');
    assert.equal(calls(), 3);
    await clock.next();
    assert.equal(calls(), 3);
  });

  it('doesn’t try a flaky failure again while the agent works', async () => {
    const { store, calls } = storeWith([flaky(), ok], true);
    store.sync([orders]);
    await store.settled();
    assert.equal(calls(), 1);
    assert.equal(store.get('orders').status, 'failed');
    assert.equal(store.retrying('orders'), false);
  });

  it('waits as long as the failure asked when that is longer', async () => {
    const { store, clock } = storeWith([markFlaky({ ok: false, kind: 'failed', message: 'Later.' }, 9000), ok]);
    store.sync([orders]);
    await flush();
    assert.equal(await clock.next(), 9000);
    await store.settled();
    assert.equal(store.get('orders').status, 'ok');
  });

  it('loads again on sync a source that failed before its connector was last retried', async () => {
    const failed: LoadResult = { ok: false, kind: 'failed', message: 'No.' };
    const { store, clock, calls } = storeWith([failed, ok]);
    store.sync([orders]);
    await store.settled();
    store.sync([]);
    clock.time = 1000;
    store.retry('sales');
    await store.settled();
    assert.equal(calls(), 1);
    store.sync([orders]);
    await store.settled();
    assert.equal(calls(), 2);
    assert.equal(store.get('orders').status, 'ok');
  });

  it('retries every failed source that can be tried again, files included', async () => {
    const file = { ...orders, id: 'prices', source: { kind: 'file', url: '/_blob/abc', format: 'csv' } } as unknown as Dataset;
    const failed: LoadResult = { ok: false, kind: 'failed', message: 'No.' };
    const { store, calls } = storeWith([failed, failed, ok]);
    store.sync([orders, file]);
    await store.settled();
    assert.equal(store.get('prices').status, 'failed');
    store.retryFailed();
    await store.settled();
    assert.equal(calls(), 4);
  });

  it('shows a version’s kept result again at once, keeping the live one however many others load', async () => {
    const { store, calls, setAside } = storeWith([ok]);
    const version = (sql: string): Dataset => ({ ...orders, source: { ...orders.source, args: JSON.stringify({ sql }) } }) as Dataset;
    store.sync([orders]);
    await store.settled();
    assert.equal(calls(), 1);
    setAside(true);
    for (const sql of ['a', 'b', 'c']) {
      store.sync([version(sql)]);
      await store.settled();
    }
    assert.equal(calls(), 4);
    store.sync([orders]);
    assert.equal(store.get('orders').status, 'ok');
    store.sync([version('c')]);
    assert.equal(store.get('orders').status, 'ok');
    store.sync([version('a')]);
    assert.equal(store.get('orders').status, 'running');
    await store.settled();
    assert.equal(calls(), 5);
  });
});

describe('live store while the page is hidden', () => {
  it('holds a failure’s retry until the page is shown again', async () => {
    const clock = new HeldClock();
    let calls = 0;
    let show: () => void = () => undefined;
    let hidden = true;
    const store = createLiveDatasetStore({
      load: async () => (calls++ === 0 ? flaky() : ok),
      clock,
      now: () => clock.time,
      whenShown: () => (hidden ? new Promise<void>((resolve) => (show = resolve)) : Promise.resolve()),
    });
    store.sync([orders]);
    await flush();
    await clock.next();
    await flush();
    assert.equal(calls, 1);
    hidden = false;
    show();
    await store.settled();
    assert.equal(calls, 2);
    assert.equal(store.get('orders').status, 'ok');
  });
});

describe('live store loaders', () => {
  it('knows the loader code the current run loads with', async () => {
    const { store } = storeWith([ok]);
    assert.equal(store.loaderOf('orders'), undefined);
    store.sync([orders]);
    assert.equal(store.loaderOf('orders'), null);
    await store.settled();
    const loaded = { ...orders, loader: { code: 'rows => rows', fn: (rows: unknown) => rows } } as unknown as Dataset;
    store.sync([loaded]);
    assert.equal(store.loaderOf('orders'), 'rows => rows');
    await store.settled();
  });
});
