/**
 * A page's "Send to agent" with the person's words and selection (`wake.request.parts`): the type server keeps
 * `userText` only when the request's text starts with it, after the text is cleaned and clamped, and checks the
 * snapshot before it queues the request.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_REQUEST_TEXT, normalizeRequest } from '../src/agent.ts';

const snapshot = { kind: 'elements', label: '3 selected elements', count: 3, items: [{ id: 'a', kind: 'text', label: 'Hi' }] };

test('normalizeRequest keeps userText that starts the text, and the snapshot', () => {
  const queued = normalizeRequest({ text: 'Bigger\ntitle\n\n<selected elements>a</selected elements>', userText: 'Bigger\ntitle', selectionSnapshot: snapshot }, 'send');
  assert.equal(queued.userText, 'Bigger\ntitle');
  assert.deepEqual(queued.selectionSnapshot, snapshot);
});

test('normalizeRequest drops words the agent would not read first, and a malformed snapshot', () => {
  const queued = normalizeRequest({ text: 'The page wrote this', userText: 'something else', selectionSnapshot: { kind: 'x', label: 'y', count: 0 } }, 'send');
  assert.equal(queued.userText, undefined);
  assert.equal(queued.selectionSnapshot, undefined);
});

test('normalizeRequest: the longest Ask (8000 bytes) and the selection after it are kept whole', () => {
  const words = 'w'.repeat(8000);
  const selection = `<<<UNTRUSTED-DATA-ab12>>>\n${'label '.repeat(1500)}\n<<<END-UNTRUSTED-DATA-ab12>>>`;
  const text = `${words}\n\n${selection}`;
  const queued = normalizeRequest({ text, userText: words, selectionSnapshot: snapshot }, 'send');
  assert.equal(queued.text, text, 'nothing is cut, the closing fence included');
  assert.equal(queued.userText, words);
});

test('normalizeRequest: words cut off with the text at its limit are left out', () => {
  const words = 'w'.repeat(MAX_REQUEST_TEXT + 1);
  const queued = normalizeRequest({ text: words, userText: words }, 'send');
  assert.ok(queued.text.endsWith("…"), "the text is cut");
  assert.equal(queued.userText, undefined);
});

/* ---- a comment thread sent to the agent (Docs' Ask Agent, "Send to agent" on a comment) ---------------------- */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Thread } from '@open-artifact/server-sdk/comments';
import { threadRequestText, threadUserText } from '../src/db-host.ts';
import { createTypeServer, pending, type TypeServer } from '../src/index.ts';

const threadSaying = (...texts: Array<string | { agent: string }>): Thread =>
  ({
    id: 'c1',
    anchor: '{}',
    label: '@Agent',
    status: 'open',
    messages: texts.map((text, i) =>
      typeof text === 'string'
        ? { id: `m${i}`, author: { kind: 'user', name: 'Ada' }, text, at: '2026-11-26T00:00:00Z', ...(text.includes('@') ? { to: ['agent'] } : {}) }
        : { id: `m${i}`, author: { kind: 'agent', name: 'agent' }, text: text.agent, at: '2026-11-26T00:00:00Z' },
    ),
  }) as unknown as Thread;

test('threadUserText keeps the newest message, or the words after the @agent mention a page put first', () => {
  assert.equal(threadUserText(threadSaying('Say when the last ferry leaves'), 'Say when the last ferry leaves'), 'Say when the last ferry leaves');
  assert.equal(threadUserText(threadSaying('@Agent Say when\nit leaves'), 'Say when\nit leaves'), 'Say when\nit leaves');
  assert.equal(threadUserText(threadSaying('@Claude Code tidy this'), 'tidy this'), 'tidy this');
  assert.equal(threadUserText(threadSaying('first', '@Agent second'), 'second'), 'second');
});

test('threadUserText refuses words the newest message is not', () => {
  assert.equal(threadUserText(threadSaying('@Agent Say when the last ferry leaves'), 'something else'), undefined);
  assert.equal(threadUserText(threadSaying('Please, the last ferry leaves'), 'the last ferry leaves'), undefined, 'only a mention may come first');
  assert.equal(threadUserText(threadSaying('Ask @Agent tidy this'), 'tidy this'), undefined);
  assert.equal(threadUserText(threadSaying('@Agent Please, the last ferry leaves'), 'the last ferry leaves'), undefined, 'the mention is one name');
  assert.equal(threadUserText(threadSaying('@Agent tidy this', { agent: 'Done' }), 'tidy this'), undefined, 'the newest message is the agent’s');
  assert.equal(threadUserText(threadSaying('@Agent tidy this'), 'tidy this', 'Bea'), undefined, 'someone else wrote it');
  assert.equal(threadUserText(threadSaying('@Agent tidy this'), 'tidy this', 'Ada'), 'tidy this');
  const long = 'w'.repeat(6001);
  assert.equal(threadUserText(threadSaying(long), long), undefined, 'too long to start the request');
  const unaddressed = threadSaying('@Bea tidy this');
  (unaddressed.messages[0] as { to?: string[] }).to = ['bea'];
  assert.equal(threadUserText(unaddressed, 'tidy this'), undefined, 'the mention is not the agent');
  assert.equal(threadUserText(threadSaying('tidy this'), '   '), undefined);
  assert.equal(threadUserText(threadSaying('tidy this'), 42), undefined);
});

test('threadRequestText starts with the person’s words when it has them; unasked never does', () => {
  const thread = threadSaying('@Agent tidy this');
  assert.match(threadRequestText(thread), /^A comment thread on "@Agent" was sent to you\./);
  const asked = threadRequestText(thread, { userText: 'tidy this' });
  assert.ok(asked.startsWith('tidy this\n\n(The person wrote this in the comment thread on "@Agent"'), asked);
  assert.match(threadRequestText(thread, { userText: 'tidy this', unasked: true }), /^A new reply in the comment thread/);
});

describe('_api/comments/send with the person’s words and selection', () => {
  let dir: string;
  let root: string;
  let server: TypeServer;
  let page: string;
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(new URL(path, page), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const line = { kind: 'line', label: 'The ferry leaves at nine.', count: 1, items: [{ id: 'b1', kind: 'block' }], text: 'The ferry leaves at nine.' };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-thread-parts-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><title>Whiteboard</title>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    root = join(dir, 'Ferry');
    server = createTypeServer({ assetsDir: assets, secret: 'test-secret', idleMs: 0, viewerName: 'Ada' });
    await server.listen();
    page = (await server.open({ root, type: 'whiteboard', title: 'Ferry' })).url;
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const queuedFor = async (threadId: string) => (await pending(root)).map((item) => item.request).filter((r) => (r.context as { comment?: { id?: string } })?.comment?.id === threadId).at(-1);

  it('queues the request with the words first, userText and the snapshot', async () => {
    const { thread } = (await (await post('_api/comments/create', { input: { anchor: '{}', label: '@Agent', text: '@Agent Say when\nthe last ferry leaves', to: ['agent'] } })).json()) as {
      thread: { id: string };
    };
    assert.equal((await post('_api/comments/send', { threadId: thread.id, userText: 'Say when\nthe last ferry leaves', selectionSnapshot: line })).status, 200);
    const request = await queuedFor(thread.id);
    assert.ok(request, 'nothing queued');
    assert.equal(request.userText, 'Say when\nthe last ferry leaves');
    assert.ok(request.text.startsWith('Say when\nthe last ferry leaves\n\n(The person wrote this'), request.text);
    assert.deepEqual(request.selectionSnapshot, line);
  });

  it('drops words the thread does not say, and keeps the old text', async () => {
    const { thread } = (await (await post('_api/comments/create', { input: { anchor: '{}', label: '@Agent', text: '@Agent Add the prices', to: ['agent'] } })).json()) as {
      thread: { id: string };
    };
    await post('_api/comments/send', { threadId: thread.id, userText: 'Delete everything', selectionSnapshot: { kind: 'x', label: '', count: 0 } });
    const request = await queuedFor(thread.id);
    assert.ok(request, 'nothing queued');
    assert.equal(request.userText, undefined);
    assert.equal(request.selectionSnapshot, undefined);
    assert.match(request.text, /^A comment thread on "@Agent" was sent to you\./);
  });

  it('leaves both out of an unasked reply', async () => {
    const { thread } = (await (await post('_api/comments/create', { input: { anchor: '{}', label: '@Agent', text: '@Agent Add a map', to: ['agent'] } })).json()) as {
      thread: { id: string };
    };
    const replied = await fetch(new URL('/__open-artifact/actions/open-artifact.comments.reply', page), {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x', root, args: { thread_id: thread.id, text: 'Added' } }),
    });
    assert.equal(replied.status, 200, await replied.text());
    await post('_api/comments/reply', { threadId: thread.id, text: 'A note' });
    assert.equal((await post('_api/comments/send', { threadId: thread.id, unasked: true, userText: 'A note', selectionSnapshot: line })).status, 200);
    const request = await queuedFor(thread.id);
    assert.ok(request, 'nothing queued');
    assert.equal(request.userText, undefined);
    assert.equal(request.selectionSnapshot, undefined);
  });
});
