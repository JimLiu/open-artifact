import type { InstallRecord } from '../../src/installed-app-types.ts';
import type { DaemonHostMarker } from '../../src/types.ts';
import type { TestApp as DesktopTestApp, TestArtifactApp } from '../lib/app.ts';
import { appsOn } from '../lib/app.ts';
import { present } from '../lib/assertions.ts';
import type { TestProfile } from '../lib/env.ts';
/**
 * "Install as app" while the home's daemon runs from an app's own package (`npm run package` first;
 * `npm run test:packaged`): the app started it because its record's desktop app was not there. Then, one at a time:
 * the package renamed in the Finder and the app started again; renamed again and the desktop app started; its Update; the uninstall of another app; the uninstall
 * of that very app (refused first while a tab holds unsaved work). Each time the artifact still opens, the daemon's log
 * never says a type "is not installed", and the daemon was restarted (a new pid) whenever the package it ran from was
 * moved or removed (the other app's uninstall leaves it as it is).
 *
 * As the other packaged tests: one throwaway profile (HOME, the Open Artifact home, the install folder under that
 * HOME), the desktop app and the generated app started only by their executables with `--test-mode` and a port that is
 * not 4800. Only one generated app is ever started (macOS keeps a preferences file per bundle id started, in the
 * account's own Library); the other is installed and uninstalled without being started.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { forgetLaunchedDefaults, launchApp, launchArtifactApp, library } from '../lib/app.ts';
import { APP, alive, daemonState, freePort, leftovers, makeProfile, sleep, stopDaemon, until } from '../lib/env.ts';

const T = { timeout: 300_000 };
const js = (value: unknown) => JSON.stringify(value);
const BUNDLE = join(APP, 'dist', 'Open Artifact-darwin-arm64', 'Open Artifact.app');
const binaryOf = (bundle: string) => join(bundle, 'Contents', 'MacOS', 'Open Artifact');

describe("install as app: the daemon running from an app's package (the packaged app)", () => {
  let profile: TestProfile;
  let port: number;
  let desktop: DesktopTestApp | null;
  const running = new Set<TestArtifactApp>();
  /** The app the daemon is started from (`{ id, installId, bundle }`), and the other one (never started). */
  const host = { id: '', installId: '', bundle: '' };
  const other = { id: '', installId: '', bundle: '' };

  const recordPath = (installId: string) => join(profile.oaHome, 'desktop', 'apps', `${installId}.json`);
  const readRecord = (installId: string) => JSON.parse(readFileSync(recordPath(installId), 'utf8')) as InstallRecord;
  const patchRecord = (installId: string, patch: Partial<InstallRecord>) =>
    writeFileSync(recordPath(installId), `${js({ ...readRecord(installId), ...patch })}\n`);
  const daemonLog = () => join(profile.oaHome, 'logs', 'daemon.out');
  const logSize = () => (existsSync(daemonLog()) ? statSync(daemonLog()).size : 0);
  /** What the daemon's log says since `offset`. */
  const logSince = (offset: number) => (existsSync(daemonLog()) ? readFileSync(daemonLog()).subarray(offset).toString('utf8') : '');
  const pid = () => daemonState(profile)?.pid ?? null;

  const startDesktop = async () => {
    desktop = await launchApp(profile, port, { binary: binaryOf(BUNDLE) });
    await desktop.line(/\[desktop\] ready /, 90_000);
    await desktop.connect();
    return desktop;
  };
  const stopDesktop = async () => {
    await desktop?.quit({ force: true });
    desktop = null;
  };
  const apps = appsOn(() => present(desktop));
  const startApp = async () => {
    const it = await launchArtifactApp(profile, port, { binary: binaryOf(host.bundle) });
    running.add(it);
    return it;
  };
  const stopApp = async (it: TestArtifactApp) => {
    await it.quit({ force: true });
    running.delete(it);
  };
  /** The app's artifact shown (its status `ready`). */
  const openInApp = async (it: TestArtifactApp) => {
    const ready = await it.ready();
    assert.equal(ready.problem, null, js(ready));
    await it.connect();
    if (!(await until(async () => (await it.info()).status === 'ready', 45_000))) assert.fail(`not ready: ${js(await it.info())}\n${it.lines.join('\n')}`);
    return ready;
  };
  /**
   * The daemon running from the host app's package: no desktop app, no daemon, every record's desktop app "gone"
   * (`templatePath`), and the host app started (then quit: the daemon outlives it). Answers the daemon's pid.
   */
  const daemonInHost = async () => {
    await stopDesktop();
    await stopDaemon(profile);
    assert.ok(await until(() => !pid() || !alive(pid()), 15_000), 'the daemon is still there');
    for (const installId of [host.installId, other.installId])
      if (existsSync(recordPath(installId))) patchRecord(installId, { templatePath: join(profile.root, 'gone', 'Open Artifact.app') });
    const it = await startApp();
    const ready = await openInApp(it);
    assert.equal(ready.daemonExe, binaryOf(host.bundle), js(ready));
    assert.match(it.lines.join('\n'), /daemon start: this app/);
    const marker = JSON.parse(readFileSync(join(profile.oaHome, 'desktop', 'daemon-host.json'), 'utf8')) as DaemonHostMarker;
    assert.deepEqual([marker.pid, marker.installId], [pid(), host.installId], js(marker));
    await stopApp(it);
    assert.ok(alive(pid()), 'the daemon went with the app');
    return pid();
  };

  before(async () => {
    assert.ok(existsSync(binaryOf(BUNDLE)), `${BUNDLE} is missing: run npm run package in apps/desktop`);
    profile = makeProfile('oa-desktop-daemon-host-');
    port = await freePort();
    await startDesktop();
    for (const [into, title, folder] of [
      [host, 'Daemon host', 'host'],
      [other, 'Other app', 'other'],
    ] as const) {
      const made = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title, blank: true, folder: join(profile.artifacts, folder) });
      assert.ok(made.id, js(made));
      const out = await apps('install', made.id, { confirmedName: title });
      assert.ok(out.state?.state === 'installed', js(out));
      Object.assign(into, { id: made.id, installId: out.state.installId, bundle: out.state.bundlePath });
    }
  });

  beforeEach(async () => {
    for (const it of [...running]) await stopApp(it).catch(() => {});
  });

  after(async () => {
    for (const it of running) await it.quit({ force: true }).catch(() => {});
    await desktop?.quit({ force: true }).catch(() => {});
    await stopDaemon(profile);
    forgetLaunchedDefaults();
    const left = leftovers(profile);
    rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('renamed in the Finder, then started again: the app restarts the daemon before its artifact opens', T, async () => {
    const before = await daemonInHost();
    const offset = logSize();
    const renamed = join(profile.home, 'Applications', 'Open Artifact Apps', 'Daemon host (renamed).app');
    renameSync(host.bundle, renamed);
    host.bundle = renamed;
    const it = await startApp();
    const ready = await openInApp(it);
    assert.match(it.lines.join('\n'), /claimed its record/);
    assert.match(it.lines.join('\n'), /runs from files that are gone/);
    assert.notEqual(pid(), before, 'the daemon was not restarted');
    assert.equal(ready.daemon?.pid, pid(), js(ready));
    assert.doesNotMatch(logSince(offset), /is not installed/);
    await stopApp(it);
  });

  it('Update: the daemon restarted from the desktop app first, then the app rebuilt; it opens', T, async () => {
    const before = await daemonInHost();
    await startDesktop();
    // The desktop app at start leaves the daemon be (its files are there) and refreshes nothing (nothing is stale).
    assert.equal(pid(), before);
    patchRecord(host.installId, { templateVersion: '0.0.0+old' });
    const offset = logSize();
    const out = await apps('refresh', host.id, host.installId);
    assert.equal(out.rebuilt, true, js(out));
    assert.notEqual(pid(), before, 'the daemon was not restarted');
    assert.match(present(desktop).lines.join('\n'), /the daemon runs from .*Daemon host.*restarted from elsewhere first/);
    assert.match(present(desktop).lines.join('\n'), /service: restarted/);
    await stopDesktop();
    const it = await startApp();
    await openInApp(it);
    assert.doesNotMatch(logSince(offset), /is not installed/);
    await stopApp(it);
  });

  it('the uninstall of another app: the daemon (in the first one) is left as it is; the first one still opens', T, async () => {
    const before = await daemonInHost();
    await startDesktop();
    const offset = logSize();
    const out = await apps('uninstall', other.id, other.installId);
    assert.deepEqual([out.removed, out.state.state], [true, 'available'], js(out));
    assert.equal(existsSync(other.bundle), false);
    assert.equal(pid(), before, 'the daemon was restarted for an app it does not run from');
    // Its preferences file is looked for where macOS keeps it (the account's own Library): never removed by a test.
    assert.match(
      present(desktop).lines.join('\n'),
      /preferences file .*Library\/Preferences\/dev\.openartifact\.app\.[0-9a-f-]+\.plist left \(test mode: not in the test's own HOME\)/,
    );
    await stopDesktop();
    const it = await startApp();
    await openInApp(it);
    assert.doesNotMatch(logSince(offset), /is not installed/);
    await stopApp(it);
  });

  it('renamed in the Finder, then the desktop app started: it restarts the daemon at start; the artifact opens there', T, async () => {
    const before = await daemonInHost();
    const offset = logSize();
    const renamed = join(profile.home, 'Applications', 'Open Artifact Apps', 'Daemon host (moved again).app');
    renameSync(host.bundle, renamed);
    host.bundle = renamed;
    await startDesktop();
    assert.ok(await present(desktop).line(/runs from files that are gone/, 30_000));
    assert.ok(await until(() => pid() && pid() !== before && alive(pid()), 30_000), 'the daemon was not restarted');
    await present(desktop).open(host.id);
    assert.ok(
      await until(async () => (await present(desktop).state()).tabs.find((tab) => tab.id === host.id)?.status === 'ready', 45_000),
      js(await present(desktop).state()),
    );
    assert.doesNotMatch(logSince(offset), /is not installed/);
    await present(desktop).chrome.evaluate<boolean>(`desktop.close(${js(host.id)})`);
  });

  it('the uninstall of the app the daemon runs from: refused while a tab holds unsaved work; then restarted first and removed', T, async () => {
    const before = await daemonInHost();
    await startDesktop();
    const offset = logSize();
    // A tab with unsaved work: the shared daemon is not restarted, and nothing is moved.
    await present(desktop).open(host.id);
    assert.ok(
      await until(async () => (await present(desktop).state()).tabs.find((tab) => tab.id === host.id)?.status === 'ready', 45_000),
      js(await present(desktop).state()),
    );
    // The Shell says its own saved state first (it would overwrite the test's); then the test's.
    assert.ok(
      await until(async () => (await present(desktop).state()).tabs.find((tab) => tab.id === host.id)?.saved !== null, 20_000),
      js(await present(desktop).state()),
    );
    await sleep(300);
    await present(desktop).chrome.evaluate<boolean>(`desktop.test.saved(${js(host.id)}, { state: 'unsaved', leaveLosesWork: true })`);
    assert.equal((await present(desktop).state()).tabs.find((tab) => tab.id === host.id)?.unsaved, true);
    const refused = await apps('uninstall', host.id, host.installId);
    assert.deepEqual(
      [refused.removed, refused.daemonInUse, refused.state.state],
      [false, true, 'installed'],
      `${js(refused)} pid ${before} -> ${pid()}\n${present(desktop)
        .lines.filter((line) => /installed apps|daemon|service/.test(line))
        .join('\n')}`,
    );
    assert.ok(existsSync(binaryOf(host.bundle)), 'the package was moved');
    assert.equal(readRecord(host.installId).phase, 'installed');
    assert.equal(pid(), before);
    assert.match(present(desktop).lines.join('\n'), /the daemon is not restarted: 1 tab\(s\) hold unsaved work/);
    // Saved: restarted from the desktop app, then uninstalled.
    await present(desktop).chrome.evaluate<boolean>(`desktop.test.saved(${js(host.id)}, { state: 'saved', leaveLosesWork: false })`);
    const out = await apps('uninstall', host.id, host.installId);
    assert.deepEqual([out.removed, out.state.state], [true, 'available'], js(out));
    assert.equal(existsSync(host.bundle), false);
    assert.notEqual(pid(), before, 'the daemon was not restarted');
    // The artifacts still open in the desktop app, each type loaded by the new daemon.
    await present(desktop).open(other.id);
    assert.ok(
      await until(async () => (await present(desktop).state()).tabs.find((tab) => tab.id === other.id)?.status === 'ready', 45_000),
      js(await present(desktop).state()),
    );
    assert.doesNotMatch(logSince(offset), /is not installed/);
  });
});
