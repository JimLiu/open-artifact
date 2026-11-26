/**
 * A tab that was blank when its history began keeps no state at rev 1. The page compares the oldest version with the
 * tab as first saved, so reading rev 1 for that answers an empty tab; restoring it, or the agent reading it, still finds
 * no version there.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { DiskDoc } from '@open-artifact/docs-core';
import type { DocSessionResponse, DocVersionResponse } from '@open-artifact/runtime/doc-api';
import { createTypeServer, type TypeServer } from '../src/index.ts';

type Json = Record<string, unknown>;

describe('docs: the tab as first saved', () => {
  let dir: string;
  let root: string;
  let server: TypeServer;
  let page: string;
  let id: string;
  let tab: string;
  const secret = 'test-secret';

  const request = (route: string, body: unknown) => fetch(new URL(route, page), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const post = async <T>(route: string, body: unknown): Promise<T> => {
    const response = await request(route, body);
    assert.equal(response.ok, true, `${route}: ${response.status} ${await response.clone().text()}`);
    return (await response.json()) as T;
  };
  const action = async (name: string, args: Json): Promise<Json> => {
    const response = await fetch(new URL(`/__open-artifact/actions/${name}`, page), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, root, args }),
    });
    return (await response.json()) as Json;
  };
  const write = (words: string) =>
    action('update', { call: { ref: { object: 'node', id: tab }, payload: { ops: [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: words } } }] } } });

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-docs-first-'));
    root = join(dir, 'Blank');
    server = createTypeServer({ assetsDir: join(dir, 'assets'), secret, idleMs: 0, downloadsDir: join(dir, 'downloads') });
    await server.listen();
    const opened = await server.open({ root, type: 'docs', title: 'Blank' });
    page = opened.url;
    id = opened.id;
    tab = (await post<DocSessionResponse>('_api/doc/session', { client: 'reader' })).project.files[0]!.id;
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('answers an empty tab at rev 1 once writes began on the blank tab', async () => {
    for (const words of ['First words.', 'Second words.']) assert.equal((await write(words)).ok, true);
    const history = await post<{ rev: number; versions: Array<{ rev: number; by: string }> }>('_api/doc/history', { tab });
    assert.deepEqual(history.versions.map(version => version.by), ['agent', 'agent']);
    assert.ok(history.versions.every(version => version.rev > 1));
    const first = await post<DocVersionResponse>('_api/doc/version', { tab, rev: 1 });
    assert.equal(first.rev, 1);
    assert.deepEqual((first.doc as unknown as DiskDoc).blocks, []);
  });

  it('still refuses to restore rev 1, from the page or the agent, and the agent reads no version there', async () => {
    const { rev } = await post<{ rev: number }>('_api/doc/history', { tab });
    const fromPage = await request('_api/doc/restore', { tab, rev: 1, ifRev: rev });
    assert.equal(fromPage.status, 404);
    const fromAgent = await action('update', { call: { ref: { object: 'node', id: tab }, payload: { ifRev: rev, ops: [{ op: 'restore', rev: 1 }] } } });
    assert.notEqual(fromAgent.ok, true, JSON.stringify(fromAgent));
    assert.match(JSON.stringify(fromAgent), /no_history/);
    const read = await action('read', { call: { ref: { object: 'node', id: tab }, payload: { kind: 'view', atRev: 1 } } });
    assert.notEqual(read.ok, true, JSON.stringify(read));
    assert.match(JSON.stringify(read), /no_history/);
    assert.equal((await post<{ rev: number }>('_api/doc/history', { tab })).rev, rev);
  });

  it('answers an empty tab at rev 1 for a doc born with text too: the birth is its first version', async () => {
    const born = join(dir, 'Born');
    const opened = await server.open({ root: born, type: 'docs', title: 'Born' });
    const call = async (name: string, args: Json): Promise<Json> => {
      const response = await fetch(new URL(`/__open-artifact/actions/${name}`, opened.url), {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: opened.id, root: born, args }),
      });
      return (await response.json()) as Json;
    };
    const ask = (route: string, body: unknown) => fetch(new URL(route, opened.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await call('create', { call: { name: 'Born', doc: { markdown: '# Born\n\nText from the start.' } } })).ok, true);
    const bornTab = ((await (await ask('_api/doc/session', { client: 'reader' })).json()) as DocSessionResponse).project.files[0]!.id;
    for (const words of ['First words.', 'Second words.']) {
      const answer = await call('update', { call: { ref: { object: 'node', id: bornTab }, payload: { ops: [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: words } } }] } } });
      assert.equal(answer.ok, true, JSON.stringify(answer));
    }
    const history = (await (await ask('_api/doc/history', { tab: bornTab })).json()) as { versions: Array<{ rev: number; by: string }> };
    assert.deepEqual(history.versions.map(version => [version.rev, version.by]), [[4, 'agent'], [3, 'agent'], [2, 'agent']]);
    const first = (await (await ask('_api/doc/version', { tab: bornTab, rev: 1 })).json()) as DocVersionResponse;
    assert.deepEqual((first.doc as unknown as DiskDoc).blocks, []);
    const born2 = (await (await ask('_api/doc/version', { tab: bornTab, rev: 2 })).json()) as DocVersionResponse;
    assert.ok(JSON.stringify(born2.doc).includes('Text from the start.'));
  });
});
