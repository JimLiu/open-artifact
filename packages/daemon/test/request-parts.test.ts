/**
 * What the person typed and selected (`wake.request.parts`), end to end through the daemon to a live adapter: a page
 * request's `userText` and `selectionSnapshot` reach `source.requests[]` for a trusted type of this computer, an
 * untrusted or unknown type's `userText` is dropped (its snapshot kept), words that are not where `text` starts are
 * dropped, and the Shell's Ask pane sends its words as `userText`. The agent's `text` is the same with or without them.
 */

import { TEST_HOME, tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createHarness, type Harness } from '@open-artifact/harness-kit';
import { HARNESS_FEATURES, type DaemonState, type WakeDeliverParams } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';

let daemon: Daemon;
let state: DaemonState;
let harness: Harness;
let workspace: string;
const delivered: WakeDeliverParams[] = [];
let n = 0;

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
  harness = await createHarness({ harness: 'parts-app', home: TEST_HOME, autoStart: false, wake: (params) => (delivered.push(params), 'delivered') });
  workspace = tempDir('open-artifact-ws-');
  await harness.attach({ session: 'chat-1', workspace });
});

after(async () => {
  await harness.close();
  await daemon.close();
});

const owner = () => ({ harness: 'parts-app', session: 'chat-1', workspace });

const snapshot = {
  kind: 'elements',
  label: '3 selected elements',
  count: 3,
  items: [
    { id: 'hero', kind: 'text', label: 'Welcome' },
    { id: 'cta', kind: 'button', label: 'Start' },
  ],
  where: 'Page "Home"',
};

/** Sends a page request with the type's own token and waits for the adapter to get it. */
async function pageWake(type: string, request: Record<string, unknown>): Promise<WakeDeliverParams> {
  const record = daemon.store.create({ root: join(workspace, `parts-${++n}`), type, owner: owner(), title: `Parts ${n}` });
  const before = delivered.length;
  const response = await fetch(`${state.url}/api/open-artifact.type.wake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${daemon.typeToken(type)}` },
    body: JSON.stringify({ id: record.id, requests: [request] }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  await until(() => delivered.length > before);
  return delivered.at(-1)!;
}

test('the daemon lists wake.request.parts', () => {
  assert.ok(HARNESS_FEATURES.includes('wake.request.parts'));
});

test('a trusted type: userText (line breaks kept) and the snapshot reach source.requests; text is unchanged', async () => {
  const text = 'Make these warmer\nand bigger\n\n<selected elements>hero, cta</selected elements>';
  const wake = await pageWake('slides', { title: 'Send to agent', text, userText: 'Make these warmer\nand bigger', selectionSnapshot: snapshot });
  const request = wake.source!.requests[0]!;
  assert.equal(request.userText, 'Make these warmer\nand bigger');
  assert.deepEqual(request.selectionSnapshot, snapshot);
  assert.ok(wake.text.includes('Make these warmer\nand bigger'));
  assert.ok(!wake.text.includes('3 selected elements'), 'the snapshot is for the app, not added to the agent’s text');

  const plain = await pageWake('slides', { title: 'Send to agent', text });
  assert.equal(plain.source!.requests[0]!.userText, undefined);
  const same = (value: string) => value.replace(/\b(req|art)_\w+/g, '$1_').replace(/(parts-|Parts )\d+/g, '$1');
  assert.equal(same(plain.text), same(wake.text), 'the agent’s text is the same with or without the parts');
});

test('words that are not where text starts are left out; the snapshot stays', async () => {
  const wake = await pageWake('slides', { text: 'Page wrote this first. Then: warmer', userText: 'warmer', selectionSnapshot: snapshot });
  assert.equal(wake.source!.requests[0]!.userText, undefined);
  assert.equal(wake.source!.requests[0]!.selectionSnapshot?.count, 3);
});

test('a type that is not trusted here (unknown): userText is dropped, the snapshot is kept', async () => {
  const wake = await pageWake('greeter', { text: 'Warmer colors', userText: 'Warmer colors', selectionSnapshot: snapshot });
  const request = wake.source!.requests[0]!;
  assert.equal(request.userText, undefined);
  assert.equal(request.selectionSnapshot?.label, '3 selected elements');
});

test('a snapshot that is not one (no kind, count 0) is left out', async () => {
  const wake = await pageWake('slides', { text: 'Hi', userText: 'Hi', selectionSnapshot: { kind: '', label: 'x', count: 0 } });
  assert.equal(wake.source!.requests[0]!.selectionSnapshot, undefined);
  assert.equal(wake.source!.requests[0]!.userText, 'Hi');
});

test('the Shell’s Ask pane: its words are the userText, with no snapshot', async () => {
  const record = daemon.store.create({ root: join(workspace, `parts-${++n}`), type: 'slides', owner: owner(), title: 'Asked' });
  const before = delivered.length;
  const response = await fetch(`${state.url}/api/open-artifact.artifacts.ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: state.url },
    body: JSON.stringify({ id: record.id, text: 'Two lines\nof words' }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  await until(() => delivered.length > before);
  const request = delivered.at(-1)!.source!.requests[0]!;
  assert.equal(request.userText, 'Two lines\nof words');
  assert.equal(request.selectionSnapshot, undefined);
});
