import type { Harness } from '@open-artifact/harness-kit';
import { createHarness } from '@open-artifact/harness-kit';
import type { DaemonState } from '@open-artifact/protocol';
import type { TabInfo } from '../src/contracts.ts';
import type { ServersView } from '../src/servers.ts';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present, replyValue } from './lib/assertions.ts';
import type { FrameMatch } from './lib/cdp.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * The servers switcher, against two real Open Artifact sites (`packages/host`) on loopback ports of this computer:
 * adding one from the switcher (a plain http address asked about first, then the site's code and the approval),
 * choosing the default (only the default: automatic publishing as it was, new artifacts stay here), automatic
 * publishing (the app's new artifacts and an agent's go up to the site and open there; off, they stay here), changes
 * made on the command line showing in the app, a site that stops (the tab shows the working copy, which can be
 * edited), the sites' pages in a partition of their own (no preload, no daemon token, cookies of their own), a
 * server's home page in a tab, and removing a server (asked first).
 *
 * Throwaway profile, free ports that are not 4800; the sites listen on 127.0.0.1 only, their data in the profile, and
 * are stopped by their pids; the daemon by the pid its own daemon.json names. The approval is made as the person's
 * click on the site's page would be (its owner-key sign-in and its form), never in a browser.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { TYPES } from './lib/editing.ts';
import { RUNTIME, cleanEnv, daemonState, electronBinary, freePort, leftovers, makeProfile, sleep, stopDaemon, until } from './lib/env.ts';
import { startHost } from './lib/host.ts';

const T = { timeout: 240_000 };
const js = (value: unknown) => JSON.stringify(value);
const SERVER_PARTITION = 'persist:open-artifact-servers';
const LOCAL_PARTITION = 'persist:open-artifact-pages';
const inDocs = (url: string) => /\/docs\/[0-9a-f]+\//.test(url);

describe('the servers switcher, with two sites on this computer', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let alpha: Awaited<ReturnType<typeof startHost>>;
  let beta: Awaited<ReturnType<typeof startHost>>;
  let state: DaemonState | null;
  let agent: Harness;
  /** The doc made with automatic publishing on: its tab shows it on alpha. */
  let published: string;

  const by = (testid: string) => `document.querySelector('[data-testid=${js(testid)}]')`;
  const click = (testid: string) => app.chrome.clickOn(by(testid));
  const has = (testid: string) => app.chrome.evaluate<boolean>(`!!${by(testid)}`);
  /** Types into a field as an input method commits text. */
  const fill = async (testid: string, text: string) => {
    await app.chrome.evaluate<boolean>(`${by(testid)}.focus(), ${by(testid)}.select?.(), true`);
    await app.chrome.type(text);
  };
  const view = () => app.chrome.evaluate<ServersView>('desktop.servers.get(true)');
  const daemonLog = () => readFileSync(join(profile.oaHome, 'logs', 'daemon.log'), 'utf8');
  /** The command line of the runtime the app carries, in the profile (`remote …`), with its JSON answer. */
  const cli = (...args: string[]) => {
    const run = spawnSync(electronBinary(), [join(RUNTIME, 'scripts', 'open-artifact.mjs'), ...args], {
      env: cleanEnv(profile, port, { ELECTRON_RUN_AS_NODE: '1' }),
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(run.status, 0, `open-artifact ${args.join(' ')}: ${run.stderr}${run.stdout}`);
    return run.stdout;
  };
  const status = () => JSON.parse(cli('remote', 'status', '--json')) as import('../src/library.ts').RemotesResponse;
  const tab = async (id: string) => (await app.state()).tabs.find((t) => t.id === id);
  const tabInfo = (id: string) => app.chrome.evaluate<TabInfo | null>(`desktop.test.tabInfo(${js(id)})`);
  const record = (id: string) => library(daemonState(profile), `artifact?id=${encodeURIComponent(id)}`);
  /** A device sign-in made without the switcher (the second site), approved on the site. */
  const addDirect = async (host: Awaited<ReturnType<typeof startHost>>) => {
    const started = await library(state, 'remotes.add', { name: host.name, host: host.origin, browse: false });
    assert.ok(started.user_code, js(started));
    await host.approve(started.user_code);
    const done = await library(state, 'remotes.add.wait', { name: host.name, ms: 20_000 });
    assert.equal(done.status, 'done', js(done));
  };
  /** The page of a tab's view, attached (`match(url)` tells it from the other views). */
  const pageOf = async (match: FrameMatch) => {
    const target = await app.cdp.waitTarget((t) => t.type === 'page' && match(t.url));
    const page = await app.cdp.attach(target.targetId);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    return page;
  };
  const closePanel = async () => {
    if (await has('server-panel')) await app.chrome.clickOn(`${by('server-panel')}.querySelector('.service-head .icon-button')`);
    await app.chrome.waitFor(`!${by('server-panel')}`, 5000);
  };
  const openPanel = async () => {
    // The switcher is in the home page's heading.
    await app.chrome.evaluate<boolean>("desktop.select('home')");
    if (!(await has('server-panel'))) await click('server-button');
    assert.ok(await app.chrome.waitFor(`!!${by('server-panel')}`, 5000), 'the switcher did not open');
  };

  before(async () => {
    profile = makeProfile('oa-desktop-servers-');
    port = await freePort();
    alpha = await startHost(profile, 'alpha');
    beta = await startHost(profile, 'beta');
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    state = daemonState(profile);
    assert.ok(state?.url, 'no daemon');
    assert.ok(
      await app.chrome.waitFor(`!!document.querySelector('[data-testid=server-button]') && desktop.servers.get(false).then((v) => v.read)`, 20_000),
      'the switcher did not come up',
    );
  });

  after(async () => {
    try {
      agent?.close(); // the kit's close() returns nothing
    } catch {}
    await app?.quit({ force: true }).catch(() => {});
    await stopDaemon(profile);
    await alpha?.stop();
    await beta?.stop();
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('adds a server from the switcher: a plain http address is asked about first, then the code and the wait', T, async () => {
    const empty = await view();
    assert.deepEqual([empty.remotes.length, empty.publish], [0, 'manual']);
    assert.equal(await app.chrome.evaluate<string | undefined>(`${by('server-button')}.dataset.place`), 'local');

    await openPanel();
    await click('server-add-open');
    await fill('server-host', alpha.origin);
    await fill('server-name', 'alpha');
    await click('server-add-submit');
    // http: asked first; nothing was sent to the daemon yet.
    assert.ok(await app.chrome.waitFor(`!!${by('confirm-http')}`, 5000), 'the http question was not asked');
    assert.doesNotMatch(daemonLog(), /connecting the site alpha/);
    await click('confirm-http-yes');
    const code = await app.chrome.waitFor<string>(`${by('server-code')}?.textContent.trim()`, 15_000);
    assert.ok(code, 'no code shown');
    assert.equal(await app.chrome.evaluate<string | undefined>(`${by('server-adding')}.dataset.state`), 'waiting');
    // Sent as the command line's --insecure-http, with no browser opened by the daemon.
    assert.match(daemonLog(), new RegExp(`connecting the site alpha \\(${alpha.origin.replace(/[.:/]/g, '\\$&')}, --insecure-http\\)`));
    await click('server-approve-page');
    assert.ok(await app.line(/external http:\/\/localhost:\d+\/link\/device/, 5000), 'the approval page was not offered');

    await alpha.approve(code);
    assert.ok(await app.chrome.waitFor(`${by('server-adding')}?.dataset.state === 'done'`, 30_000), 'the sign-in did not finish');
    // The first server is the default by itself: asked once about automatic publishing.
    assert.ok(await app.chrome.waitFor(`!!${by('confirm-auto')}`, 5000), 'automatic publishing was not asked about');
    await click('confirm-auto-cancel');
    await click('server-add-done');

    const after = await view();
    assert.equal(after.remotes.length, 1);
    assert.deepEqual(
      [after.remotes[0].name, after.remotes[0].host, after.remotes[0].isDefault, after.remotes[0].signedIn, after.remotes[0].reachable],
      ['alpha', alpha.origin, true, true, true],
    );
    assert.equal(after.asked, true, 'asked only once');
    const cli1 = status();
    assert.deepEqual([present(cli1.cloud).default, present(cli1.cloud).publish], ['alpha', 'manual'], 'the default is alpha, automatic publishing as it was');
  });

  it('Settings, Service and updates: the default server is named, and its button opens the switcher', T, async () => {
    await app.chrome.evaluate<boolean>("desktop.select('home')");
    await closePanel();
    await click('nav-settings');
    assert.ok(await app.chrome.waitFor(`!!${by('server-line')}`, 10_000), 'no default server row in Settings');
    const line = await app.chrome.evaluate<string>(`${by('server-line')}.textContent`);
    assert.ok(line.includes('alpha') && line.includes(alpha.origin), line);
    await click('settings-servers');
    assert.ok(await app.chrome.waitFor(`!!${by('server-panel')} && !${by('settings-dialog')}`, 5000), 'the switcher did not open from Settings');
    await closePanel();
    // Settings comes back once the switcher closes; closed here.
    assert.ok(await app.chrome.waitFor(`!!${by('settings-dialog')}`, 5000), 'Settings did not come back');
    await app.chrome.evaluate<boolean>(`${by('settings-dialog')}.close(), true`);
    assert.ok(await app.chrome.waitFor(`!${by('settings-dialog')}`, 5000));
  });

  it('choosing a server sets only the default; automatic publishing stays off and new artifacts stay here', T, async () => {
    await addDirect(beta);
    await openPanel();
    assert.ok(await app.chrome.waitFor(`document.querySelectorAll('[data-testid=server-row]').length === 2`, 10_000), 'the second server is not listed');
    await app.chrome.clickOn(`document.querySelector('[data-testid=server-row][data-name=beta] [data-testid=server-pick]')`);
    assert.ok(await until(async () => present(status().cloud).default === 'beta', 10_000), 'beta is not the default');
    assert.equal(present(status().cloud).publish, 'manual', 'automatic publishing was not changed');
    await sleep(300);
    assert.equal(await has('confirm-auto'), false, 'asked again');
    // 「本机」: a state shown while automatic publishing is off, not a server one picks.
    assert.equal(await app.chrome.evaluate<string | undefined>(`${by('server-local')}.dataset.current`), 'true');
    assert.equal(await app.chrome.evaluate<boolean>(`!!${by('server-local')}.querySelector('button')`), false);
    await closePanel();
    assert.equal(await app.chrome.evaluate<string | undefined>(`${by('server-button')}.dataset.place`), 'local');

    const made = await app.command('new:docs');
    const id = replyValue(made).id;
    await sleep(2500);
    assert.equal((await record(id)).remote ?? null, null, 'a new artifact was published with automatic publishing off');
    assert.equal((await tab(id))?.kind, 'local');
    assert.equal(present(await tabInfo(id)).partition, LOCAL_PARTITION);
  });

  it("automatic publishing on: the app's new artifacts and an agent's go up to the default site and open there; off, they stay here", T, async () => {
    await openPanel();
    await app.chrome.clickOn(`document.querySelector('[data-testid=server-row][data-name=alpha] [data-testid=server-pick]')`);
    assert.ok(await until(async () => present(status().cloud).default === 'alpha', 10_000));
    await click('auto-publish');
    assert.ok(await until(async () => present(status().cloud).publish === 'auto', 10_000), 'automatic publishing is not on');
    await closePanel();
    assert.ok(await app.chrome.waitFor(`${by('server-button')}.dataset.place === 'server' && ${by('server-button')}.textContent.includes('alpha')`, 5000));

    // The app's new artifact: published to alpha, its tab on alpha's page (a view of the servers' partition).
    const made = await app.command('new:docs');
    published = replyValue(made).id;
    assert.ok(await until(async () => (await record(published)).remote?.name === 'alpha', 30_000), 'the new doc was not published');
    assert.ok(await until(async () => (await tab(published))?.kind === 'server', 30_000), `the tab is not on the site: ${js(await tab(published))}`);
    const info = await until(async () => {
      const got = await tabInfo(published);
      return got?.url ? got : null;
    }, 15_000);
    assert.equal(new URL(present(info).url).origin, alpha.origin);
    assert.equal(present(info).partition, SERVER_PARTITION);
    assert.equal(present(info).preload, null);
    assert.deepEqual(present(info).preloads, []);
    assert.equal(present(info).sandbox, true);
    assert.equal(present(info).ticket, null, 'a site page gets no view ticket');
    assert.equal(present(await tab(published)).saved, null, "no saved state from the site's Shell");

    // Sign in on the site in that view (its own page and form), to see the artifact's page there.
    const page = await pageOf((url: string) => url.startsWith(`${alpha.origin}/`));
    await page.waitFor("!!document.querySelector('#key')", 15_000);
    await page.evaluate<boolean>(`(() => { const k = document.querySelector('#key'); k.value = ${js(alpha.key)}; k.form.submit(); return true; })()`);
    assert.ok(
      await until(async () => !/\/auth\//.test(present(await tabInfo(published)).url), 20_000),
      `still signing in: ${present(await tabInfo(published)).url}`,
    );
    // The site's page cannot reach the app: no preload bridge, no daemon token anywhere it can read.
    assert.equal(
      await page.evaluate<'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function'>('typeof window.desktop'),
      'undefined',
    );
    const html = await page.evaluate<string>('document.documentElement.outerHTML + location.href + document.cookie');
    assert.equal(html.includes(present(state).token), false, "the daemon token reached the site's page");
    // Cookies of its own: the site's session is in the servers' partition, not in a local view's.
    const serverCookies = (await page.send('Network.getCookies', { urls: [alpha.origin] })).cookies.map((c) => c.name);
    assert.ok(serverCookies.includes('oa_session'), js(serverCookies));
    const local = (await app.state()).tabs.find((t) => t.kind === 'local');
    assert.ok(local, 'a local tab');
    const localPage = await pageOf((url: string) => url.startsWith(present(state).url) && url.includes(`/a/${local.id}`));
    const localCookies = (await localPage.send('Network.getCookies', { urls: [alpha.origin] })).cookies;
    assert.deepEqual(localCookies, [], "the site's session reached the local partition");
    assert.equal(present(await tabInfo(local.id)).partition, LOCAL_PARTITION);

    // An agent's new artifact (an agent app that shows no pages, through the kit): published to alpha too.
    agent = await createHarness({ harness: 'claude-code', home: profile.oaHome, autoStart: false, reconnect: { minMs: 200, maxMs: 1000 }, log: () => {} });
    await agent.ready();
    await agent.attach({ session: 'servers-agent', workspace: profile.artifacts });
    const board = await agent.call(
      'Artifact',
      { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Agent board' },
      { session: 'servers-agent', workspace: profile.artifacts },
    );
    const boardId = String(board.url).replace('open-artifact://artifact/', '');
    assert.ok(boardId.startsWith('art_'), js(board));
    assert.ok(await until(async () => (await record(boardId)).remote?.name === 'alpha', 30_000), "the agent's artifact was not published");

    // Off again: new ones stay here.
    await openPanel();
    await click('auto-publish');
    assert.ok(await until(async () => present(status().cloud).publish === 'manual', 10_000));
    await closePanel();
    const local2 = replyValue(await app.command('new:docs')).id;
    const board2 = await agent.call(
      'Artifact',
      { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Agent board 2' },
      { session: 'servers-agent', workspace: profile.artifacts },
    );
    await sleep(2500);
    assert.equal((await record(local2)).remote ?? null, null);
    assert.equal((await record(String(board2.url).replace('open-artifact://artifact/', ''))).remote ?? null, null);
    assert.equal((await tab(local2))?.kind, 'local');
  });

  it('changes made on the command line show in the app (the default, automatic publishing)', T, async () => {
    cli('remote', 'default', 'beta');
    const t0 = Date.now();
    assert.ok(await until(async () => (await view()).defaultName === 'beta', 10_000));
    assert.ok(await app.chrome.waitFor(`${by('server-button')}.dataset.place === 'local'`, 10_000));
    await openPanel();
    assert.ok(
      await app.chrome.waitFor(`document.querySelector('[data-testid=server-row][data-name=beta]')?.dataset.default === 'true'`, 10_000),
      'the switcher did not follow the default',
    );
    await closePanel();
    cli('remote', 'auto', 'on');
    // No event of the daemon's for these: the app reads the list every few seconds.
    assert.ok(
      await app.chrome.waitFor(`${by('server-button')}.dataset.place === 'server' && ${by('server-button')}.textContent.includes('beta')`, 10_000),
      'the button did not follow',
    );
    assert.ok(await app.chrome.waitFor(`${by('auto-publish-bar')}?.getAttribute('aria-checked') === 'true'`, 5000));
    cli('remote', 'auto', 'off');
    cli('remote', 'default', 'alpha');
    assert.ok(
      await app.chrome.waitFor(
        `${by('auto-publish-bar')}?.getAttribute('aria-checked') === 'false' && ${by('server-button')}.dataset.place === 'local'`,
        10_000,
      ),
    );
    assert.ok(Date.now() - t0 < 30_000);
  });

  it("a site that stops: the published artifact's tab shows the working copy here, and it can be edited", T, async () => {
    assert.equal((await tab(published))?.kind, 'server');
    await alpha.stop();
    assert.ok(await until(async () => (await tab(published))?.kind === 'local', 30_000), `the tab stayed on the site: ${js(await tab(published))}`);
    assert.ok(await until(async () => (await tab(published))?.status === 'ready', 30_000), 'the working copy did not load');
    const info = await tabInfo(published);
    assert.equal(present(info).partition, LOCAL_PARTITION);
    assert.equal(new URL(present(info).url).origin, new URL(present(state).url).origin);
    const page = await pageOf((url: string) => url.startsWith(present(state).url) && url.includes(`/a/${published}`));
    assert.ok(await page.waitInFrame(inDocs, TYPES.docs.drawn, 30_000), 'the doc editor did not draw');
    await TYPES.docs.edit(page, inDocs);
    const root = (await record(published)).root;
    assert.ok(await until(() => TYPES.docs.onDisk(root), 20_000), 'the edit did not reach the folder');
  });

  it("a server's home page opens in a tab of the servers' partition; it closes without asking", T, async () => {
    await openPanel();
    await app.chrome.clickOn(`document.querySelector('[data-testid=server-row][data-name=beta] [data-testid=server-home]')`);
    assert.ok(await until(async () => (await tab('site:beta'))?.kind === 'site', 10_000));
    const info = await until(async () => {
      const got = await tabInfo('site:beta');
      return got?.url ? got : null;
    }, 15_000);
    assert.equal(new URL(present(info).url).origin, beta.origin);
    assert.equal(present(info).partition, SERVER_PARTITION);
    assert.equal(present(info).preload, null);
    const page = await pageOf((url: string) => url.startsWith(`${beta.origin}/`));
    assert.equal(
      await page.evaluate<'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function'>('typeof window.desktop'),
      'undefined',
    );
    assert.equal(await app.chrome.evaluate<boolean>("desktop.close('site:beta')"), true);
    assert.equal((await app.state()).ask, null, 'nothing asked');
    assert.equal(await tab('site:beta'), undefined);
  });

  it('removing a server asks first', T, async () => {
    await openPanel();
    await app.chrome.clickOn(`document.querySelector('[data-testid=server-row][data-name=beta] [data-testid=server-remove]')`);
    assert.ok(await app.chrome.waitFor(`!!${by('confirm-remove')}`, 5000));
    await click('confirm-remove-cancel');
    assert.ok(
      status().remotes.some((r) => r.name === 'beta'),
      'removed without the yes',
    );
    await app.chrome.clickOn(`document.querySelector('[data-testid=server-row][data-name=beta] [data-testid=server-remove]')`);
    await click('confirm-remove-yes');
    assert.ok(await until(async () => !status().remotes.some((r) => r.name === 'beta'), 10_000), 'beta was not removed');
    assert.ok(await app.chrome.waitFor(`!document.querySelector('[data-testid=server-row][data-name=beta]')`, 10_000));
    const servers = await app.chrome.evaluate<{ view: import('../src/servers').ServersView; servers: string[] }>('desktop.test.servers()');
    assert.deepEqual(servers.servers, [alpha.origin], 'only the remaining site is let in');
  });
});
