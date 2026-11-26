import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { type DiskDoc, docFromDisk } from '@open-artifact/docs-core';
import { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import type { DocCallAnswer, DocFrame, DocSessionResponse, DocTabResponse } from '@open-artifact/runtime/doc-api';
import { createTypeServer, type TypeServer } from '../src/index.ts';

type Json = Record<string, unknown>;

/** Reads SSE frames until `predicate` matches one. */
async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, predicate: (name: string, data: unknown) => boolean, timeoutMs = 4000): Promise<unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((done) => setTimeout(() => done(null), deadline - Date.now()))]);
    if (!chunk || chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const name = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (name && data) {
        const parsed = JSON.parse(data) as unknown;
        if (predicate(name, parsed)) return parsed;
      }
    }
  }
  throw new Error('timed out waiting for event');
}

/** The text of a tab's top-level blocks, as stored. */
const texts = (doc: DiskDoc) => doc.blocks.map((block) => (block.inline ?? []).map((run) => ('text' in run ? run.text : '')).join(''));

describe('docs on the type server', () => {
  let dir: string;
  let root: string;
  let server: TypeServer;
  let page: string;
  let id: string;
  const secret = 'test-secret';

  const post = async <T>(route: string, body: unknown): Promise<T> => {
    const response = await fetch(new URL(route, page), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.ok, true, `${route}: ${response.status} ${await response.clone().text()}`);
    return (await response.json()) as T;
  };
  const action = async (name: string, args: Json): Promise<{ status: number; body: Json }> => {
    const response = await fetch(new URL(`/__open-artifact/actions/${name}`, page), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, root, args }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-docs-server-'));
    root = join(dir, 'Plan');
    server = createTypeServer({ assetsDir: join(dir, 'assets'), secret, idleMs: 0, downloadsDir: join(dir, 'downloads') });
    await server.listen();
    const opened = await server.open({ root, type: 'docs', title: 'Plan' });
    page = opened.url;
    id = opened.id;
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('scaffolds a blank doc and offers the doc store', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'doc', 'doc.json'), 'utf8')) as { format: string; name: string; tabs: Record<string, unknown> };
    assert.equal(manifest.format, 'open-artifact-docs');
    assert.equal(manifest.name, 'Plan');
    assert.equal(Object.keys(manifest.tabs).length, 1);
    const session = await (await fetch(new URL('_api/session', page))).json() as { stores: Json; artifact: { type: string } };
    assert.equal(session.artifact.type, 'docs');
    assert.equal(session.stores.doc, true);
    assert.equal(session.stores.comments, true);
    assert.notEqual(session.stores.history, true);
  });

  it('lists the doc actions', async () => {
    const listed = (await (await fetch(new URL('/__open-artifact/actions', page), { headers: { authorization: `Bearer ${secret}` } })).json()) as { actions: { name: string }[] };
    for (const name of ['create', 'read', 'update', 'batch', 'delete', 'export', 'import']) assert.ok(listed.actions.some((a) => a.name === name), name);
  });

  it('uses the document storage policy for reading and remembering people', async (t) => {
    const other = join(dir, 'People');
    const folder = join(other, 'doc');
    await mkdir(folder, { recursive: true });
    const file = join(folder, '.people.json');
    const saved = { earlier: 'Previous collaborator' };
    await writeFile(file, JSON.stringify(saved));
    const resolve = WorkspaceDirectory.prototype.resolve;
    const opens: boolean[] = [];
    t.mock.method(WorkspaceDirectory.prototype, 'resolve', function (
      this: WorkspaceDirectory, input: string, followLeaf = true,
    ) {
      if (basename(input) === '.people.json') {
        opens.push(followLeaf);
        throw new Error('Fixture policy refused the people index');
      }
      return resolve.call(this, input, followLeaf);
    });
    const opened = await server.open({ root: other, type: 'docs' });
    try {
      const response = await fetch(new URL('_api/doc/session', opened.url), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: 'people' }),
      });
      assert.equal(response.status, 200);
      const session = await response.json() as DocSessionResponse;
      assert.ok(session.people);
      assert.equal(session.people.earlier, undefined);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), saved);
      assert.deepEqual(opens, [true, false]);
    } finally {
      await server.close(opened.id);
    }
  });

  it('keeps the blank doc when a birth is refused, then takes a corrected one', async () => {
    const refused = await action('create', {
      call: { name: 'Q3 plan', doc: { markdown: '# Q3 plan\n\nGoals' }, batch: [{ verb: 'create', object: 'enum', payload: { name: 'Status', options: ['Open'] } }, { verb: 'update', ref: { object: 'file', id: 'nope' }, payload: { name: 'x' } }] },
    });
    assert.equal(refused.body.ok, false);
    const manifest = JSON.parse(await readFile(join(root, 'doc', 'doc.json'), 'utf8')) as { name: string; enums: Json };
    assert.equal(manifest.name, 'Plan');
    assert.deepEqual(manifest.enums, {});

    const events = await fetch(new URL('_api/events?client=watcher', page));
    const reader = events.body!.getReader();
    const made = await action('create', { call: { name: 'Q3 plan', doc: { markdown: '# Q3 plan\n\nGoals for the quarter.' } } });
    assert.equal(made.body.ok, true, JSON.stringify(made.body));
    const frame = (await nextEvent(reader, (name, data) => name === 'doc' && (data as DocFrame).kind === 'project')) as DocFrame;
    assert.equal(frame.kind === 'project' && frame.project.name, 'Q3 plan');
    await reader.cancel();

    const again = await action('create', { call: { name: 'Other', doc: { markdown: 'x' } } });
    assert.equal(again.body.ok, false);
    assert.equal(again.body.code, 'exists');
  });

  it('carries a page’s edit to the other pages, replays an opId and denies a stale op', async () => {
    const a = await post<DocSessionResponse>('_api/doc/session', { client: 'page-a' });
    const b = await post<DocSessionResponse>('_api/doc/session', { client: 'page-b' });
    assert.ok(a.sess && b.sess && a.sess !== b.sess);
    assert.equal(b.next, 0);
    assert.equal(a.writable, true);
    const file = a.project.files[0]!;
    const tab = await post<DocTabResponse>('_api/doc/read', { tab: file.id });
    const disk = tab.doc as unknown as DiskDoc;
    assert.deepEqual(texts(disk), ['Q3 plan', 'Goals for the quarter.']);
    const lastChar = docFromDisk(disk).blocks[1]!.inline!.at(-1)!.id;

    const events = await fetch(new URL('_api/events?client=page-b', page));
    const reader = events.body!.getReader();
    const member = {
      verb: 'update',
      ref: { object: 'node', id: file.content.id },
      payload: { ifRev: tab.rev, ops: [{ op: 'insert', target: { kind: 'chars', range: [lastChar, lastChar] }, ids: { from: `${a.sess}.${a.next}`, count: 4 }, with: { as: 'text', from: { kind: 'inline', content: ' Go!' } } }] },
    };
    const answer = await post<DocCallAnswer & { rev?: number }>('_api/doc/call', { client: 'page-a', sess: a.sess, opId: 'op-1', member });
    assert.equal(answer.verdict, 'allow', JSON.stringify(answer));
    const frame = (await nextEvent(reader, (name, data) => name === 'doc' && (data as DocFrame).kind === 'tab')) as DocFrame;
    assert.equal(frame.kind, 'tab');
    assert.equal(frame.kind === 'tab' && frame.by, 'person');
    assert.equal(frame.kind === 'tab' && frame.opId, 'op-1');
    await reader.cancel();

    const reread = await post<DocTabResponse>('_api/doc/read', { tab: file.id });
    assert.equal(texts(reread.doc as unknown as DiskDoc)[1], 'Goals for the quarter. Go!');
    const replayed = await post<DocCallAnswer>('_api/doc/call', { client: 'page-a', sess: a.sess, opId: 'op-1', member });
    assert.equal(replayed.verdict, 'allow');
    assert.equal((replayed as { replayed?: boolean }).replayed, true);
    assert.equal(texts((await post<DocTabResponse>('_api/doc/read', { tab: file.id })).doc as unknown as DiskDoc)[1], 'Goals for the quarter. Go!');

    // Page B's stream closed, which let its session go: it takes a new one.
    const b2 = await post<DocSessionResponse>('_api/doc/session', { client: 'page-b' });
    const gone = await post<DocCallAnswer>('_api/doc/call', {
      client: 'page-b',
      sess: b2.sess,
      member: { ...member, payload: { ops: [{ op: 'delete', target: { kind: 'chars', range: ['zz.1', 'zz.1'] } }] } },
    });
    assert.equal(gone.verdict, 'deny');
    assert.equal(gone.verdict === 'deny' && gone.reason, 'char_gone');

    const stolen = await post<DocCallAnswer>('_api/doc/call', { client: 'page-b', sess: a.sess, member });
    assert.equal(stolen.verdict === 'deny' && stolen.reason, 'not_your_session');
  });

  it('announces the agent’s write with the blocks it touched, keeps versions and restores one', async () => {
    const a = await post<DocSessionResponse>('_api/doc/session', { client: 'page-a' });
    const file = a.project.files[0]!;
    const before = await post<DocTabResponse>('_api/doc/read', { tab: file.id });
    const events = await fetch(new URL('_api/events?client=page-a', page));
    const reader = events.body!.getReader();
    const outline = await action('read', { call: { ref: { object: 'node', id: file.id } } });
    assert.equal(outline.body.ok, true);
    const wrote = await action('update', { call: { ref: { object: 'node', id: file.id }, payload: { ops: [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: 'Added by the agent.' } } }] } } });
    assert.equal(wrote.body.ok, true, JSON.stringify(wrote.body));
    const frame = (await nextEvent(reader, (name, data) => name === 'doc' && (data as DocFrame).kind === 'tab' && (data as { by: string }).by === 'agent')) as DocFrame;
    assert.ok(frame.kind === 'tab' && frame.blocks && frame.blocks.length > 0);
    await reader.cancel();

    const history = await post<{ versions: { rev: number; by: string }[]; rev: number }>('_api/doc/history', { tab: file.id });
    assert.ok(history.versions.some((version) => version.by === 'agent'));
    const old = await post<{ doc: DiskDoc }>('_api/doc/version', { tab: file.id, rev: before.rev });
    assert.equal(texts(old.doc).includes('Added by the agent.'), false);
    const restored = await post<{ restored: boolean; rev: number; before: number }>('_api/doc/restore', { tab: file.id, rev: before.rev, ifRev: history.rev });
    assert.equal(restored.restored, true);
    assert.ok(restored.rev > restored.before);
    const now = await post<DocTabResponse>('_api/doc/read', { tab: file.id });
    assert.equal(texts(now.doc as unknown as DiskDoc).includes('Added by the agent.'), false);
  });

  it('exports the doc as markdown, inline and to a file', async () => {
    const inline = await action('export', { format: 'markdown' });
    assert.equal(inline.body.ok, true);
    assert.match(String(inline.body.markdown), /^# Q3 plan/);
    const out = join(dir, 'plan.md');
    const written = await action('export', { format: 'markdown', out });
    assert.equal(written.body.out, out);
    assert.match(await readFile(out, 'utf8'), /Goals for the quarter\. Go!/);
    const response = await fetch(new URL('_api/doc/export?format=markdown', page));
    assert.equal(response.ok, true);
    assert.match(await response.text(), /^# Q3 plan/);
  });
});
