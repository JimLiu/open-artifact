/**
 * "Install as app" with the packaged app (`npm run package` first). Run with `npm run test:packaged`.
 *
 * Everything runs in a throwaway profile: the desktop app is started as `packaged.test.mjs` starts it (`--home` a
 * throwaway folder, a port that is not 4800, `--test-mode`, the profile's HOME), so its install folder is
 * `<profile HOME>/Applications/Open Artifact Apps/` and nothing is written to the person's Applications. The apps it
 * makes are started only through `launchArtifactApp` (their executable directly, `--test-mode`, the same port; their
 * home is the throwaway one their `artifact-app.json` names). Nothing is opened with `open` or Launch Services: test
 * mode's install answers `launch: 'skipped'`.
 *
 * - Installed through the desktop app's IPC (`desktop.apps.install`): the package is there, signed (`codesign --verify
 *   --strict`), with its own bundle id and display name, the manifest and the record; a clone takes little space.
 * - Two artifacts of one title make two packages.
 * - Cold start with no node on PATH and no daemon: the app starts the daemon with the desktop app's executable, an
 *   edit is saved to the folder, and the desktop app shows it.
 * - One instance of an app; the desktop app and two artifacts' apps run side by side.
 * - Its menu, "All artifacts" handed to the desktop app, the question about unsaved work, the desktop app's look and
 *   language.
 * - An agent's open never lands in an artifact's app (with the desktop app running, and without it).
 * - A broken manifest, a removed record, an artifact removed from the library: a reason, never a blank window.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { APP, NO_NODE_PATH, alive, daemonState, freePort, leftovers, makeProfile, processes, stopDaemon, treeOf, until } from '../lib/env.mjs';
import { launchApp, launchArtifactApp, library } from '../lib/app.mjs';
import { TYPES, editorFrame } from '../lib/editing.mjs';

const T = { timeout: 300_000 };
const js = (value) => JSON.stringify(value);
const BUNDLE = join(APP, 'dist', 'Open Artifact-darwin-arm64', 'Open Artifact.app');
const binaryOf = (bundle) => join(bundle, 'Contents', 'MacOS', 'Open Artifact');
const plistOf = (bundle) => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8' }));
const manifestPath = (bundle) => join(bundle, 'Contents', 'Resources', 'artifact-app.json');
/** Free kilobytes on the volume of `path` (`df -k`). */
const freeKb = (path) => Number(execFileSync('/bin/df', ['-k', path], { encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s+/)[3]);
const SESSION = { session: 'installed-apps', workspace: null };

/** Every `.app` under `dir`. */
function appsUnder(dir) {
  const out = [];
  const walk = (at) => {
    let names = [];
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(at, name);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      if (name.endsWith('.app')) out.push(path);
      else walk(path);
    }
  };
  walk(dir);
  return out;
}

describe('install as app (the packaged app)', () => {
  let profile;
  let port;
  let desktop = null;
  let agent = null;
  const running = new Set();
  /** artifact id → { installId, displayName, bundle, record } */
  const installed = {};
  let docId;
  let sameA;
  let sameB;

  const installDir = () => join(profile.home, 'Applications', 'Open Artifact Apps');
  const recordPath = (installId) => join(profile.oaHome, 'desktop', 'apps', `${installId}.json`);
  const startDesktop = async (args = []) => {
    desktop = await launchApp(profile, port, { binary: binaryOf(BUNDLE), args });
    await desktop.line(/\[desktop\] ready /, 90_000);
    await desktop.connect();
    return desktop;
  };
  /** The desktop app, started when a test before this one left it stopped. */
  const needDesktop = async () => desktop ?? startDesktop();
  const stopDesktop = async () => {
    await desktop?.quit({ force: true });
    desktop = null;
  };
  const startArtifactApp = async (id, { connect = true, defaultLocale = true } = {}) => {
    const one = await launchArtifactApp(profile, port, { binary: binaryOf(installed[id].bundle), defaultLocale });
    running.add(one);
    if (connect) {
      await one.ready();
      await one.connect();
    }
    return one;
  };
  const stopArtifactApp = async (one, options) => {
    const exit = await one.quit(options);
    running.delete(one);
    return exit;
  };
  /** `desktop.apps.<call>(…)` through the desktop app's preload; its answers come as `{ ok, value }`. */
  const apps = async (call, ...args) => {
    const answer = await desktop.chrome.evaluate(`desktop.apps.${call}(${args.map(js).join(', ')})`);
    assert.equal(answer?.ok, true, `desktop.apps.${call}: ${js(answer)}`);
    return answer.value;
  };
  const install = async (id) => {
    const result = await apps('install', id);
    assert.equal(result?.state?.state, 'installed', js(result));
    const { installId, displayName } = result.state;
    installed[id] = { installId, displayName, bundle: join(installDir(), `${displayName}.app`), record: JSON.parse(readFileSync(recordPath(installId), 'utf8')) };
    return result;
  };
  const agentDoc = async (title) => {
    const made = await agent.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/docs', title }, SESSION);
    const id = String(made.url).replace('open-artifact://artifact/', '');
    assert.ok(id.startsWith('art_'), js(made));
    return id;
  };

  before(async () => {
    assert.ok(existsSync(binaryOf(BUNDLE)), `${BUNDLE} is missing: run npm run package in apps/desktop`);
    profile = makeProfile('oa-desktop-apps-');
    SESSION.workspace = profile.artifacts;
    port = await freePort();
    assert.notEqual(port, 4800);
    await startDesktop();
    const line = await desktop.profileLine();
    assert.equal(line.guarded, true, js(line));
    assert.equal(line.home, profile.oaHome);
    const { createHarness } = await import(resolve(APP, '..', '..', 'packages', 'harness-kit', 'src', 'index.ts'));
    // An agent app with no `open` of its own (Claude Code through the kit).
    agent = await createHarness({ harness: 'claude-code', home: profile.oaHome, autoStart: false, reconnect: { minMs: 200, maxMs: 1000 }, log: () => {} });
    await agent.ready();
    await agent.attach(SESSION);
  });

  // An app a failed test left running would make the next start of it a second instance.
  beforeEach(async () => {
    for (const one of [...running]) await stopArtifactApp(one, { force: true }).catch(() => {});
  });

  after(async () => {
    for (const one of running) await one.quit({ force: true }).catch(() => {});
    try {
      agent?.close();
    } catch {}
    await desktop?.quit({ force: true }).catch(() => {});
    await stopDaemon(profile);
    const left = leftovers(profile);
    rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
    assert.equal(existsSync(profile.root), false, 'the throwaway profile (and the apps in it) is still there');
  });

  it('installed through the desktop app\'s IPC: a signed package with its own id and name, its manifest and record; a clone', T, async (t) => {
    assert.ok(await until(async () => js(await desktop.menu()).includes('"new:docs"'), 20_000), 'File ▸ New has no Docs');
    const made = await desktop.command('new:docs');
    assert.equal(made.ok, true, js(made));
    docId = made.value.id;
    const before = await apps('state', docId);
    assert.equal(before.state, 'available', js(before));
    assert.equal(before.needsCopy, false, js(before));
    assert.match(before.suggestedName, /^[\x20-\x7e]+$/, `an ASCII name is expected for the ps checks: ${before.suggestedName}`);

    const free0 = freeKb(profile.root);
    const result = await install(docId);
    const free1 = freeKb(profile.root);
    assert.equal(result.launch, 'skipped', js(result));
    const { bundle, installId, displayName, record } = installed[docId];
    assert.equal(displayName, before.suggestedName);
    assert.ok(existsSync(binaryOf(bundle)), `no package at ${bundle}`);
    assert.ok(bundle.startsWith(`${profile.home}/Applications/Open Artifact Apps/`), bundle);
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundle]);

    const plist = plistOf(bundle);
    assert.equal(plist.CFBundleIdentifier, `dev.openartifact.app.${installId}`);
    assert.equal(plist.CFBundleDisplayName, displayName);
    assert.equal(plist.CFBundleName, 'Open Artifact');
    assert.equal(plist.CFBundleExecutable, 'Open Artifact');
    assert.equal(plist.CFBundleIconFile, 'AppIcon.icns');
    assert.equal('CFBundleURLTypes' in plist, false);
    assert.ok(existsSync(join(bundle, 'Contents', 'Resources', 'AppIcon.icns')));

    const manifest = JSON.parse(readFileSync(manifestPath(bundle), 'utf8'));
    assert.equal(manifest.home, profile.oaHome);
    assert.equal(manifest.artifactId, docId);
    assert.equal(manifest.installId, installId);

    assert.equal(record.phase, 'installed', js(record));
    assert.equal(record.artifactId, docId);
    assert.equal(record.bundlePath, bundle);
    assert.equal(record.templatePath, BUNDLE);
    assert.equal(record.cloned, true, js(record));
    assert.ok(!('tempPath' in record), js(record));

    assert.match(desktop.lines.join('\n'), /installed apps: open .* \(test mode: not opened\)/);
    const again = await apps('install', docId);
    assert.equal(again.reused, true, js(again));
    assert.equal(appsUnder(installDir()).length, 1, js(appsUnder(installDir())));

    const used = free0 - free1;
    const size = Number(execFileSync('/usr/bin/du', ['-sk', BUNDLE], { encoding: 'utf8' }).split(/\s+/)[0]);
    t.diagnostic(`df -k: ${used} KB used by the install (the desktop package is ${size} KB)`);
    // Other writes on the volume move the number; a copy would take the whole package.
    assert.ok(used < size / 4, `the install took ${used} KB of ${size} KB: not a clone?`);
  });

  it('two artifacts of one title make two packages', T, async () => {
    sameA = await agentDoc('Field notes');
    sameB = await agentDoc('Field notes');
    await install(sameA);
    await install(sameB);
    const a = installed[sameA];
    const b = installed[sameB];
    assert.equal(a.displayName, 'Field notes');
    assert.equal(b.displayName, 'Field notes (2)');
    assert.notEqual(a.bundle, b.bundle);
    assert.notEqual(plistOf(a.bundle).CFBundleIdentifier, plistOf(b.bundle).CFBundleIdentifier);
    for (const one of [a, b]) execFileSync('/usr/bin/codesign', ['--verify', '--strict', one.bundle]);
    assert.equal(appsUnder(installDir()).length, 3);
  });

  it('cold start, no node on PATH and no daemon: the desktop app\'s executable runs the daemon; an edit is saved and the desktop app shows it', T, async () => {
    let found = null;
    try {
      found = execFileSync('/usr/bin/which', ['node'], { env: { PATH: NO_NODE_PATH }, encoding: 'utf8' }).trim();
    } catch {
      // none
    }
    assert.equal(found, null, `node is on ${NO_NODE_PATH}`);
    await stopDesktop();
    const stopped = await stopDaemon(profile);
    assert.ok(stopped, 'no daemon was running');
    assert.ok(await until(() => !daemonState(profile)?.pid || !alive(daemonState(profile).pid), 15_000), 'the daemon is still there');

    const one = await startArtifactApp(docId);
    const ready = await one.ready();
    assert.equal(ready.problem, null, js(ready));
    assert.equal(ready.daemonExe, binaryOf(BUNDLE), js(ready));
    assert.match(one.lines.join('\n'), /daemon start: the desktop app/);
    const state = daemonState(profile);
    assert.ok(state?.pid && alive(state.pid), 'no daemon');
    assert.equal(new URL(state.url).port, String(port));
    const tree = treeOf(state.pid, processes());
    for (const p of tree) assert.ok(p.command.startsWith(binaryOf(BUNDLE)), `not the desktop app's executable: ${p.command}`);

    const info = await one.info();
    assert.equal(info.artifactId, docId);
    assert.equal(info.home, profile.oaHome);
    assert.equal(info.harness, 'open-artifact-app');
    assert.ok(info.windowTitle, js(info));
    assert.ok(await until(async () => (await one.info()).status === 'ready', 30_000), js(await one.info()));
    const page = (await one.info()).page;
    assert.equal(new URL(page.url).pathname, `/a/${docId}`, js(page));
    assert.equal(page.sandbox, true);
    assert.equal(page.nodeIntegration, false);
    assert.equal(page.preload, null);
    assert.equal(page.partition, 'persist:open-artifact-pages', js(page));

    const root = (await library(daemonState(profile), `artifact?id=${docId}`)).root;
    assert.ok(root.startsWith(`${profile.root}/`), root);
    const view = await one.view(docId);
    assert.ok(await view.waitInFrame(editorFrame('docs'), TYPES.docs.drawn, 30_000), 'the editor did not draw in the artifact\'s app');
    await TYPES.docs.edit(view, editorFrame('docs'));
    assert.ok(await until(() => TYPES.docs.onDisk(root), 20_000), 'the edit did not reach the folder');
    assert.ok(await until(async () => (await one.info()).saved === 'saved', 20_000), js(await one.info()));
    const exit = await stopArtifactApp(one);
    assert.equal(exit?.code, 0, js(exit));

    await startDesktop(['--open', docId]);
    assert.ok(await until(async () => (await desktop.state()).tabs.find((x) => x.id === docId)?.status === 'ready', 30_000), 'the desktop app did not open it');
    const again = await desktop.view(docId);
    assert.ok(await again.waitInFrame(editorFrame('docs'), TYPES.docs.shown, 20_000), 'the desktop app does not show the edit');
  });

  it('one instance of an app; the desktop app and two artifacts\' apps run side by side', T, async () => {
    await needDesktop();
    const first = await startArtifactApp(docId);
    const second = await launchArtifactApp(profile, port, { binary: binaryOf(installed[docId].bundle) });
    assert.ok(await until(() => second.exited, 20_000), 'a second start of the same app did not exit');
    assert.equal(second.exited.code, 0, js(second.exited));
    await first.line(/\[artifact-app\] second start/, 10_000);
    const other = await startArtifactApp(sameA);
    assert.ok(await until(async () => (await other.info()).status === 'ready', 30_000), js(await other.info()));
    assert.equal(first.exited, null);
    assert.equal(other.exited, null);
    assert.equal(desktop.exited, null);
    assert.equal((await desktop.state()).tabs.some((x) => x.id === docId), true);
    await stopArtifactApp(other);
    assert.equal(first.exited, null, 'quitting one app quit another');
    await stopArtifactApp(first);
    assert.equal(desktop.exited, null, 'quitting an artifact\'s app quit the desktop app');
  });

  it('its menu, "All artifacts" to the desktop app, the question about unsaved work, the desktop app\'s look and language', T, async () => {
    await stopDesktop();
    // The desktop app's settings (a guarded run keeps them in the home): dark, Chinese.
    const dir = join(profile.oaHome, 'desktop', 'user-data');
    const file = join(dir, 'settings.json');
    mkdirSync(dir, { recursive: true });
    const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    writeFileSync(file, `${js({ ...settings, theme: 'dark', locale: 'zh-CN' })}\n`);
    const one = await startArtifactApp(docId, { defaultLocale: false });
    assert.ok(await until(async () => (await one.info()).status === 'ready', 30_000), js(await one.info()));
    let info = await one.info();
    assert.equal(info.theme, 'dark', js(info));
    assert.equal(info.locale, 'zh', js(info));
    assert.equal(info.view.lang, 'zh-CN', js(info.view));

    const ids = [];
    const walk = (items) => {
      for (const item of items ?? []) {
        if (item.id) ids.push(item.id);
        walk(item.submenu);
      }
    };
    const menu = await one.page.evaluate('artifactApp.test.menu()');
    walk(menu);
    for (const id of ['about', 'library', 'reveal', 'close-window', 'reload']) assert.ok(ids.includes(id), `no ${id} in the menu: ${js(ids)}`);
    assert.ok(!ids.some((id) => id.startsWith('new:')), `the desktop app's New items: ${js(ids)}`);

    const handed = await one.page.evaluate(`artifactApp.test.command('library', null)`);
    assert.equal(handed?.ok, true, js(handed));
    info = await one.info();
    assert.deepEqual(info.handoffs.map((entry) => [entry.to, entry.what, entry.id]), [['desktop', 'library', null]], js(info.handoffs));
    assert.equal(info.handoffs[0].exe, binaryOf(BUNDLE));
    assert.match(one.lines.join('\n'), /hand-off .*\(test mode: not started\)/);
    assert.equal(desktop, null, 'the desktop app was started');

    // Unsaved work, the window closed: waited for (it does not save here), then asked; Cancel keeps the app.
    await one.page.evaluate(`artifactApp.test.saved({ state: 'unsaved', leaveLosesWork: true })`);
    await one.page.evaluate('artifactApp.test.closeWindow()');
    assert.ok(await one.page.waitFor(`!document.querySelector('[data-testid=ask]').hidden`, 15_000), 'no question about the unsaved work');
    assert.ok((await one.page.evaluate(`document.querySelector('[data-testid=ask-title]').textContent`)).length > 0);
    await one.page.evaluate(`document.querySelector('[data-testid=ask-cancel]').click(), true`);
    assert.ok(await one.page.waitFor(`document.querySelector('[data-testid=ask]').hidden`, 5000), 'the question stayed');
    assert.equal(one.exited, null, 'Cancel quit the app');
    assert.match(one.lines.join('\n'), /answer close: cancel/);
    // Asked again, Yes: the window closes and the app quits.
    await one.page.evaluate('artifactApp.test.closeWindow()');
    assert.ok(await one.page.waitFor(`!document.querySelector('[data-testid=ask]').hidden`, 15_000), 'not asked again');
    await one.page.evaluate(`document.querySelector('[data-testid=ask-yes]').click(), true`).catch(() => {});
    assert.ok(await until(() => one.exited, 15_000), 'Yes did not close the app');
    running.delete(one);
    assert.equal(one.exited.code, 0, js(one.exited));
    writeFileSync(file, `${js({ ...settings, theme: 'system', locale: 'system' })}\n`);
  });

  it('an agent\'s open never lands in an artifact\'s app (the desktop app running, and not)', T, async (t) => {
    await needDesktop();
    const turned = await library(daemonState(profile), 'desktop.settings', { openInDesktop: true });
    assert.equal(turned.openInDesktop, true, js(turned));
    const one = await startArtifactApp(sameA);
    assert.ok(await until(async () => (await one.info()).status === 'ready', 30_000), js(await one.info()));

    const opened = await agent.call('Artifact', { action: 'open', url: `open-artifact://artifact/${sameA}` }, SESSION);
    assert.equal(opened.opened_in, 'desktop', js(opened));
    assert.ok(await until(async () => (await desktop.state()).tabs.some((x) => x.id === sameA), 15_000), 'no tab of it in the desktop app');
    let info = await one.info();
    assert.deepEqual(info.handoffs, []);
    assert.equal(new URL(info.page.url).pathname, `/a/${sameA}`);
    assert.doesNotMatch(one.lines.join('\n'), /host\.open refused/);

    await stopDesktop();
    const alone = await agent.call('Artifact', { action: 'open', url: `open-artifact://artifact/${sameA}` }, SESSION).catch((error) => ({ error: String(error?.message ?? error) }));
    assert.notEqual(alone.opened_in, 'open-artifact-app', js(alone));
    t.diagnostic(`with the desktop app running: ${js(opened)}; without it: ${js(alone)}`);
    await new Promise((done) => setTimeout(done, 1500));
    info = await one.info();
    assert.deepEqual(info.handoffs, []);
    assert.equal(new URL(info.page.url).pathname, `/a/${sameA}`);
    assert.doesNotMatch(one.lines.join('\n'), /host\.open refused/);
    await stopArtifactApp(one);
    await library(daemonState(profile), 'desktop.settings', { openInDesktop: false });
  });

  it('a broken manifest: the app says why and exits; the desktop app says it needs repair', T, async (t) => {
    const { bundle } = installed[sameB];
    const kept = readFileSync(manifestPath(bundle));
    try {
      writeFileSync(manifestPath(bundle), '{ not json');
      const one = await startArtifactApp(sameB, { connect: false });
      assert.ok(await until(() => one.exited, 30_000), 'the app with a broken manifest did not exit');
      running.delete(one);
      assert.equal(one.exited.code, 2, js(one.exited));
      assert.match(one.lines.join('\n'), /\[artifact-app\] cannot start: /);
      await needDesktop();
      const state = await apps('state', sameB);
      assert.equal(state.state, 'needsRepair', js(state));
      t.diagnostic(`the desktop app: ${js(state)}; the app: ${one.lines.find((line) => line.includes('cannot start'))}`);
    } finally {
      writeFileSync(manifestPath(bundle), kept);
    }
    const state = await apps('state', sameB);
    assert.equal(state.state, 'installed', js(state));
  });

  it('its record removed: the app shows why (needs repair) and starts no daemon', T, async () => {
    const { installId } = installed[sameB];
    const kept = readFileSync(recordPath(installId));
    await stopDesktop();
    await stopDaemon(profile);
    try {
      unlinkSync(recordPath(installId));
      const one = await startArtifactApp(sameB);
      const ready = JSON.parse((await one.line(/\[artifact-app\] ready \{/)).replace(/^.*?ready /, ''));
      assert.equal(ready.problem, 'needs-repair', js(ready));
      assert.equal(ready.reason, 'no-record', js(ready));
      assert.equal(await one.status(), 'problem');
      const info = await one.info();
      assert.equal(info.problem?.kind, 'needs-repair', js(info));
      assert.ok(await until(async () => (await one.page.evaluate(`document.querySelector('[data-testid=status-title]').textContent`)).length > 0, 5000), 'the status page says nothing');
      assert.doesNotMatch(one.lines.join('\n'), /daemon start/);
      assert.equal(daemonState(profile)?.pid && alive(daemonState(profile).pid) ? 'running' : 'none', 'none', 'a daemon was started');
      const exit = await stopArtifactApp(one, { force: true });
      assert.equal(exit?.code, 0, js(exit));
    } finally {
      writeFileSync(recordPath(installId), kept);
    }
  });

  it('an artifact removed from the library: "not found", at start and while running', T, async () => {
    await needDesktop();
    // At start.
    const forgot = await library(daemonState(profile), 'artifacts.delete', { id: sameB });
    assert.ok(forgot, js(forgot));
    const one = await startArtifactApp(sameB);
    assert.ok(await until(async () => (await one.info()).problem?.kind === 'not-found', 15_000), js(await one.info()));
    assert.equal(await one.status(), 'problem');
    await stopArtifactApp(one, { force: true });
    // While running.
    const two = await startArtifactApp(sameA);
    assert.ok(await until(async () => (await two.info()).status === 'ready', 30_000), js(await two.info()));
    await library(daemonState(profile), 'artifacts.delete', { id: sameA });
    assert.ok(await until(async () => (await two.info()).problem?.kind === 'not-found', 15_000), js(await two.info()));
    assert.equal(await two.status(), 'problem');
    assert.equal((await two.info()).hasView, false);
    await stopArtifactApp(two, { force: true });
  });
});
