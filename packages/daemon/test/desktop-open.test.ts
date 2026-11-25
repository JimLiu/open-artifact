/**
 * "Open agents' artifacts in the app" (`settings.json`'s `openInDesktop`, `desktop.settings`): the step that would open
 * this computer's browser for an agent's `Artifact open` goes to Open Artifact Desktop instead: its adapter when it is
 * connected, else the app started with the artifact's `open-artifact://` link (an injected launcher here), else the
 * browser. Off (the default), nothing changes; hosts that show pages themselves are not affected; only the person
 * turns it on.
 */

import { TEST_HOME, tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { HARNESS_PATH, HARNESS_SUBPROTOCOL, type DaemonState, type SessionRef } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';

let daemon: Daemon;
let state: DaemonState;
const browsed: string[] = [];
const launched: string[] = [];
let launchAnswer = true;
const workspace = tempDir('open-artifact-desktop-ws-');
/** An agent whose app cannot show pages; its profile opens them in the browser. */
const agent: SessionRef = { harness: 'claude-code', session: 'desktop-test', workspace };

before(async () => {
  const shellDir = tempDir('open-artifact-shell-');
  writeFileSync(join(shellDir, 'index.html'), '<!doctype html><title>shell</title>');
  daemon = await startDaemon({
    port: 0,
    quiet: true,
    shellDir,
    homeDir: shellDir,
    browse: (url) => (browsed.push(url), true),
    launchDesktop: async (url) => (launched.push(url), launchAnswer),
  });
  state = (await readDaemon())!;
});

after(() => daemon.close());

/** A minimal adapter on the Harness API socket that answers `host.open` with `opened`. */
async function adapter(harness: string, caps: Record<string, unknown>, opened = true) {
  const ws = new WebSocket(`${state.url.replace(/^http/, 'ws')}${HARNESS_PATH}`, [HARNESS_SUBPROTOCOL]);
  await new Promise<void>((ok, fail) => {
    ws.addEventListener('open', () => ok(), { once: true });
    ws.addEventListener('error', () => fail(new Error('no connection')), { once: true });
  });
  const answers = new Map<number, { result?: any; error?: unknown }>();
  const opens: any[] = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method && message.id !== undefined) {
      if (message.method === 'host.open') opens.push(message.params);
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'host.open' ? { opened } : { ok: true } }));
    } else if (message.id !== undefined) answers.set(message.id, message);
  });
  let next = 1;
  const call = async (method: string, params: unknown) => {
    const id = next++;
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    await until(() => answers.has(id), 5000);
    return answers.get(id)!;
  };
  assert.equal((await call('hello', { harness, token: state.token, caps })).error, undefined);
  return {
    opens,
    call,
    close: async () => {
      ws.close();
      await until(() => ![...daemon.harnesses.connections].some((c) => c.harness === harness), 5000);
    },
  };
}

const DESKTOP_CAPS = { open: { embed: 'view', origins: [] } };

const create = async (title: string) => (await daemon.tools.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title }, agent)) as Record<string, any>;
const open = async (url: string, caller: SessionRef = agent) => (await daemon.tools.call('Artifact', { action: 'open', url }, caller)) as Record<string, any>;

const saved = () => {
  const file = join(TEST_HOME, 'settings.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

const setting = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${state.url}/api/open-artifact.desktop.settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${state.token}`, ...headers },
    body: JSON.stringify(body),
  });

test('desktop: off (the default), an agent\'s open goes to the browser as before, even with the app connected', async () => {
  const read = await fetch(`${state.url}/api/open-artifact.desktop.settings`, { headers: { authorization: `Bearer ${state.token}` } });
  assert.deepEqual(await read.json(), { openInDesktop: false });
  const app = await adapter('open-artifact-desktop', DESKTOP_CAPS);
  try {
    const made = await create('Off board');
    const before = browsed.length;
    const opened = await open(made.url);
    assert.equal(opened.opened, true);
    assert.equal(opened.opened_in, 'browser');
    assert.equal(browsed.length, before + 1);
    assert.equal(app.opens.length, 0, 'the app was not asked');
    assert.equal(launched.length, 0, 'the app was not started');
  } finally {
    await app.close();
  }
});

test('desktop: only the person turns it on: refused inside an agent\'s session and from another origin; saved in settings.json', async () => {
  const fromAgent = await setting({ openInDesktop: true }, { 'x-open-artifact-agent': 'claude-code:abc' });
  assert.equal(fromAgent.status, 403);
  assert.equal(((await fromAgent.json()) as { code: string }).code, 'not_granted');
  const foreign = await setting({ openInDesktop: true }, { origin: 'http://art.frame.localhost:1' });
  assert.equal(foreign.status, 403);
  assert.equal((await setting({ openInDesktop: 'yes' })).status, 400);
  assert.equal(saved().openInDesktop, undefined, 'nothing saved yet');

  const done = await setting({ openInDesktop: true });
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { openInDesktop: true });
  assert.equal(saved().openInDesktop, true);
  assert.match(readFileSync(join(TEST_HOME, 'logs', 'daemon.log'), 'utf8'), /audit: agents' artifacts open in Open Artifact Desktop, asked by /);
});

test('desktop: on, with the app connected, the page goes to it (host.open, no session) and not to the browser', async () => {
  const app = await adapter('open-artifact-desktop', DESKTOP_CAPS);
  try {
    const made = await create('App board');
    const before = browsed.length;
    const opened = await open(made.url);
    assert.equal(opened.opened, true);
    assert.equal(opened.opened_in, 'desktop');
    assert.equal(browsed.length, before, 'the browser was not called');
    assert.equal(launched.length, 0, 'connected: nothing started');
    assert.equal(app.opens.length, 1);
    assert.equal(app.opens[0].url, made.url);
    assert.equal(app.opens[0].session, null);
    assert.equal(app.opens[0].view_url, opened.view_url);
  } finally {
    await app.close();
  }
});

test('desktop: on, with the app not connected, it is started with the open-artifact:// link; when that fails, the browser', async () => {
  const made = await create('Launch board');
  launchAnswer = true;
  const before = browsed.length;
  const opened = await open(made.url);
  assert.equal(opened.opened_in, 'desktop');
  assert.deepEqual(launched, [made.url]);
  assert.match(made.url, /^open-artifact:\/\/artifact\/art_/);
  assert.equal(browsed.length, before);

  launchAnswer = false;
  const fallback = await open(made.url);
  assert.equal(fallback.opened, true);
  assert.equal(fallback.opened_in, 'browser');
  assert.equal(launched.length, 2);
  assert.equal(browsed.at(-1), fallback.view_url);
  launchAnswer = true;
});

test('desktop: on, a running app that answers host.open not opened is passed over for the browser (not started again)', async () => {
  const app = await adapter('open-artifact-desktop', DESKTOP_CAPS, false);
  try {
    const made = await create('Declined board');
    const count = launched.length;
    const before = browsed.length;
    const opened = await open(made.url);
    assert.equal(app.opens.length, 1);
    assert.equal(opened.opened_in, 'browser');
    assert.equal(launched.length, count, 'not started again');
    assert.equal(browsed.length, before + 1);
  } finally {
    await app.close();
  }
});

test('desktop: on, a host that shows pages itself still shows them; a caller with no browser step opens nothing', async () => {
  const host = await adapter('claude-code', { open: { embed: 'frame', origins: ['app://host'] } });
  const desktop = await adapter('open-artifact-desktop', DESKTOP_CAPS);
  try {
    await host.call('session.attach', { session: 'desktop-test', workspace });
    const made = await create('Host board');
    const counts = { browsed: browsed.length, launched: launched.length };
    const shown = await open(made.url);
    assert.equal(shown.opened, true);
    assert.equal(shown.opened_in, undefined, 'shown in the agent\'s own app');
    assert.equal(host.opens.length, 1);
    assert.equal(desktop.opens.length, 0);

    const plain: SessionRef = { harness: 'cli', session: null, workspace };
    const none = await open(made.url, plain);
    assert.equal(none.opened, false);
    assert.equal(desktop.opens.length, 0);
    assert.deepEqual({ browsed: browsed.length, launched: launched.length }, counts);
  } finally {
    await host.close();
    await desktop.close();
  }
});

test('desktop: turned off again, the browser step is as before', async () => {
  assert.deepEqual(await (await setting({ openInDesktop: false })).json(), { openInDesktop: false });
  const made = await create('Off again');
  const count = launched.length;
  const opened = await open(made.url);
  assert.equal(opened.opened_in, 'browser');
  assert.equal(launched.length, count);
});

test('desktop: the system launcher starts nothing where $OPEN_ARTIFACT_DESKTOP_LAUNCH is off, nor for another link', async () => {
  const { systemLaunchDesktop } = await import('../src/harness.ts');
  assert.equal(process.env.OPEN_ARTIFACT_DESKTOP_LAUNCH, 'off');
  assert.equal(await systemLaunchDesktop('open-artifact://artifact/art_x'), false);
  const was = process.env.OPEN_ARTIFACT_DESKTOP_LAUNCH;
  process.env.OPEN_ARTIFACT_DESKTOP_LAUNCH = '';
  try {
    // Not an artifact link: refused before anything is spawned.
    assert.equal(await systemLaunchDesktop('https://example.com/'), false);
    assert.equal(await systemLaunchDesktop('open-artifact://artifact/art_x;rm'), false);
  } finally {
    process.env.OPEN_ARTIFACT_DESKTOP_LAUNCH = was;
  }
});
