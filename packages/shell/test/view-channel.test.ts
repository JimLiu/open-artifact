/**
 * The view channel of a Shell opened as a top-level view: what it says to its host reaches the daemon in the order it
 * was said, one POST after another, even when an earlier POST is answered later than a later one would be.
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

const saved: Record<string, unknown> = {};
const original: Record<string, unknown> = {};
const GLOBALS = ['EventSource', 'sessionStorage', 'location', 'history', 'fetch'] as const;

/** Each POST the channel made, with a way to answer it. */
const posts: { event: { state: string }; answer: () => void }[] = [];
/** Events in the order the daemon took them (a POST is taken when its body has been read). */
const taken: string[] = [];

before(() => {
  for (const name of GLOBALS) original[name] = (globalThis as Record<string, unknown>)[name];
  const g = globalThis as Record<string, unknown>;
  g.EventSource = FakeEventSource;
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
  it('sends the host one message at a time, in order, though the daemon would answer a later one first', async () => {
    const { startViewChannel, viewSend } = await import('../src/shell/view-channel.ts');
    const stop = startViewChannel('art_x', { onCommand() {}, onOpen() {} });
    assert.ok(stop, 'the channel starts from the ticket');
    FakeEventSource.last!.fire('view', { view: 'v1', key: 'k1' });

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
});
