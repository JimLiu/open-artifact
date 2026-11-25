import type { ArtifactView } from '@open-artifact/protocol';
import { objectOf } from '../src/errors.ts';
import type { TabSnapshot } from '../src/tabs.ts';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { Page as TestPage } from './lib/cdp.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * The app end to end, driven over DevTools with its window never shown and no `node` on PATH: start, open a blank doc
 * in a tab, write in it (the words reach the artifact's folder; the tab shows while something is unsaved), no Node or
 * bridge in the view, the tab comes back after `open-artifact daemon restart` and after the daemon is stopped (the bar
 * says it is reconnecting, the view stays, the kit starts a daemon again), and the daemon outlives the app.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { alive, cleanEnv, daemonState, electronBinary, freePort, leftovers, makeProfile, RUNTIME, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 120_000 };
const WORDS = 'The ferry leaves at nine.';
const inDocs = (url: string) => /\/docs\/[0-9a-f]+\//.test(url);

/** Every file under `dir` as text, joined. */
function treeText(dir: string) {
  let text = '';
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    text += statSync(path).isDirectory() ? treeText(path) : readFileSync(path, 'utf8');
  }
  return text;
}

describe('the app, in test mode', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let doc: ArtifactView;
  let view: TestPage;

  before(async () => {
    profile = makeProfile('oa-desktop-smoke-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it("starts with no node on PATH, its daemon on the port it was given, Electron's folders in the profile", T, async () => {
    const ready = JSON.parse((await app.line(/\[desktop\] ready /)).replace(/^.*\[desktop\] ready /, '')) as {
      daemon: { pid: number; url: string; version: string };
      features: boolean;
    };
    assert.equal(new URL(ready.daemon.url).port, String(port));
    assert.equal(ready.features, true, 'the daemon has view.open');
    const state = daemonState(profile);
    assert.equal(present(state).pid, ready.daemon.pid);
    for (const dir of ['user-data', 'session', 'logs', 'crash-dumps']) assert.ok(statSync(join(profile.oaHome, 'desktop', dir)).isDirectory(), dir);
    assert.ok(readdirSync(join(profile.oaHome, 'desktop', 'session')).length > 0, 'Electron keeps its session data in the profile');
  });

  it('opens a blank doc in a tab, with the Shell in its own view', T, async () => {
    const made = await library(daemonState(profile), 'artifacts.create', {
      type: 'docs',
      title: 'Ferry notes',
      blank: true,
      folder: join(profile.artifacts, 'ferry'),
    });
    assert.ok(made.id, JSON.stringify(made));
    doc = made;
    const opened = await app.open(made.id);
    assert.deepEqual(opened, { ok: true, id: made.id });
    view = await app.view(made.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    const state = await app.state();
    assert.equal(state.current, made.id);
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].title, 'Ferry notes');
    assert.ok(await until(async () => (await app.state()).tabs[0].status === 'ready', 15_000), 'the Shell never said it was ready');
    // The bar shows the tab.
    assert.ok(
      await app.chrome.waitFor(`!!document.querySelector('[data-tab="${made.id}"][aria-selected="true"]')`, 5000),
      await app.chrome.evaluate<string>("document.getElementById('bar').outerHTML"),
    );
  });

  it("typing in the editor writes the words into the artifact's folder, and the tab shows while they are not saved", T, async () => {
    // Watch every state the bar gets.
    await app.chrome.evaluate<never[]>(
      'window.__seen = []; desktop.onState((s) => window.__seen.push(s.tabs.map((t) => ({ unsaved: t.unsaved, saved: t.saved })))); true',
    );
    const placed = await view.inFrame<boolean>(
      inDocs,
      `(() => { const p = document.querySelector('.doc-text p'); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return document.activeElement === root; })()`,
    );
    assert.equal(placed, true, 'the editor did not take focus');
    await view.type(WORDS);
    assert.ok(
      await view.waitInFrame(inDocs, `document.querySelector('.doc-text')?.innerText.includes(${JSON.stringify(WORDS)})`),
      'the words are not in the doc',
    );
    assert.ok(await until(() => treeText(join(doc.root, 'doc')).includes(WORDS), 15_000), 'the words did not reach the folder');
    assert.ok(
      await until(async () => (await app.state()).tabs[0].saved === 'saved' && !(await app.state()).tabs[0].unsaved, 15_000),
      'the tab does not say saved',
    );
    const seen = (await app.chrome.evaluate<TabSnapshot[][]>('window.__seen')).flat();
    assert.ok(
      seen.some((t) => t.unsaved),
      `the tab never showed unsaved work: ${JSON.stringify(seen)}`,
    );
  });

  it('the view has no Node, no preload and no bridge, in the Shell or the editor', T, async () => {
    const probe =
      "[typeof window.require, typeof window.process, typeof window.module, typeof window.desktop, typeof window.electron, typeof window.ipcRenderer, typeof globalThis.Buffer].join(',')";
    const none = 'undefined,undefined,undefined,undefined,undefined,undefined,undefined';
    assert.equal(await view.evaluate<string>(probe), none);
    // In the editor's own frame, in its own world (not an isolated one).
    const frame = (await view.frames()).find((f) => inDocs(f.url));
    const contexts: import('devtools-protocol').Protocol.Runtime.ExecutionContextDescription[] = [];
    const stop = app.cdp.on(
      (message) => message.method === 'Runtime.executionContextCreated' && message.sessionId === view.sessionId && contexts.push(message.params.context),
    );
    await view.send('Runtime.disable');
    await view.send('Runtime.enable');
    stop();
    const main = contexts.find((c) => objectOf(c.auxData).frameId === present(frame).id && objectOf(c.auxData).isDefault === true);
    assert.ok(main, 'no main world for the editor frame');
    assert.equal(await view.evaluate<string>(probe, main.id), none);
    // The bar itself has its bridge (so the check above checks something).
    assert.equal(
      await app.chrome.evaluate<'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function'>('typeof window.desktop'),
      'object',
    );
  });

  it('after open-artifact daemon restart the tab reconnects and shows the doc again', T, async () => {
    const before = present(daemonState(profile)).pid;
    const restart = spawnSync(electronBinary(), [join(RUNTIME, 'scripts', 'open-artifact.mjs'), 'daemon', 'restart'], {
      env: cleanEnv(profile, port, { ELECTRON_RUN_AS_NODE: '1' }),
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(restart.status, 0, restart.stderr || restart.stdout);
    const after = daemonState(profile);
    assert.notEqual(present(after).pid, before);
    assert.equal(alive(before), false);
    assert.equal(new URL(present(after).url).port, String(port));
    assert.ok(await until(() => app.lines.some((line) => line.includes('connection disconnected')), 15_000), 'the app never saw the daemon go');
    assert.ok(await until(async () => (await app.state()).connected, 30_000), 'the app did not reconnect');
    assert.ok(
      await until(async () => (await app.state()).tabs[0]?.status === 'ready', 30_000),
      `the tab did not come back: ${JSON.stringify(await app.state())}`,
    );
    view = await app.view(doc.id);
    assert.ok(
      await view.waitInFrame(inDocs, `document.querySelector('.doc-text')?.innerText.includes(${JSON.stringify(WORDS)})`),
      'the doc does not show the words after the restart',
    );
    const state = await app.state();
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].id, doc.id);
  });

  it('when the daemon is stopped the bar says so and the view stays; the kit starts a daemon again and the tab comes back', T, async () => {
    // What the bar draws, as it draws it (the reconnecting state can be short).
    await app.chrome.evaluate<boolean>(`(() => {
      window.__bar = [];
      const note = () => window.__bar.push({ connection: document.getElementById('connection').textContent, status: document.querySelector('[data-tab="${doc.id}"]')?.dataset.status ?? null });
      new MutationObserver(note).observe(document.getElementById('bar'), { subtree: true, childList: true, characterData: true, attributes: true });
      return true;
    })()`);
    const drops = () => app.lines.filter((line) => line.includes('connection disconnected')).length;
    const dropped = drops();
    const stopped = await stopDaemon(profile);
    assert.ok(stopped, 'no daemon to stop');
    assert.equal(alive(stopped), false);
    assert.ok(await until(() => drops() > dropped, 15_000), 'the app never saw the daemon go');
    // The view is still there, on its artifact, while the daemon is away.
    const targets = await app.cdp.targets();
    assert.ok(
      targets.some((t) => t.type === 'page' && new URL(t.url).pathname === `/a/${doc.id}`),
      'the view went away with the daemon',
    );
    // The kit reconnects by starting a daemon again (ensureDaemon), with this app's runtime, detached.
    assert.ok(
      await until(() => daemonState(profile)?.pid && present(daemonState(profile)).pid !== stopped && alive(present(daemonState(profile)).pid), 30_000),
      'no daemon came back',
    );
    const again = daemonState(profile);
    assert.equal(new URL(present(again).url).port, String(port));
    assert.ok(
      await until(async () => (await app.state()).connected && (await app.state()).tabs[0]?.status === 'ready', 30_000),
      JSON.stringify(await app.state()),
    );
    const bar = await app.chrome.evaluate<{ connection: string; status: string }[]>('window.__bar');
    assert.ok(
      bar.some((b) => b.connection === 'Reconnecting to Open Artifact…' && b.status === 'reconnecting'),
      `the bar never said it was reconnecting: ${JSON.stringify(bar)}`,
    );
    view = await app.view(doc.id);
    assert.ok(
      await view.waitInFrame(inDocs, `document.querySelector('.doc-text')?.innerText.includes(${JSON.stringify(WORDS)})`),
      'the doc does not show the words after the daemon came back',
    );
  });

  it('quitting the app leaves the daemon running', T, async () => {
    const pid = present(daemonState(profile)).pid;
    const exit = await app.quit();
    assert.equal(exit?.code, 0, JSON.stringify(exit));
    assert.equal(alive(pid), true, 'the daemon ended with the app');
    // Stopped here by its pid (after() checks nothing else is left).
    assert.equal(await stopDaemon(profile), pid);
    assert.equal(alive(pid), false);
  });
});
