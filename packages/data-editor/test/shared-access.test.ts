import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { parseConnectorShareMarks, parseDashboardContent, prepareDashboardContent, type DashboardContent } from '@open-artifact/data-core';
import type { McpCapability } from '@open-artifact/runtime';
import type { DataSharedResponse, SharedCallAnswer, SharedCallRequest } from '@open-artifact/runtime/http-api';
import { createDataEngine } from '../src/data/engine.ts';
import type { McpToolClient } from '../src/data/mcp.ts';
import {
  SHARED_RESULTS_UPDATING_MESSAGE,
  collectSharedCalls,
  describeUnsharedQueries,
  dropRunBeforeShare,
  findSourceCall,
  isSharedCallError,
  resetSharedAccess,
  sharedCallKey,
  sharedErrorToLoadFailure,
  useSharedAccess,
  withSharedAccess,
  type SharedAccessTransport,
} from '../src/data/shared-access.ts';
import { describeSharingLine, isRunAsBusy, runAsShortLabel, runAsTriggerLabel, shortPersonName, track, useRunAsBusy, waitForDocumentEcho } from '../src/sources/run-as.ts';
import { useDocument } from '../src/state/document.ts';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
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
    this.items.set(key, value);
  }
}

const rows = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

function content(datasets: Record<string, unknown>, extra: Record<string, unknown> = {}): DashboardContent {
  return parseDashboardContent({ meta: { title: 'Test' }, params: {}, settings: {}, datasets, files: {}, ...extra });
}

const byRegion = { title: 'By region', source: { kind: 'call', connector: 'sales', tool: 'run', args: { region: '{{region}}' }, rules: { region: { enum: ['North', 'South'] } } } };
const totals = { title: 'Totals', source: { kind: 'call', connector: 'sales', tool: 'totals', args: { q: 'all' } } };
const crm = { title: 'Leads', source: { kind: 'call', connector: 'crm', tool: 'leads', args: {} } };
const mark = { id: 'owner', name: 'Ada Lovelace', at: 1_000 };

/** A transport whose runs answer with `answer`, recording every batch. */
function fakeTransport(answer: (call: SharedCallRequest) => SharedCallAnswer, keys: string[] = []): SharedAccessTransport & { batches: SharedCallRequest[][]; refreshes: boolean[] } {
  const batches: SharedCallRequest[][] = [];
  const refreshes: boolean[] = [];
  return {
    batches,
    refreshes,
    shares: async () => ({ shares: [{ connector: 'sales', sharer: { id: 'owner', name: 'Ada' }, at: 1, keys }] }),
    share: async (connector, calls) => ({ connector, holder: calls.length === 0 ? null : { sharer: { id: 'owner', name: 'Ada' }, at: 1 }, count: calls.length }),
    run: async (calls, options): Promise<DataSharedResponse> => {
      batches.push(calls);
      refreshes.push(options.refresh);
      return { answers: calls.map(answer) };
    },
  };
}

const ownClient = (said: string[]): McpToolClient =>
  ({
    call: async (connector: string, tool: string) => {
      said.push(`${connector}.${tool}`);
      return rows([{ own: true }]);
    },
    watch: () => () => undefined,
    listServers: async () => null,
    listTools: async () => [],
  }) as unknown as McpToolClient;

beforeEach(() => resetSharedAccess());

describe('shared source calls', () => {
  it('collects each distinct call on a connector with its blanks and rules, and finds a source by its filled call', () => {
    const prepared = prepareDashboardContent(content({ a: byRegion, b: byRegion, c: totals, d: crm }, { params: { region: 'North' } })).datasets;
    const calls = collectSharedCalls('sales', prepared);
    assert.deepEqual(
      calls.map((call) => [call.tool, call.args]),
      [
        ['run', { region: '{{region}}' }],
        ['totals', { q: 'all' }],
      ],
    );
    assert.deepEqual(calls[0]?.rules, { region: { enum: ['North', 'South'] } });
    const found = findSourceCall(prepared, 'sales', 'run', { region: 'North' });
    assert.deepEqual(found?.params, { region: 'North' });
    assert.equal(found === null ? '' : sharedCallKey(found), sharedCallKey({ ...calls[0]! }));
    // A loader's further call is no source's.
    assert.equal(findSourceCall(prepared, 'sales', 'run', { region: 'East' }), null);
  });

  it('reads only well-formed share marks from the settings', () => {
    assert.deepEqual(parseConnectorShareMarks({ sales: { id: 'owner', name: 'Ada', at: 5 }, crm: { id: '', at: 5 }, x: 'no' }), { sales: { id: 'owner', name: 'Ada', at: 5 } });
    assert.equal(parseConnectorShareMarks(undefined), null);
    assert.deepEqual(content({}, { settings: { shared: { sales: mark } } }).shared, { sales: mark });
  });
});

describe('withSharedAccess', () => {
  const prepared = prepareDashboardContent(content({ a: byRegion, c: totals }, { params: { region: 'North' } })).datasets;
  const options = (transport: SharedAccessTransport, sharer = false) => ({
    transport,
    isSharer: () => sharer,
    markOf: (connector: string) => (connector === 'sales' ? mark : undefined),
    resolve: (connector: string, tool: string, args: Record<string, unknown>) => findSourceCall(prepared, connector, tool, args),
    reuseMs: () => 0,
  });

  it('runs a guest’s source calls as the sharer in one request, and the rest as before', async () => {
    const said: string[] = [];
    const transport = fakeTransport(() => ({ ok: true, result: rows([{ shared: true }]), ranAt: 42, sharer: { id: 'owner', name: 'Ada' }, at: 1 }));
    const client = withSharedAccess(ownClient(said), options(transport));
    const [one, two, other] = await Promise.all([
      client.call('sales', 'run', { region: 'North' }),
      client.call('sales', 'totals', { q: 'all' }, { cache: { staleTime: 0, gcTime: 0, refresh: true } }),
      client.call('crm', 'leads', {}),
    ]);
    assert.equal(transport.batches.length, 1);
    assert.deepEqual(transport.batches[0]?.map((call) => call.tool), ['run', 'totals']);
    assert.deepEqual(transport.refreshes, [true]);
    assert.equal(one.cache?.storedAt, 42);
    assert.deepEqual(two.content, rows([{ shared: true }]).content);
    assert.deepEqual(other.content, rows([{ own: true }]).content);
    assert.deepEqual(said, ['crm.leads']);
  });

  it('falls back to the page’s own access where nothing is shared or the server can’t share, and fails otherwise', async () => {
    const said: string[] = [];
    let code: SharedCallAnswer = { ok: false, code: 'not_shared' };
    const transport = fakeTransport(() => code);
    const client = withSharedAccess(ownClient(said), options(transport));
    await client.call('sales', 'totals', { q: 'all' });
    assert.deepEqual(said, ['sales.totals']);
    code = { ok: false, code: 'not_approved', sharer: { id: 'owner', name: 'Ada' } };
    const error = await client.call('sales', 'totals', { q: 'all' }).then(
      () => null,
      (reason: unknown) => reason,
    );
    assert.ok(isSharedCallError(error));
    assert.deepEqual(sharedErrorToLoadFailure(error), { ok: false, kind: 'declined', message: SHARED_RESULTS_UPDATING_MESSAGE });
    const broken = withSharedAccess(ownClient(said), options({ ...transport, run: async () => Promise.reject(new Error('404')) }));
    await broken.call('sales', 'totals', { q: 'all' });
    assert.deepEqual(said, ['sales.totals', 'sales.totals']);
  });

  it('on the sharer’s page, holds back a source call the share doesn’t have yet', async () => {
    const said: string[] = [];
    const approved = collectSharedCalls('sales', prepared).find((call) => call.tool === 'totals')!;
    const transport = fakeTransport(() => ({ ok: false, code: 'not_shared' }));
    useSharedAccess.setState({ shares: new Map([['sales', { sharer: { id: 'owner', name: 'Ada' }, at: 1, keys: new Set([sharedCallKey(approved)]) }]]) });
    const client = withSharedAccess(ownClient(said), { ...options(transport, true), ensureShares: async () => undefined });
    await client.call('sales', 'totals', { q: 'all' });
    await assert.rejects(client.call('sales', 'run', { region: 'North' }), (error: unknown) => isSharedCallError(error) && error.code === 'shared_unshared');
    assert.deepEqual(said, ['sales.totals']);
    assert.equal(useSharedAccess.getState().unshared.sales?.length, 1);
    assert.equal(transport.batches.length, 0);
    assert.equal(sharedErrorToLoadFailure({ code: 'shared_unshared', connector: 'sales', message: '' }).message, describeUnsharedQueries('sales'));
  });

  it('says a tool’s own error, and asks again after a timeout', () => {
    assert.equal(sharedErrorToLoadFailure({ code: 'shared_tool_error', connector: 'sales', message: 'Warehouse offline' }).message, 'Warehouse offline');
    const timedOut = sharedErrorToLoadFailure({ code: 'shared_timeout', connector: 'sales', message: '' });
    assert.equal(timedOut.unanswered, true);
    assert.equal(sharedErrorToLoadFailure({ code: 'shared_too_large', connector: 'sales', message: '' }).kind, 'refused');
  });

  it('drops a result from before the share while a run loads', () => {
    const table = { columns: ['n'], rows: [{ n: 1 }] };
    const before = { status: 'ok' as const, at: 500, table };
    const run = { status: 'running' as const, startedAt: 2_000, prev: before };
    assert.deepEqual(dropRunBeforeShare(run, mark), { status: 'running', startedAt: 2_000, prev: null });
    const cachedOnly = { status: 'running' as const, startedAt: 2_000, prev: null, cached: before };
    assert.deepEqual(dropRunBeforeShare(cachedOnly, mark), { status: 'running', startedAt: 2_000, prev: null });
    const after = { status: 'running' as const, startedAt: 2_000, prev: { ...before, at: 1_500 } };
    assert.equal(dropRunBeforeShare(after, mark), after);
    assert.equal(dropRunBeforeShare(run, undefined), run);
    assert.equal(dropRunBeforeShare(before, mark), before);
  });
});

describe('a guest’s dashboard with a shared connector', () => {
  it('loads the shared answer where the page has no connectors', async () => {
    const transport = fakeTransport(() => ({ ok: true, result: rows([{ region: 'North', n: 3 }]), ranAt: Date.now(), sharer: { id: 'owner', name: 'Ada' }, at: 1 }));
    const storage = new MemoryStorage();
    const engine = createDataEngine({ mcp: () => null as McpCapability | null, agent: () => null, storage: () => storage, scope: 'shared-test', sharedAccess: transport });
    engine.setContent(content({ a: byRegion }, { params: { region: 'North' }, settings: { shared: { sales: mark } } }));
    engine.read('a');
    await engine.settled();
    const result = engine.read('a');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.rows, [{ region: 'North', n: 3 }]);
    assert.deepEqual(transport.batches[0]?.[0]?.params, { region: 'North' });
  });
});

describe('the sharer’s dashboard', () => {
  it('holds back a changed query until it is shared again, then loads it and forgets the note', async () => {
    const said: string[] = [];
    const mcp = {
      async callTool(_server: string, tool: string) {
        said.push(tool);
        return rows([{ n: 1 }]);
      },
      async listTools() {
        return { servers: [] };
      },
    } as unknown as McpCapability;
    let approved: string[] = [];
    const transport: SharedAccessTransport = {
      shares: async () => ({ shares: [{ connector: 'sales', sharer: { id: 'owner', name: 'Ada' }, at: 1, keys: approved }] }),
      share: async (connector, calls) => {
        approved = calls.map(sharedCallKey);
        return { connector, holder: { sharer: { id: 'owner', name: 'Ada' }, at: 2 }, count: calls.length };
      },
      run: async () => ({ answers: [] }),
    };
    const storage = new MemoryStorage();
    const engine = createDataEngine({ mcp: () => mcp, agent: () => null, storage: () => storage, scope: 'sharer-test', sharedAccess: transport, viewerId: () => 'owner' });
    const first = content({ a: totals }, { settings: { shared: { sales: mark } } });
    approved = collectSharedCalls('sales', prepareDashboardContent(first).datasets).map(sharedCallKey);
    engine.setContent(first);
    engine.read('a');
    await engine.settled();
    assert.equal(engine.read('a').status, 'ok');

    // The query changes: what the share doesn't hold waits, and the page says so.
    const changed = { ...totals, source: { ...totals.source, args: { q: 'north' } } };
    engine.setContent(content({ a: changed }, { settings: { shared: { sales: mark } } }));
    engine.read('a');
    await engine.settled();
    assert.notEqual(engine.read('a').status, 'ok');
    assert.equal(useSharedAccess.getState().unshared.sales?.length, 1);

    // Shared again with a new mark: it loads, and the note goes.
    const next = content({ a: changed }, { settings: { shared: { sales: { ...mark, at: mark.at + 1 } } } });
    await transport.share('sales', collectSharedCalls('sales', prepareDashboardContent(next).datasets));
    engine.setContent(next);
    engine.read('a');
    await engine.settled();
    assert.equal(engine.read('a').status, 'ok');
    assert.equal(useSharedAccess.getState().unshared.sales, undefined);
    assert.deepEqual(said, ['totals', 'totals']);
  });
});

describe('run-as words', () => {
  it('names whose access loads the data', () => {
    assert.equal(runAsShortLabel(undefined, 'owner'), 'Each viewer');
    assert.equal(runAsShortLabel(mark, 'owner'), 'You');
    assert.equal(runAsShortLabel(mark, 'guest'), 'Ada');
    assert.equal(runAsShortLabel({ ...mark, name: '' }, 'guest'), 'Someone else');
    assert.equal(shortPersonName('  Grace  Hopper '), 'Grace');
    assert.equal(runAsTriggerLabel('sales', 'Your access'), 'sales: Load data using Your access');
    assert.equal(describeSharingLine(mark, true, 1), 'You’re sharing access to 1 query.');
    assert.equal(describeSharingLine(mark, false, 3), 'Ada Lovelace is sharing access to 3 queries.');
  });

  it('stays busy only while the share it began on still stands', () => {
    assert.equal(isRunAsBusy({ sales: 1_000 }, 'sales', mark), true);
    assert.equal(isRunAsBusy({ sales: null }, 'sales', mark), false);
    assert.equal(isRunAsBusy({ sales: null }, 'sales', undefined), true);
    assert.equal(isRunAsBusy({}, 'sales', mark), false);
  });

  it('keeps a control busy until its work settles', async () => {
    let finish = (): void => undefined;
    const work = track('sales', new Promise<void>((resolve) => (finish = resolve)));
    assert.equal(Object.hasOwn(useRunAsBusy.getState().saving, 'sales'), true);
    finish();
    await work;
    await Promise.resolve();
    assert.equal(Object.hasOwn(useRunAsBusy.getState().saving, 'sales'), false);
  });

  it('settles a settings write once the document reads it back, or after a while', async () => {
    const before = useDocument.getState().content;
    const echoed = waitForDocumentEcho(before, 10_000);
    useDocument.setState({ content: content({}, { settings: { updates: 'auto' } }) });
    await echoed;
    const started = Date.now();
    await waitForDocumentEcho(useDocument.getState().content, 20);
    assert.ok(Date.now() - started >= 15);
  });
});
