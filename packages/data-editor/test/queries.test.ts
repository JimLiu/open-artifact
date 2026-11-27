import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BIGQUERY_POLL_TOOL,
  createAdaptiveLimiter,
  retryWhileBusy,
  type ExecutableQuery,
  type LoadResult,
  type McpToolResult,
  type PollClock,
  type ToolCaller,
} from '@open-artifact/data-core';
import { createMcpToolClient } from '../src/data/mcp.ts';
import {
  MIN_LOADER_CALL_INTERVAL_MS,
  createLoaderToolCaller,
  executeDatasetQuery,
  getQuerySourceRefusal,
  mcpErrorToLoadFailure,
  type QueryEnvironment,
} from '../src/data/queries.ts';
import { createToolResultCache } from '../src/data/tool-cache.ts';
import { getRetryWait, isFlakyLoad } from '../src/data/retry.ts';

class FakeClock implements PollClock {
  time = 0;
  readonly sleeps: number[] = [];
  now(): number {
    return this.time;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
  }
  random(): number {
    return 0.5;
  }
}

const text = (value: unknown): McpToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });

const plain = (rows: object[]): object[] => rows.map((row) => ({ ...row }));

function query(fields: Partial<ExecutableQuery> = {}): ExecutableQuery {
  return { kind: 'query', call: true, connector: 'sales', tool: 'run_sql', args: '{}', ...fields };
}

function environment(answer: (tool: string, args: Record<string, unknown>) => unknown, clock = new FakeClock()) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const client = createMcpToolClient({
    mcp: () => ({
      async callTool(_server, tool, args) {
        calls.push({ tool, args });
        const result = answer(tool, args);
        if (result instanceof Promise) return (await result) as never;
        if (typeof result === 'object' && result !== null && 'code' in result) throw result;
        return result as never;
      },
      async listTools() {
        return { servers: [] };
      },
    }),
  });
  const env: QueryEnvironment = { client, clock };
  return { env, calls, clock };
}

describe('connector errors', () => {
  const cases: [unknown, Partial<LoadResult>][] = [
    [{ code: 'needs_reauth', message: 'x' }, { kind: 'reauth' }],
    [{ code: 'server_not_connected', message: 'x' }, { kind: 'absent' }],
    [{ code: 'not_granted', message: 'x' }, { kind: 'declined', wording: { code: 'noLiveData' } }],
    [{ code: 'not_in_manifest', message: 'x' }, { kind: 'declined', off: true }],
    [{ code: 'approval_required', message: 'x' }, { kind: 'refused', wording: { code: 'orgApproval' } }],
    [{ code: 'response_too_large', message: 'x' }, { kind: 'refused' }],
    [{ code: 'selection_required', message: 'x' }, { kind: 'unchosen' }],
    [{ code: 'consent_required', message: 'x' }, { kind: 'connect' }],
    [{ code: 'capability_disabled', message: 'x' }, { kind: 'declined', wording: { code: 'noLiveData' } }],
    [{ code: 'rate_limited', message: 'Slow down' }, { kind: 'failed', message: 'Slow down', unanswered: true, crowded: true }],
    [{ code: 'server_unavailable', message: 'Down' }, { kind: 'failed', message: 'Down', unanswered: true }],
    [{ code: 'tool_error', message: 'Bad SQL' }, { kind: 'failed', message: 'Bad SQL' }],
  ];
  for (const [error, expected] of cases)
    it(`maps ${(error as { code: string }).code}`, () => {
      const failure = mcpErrorToLoadFailure('sales', error);
      assert.equal(failure.ok, false);
      for (const [key, value] of Object.entries(expected)) assert.deepEqual((failure as unknown as Record<string, unknown>)[key], value, key);
    });

  it('names the connector to fix', () => {
    assert.match(mcpErrorToLoadFailure('sales', { code: 'not_in_manifest', message: '' }).message, /sales is turned off/);
    assert.equal(mcpErrorToLoadFailure('sales', { code: 'not_granted', message: '' }).message, 'Live data isn’t available in this view.');
  });
});

describe('query refusals', () => {
  it('refuses a query with no connector', () => {
    assert.equal(getQuerySourceRefusal(query({ connector: '' })), 'This dataset names no connector.');
  });

  it('refuses the artifacts connector', () => {
    assert.ok(getQuerySourceRefusal(query({ connector: 'artifacts' })) !== null);
  });

  it('runs a plain call', () => {
    assert.equal(getQuerySourceRefusal(query()), null);
  });

  it('refuses before calling', async () => {
    const { env, calls } = environment(() => text([]));
    const result = await executeDatasetQuery(env, query({ connector: '' }));
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });
});

describe('executing queries', () => {
  it('reads rows from a text answer', async () => {
    const { env, calls } = environment(() => text([{ a: 1 }, { a: 2 }]));
    const result = await executeDatasetQuery(env, query({ args: '{"q":"select"}' }));
    assert.ok(result.ok);
    assert.deepEqual(plain(result.table.rows), [{ a: 1 }, { a: 2 }]);
    assert.deepEqual(calls, [{ tool: 'run_sql', args: { q: 'select' } }]);
  });

  it('quotes a tool error', async () => {
    const { env } = environment(() => ({ ...text('The warehouse is offline.'), isError: true }));
    const result = await executeDatasetQuery(env, query());
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message, 'The warehouse is offline.');
  });

  it('counts a first call that failed soon, or a retryable error asking a short wait, as likely passing', async () => {
    const soon = await executeDatasetQuery(environment(() => ({ code: 'internal', message: 'oops' })).env, query());
    assert.equal(isFlakyLoad(soon), true);
    const limited = mcpErrorToLoadFailure('sales', { code: 'rate_limited', message: 'slow down', retryable: true, retryAfterMs: 1000 });
    assert.equal(isFlakyLoad(limited), false);
    const later = mcpErrorToLoadFailure('sales', { code: 'upstream_error', message: 'later', retryable: true, retryAfterMs: 5000 });
    assert.equal(isFlakyLoad(later), true);
    assert.equal(getRetryWait(later), 5000);
    assert.equal(isFlakyLoad(mcpErrorToLoadFailure('sales', { code: 'upstream_error', message: 'much later', retryable: true, retryAfterMs: 60_000 })), false);
    assert.equal(isFlakyLoad(await executeDatasetQuery(environment(() => ({ code: 'needs_reauth', message: 'sign in' })).env, query())), false);
  });

  it('maps a rejected call', async () => {
    const { env } = environment(() => ({ code: 'needs_reauth', message: 'sign in' }));
    const result = await executeDatasetQuery(env, query());
    assert.equal(!result.ok && result.kind, 'reauth');
  });

  it('runs a loader over the answer', async () => {
    const { env } = environment(() => ({ content: [{ type: 'text', text: '{"n":1}' }, { type: 'text', text: '{"n":2}' }] }));
    const result = await executeDatasetQuery(env, query(), undefined, {
      fn: ({ items }) => (items as { n: number }[]).map((item) => ({ n: item.n * 10 })),
    });
    assert.ok(result.ok);
    assert.deepEqual(plain(result.table.rows), [{ n: 10 }, { n: 20 }]);
  });

  it('gives a loader read.sheet for a sheet\'s cells', async () => {
    const cells = { revision: 3, rows: { '1': ['Team', 'Score'], '2': ["'007", { formula: '=1+1', value: 2 }] } };
    const { env } = environment(() => text(cells));
    const result = await executeDatasetQuery(env, query(), undefined, { fn: ({ answer, read }) => read.sheet(answer) });
    assert.ok(result.ok);
    assert.deepEqual(result.table.columns, ['Team', 'Score']);
    assert.deepEqual(plain(result.table.rows), [{ Team: '007', Score: 2 }]);
  });

  it('lets a loader call more tools and fails with its error', async () => {
    const { env, calls } = environment((tool) => (tool === 'next_page' ? text([{ n: 2 }]) : text([{ n: 1 }])));
    const result = await executeDatasetQuery(env, query(), undefined, {
      fn: async ({ answer, call }) => [...(answer as unknown[]), ...((await call('next_page', { page: 2 })) as unknown[])],
    });
    assert.ok(result.ok);
    assert.deepEqual(plain(result.table.rows), [{ n: 1 }, { n: 2 }]);
    assert.deepEqual(
      calls.map((each) => each.tool),
      ['run_sql', 'next_page'],
    );
    const failing = await executeDatasetQuery(env, query(), undefined, {
      fn: () => {
        throw new Error('Loader broke');
      },
    });
    assert.equal(failing.ok, false);
    assert.match(!failing.ok ? failing.message : '', /Loader broke/);
  });

  it('polls a BigQuery job, 2 s first and doubling', async () => {
    let polls = 0;
    const done = {
      jobComplete: true,
      schema: { fields: [{ name: 'n', type: 'INTEGER' }] },
      rows: [{ f: [{ v: '7' }] }],
      totalRows: '1',
    };
    const { env, calls, clock } = environment((tool) => {
      if (tool === BIGQUERY_POLL_TOOL) return text(++polls < 4 ? { jobComplete: false, jobReference: { jobId: 'j1' } } : done);
      return text({ jobComplete: false, jobReference: { jobId: 'j1', location: 'US' } });
    });
    const result = await executeDatasetQuery(
      env,
      query({ call: undefined, connector: 'Google Cloud BigQuery', tool: 'execute_sql_readonly', args: '{"projectId":"p","query":"select 7 as n"}' }),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(plain(result.table.rows), [{ n: 7 }]);
    assert.equal(calls.filter((each) => each.tool === BIGQUERY_POLL_TOOL).length, 4);
    assert.deepEqual(calls[1].args, { projectId: 'p', jobId: 'j1', location: 'US', timeoutMs: 20000 });
    assert.deepEqual(clock.sleeps, [2000, 4000, 8000]);
  });

  it('gives up polling when the budget runs out', async () => {
    const { env } = environment((tool) =>
      text(tool === BIGQUERY_POLL_TOOL ? { jobComplete: false, jobReference: { jobId: 'j1' } } : { jobComplete: false, jobReference: { jobId: 'j1' } }),
    );
    const result = await executeDatasetQuery(
      { ...env, budgetMs: 30_000 },
      query({ call: undefined, connector: 'Google Cloud BigQuery', tool: 'execute_sql_readonly', args: '{"projectId":"p","query":"select 1"}' }),
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.timedOut, true);
  });

  it('uses a cached answer within the reuse window', async () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear(),
    } as Storage;
    let time = 1_000_000;
    const cache = createToolResultCache({ storage: () => fakeStorage, scope: 'q', now: () => time });
    let answered = 0;
    const client = createMcpToolClient({
      mcp: () => ({
        callTool: async () => (answered++, text([{ n: answered }])) as never,
        listTools: async () => ({ servers: [] }),
      }),
      cache,
    });
    const env: QueryEnvironment = { client, clock: new FakeClock() };
    const first = await executeDatasetQuery(env, query(), undefined, undefined, { reuse: { ms: 3_600_000, refresh: false } });
    assert.ok(first.ok);
    time += 60_000;
    const second = await executeDatasetQuery(env, query(), undefined, undefined, { reuse: { ms: 3_600_000, refresh: false } });
    assert.ok(second.ok);
    assert.equal(answered, 1);
    assert.equal(second.at, 1_000_000);
    const refreshed = await executeDatasetQuery(env, query(), undefined, undefined, { reuse: { ms: 3_600_000, refresh: true } });
    assert.ok(refreshed.ok);
    assert.equal(answered, 2);
  });
});

describe('loader calls', () => {
  it('spaces identical calls a second apart, one at a time', async () => {
    const clock = new FakeClock();
    const seen: [string, number][] = [];
    const caller: ToolCaller = {
      call: async (tool) => {
        seen.push([tool, clock.now()]);
        return text([{ ok: true }]);
      },
    };
    const call = createLoaderToolCaller(caller, () => false, clock);
    await Promise.all([call('a', { x: 1 }), call('a', { x: 1 }), call('b', { x: 1 })]);
    assert.deepEqual(seen, [
      ['a', 0],
      ['a', MIN_LOADER_CALL_INTERVAL_MS],
      ['b', MIN_LOADER_CALL_INTERVAL_MS],
    ]);
  });

  it('answers with items and throws a tool error', async () => {
    const clock = new FakeClock();
    const caller: ToolCaller = {
      call: async (tool) => (tool === 'bad' ? { ...text('nope'), isError: true } : { content: [{ type: 'text', text: '1' }, { type: 'text', text: '2' }] }),
    };
    const call = createLoaderToolCaller(caller, () => false, clock);
    assert.deepEqual(await call('list', {}, { items: true }), [1, 2]);
    await assert.rejects(call('bad'), /nope/);
  });

  it('stops once the query is stale', async () => {
    const caller: ToolCaller = { call: async () => text([]) };
    const call = createLoaderToolCaller(caller, () => true, new FakeClock());
    await assert.rejects(call('a'));
  });
});

describe('adaptive limiter', () => {
  it('starts at two, grows by one per success up to eight, and halves when busy', async () => {
    const clock = new FakeClock();
    const limiter = createAdaptiveLimiter(2, 8, clock);
    let admitted = 0;
    const take = () => limiter.acquire().then(() => void admitted++);
    for (let index = 0; index < 10; index++) void take();
    await Promise.resolve();
    assert.equal(admitted, 2);
    limiter.release('ok');
    await Promise.resolve();
    assert.equal(admitted, 4);
    for (let index = 0; index < 3; index++) limiter.release('ok');
    await Promise.resolve();
    assert.equal(admitted, 10);

    const busy = createAdaptiveLimiter(4, 8, clock);
    for (let index = 0; index < 4; index++) await busy.acquire();
    busy.release('busy');
    let late = false;
    void busy.acquire().then(() => (late = true));
    await Promise.resolve();
    assert.equal(late, false);
  });

  it('retries a busy answer once after a pause', async () => {
    const clock = new FakeClock();
    const limiter = createAdaptiveLimiter(2, 8, clock);
    await limiter.acquire();
    let runs = 0;
    const attempt = await retryWhileBusy(
      async () => ++runs,
      (value) => value === 1,
      () => false,
      limiter,
      clock,
    );
    assert.equal(runs, 2);
    assert.equal(attempt.result, 2);
    assert.ok(clock.sleeps.some((ms) => ms >= 6000));
  });
});
