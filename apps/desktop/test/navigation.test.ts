import type { ArtifactView } from '@open-artifact/protocol';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { Page as TestPage } from './lib/cdp.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * What a tab's page may do, in the running app: the web goes to the system browser (in test mode only logged), new
 * windows are never opened, other pages and frames are blocked, another artifact's Shell opens a tab of its own, the
 * daemon's home page goes to the first tab, the Shell's `close` closes the tab, permissions are denied, and `--open`
 * opens a tab on start. Also the guards before anything starts: a development run refuses port 4800 and the default
 * home.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { APP, cleanEnv, daemonState, electronBinary, freePort, leftovers, makeProfile, sleep, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 120_000 };
const inDocs = (url: string) => /\/docs\/[0-9a-f]+\//.test(url);

describe('navigation in a tab', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let first: ArtifactView;
  let second: ArtifactView;
  let view: TestPage;

  const shellPath = async () => new URL(await view.evaluate<string>('location.href')).pathname;
  const logged = (text: string, timeoutMs = 10_000) => until(() => app.lines.some((line) => line.includes(text)), timeoutMs);

  before(async () => {
    profile = makeProfile('oa-desktop-nav-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    const state = daemonState(profile);
    first = await library(state, 'artifacts.create', { type: 'docs', title: 'Harbour', blank: true, folder: join(profile.artifacts, 'harbour') });
    second = await library(state, 'artifacts.create', { type: 'docs', title: 'Lighthouse', blank: true, folder: join(profile.artifacts, 'lighthouse') });
    assert.ok(first.id && second.id, JSON.stringify({ first, second }));
    assert.equal((await app.open(first.id)).ok, true);
    view = await app.view(first.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    assert.ok(await until(async () => (await app.state()).tabs[0]?.status === 'ready', 15_000), 'the Shell never said it was ready');
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('a link to the web goes to the system browser, and the tab stays on its artifact', T, async () => {
    await view.evaluate<string>("location.href = 'https://example.com/elsewhere'; true");
    assert.ok(await logged('[desktop] external https://example.com/elsewhere'), app.lines.join('\n'));
    await sleep(300);
    assert.equal(await shellPath(), `/a/${first.id}`);
  });

  it('a link that carries a password is opened without it, and the log does not record it', T, async () => {
    await view.evaluate<string>("location.href = 'https://user:pw@example.com/x?token=secret#h'; true");
    assert.ok(await logged('[desktop] external https://example.com/x'), app.lines.join('\n'));
    assert.equal(
      app.lines.some((line) => line.includes('user:pw') || line.includes('token=secret')),
      false,
      app.lines.filter((line) => line.includes('example.com')).join('\n'),
    );
  });

  it('new windows are never opened: the web goes to the system browser, the rest is dropped', T, async () => {
    assert.equal(await view.evaluate<boolean>("window.open('https://example.org/popup') === null"), true);
    assert.ok(await logged('[desktop] external https://example.org/popup'), app.lines.join('\n'));
    assert.equal(await view.evaluate<boolean>(`window.open('/a/${second.id}') === null`), true);
    assert.ok(await logged(`blocked new window for http://127.0.0.1:${port}/a/${second.id}`), app.lines.join('\n'));
    assert.equal(await view.evaluate<boolean>("window.open('javascript:alert(1)') === null && window.open('file:///etc/passwd') === null"), true);
    assert.ok(await logged('[desktop] blocked external'), app.lines.join('\n'));
    assert.equal(app.lines.some((line) => line.includes('alert(1)') || line.includes('/etc/passwd')), false);
    const state = await app.state();
    assert.equal(state.tabs.length, 1);
    assert.equal((await app.cdp.targets()).filter((t) => t.type === 'page').length, 2, 'only the bar and the one view');
  });

  it('other pages of the daemon, and local files, are not shown in the tab', T, async () => {
    await view.evaluate<string>("location.href = '/types'; true");
    assert.ok(await logged(`blocked navigation to http://127.0.0.1:${port}/types`), app.lines.join('\n'));
    await view.evaluate<string>("location.href = 'file:///etc/hosts'; true");
    await sleep(500);
    assert.equal(await shellPath(), `/a/${first.id}`);
    assert.equal(new URL(await view.evaluate<string>('location.href')).protocol, 'http:');
  });

  it('a page gets no permission but writing to the clipboard', T, async () => {
    const asked = await view.evaluate<{ geolocation: PermissionState; notifications: NotificationPermission; camera: string }>(`(async () => ({
      geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
      notifications: await Notification.requestPermission(),
      camera: await navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'granted', (error) => error.name),
    }))()`);
    assert.notEqual(asked.geolocation, 'granted');
    assert.equal(asked.notifications, 'denied');
    assert.notEqual(asked.camera, 'granted');
    assert.ok(await logged('permission denied: notifications'), app.lines.join('\n'));
  });

  it('a frame from the web is not loaded into the page', T, async () => {
    await view.evaluate<boolean>(
      "(() => { const f = document.createElement('iframe'); f.id = 'probe'; f.src = 'https://example.com/framed'; document.body.append(f); return true; })()",
    );
    assert.ok(await logged('[desktop] blocked frame navigation to https://example.com/framed'), app.lines.join('\n'));
    const frames = await view.frames();
    assert.equal(
      frames.some((f) => f.url.startsWith('https://example.com')),
      false,
      JSON.stringify(frames.map((f) => f.url)),
    );
    await view.evaluate<void | undefined>("document.getElementById('probe')?.remove(); true");
  });

  it('the Shell going to another artifact (Duplicate, Copy as) opens it in a tab of its own', T, async () => {
    // As the Shell's Duplicate does: location.href = /a/<copy> + the page's own query.
    await view.evaluate<string>(`location.href = '/a/${second.id}' + location.search; true`);
    assert.ok(await until(async () => (await app.state()).tabs.length === 2, 15_000), JSON.stringify(await app.state()));
    const state = await app.state();
    assert.equal(state.current, second.id);
    assert.deepEqual(
      state.tabs.map((t) => t.id),
      [first.id, second.id],
    );
    assert.equal(await shellPath(), `/a/${first.id}`, 'the first tab stays on its artifact');
    const other = await app.view(second.id);
    assert.ok(await other.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the second doc did not draw');
    // Opening it again goes to its tab.
    assert.deepEqual(await app.open(first.id), { ok: true, id: first.id });
    assert.equal((await app.state()).current, first.id);
    assert.equal((await app.state()).tabs.length, 2);
  });

  it("the daemon's home page goes to the first tab", T, async () => {
    await view.evaluate<string>("location.href = '/'; true");
    assert.ok(await until(async () => (await app.state()).current === 'home', 10_000), JSON.stringify(await app.state()));
    assert.equal(await shellPath(), `/a/${first.id}`);
    assert.equal((await app.state()).tabs.length, 2);
  });

  it("the Shell's close closes its tab", T, async () => {
    // What the Shell's own close sends over its view channel (the app gave it a toolbar, so it shows no close button).
    // The request is not awaited in the page: the app removes the view as soon as the close arrives, which can be
    // before the page would answer, and an evaluate on a removed view never answers.
    const claimed = await view.evaluate<boolean>(`(() => {
      const claimed = JSON.parse(sessionStorage.getItem('open-artifact.view.${first.id}'));
      void fetch('/api/open-artifact.view', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true, body: JSON.stringify({ view: claimed.view, key: claimed.key, event: { openArtifact: 'close' } }) });
      return !!(claimed.view && claimed.key);
    })()`);
    assert.equal(claimed, true, 'the view had no claimed channel');
    assert.ok(await until(async () => (await app.state()).tabs.length === 1, 10_000), JSON.stringify(await app.state()));
    assert.deepEqual(
      (await app.state()).tabs.map((t) => t.id),
      [second.id],
    );
    assert.equal(
      (await app.cdp.targets()).some((t) => t.type === 'page' && t.url.includes(`/a/${first.id}`)),
      false,
      'the closed view is gone',
    );
  });

  it('a site subframe that redirects onto this computer is stopped', T, async () => {
    const hops: Record<string, string> = {
      '/to-loop': 'http://127.0.0.1:9/',
      '/to-v6': 'http://[::1]/',
      '/to-rfc': 'http://10.1.2.3/',
      '/to-lan': 'http://192.168.0.8/',
      '/to-link': 'http://169.254.169.254/',
      '/to-local': 'http://not-declared.localhost/',
    };
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      const next = hops[path];
      if (next) {
        res.writeHead(302, { location: next });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>probe</title>');
    });
    const origin = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const probePort = typeof address === 'object' && address ? address.port : 0;
        resolve(`http://127.0.0.1:${probePort}`);
      });
    });
    try {
      const id = await app.chrome.evaluate<string>(`desktop.test.probeSite(${JSON.stringify(origin)})`);
      assert.equal(id, 'site:probe');
      const target = await app.cdp.waitTarget((info) => info.type === 'page' && info.url.startsWith(origin));
      const site = await app.cdp.attach(target.targetId);
      await site.send('Runtime.enable');
      await site.send('Page.enable');
      for (const path of Object.keys(hops)) {
        await site.evaluate<boolean>(
          `(() => { const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(path)}; document.body.append(frame); return true; })()`,
        );
      }
      for (const next of Object.values(hops)) {
        assert.ok(await logged(`[desktop] blocked frame navigation to ${next}`), app.lines.join('\n'));
      }
      const frames = await site.frames();
      for (const next of Object.values(hops)) {
        assert.equal(
          frames.some((frame) => frame.url.startsWith(next)),
          false,
          JSON.stringify(frames.map((frame) => frame.url)),
        );
      }
      await app.chrome.evaluate(`desktop.close('site:probe')`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('a failed open closes the view it attached and drops its shell listener', T, async () => {
    const made = await library(daemonState(profile), 'artifacts.create', {
      type: 'docs',
      title: 'Failed',
      blank: true,
      folder: join(profile.artifacts, 'failed'),
    });
    assert.ok(made.id, JSON.stringify(made));
    const before = await app.chrome.evaluate<{ children: number; listeners: number; attached: number; closed: number; ids: string[] }>(
      'desktop.test.views()',
    );
    await app.chrome.evaluate('desktop.test.failNextLoad()');
    const opened = await app.open(made.id);
    assert.equal(opened.ok, false);
    const state = await app.state();
    assert.equal(state.current, 'home', 'the home page is in front');
    assert.equal(
      state.tabs.some((tab) => tab.id === made.id),
      false,
    );
    const after = await app.chrome.evaluate<typeof before>('desktop.test.views()');
    assert.equal(after.attached, before.attached + 1, 'the shell listener was never attached');
    assert.equal(after.listeners, before.listeners, 'the shell listener is still attached');
    assert.equal(after.closed, before.closed + 1, 'the view was not closed');
    assert.equal(after.children, before.children, 'the view is still in the window');
    assert.equal(after.ids.includes(made.id), false);
    assert.equal(
      (await app.cdp.targets()).some((target) => target.type === 'page' && target.url.includes(`/a/${made.id}`)),
      false,
      'the closed view is still a page',
    );
  });

  it('started again with --open, the app opens that artifact in a tab, on the daemon that kept running', T, async () => {
    const pid = present(daemonState(profile)).pid;
    assert.equal((await app.quit())?.code, 0);
    app = await launchApp(profile, port, { args: ['--open', first.id] });
    const ready = JSON.parse((await app.line(/\[desktop\] ready /)).replace(/^.*\[desktop\] ready /, '')) as {
      daemon: { pid: number; url: string; version: string };
      features: boolean;
    };
    assert.equal(ready.daemon.pid, pid, 'the app started another daemon');
    await app.connect();
    assert.ok(await until(async () => (await app.state()).tabs[0]?.status === 'ready', 30_000), JSON.stringify(await app.state()));
    const state = await app.state();
    assert.deepEqual(
      state.tabs.map((t) => t.id),
      [first.id],
    );
    assert.equal(state.current, first.id);
  });
});

describe('the guards before anything starts', () => {
  const run = (args: string[], profile: TestProfile, port: number) =>
    spawnSync(electronBinary(), [APP, '--test-mode', ...args], { env: cleanEnv(profile, port), encoding: 'utf8', timeout: 60_000 });

  it('a development run refuses port 4800, and the default home, and starts nothing', T, async () => {
    const profile = makeProfile('oa-desktop-guard-');
    try {
      const port = await freePort();
      const on4800 = run(['--home', profile.oaHome, '--port', '4800'], profile, port);
      assert.equal(on4800.status, 2, on4800.stderr);
      assert.match(on4800.stderr, /4800/);
      // No --home: the default home (under the profile's HOME, and the account's own) is refused.
      const noHome = spawnSync(electronBinary(), [APP, '--test-mode', '--port', String(port)], {
        env: { ...cleanEnv(profile, port), OPEN_ARTIFACT_HOME: '' },
        encoding: 'utf8',
        timeout: 60_000,
      });
      assert.equal(noHome.status, 2, noHome.stderr);
      assert.match(noHome.stderr, /default home/);
      assert.equal(daemonState(profile), null, 'no daemon was started');
      assert.deepEqual(leftovers(profile), []);
    } finally {
      if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    }
  });
});
