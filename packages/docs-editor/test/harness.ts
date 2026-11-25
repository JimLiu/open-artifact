/** A type server holding one doc, and pages that keep one of its tabs in step with it, for the sync tests. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiskDoc, DocState } from '@open-artifact/docs-core';
import type { DocCallAnswer, DocFrame, DocSessionResponse, DocTabFrame, DocTabResponse } from '@open-artifact/runtime/doc-api';
import { createTypeServer, type TypeServer } from '@open-artifact/type-server';
import { type DocTransport, type ShadowCause, TabSync } from '../src/sync/tab-sync.ts';
import type { TabWal } from '../src/sync/wal.ts';

type Json = Record<string, unknown>;

export const texts = (doc: DocState | DiskDoc) =>
  (doc.blocks as Array<{ inline?: Array<{ text?: string; ch?: string }> }>).map(block => (block.inline ?? []).map(run => run.text ?? run.ch ?? '').join(''));

export interface Page {
  name: string;
  /** The page's writing session, shared by every tab it keeps (see {@link PageOptions.alongside}). */
  session: { sess: string; next: number };
  sync: TabSync;
  causes: ShadowCause[];
  /** Closes the event stream (the server lets the session go) and opens it again. */
  reconnect(): Promise<void>;
  stop(): Promise<void>;
}

export interface PageOptions {
  /** The tab to keep (default the first). */
  tab?: string;
  /** Another tab of this page: the sync shares its session and client, as a page's open tabs do. */
  alongside?: Page;
  /** Hand the page the frames of others' writes (default true). */
  frames?: boolean;
  transport?: (base: DocTransport) => DocTransport;
  onShadow?: (doc: DocState, cause: ShadowCause) => void;
  /** The page's write-ahead log (none by default); made with the page's writing session. */
  wal?: (sess: string) => TabWal;
  /** Words of edits the page dropped. */
  onUnsaved?: (words: string, reason?: string) => void;
}

export interface DocServer {
  tab: string;
  node: string;
  /** Every tab, in order, with its node (the first is {@link tab}). */
  tabs: Array<{ tab: string; node: string }>;
  /** The texts of a tab as the server holds it. */
  textsOf(tab: string): Promise<string[]>;
  post<T>(route: string, body: unknown): Promise<T>;
  action(name: string, args: Json): Promise<Json>;
  serverTexts(): Promise<string[]>;
  open(label: string, options?: PageOptions): Promise<Page>;
  /** Lets the frames of writes made so far arrive, then waits for the pages to have read and sent all they have. */
  settle(...pages: Page[]): Promise<void>;
  stop(): Promise<void>;
}

const SECRET = 'test-secret';

/** `more` is the markdown of tabs after the first. */
export async function startDocServer(markdown: string, more: string[] = []): Promise<DocServer> {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-docs-editor-'));
  const root = join(dir, 'Notes');
  const server: TypeServer = createTypeServer({ assetsDir: join(dir, 'assets'), secret: SECRET, idleMs: 0, downloadsDir: join(dir, 'downloads') });
  await server.listen();
  const opened = await server.open({ root, type: 'docs', title: 'Notes' });
  const base = opened.url;

  const post = async <T>(route: string, body: unknown): Promise<T> => {
    const response = await fetch(new URL(route, base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.ok, true, `${route}: ${response.status}`);
    return (await response.json()) as T;
  };
  const action = async (name: string, args: Json): Promise<Json> => {
    const response = await fetch(new URL(`/__open-artifact/actions/${name}`, base), {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: opened.id, root, args }),
    });
    return (await response.json()) as Json;
  };

  const batch = more.flatMap((words, n) => [
    { $lid: `t${n}`, verb: 'create', object: 'file', payload: { name: `Tab ${n + 2}` } },
    { verb: 'create', object: 'node', payload: { parent: { object: 'file', id: `$lid:t${n}` }, markdown: words } },
  ]);
  const made = await action('create', { call: { name: 'Notes', doc: { markdown }, ...(batch.length ? { batch } : {}) } });
  assert.equal(made.ok, true, JSON.stringify(made));
  const first = await post<DocSessionResponse>('_api/doc/session', { client: 'setup' });
  const tabs = first.project.files.map(file => ({ tab: file.id, node: file.content.id }));
  const { tab, node } = tabs[0]!;

  async function listen(name: string, onFrame: (frame: DocTabFrame) => void): Promise<{ close(): Promise<void> }> {
    const events = await fetch(new URL(`_api/events?client=${name}`, base));
    const reader = events.body!.getReader();
    const pump = (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const chunk = await reader.read().catch(() => null);
        if (!chunk || chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (event !== 'doc' || !data) continue;
          const parsed = JSON.parse(data) as DocFrame;
          if (parsed.kind === 'tab') onFrame(parsed);
        }
      }
    })();
    return {
      close: async () => {
        await reader.cancel().catch(() => undefined);
        await pump;
      },
    };
  }

  let pages = 0;
  async function open(label: string, options: PageOptions = {}): Promise<Page> {
    const alongside = options.alongside;
    const name = alongside ? alongside.name : `${label}-${++pages}`;
    let shared = alongside?.session;
    if (!shared) {
      const session = await post<DocSessionResponse>('_api/doc/session', { client: name });
      assert.ok(session.sess);
      shared = { sess: session.sess, next: session.next };
    }
    const session = shared;
    const keeps = tabs.find(one => one.tab === (options.tab ?? tab));
    assert.ok(keeps, `no tab ${options.tab}`);
    const plain: DocTransport = {
      call: request => post<DocCallAnswer>('_api/doc/call', { client: name, ...request }),
      read: tabId => post<DocTabResponse>('_api/doc/read', { tab: tabId }),
      renew: async () => {
        const renewed = await post<DocSessionResponse>('_api/doc/session', { client: name });
        if (!renewed.sess) return false;
        session.sess = renewed.sess;
        session.next = renewed.next;
        return true;
      },
    };
    const transport = options.transport ? options.transport(plain) : plain;
    const read = await plain.read(keeps.tab);
    const page = { name, session, causes: [] as ShadowCause[] } as Page;
    page.sync = new TabSync(
      {
        tab: keeps.tab,
        node: keeps.node,
        session,
        transport,
        retryMs: 20,
        wal: options.wal ? options.wal(session.sess) : null,
        events: {
          ...(options.onUnsaved ? { unsaved: options.onUnsaved } : {}),
          shadow: (doc, cause) => {
            page.causes.push(cause);
            options.onShadow?.(doc, cause);
          },
        },
      },
      read,
    );
    const hear = (frame: DocTabFrame) => {
      if (options.frames !== false) page.sync.heard(frame);
    };
    if (alongside) {
      // The page's one stream is the first tab's; this sync hears nothing of its own.
      page.reconnect = async () => page.sync.reconnected();
      page.stop = async () => page.sync.stop();
      return page;
    }
    let stream = await listen(name, hear);
    page.reconnect = async () => {
      await stream.close();
      // The server forgets a session once its stream has closed.
      await new Promise(done => setTimeout(done, 60));
      stream = await listen(name, hear);
      page.sync.reconnected();
    };
    page.stop = async () => {
      page.sync.stop();
      await stream.close();
    };
    return page;
  }

  const textsOf = async (of: string) => texts((await post<DocTabResponse>('_api/doc/read', { tab: of })).doc as unknown as DiskDoc);
  return {
    tab,
    node,
    tabs,
    textsOf,
    post,
    action,
    serverTexts: () => textsOf(tab),
    open,
    settle: async (...open: Page[]) => {
      for (let round = 0; round < 3; round++) {
        await new Promise(done => setTimeout(done, 60));
        await Promise.all(open.map(page => page.sync.settled()));
      }
    },
    stop: async () => {
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
