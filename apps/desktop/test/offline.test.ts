import type { BlockedRequest } from '../src/contracts.ts';
import type { TabSnapshot } from '../src/tabs.ts';
import { present } from './lib/assertions.ts';
import type { ProcessInfo, TestProfile } from './lib/env.ts';
interface OfflineReport {
  first?: BlockedRequest[] | null;
  again?: BlockedRequest[] | null;
  blocked?: BlockedRequest[] | null;
  proxy?: string[];
  export?: { file: string; bytes: number; zip?: boolean } | { file: null; said: string; log: string[] };
}
/**
 * With no network: Docs, Sheets, Slides and Whiteboard each made new, edited, the edit on disk, the app quit, opened
 * again, the edit still shown, and exported once (the file non-empty, of the right format). The UI must not hang
 * loading: the Shell says it is ready and the editor draws.
 *
 * "No network": test mode's `--offline` refuses every request a page of the app makes past this computer (the
 * window's, the views', the thumbnails'), and the daemon and its type servers (which are not pages) are pointed at a
 * proxy of this test's that refuses everything it is asked (`HTTP(S)_PROXY` with `NODE_USE_ENV_PROXY=1`, this
 * computer left out by `NO_PROXY`). What each was refused is listed as it is (the test's diagnostics, and the file
 * `OA_DESKTOP_OFFLINE_REPORT` names, when set); none of it may be needed for the steps above to work.
 *
 * The edit is waited for on disk and in the tab's saved state before the app quits: no fixed waits.
 *
 * Then: `ps -E` shows the daemon and at least one type server under it running with `HTTP_PROXY`, `HTTPS_PROXY` and
 * `NODE_USE_ENV_PROXY=1`; and Slides is exported as PowerPoint with its current fonts, whose outcome (a file, or what
 * was shown) and what was refused are reported, not asserted: that export may need fonts from the network.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { buttonNamed } from './lib/cdp.ts';
import { editorFrame, TYPES } from './lib/editing.ts';
import { cleanEnv, daemonState, electronBinary, freePort, leftovers, makeProfile, processes, stopDaemon, treeOf, until } from './lib/env.ts';

const T = { timeout: 240_000 };
const NO_PROXY = 'localhost,127.0.0.1,::1,.localhost';

describe('offline: each type works with no network', () => {
  let profile: TestProfile;
  let port: number;
  let proxy: ReturnType<typeof createServer>;
  /** What the refusing proxy was asked, in order. */
  const proxied: string[] = [];
  const report: Record<string, OfflineReport> = {};
  let env: NodeJS.ProcessEnv;

  before(async () => {
    profile = makeProfile('oa-desktop-offline-');
    port = await freePort();
    proxy = createServer((req, res) => {
      proxied.push(`${req.method} ${req.url}`);
      res.writeHead(403).end('offline');
    });
    proxy.on('connect', (req, socket) => {
      proxied.push(`CONNECT ${req.url}`);
      socket.on('error', () => {});
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    const at = `http://127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`;
    env = { HTTP_PROXY: at, HTTPS_PROXY: at, http_proxy: at, https_proxy: at, NO_PROXY, no_proxy: NO_PROXY, NODE_USE_ENV_PROXY: '1' };
  });

  after(async () => {
    await stopDaemon(profile);
    proxy?.close();
    if (process.env.OA_DESKTOP_OFFLINE_REPORT)
      writeFileSync(process.env.OA_DESKTOP_OFFLINE_REPORT, `${JSON.stringify({ ...report, proxy: proxied }, null, 2)}\n`);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it("the proxy catches what a Node process of the app's asks of an address past NO_PROXY", T, async () => {
    // 127.0.0.2 is not in NO_PROXY (fetch refuses port 9 outright, so another): through the proxy when the variables
    // work (Node's proxy always tunnels, a CONNECT the proxy refuses), only this computer asked when they do not.
    const child = spawn(
      electronBinary(),
      [
        '-e',
        "fetch('http://127.0.0.2:59999/offline-check').then((r) => console.log(r.status), (e) => console.log('failed', e.cause?.code ?? e.cause?.message ?? e.message))",
      ],
      {
        env: cleanEnv(profile, port, { ...env, ELECTRON_RUN_AS_NODE: '1' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk));
    const code = await new Promise((done) => child.on('exit', done));
    assert.equal(code, 0, out);
    assert.ok(proxied.includes('CONNECT 127.0.0.2:59999'), `the proxy was not used: ${JSON.stringify(proxied)} ${out}`);
    assert.match(out, /^failed/, 'a refused tunnel must fail the fetch');
    proxied.length = 0;
  });

  for (const [type, how] of Object.entries(TYPES)) {
    it(`${type}: new, edited, on disk; quit and opened again, still there; exported`, T, async (t) => {
      const frame = editorFrame(type);
      const asked = proxied.length;
      let app = await launchApp(profile, port, { args: ['--offline'], env });
      let id: string;
      let root: string;
      try {
        await app.line(/\[desktop\] offline: only this computer is reachable/);
        await app.line(/\[desktop\] ready /);
        await app.connect();
        assert.ok(await until(async () => JSON.stringify(await app.menu()).includes(`"new:${type}"`), 20_000), 'File ▸ New has no such type');
        const made = await app.command(`new:${type}`);
        assert.ok(made.ok, JSON.stringify(made));
        id = made.value.id;
        root = (await library(daemonState(profile), `artifact?id=${id}`)).root;
        const view = await app.view(id);
        assert.ok(await until(async () => (await app.state()).tabs.find((x) => x.id === id)?.status === 'ready', 30_000), 'the Shell never said it was ready');
        assert.ok(await view.waitInFrame(frame, how.drawn, 30_000), 'the editor did not draw');
        if (type === 'docs') {
          // --offline really refuses: the page asks an address past this computer (TEST-NET, routed nowhere), and is
          // refused before anything goes out.
          await view.evaluate<boolean>("fetch('http://192.0.2.1/offline-probe').catch(() => null), true");
          assert.ok(
            await until(
              async () =>
                (await app.chrome.evaluate<import('../src/contracts').BlockedRequest[]>('desktop.test.blocked()')).some((b) =>
                  b.url.includes('192.0.2.1/offline-probe'),
                ),
              10_000,
            ),
            "--offline did not refuse the page's request",
          );
        }
        await how.edit(view, frame);
        assert.ok(await until(() => how.onDisk(root), 20_000), 'the edit did not reach the folder');
        let tab: TabSnapshot | undefined | null = null;
        const saved = await until(async () => {
          tab = (await app.state()).tabs.find((x) => x.id === id);
          return tab?.saved === 'saved' && !tab.unsaved;
        }, 20_000);
        assert.ok(saved, `the tab does not say saved: ${JSON.stringify(tab)}`);
      } finally {
        report[type] = { first: await app.chrome?.evaluate<import('../src/contracts').BlockedRequest[]>('desktop.test.blocked()').catch(() => null) };
        await app.quit();
      }
      assert.ok(how.onDisk(root), 'the edit is not on disk after quitting');

      app = await launchApp(profile, port, { args: ['--offline', '--open', id], env });
      try {
        await app.line(/\[desktop\] ready /);
        await app.connect();
        const view = await app.view(id);
        assert.ok(
          await until(async () => (await app.state()).tabs.find((x) => x.id === id)?.status === 'ready', 30_000),
          'the Shell never said it was ready (again)',
        );
        assert.ok(await view.waitInFrame(frame, how.drawn, 30_000), 'the editor did not draw (again)');
        assert.ok(await view.waitInFrame(frame, how.shown, 20_000), 'the edit is not shown after opening it again');
        // Export.
        const downloads = join(profile.home, 'Downloads');
        const files = () => (existsSync(downloads) ? readdirSync(downloads) : []);
        const before = files();
        await view.clickOn(how.share === 'Share' ? "document.querySelector('button[aria-label=Share]')" : buttonNamed('Artifact options'));
        await view.clickOn(buttonNamed('Export'));
        await view.clickOn(`document.querySelector('[data-export-row="${how.export.row}"]:not([disabled])')`, { timeoutMs: 15_000 });
        let name: string | null | undefined = null;
        await until(() => (name = files().find((f) => !before.includes(f) && f.endsWith(how.export.ext))), 60_000);
        assert.ok(name, `no ${how.export.ext} exported: ${files().join(', ')}\n${app.lines.slice(-15).join('\n')}`);
        const bytes = readFileSync(join(downloads, name));
        assert.ok(bytes.length > 0, 'the export is empty');
        assert.ok(how.export.check(bytes), `${name} is not a ${how.export.ext}`);
        report[type].export = { file: name, bytes: bytes.length };
      } finally {
        report[type].again = await app.chrome?.evaluate<import('../src/contracts').BlockedRequest[]>('desktop.test.blocked()').catch(() => null);
        report[type].proxy = proxied.slice(asked);
        await app.quit();
      }
      const listed = [...(report[type].first ?? []), ...(report[type].again ?? [])]
        .filter((b) => !b.url.includes('/offline-probe'))
        .map((b) => `${b.session} ${b.type} ${b.url}`);
      t.diagnostic(`${type} refused by --offline: ${listed.length ? listed.join(' | ') : 'nothing'}`);
      t.diagnostic(`${type} refused by the proxy (daemon, type servers): ${report[type].proxy.length ? report[type].proxy.join(' | ') : 'nothing'}`);
    });
  }

  it('the daemon and the type servers run with the proxy variables; Slides as PowerPoint with its current fonts (reported)', T, async (t) => {
    const asked = proxied.length;
    const app = await launchApp(profile, port, { args: ['--offline'], env });
    const outcome: OfflineReport = {};
    try {
      await app.line(/\[desktop\] ready /);
      await app.connect();
      const made = await app.command('new:slides');
      assert.ok(made.ok, JSON.stringify(made));
      const id = made.value.id;
      const view = await app.view(id);
      const frame = editorFrame('slides');
      assert.ok(await until(async () => (await app.state()).tabs.find((x) => x.id === id)?.status === 'ready', 30_000), 'the Shell never said it was ready');
      assert.ok(await view.waitInFrame(frame, TYPES.slides.drawn, 30_000), 'the editor did not draw');
      await TYPES.slides.edit(view, frame);
      const root = (await library(daemonState(profile), `artifact?id=${id}`)).root;
      assert.ok(await until(() => TYPES.slides.onDisk(root), 20_000), 'the slide did not reach the folder');

      // ps -E: the daemon (started by the kit, detached) and its type servers, with their environment.
      const daemon = present(daemonState(profile)).pid;
      let tree: ProcessInfo[] = [];
      const hasProxy = (p: ProcessInfo) =>
        p.command.includes(` HTTP_PROXY=${env.HTTP_PROXY}`) &&
        p.command.includes(` HTTPS_PROXY=${env.HTTPS_PROXY}`) &&
        / NODE_USE_ENV_PROXY=1( |$)/.test(p.command);
      assert.ok(await until(() => (tree = treeOf(daemon, processes({ withEnv: true }))).length > 1, 20_000), 'the daemon runs no type server');
      const [self, ...servers] = tree;
      assert.equal(self.pid, daemon);
      assert.ok(hasProxy(self), `the daemon runs without the proxy variables: ${self.command.slice(0, 200)}…`);
      const withProxy = servers.filter(hasProxy);
      assert.ok(withProxy.length >= 1, `no type server runs with the proxy variables: ${servers.map((p) => p.command.slice(0, 160)).join(' | ')}`);
      t.diagnostic(`proxy variables on the daemon (${daemon}) and ${withProxy.length} of ${servers.length} processes under it`);

      // Export with the current fonts: what it needs from the network is what this records; its outcome is reported.
      const downloads = join(profile.home, 'Downloads');
      const files = () => (existsSync(downloads) ? readdirSync(downloads) : []);
      const before = files();
      const row = 'PowerPoint · PowerPoint, current fonts';
      await view.clickOn(buttonNamed('Artifact options'));
      await view.clickOn(buttonNamed('Export'));
      await view.clickOn(`document.querySelector('[data-export-row="${row}"]:not([disabled])')`, { timeoutMs: 15_000 });
      let name: string | null | undefined = null;
      await until(() => (name = files().find((f) => !before.includes(f) && f.endsWith('.pptx'))), 90_000);
      if (name) {
        const bytes = readFileSync(join(downloads, name));
        outcome.export = { file: name, bytes: bytes.length, zip: bytes.subarray(0, 2).toString() === 'PK' };
      } else {
        outcome.export = { file: null, said: (await view.evaluate<string>('document.body.innerText').catch(() => '')).slice(-600), log: app.lines.slice(-20) };
      }
    } finally {
      outcome.blocked = await app.chrome?.evaluate<import('../src/contracts').BlockedRequest[]>('desktop.test.blocked()').catch(() => null);
      outcome.proxy = proxied.slice(asked);
      report.slidesCurrentFonts = outcome;
      await app.quit({ force: true });
    }
    t.diagnostic(`slides, current fonts: ${JSON.stringify(outcome.export)}`);
    t.diagnostic(
      `slides, current fonts, refused by --offline: ${(outcome.blocked ?? []).map((b) => `${b.session} ${b.type} ${b.url}`).join(' | ') || 'nothing'}`,
    );
    t.diagnostic(`slides, current fonts, refused by the proxy: ${outcome.proxy.join(' | ') || 'nothing'}`);
  });
});
