import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDashboardContent, type DashboardContent } from '@open-artifact/data-core';
import type { AgentCapability, AgentRequest, McpCapability, McpToolResult } from '@open-artifact/runtime';
import { createDataEngine, type DataEngine, type DataEngineOptions } from '../src/data/engine.ts';

/* ------------------------------------------------------------------ fakes */

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

interface FakeCall {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

type FakeAnswer = McpToolResult | Error | { code: string; message: string; retryable?: boolean };

function rowsAnswer(rows: Record<string, unknown>[]): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
}

function createFakeMcp(answer: (call: FakeCall) => FakeAnswer | Promise<FakeAnswer>) {
  const calls: FakeCall[] = [];
  let active = 0;
  let peak = 0;
  const mcp: McpCapability = {
    async callTool(server, tool, args) {
      const call = { server, tool, args };
      calls.push(call);
      active++;
      peak = Math.max(peak, active);
      try {
        const result = await answer(call);
        if (result instanceof Error || !('content' in result)) throw result;
        return result;
      } finally {
        active--;
      }
    },
    async listTools() {
      return { servers: [{ server: 'sales', kind: 'connector', authStatus: 'connected', tools: [{ name: 'run_sql' }] }] } as never;
    },
  };
  return { mcp, calls, peak: () => peak };
}

function content(datasets: Record<string, unknown>, extra: Record<string, unknown> = {}): DashboardContent {
  return parseDashboardContent({ meta: { title: 'Test' }, params: {}, settings: {}, datasets, files: {}, ...extra });
}

const call = (tool: string, args: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) => ({
  title: tool,
  source: { kind: 'call', connector: 'sales', tool, args, ...rest },
});

function engineWith(mcp: McpCapability, options: DataEngineOptions = {}): DataEngine {
  const storage = new MemoryStorage();
  return createDataEngine({ mcp: () => mcp, agent: () => null, storage: () => storage, scope: 'test', ...options });
}

/* ------------------------------------------------------------------ tests */

describe('data engine', () => {
  it('loads a source the page reads and copies its rows', async () => {
    const fake = createFakeMcp(() => rowsAnswer([{ region: 'North', revenue: 10 }]));
    const engine = engineWith(fake.mcp);
    engine.setContent(content({ orders: call('list_orders'), unused: call('unused') }));
    assert.equal(engine.read('orders').status, 'loading');
    await engine.settled();
    const result = engine.read('orders');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.columns, ['region', 'revenue']);
    assert.deepEqual(result.rows, [{ region: 'North', revenue: 10 }]);
    result.rows[0].revenue = 99;
    assert.equal(engine.read('orders').rows[0].revenue, 10);
    assert.deepEqual(fake.calls.map((each) => each.tool), ['list_orders']);
    assert.equal(engine.store.getState().runs.get('orders')?.status, 'ok');
    assert.ok(engine.store.getState().statuses.has('unused'));
    assert.equal(engine.store.getState().runs.get('unused')?.status, 'idle');
  });

  it('says when a source is missing', () => {
    const engine = engineWith(createFakeMcp(() => rowsAnswer([])).mcp);
    engine.setContent(content({}));
    const result = engine.read('nope');
    assert.equal(result.status, 'missing');
    assert.equal(result.message, 'No dataset “nope” in this dashboard.');
  });

  it('runs one call for sources with the same load key', async () => {
    const fake = createFakeMcp(() => rowsAnswer([{ n: 1 }]));
    const engine = engineWith(fake.mcp);
    engine.setContent(content({ a: call('same', { q: 1 }), b: call('same', { q: 1 }) }));
    engine.read('a');
    engine.read('b');
    engine.read('a');
    await engine.settled();
    assert.equal(fake.calls.length, 1);
    assert.equal(engine.read('a').status, 'ok');
    assert.equal(engine.read('b').status, 'ok');
  });

  it('runs again only the queries a changed filter is used by', async () => {
    const fake = createFakeMcp(() => rowsAnswer([{ n: 1 }]));
    const engine = engineWith(fake.mcp);
    engine.setContent(
      content(
        {
          orders: call('orders', { region: '{{region}}' }, { rules: { region: { type: 'string' } } }),
          tickets: call('tickets'),
        },
        { params: { region: 'North' } },
      ),
    );
    engine.read('orders');
    engine.read('tickets');
    await engine.settled();
    assert.equal(fake.calls.length, 2);
    assert.deepEqual(fake.calls.find((each) => each.tool === 'orders')?.args, { region: 'North' });

    assert.equal(engine.setParams({ region: 'South' }), true);
    assert.equal(engine.params().region, 'South');
    assert.equal(engine.setParams({ region: 'South' }), false);
    assert.equal(engine.setParams({ 'bad name': 'x', region: 'a\u0000b' }), false);
    await engine.settled();
    assert.deepEqual(
      fake.calls.slice(2).map((each) => [each.tool, each.args]),
      [['orders', { region: 'South' }]],
    );

    assert.equal(engine.resetParams(), true);
    assert.equal(engine.params().region, 'North');
    await engine.settled();
    assert.equal(fake.calls.filter((each) => each.tool === 'tickets').length, 1);
  });

  it('maps connector errors to runs, notices and fixes', async () => {
    const fake = createFakeMcp(({ tool }) => {
      if (tool === 'missing') return { code: 'server_not_connected', message: 'not connected' };
      if (tool === 'signed_out') return { code: 'needs_reauth', message: 'sign in' };
      if (tool === 'broken') return { content: [{ type: 'text', text: 'The warehouse is offline.' }], isError: true };
      return { code: 'not_granted', message: 'no' };
    });
    const sent: AgentRequest[] = [];
    const agent = { send: async (request: AgentRequest) => (sent.push(request), { status: 'delivered' as const }) } as unknown as AgentCapability;
    const engine = engineWith(fake.mcp, { agent: () => agent });
    engine.setContent(content({ missing: call('missing'), signed_out: call('signed_out'), broken: call('broken'), refused: call('refused') }));
    for (const id of ['missing', 'signed_out', 'broken', 'refused']) engine.read(id);
    await engine.settled();

    assert.equal(engine.getRun('missing').status, 'absent');
    assert.equal(engine.read('missing').status, 'connect');
    assert.equal(engine.getRun('signed_out').status, 'reauth');
    assert.equal(engine.getRun('broken').status, 'failed');
    assert.equal(engine.read('broken').status, 'error');
    assert.match(engine.read('broken').message, /offline/);
    assert.equal(engine.read('refused').status, 'declined');

    const notice = engine.dashboardNotice();
    assert.ok(notice !== null);
    assert.ok(engine.notice('missing')?.fix !== undefined);
    assert.equal(engine.store.getState().notice?.text, notice.text);

    assert.equal(await engine.fixConnection('sales', 'add'), 'agent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Connect sales');
    assert.match(sent[0].text, /connectors\.json/);
    assert.equal(await engine.fixConnection('sales', 'allow'), 'retry');
  });

  it('reuses a cached answer within the updates interval', async () => {
    const storage = new MemoryStorage();
    const fake = createFakeMcp(() => rowsAnswer([{ n: 1 }]));
    const options = { mcp: () => fake.mcp, agent: () => null, storage: () => storage, scope: 'test' };
    const hourly = content({ orders: call('orders') }, { settings: { updates: 'hour' } });

    const first = createDataEngine(options);
    first.setContent(hourly);
    first.read('orders');
    await first.settled();
    assert.equal(fake.calls.length, 1);

    const second = createDataEngine(options);
    second.setContent(hourly);
    second.read('orders');
    await second.settled();
    assert.equal(fake.calls.length, 1);
    const run = second.getRun('orders');
    assert.equal(run.status, 'ok');
    assert.equal(second.read('orders').rows.length, 1);

    const viewed = createDataEngine(options);
    viewed.setContent(content({ orders: call('orders') }, { settings: { updates: 'viewed' } }));
    viewed.read('orders');
    await viewed.settled();
    assert.equal(fake.calls.length, 2);
  });

  it('runs a source again on refresh', async () => {
    const fake = createFakeMcp(() => rowsAnswer([{ n: fake.calls.length }]));
    const engine = engineWith(fake.mcp);
    engine.setContent(content({ orders: call('orders') }));
    engine.read('orders');
    await engine.settled();
    engine.refresh('orders');
    await engine.settled();
    assert.equal(fake.calls.length, 2);
    assert.equal(engine.read('orders').rows[0].n, 2);
    engine.refresh();
    await engine.settled();
    assert.equal(fake.calls.length, 3);
  });

  it('keeps two calls of a connector in flight at first and grows with successes', async () => {
    const waiting: (() => void)[] = [];
    const fake = createFakeMcp(
      () =>
        new Promise<FakeAnswer>((resolve) => {
          waiting.push(() => resolve(rowsAnswer([{ n: 1 }])));
        }),
    );
    const engine = engineWith(fake.mcp);
    const datasets: Record<string, unknown> = {};
    for (let index = 0; index < 8; index++) datasets[`q${index}`] = call('orders', { page: index });
    engine.setContent(content(datasets));
    for (const id of Object.keys(datasets)) engine.read(id);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    await tick();
    assert.equal(waiting.length, 2);
    waiting.shift()?.();
    await tick();
    assert.equal(waiting.length, 3);
    for (let round = 0; round < 50 && fake.calls.length + waiting.length > 0 && engine.store.getState().loading.length > 0; round++) {
      for (const release of waiting.splice(0)) release();
      await tick();
    }
    await engine.settled();
    assert.equal(fake.calls.length, 8);
    assert.ok(fake.peak() <= 4, `peak ${fake.peak()}`);
    for (const id of Object.keys(datasets)) assert.equal(engine.getRun(id).status, 'ok');
  });

  it('runs page calculations over sources, through loaders', async () => {
    const fake = createFakeMcp(() => rowsAnswer([{ n: 2 }, { n: 3 }]));
    const engine = engineWith(fake.mcp);
    engine.setContent(content({ orders: call('orders') }));
    engine.registerLoader('orders', { description: 'Doubles n', fn: ({ items }: { items: { n: number }[][] }) => items[0].map((row) => ({ n: row.n * 2 })) });
    engine.registerCalculation('total', { inputs: ['orders'], fn: (orders: { n: number }[]) => orders.reduce((sum, row) => sum + row.n, 0) });
    assert.equal(engine.read('total').status, 'loading');
    await engine.settled();
    const total = engine.read('total');
    assert.equal(total.status, 'ok');
    assert.equal(total.value, 10);
    assert.deepEqual(engine.store.getState().requested, ['total', 'orders']);
    assert.throws(() => engine.registerLoader('orders', { fn: 1 }), /dash\.loader takes a dataset id/);
  });

  it('runs a calculation again when a filter its fn read changes', async () => {
    const fake = createFakeMcp(() =>
      rowsAnswer([
        { region: 'North', n: 2 },
        { region: 'South', n: 5 },
      ]),
    );
    const engine = engineWith(fake.mcp);
    engine.setContent(content({ orders: call('orders') }, { params: { region: 'North' } }));
    let filteredRuns = 0;
    let plainRuns = 0;
    engine.registerCalculation('filtered', {
      inputs: ['orders'],
      fn: (orders: { region: string; n: number }[]) => {
        filteredRuns++;
        const { region } = engine.params();
        return orders.filter((row) => row.region === region).reduce((sum, row) => sum + row.n, 0);
      },
    });
    engine.registerCalculation('plain', { inputs: ['orders'], fn: (orders: unknown[]) => (plainRuns++, orders.length) });
    engine.read('filtered');
    engine.read('plain');
    await engine.settled();
    assert.equal(engine.read('filtered').value, 2);
    assert.equal(engine.read('plain').value, 2);
    assert.deepEqual([filteredRuns, plainRuns], [1, 1]);

    const before = engine.version();
    assert.equal(engine.setParams({ region: 'South' }), true);
    assert.ok(engine.version() > before);
    assert.equal(engine.read('filtered').value, 5);
    assert.equal(engine.read('plain').value, 2);
    await engine.settled();
    assert.deepEqual([filteredRuns, plainRuns], [2, 1]);
    assert.equal(fake.calls.length, 1);
    assert.equal(engine.store.getState().reports.get('filtered')?.result, 5);

    assert.equal(engine.resetParams(), true);
    assert.equal(engine.read('filtered').value, 2);
    assert.deepEqual([filteredRuns, plainRuns], [3, 1]);

    // Reading the filters gives a copy: writing to it changes nothing.
    (engine.params() as Record<string, unknown>).region = 'West';
    assert.equal(engine.params().region, 'North');
  });

  it('reports the toolbar text while loading and after', async () => {
    let release = (): void => {};
    const fake = createFakeMcp(() => new Promise<FakeAnswer>((resolve) => (release = () => resolve(rowsAnswer([{ n: 1 }])))));
    let time = 1_000_000;
    const engine = engineWith(fake.mcp, { now: () => time });
    engine.setContent(content({ orders: call('orders') }));
    engine.read('orders');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(engine.toolbarText() ?? '', /Loading/i);
    release();
    await engine.settled();
    time += 3 * 60_000;
    assert.match(engine.toolbarText() ?? '', /Updated/);
  });
});
