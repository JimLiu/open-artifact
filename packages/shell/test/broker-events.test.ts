/**
 * The broker carries the collaboration capabilities (`room`, `db`,
 * `comments`): their calls reach the backend and every listener method of a
 * capability (room has two) feeds its own event to the page.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { CapToShell } from '@open-artifact/protocol';
import { createRuntime, createShellProvider, type CapabilityProvider } from '@open-artifact/runtime';
import { call, resetBroker, want, type PagePost } from '../src/shell/broker.ts';

const SHELL = 'http://127.0.0.1:4800';
const PAGE = 'http://127.0.0.1:4720';
const BASE = `${PAGE}/whiteboard/tok/`;

type Listener = (event: unknown) => void;

const saved = { window: (globalThis as { window?: unknown }).window, location: (globalThis as { location?: unknown }).location };
afterEach(() => {
  (globalThis as { window?: unknown }).window = saved.window;
  (globalThis as { location?: unknown }).location = saved.location;
  resetBroker();
});
beforeEach(() => resetBroker());

/** A page and a Shell over fake windows; the backend records calls and lets the test fire its listeners. */
function harness(): {
  provider: CapabilityProvider;
  calls: Array<{ method: string; args: unknown[] }>;
  fire(listener: string, data: unknown): void;
} {
  const pageListeners = new Set<Listener>();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const on = (key: string) => (listener: (data: unknown) => void) => {
    const set = listeners.get(key) ?? new Set();
    listeners.set(key, set);
    set.add(listener);
    return () => set.delete(listener);
  };
  const record = (name: string, method: string, answer: unknown = null) => (...args: unknown[]) => {
    calls.push({ method: `${name}.${method}`, args });
    return Promise.resolve(answer);
  };

  const backend: CapabilityProvider = {
    get(name) {
      switch (name) {
        case 'room':
          return {
            self: record('room', 'self', 'client-1'),
            presence: record('room', 'presence'),
            peers: record('room', 'peers', []),
            emit: record('room', 'emit'),
            onPeers: on('room.onPeers'),
            onMessage: on('room.onMessage'),
          } as never;
        case 'db':
          return {
            get: record('db', 'get', { title: 'Board' }),
            list: record('db', 'list', []),
            write: record('db', 'write'),
            onChange: on('db.onChange'),
          } as never;
        case 'comments':
          return {
            list: record('comments', 'list', []),
            create: record('comments', 'create'),
            reply: record('comments', 'reply'),
            setResolved: record('comments', 'setResolved'),
            move: record('comments', 'move'),
            remove: record('comments', 'remove'),
            sendToAgent: record('comments', 'sendToAgent'),
            onChange: on('comments.onChange'),
          } as never;
        default:
          return null;
      }
    },
  };
  resetBroker(() => backend);

  const pageWindow = {
    postMessage(message: unknown) {
      queueMicrotask(() => {
        for (const listener of pageListeners) listener({ source: shellWindow, origin: SHELL, data: structuredClone(message) });
      });
    },
  };
  const post: PagePost = (message) => pageWindow.postMessage(message);
  const shellWindow = {
    postMessage(message: CapToShell) {
      const event = { source: pageWindow, origin: PAGE, data: structuredClone(message) };
      if (message.openArtifact === 'cap_want') void want(message, PAGE, post);
      else void call(message, event as unknown as MessageEvent, post);
    },
  };
  (globalThis as { window?: unknown }).window = {
    parent: shellWindow,
    addEventListener: (_type: string, fn: Listener) => pageListeners.add(fn),
    removeEventListener: (_type: string, fn: Listener) => pageListeners.delete(fn),
  };
  (globalThis as { location?: unknown }).location = { href: BASE };
  const provider = createShellProvider({ origin: SHELL, target: shellWindow as unknown as Window, fallback: { get: () => null }, wantTimeoutMs: 50 });
  return {
    provider,
    calls,
    fire: (key, data) => {
      for (const listener of listeners.get(key) ?? []) listener(data);
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

test('room: both listeners reach the page, and self / emit are brokered', async () => {
  const h = harness();
  const room = await createRuntime(h.provider).use('room');
  assert.ok(room);
  const peers: unknown[] = [];
  const messages: unknown[] = [];
  room.onPeers((list) => peers.push(list));
  room.onMessage((message) => messages.push(message));
  h.fire('room.onPeers', [{ id: 'p1' }]);
  h.fire('room.onMessage', { from: 'p1', topic: 'cursor', data: { x: 1 } });
  await tick();
  assert.deepEqual(peers, [[{ id: 'p1' }]]);
  assert.deepEqual(messages, [{ from: 'p1', topic: 'cursor', data: { x: 1 } }]);

  assert.equal(await room.self(), 'client-1');
  await room.emit('cursor', { x: 2 });
  assert.deepEqual(
    h.calls.filter((c) => c.method === 'room.emit').map((c) => c.args),
    [['cursor', { x: 2 }]],
  );
});

test('db: calls reach the backend and changes reach the page', async () => {
  const h = harness();
  const db = await createRuntime(h.provider).use('db');
  assert.ok(db);
  const seen: unknown[] = [];
  db.onChange((event) => seen.push(event));
  h.fire('db.onChange', { changes: { 'elements/n1': null }, author: 'agent' });
  await tick();
  assert.deepEqual(seen, [{ changes: { 'elements/n1': null }, author: 'agent' }]);

  assert.deepEqual(await db.get('board/meta'), { title: 'Board' });
  await db.write([{ op: 'update', path: 'board/meta', patch: { title: null } }]);
  assert.deepEqual(h.calls.find((c) => c.method === 'db.write')?.args, [[{ op: 'update', path: 'board/meta', patch: { title: null } }]]);
});

test('comments: thread lists reach the page and sendToAgent is brokered', async () => {
  const h = harness();
  const comments = await createRuntime(h.provider).use('comments');
  assert.ok(comments);
  const seen: unknown[] = [];
  comments.onChange((threads) => seen.push(threads));
  h.fire('comments.onChange', [{ id: 'c_1' }]);
  await tick();
  assert.deepEqual(seen, [[{ id: 'c_1' }]]);
  await comments.sendToAgent('c_1');
  assert.deepEqual(h.calls.find((c) => c.method === 'comments.sendToAgent')?.args, ['c_1']);
  // The person's words and selection go along; nothing else the page put in does.
  const snapshot = { kind: 'line', label: 'The ferry leaves at nine.', count: 1, items: [{ id: 'b1', kind: 'block' }] };
  await comments.sendToAgent('c_2', { userText: 'Say when', selectionSnapshot: snapshot, extra: 1 } as never);
  assert.deepEqual(h.calls.find((c) => c.method === 'comments.sendToAgent' && (c.args as unknown[])[0] === 'c_2')?.args, ['c_2', { userText: 'Say when', selectionSnapshot: snapshot }]);
  await assert.rejects(comments.sendToAgent('c_3', { unasked: true }));
});
