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
  };
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
  return { root, userHome, home, template, icons, installDir, logs, ops, real, library, signed, apps: make(), make };
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
    assert.deepEqual(await w.apps.state('a1'), { state: 'available', suggestedName: '季度复盘', needsCopy: false });
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
    assert.deepEqual(await w.apps.state('a1'), { state: 'installed', installId: out.state.installId, displayName: '季度复盘', stale: false });
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
    assert.deepEqual(await apps.state('a1'), { state: 'available', suggestedName: '季度复盘', needsCopy: true });
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

  it('a package removed in the Finder is forgotten: its record and its own folder', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    mkdirSync(artifactAppDir(w.home, state.installId), { recursive: true });
    rmSync(join(w.installDir, '季度复盘.app'), { recursive: true });
    assert.equal((await w.apps.state('a1')).state, 'available');
    assert.equal(readRecords(w.home).length, 0);
    assert.ok(!existsSync(artifactAppDir(w.home, state.installId)));
  });

  it('a package in its place that is not the record\'s, or an uninstall cut short: needs repair, nothing removed', async () => {
    const w = world({ artifacts: docs });
    const { state } = await w.apps.install('a1');
    const bundle = join(w.installDir, '季度复盘.app');
    writeFileSync(join(bundle, 'Contents', 'Resources', 'artifact-app.json'), JSON.stringify({ installId: 'other' }));
    assert.deepEqual(await w.apps.state('a1'), { state: 'needsRepair', installId: state.installId, reason: 'replaced' });
    assert.ok(existsSync(bundle));
    const file = recordPathOf(w.home, state.installId);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), phase: 'uninstalling' }));
    assert.equal((await w.apps.state('a1')).reason, 'uninstall-interrupted');
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
    assert.deepEqual(await fresh.state('a1'), { state: 'needsRepair', installId: readRecords(w.home)[0].record.installId, reason: 'signature' });
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
