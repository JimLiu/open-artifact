import type { Harness } from '@open-artifact/harness-kit';
import type { ArtifactView } from '@open-artifact/protocol';
import type { RuntimeView } from '../src/runtime.ts';
import type { ServiceView } from '../src/service.ts';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { Page as TestPage } from './lib/cdp.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * The service panel against the real daemon: what it shows is what the daemon says (version, address, pid, the apps
 * connected, the type servers); an editor's restart goes through `types.restart`; `doctor` runs with the app's own
 * executable and no `node` on PATH; the logs folder and the profile folder are only logged in test mode; Restart (asked
 * first) gives a new daemon and the tabs come back; Stop (asked first) stays stopped and Start brings it back; a stop
 * while another app is connected says that app may start it again, and when it does the panel says so and connects;
 * and the daemon's token never reaches the page, in any answer, pushed view or error.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createHarness } from '../../../packages/harness-kit/src/index.ts';
import { launchApp, library } from './lib/app.ts';
import { alive, cleanEnv, daemonState, freePort, leftovers, makeProfile, RUNTIME, sleep, stopDaemon, until } from './lib/env.ts';
import { CARRIED } from './lib/registry.ts';

const T = { timeout: 180_000 };
const inDocs = (url: string) => /\/docs\/[0-9a-f]+\//.test(url);
const js = (value: unknown) => JSON.stringify(value);

describe('the service panel', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let page: TestPage;
  let doc: ArtifactView;
  let other: Harness | null;
  /** Every token a daemon of this profile had. */
  const tokens = new Set<string>();
  const noteToken = () => {
    const token = daemonState(profile)?.token;
    if (token) tokens.add(token);
  };

  const run = <T = unknown>(expression: string) => page.evaluate<T>(expression);
  const waitFor = (expression: string, timeoutMs = 20_000) => page.waitFor(expression, timeoutMs);
  const click = (testid: string) =>
    run<boolean>(`(() => { const b = document.querySelector('[data-testid=${testid}]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  const text = async (testid: string) => present(await run<string | null>(`document.querySelector('[data-testid=${testid}]')?.textContent ?? null`));
  const service = () => run<ServiceView>('desktop.service.get(true)');
  const openPanel = async () => {
    if (await run<boolean>(`!!document.querySelector('[data-testid=service-panel]')`)) return;
    assert.equal(await click('service-status'), true, 'no status button');
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=service-panel]')`), 'the panel did not open');
  };
  const closePanel = async () => {
    await run<boolean>(`document.querySelector('[data-testid=service-panel] .icon-button')?.click(), true`);
    await waitFor(`!document.querySelector('[data-testid=service-panel]')`);
  };
  const tabOf = async (id: string) => (await app.state()).tabs.find((tab) => tab.id === id);

  before(async () => {
    profile = makeProfile('oa-desktop-service-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    page = app.chrome;
    noteToken();
    doc = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title: 'Ferry', blank: true, folder: join(profile.artifacts, 'ferry') });
    assert.ok(doc.id, js(doc));
    // Everything the main process pushes to the page, kept for the token check.
    await run<boolean>(`(() => {
      window.__pushed = [];
      desktop.service.onChange((v) => window.__pushed.push(v));
      desktop.runtime.onChange((v) => window.__pushed.push(v));
      desktop.onState((v) => window.__pushed.push(v));
      return true;
    })()`);
  });

  after(async () => {
    await other?.close();
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('shows what the daemon says: version, address, pid, this app, the editors running', T, async () => {
    const opened = await app.open(doc.id);
    assert.ok(opened.ok, js(opened));
    const view = await app.view(doc.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');

    assert.ok(await waitFor(`document.querySelector('[data-testid=service-status]')?.dataset.state === 'running'`));
    await openPanel();
    const daemon = daemonState(profile);
    const servers = await library(daemon, 'types.servers');
    const docs = servers.servers.find((s) => s.type === 'docs');
    assert.ok(docs?.pid, js(servers));

    assert.ok(await waitFor(`!!document.querySelector('[data-testid=service-servers] [data-type=docs]')`), await run<string>('document.body.innerText'));
    assert.equal(await run<string | undefined>(`document.querySelector('[data-testid=service-panel]').dataset.state`), 'running');
    assert.match(await text('service-version'), new RegExp(present(daemon).version.replace(/\./g, '\\.')));
    assert.equal(present(daemon).version, CARRIED);
    assert.match(await text('service-version'), /comes with the app|随 App 附带/);
    assert.equal(await text('service-address'), `127.0.0.1:${port} · process ${present(daemon).pid}`);
    assert.equal(await run<string | undefined>(`document.querySelector('[data-testid=service-servers] [data-type=docs]').dataset.pid`), String(docs.pid));
    const rows = await run<string[]>(
      `[...document.querySelectorAll('[data-testid=service-apps] [data-harness]')].map((r) => r.dataset.harness + ':' + r.dataset.self)`,
    );
    assert.deepEqual(rows, ['open-artifact-desktop:true']);

    // The view is the daemon's, field by field.
    const seen = await service();
    assert.deepEqual(seen.daemon, {
      version: present(daemon).version,
      address: `127.0.0.1:${port}`,
      port,
      pid: present(daemon).pid,
      startedAt: present(daemon).startedAt,
    });
    assert.equal(seen.home, profile.oaHome);
    const harnesses = await library(daemon, 'harnesses');
    assert.equal(seen.apps.length, harnesses.adapters.length);
    // The runtime row says the version it runs.
    assert.match(await text('runtime-row'), new RegExp(CARRIED.replace(/\./g, '\\.')));
  });

  it("an editor's restart goes through types.restart: its server stops, the next page starts it again", T, async () => {
    const before = (await library(daemonState(profile), 'types.servers')).servers.find((s) => s.type === 'docs');
    assert.equal(
      await run<boolean>(
        `(() => { document.querySelector('[data-testid=service-servers] [data-type=docs] [data-testid=restart-type]').click(); return true; })()`,
      ),
      true,
    );
    await app.line(/service: type server docs restarted/);
    assert.ok(
      await until(async () => {
        const now = (await library(daemonState(profile), 'types.servers')).servers.find((s) => s.type === 'docs');
        return !now || now.pid !== present(before).pid;
      }, 20_000),
      'the docs server did not restart',
    );
    // The open tab still works: the view loads its editor again.
    await app.chrome.evaluate<boolean>(`desktop.reload(${js(doc.id)})`);
    const view = await app.view(doc.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')", 30_000), 'the doc editor did not draw again');
  });

  it('doctor runs with the app as Node, no node on PATH; the logs folder is only logged', T, async () => {
    assert.equal(cleanEnv(profile, port).PATH.split(':').includes('/usr/local/bin'), false);
    assert.equal(await click('service-doctor'), true);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=doctor][data-ok]')`, 90_000), await run<string>('document.body.innerText'));
    const line = await app.line(/service: doctor \{/);
    const counts = JSON.parse(line.slice(line.indexOf('{'))) as { ok: number; warn: number; fail: number; 'n/a': number };
    assert.ok(counts.ok >= 5, line);
    assert.equal(counts.fail, 0, await text('doctor'));
    const findings = await run<number>(`document.querySelectorAll('[data-testid=doctor] li').length`);
    assert.ok(findings >= 5);

    assert.equal(await click('service-logs'), true);
    await app.line(new RegExp(`open folder ${join(profile.oaHome, 'logs').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\(test mode: not opened\\)`));
  });

  it('Restart asks first; then a new daemon runs and the tab comes back', T, async () => {
    const was = present(daemonState(profile)).pid;
    assert.equal(await click('service-restart'), true);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=confirm-restart]')`));
    // Nothing happened yet.
    assert.equal(present(daemonState(profile)).pid, was);
    assert.match(await text('confirm-restart'), /Restart|重启/);
    assert.equal(await click('confirm-restart-yes'), true);
    assert.ok(
      await until(() => daemonState(profile)?.pid && present(daemonState(profile)).pid !== was && alive(present(daemonState(profile)).pid), 60_000),
      'no new daemon',
    );
    noteToken();
    assert.equal(alive(was), false, 'the old daemon still runs');
    assert.ok(await waitFor(`document.querySelector('[data-testid=service-panel]')?.dataset.state === 'running'`, 30_000));
    const now = daemonState(profile);
    assert.ok(
      await waitFor(`document.querySelector('[data-testid=service-address]')?.textContent.endsWith(' ${present(now).pid}')`),
      await text('service-address'),
    );
    assert.ok(await until(async () => (await tabOf(doc.id))?.status === 'ready', 30_000), js(await tabOf(doc.id)));
    const view = await app.view(doc.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')", 30_000), 'the doc editor did not come back');
  });

  it('Stop asks first; then it stays stopped (no reconnecting by itself) until Start', T, async () => {
    const was = present(daemonState(profile)).pid;
    assert.equal(await click('service-stop'), true);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=confirm-stop]')`));
    assert.equal(alive(was), true);
    assert.equal(await click('confirm-stop-yes'), true);
    assert.ok(await until(() => !alive(was), 30_000), 'the daemon still runs');
    assert.ok(await waitFor(`document.querySelector('[data-testid=service-panel]')?.dataset.state === 'stopped'`));
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=service-start]')`));
    // Stopped is stopped: several polls later no daemon runs and nothing says reconnecting.
    await sleep(6000);
    assert.equal(!!daemonState(profile) && alive(present(daemonState(profile)).pid), false, 'a daemon was started again');
    assert.equal(await run<string | undefined>(`document.querySelector('[data-testid=service-status]').dataset.state`), 'stopped');
    assert.equal(present(await tabOf(doc.id)).status, 'stopped');
    assert.equal((await app.state()).service, 'stopped');
    assert.equal(
      app.lines.some((line) => /kit: .*reconnect/i.test(line) && app.lines.indexOf(line) > app.lines.findIndex((l) => /service: stopped/.test(l))),
      false,
    );

    assert.equal(await click('service-start'), true);
    assert.ok(await waitFor(`document.querySelector('[data-testid=service-panel]')?.dataset.state === 'running'`, 60_000));
    noteToken();
    assert.ok(alive(present(daemonState(profile)).pid));
    assert.ok(await until(async () => (await tabOf(doc.id))?.status === 'ready', 30_000), js(await tabOf(doc.id)));
  });

  it('a stop while another app is connected names it; when it starts the daemon again the panel says so and connects', T, async () => {
    other = await createHarness({
      harness: 'test-agent-app',
      runtime: { dir: RUNTIME, version: CARRIED },
      home: profile.oaHome,
      daemon: { env: cleanEnv(profile, port), timeoutMs: 60_000 },
      reconnect: { minMs: 300, maxMs: 1000 },
      log: () => {},
    });
    await other.ready();
    await other.attach({ session: 's1', workspace: profile.artifacts, title: 'Chat 1' });
    // The panel lists it (read again while open).
    await run<ServiceView>('desktop.service.get(true)');
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=service-apps] [data-harness=test-agent-app]')`), await text('service-apps'));
    assert.match(await run<string>(`document.querySelector('[data-testid=service-apps] [data-harness=test-agent-app]').textContent`), /1 session|1 个会话/);

    const was = present(daemonState(profile)).pid;
    assert.equal(await click('service-stop'), true);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=confirm-stop]')`));
    assert.match(await text('confirm-stop'), /test-agent-app/);
    assert.equal(await click('confirm-stop-yes'), true);
    assert.ok(await until(() => !alive(was), 30_000));
    // The other app reconnects and starts a daemon again; this app does not connect by itself, it says so.
    assert.ok(
      await waitFor(`document.querySelector('[data-testid=service-panel]')?.dataset.state === 'elsewhere'`, 60_000),
      await run<string>('document.body.innerText'),
    );
    noteToken();
    const again = daemonState(profile);
    assert.ok(again?.pid && again.pid !== was && alive(again.pid));
    assert.equal(await run<string | undefined>(`document.querySelector('[data-testid=service-status]').dataset.state`), 'elsewhere');
    assert.ok(await text('service-elsewhere'));
    assert.ok(await waitFor(`document.querySelector('[data-testid=service-address]')?.textContent.endsWith(' ${again.pid}')`), await text('service-address'));
    assert.equal(
      app.lines.some((l) => /service: a daemon runs again for this home/.test(l)),
      true,
    );

    assert.equal(await click('service-connect'), true);
    assert.ok(await waitFor(`document.querySelector('[data-testid=service-panel]')?.dataset.state === 'running'`, 30_000));
    assert.equal(present(daemonState(profile)).pid, again.pid, 'Connect started another daemon');
    await run<ServiceView>('desktop.service.get(true)');
    assert.ok(await waitFor(`document.querySelectorAll('[data-testid=service-apps] [data-harness]').length === 2`), await text('service-apps'));
    await other.close();
    other = null;
    await closePanel();
  });

  it("the daemon's token is in no answer, pushed view or error the page gets", T, async () => {
    noteToken();
    const seen: unknown[] = [];
    seen.push(await service());
    seen.push(await run<RuntimeView>('desktop.runtime.get(true)'));
    seen.push(await app.state());
    seen.push(await run<import('../src/contracts').SettingsSnapshot>('desktop.settings.get()'));
    seen.push(await run<import('../src/types').Reply<{ title: string; harness: string; sessions: number }[]>>(`desktop.service.do('others')`));
    seen.push(
      await run<
        import('../src/types').Reply<
          | boolean
          | import('../src/service').DoctorState
          | { title: string; harness: string; sessions: number }[]
          | {
              stopped: { version: string; address: string; port: number | null; pid: number | null; startedAt: string } | null;
              others: { title: string; harness: string; sessions: number }[] | null;
            }
          | { daemon: { version: string; address: string; port: number | null; pid: number | null; startedAt: string } | null }
          | { daemon: { version: string; address: string; port: number | null; pid: number | null; startedAt: string } | null }
          | { id: string; stopped: boolean }
        >
      >(`desktop.service.do('nonsense')`),
    );
    seen.push(await run<import('../src/types').Reply<{ id: string; stopped: boolean }>>(`desktop.service.do('restart-type', '../x')`));
    seen.push(await run(`desktop.runtime.do('nonsense')`));
    seen.push(await run('window.__pushed'));
    seen.push(await run<string>('document.documentElement.outerHTML'));
    const all = JSON.stringify(seen);
    assert.ok(all.length > 2000, 'too little was collected');
    assert.ok(tokens.size >= 3, `tokens seen: ${tokens.size}`);
    for (const token of tokens) assert.equal(all.includes(token), false, 'a daemon token reached the page');
    assert.equal(/"token"/.test(all), false);
  });
});
