/**
 * "Install as app", after the install (`npm run package` first; `npm run test:packaged`): the dialog state by state,
 * a desktop app that moved (the daemon from the app's own executable; the record following it), an agent's open with
 * "Open in App" off, a package renamed or moved in the Finder, refresh and repair, and uninstall (running and quitting
 * by itself; unsaved work kept, so given up after the timeout; not running; a new install id each time).
 *
 * As in `installed-apps.test.mjs`: one throwaway profile (HOME, the Open Artifact home, the install folder under that
 * HOME), the desktop app and the generated app started only by their executables with `--test-mode` and a port that is
 * not 4800. Test mode never opens a package, never calls the Trash (the test's own package is removed, and that is
 * logged), and the one thing done in the account's own Library is `defaults delete` of the exact bundle ids of the apps
 * this file started. One install id is started throughout (macOS keeps one preferences file per bundle id started).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { APP, alive, daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from '../lib/env.mjs';
import { forgetLaunchedDefaults, launchApp, launchArtifactApp, library } from '../lib/app.mjs';

const T = { timeout: 300_000 };
const js = (value) => JSON.stringify(value);
const BUNDLE = join(APP, 'dist', 'Open Artifact-darwin-arm64', 'Open Artifact.app');
const binaryOf = (bundle) => join(bundle, 'Contents', 'MacOS', 'Open Artifact');
const plistOf = (bundle) => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8' }));
const manifestPath = (bundle) => join(bundle, 'Contents', 'Resources', 'artifact-app.json');
const signed = (bundle) => {
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundle], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const TITLE = 'Harbour plan';
const SESSION = { session: 'installed-apps-manage', workspace: null };

describe('install as app: the dialog, moves in the Finder, refresh, repair, uninstall (the packaged app)', () => {
  let profile;
  let port;
  let desktop = null;
  let agent = null;
  const running = new Set();
  let id;
  /** The app started throughout: `{ installId, bundle }`. */
  let one = null;

  const installDir = () => join(profile.home, 'Applications', 'Open Artifact Apps');
  const recordPath = (installId) => join(profile.oaHome, 'desktop', 'apps', `${installId}.json`);
  const record = () => JSON.parse(readFileSync(recordPath(one.installId), 'utf8'));
  const patchRecord = (patch) => writeFileSync(recordPath(one.installId), `${js({ ...record(), ...patch })}\n`);
  const startDesktop = async () => {
    desktop = await launchApp(profile, port, { binary: binaryOf(BUNDLE) });
    await desktop.line(/\[desktop\] ready /, 90_000);
    await desktop.connect();
    return desktop;
  };
  const needDesktop = async () => desktop ?? startDesktop();
  const stopDesktop = async () => {
    await desktop?.quit({ force: true });
    desktop = null;
  };
  const stopAll = async () => {
    await stopDesktop();
    await stopDaemon(profile);
    assert.ok(await until(() => !daemonState(profile)?.pid || !alive(daemonState(profile).pid), 15_000), 'the daemon is still there');
  };
  const startApp = async (bundle = one.bundle) => {
    const it = await launchArtifactApp(profile, port, { binary: binaryOf(bundle) });
    running.add(it);
    return it;
  };
  const stopApp = async (it, options) => {
    const exit = await it.quit(options);
    running.delete(it);
    return exit;
  };
  const apps = async (call, ...args) => {
    const answer = await desktop.chrome.evaluate(`desktop.apps.${call}(${args.map(js).join(', ')})`);
    assert.equal(answer?.ok, true, `desktop.apps.${call}: ${js(answer)}`);
    return answer.value;
  };

  // ---- the dialog, through the window's page ----
  const page = (expression) => desktop.chrome.evaluate(expression);
  const waitPage = (expression, timeoutMs = 20_000) => desktop.chrome.waitFor(expression, timeoutMs);
  const card = `[...document.querySelectorAll('.oa-item')].find((item) => item.querySelector('.oa-name')?.textContent === ${js(TITLE)})`;
  /** Opens the dialog from the card's More menu (the library in front). */
  const openDialog = async () => {
    await desktop.chrome.evaluate(`desktop.select('home')`);
    assert.ok(await waitPage(`!!(${card})`), 'no card');
    await page(`(() => { ${card}.querySelector('.oa-act').click(); return true; })()`);
    assert.ok(await waitPage(`!!document.querySelector('.oa-menu-item[data-action=install-app]')`), 'no Install as App… in the card menu');
    await page(`document.querySelector('.oa-menu-item[data-action=install-app]').click(), true`);
    assert.ok(await waitPage(`!!document.querySelector('[data-testid=install-app-dialog]')`), 'no dialog');
  };
  const dialogState = () => page(`document.querySelector('[data-testid=install-app-dialog]')?.dataset.state ?? null`);
  const waitDialog = async (state, timeoutMs = 30_000) => {
    assert.ok(await waitPage(`document.querySelector('[data-testid=install-app-dialog]')?.dataset.state === ${js(state)}`, timeoutMs), `the dialog is not ${state}: ${await dialogState()} ${await page(`document.querySelector('[data-testid=install-app-dialog]')?.innerText ?? ''`)}`);
  };
  const buttons = () => page(`[...document.querySelectorAll('[data-testid=install-app-dialog] .new-actions button')].map((b) => b.dataset.testid)`);
  const click = (testid) => page(`(() => { const b = document.querySelector('[data-testid=${testid}]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  const text = (testid) => page(`document.querySelector('[data-testid=${testid}]')?.textContent ?? null`);
  const closeDialog = async () => {
    // Once the call under way (Show in Finder's, say) is done: its buttons are off till then.
    assert.ok(await waitPage(`document.querySelector('[data-testid=install-app-close]')?.disabled === false`), 'Close stays off');
    assert.equal(await click('install-app-close'), true);
    assert.ok(await waitPage(`!document.querySelector('[data-testid=install-app-dialog]')`), 'the dialog stayed');
  };
  /** The package in place: our installId and bundle id, signed. */
  const checkPackage = (bundle, installId) => {
    assert.ok(existsSync(binaryOf(bundle)), `no package at ${bundle}`);
    assert.equal(plistOf(bundle).CFBundleIdentifier, `dev.openartifact.app.${installId}`);
    assert.equal(JSON.parse(readFileSync(manifestPath(bundle), 'utf8')).installId, installId);
    assert.equal(signed(bundle), true, `the signature of ${bundle} does not check`);
  };

  before(async () => {
    assert.ok(existsSync(binaryOf(BUNDLE)), `${BUNDLE} is missing: run npm run package in apps/desktop`);
    profile = makeProfile('oa-desktop-manage-');
    SESSION.workspace = profile.artifacts;
    port = await freePort();
    await startDesktop();
    const made = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title: TITLE, blank: true, folder: join(profile.artifacts, 'harbour') });
    assert.ok(made.id, js(made));
    id = made.id;
    const { createHarness } = await import(resolve(APP, '..', '..', 'packages', 'harness-kit', 'src', 'index.ts'));
    agent = await createHarness({ harness: 'claude-code', home: profile.oaHome, autoStart: false, reconnect: { minMs: 200, maxMs: 1000 }, log: () => {} });
    await agent.ready();
    await agent.attach(SESSION);
  });

  beforeEach(async () => {
    for (const it of [...running]) await stopApp(it, { force: true }).catch(() => {});
  });

  after(async () => {
    for (const it of running) await it.quit({ force: true }).catch(() => {});
    try {
      agent?.close();
    } catch {}
    await desktop?.quit({ force: true }).catch(() => {});
    await stopDaemon(profile);
    forgetLaunchedDefaults();
    const left = leftovers(profile);
    rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
    assert.equal(existsSync(profile.root), false);
  });

  it('the dialog: available (name, folder), installing (held at a step), installed (Open, Show in Finder, Uninstall…)', T, async () => {
    await openDialog();
    await waitDialog('available');
    assert.equal(await text('install-app-name'), TITLE);
    assert.equal(await text('install-app-location'), installDir());
    assert.deepEqual(await buttons(), ['install-app-close', 'install-app-install']);
    await closeDialog();

    // An install held after its record is written: the dialog, opened then, says it installs; let go, installed.
    assert.equal(await page(`desktop.test.appsHold('cloned')`), true);
    await page(`void desktop.apps.install(${js(id)}, { confirmedName: ${js(TITLE)} }), true`);
    await desktop.line(/installed apps: held at cloned/, 30_000);
    await openDialog();
    await waitDialog('installing');
    assert.equal(await page(`desktop.test.appsRelease()`), true);
    await waitDialog('installed');
    assert.deepEqual(await buttons(), ['install-app-close', 'install-app-uninstall', 'install-app-reveal', 'install-app-open']);
    const bundle = join(installDir(), `${TITLE}.app`);
    assert.equal(await text('install-app-path'), bundle);
    assert.equal(await click('install-app-open'), true);
    await desktop.line(/installed apps: open .*\(test mode: not opened\)/, 10_000);
    assert.equal(await click('install-app-reveal'), true);
    await desktop.line(/reveal .*Harbour plan\.app \(test mode: not shown\)/, 10_000);
    await closeDialog();
    const state = await apps('state', id);
    one = { installId: state.installId, bundle };
    checkPackage(bundle, one.installId);
  });

  it('the desktop app moved (its package not where the record says): the app runs the daemon with its own executable; the record follows the desktop app', T, async () => {
    await stopAll();
    patchRecord({ templatePath: join(profile.root, 'moved', 'Open Artifact.app') });
    const app = await startApp();
    const ready = await app.ready();
    assert.equal(ready.problem, null, js(ready));
    assert.equal(ready.daemonExe, binaryOf(one.bundle), js(ready));
    assert.match(app.lines.join('\n'), /daemon start: this app/);
    await app.connect();
    assert.ok(await until(async () => (await app.info()).status === 'ready', 30_000), js(await app.info()));
    await stopApp(app);
    // That daemon runs the types inside this app's package, which the next tests rename and move: stopped, so the
    // desktop app starts its own.
    await stopAll();
    await startDesktop();
    assert.ok(await until(() => record().templatePath === BUNDLE, 20_000), `the record still names ${record().templatePath}`);
  });

  it('"Open in App" off (the default): an agent\'s open never goes to the artifact\'s app', T, async () => {
    await needDesktop();
    // The setting is never turned on in this profile.
    const app = await startApp();
    await app.ready();
    await app.connect();
    assert.ok(await until(async () => (await app.info()).status === 'ready', 30_000), js(await app.info()));
    const opened = await agent.call('Artifact', { action: 'open', url: `open-artifact://artifact/${id}` }, SESSION).catch((error) => ({ error: String(error?.message ?? error) }));
    assert.notEqual(opened.opened_in, 'open-artifact-app', js(opened));
    await new Promise((done) => setTimeout(done, 1500));
    const info = await app.info();
    assert.deepEqual(info.handoffs, []);
    assert.equal(new URL(info.page.url).pathname, `/a/${id}`);
    assert.doesNotMatch(app.lines.join('\n'), /host\.open refused/);
    await stopApp(app);
  });

  it('renamed in the install folder: the app claims its record at its own start; the desktop app does too', T, async () => {
    await stopDesktop();
    const renamed = join(installDir(), 'Harbour (mine).app');
    renameSync(one.bundle, renamed);
    one.bundle = renamed;
    const app = await startApp();
    const ready = await app.ready();
    assert.equal(ready.problem, null, js(ready));
    assert.match(app.lines.join('\n'), /claimed its record: .* is now .*Harbour \(mine\)\.app/);
    assert.equal(record().bundlePath, renamed);
    assert.equal(record().displayName, 'Harbour (mine)');
    await stopApp(app, { force: true });

    await startDesktop();
    const again = join(installDir(), 'Harbour again.app');
    renameSync(one.bundle, again);
    one.bundle = again;
    const state = await apps('state', id);
    assert.deepEqual([state.state, state.installId, state.displayName, state.bundlePath], ['installed', one.installId, 'Harbour again', again], js(state));
    checkPackage(again, one.installId);
  });

  it('moved out of the install folder: no claim; the page says where it belongs and hands the artifact over; moved back, it is installed', T, async () => {
    await stopDesktop();
    const away = join(profile.home, 'Elsewhere');
    mkdirSync(away, { recursive: true });
    const out = join(away, 'Harbour again.app');
    renameSync(one.bundle, out);
    try {
      const app = await startApp(out);
      const ready = await app.ready();
      assert.deepEqual([ready.problem, ready.reason], ['needs-repair', 'moved-out'], js(ready));
      await app.connect();
      assert.ok(await until(async () => (await app.page.evaluate(`document.querySelector('[data-testid=status-body]').textContent`)).includes(installDir()), 10_000), await app.page.evaluate(`document.querySelector('[data-testid=status]').innerText`));
      assert.match(await app.page.evaluate(`document.querySelector('[data-testid=status-title]').textContent`), /moved out of its folder/);
      assert.equal(await app.page.evaluate(`(() => { const b = document.querySelector('[data-testid=action-open-artifact]'); b?.click(); return !!b; })()`), true);
      assert.ok(await until(async () => (await app.info()).handoffs.length > 0, 10_000));
      assert.deepEqual((await app.info()).handoffs.map((entry) => [entry.what, entry.id]), [['artifact', id]]);
      assert.equal(record().bundlePath, one.bundle, 'the record was claimed by a package outside the install folder');
      await stopApp(app, { force: true });
      await startDesktop();
      const state = await apps('state', id);
      assert.deepEqual([state.state, state.reason, state.repairable], ['needsRepair', 'missing', true], js(state));
    } finally {
      renameSync(out, one.bundle);
    }
    const back = await apps('state', id);
    assert.deepEqual([back.state, back.installId], ['installed', one.installId], js(back));
  });

  it('refresh: busy while it rebuilds; Update in the dialog when stale; at start for an app that does not run; same id, path and bundle id, signed, it starts', T, async () => {
    await needDesktop();
    const now = record().templateVersion;
    // A rebuild held after it built: the dialog says so.
    patchRecord({ templateVersion: '0.0.0+old' });
    assert.equal((await apps('state', id)).stale, true);
    assert.equal(await page(`desktop.test.appsHold('rebuild-built')`), true);
    await page(`void desktop.apps.refresh(${js(id)}, ${js(one.installId)}), true`);
    await desktop.line(/installed apps: held at rebuild-built/, 60_000);
    await openDialog();
    await waitDialog('busy');
    assert.equal(await page(`desktop.test.appsRelease()`), true);
    await waitDialog('installed', 60_000);
    assert.equal(await page(`!!document.querySelector('[data-testid=install-app-stale]')`), false);
    assert.equal(record().templateVersion, now);
    await closeDialog();
    checkPackage(one.bundle, one.installId);

    // Stale again: the dialog's Update.
    patchRecord({ templateVersion: '0.0.0+old' });
    await openDialog();
    await waitDialog('installed');
    assert.ok(await page(`!!document.querySelector('[data-testid=install-app-stale]')`), 'not said to be stale');
    assert.deepEqual(await buttons(), ['install-app-close', 'install-app-uninstall', 'install-app-reveal', 'install-app-update', 'install-app-open']);
    assert.equal(await click('install-app-update'), true);
    assert.ok(await waitPage(`document.querySelector('[data-testid=install-app-message]')?.textContent === 'Updated.'`, 60_000), await page(`document.querySelector('[data-testid=install-app-dialog]').innerText`));
    await closeDialog();
    assert.equal(record().templateVersion, now);
    assert.equal(JSON.parse(readFileSync(manifestPath(one.bundle), 'utf8')).templateVersion, now);
    checkPackage(one.bundle, one.installId);

    // Stale while the desktop app is not running: rebuilt at its next start.
    await stopDesktop();
    patchRecord({ templateVersion: '0.0.0+older' });
    await startDesktop();
    await desktop.line(/installed apps: refreshed at start .*"refreshed"/, 60_000);
    assert.equal(record().templateVersion, now);
    assert.equal(record().bundlePath, one.bundle);
    checkPackage(one.bundle, one.installId);
    const app = await startApp();
    const ready = await app.ready();
    assert.equal(ready.problem, null, js(ready));
    await stopApp(app, { force: true });
  });

  it('repair: its package missing, Repair builds it again in place; its place not its own, only Remove Record', T, async () => {
    await needDesktop();
    const aside = join(profile.root, 'trash-of-the-test');
    mkdirSync(aside, { recursive: true });
    renameSync(one.bundle, join(aside, 'Harbour again.app'));
    await openDialog();
    await waitDialog('needsRepair');
    assert.match(await text('install-app-reason'), /cannot be found/);
    assert.deepEqual(await buttons(), ['install-app-close', 'install-app-forget', 'install-app-repair']);
    assert.equal(await click('install-app-repair'), true);
    await waitDialog('installed', 60_000);
    await closeDialog();
    checkPackage(one.bundle, one.installId);
    rmSync(aside, { recursive: true, force: true });

    // Something else at its place (its manifest names another install): Remove Record only, and nothing is changed.
    const kept = readFileSync(manifestPath(one.bundle));
    writeFileSync(manifestPath(one.bundle), js({ installId: 'someone-else' }));
    try {
      await openDialog();
      await waitDialog('needsRepair');
      assert.match(await text('install-app-reason'), /something else/);
      assert.deepEqual(await buttons(), ['install-app-close', 'install-app-forget']);
      await closeDialog();
    } finally {
      writeFileSync(manifestPath(one.bundle), kept);
    }
    assert.equal((await apps('state', id)).state, 'installed');
    checkPackage(one.bundle, one.installId);
  });

  it('uninstall while it runs with unsaved work kept: given up after the timeout, the record back to installed, the package kept', T, async () => {
    await needDesktop();
    const app = await startApp();
    await app.ready();
    await app.connect();
    if (!(await until(async () => (await app.info()).status === 'ready', 30_000))) assert.fail(`not ready: ${js(await app.info())}\n${await (await app.view(id)).evaluate('document.body.innerText.slice(0, 800)').catch((e) => String(e))}\n${app.lines.join('\n')}`);
    await until(async () => (await app.info()).saved !== null, 10_000);
    await app.page.evaluate(`artifactApp.test.saved({ state: 'unsaved', leaveLosesWork: true })`);
    assert.equal((await apps('state', id)).running, true, 'the desktop app does not see it running');
    const asked = desktop.chrome.evaluate(`desktop.apps.uninstall(${js(id)}, ${js(one.installId)})`);
    // The app sees `uninstalling` in its record and asks about its unsaved work; the person keeps it.
    assert.ok(await app.page.waitFor(`!document.querySelector('[data-testid=ask]').hidden`, 20_000), 'no question about the unsaved work');
    assert.match(app.lines.join('\n'), /the record says uninstalling: quitting/);
    await app.page.evaluate(`document.querySelector('[data-testid=ask-cancel]').click(), true`);
    const out = await asked;
    assert.equal(out?.ok, true, js(out));
    assert.deepEqual([out.value.removed, out.value.stillRunning, out.value.state.state], [false, true, 'installed'], js(out.value));
    assert.equal(app.exited, null, 'the app quit');
    assert.equal(record().phase, 'installed');
    checkPackage(one.bundle, one.installId);

    // Saved now: the dialog's Uninstall… (asked first), and the app quits by itself.
    await app.page.evaluate(`artifactApp.test.saved({ state: 'saved', leaveLosesWork: false })`);
    await openDialog();
    await waitDialog('installed');
    assert.ok(await page(`!!document.querySelector('[data-testid=install-app-running]')`), 'not said to be running');
    assert.equal(await click('install-app-uninstall'), true);
    assert.ok(await waitPage(`!!document.querySelector('[data-testid=install-app-confirm]')`), 'not asked first');
    assert.equal(await click('install-app-confirm-yes'), true);
    if (!(await until(() => app.exited, 20_000))) assert.fail(`the app did not quit by itself:\n${app.lines.join('\n')}\n${desktop.lines.filter((l) => /installed apps/.test(l)).join('\n')}`);
    running.delete(app);
    assert.equal(app.exited.code, 0, js(app.exited));
    await waitDialog('available', 30_000);
    assert.equal(await text('install-app-message'), 'Uninstalled.');
    await closeDialog();
    assert.equal(existsSync(one.bundle), false);
    assert.equal(existsSync(recordPath(one.installId)), false);
    assert.equal(existsSync(join(profile.oaHome, 'desktop', 'apps', one.installId)), false, 'the app\'s own folder is still there');
    assert.match(desktop.lines.join('\n'), /trash .* \(test mode: removed, not moved to the Trash\)/);
    // The artifact and its folder are as they were.
    const artifact = await library(daemonState(profile), `artifact?id=${id}`);
    assert.equal(artifact.id, id);
    assert.ok(existsSync(artifact.root));
  });

  it('installed again: a new install id; uninstalled while it does not run; the old id\'s uninstall touches nothing', T, async () => {
    await needDesktop();
    await openDialog();
    await waitDialog('available');
    assert.equal(await click('install-app-install'), true);
    await waitDialog('installed', 60_000);
    await closeDialog();
    const state = await apps('state', id);
    assert.notEqual(state.installId, one.installId);
    const old = await apps('uninstall', id, one.installId);
    assert.deepEqual([old.removed, old.state.installId], [false, state.installId], js(old));
    checkPackage(state.bundlePath, state.installId);
    const out = await apps('uninstall', id, state.installId);
    assert.deepEqual([out.removed, out.state.state], [true, 'available'], js(out));
    assert.equal(existsSync(state.bundlePath), false);
    assert.equal(existsSync(recordPath(state.installId)), false);
  });
});
