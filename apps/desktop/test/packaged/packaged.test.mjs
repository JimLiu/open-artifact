/**
 * The packaged app (`npm run package` first: `dist/Open Artifact-darwin-arm64/Open Artifact.app`), its key checks
 * again. Run with `npm run test:packaged`.
 *
 * Packaged, the app with no arguments uses the person's own home and port: so it is only ever started here, through
 * `launchApp(…, { binary })`, with `--home` a throwaway folder, a port that is not 4800, `--test-mode` (no shown window,
 * no Dock icon, nothing done outside the app) and the throwaway profile's HOME, OPEN_ARTIFACT_HOME and TMPDIR. The first
 * check proves that with these it uses the throwaway folder and nothing else.
 *
 * - With no `node` on PATH, a new Docs, Sheets, Slides and Whiteboard each open to their editor; the daemon and every
 *   type server run the package's own executable.
 * - New, edited, quit, opened again: the edit is still there.
 * - doctor runs.
 * - A copy of the package in another folder starts, and runs its daemon and type servers from there.
 * - The default package declares no URL scheme: its Info.plist has no CFBundleURLTypes (`OA_DESKTOP_URL_SCHEME=1`
 *   would add one; that path is checked on `scripts/info-plist.mjs` only, never by building such a package).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { APP, NO_NODE_PATH, alive, daemonState, freePort, leftovers, makeProfile, processes, stopDaemon, treeOf, until } from '../lib/env.mjs';
import { launchApp, library } from '../lib/app.mjs';
import { TYPES, editorFrame } from '../lib/editing.mjs';

const T = { timeout: 240_000 };
const BUNDLE = join(APP, 'dist', 'Open Artifact-darwin-arm64', 'Open Artifact.app');
const binaryOf = (bundle) => join(bundle, 'Contents', 'MacOS', 'Open Artifact');

describe('the packaged app', () => {
  let profile;
  let port;
  let app = null;
  let moved = null;
  const made = {};

  /** Starts the package at `bundle`, always isolated (see the top of this file). */
  const start = async (args = [], bundle = BUNDLE) => {
    app = await launchApp(profile, port, { binary: binaryOf(bundle), args });
    await app.line(/\[desktop\] ready /, 90_000);
    await app.connect();
    return app;
  };
  const stop = async () => {
    await app?.quit();
    app = null;
  };
  const tabReady = (id) => until(async () => (await app.state()).tabs.find((x) => x.id === id)?.status === 'ready', 30_000);

  before(() => {
    assert.ok(existsSync(binaryOf(BUNDLE)), `${BUNDLE} is missing: run npm run package in apps/desktop`);
    profile = makeProfile('oa-desktop-packaged-');
  });

  after(async () => {
    await app?.quit().catch(() => {});
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (moved) rmSync(moved, { recursive: true, force: true });
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('the default package declares no URL scheme (no CFBundleURLTypes in its Info.plist)', () => {
    const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(BUNDLE, 'Contents', 'Info.plist')], { encoding: 'utf8' }));
    assert.equal(plist.CFBundleIdentifier, 'dev.openartifact.desktop');
    assert.equal('CFBundleURLTypes' in plist, false, JSON.stringify(plist.CFBundleURLTypes));
  });

  it('with --home, a port, --test-mode and a throwaway HOME it uses the throwaway folders only', T, async () => {
    port = await freePort();
    assert.notEqual(port, 4800);
    await start();
    const line = await app.profileLine();
    assert.equal(line.packaged, true, JSON.stringify(line));
    assert.equal(line.testMode, true);
    assert.equal(line.guarded, true, 'a test-mode run of the package is guarded (no default home, no port 4800)');
    assert.equal(line.home, profile.oaHome);
    assert.equal(line.port, port);
    for (const path of Object.values(line.paths)) assert.ok(path.startsWith(`${profile.oaHome}/`), `${path} is not in the throwaway home`);
    const state = daemonState(profile);
    assert.ok(state?.pid && alive(state.pid), 'no daemon.json in the throwaway home');
    assert.equal(new URL(state.url).port, String(port));
    assert.equal(await app.chrome.evaluate('desktop.test.downloads()'), join(profile.home, 'Downloads'));
  });

  it('with no node on PATH, a new Docs, Sheets, Slides and Whiteboard each open; the daemon and type servers run the package', T, async () => {
    let found = null;
    try {
      found = execFileSync('/usr/bin/which', ['node'], { env: { PATH: NO_NODE_PATH }, encoding: 'utf8' }).trim();
    } catch {
      // none
    }
    assert.equal(found, null, `node is on ${NO_NODE_PATH}`);
    assert.ok(await until(async () => JSON.stringify(await app.menu()).includes('"new:whiteboard"'), 20_000), 'File ▸ New has no types');
    for (const type of Object.keys(TYPES)) {
      const answer = await app.command(`new:${type}`);
      assert.equal(answer.ok, true, `${type}: ${JSON.stringify(answer)}`);
      made[type] = answer.value.id;
      const view = await app.view(made[type]);
      assert.ok(await tabReady(made[type]), `${type}: the Shell never said it was ready`);
      assert.ok(await view.waitInFrame(editorFrame(type), TYPES[type].drawn, 30_000), `${type}: the editor did not draw`);
    }
    const tree = treeOf(daemonState(profile).pid, processes());
    assert.ok(tree.length >= 1 + Object.keys(TYPES).length, `not every type server runs: ${tree.map((p) => p.command.slice(0, 120)).join('\n')}`);
    for (const p of tree) assert.ok(p.command.startsWith(binaryOf(BUNDLE)), `not the package's executable: ${p.command}`);
  });

  it('new, edited, quit, opened again: the edit is still there', T, async () => {
    const id = made.docs;
    const root = (await library(daemonState(profile), `artifact?id=${id}`)).root;
    assert.ok(root.startsWith(`${profile.root}/`), `the artifact is not in the throwaway profile: ${root}`);
    assert.equal((await app.open(id))?.ok ?? true, true);
    const view = await app.view(id);
    await TYPES.docs.edit(view, editorFrame('docs'));
    assert.ok(await until(() => TYPES.docs.onDisk(root), 20_000), 'the edit did not reach the folder');
    assert.ok(await until(async () => (await app.state()).tabs.find((x) => x.id === id)?.saved === 'saved', 20_000), 'the tab does not say saved');
    await stop();
    await start(['--open', id]);
    const again = await app.view(id);
    assert.ok(await tabReady(id), 'the Shell never said it was ready (again)');
    assert.ok(await again.waitInFrame(editorFrame('docs'), TYPES.docs.shown, 20_000), 'the edit is not shown after opening it again');
  });

  it('doctor runs', T, async (t) => {
    const answer = await app.command('doctor');
    assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.ok(answer.value?.counts, JSON.stringify(answer.value));
    t.diagnostic(`doctor: ${JSON.stringify(answer.value)}`);
  });

  it('a copy of the package in another folder starts, and runs its daemon and type servers from there', T, async () => {
    await stop();
    // The daemon the first copy started would be used again: stopped, so the moved copy starts its own.
    await stopDaemon(profile);
    const into = join(profile.root, 'moved');
    mkdirSync(into, { recursive: true });
    moved = join(into, 'Open Artifact.app');
    execFileSync('/usr/bin/ditto', [BUNDLE, moved]);
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', moved]);
    await start(['--open', made.sheets], moved);
    assert.ok(await tabReady(made.sheets), 'the moved copy did not open the sheet');
    const view = await app.view(made.sheets);
    assert.ok(await view.waitInFrame(editorFrame('sheets'), TYPES.sheets.drawn, 30_000), 'the sheet did not draw');
    const tree = treeOf(daemonState(profile).pid, processes());
    assert.ok(tree.length >= 2, 'no type server under the moved copy\'s daemon');
    for (const p of tree) assert.ok(p.command.startsWith(binaryOf(moved)), `not the moved copy's executable: ${p.command}`);
    assert.match(readFileSync(join(moved, 'Contents', 'Info.plist'), 'utf8'), /dev\.openartifact\.desktop/);
    await stop();
  });
});
