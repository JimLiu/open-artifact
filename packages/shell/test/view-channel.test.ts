/**
 * The view channel of a Shell opened as a top-level view: it claims its ticket over a WebSocket (not an event stream:
 * a browser holds six HTTP connections to a host, and a seventh view's page waited), the host's commands come down it,
 * where no socket opens the same claim goes over an event stream, and what it says to its host reaches the daemon in
 * the order it was said, one POST after another, even when an earlier POST is answered later than a later one would be.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

type Listener = (event: { data: string }) => void;

/** An EventSource that only records its listeners (the test fires `view` by hand). */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners: Record<string, Listener[]> = {};
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }
  fire(type: string, data: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data) });
  }
  close(): void {}
}

type SocketListener = (event: { data?: string }) => void;

/** A WebSocket that only records its listeners (the test opens it and sends its messages by hand). */
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  listeners: Record<string, SocketListener[]> = {};
  readonly url: string;
  closed = false;
  constructor(url: URL | string) {
    this.url = String(url);
    FakeWebSocket.last = this;
  }
  addEventListener(type: string, listener: SocketListener): void {
    (this.listeners[type] ??= []).push(listener);
  }
  fire(type: string, data?: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(data === undefined ? {} : { data: JSON.stringify(data) });
  }
  close(): void {
    this.closed = true;
  }
}

const saved: Record<string, unknown> = {};
const original: Record<string, unknown> = {};
const GLOBALS = ['EventSource', 'WebSocket', 'sessionStorage', 'location', 'history', 'fetch'] as const;

/** Each POST the channel made, with a way to answer it. */
const posts: { event: { state: string }; answer: () => void }[] = [];
/** Events in the order the daemon took them (a POST is taken when its body has been read). */
const taken: string[] = [];

before(() => {
  for (const name of GLOBALS) original[name] = (globalThis as Record<string, unknown>)[name];
  const g = globalThis as Record<string, unknown>;
  g.EventSource = FakeEventSource;
  g.WebSocket = FakeWebSocket;
  g.sessionStorage = { getItem: (k: string) => (saved[k] as string) ?? null, setItem: (k: string, v: string) => void (saved[k] = v), removeItem: (k: string) => void delete saved[k] };
  g.location = { href: 'http://127.0.0.1:1/a/art_x?oa_view=ticket-1' };
  g.history = { state: null, replaceState() {} };
  g.fetch = (_url: string, init: { body: string }) =>
    new Promise((resolve) => {
      const { event } = JSON.parse(init.body) as { event: { state: string } };
      posts.push({
        event,
        answer: () => {
          taken.push(event.state);
          resolve({ ok: true, status: 200 });
        },
      });
    });
});

after(() => {
  for (const name of GLOBALS) (globalThis as Record<string, unknown>)[name] = original[name];
});

describe('view channel', () => {
  it('claims the ticket over a WebSocket of this origin; the host commands come down it', async () => {
    const { startViewChannel } = await import('../src/shell/view-channel.ts');
    const commands: unknown[] = [];
    let opened = 0;
    const stop = startViewChannel('art_x', { onCommand: (c) => commands.push(c), onOpen: () => opened++ });
    assert.ok(stop, 'the channel starts from the ticket');
    const socket = FakeWebSocket.last!;
    assert.equal(socket.url, 'ws://127.0.0.1:1/api/open-artifact.view?view=ticket-1&id=art_x');
    assert.equal(FakeEventSource.last, null, 'no event stream');
    socket.fire('open');
    socket.fire('message', { type: 'view', view: 'v1', key: 'k1' });
    assert.equal(opened, 1);
    assert.deepEqual(JSON.parse(saved['open-artifact.view.art_x'] as string), { view: 'v1', key: 'k1' }, 'the key is kept for a reload');
    socket.fire('message', { type: 'command', command: { openArtifact: 'goto', hash: '#s2' } });
    assert.deepEqual(commands, [{ openArtifact: 'goto', hash: '#s2' }]);
    stop!();
    assert.equal(socket.closed, true);
  });

  it('sends the host one message at a time, in order, though the daemon would answer a later one first', async () => {
    const { startViewChannel, viewSend } = await import('../src/shell/view-channel.ts');
    // A reload: the ticket is gone from the address, the kept key comes back.
    (globalThis as Record<string, unknown>).location = { href: 'http://127.0.0.1:1/a/art_x' };
    const stop = startViewChannel('art_x', { onCommand() {}, onOpen() {} });
    assert.ok(stop, 'the channel starts from the kept key');
    assert.match(FakeWebSocket.last!.url, /[?&]key=k1(&|$)/);
    FakeWebSocket.last!.fire('open');
    FakeWebSocket.last!.fire('message', { type: 'view', view: 'v1', key: 'k1' });

    viewSend({ openArtifact: 'saved', state: 'saving', leaveLosesWork: false });
    viewSend({ openArtifact: 'saved', state: 'saved', leaveLosesWork: false });
    await new Promise((done) => setTimeout(done, 0));
    // The second POST would otherwise be taken first (a socket of its own, read sooner).
    for (const post of [...posts].reverse()) post.answer();
    for (let i = 0; i < 10 && taken.length < 2; i++) {
      await new Promise((done) => setTimeout(done, 0));
      for (const post of posts) if (!taken.includes(post.event.state)) post.answer();
    }
    assert.deepEqual(taken, ['saving', 'saved'], 'the host hears the last state last');
    stop!();
  });

  it('where no socket opens, claims the same ticket over an event stream', async () => {
    const { startViewChannel } = await import('../src/shell/view-channel.ts');
    for (const key of Object.keys(saved)) delete saved[key];
    (globalThis as Record<string, unknown>).location = { href: 'http://127.0.0.1:1/a/art_y?oa_view=ticket-2' };
    let opened = 0;
    const stop = startViewChannel('art_y', { onCommand() {}, onOpen: () => opened++ });
    assert.ok(stop);
    FakeWebSocket.last!.fire('close');
    const source = FakeEventSource.last!;
    assert.ok(source, 'no event stream after the socket failed');
    assert.equal(source.url, '/api/open-artifact.view?view=ticket-2&id=art_y');
    source.fire('view', { view: 'v2', key: 'k2' });
    assert.equal(opened, 1);
    stop!();
  });
});
