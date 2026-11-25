/**
 * "Install as app" without Electron and without signing: the names (installed-apps.mjs), the records and the states,
 * an install cut short at each step and put right afterwards, two installs at once, the `Info.plist` edit (macOS's
 * `plutil` on a plist of the test's own), the guards on what may be written (installed-apps-macos.mjs), and the
 * single-artifact app's file and profile (profile.mjs).
 *
 * Every package here is a folder of the test's own in a throwaway folder; `codesign` is never run (the signature is a
 * file the fake `sign` writes), nothing is opened, and the install folder is always given.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  BUNDLE_ID_PREFIX,
  InstalledApps,
  NAME_MAX_BYTES,
  checkLaunch,
  displayNameOf,
  infoPlistEdits,
  installDirOf,
  readRecords,
  recordPathOf,
  uniqueName,
} from '../src/installed-apps.mjs';
import { macosOps } from '../src/installed-apps-macos.mjs';
import { artifactAppDir, bundleOfExecutable, checkArtifactApp, desktopSettingsDir, readArtifactApp, resolveArtifactAppProfile } from '../src/profile.mjs';

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>Open Artifact</string>
  <key>CFBundleExecutable</key><string>Open Artifact</string>
  <key>CFBundleIconFile</key><string>electron.icns</string>
  <key>CFBundleIdentifier</key><string>dev.openartifact.desktop</string>
  <key>CFBundleName</key><string>Open Artifact</string>
  <key>CFBundleShortVersionString</key><string>0.0.0</string>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>open-artifact</string></array></dict></array>
  <key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>abc</string></dict></dict>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
`;
const plistJson = (file) => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }));

/**
 * A world of the test's own: a HOME with the template package (the "desktop app") and its type icons, an install
 * folder in HOME, an Open Artifact home with records, a library of artifacts, and the ops (macOS's real ones for
 * everything but the copy, which is a plain copy, and the signature, which is a file).
 */
function world({ artifacts = {}, types = [{ id: 'docs' }, { id: 'remote-thing', remote: true }], version = '1.0.0+0.14.6', packaged = true, platform = 'darwin', checkpoint, randomId } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-apps-')));
  roots.push(root);
  const userHome = join(root, 'home');
  const home = join(root, 'oa');
  const template = join(root, 'dist', 'Open Artifact.app');
  const icons = join(root, 'dist', 'app-icons');
  for (const dir of [userHome, home, join(template, 'Contents', 'MacOS'), join(template, 'Contents', 'Resources'), icons]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(template, 'Contents', 'Info.plist'), PLIST);
  writeFileSync(join(template, 'Contents', 'MacOS', 'Open Artifact'), '#!/bin/sh\n');
  writeFileSync(join(template, 'Contents', 'Resources', 'electron.icns'), 'icon');
  for (const name of ['docs', 'default']) writeFileSync(join(icons, `${name}.icns`), `icon:${name}`);
  const installDir = installDirOf(userHome);
  const logs = [];
  const log = (line) => logs.push(line);
  const real = macosOps({ installDir, iconsDir: icons, testMode: true, log, userHome, accountHome: join(root, 'not-this') });
  const signed = new Set();
  const ops = {
    ...real,
    copyBundle(from, dest) {
      if (existsSync(dest)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      cpSync(from, dest, { recursive: true });
    },
    sign(bundle) {
      writeFileSync(join(bundle, 'Contents', 'signature'), JSON.stringify(real.readManifest(bundle)));
    },
    verify(bundle) {
      try {
        return readFileSync(join(bundle, 'Contents', 'signature'), 'utf8') === JSON.stringify(real.readManifest(bundle));
      } catch {
        return false;
      }
    },
    launch: real.launch,
    // Never the person's preferences from a unit test: what would be forgotten is only noted.
    forgetDefaults(bundleId) {
      forgotten.push(bundleId);
      return true;
    },
  };
  const forgotten = [];
  const library = {
    async record(id) {
      const found = artifacts[id];
      if (!found) throw Object.assign(new Error(`no artifact ${id}`), { status: 404 });
      return { id, ...found };
    },
    async types() {
      return { types };
    },
  };
  let n = 0;
  const make = (extra = {}) =>
    new InstalledApps({
      home,
      installDir,
      template: { bundlePath: template, executable: join(template, 'Contents', 'MacOS', 'Open Artifact'), version: () => version },
      packaged,
      platform,
      library,
      ops,
      checkpoint,
      log,
      randomId: randomId ?? (() => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`),
      ...extra,
    });
  return { root, userHome, home, template, icons, installDir, logs, ops, real, library, signed, forgotten, apps: make(), make };
}
const appsIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.app')).sort() : []);

describe('install as app: names', () => {
  it('a title made into an app name: NFC, / and : replaced, control characters and leading dots dropped, spaces made one', () => {
    assert.equal(displayNameOf('季度复盘'), '季度复盘');
    assert.equal(displayNameOf('  Q3 / Q4:  plan  '), 'Q3 - Q4- plan');
    assert.equal(displayNameOf('a\u0000b\u0007c\nd'), 'abc d');
    assert.equal(displayNameOf('...hidden'), 'hidden');
    assert.equal(displayNameOf('Café'), 'Café');
    assert.equal(displayNameOf('Café').length, 4);
  });

  it('nothing left: the type\'s name, else "Artifact"', () => {
    assert.equal(displayNameOf('', 'Docs'), 'Docs');
    assert.equal(displayNameOf('  ...  ', 'Docs'), 'Docs');
    assert.equal(displayNameOf(null), 'Artifact');
    assert.equal(displayNameOf('/', ''), '-');
    assert.equal(displayNameOf('\u0001', ''), 'Artifact');
  });

  it('a long name is cut on a whole character, within the byte budget', () => {
    const name = displayNameOf('汉'.repeat(200));
    assert.ok(Buffer.byteLength(name) <= NAME_MAX_BYTES);
    assert.equal(name, '汉'.repeat(Math.floor(NAME_MAX_BYTES / 3)));
    // A family emoji is one character of 25 bytes: never cut in half.
    const family = '👨‍👩‍👧‍👦';
    const cut = displayNameOf(family.repeat(20));
    assert.ok(Buffer.byteLength(cut) <= NAME_MAX_BYTES);
    assert.equal(cut, family.repeat(Math.floor(NAME_MAX_BYTES / Buffer.byteLength(family))));
    assert.ok(Buffer.byteLength(`${cut} (99).app`) <= 255);
  });

  it('a name taken (letter case and Unicode form ignored) gets (2), (3)…', () => {
    assert.equal(uniqueName('Plan', []), 'Plan');
    assert.equal(uniqueName('Plan', ['plan']), 'Plan (2)');
    assert.equal(uniqueName('Plan', ['Plan', 'PLAN (2)']), 'Plan (3)');
    assert.equal(uniqueName('Café', ['Café']), 'Café (2)');
  });
});

describe('install as app: Info.plist and the package', () => {
  it('only the display name, the bundle id and the icon change; the name, the executable and every other key stay', () => {
    const w = world();
    const bundle = join(w.installDir, '.staging', 'x.app');
    mkdirSync(join(bundle, 'Contents'), { recursive: true });
    writeFileSync(join(bundle, 'Contents', 'Info.plist'), PLIST);
    const before = plistJson(join(bundle, 'Contents', 'Info.plist'));
    w.real.editInfoPlist(bundle, infoPlistEdits({ displayName: '季度复盘 "Q3"', bundleId: `${BUNDLE_ID_PREFIX}abc` }));
    const after = plistJson(join(bundle, 'Contents', 'Info.plist'));
    assert.equal(after.CFBundleDisplayName, '季度复盘 "Q3"');
    assert.equal(after.CFBundleIdentifier, 'dev.openartifact.app.abc');
    assert.equal(after.CFBundleIconFile, 'AppIcon.icns');
    assert.equal(after.CFBundleURLTypes, undefined, 'a copy declares no URL scheme');
    assert.equal(after.CFBundleName, 'Open Artifact');
    assert.equal(after.CFBundleExecutable, 'Open Artifact');
    const keep = { ...before };
    for (const key of ['CFBundleDisplayName', 'CFBundleIdentifier', 'CFBundleIconFile', 'CFBundleURLTypes']) delete keep[key];
    for (const [key, value] of Object.entries(keep)) assert.deepEqual(after[key], value, key);
  });

  it('writes nothing outside the install folder, nor an install folder outside HOME, nor (test mode) in the account\'s own home', () => {
    const w = world();
    assert.throws(() => w.real.editInfoPlist(w.template, []), /refused/);
    assert.throws(() => w.real.remove(w.template), /refused/);
    assert.throws(() => w.real.remove(w.installDir), /refused/);
    assert.throws(() => w.real.remove(join(w.installDir, '..', 'x.app')), /refused/);
    assert.throws(() => w.real.place(join(w.installDir, '.staging', 'a.app'), join(w.userHome, 'a.app')), /refused/);
    const outside = macosOps({ installDir: join(w.root, 'Applications', 'Open Artifact Apps'), iconsDir: w.icons, testMode: true, userHome: w.userHome, accountHome: join(w.root, 'nobody') });
    assert.throws(() => outside.prepareDir(join(w.root, 'Applications', 'Open Artifact Apps', '.staging')), /not inside the home/);
    const own = macosOps({ installDir: w.installDir, iconsDir: w.icons, testMode: true, userHome: w.userHome, accountHome: w.userHome });
    assert.throws(() => own.prepareDir(join(w.installDir, '.staging')), /HOME of its own/);
  });

  it('places a package only where nothing is: not over a file, a package, or a name in another letter case', () => {
    const w = world();
    const staging = join(w.installDir, '.staging');
    w.real.prepareDir(staging);
    const temp = join(staging, 'a.app');
    mkdirSync(join(temp, 'Contents'), { recursive: true });
    mkdirSync(join(w.installDir, 'Taken.app'));
    writeFileSync(join(w.installDir, 'Taken.app', 'x'), '');
    assert.throws(() => w.real.place(temp, join(w.installDir, 'Taken.app')), { code: 'EEXIST' });
    assert.throws(() => w.real.place(temp, join(w.installDir, 'taken.app')), { code: 'EEXIST' });
    assert.ok(existsSync(join(w.installDir, 'Taken.app', 'x')), 'what was there is left as it was');
    w.real.place(temp, join(w.installDir, 'Mine.app'));
    assert.ok(existsSync(join(w.installDir, 'Mine.app', 'Contents')));
    assert.ok(!existsSync(temp));
  });

  it('a rename onto a folder that is not empty fails (what placing relies on)', () => {
    const w = world();
    const a = join(w.root, 'a');
    const b = join(w.root, 'b');
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(b, 'x'), '');
    assert.throws(() => renameSync(a, b), (error) => error.code === 'ENOTEMPTY' || error.code === 'EEXIST');
  });

  it('nothing is opened in test mode: launch says skipped', async () => {
    const w = world();
    assert.equal(await w.real.launch(join(w.installDir, 'x.app')), 'skipped');
    assert.match(w.logs.join('\n'), /test mode: not opened/);
  });
});

describe('install as app: states and installs', () => {
  const docs = { a1: { title: '季度复盘', type: 'docs', root: '/tmp/a1' } };

  it('unavailable: a development run, another system, not in the library, no folder, a remote type', async () => {
    assert.deepEqual(await world({ artifacts: docs, packaged: false }).apps.state('a1'), { state: 'unavailable', reason: 'not-packaged' });
    assert.deepEqual(await world({ artifacts: docs, platform: 'linux' }).apps.state('a1'), { state: 'unavailable', reason: 'not-macos' });
    assert.deepEqual(await world({ artifacts: docs }).apps.state('nope'), { state: 'unavailable', reason: 'not-found' });
    assert.deepEqual(await world({ artifacts: { a1: { ...docs.a1, folderMissing: true } } }).apps.state('a1'), { state: 'unavailable', reason: 'folder-missing' });
    assert.deepEqual(await world({ artifacts: { r: { title: 'R', type: 'remote-thing' } } }).apps.state('r'), { state: 'unavailable', reason: 'remote-type' });
  });

  it('available, then installed: the package, its Info.plist, icon and artifact-app.json, the record', async () => {
    const w = world({ artifacts: docs });
    assert.deepEqual(await w.apps.state('a1'), { state: 'available', suggestedName: '季度复盘', needsCopy: false, installDir: w.installDir });
    const out = await w.apps.install('a1', { confirmedName: '季度复盘' });
    assert.equal(out.launch, 'skipped');
    assert.equal(out.state.state, 'installed');
    assert.equal(out.state.displayName, '季度复盘');
    assert.equal(out.state.stale, false);
    const bundle = join(w.installDir, '季度复盘.app');
    assert.deepEqual(appsIn(w.installDir), ['季度复盘.app']);
    assert.deepEqual(readdirSync(join(w.installDir, '.staging')), [], 'nothing left in the staging folder');
    const info = plistJson(join(bundle, 'Contents', 'Info.plist'));
    assert.equal(info.CFBundleIdentifier, `${BUNDLE_ID_PREFIX}${out.state.installId}`);
    assert.equal(info.CFBundleDisplayName, '季度复盘');
    assert.equal(info.CFBundleName, 'Open Artifact');
    assert.equal(readFileSync(join(bundle, 'Contents', 'Resources', 'AppIcon.icns'), 'utf8'), 'icon:docs');
    assert.deepEqual(w.real.readManifest(bundle), { schemaVersion: 1, installId: out.state.installId, artifactId: 'a1', home: w.home, templateVersion: '1.0.0+0.14.6' });
    const [{ record }] = readRecords(w.home);
    assert.equal(record.phase, 'installed');
    assert.equal(record.bundlePath, bundle);
    assert.equal(record.templatePath, w.template);
    assert.equal(record.tempPath, undefined);
    assert.equal(record.cloned, true, 'the test folder is on APFS: cloned');
    assert.deepEqual(await w.apps.state('a1'), { state: 'installed', installId: out.state.installId, displayName: '季度复盘', bundlePath: bundle, stale: false, running: false });
    assert.deepEqual(checkLaunch({ manifest: w.real.readManifest(bundle), bundlePath: bundle }), { ok: true, record });
  });

  it('a type with no icon of its own gets the default one', async () => {
    const w = world({ artifacts: { b: { title: 'Board', type: 'whiteboard' } }, types: [{ id: 'whiteboard' }] });
    await w.apps.install('b');
    assert.equal(readFileSync(join(w.installDir, 'Board.app', 'Contents', 'Resources', 'AppIcon.icns'), 'utf8'), 'icon:default');
  });

  it('a name the person did not see is not installed; the answer carries the new one', async () => {
    const w = world({ artifacts: docs });
    mkdirSync(w.installDir, { recursive: true });
    mkdirSync(join(w.installDir, '季度复盘.app'));
    const out = await w.apps.install('a1', { confirmedName: '季度复盘' });
    assert.equal(out.nameChanged, true);
    assert.equal(out.state.suggestedName, '季度复盘 (2)');
    assert.equal(readRecords(w.home).length, 0);
  });

  it('two artifacts of one title: two apps, two bundle ids', async () => {
    const w = world({ artifacts: { a1: { title: 'Plan', type: 'docs' }, a2: { title: 'Plan', type: 'docs' } } });
    const one = await w.apps.install('a1');
    const two = await w.apps.install('a2');
    assert.deepEqual(appsIn(w.installDir), ['Plan (2).app', 'Plan.app']);
    assert.notEqual(one.state.installId, two.state.installId);
    const ids = appsIn(w.installDir).map((name) => plistJson(join(w.installDir, name, 'Contents', 'Info.plist')).CFBundleIdentifier);
    assert.equal(new Set(ids).size, 2);
  });

  it('two installs of one artifact at once: one package, the second answers the first\'s', async () => {
    const w = world({ artifacts: docs });
    const [a, b] = await Promise.all([w.apps.install('a1'), w.apps.install('a1')]);
    assert.deepEqual(appsIn(w.installDir), ['季度复盘.app']);
    assert.equal(readRecords(w.home).length, 1);
    assert.equal(a.state.installId, b.state.installId);
    assert.equal(b.reused, true);
  });

  it('asked while it installs: installing', async () => {
    let release;
    const gate = new Promise((done) => (release = done));
    const w = world({ artifacts: docs, checkpoint: (step) => (step === 'signed' ? gate : undefined) });
    const running = w.apps.install('a1');
    await new Promise((done) => setTimeout(done, 50));
    assert.deepEqual(await w.apps.state('a1'), { state: 'installing' });
    release();
    assert.equal((await running).state.state, 'installed');
  });

  it('a package of that name appearing meanwhile: nothing is put over it, nothing of the install is left', async () => {
    const w = world({
      artifacts: docs,
      checkpoint: (step) => {
        if (step === 'signed') mkdirSync(join(w.installDir, '季度复盘.app'));
      },
    });
    const out = await w.apps.install('a1');
    assert.equal(out.conflict, true);
    assert.equal(out.state.state, 'available');
    assert.equal(out.state.suggestedName, '季度复盘 (2)');
    assert.deepEqual(readdirSync(join(w.installDir, '季度复盘.app')), [], 'the folder that was there is left as it was');
    assert.deepEqual(readdirSync(join(w.installDir, '.staging')), []);
    assert.equal(readRecords(w.home).length, 0);
  });

  it('cannot be cloned there: needsCopy, and an install copies only when asked again with allowCopy', async () => {
    const w = world({ artifacts: docs });
    const ops = { ...w.ops, sameVolume: () => false, canClone: () => false };
    const apps = w.make({ ops });
    const asked = await apps.state('a1');
    assert.deepEqual({ ...asked, copyBytes: undefined }, { state: 'available', suggestedName: '季度复盘', needsCopy: true, installDir: w.installDir, copyBytes: undefined });
    assert.ok(asked.copyBytes > 0, 'the room a copy takes is said');
    const first = await apps.install('a1');
    assert.equal(first.needsCopy, true);
    assert.deepEqual(appsIn(w.installDir), []);
    assert.equal(readRecords(w.home).length, 0);
    const second = await apps.install('a1', { allowCopy: true });
    assert.equal(second.state.state, 'installed');
    assert.equal(readRecords(w.home)[0].record.cloned, false);
  });

  it('stale once the desktop app changed', async () => {
    const w = world({ artifacts: docs });
    await w.apps.install('a1');
    const later = w.make({ template: { bundlePath: w.template, executable: 'x', version: () => '2.0.0+0.15.0' } });
    assert.equal((await later.state('a1')).stale, true);
  });

  it('a package removed in the Finder: needs repair (missing); Repair builds it again in its place, Remove Record forgets it', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    mkdirSync(artifactAppDir(w.home, state.installId), { recursive: true });
    const bundle = join(w.installDir, '季度复盘.app');
    rmSync(bundle, { recursive: true });
    assert.deepEqual(await w.apps.state('a1'), { state: 'needsRepair', installId: state.installId, reason: 'missing', repairable: true });
    const repaired = await w.apps.repair('a1', state.installId);
    assert.equal(repaired.rebuilt, true, JSON.stringify(repaired));
    assert.equal(repaired.state.installId, state.installId);
    assert.equal(w.ops.verify(bundle), true);
    rmSync(bundle, { recursive: true });
    const forgotten = await w.apps.forgetRecord('a1', state.installId);
    assert.equal(forgotten.state.state, 'available');
    assert.equal(readRecords(w.home).length, 0);
    assert.ok(!existsSync(artifactAppDir(w.home, state.installId)));
  });

  it('a package in its place that is not the record\'s: needs repair, not repairable, nothing removed', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const bundle = join(w.installDir, '季度复盘.app');
    writeFileSync(join(bundle, 'Contents', 'Resources', 'artifact-app.json'), JSON.stringify({ installId: 'other' }));
    assert.deepEqual(await w.apps.state('a1'), { state: 'needsRepair', installId: state.installId, reason: 'replaced', repairable: false });
    assert.ok(existsSync(bundle));
  });

  it('an uninstall cut short before its package went: installed again; after: the rest removed', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const file = recordPathOf(w.home, state.installId);
    const record = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...record, phase: 'uninstalling', before: 'installed' }));
    assert.equal((await w.apps.state('a1')).state, 'installed');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).before, undefined);
    mkdirSync(artifactAppDir(w.home, state.installId), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...record, phase: 'uninstalling', before: 'installed' }));
    rmSync(record.bundlePath, { recursive: true });
    assert.equal((await w.apps.state('a1')).state, 'available');
    assert.equal(readRecords(w.home).length, 0);
    assert.ok(!existsSync(artifactAppDir(w.home, state.installId)));
    assert.deepEqual(w.forgotten, [record.bundleId]);
  });

  it('open and reveal only the package its record names', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    assert.deepEqual(await w.apps.open('a1', state.installId), { launch: 'skipped' });
    assert.equal(await w.apps.revealPath('a1', state.installId), join(w.installDir, '季度复盘.app'));
    await assert.rejects(w.apps.open('a1', '00000000-0000-4000-8000-999999999999'), /no installed app/);
    await assert.rejects(w.apps.open('other', state.installId), /no installed app/);
  });
});

describe('install as app: an install cut short, then put right', () => {
  /** An install that stops for good at `step` (the process went away there); then a new process looks. */
  const cutAt = async (step) => {
    const w = world({ artifacts: { a1: { title: 'Plan', type: 'docs' } }, checkpoint: (at) => (at === step ? new Promise(() => {}) : undefined) });
    void w.apps.install('a1');
    await new Promise((done) => setTimeout(done, 300));
    const fresh = w.make({ checkpoint: async () => {} });
    return { w, fresh };
  };

  for (const step of ['recorded', 'cloned', 'signed']) {
    it(`at "${step}": the staging package and the record are removed; it can be installed again`, async () => {
      const { w, fresh } = await cutAt(step);
      const [{ record }] = readRecords(w.home);
      assert.equal(record.phase, 'installing');
      assert.equal(existsSync(record.tempPath), step !== 'recorded');
      assert.equal((await fresh.state('a1')).state, 'available');
      assert.equal(readRecords(w.home).length, 0);
      assert.deepEqual(readdirSync(join(w.installDir, '.staging')), []);
      assert.deepEqual(appsIn(w.installDir), []);
      assert.equal((await fresh.install('a1')).state.state, 'installed');
      assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
    });
  }

  for (const step of ['placed', 'committing']) {
    it(`at "${step}": the package in place is the record's and its signature checks: committed`, async () => {
      const { w, fresh } = await cutAt(step);
      const [{ record }] = readRecords(w.home);
      assert.equal(record.phase, 'installing');
      if (step === 'committing') assert.ok(readdirSync(join(w.home, 'desktop', 'apps')).some((name) => name.endsWith('.tmp')));
      const state = await fresh.state('a1');
      assert.equal(state.state, 'installed');
      assert.equal(state.installId, record.installId);
      const [{ record: done }] = readRecords(w.home);
      assert.equal(done.phase, 'installed');
      assert.equal(done.tempPath, undefined);
      assert.deepEqual(readdirSync(join(w.home, 'desktop', 'apps')).filter((name) => name.endsWith('.tmp')), []);
      assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
    });
  }

  it('at "placed" with a signature that does not check: needs repair, the package left', async () => {
    const { w, fresh } = await cutAt('placed');
    writeFileSync(join(w.installDir, 'Plan.app', 'Contents', 'signature'), 'broken');
    assert.deepEqual(await fresh.state('a1'), { state: 'needsRepair', installId: readRecords(w.home)[0].record.installId, reason: 'signature', repairable: true });
    assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
  });

  it('between making its place and moving in: the empty folder of its name goes too, so the name is free again', async () => {
    const { w, fresh } = await cutAt('signed');
    const [{ record }] = readRecords(w.home);
    mkdirSync(record.bundlePath);
    assert.equal((await fresh.state('a1')).suggestedName, 'Plan');
    assert.deepEqual(appsIn(w.installDir), []);
  });

  it('a folder of that name with something in it is never removed', async () => {
    const { w, fresh } = await cutAt('signed');
    const [{ record }] = readRecords(w.home);
    mkdirSync(record.bundlePath);
    writeFileSync(join(record.bundlePath, 'mine'), '');
    assert.equal((await fresh.state('a1')).suggestedName, 'Plan (2)');
    assert.ok(existsSync(join(record.bundlePath, 'mine')));
  });

  it('reconcileAll puts right every artifact of the home', async () => {
    const { w, fresh } = await cutAt('cloned');
    const out = await fresh.reconcileAll();
    assert.equal(out.a1[0].action, 'cleaned');
    assert.equal(readRecords(w.home).length, 0);
  });
});

describe('install as app: the launch check', () => {
  it('no record, another artifact, not installed, another package: each refused with its reason', async () => {
    const w = world({ artifacts: { a1: { title: 'Plan', type: 'docs' } } });
    const { state } = await w.apps.install('a1');
    const bundle = join(w.installDir, 'Plan.app');
    const manifest = w.real.readManifest(bundle);
    assert.equal(checkLaunch({ manifest, bundlePath: bundle }).ok, true);
    assert.equal(checkLaunch({ manifest: { ...manifest, artifactId: 'a2' }, bundlePath: bundle }).reason, 'record-mismatch');
    assert.equal(checkLaunch({ manifest, bundlePath: join(w.root, 'elsewhere.app') }).reason, 'moved');
    const file = recordPathOf(w.home, state.installId);
    const record = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...record, phase: 'installing' }));
    assert.equal(checkLaunch({ manifest, bundlePath: bundle }).reason, 'not-installed');
    rmSync(file);
    assert.equal(checkLaunch({ manifest, bundlePath: bundle }).reason, 'no-record');
  });
});

describe('the single-artifact app: its file and its profile', () => {
  const manifest = { schemaVersion: 1, installId: '00000000-0000-4000-8000-000000000001', artifactId: 'a1', home: '/tmp/oa', templateVersion: '1' };
  const exists = () => true;

  it('no file (or a development run): the desktop app', () => {
    const missing = () => {
      throw Object.assign(new Error('no'), { code: 'ENOENT' });
    };
    assert.equal(readArtifactApp('/x/Resources', { read: missing }), null);
    assert.equal(readArtifactApp('/x/Resources', { packaged: false, read: () => JSON.stringify(manifest), exists }), null);
  });

  it('a file that is there is this app\'s, whatever it holds: problems, never the desktop app', () => {
    assert.deepEqual(readArtifactApp('/x/Resources', { read: () => JSON.stringify(manifest), exists }).manifest, manifest);
    assert.match(readArtifactApp('/x/Resources', { read: () => '{', exists }).problems[0], /not JSON/);
    assert.match(readArtifactApp('/x/Resources', { read: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } }).problems[0], /cannot be read/);
    for (const [field, value] of [['installId', 'x'], ['artifactId', '../a'], ['home', 'relative'], ['home', '/a/../b'], ['templateVersion', ''], ['schemaVersion', 2]]) {
      const { manifest: got, problems } = checkArtifactApp(JSON.stringify({ ...manifest, [field]: value }), { exists });
      assert.equal(got, null, field);
      assert.ok(problems.length, field);
    }
    assert.match(checkArtifactApp(JSON.stringify(manifest), { exists: () => false }).problems[0], /home of this app is not there/);
  });

  it('the home is the file\'s (never --home or OPEN_ARTIFACT_HOME), Electron\'s folders the app\'s own, no --open', () => {
    const profile = resolveArtifactAppProfile({
      manifest,
      argv: ['--home', '/tmp/other', '--open', 'b2', '--port', '4891', '--test-mode'],
      env: { OPEN_ARTIFACT_HOME: '/tmp/env' },
      packaged: true,
      userHome: '/Users/someone',
      accountHome: '/Users/someone',
    });
    assert.deepEqual(profile.problems, []);
    assert.equal(profile.home, '/tmp/oa');
    assert.equal(profile.ignoredHome, '/tmp/other');
    assert.deepEqual(profile.open, []);
    assert.equal(profile.mode, 'artifact-app');
    assert.equal(profile.paths.userData, '/tmp/oa/desktop/apps/00000000-0000-4000-8000-000000000001');
    assert.equal(profile.paths.sessionData, '/tmp/oa/desktop/apps/00000000-0000-4000-8000-000000000001/session');
  });

  it('test mode keeps the desktop app\'s guards: a port of its own, never 4800, never the default home', () => {
    const run = (argv, home = '/tmp/oa') => resolveArtifactAppProfile({ manifest: { ...manifest, home }, argv, env: {}, packaged: true, userHome: '/Users/someone', accountHome: '/Users/someone' });
    assert.ok(run(['--test-mode']).problems.length);
    assert.ok(run(['--test-mode', '--port', '4800']).problems.length);
    assert.ok(run(['--test-mode', '--port', '4891'], '/Users/someone/.agents/open-artifact').problems.length);
    assert.deepEqual(run([]).problems, [], 'the person\'s run: any home, the default port');
  });

  it('the package of an executable, and where the desktop app keeps its settings', () => {
    assert.equal(bundleOfExecutable('/Users/a/Applications/Open Artifact Apps/Plan.app/Contents/MacOS/Open Artifact'), '/Users/a/Applications/Open Artifact Apps/Plan.app');
    assert.equal(bundleOfExecutable('/usr/local/bin/electron'), null);
    assert.equal(desktopSettingsDir({ home: '/tmp/oa', guarded: true, defaultUserData: '/x' }), '/tmp/oa/desktop/user-data');
    assert.equal(desktopSettingsDir({ home: '/tmp/oa', guarded: false, defaultUserData: '/x' }), '/x');
  });

  it('the install folder is in HOME\'s Applications', () => {
    assert.equal(installDirOf('/Users/a'), '/Users/a/Applications/Open Artifact Apps');
  });
});

describe('install as app: renamed or moved in the Finder', () => {
  const docs = { a1: { title: 'Plan', type: 'docs' } };

  it('renamed in the install folder: the record takes the package, its path and its name', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    renameSync(join(w.installDir, 'Plan.app'), join(w.installDir, 'My Plan.app'));
    const now = await w.apps.state('a1');
    assert.equal(now.state, 'installed', JSON.stringify(now));
    assert.equal(now.installId, state.installId);
    assert.equal(now.displayName, 'My Plan');
    assert.equal(now.bundlePath, join(w.installDir, 'My Plan.app'));
    const [{ record }] = readRecords(w.home);
    assert.equal(record.bundlePath, join(w.installDir, 'My Plan.app'));
    assert.equal(record.bundleId, `${BUNDLE_ID_PREFIX}${state.installId}`, 'the bundle id stays');
    const bundle = join(w.installDir, 'My Plan.app');
    assert.equal(checkLaunch({ manifest: w.real.readManifest(bundle), bundlePath: bundle }).ok, true);
  });

  it('renamed, but its signature does not check: needs repair (repairable), the package left', async () => {
    const w = world({ artifacts: docs });
    await w.apps.install('a1');
    renameSync(join(w.installDir, 'Plan.app'), join(w.installDir, 'Other.app'));
    writeFileSync(join(w.installDir, 'Other.app', 'Contents', 'signature'), 'broken');
    const now = await w.apps.state('a1');
    assert.equal(now.reason, 'signature');
    assert.equal(now.repairable, true);
    assert.deepEqual(appsIn(w.installDir), ['Other.app']);
  });

  it('two packages of the record in the install folder: needs repair, neither claimed nor removed', async () => {
    const w = world({ artifacts: docs });
    await w.apps.install('a1');
    cpSync(join(w.installDir, 'Plan.app'), join(w.installDir, 'Plan copy.app'), { recursive: true });
    renameSync(join(w.installDir, 'Plan.app'), join(w.installDir, 'Plan 2.app'));
    const now = await w.apps.state('a1');
    assert.deepEqual([now.state, now.reason, now.repairable], ['needsRepair', 'duplicates', false]);
    assert.deepEqual(appsIn(w.installDir), ['Plan 2.app', 'Plan copy.app']);
  });

  it('moved out of the install folder: not claimed; needs repair (missing), the record kept; moved back: installed', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    mkdirSync(join(w.userHome, 'Desktop'));
    renameSync(join(w.installDir, 'Plan.app'), join(w.userHome, 'Desktop', 'Plan.app'));
    const now = await w.apps.state('a1');
    assert.deepEqual([now.state, now.reason], ['needsRepair', 'missing']);
    assert.equal(readRecords(w.home)[0].record.bundlePath, join(w.installDir, 'Plan.app'));
    assert.ok(existsSync(join(w.userHome, 'Desktop', 'Plan.app')), 'the package moved out is left where it is');
    renameSync(join(w.userHome, 'Desktop', 'Plan.app'), join(w.installDir, 'Plan.app'));
    assert.equal((await w.apps.state('a1')).state, 'installed');
    assert.equal((await w.apps.state('a1')).installId, state.installId);
  });

  it('a record follows the desktop app when it moved (templatePath)', async () => {
    const w = world({ artifacts: docs });
    await w.apps.install('a1');
    const moved = join(w.root, 'elsewhere', 'Open Artifact.app');
    const later = w.make({ template: { bundlePath: moved, executable: 'x', version: () => '1.0.0+0.14.6' } });
    await later.reconcileAll();
    assert.equal(readRecords(w.home)[0].record.templatePath, moved);
  });
});

describe('install as app: uninstall', () => {
  const docs = { a1: { title: 'Plan', type: 'docs' } };
  /** A running app: `pid` alive until `quit()`; its `running.json` as the app writes it. */
  const fakeApp = (w, installId) => {
    let up = true;
    const pid = 424242;
    return {
      pid,
      quit: () => (up = false),
      isRunning: () => (up ? pid : null),
      alive: (p) => p === pid && up,
    };
  };

  it('not running: the package goes (test mode: removed, logged), its preferences, record and folder too', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    mkdirSync(artifactAppDir(w.home, state.installId), { recursive: true });
    const out = await w.apps.uninstall('a1', state.installId);
    assert.equal(out.removed, true, JSON.stringify(out));
    assert.equal(out.state.state, 'available');
    assert.deepEqual(appsIn(w.installDir), []);
    assert.equal(readRecords(w.home).length, 0);
    assert.ok(!existsSync(artifactAppDir(w.home, state.installId)));
    assert.deepEqual(w.forgotten, [`${BUNDLE_ID_PREFIX}${state.installId}`]);
    assert.ok(w.logs.some((line) => /test mode: removed, not moved to the Trash/.test(line)));
    // Again: nothing to do.
    assert.equal((await w.apps.uninstall('a1', state.installId)).removed, false);
  });

  it('running: the record says uninstalling, the app quits by itself, then it goes', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const app = fakeApp(w, state.installId);
    const seen = [];
    const apps = w.make({
      isRunning: app.isRunning,
      alive: app.alive,
      pollMs: 20,
      checkpoint: async (at) => {
        if (at === 'uninstall-recorded') {
          seen.push(readRecords(w.home)[0].record.phase);
          setTimeout(app.quit, 150);
        }
      },
    });
    const out = await apps.uninstall('a1', state.installId);
    assert.deepEqual(seen, ['uninstalling']);
    assert.equal(out.removed, true);
    assert.deepEqual(appsIn(w.installDir), []);
  });

  it('running and it does not quit (unsaved work kept): after the timeout the record is as it was, the package kept', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const app = fakeApp(w, state.installId);
    const apps = w.make({ isRunning: app.isRunning, alive: app.alive, pollMs: 20, quitTimeoutMs: 300 });
    const before = readFileSync(recordPathOf(w.home, state.installId), 'utf8');
    const out = await apps.uninstall('a1', state.installId);
    assert.equal(out.removed, false);
    assert.equal(out.stillRunning, true);
    assert.equal(out.state.state, 'installed');
    assert.equal(readFileSync(recordPathOf(w.home, state.installId), 'utf8'), before);
    assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
  });

  it('a later install has a new installId, and an uninstall of the old one leaves it', async () => {
    const w = world({ artifacts: docs });
    const first = (await w.apps.install('a1')).state;
    await w.apps.uninstall('a1', first.installId);
    const second = (await w.apps.install('a1')).state;
    assert.notEqual(second.installId, first.installId);
    const out = await w.apps.uninstall('a1', first.installId);
    assert.equal(out.removed, false);
    assert.equal(out.state.installId, second.installId);
    assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
  });

  it('what is at its place is not its package: left there, the record removed', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    writeFileSync(join(w.installDir, 'Plan.app', 'Contents', 'Resources', 'artifact-app.json'), JSON.stringify({ installId: 'other' }));
    const out = await w.apps.forgetRecord('a1', state.installId);
    assert.equal(out.removed, true);
    assert.deepEqual(appsIn(w.installDir), ['Plan.app'], 'what is there is not ours to remove');
    assert.equal(readRecords(w.home).length, 0);
  });

  it('cut short at each step, then put right: installed again before the package went, removed after', async () => {
    for (const [step, expected] of [['uninstall-recorded', 'installed'], ['uninstall-quit', 'installed'], ['uninstall-trashed', 'available']]) {
      const w = world({ artifacts: docs });
      const { state } = await w.apps.install('a1');
      const cut = w.make({ checkpoint: (at) => (at === step ? new Promise(() => {}) : undefined) });
      void cut.uninstall('a1', state.installId);
      await new Promise((done) => setTimeout(done, 200));
      assert.equal(readRecords(w.home)[0].record.phase, 'uninstalling', step);
      const fresh = w.make();
      assert.equal((await fresh.state('a1')).state, expected, step);
      if (expected === 'available') assert.equal(readRecords(w.home).length, 0, step);
    }
  });
});

describe('install as app: refresh and repair (a rebuild beside, then a swap)', () => {
  const docs = { a1: { title: 'Plan', type: 'docs' } };
  const v2 = (w, extra = {}) => w.make({ template: { bundlePath: w.template, executable: 'x', version: () => '2.0.0+0.15.0' }, ...extra });

  it('stale: refreshed with the same installId, bundle id and path; the new version; the signature checks', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const bundle = join(w.installDir, 'Plan.app');
    const apps = v2(w);
    assert.equal((await apps.state('a1')).stale, true);
    const out = await apps.refresh('a1', state.installId);
    assert.equal(out.rebuilt, true, JSON.stringify(out));
    assert.deepEqual([out.state.state, out.state.installId, out.state.bundlePath, out.state.stale], ['installed', state.installId, bundle, false]);
    const [{ record }] = readRecords(w.home);
    assert.equal(record.templateVersion, '2.0.0+0.15.0');
    assert.equal(record.phase, 'installed');
    assert.equal(plistJson(join(bundle, 'Contents', 'Info.plist')).CFBundleIdentifier, `${BUNDLE_ID_PREFIX}${state.installId}`);
    assert.equal(w.real.readManifest(bundle).templateVersion, '2.0.0+0.15.0');
    assert.equal(w.ops.verify(bundle), true);
    assert.deepEqual(readdirSync(join(w.installDir, '.staging')), []);
    assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
  });

  it('repair never moves aside what is not its package (an unknown phase, a foreign package at its place)', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const bundle = join(w.installDir, 'Plan.app');
    writeFileSync(recordPathOf(w.home, state.installId), JSON.stringify({ ...readRecords(w.home)[0].record, phase: 'odd' }));
    writeFileSync(join(bundle, 'Contents', 'Resources', 'artifact-app.json'), JSON.stringify({ installId: 'someone-else' }));
    writeFileSync(join(bundle, 'Contents', 'theirs'), 'keep');
    const now = await w.apps.state('a1');
    assert.deepEqual([now.reason, now.repairable], ['phase', true]);
    const out = await w.apps.repair('a1', state.installId);
    assert.equal(out.rebuilt, false, JSON.stringify(out));
    assert.equal(out.notOurs, true);
    assert.equal(readFileSync(join(bundle, 'Contents', 'theirs'), 'utf8'), 'keep');
    assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
    assert.deepEqual(readdirSync(join(w.installDir, '.staging')), []);
  });

  it('a Trash that fails: not uninstalled, the record as it was', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const before = readFileSync(recordPathOf(w.home, state.installId), 'utf8');
    const apps = w.make({ ops: { ...w.ops, trash: async () => { throw new Error('no Trash'); } } });
    const out = await apps.uninstall('a1', state.installId);
    assert.equal(out.removed, false);
    assert.match(out.error, /no Trash/);
    assert.equal(out.state.state, 'installed');
    assert.equal(readFileSync(recordPathOf(w.home, state.installId), 'utf8'), before);
  });

  it('a renamed app is rebuilt under its new name', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    renameSync(join(w.installDir, 'Plan.app'), join(w.installDir, 'Mine.app'));
    const out = await v2(w).refresh('a1', state.installId);
    assert.equal(out.rebuilt, true);
    assert.equal(plistJson(join(w.installDir, 'Mine.app', 'Contents', 'Info.plist')).CFBundleDisplayName, 'Mine');
  });

  it('running: not rebuilt, nothing changed', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const out = await v2(w, { isRunning: () => 4242, alive: () => true }).refresh('a1', state.installId);
    assert.equal(out.rebuilt, false);
    assert.equal(out.stillRunning, true);
    assert.equal(readRecords(w.home)[0].record.templateVersion, '1.0.0+0.14.6');
  });

  it('refreshStale rebuilds the stale apps that do not run', async () => {
    const w = world({ artifacts: { a1: { title: 'Plan', type: 'docs' }, a2: { title: 'Two', type: 'docs' } } });
    const one = (await w.apps.install('a1')).state;
    const two = (await w.apps.install('a2')).state;
    const out = await v2(w, { isRunning: (record) => (record.installId === two.installId ? 4242 : null), alive: () => true }).refreshStale();
    assert.deepEqual(out, { [one.installId]: 'refreshed', [two.installId]: 'running' });
  });

  it('repair: a package whose signature does not check is rebuilt; a package not its own only offers removing the record', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const bundle = join(w.installDir, 'Plan.app');
    writeFileSync(join(bundle, 'Contents', 'signature'), 'broken');
    writeFileSync(recordPathOf(w.home, state.installId), JSON.stringify({ ...readRecords(w.home)[0].record, phase: 'installing', tempPath: join(w.installDir, '.staging', `${state.installId}.app`) }));
    assert.equal((await w.apps.state('a1')).reason, 'signature');
    const out = await w.apps.repair('a1', state.installId);
    assert.equal(out.rebuilt, true, JSON.stringify(out));
    assert.equal(out.state.state, 'installed');
    assert.equal(w.ops.verify(bundle), true);

    writeFileSync(join(bundle, 'Contents', 'Resources', 'artifact-app.json'), JSON.stringify({ installId: 'other' }));
    const refused = await w.apps.repair('a1', state.installId);
    assert.equal(refused.rebuilt, false);
    assert.equal(refused.notOurs, true);
    assert.equal(readFileSync(join(bundle, 'Contents', 'Resources', 'artifact-app.json'), 'utf8'), JSON.stringify({ installId: 'other' }));
  });

  for (const [step, expectVersion] of [
    ['rebuild-recorded', '1.0.0+0.14.6'],
    ['rebuild-built', '1.0.0+0.14.6'],
    ['rebuild-aside', '1.0.0+0.14.6'],
    ['rebuild-placed', '2.0.0+0.15.0'],
    ['rebuild-removed', '2.0.0+0.15.0'],
    ['rebuild-committing', '2.0.0+0.15.0'],
  ]) {
    it(`cut short at "${step}": put right from what is on disk (version ${expectVersion}), one package, same installId`, async () => {
      const w = world({ artifacts: docs });
      const { state } = await w.apps.install('a1');
      const bundle = join(w.installDir, 'Plan.app');
      const cut = v2(w, { checkpoint: (at) => (at === step ? new Promise(() => {}) : undefined) });
      void cut.refresh('a1', state.installId);
      await new Promise((done) => setTimeout(done, 300));
      assert.equal(readRecords(w.home)[0].record.phase, 'refreshing', step);
      const fresh = v2(w);
      const verdicts = (await fresh.reconcileAll()).a1;
      assert.equal(verdicts.length, 1);
      const [{ record }] = readRecords(w.home);
      assert.equal(record.phase, 'installed', JSON.stringify(verdicts));
      assert.equal(record.installId, state.installId);
      assert.equal(record.bundlePath, bundle);
      assert.equal(record.templateVersion, expectVersion);
      assert.equal(w.real.readManifest(bundle).templateVersion, expectVersion);
      assert.equal(w.ops.verify(bundle), true);
      assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
      assert.deepEqual(readdirSync(join(w.installDir, '.staging')), []);
      assert.deepEqual(readdirSync(join(w.home, 'desktop', 'apps')).filter((name) => name.endsWith('.tmp')), []);
    });
  }

  it('cut short between the two renames: the old package is put back', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const bundle = join(w.installDir, 'Plan.app');
    // As the rebuild leaves it at "rebuild-aside": the old one in staging, the new one beside it, nothing in place.
    const cut = v2(w, { checkpoint: (at) => (at === 'rebuild-aside' ? new Promise(() => {}) : undefined) });
    void cut.refresh('a1', state.installId);
    await new Promise((done) => setTimeout(done, 300));
    assert.ok(!existsSync(bundle));
    assert.ok(existsSync(join(w.installDir, '.staging', `${state.installId}.old.app`)));
    const out = (await v2(w).reconcileAll()).a1[0];
    assert.equal(out.action, 'restored');
    assert.ok(existsSync(bundle));
  });
});

describe('install as app: the page address check (page-url.mjs)', () => {
  it('a path with Chinese, #, ? and % is its own page, however it is written', async () => {
    const { isPageAt, pageUrlOf } = await import('../src/page-url.mjs');
    const path = '/Users/x/Applications/Open Artifact Apps/计划 #2 50%?.app/Contents/Resources/app.asar/out/renderer/artifact-app/index.html';
    assert.equal(isPageAt(pageUrlOf(path), path), true);
    assert.equal(isPageAt(pageUrlOf(path).replace('%25', '%'), path), false, 'an unescaped % is not this address');
    assert.equal(isPageAt(`${pageUrlOf(path)}?x=1`, path), false);
    assert.equal(isPageAt(`${pageUrlOf(path)}#x`, path), false);
    assert.equal(isPageAt('https://example.com/index.html', path), false);
    assert.equal(isPageAt(pageUrlOf('/other/index.html'), path), false);
  });
});

describe('install as app: the daemon running from an app\'s package', () => {
  const docs = { a1: { title: 'Plan', type: 'docs' }, a2: { title: 'Two', type: 'docs' } };
  const v2 = (w, extra = {}) => w.make({ template: { bundlePath: w.template, executable: 'x', version: () => '2.0.0+0.15.0' }, ...extra });
  /** A daemon that lives in `bundle` until released (`release` true), then in the desktop app's own runtime. */
  const daemonIn = (w, bundle, { release = true, stays = false } = {}) => {
    const calls = { released: 0 };
    let inside = true;
    return {
      calls,
      daemonHost: () => ({ pid: 777, paths: inside ? [join(bundle, 'Contents', 'MacOS', 'Open Artifact'), join(bundle, 'Contents', 'Resources', 'runtime')] : [join(w.template, 'Contents', 'Resources', 'runtime')] }),
      releaseDaemon: async () => {
        calls.released++;
        if (release && !stays) inside = false;
        return release;
      },
    };
  };

  it('uninstall: the daemon is restarted from elsewhere first, then the package goes', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const daemon = daemonIn(w, state.bundlePath);
    const out = await w.make(daemon).uninstall('a1', state.installId);
    assert.equal(out.removed, true, JSON.stringify(out));
    assert.equal(daemon.calls.released, 1);
    assert.deepEqual(appsIn(w.installDir), []);
    assert.equal(readRecords(w.home).length, 0);
  });

  it('uninstall: the restart refused (unsaved work), or the daemon still in the package after it: nothing moved, daemonInUse', async () => {
    for (const how of [{ release: false }, { stays: true }]) {
      const w = world({ artifacts: docs });
      const { state } = await w.apps.install('a1');
      const before = readFileSync(recordPathOf(w.home, state.installId), 'utf8');
      const daemon = daemonIn(w, state.bundlePath, how);
      const out = await w.make(daemon).uninstall('a1', state.installId);
      assert.deepEqual([out.removed, out.daemonInUse, out.state.state], [false, true, 'installed'], JSON.stringify(out));
      assert.equal(daemon.calls.released, 1);
      assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
      assert.equal(readFileSync(recordPathOf(w.home, state.installId), 'utf8'), before);
      assert.deepEqual(w.forgotten, []);
    }
  });

  it('uninstall of another app: the daemon in the first one is not restarted', async () => {
    const w = world({ artifacts: docs });
    const one = (await w.apps.install('a1')).state;
    const two = (await w.apps.install('a2')).state;
    const daemon = daemonIn(w, one.bundlePath);
    const out = await w.make(daemon).uninstall('a2', two.installId);
    assert.equal(out.removed, true);
    assert.equal(daemon.calls.released, 0);
    assert.deepEqual(appsIn(w.installDir), ['Plan.app']);
  });

  it('refresh and repair: restarted first, then rebuilt; refused: the package and the record as they were, daemonInUse', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const ok = daemonIn(w, state.bundlePath);
    const done = await v2(w, ok).refresh('a1', state.installId);
    assert.equal(done.rebuilt, true, JSON.stringify(done));
    assert.equal(ok.calls.released, 1);
    assert.equal(readRecords(w.home)[0].record.templateVersion, '2.0.0+0.15.0');

    const w2 = world({ artifacts: docs });
    const two = (await w2.apps.install('a1')).state;
    const before = readFileSync(recordPathOf(w2.home, two.installId), 'utf8');
    const manifest = readFileSync(join(two.bundlePath, 'Contents', 'Resources', 'artifact-app.json'), 'utf8');
    const no = daemonIn(w2, two.bundlePath, { release: false });
    const out = await v2(w2, no).refresh('a1', two.installId);
    assert.deepEqual([out.rebuilt, out.daemonInUse, out.state.state], [false, true, 'installed'], JSON.stringify(out));
    assert.equal(readFileSync(recordPathOf(w2.home, two.installId), 'utf8'), before);
    assert.equal(readFileSync(join(two.bundlePath, 'Contents', 'Resources', 'artifact-app.json'), 'utf8'), manifest);
    assert.deepEqual(readdirSync(join(w2.installDir, '.staging')), []);

    // Repair of a package gone from its place, the daemon still running from where it was: refused the same way.
    renameSync(two.bundlePath, join(w2.root, 'away.app'));
    assert.equal((await w2.apps.state('a1')).reason, 'missing');
    const repair = await w2.make(daemonIn(w2, two.bundlePath, { release: false })).repair('a1', two.installId);
    assert.deepEqual([repair.rebuilt, repair.daemonInUse, repair.state.reason], [false, true, 'missing'], JSON.stringify(repair));
    assert.ok(!existsSync(two.bundlePath));
    assert.equal(readRecords(w2.home)[0].record.phase, 'installed');
    assert.deepEqual(readdirSync(join(w2.installDir, '.staging')), []);
  });

  it('refreshStale never restarts the daemon: an app it runs from is left, daemon-in-use', async () => {
    const w = world({ artifacts: docs });
    const one = (await w.apps.install('a1')).state;
    const two = (await w.apps.install('a2')).state;
    const daemon = daemonIn(w, one.bundlePath);
    const out = await v2(w, daemon).refreshStale();
    assert.deepEqual(out, { [one.installId]: 'daemon-in-use', [two.installId]: 'refreshed' });
    assert.equal(daemon.calls.released, 0);
    assert.equal(readRecords(w.home).find(({ record }) => record.installId === one.installId).record.templateVersion, '1.0.0+0.14.6');
  });

  it('daemonHost: a marker counts only for the running daemon (its pid, its start); runtimes.json\'s entry since it started', async () => {
    const { daemonHost, daemonHostFileOf, daemonHostGone } = await import('../src/daemon-host.mjs');
    const w = world();
    const write = (path, value) => {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, JSON.stringify(value));
    };
    const startedAt = '2026-11-25T10:00:00.000Z';
    const alive = (pid) => pid === 1001 || pid === 1002;
    assert.equal(daemonHost(w.home, { alive }), null, 'no daemon.json');
    write(join(w.home, 'daemon.json'), { pid: 1001, startedAt });
    const exe = join(w.installDir, 'Plan.app', 'Contents', 'MacOS', 'Open Artifact');
    const runtime = join(w.installDir, 'Plan.app', 'Contents', 'Resources', 'runtime');
    write(daemonHostFileOf(w.home), { pid: 1001, startedAt, exe, bin: join(runtime, 'scripts', 'open-artifact.mjs'), installId: 'x' });
    write(join(w.home, 'runtimes.json'), {
      runtimes: [
        { dir: '/old/runtime', version: '1.0.0', harness: 'daemon', seenAt: '2026-11-25T09:00:00.000Z' },
        { dir: runtime, version: '1.0.0', harness: 'daemon', seenAt: '2026-11-25T10:00:01.000Z' },
        { dir: '/agent/runtime', version: '1.0.0', harness: 'claude-code', seenAt: '2026-11-25T10:00:02.000Z' },
      ],
    });
    const host = daemonHost(w.home, { alive });
    assert.deepEqual([host.pid, host.paths, host.marker?.installId], [1001, [exe, join(runtime, 'scripts', 'open-artifact.mjs'), runtime], 'x']);
    assert.equal(daemonHostGone(host), true, 'those files are not there');
    // Only an installed app's package: files gone anywhere else (an agent's plugin updated under the daemon), with no
    // marker, are not a reason to restart the shared daemon.
    assert.equal(daemonHostGone({ pid: 1, paths: ['/agent/plugin/runtime-that-is-gone'], marker: null }, w.installDir), false);
    assert.equal(daemonHostGone({ pid: 1, paths: [runtime], marker: null }, w.installDir), true, 'gone, inside the install folder');
    assert.equal(daemonHostGone({ pid: 1, paths: [runtime], marker: null }), false, 'no install folder given');
    assert.equal(daemonHostGone({ pid: 1, paths: [w.home], marker: null }, w.installDir), false, 'there');
    // Another daemon since (another pid): the marker does not count.
    write(join(w.home, 'daemon.json'), { pid: 1002, startedAt: '2026-11-25T11:00:00.000Z' });
    assert.deepEqual(daemonHost(w.home, { alive }), { pid: 1002, paths: [], marker: null });
    // The marker's pid, but another start (a pid used again): not counted either.
    write(join(w.home, 'daemon.json'), { pid: 1001, startedAt: '2026-11-25T12:00:00.000Z' });
    assert.equal(daemonHost(w.home, { alive }).marker, null);
    // Its process gone: no daemon at all.
    write(join(w.home, 'daemon.json'), { pid: 1003, startedAt });
    assert.equal(daemonHost(w.home, { alive }), null);
  });

  it('daemonInside: a path inside the package (also one gone from there), or the marker naming the install', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const record = readRecords(w.home)[0].record;
    const at = (paths, marker = null) => w.make({ daemonHost: () => ({ pid: 1, paths, marker }) });
    assert.equal(await at([join(state.bundlePath, 'Contents', 'Resources', 'runtime')]).daemonInside(state.bundlePath), true);
    assert.equal(await at([join(state.bundlePath, 'Contents', 'gone', 'x')]).daemonInside(state.bundlePath), true);
    assert.equal(await at([`${state.bundlePath}-other/Contents/x`]).daemonInside(state.bundlePath), false);
    assert.equal(await at([join(w.template, 'Contents', 'Resources', 'runtime')]).daemonInside(state.bundlePath), false);
    assert.equal(await at([], { installId: record.installId }).daemonInside(state.bundlePath, record.installId), true);
    assert.equal(await w.apps.daemonInside(state.bundlePath), false, 'no daemon');
  });
});

describe('install as app: an uninstalled app\'s preferences file', () => {
  const id = `${BUNDLE_ID_PREFIX}00000000-0000-4000-8000-000000000001`;
  it('removed in the test\'s own HOME (only that exact file); never in the account\'s own home; an id of another form refused', async () => {
    const { forgetPreferencesFile, preferencesDirOf } = await import('../src/installed-apps-macos.mjs');
    const w = world();
    const prefs = join(w.userHome, 'Library', 'Preferences');
    mkdirSync(prefs, { recursive: true });
    writeFileSync(join(prefs, `${id}.plist`), 'x');
    writeFileSync(join(prefs, `${id}.plist.lockfile`), 'keep');
    writeFileSync(join(prefs, 'other.plist'), 'keep');
    const options = { dir: prefs, testMode: true, userHome: w.userHome, accountHome: join(w.root, 'someone') };
    assert.equal(forgetPreferencesFile(id, options), 'removed');
    assert.deepEqual(readdirSync(prefs).sort(), [`${id}.plist.lockfile`, 'other.plist']);
    assert.equal(forgetPreferencesFile(id, options), 'none');
    // The test's HOME is the account's: refused, the file kept.
    writeFileSync(join(prefs, `${id}.plist`), 'x');
    assert.equal(forgetPreferencesFile(id, { ...options, accountHome: w.userHome }), 'skipped');
    // A folder outside the test's HOME: refused.
    const outside = join(w.root, 'elsewhere', 'Library', 'Preferences');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, `${id}.plist`), 'x');
    assert.equal(forgetPreferencesFile(id, { ...options, dir: outside }), 'skipped');
    assert.ok(existsSync(join(outside, `${id}.plist`)));
    // Not an id of the apps' own form.
    assert.equal(forgetPreferencesFile('com.apple.finder', options), 'skipped');
    assert.equal(forgetPreferencesFile('dev.openartifact.app.*', options), 'skipped');
    assert.ok(existsSync(join(prefs, `${id}.plist`)));
    // Where macOS keeps them: CFFIXED_USER_HOME, else the account's home.
    assert.equal(preferencesDirOf({ env: { CFFIXED_USER_HOME: '/x' }, accountHome: '/a' }), '/x/Library/Preferences');
    assert.equal(preferencesDirOf({ env: {}, accountHome: '/a' }), '/a/Library/Preferences');
  });
});
