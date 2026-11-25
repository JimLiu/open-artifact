/**
 * "Install as app" for an artifact whose title has Chinese, `#`, `?`, `%` and spaces in it (`npm run package` first;
 * `npm run test:packaged`). The app's package then has that name, and every path inside it (its status page, its
 * preload, the notice's page) does too: the status page's calls are checked against the page's own address, so the
 * two must agree however the path is written in a URL.
 *
 * Installed, then a cold start (no daemon); the status page draws what the main process says; the question about
 * unsaved work is answered with the page's own Yes button and the app quits; with its record gone, the "needs
 * repair" page's button reaches the main process. Everything in a throwaway profile, as in `installed-apps.test.mjs`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { APP, alive, daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from '../lib/env.mjs';
import { bundleIdOfExecutable, forgetLaunchedDefaults, launchApp, launchArtifactApp, library } from '../lib/app.mjs';

const T = { timeout: 300_000 };
const js = (value) => JSON.stringify(value);
const BUNDLE = join(APP, 'dist', 'Open Artifact-darwin-arm64', 'Open Artifact.app');
const binaryOf = (bundle) => join(bundle, 'Contents', 'MacOS', 'Open Artifact');
const TITLE = '计划 #2 50%?';

describe('install as app: a name with Chinese, #, ? and % (the packaged app)', () => {
  let profile;
  let port;
  let desktop = null;
  const running = new Set();
  let id;
  let installed;

  const installDir = () => join(profile.home, 'Applications', 'Open Artifact Apps');
  const recordPath = (installId) => join(profile.oaHome, 'desktop', 'apps', `${installId}.json`);
  const startDesktop = async () => {
    desktop = await launchApp(profile, port, { binary: binaryOf(BUNDLE) });
    await desktop.line(/\[desktop\] ready /, 90_000);
    await desktop.connect();
  };
  const stopDesktop = async () => {
    await desktop?.quit({ force: true });
    desktop = null;
  };
  const apps = async (call, ...args) => {
    const answer = await desktop.chrome.evaluate(`desktop.apps.${call}(${args.map(js).join(', ')})`);
    assert.equal(answer?.ok, true, `desktop.apps.${call}: ${js(answer)}`);
    return answer.value;
  };
  const startApp = async () => {
    const one = await launchArtifactApp(profile, port, { binary: binaryOf(installed.bundle) });
    running.add(one);
    return one;
  };
  const stopApp = async (one, options) => {
    const exit = await one.quit(options);
    running.delete(one);
    return exit;
  };
  /** The lines the app logged about calls it refused (the page's calls not taken as its own). */
  const refusals = (one) => one.lines.filter((line) => /\] refused /.test(line));

  before(async () => {
    assert.ok(existsSync(binaryOf(BUNDLE)), `${BUNDLE} is missing: run npm run package in apps/desktop`);
    profile = makeProfile('oa-desktop-names-');
    port = await freePort();
    await startDesktop();
    const made = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title: TITLE, blank: true, folder: join(profile.artifacts, 'plan') });
    assert.ok(made.id, js(made));
    id = made.id;
  });

  after(async () => {
    for (const one of running) await one.quit({ force: true }).catch(() => {});
    await desktop?.quit({ force: true }).catch(() => {});
    await stopDaemon(profile);
    // Where macOS kept the app's preferences (the account's home, whatever HOME says): said, not checked.
    if (installed) {
      const bundleId = bundleIdOfExecutable(binaryOf(installed.bundle));
      const file = (home) => join(home, 'Library', 'Preferences', `${bundleId}.plist`);
      console.log(`# preferences of ${bundleId}: in the profile ${existsSync(file(profile.home))}, in the account's home ${existsSync(file(userInfo().homedir))}`);
    }
    forgetLaunchedDefaults();
    const left = leftovers(profile);
    rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
    assert.equal(existsSync(profile.root), false);
  });

  it('installs under the title as it is', T, async () => {
    const state = await apps('state', id);
    assert.equal(state.state, 'available', js(state));
    assert.equal(state.suggestedName, TITLE, js(state));
    const result = await apps('install', id, { confirmedName: TITLE });
    assert.equal(result.state?.state, 'installed', js(result));
    const bundle = join(installDir(), `${TITLE}.app`);
    assert.ok(existsSync(binaryOf(bundle)), `no package at ${bundle}`);
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundle]);
    installed = { bundle, installId: result.state.installId };
  });

  it('a cold start: the status page draws, the page\'s calls are its own, the unsaved question\'s Yes quits', T, async () => {
    await stopDesktop();
    await stopDaemon(profile);
    assert.ok(await until(() => !daemonState(profile)?.pid || !alive(daemonState(profile).pid), 15_000));
    const one = await startApp();
    const ready = await one.ready();
    assert.equal(ready.problem, null, js(ready));
    await one.connect();
    // The page's own calls (the test bridge's too) go through the same check as its buttons.
    const info = await one.page.evaluate('artifactApp.test.info().then((v) => v, (e) => ({ refused: String(e?.message ?? e) }))');
    assert.equal(info?.refused, undefined, `the page's call was refused: ${js(info)}\n${refusals(one).join('\n')}`);
    assert.ok(await until(async () => (await one.info()).status === 'ready', 30_000), js(await one.info()));
    assert.equal((await one.info()).windowTitle, TITLE);

    // Once the Shell has said how its saving goes (else its first word would replace the test's), unsaved work.
    await until(async () => (await one.info()).saved !== null, 10_000);
    await one.page.evaluate(`artifactApp.test.saved({ state: 'unsaved', leaveLosesWork: true })`);
    assert.equal((await one.info()).unsaved, true);
    await one.page.evaluate('artifactApp.test.closeWindow()');
    assert.ok(await one.page.waitFor(`!document.querySelector('[data-testid=ask]').hidden`, 15_000), 'no question about the unsaved work');
    assert.ok((await one.page.evaluate(`document.querySelector('[data-testid=ask-title]').textContent`)).includes(TITLE));
    await one.page.evaluate(`document.querySelector('[data-testid=ask-yes]').click(), true`).catch(() => {});
    assert.ok(await until(() => one.exited, 15_000), `Yes did not quit the app:\n${refusals(one).join('\n')}`);
    running.delete(one);
    assert.equal(one.exited.code, 0, js(one.exited));
    assert.match(one.lines.join('\n'), /answer close: yes/);
    assert.deepEqual(refusals(one), []);
  });

  it('its record gone: the "needs repair" page says so, and its button reaches the main process', T, async () => {
    const file = recordPath(installed.installId);
    const kept = readFileSync(file);
    try {
      unlinkSync(file);
      const one = await startApp();
      const ready = await one.ready();
      assert.equal(ready.problem, 'needs-repair', js(ready));
      await one.connect();
      assert.ok(await until(async () => (await one.page.evaluate(`document.querySelector('[data-testid=status-title]').textContent`)).length > 0, 10_000), `the status page says nothing:\n${refusals(one).join('\n')}`);
      const button = await one.page.evaluate(`(() => { const b = document.querySelector('[data-testid=status-actions] button'); if (!b) return null; b.click(); return b.dataset.testid; })()`);
      assert.ok(button, 'no button on the page');
      assert.ok(await until(() => one.lines.some((line) => /\[artifact-app\] act /.test(line)), 10_000), `the button did nothing:\n${refusals(one).join('\n')}`);
      const { handoffs } = await one.info();
      assert.deepEqual(handoffs.map((entry) => [entry.what, entry.id]), [['artifact', id]], js(handoffs));
      assert.equal(button, 'action-open-artifact');
      assert.match(await one.page.evaluate(`document.querySelector('[data-testid=status]').innerText`), /install record is missing/);
      assert.deepEqual(refusals(one), []);
      await stopApp(one, { force: true });
    } finally {
      writeFileSync(file, kept);
    }
  });
});
