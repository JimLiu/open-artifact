/**
 * The local provider's change stream: changes made while it was down are not
 * sent again, so file listeners hear `resync` each time it opens again.
 */
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import type { FilesChangedEvent } from '../src/capabilities.ts';
import { API } from '../src/http-api.ts';
import { createLocalProvider } from '../src/local-provider.ts';

/** A WebSocket the test opens, feeds and closes by hand. */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly url: URL;
  constructor(url: URL) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  open(): void {
    this.onopen?.();
  }
  send(event: string, data: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
  close(): void {
    this.onclose?.();
  }
}

const realFetch = globalThis.fetch;
const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const realSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

before(() => {
  Object.defineProperty(globalThis, 'location', { value: { href: 'http://127.0.0.1:9/a/b/index.html' }, configurable: true });
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
  globalThis.fetch = async (input: string | URL | Request) => {
    const route = new URL(String(input)).pathname.replace('/a/b/', '');
    const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    return route === API.session ? reply({ artifact: { id: 'x', title: 'X' } }) : reply({ code: 'not_found', message: route }, 404);
  };
});

after(() => {
  globalThis.fetch = realFetch;
  (globalThis as { WebSocket?: unknown }).WebSocket = realSocket;
  if (realLocation) Object.defineProperty(globalThis, 'location', realLocation);
  else delete (globalThis as { location?: unknown }).location;
});

const turns = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

test('file listeners hear resync when the stream opens again, not when it first opens', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const artifact = await createLocalProvider().get('artifact');
    assert.ok(artifact);
    const heard: FilesChangedEvent[] = [];
    artifact.onChange((event) => heard.push(event));
    const first = FakeSocket.all.at(-1)!;
    first.open();
    first.send('files', { changes: { 'project/a': 'h1' } });
    assert.deepEqual(heard, [{ changes: { 'project/a': 'h1' } }]);

    first.close();
    await turns();
    mock.timers.tick(2000);
    const second = FakeSocket.all.at(-1)!;
    assert.notEqual(second, first, 'the stream reconnected');
    second.open();
    assert.deepEqual(heard.at(-1), { changes: {}, resync: true });
    assert.equal(heard.length, 2);
  } finally {
    mock.timers.reset();
  }
});
