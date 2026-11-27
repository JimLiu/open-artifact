/**
 * Shared connector access on a Data dashboard: the owner approves exact source calls, a guest's page runs them with
 * the owner's connector (filling the blanks here, under the approval's rules), and nothing else gets through.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { roleMay } from '@open-artifact/runtime/roles';
import { API } from '@open-artifact/runtime/http-api';
import { ConnectorShares, SHARED_RESULT_FLOOR_MS, sharedCallKey } from '../src/connector-shares.ts';
import { ConnectorsHost, createTypeServer, type TypeServer } from '../src/index.ts';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fake-mcp-server.ts');

const filtered = { connector: 'sales', tool: 'run', call: true as const, args: { region: '{{region}}' }, rules: { region: { enum: ['north', 'south'] } } };
const plainCall = { connector: 'sales', tool: 'totals', args: { q: 'all' } };

describe('ConnectorShares', () => {
  let dir: string;
  let time = 1_000_000;
  let calls: [string, string, Record<string, unknown>][] = [];
  let answer: (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>> = async (_tool, args) => ({ content: [{ type: 'text', text: JSON.stringify(args) }] });
  const make = (): ConnectorShares =>
    new ConnectorShares({
      file: join(dir, 'connector-shares.json'),
      now: () => time,
      call: async (connector, tool, args) => {
        calls.push([connector, tool, args]);
        return answer(tool, args);
      },
    });

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-connector-shares-'));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs an approved call with the filled value, and keeps the approval on disk', async () => {
    calls = [];
    const shares = make();
    const shared = shares.share('a1', 'sales', [filtered, plainCall], { id: 'owner', name: 'Ada' });
    assert.equal(shared.count, 2);
    const [answerOne] = await shares.run('a1', [{ ...filtered, params: { region: 'north' } }], { viewerId: 'guest-1' });
    assert.equal(answerOne?.ok, true);
    assert.deepEqual(calls, [['sales', 'run', { region: 'north' }]]);
    // Another server over the same file knows the share.
    assert.deepEqual(make().list('a1')[0]?.keys, [sharedCallKey(filtered), sharedCallKey(plainCall)]);
    assert.match(await readFile(join(dir, 'connector-shares.json'), 'utf8'), /"a1"/);
  });

  it('refuses what the approval does not hold, a value its rules rule out, and a connector nobody shares', async () => {
    calls = [];
    const shares = make();
    shares.share('a2', 'sales', [filtered], { id: 'owner', name: 'Ada' });
    const [changed, ruledOut, unshared, broken] = await shares.run(
      'a2',
      [
        { ...filtered, args: { region: '{{region}}', extra: 'drop table' } },
        { ...filtered, params: { region: 'east' } },
        { ...filtered, connector: 'crm' },
        { tool: 'run' },
      ],
      { viewerId: 'guest-1' },
    );
    assert.deepEqual(changed, { ok: false, code: 'not_approved', sharer: { id: 'owner', name: 'Ada' } });
    assert.equal(ruledOut?.ok === false && ruledOut.code, 'value_refused');
    assert.equal(unshared?.ok === false && unshared.code, 'not_shared');
    assert.equal(broken?.ok === false && broken.code, 'invalid_call');
    // Rules sent by the page don't widen the approval's.
    const [widened] = await shares.run('a2', [{ ...filtered, rules: { region: { enum: ['east'] } }, params: { region: 'east' } }], { viewerId: 'guest-1' });
    assert.equal(widened?.ok === false && widened.code, 'not_approved');
    assert.equal(calls.length, 0);
  });

  it('reuses an answer for at least five minutes, even when asked to refresh, and runs one call for identical asks', async () => {
    calls = [];
    const shares = make();
    shares.share('a3', 'sales', [plainCall], { id: 'owner', name: 'Ada' });
    const both = await shares.run('a3', [plainCall, plainCall], { viewerId: 'guest-1', reuseMs: 0 });
    assert.ok(both.every((each) => each.ok));
    assert.equal(calls.length, 1);
    time += SHARED_RESULT_FLOOR_MS - 1;
    await shares.run('a3', [plainCall], { viewerId: 'guest-1', refresh: true });
    assert.equal(calls.length, 1);
    time += 2;
    await shares.run('a3', [plainCall], { viewerId: 'guest-1', refresh: true });
    assert.equal(calls.length, 2);
    // Without refresh, the page's own (longer) reuse time holds.
    time += SHARED_RESULT_FLOOR_MS + 1;
    await shares.run('a3', [plainCall], { viewerId: 'guest-1', reuseMs: 60 * 60_000 });
    assert.equal(calls.length, 2);
  });

  it('says a tool’s own error only to the sharer, and stops sharing with no calls', async () => {
    const shares = make();
    shares.share('a4', 'sales', [plainCall], { id: 'owner', name: 'Ada' });
    answer = async () => ({ isError: true, content: [{ type: 'text', text: 'Warehouse offline' }] });
    const [guest] = await shares.run('a4', [plainCall], { viewerId: 'guest-1' });
    const [own] = await shares.run('a4', [plainCall], { viewerId: 'owner' });
    assert.deepEqual(guest, { ok: false, code: 'tool_error', sharer: { id: 'owner', name: 'Ada' } });
    assert.equal(own?.ok === false && own.message, 'Warehouse offline');
    answer = async () => {
      throw Object.assign(new Error('busy'), { code: 'rate_limited' });
    };
    const [busy] = await shares.run('a4', [{ ...plainCall, args: { q: 'other' } }], { viewerId: 'guest-1' });
    assert.equal(busy?.ok === false && busy.code, 'not_approved');
    time += SHARED_RESULT_FLOOR_MS + 1;
    const [limited] = await shares.run('a4', [plainCall], { viewerId: 'guest-1' });
    assert.equal(limited?.ok === false && limited.code, 'timeout');
    assert.equal(shares.share('a4', 'sales', [], { id: 'owner', name: 'Ada' }).holder, null);
    assert.deepEqual(shares.list('a4'), []);
    assert.throws(() => shares.share('a4', 'sales', [{ ...plainCall, connector: 'crm' }], { id: 'owner', name: 'Ada' }), /can’t be shared/);
  });
});

describe('roles for shared connectors', () => {
  it('lets only the owner share, and everyone run shared calls', () => {
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      assert.equal(roleMay(role, API.dataShare), false);
      assert.equal(roleMay(role, API.dataShare, { editorsAskAgent: true }), false);
      assert.equal(roleMay(role, API.dataShared), true);
    }
    assert.equal(roleMay('owner', API.dataShare), true);
  });
});

describe('the shared connector routes', () => {
  let dir: string;
  let server: TypeServer;
  let host: ConnectorsHost;
  let page: string;
  let viewerLink: string;
  const secret = 'test-secret';
  const guest = (cookie = '', init: RequestInit = {}): RequestInit => ({
    ...init,
    redirect: 'manual',
    headers: { 'x-test-guest': '1', ...(cookie ? { cookie } : {}), ...((init.headers as Record<string, string>) ?? {}) },
  });
  const post = (route: string, body: unknown, init: RequestInit = {}): Promise<Response> =>
    fetch(new URL(route, page), { ...init, method: 'POST', headers: { 'content-type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) }, body: JSON.stringify(body) });
  const echo = { connector: 'fake', tool: 'echo', call: true as const, args: { region: '{{region}}' } };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-shared-routes-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'data'), { recursive: true });
    await writeFile(join(assets, 'editors', 'data', 'index.html'), '<!doctype html><title>Data</title>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    await writeFile(join(dir, 'connectors.json'), JSON.stringify({ mcpServers: { fake: { command: process.execPath, args: [FAKE] } } }));
    host = new ConnectorsHost({ file: join(dir, 'connectors.json') });
    server = createTypeServer({ assetsDir: assets, secret, idleMs: 0, viewerName: 'Ada', lanAddresses: () => [], isLocal: (req) => req.headers['x-test-guest'] === undefined, connectors: host });
    await server.listen();
    const opened = await server.open({ root: join(dir, 'Sales'), type: 'data', title: 'Sales' });
    page = opened.url;
    const res = await fetch(new URL('/__open-artifact/share', page), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: opened.id, lan: true }),
    });
    viewerLink = ((await res.json()) as { links: Record<string, { url: string }> }).links.viewer!.url;
  });

  after(async () => {
    await server.stop();
    await host.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('lets a viewer run what the owner shared, and nothing more', async () => {
    const joined = await fetch(viewerLink, guest('', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Val' }));
    const cookie = joined.headers.get('set-cookie')!.split(';')[0]!;
    // Before any share: not shared.
    const before = (await (await post(API.dataShared, { calls: [{ ...echo, params: { region: 'west' } }] }, guest(cookie))).json()) as { answers: { ok: boolean; code?: string }[] };
    assert.equal(before.answers[0]?.code, 'not_shared');
    // A guest can't share.
    assert.equal((await post(API.dataShare, { connector: 'fake', calls: [echo] }, guest(cookie))).status, 403);
    const shared = await post(API.dataShare, { connector: 'fake', calls: [echo] });
    assert.equal(shared.status, 200, await shared.clone().text());
    assert.equal(((await shared.json()) as { holder: { sharer: { name: string } } }).holder.sharer.name, 'Ada');
    const listed = (await (await fetch(new URL(API.dataShares, page), guest(cookie))).json()) as { shares: { connector: string; keys: string[] }[] };
    assert.deepEqual(listed.shares.map((each) => [each.connector, each.keys.length]), [['fake', 1]]);
    const ran = (await (await post(API.dataShared, { calls: [{ ...echo, params: { region: 'west' } }] }, guest(cookie))).json()) as {
      answers: { ok: boolean; result?: { structuredContent?: unknown }; sharer?: { name: string } }[];
    };
    assert.equal(ran.answers[0]?.ok, true);
    assert.deepEqual(ran.answers[0]?.result?.structuredContent, { region: 'west' });
    // The guest still has no connectors of their own.
    assert.equal((await post(API.mcpCall, { server: 'fake', tool: 'echo', args: {} }, guest(cookie))).status, 403);
    const other = (await (await post(API.dataShared, { calls: [{ ...echo, tool: 'pid' }] }, guest(cookie))).json()) as { answers: { code?: string }[] };
    assert.equal(other.answers[0]?.code, 'not_approved');
    // A malformed share is refused in words the page shows.
    const refused = await post(API.dataShare, { connector: 'fake', calls: [{ tool: 'echo' }] });
    assert.equal(refused.status, 400);
  });
});
