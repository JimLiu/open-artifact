import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API } from '../src/http-api.ts';
import { DOC_API } from '../src/doc-api.ts';
import { createLocalProvider } from '../src/local-provider.ts';

test('only explicit cross-origin bases send cookie credentials on every HTTP path and SSE fallback', async () => {
  const originals = Object.fromEntries(['location', 'fetch', 'EventSource', 'WebSocket'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls: { url: URL; init?: RequestInit }[] = [];
  const sources: { url: string; init?: EventSourceInit; onerror?: () => void; readyState: number }[] = [];
  const sockets: { url: URL; onclose?: () => void }[] = [];
  class Source {
    static CLOSED = 2;
    readyState = 1;
    onerror?: () => void;
    url: string;
    init?: EventSourceInit;
    constructor(url: string, init?: EventSourceInit) { this.url = url; this.init = init; sources.push(this); }
    addEventListener() {}
    close() { this.readyState = Source.CLOSED; }
  }
  const set = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  try {
    set('location', { href: 'https://shell.example.test/editor/index.html', reload() { throw new Error('Unexpected reload'); } });
    set('EventSource', Source);
    set('WebSocket', undefined);
    set('fetch', async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, init });
      if (url.pathname.endsWith(API.session)) return Response.json({ artifact: { id: 'one', title: 'One' }, viewer: { id: 'owner', role: 'owner' }, stores: { history: true, doc: true, systemCopy: true, comments: true } });
      if (url.pathname.endsWith(API.file) || url.pathname.endsWith(API.historyFile) || url.pathname.endsWith(DOC_API.exportFile)) return new Response('bytes');
      return Response.json({ versions: [], notices: [], files: [], ok: true });
    });
    for (const base of [undefined, './', 'https://shell.example.test/artifact/', 'https://frame.example.test/artifact/']) {
      calls.length = 0;
      sources.length = 0;
      const crossOrigin = base?.startsWith('https://frame.') === true;
      const provider = createLocalProvider({ ...(base === undefined ? {} : { base }) });
      const artifact = (await provider.get('artifact'))!;
      await artifact.readBytes('project/a');
      await artifact.publish({ 'project/a': { content: 'new' } });
      await artifact.systemCopy!('design-system', 'sync');
      const comments = (await provider.get('comments'))!;
      await comments.sendToAgent('thread-one', { unasked: true });
      const systemCopy = calls.find((call) => call.url.pathname.endsWith(API.systemCopy));
      assert.deepEqual(JSON.parse(String(systemCopy?.init?.body)), { namespace: 'design-system', action: 'sync' });
      const commentSend = calls.find((call) => call.url.pathname.endsWith(API.commentsSend));
      assert.deepEqual(JSON.parse(String(commentSend?.init?.body)), { threadId: 'thread-one', unasked: true });
      const history = (await provider.get('history'))!;
      await history.readBytes(1, 'project/a');
      const doc = (await provider.get('doc'))!;
      await doc.exportFile({ format: 'markdown' });
      const unsubscribe = artifact.onChange(() => {});
      assert.equal(sources.length, 1);
      assert.equal(sources[0]!.init?.withCredentials, crossOrigin ? true : undefined);
      sources[0]!.onerror?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(calls.filter((call) => call.url.pathname.endsWith(API.session)).length >= 2, 'Includes access-recheck fetch');
      for (const call of calls) assert.equal(call.init?.credentials, crossOrigin ? 'include' : undefined, call.url.pathname);
      assert.ok(calls.some((call) => call.init?.method === 'POST'), 'Includes JSON write');
      assert.ok(calls.some((call) => call.url.pathname.endsWith(DOC_API.exportFile)), 'Includes binary export');
      unsubscribe();
      sources[0]!.readyState = Source.CLOSED;
    }
    set('WebSocket', class {
      onclose?: () => void;
      url: URL;
      constructor(url: URL) { this.url = url; sockets.push(this); }
    });
    const artifact = (await createLocalProvider({ base: 'https://frame.example.test/artifact/' }).get('artifact'))!;
    artifact.onChange(() => {});
    assert.equal(sockets[0]!.url.origin, 'wss://frame.example.test');
    // Browser WebSockets carry eligible cookies automatically; their constructor has no credentials flag.
    sources.length = 0;
    sockets[0]!.onclose?.();
    assert.equal(sources[0]!.init?.withCredentials, true);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
