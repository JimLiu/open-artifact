/**
 * The runtime's updates in the app, against a fake npm registry on 127.0.0.1 (never the real one) serving a newer
 * runtime that really runs (the carried one with its version raised): Check finds it and the library offers it;
 * Update downloads it and says it takes effect when the service restarts, and its Restart now goes through the service
 * panel's confirmation, after which the daemon runs the newer runtime; a check that cannot reach the registry says so;
 * the "check for updates" switch writes the person's setting (`bundled`, then back to `prompt`) and takes Check away
 * while off; and with updates off for the computer nothing is offered and no button is shown.
 *
 * Throwaway profiles, free ports that are not 4800; daemons are stopped by the pid their own daemon.json names.
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { alive, daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.mjs';
import { launchApp, library } from './lib/app.mjs';
import { CARRIED, runtimeTarballOf, startRegistry } from './lib/registry.mjs';

const T = { timeout: 240_000 };
const NEWER = '0.99.0';
const inDocs = (url) => /\/docs\/[0-9a-f]+\//.test(url);
const js = (value) => JSON.stringify(value);

/** Helpers over the window's page. */
function on(app) {
  const page = app.chrome;
  const run = (expression) => page.evaluate(expression);
  return {
    run,
    waitFor: (expression, timeoutMs = 20_000) => page.waitFor(expression, timeoutMs),
    click: (testid) => run(`(() => { const b = document.querySelector('[data-testid=${testid}]'); if (!b || b.disabled) return false; b.click(); return true; })()`),
    text: (testid) => run(`document.querySelector('[data-testid=${testid}]')?.textContent ?? null`),
    exists: (testid) => run(`!!document.querySelector('[data-testid=${testid}]')`),
    /** Clicks a button of the update panel at the top of the library by its words. */
    updateButton: (words) => run(`(() => { const b = [...document.querySelectorAll('[data-testid=open-artifact-update] .oa-btn')].find((b) => ${js(words)}.includes(b.textContent.trim())); if (!b) return false; b.click(); return true; })()`),
    runtime: () => run('desktop.runtime.get()'),
  };
}

describe('runtime updates offered, downloaded and finished with a restart', () => {
  let profile;
  let port;
  let registry;
  let app;
  let ui;
  let doc;

  before(async () => {
    profile = makeProfile('oa-desktop-update-');
    port = await freePort();
    registry = await startRegistry([{ version: NEWER, tarball: runtimeTarballOf(NEWER, profile.tmp) }]);
    // Updates as the person has them: not off for the computer (the fake registry, no machine policy file).
    app = await launchApp(profile, port, { env: { OPEN_ARTIFACT_RUNTIME_UPDATE: undefined, OPEN_ARTIFACT_REGISTRY: registry.url } });
    await app.line(/\[desktop\] ready /);
    await app.connect();
    ui = on(app);
    doc = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title: 'Ferry', blank: true, folder: join(profile.artifacts, 'ferry') });
    // A tab stays open: the daemon is not idle, so it does not switch to a downloaded runtime by itself.
    assert.equal((await app.open(doc.id)).ok, true);
    const view = await app.view(doc.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    await app.chrome.evaluate(`desktop.select('home')`);
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    await registry?.close();
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('before a check: the policy is the app\'s (prompt), nothing is offered, Check is there', T, async () => {
    const rt = await ui.run('desktop.runtime.get(true)');
    assert.equal(rt.running, CARRIED);
    assert.deepEqual(rt.policy, { update: 'prompt', source: 'adapter' });
    assert.equal(rt.available, null);
    assert.equal(rt.toggle, 'on');
    assert.equal(await ui.exists('open-artifact-update'), false);
    assert.equal(await ui.click('service-status'), true);
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=runtime-check]')`));
    assert.match(await ui.text('runtime-line'), /Not checked|还没检查|未检查/);
  });

  it('Check asks the fake registry and finds the newer runtime; the library offers it', T, async () => {
    assert.equal(await ui.click('runtime-check'), true);
    assert.ok(await until(async () => (await ui.runtime()).available === NEWER, 60_000), js(await ui.runtime()));
    assert.ok(registry.requests.some((r) => r.path === '/@open-artifact%2fcli'), js(registry.requests.map((r) => r.path)));
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=runtime-line]')?.textContent.includes(${js(NEWER)})`));
    // Close the panel: the offer is at the top of the library.
    await ui.run(`document.querySelector('[data-testid=service-panel] .icon-button').click(), true`);
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=open-artifact-update]')?.dataset.phase === 'idle'`), await ui.run('document.body.innerText'));
    const offer = await ui.text('open-artifact-update');
    assert.ok(offer.includes(NEWER) && offer.includes(CARRIED), offer);
    // No changelog link: the runtime carries none.
    assert.equal(await ui.run(`document.querySelectorAll('[data-testid=open-artifact-update] a').length`), 0);
  });

  it('Update downloads it and says a restart finishes it; Restart now asks in the service panel, then the newer runtime runs', T, async () => {
    const was = daemonState(profile);
    assert.equal(await ui.updateButton(['Update', '更新']), true, await ui.text('open-artifact-update'));
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=open-artifact-update]')?.dataset.phase === 'done'`, 120_000), await ui.text('open-artifact-update'));
    assert.ok(registry.requests.some((r) => r.path === `/tarballs/${NEWER}.tgz`));
    assert.match(await ui.text('open-artifact-update'), /takes effect when the service restarts|重启服务后生效/);
    const rt = await ui.runtime();
    assert.equal(rt.pending, NEWER, js(rt));
    // It waits: the same daemon still runs the carried runtime.
    assert.equal(daemonState(profile).pid, was.pid);
    assert.equal(daemonState(profile).version, CARRIED);

    assert.equal(await ui.updateButton(['Restart now', '现在重启以生效']), true, await ui.text('open-artifact-update'));
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=service-panel] [data-testid=confirm-restart]')`), await ui.run('document.body.innerText'));
    assert.equal(daemonState(profile).pid, was.pid, 'the restart did not wait for the confirmation');
    assert.equal(await ui.click('confirm-restart-yes'), true);
    assert.ok(await until(() => daemonState(profile)?.version === NEWER && alive(daemonState(profile).pid), 90_000), js(daemonState(profile)));
    assert.equal(alive(was.pid), false);
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=service-panel]')?.dataset.state === 'running'`, 30_000));
    assert.ok(await until(async () => (await ui.run('desktop.runtime.get(true)')).running === NEWER, 30_000), js(await ui.runtime()));
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=service-version]')?.textContent.startsWith(${js(NEWER)})`), await ui.text('service-version'));
    assert.match(await ui.text('service-version'), /shared|共用/);
    // The tab came back on the new daemon, and the offer is gone.
    assert.ok(await until(async () => (await app.state()).tabs.find((t) => t.id === doc.id)?.status === 'ready', 30_000));
    assert.equal(await ui.exists('open-artifact-update'), false);
  });

  it('a check that cannot reach the registry says it failed', T, async () => {
    await registry.close();
    registry = null;
    assert.equal(await ui.click('runtime-check'), true);
    assert.ok(await until(async () => !!(await ui.runtime()).check?.error, 60_000), js(await ui.runtime()));
    assert.ok(await ui.waitFor(`/failed|失败|没有/.test(document.querySelector('[data-testid=runtime-line]')?.textContent ?? '')`), await ui.text('runtime-line'));
    assert.equal(await ui.exists('open-artifact-update'), false);
    await ui.run(`document.querySelector('[data-testid=service-panel] .icon-button').click(), true`);
  });

  it('the "check for updates" switch writes the person\'s setting: off is bundled (no Check), on is prompt', T, async () => {
    assert.equal(await ui.click('nav-settings'), true);
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=settings-dialog]')`));
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=auto-check-switch]')?.getAttribute('aria-checked') === 'true'`));
    assert.ok(await ui.exists('runtime-check'));
    assert.equal(await ui.click('auto-check-switch'), true);
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=auto-check-switch]')?.getAttribute('aria-checked') === 'false'`, 60_000), await ui.text('settings-shared'));
    const settings = () => JSON.parse(readFileSync(join(profile.oaHome, 'settings.json'), 'utf8'));
    assert.equal(settings().runtime.update, 'bundled');
    assert.deepEqual((await ui.runtime()).policy, { update: 'bundled', source: 'settings' });
    assert.equal(await ui.exists('runtime-check'), false);
    assert.match(await ui.text('runtime-line'), /off|关/i);
    const refused = await ui.run(`desktop.runtime.do('check')`);
    assert.equal(refused.ok, false);

    assert.equal(await ui.click('auto-check-switch'), true);
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=auto-check-switch]')?.getAttribute('aria-checked') === 'true'`, 60_000));
    assert.equal(settings().runtime.update, 'prompt');
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=runtime-check]')`));
    await ui.click('settings-done');
  });
});

describe('runtime updates off for the computer', () => {
  let profile;
  let port;
  let app;
  let ui;

  before(async () => {
    profile = makeProfile('oa-desktop-update-off-');
    port = await freePort();
    // cleanEnv's OPEN_ARTIFACT_RUNTIME_UPDATE=off: the computer's switch.
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    ui = on(app);
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('says so, offers nothing and shows no button that could not work', T, async () => {
    const rt = await ui.run('desktop.runtime.get(true)');
    assert.deepEqual(rt.policy, { update: 'off', source: 'machine' });
    assert.equal(rt.canCheck, false);
    assert.equal(rt.toggle, 'fixed');
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=service-status]')`));
    assert.equal(await ui.click('service-status'), true);
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=runtime-line]')`));
    assert.match(await ui.text('runtime-line'), /computer|这台电脑/);
    assert.equal(await ui.exists('runtime-check'), false);
    await ui.run(`document.querySelector('[data-testid=service-panel] .icon-button').click(), true`);
    assert.equal(await ui.exists('open-artifact-update'), false);
    assert.equal(await ui.click('nav-settings'), true);
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=auto-check]')?.dataset.fixed === 'true'`));
    assert.equal(await ui.exists('auto-check-switch'), false);
    assert.equal(await ui.exists('runtime-check'), false);
    const refused = await ui.run(`desktop.runtime.do('check')`);
    assert.equal(refused.ok, false);
    await ui.click('settings-done');
  });
});
