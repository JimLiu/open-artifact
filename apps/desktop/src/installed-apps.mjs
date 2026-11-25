/**
 * "Install as app": one artifact of this home as an app of its own in `~/Applications/Open Artifact Apps/`. The app is
 * a copy of the desktop app's own package (an APFS clone: no disk is used for it on the same volume) with its own
 * name, icon and bundle id, signed ad hoc on this computer; it starts in the single-artifact mode
 * (`artifact-app.mjs`) because its package carries `Contents/Resources/artifact-app.json`. Edits still go to the
 * artifact's own folder; installing or removing the app never changes the artifact or its owner.
 *
 * This module is the logic only (no Electron): the records, the order of an install, what is checked after one was
 * cut short, and the state the window is told. Everything that touches the package (clone, `Info.plist`, icon,
 * signature, placing, opening) goes through the `ops` given (`installed-apps-macos.mjs` on macOS; a test's own).
 *
 * **Names.** `artifactId` (the library's), `installId` (a random UUID per install), `bundleId`
 * (`dev.openartifact.app.<installId>`). One app per `(home, artifactId)`: the records are kept per home, and calls of
 * one artifact run one after the other (`serial`). Two artifacts of the same title each get their own app.
 *
 * **The record** (`<home>/desktop/apps/<installId>.json`, written whole and renamed into place: never half written)
 * is the source of truth: `schemaVersion, installId, artifactId, home, bundleId, bundlePath, displayName,
 * templateVersion, templatePath, artifactType, installedAt, phase, cloned` (+ `tempPath` while installing). `phase`:
 * `installing` (written before anything is copied), `installed` (the package is in place and checked),
 * `uninstalling` (for the uninstall, which is the next stage's: a record left in it is reported as needing repair).
 * The app's own Electron folder is `<home>/desktop/apps/<installId>/`.
 *
 * **An install** (`install`), in order: (1) the artifact and the conditions are read again, the name is checked
 * against what the person confirmed; (2) the record, `installing`; (3) the package cloned into a staging folder beside
 * the install folder (same volume), its quarantine removed, `Info.plist` rewritten, the icon and `artifact-app.json`
 * written; (4) the outer package signed ad hoc and checked (nested frameworks and helpers keep their signatures);
 * (5) placed under its name, never over anything that is there; (6) the record `installed`, then the app opened once:
 * what was written and whether it opened are answered apart (`{ state, launch }`); (7) `reconcile` puts right what an
 * install cut short left: a staging package of the record's own is removed with the record; a package in place whose
 * `artifact-app.json` names the record and whose signature checks is committed; anything else is "needs repair", and
 * nothing of the person's is touched.
 *
 * **State** (`state`, worked out on every call): `InstalledAppState`
 *   `{ state: 'unavailable', reason }` | `{ state: 'available', suggestedName, needsCopy }` | `{ state: 'installing' }` |
 *   `{ state: 'installed', installId, displayName, stale }` | `{ state: 'needsRepair', installId, reason }`.
 * `needsCopy`: the package cannot be cloned there (another volume, or not APFS): an install takes about 260 MB, and is
 * done only when asked again with `allowCopy`. `stale`: the desktop app changed since (its `templateVersion`); the
 * refresh is the next stage's. A package removed in the Finder is forgotten (its record and its Electron folder) the
 * next time its state is asked.
 *
 * **For the next stage** (the window's menus and dialog, uninstall, repair, refresh): the IPC of `main.mjs`
 * (`desktop:apps.state|install|open|reveal`) answers with these; `uninstall` would set `phase: 'uninstalling'`, ask
 * the app to quit when it runs, move the package to the Trash, remove the record and the app's folder, and must not
 * remove a later install of the same artifact (compare `installId`).
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ARTIFACT_APP_SCHEMA, artifactAppDir } from './profile.mjs';

/** The version of a record this code writes. */
export const RECORD_SCHEMA = 1;
/** The folder the apps go to, in the account's Applications folder. */
export const INSTALL_DIR_NAME = 'Open Artifact Apps';
/** The bundle id of an app: this prefix and its install id (the desktop app's placeholder id is `dev.openartifact.desktop`). */
export const BUNDLE_ID_PREFIX = 'dev.openartifact.app.';
/** The icon an app's package carries (`Contents/Resources/<this>`), named by `CFBundleIconFile`. */
export const ICON_FILE = 'AppIcon.icns';
/** The longest display name, in UTF-8 bytes: room for ` (99).app` in a file name (255 bytes). */
export const NAME_MAX_BYTES = 200;
/** A record's file name: `<installId>.json`. */
const RECORD_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;

/** Where the apps are installed: `<HOME>/Applications/Open Artifact Apps` (`os.homedir()`, which reads HOME). */
export const installDirOf = (userHome = homedir()) => join(userHome, 'Applications', INSTALL_DIR_NAME);
/** Where a home keeps its records (and each app's Electron folder). */
export const recordsDirOf = (home) => join(home, 'desktop', 'apps');
export const recordPathOf = (home, installId) => join(recordsDirOf(home), `${installId}.json`);
export const bundleIdOf = (installId, prefix = BUNDLE_ID_PREFIX) => `${prefix}${installId}`;
/** The staging folder an install builds its package in: beside the apps, so the last step is a rename. */
export const stagingDirOf = (installDir) => join(installDir, '.staging');

const utf8Length = (text) => Buffer.byteLength(text, 'utf8');
const graphemes = (text) => {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  } catch {
    return [...text];
  }
};

/**
 * An artifact's title made into an app's name (the package's file name without `.app`, and `CFBundleDisplayName`):
 *
 * - Unicode NFC (what the Finder shows and compares); spaces at either end and runs of white space made one space;
 * - `/` and `:` (the two characters a macOS file name cannot show as themselves) and control characters become `-`
 *   and nothing; leading dots are dropped (a name starting with a dot is hidden);
 * - cut to {@link NAME_MAX_BYTES} UTF-8 bytes on a whole character (a grapheme), so ` (2).app` still fits in 255;
 * - nothing left: `fallback` (the type's name, else "Artifact").
 */
export function displayNameOf(title, fallback = 'Artifact') {
  let name = String(title ?? '')
    .normalize('NFC')
    .replace(/[\t\n\r\v\f]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/:]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  if (utf8Length(name) > NAME_MAX_BYTES) {
    let cut = '';
    for (const part of graphemes(name)) {
      if (utf8Length(cut + part) > NAME_MAX_BYTES) break;
      cut += part;
    }
    name = cut.trim();
  }
  return name || (fallback === 'Artifact' ? 'Artifact' : displayNameOf(fallback, 'Artifact'));
}

/**
 * `name`, or `name (2)`, `name (3)`… past every name in `taken` (compared as the Finder compares them: NFC, letter
 * case ignored).
 */
export function uniqueName(name, taken) {
  const key = (text) => String(text).normalize('NFC').toLocaleLowerCase('en-US');
  const used = new Set([...taken].map(key));
  if (!used.has(key(name))) return name;
  for (let n = 2; ; n++) {
    const next = `${name} (${n})`;
    if (!used.has(key(next))) return next;
  }
}

/**
 * The changes to the copied `Info.plist` (every other key is left as the desktop app's, `ElectronAsarIntegrity`
 * included): the name the Finder, the Dock and ⌘Tab show (`CFBundleDisplayName`), the bundle id and the icon.
 * `CFBundleName` and `CFBundleExecutable` stay the desktop app's: Electron finds its helpers by `CFBundleName`
 * (`Frameworks/<CFBundleName> Helper*.app`), and the nested helpers are not touched. So the menu bar's bold app name
 * stays "Open Artifact" while the app runs: a known difference of this first version. A URL scheme the desktop
 * package may declare is not declared by its copies; an icon from an asset catalog would come before the icon file.
 */
export function infoPlistEdits({ displayName, bundleId, iconFile = ICON_FILE }) {
  return [
    { op: 'replace', key: 'CFBundleDisplayName', type: 'string', value: displayName },
    { op: 'replace', key: 'CFBundleIdentifier', type: 'string', value: bundleId },
    { op: 'replace', key: 'CFBundleIconFile', type: 'string', value: iconFile },
    { op: 'remove', key: 'CFBundleIconName' },
    { op: 'remove', key: 'CFBundleURLTypes' },
  ];
}

/** What the app's package says of itself (`artifact-app.json`), from its record. */
export const manifestOf = (record) => ({
  schemaVersion: ARTIFACT_APP_SCHEMA,
  installId: record.installId,
  artifactId: record.artifactId,
  home: record.home,
  templateVersion: record.templateVersion,
});

/**
 * Writes `value` as JSON to `path` whole: a temporary file beside it (`<path>.<pid>.tmp`), then a rename.
 * `beforeRename()` runs between the two (a test's checkpoint).
 */
export async function writeJsonAtomic(path, value, { beforeRename = async () => {} } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  await beforeRename();
  renameSync(temp, path);
}

/** {@link writeJsonAtomic}, at once (no step between the two). */
export function writeJsonAtomicSync(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/** The records of `home` (each `{ file, record }`); a file that is not one of ours is left out. */
export function readRecords(home) {
  const dir = recordsDirOf(home);
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const match = RECORD_FILE.exec(name);
    if (!match) continue;
    const record = readJson(join(dir, name));
    if (record?.schemaVersion === RECORD_SCHEMA && record.installId === match[1] && typeof record.artifactId === 'string') out.push({ file: join(dir, name), record });
  }
  return out;
}

const realOf = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/**
 * What an artifact app checks before it connects to anything: its record in the home its package names is there and
 * says `installed`, with the same `installId` and `artifactId`, for this very package (`bundlePath`, compared as real
 * paths). `{ ok: true, record }`, or `{ ok: false, reason }` (the app then needs repair: it says so and connects to no
 * daemon).
 */
export function checkLaunch({ manifest, bundlePath }) {
  const record = readJson(recordPathOf(manifest.home, manifest.installId));
  if (!record) return { ok: false, reason: 'no-record', detail: `No install record ${manifest.installId} in ${manifest.home}.` };
  if (record.schemaVersion !== RECORD_SCHEMA || record.installId !== manifest.installId) return { ok: false, reason: 'record-mismatch', detail: 'The install record is not this app\'s.' };
  if (record.artifactId !== manifest.artifactId) return { ok: false, reason: 'record-mismatch', detail: 'The install record names another artifact.' };
  if (record.phase !== 'installed') return { ok: false, reason: 'not-installed', detail: `The install record says ${record.phase}.` };
  const here = realOf(bundlePath);
  if (!here || here !== realOf(record.bundlePath)) return { ok: false, reason: 'moved', detail: `This app is at ${bundlePath}; its record names ${record.bundlePath}.` };
  return { ok: true, record };
}

/**
 * The installs of one home. `home`; `installDir` (default {@link installDirOf}); `template`: the desktop app running
 * this (`{ bundlePath, executable, version() }`, `bundlePath` null when it is not a package); `packaged`; `platform`;
 * `library`: `{ record(id), types() }` (the daemon's word on an artifact and the types); `ops`: what touches packages
 * (see `installed-apps-macos.mjs`); `checkpoint(step)`: awaited after each step (`recorded`, `cloned`, `signed`,
 * `placed`, `committing`), for tests that cut an install short there; `log`; `randomId`; `now`.
 */
export class InstalledApps {
  constructor({ home, installDir = installDirOf(), template, packaged, platform = process.platform, library, ops, checkpoint = async () => {}, log = () => {}, randomId = randomUUID, now = () => new Date() }) {
    Object.assign(this, { home, installDir, template, packaged, platform, library, ops, checkpoint, log, randomId, now });
    /** artifactId → the call of it under way (calls of one artifact run one after the other). */
    this.chains = new Map();
    /** artifactIds with an install under way in this process. */
    this.busy = new Set();
  }

  /** Runs `run` after every earlier call of `artifactId` (by this object) ends. */
  serial(artifactId, run) {
    const before = this.chains.get(artifactId) ?? Promise.resolve();
    const next = before.catch(() => {}).then(run);
    const tail = next.catch(() => {});
    this.chains.set(artifactId, tail);
    void tail.then(() => {
      if (this.chains.get(artifactId) === tail) this.chains.delete(artifactId);
    });
    return next;
  }

  /** The records of this home of `artifactId` (several only when an earlier install was left behind). */
  recordsOf(artifactId) {
    return readRecords(this.home)
      .filter(({ record }) => record.artifactId === artifactId)
      .map(({ record }) => record);
  }

  async writeRecord(record, beforeRename) {
    await writeJsonAtomic(recordPathOf(this.home, record.installId), record, beforeRename ? { beforeRename } : {});
  }

  forget(record, { data = false } = {}) {
    try {
      unlinkSync(recordPathOf(this.home, record.installId));
    } catch {
      // Gone already.
    }
    // The record's own leftovers of a cut-short write (`<installId>.json.<pid>.tmp`).
    const dir = recordsDirOf(this.home);
    try {
      for (const name of readdirSync(dir)) if (name.startsWith(`${record.installId}.json.`) && name.endsWith('.tmp')) rmSync(join(dir, name), { force: true });
    } catch {
      // No folder.
    }
    if (data) rmSync(artifactAppDir(this.home, record.installId), { recursive: true, force: true });
  }

  /** Whether the package at `path` is the record's: its `artifact-app.json` names the record's install. */
  isOurs(path, record) {
    if (!path || !this.ops.exists(path)) return false;
    const manifest = this.ops.readManifest(path);
    return manifest?.installId === record.installId && manifest?.artifactId === record.artifactId && manifest?.home === record.home;
  }

  /**
   * Puts right what installs of `artifactId` that were cut short left (step 7), and forgets apps removed in the
   * Finder. Answers `{ verdicts }`: per record what was done (`committed`, `cleaned`, `forgotten`, `ok`, `repair`).
   * Only within the artifact's turn (`serial`), so never while an install of it runs here.
   */
  reconcileOne(artifactId) {
    const verdicts = [];
    for (const record of this.recordsOf(artifactId)) {
      const verdict = this.reconcileRecord(record);
      verdicts.push({ installId: record.installId, ...verdict });
      if (verdict.action !== 'ok') this.log(`installed apps: ${artifactId} ${record.installId}: ${verdict.action}${verdict.reason ? ` (${verdict.reason})` : ''}`);
    }
    return verdicts;
  }

  reconcileRecord(record) {
    if (record.phase === 'installing') {
      // The package reached its place: committed when it is the record's and its signature checks.
      if (this.isOurs(record.bundlePath, record)) {
        if (!this.ops.verify(record.bundlePath)) return { action: 'repair', reason: 'signature' };
        const done = { ...record, phase: 'installed', installedAt: record.installedAt ?? this.now().toISOString() };
        delete done.tempPath;
        writeJsonAtomicSync(recordPathOf(this.home, record.installId), done);
        this.forgetTemps(record);
        return { action: 'committed' };
      }
      // It did not: its staging package (named by its install id, or saying so) goes with the record.
      if (record.tempPath && this.ops.exists(record.tempPath)) {
        if (basename(record.tempPath) !== `${record.installId}.app` && !this.isOurs(record.tempPath, record)) return { action: 'repair', reason: 'staging' };
        this.ops.remove(record.tempPath);
      }
      // Cut short between making its place and moving it in: the empty folder of its name, if that is all there is.
      this.ops.removeEmpty?.(record.bundlePath);
      this.forget(record, { data: true });
      return { action: 'cleaned' };
    }
    if (record.phase === 'installed') {
      if (!this.ops.exists(record.bundlePath)) {
        // Removed in the Finder (or to the Trash): the record and the app's own folder are forgotten.
        this.forget(record, { data: true });
        return { action: 'forgotten' };
      }
      if (!this.isOurs(record.bundlePath, record)) return { action: 'repair', reason: 'replaced' };
      return { action: 'ok' };
    }
    // `uninstalling` (the next stage's) or a phase this code does not know.
    return { action: 'repair', reason: record.phase === 'uninstalling' ? 'uninstall-interrupted' : 'phase' };
  }

  forgetTemps(record) {
    const dir = recordsDirOf(this.home);
    try {
      for (const name of readdirSync(dir)) if (name.startsWith(`${record.installId}.json.`) && name.endsWith('.tmp')) rmSync(join(dir, name), { force: true });
    } catch {
      // No folder.
    }
  }

  /** Every artifact with a record in this home, reconciled (at start, or before the window lists them). */
  async reconcileAll() {
    const ids = [...new Set(readRecords(this.home).map(({ record }) => record.artifactId))];
    const out = {};
    for (const id of ids) out[id] = await this.serial(id, () => this.reconcileOne(id));
    return out;
  }

  /**
   * Whether `artifactId` can be installed here: `{ ok: true, artifact, type }` or `{ ok: false, reason }`. Reasons:
   * `not-packaged` (a development run: there is no package to copy), `not-macos`, `not-found` (not in this home's
   * library), `folder-missing`, `remote-type` (its page is on another computer), `library` (the daemon could not say).
   */
  async support(artifactId) {
    if (!this.packaged || !this.template?.bundlePath) return { ok: false, reason: 'not-packaged' };
    if (this.platform !== 'darwin') return { ok: false, reason: 'not-macos' };
    let artifact;
    try {
      artifact = await this.library.record(artifactId);
    } catch (error) {
      return { ok: false, reason: error?.status === 404 || error?.code === 'not_found' ? 'not-found' : 'library', detail: error?.message ?? String(error) };
    }
    if (!artifact || artifact.id !== artifactId) return { ok: false, reason: 'not-found' };
    if (artifact.folderMissing === true) return { ok: false, reason: 'folder-missing' };
    let type = null;
    try {
      const { types } = await this.library.types();
      type = (types ?? []).find((entry) => entry.id === artifact.type) ?? null;
    } catch (error) {
      return { ok: false, reason: 'library', detail: error?.message ?? String(error) };
    }
    if (type?.remote === true) return { ok: false, reason: 'remote-type' };
    return { ok: true, artifact, type };
  }

  /** The names taken in the install folder (the packages there, and the ones being installed). */
  takenNames() {
    const taken = new Set();
    try {
      for (const name of readdirSync(this.installDir)) if (name.toLowerCase().endsWith('.app')) taken.add(name.slice(0, -4));
    } catch {
      // No folder yet.
    }
    for (const { record } of readRecords(this.home)) if (record.phase === 'installing' && record.displayName) taken.add(record.displayName);
    return taken;
  }

  suggestedName(artifact, type) {
    return uniqueName(displayNameOf(artifact.title, type?.title || artifact.type || 'Artifact'), this.takenNames());
  }

  installedState(record) {
    return { state: 'installed', installId: record.installId, displayName: record.displayName, stale: record.templateVersion !== this.template.version() };
  }

  /** The state of `artifactId`'s app (see the module comment), worked out now. */
  state(artifactId) {
    // While this process installs it, at once (not after the install).
    if (this.busy.has(artifactId)) return Promise.resolve({ state: 'installing' });
    return this.serial(artifactId, () => this.stateNow(artifactId));
  }

  async stateNow(artifactId) {
    if (this.busy.has(artifactId)) return { state: 'installing' };
    const verdicts = this.reconcileOne(artifactId);
    const repair = verdicts.find((verdict) => verdict.action === 'repair');
    if (repair) return { state: 'needsRepair', installId: repair.installId, reason: repair.reason };
    const record = this.recordsOf(artifactId).find((entry) => entry.phase === 'installed');
    if (record) return this.installedState(record);
    const support = await this.support(artifactId);
    if (!support.ok) return { state: 'unavailable', reason: support.reason };
    return { state: 'available', suggestedName: this.suggestedName(support.artifact, support.type), needsCopy: !this.ops.sameVolume(this.template.bundlePath, this.installDir) };
  }

  /**
   * Installs `artifactId`'s app (see the module comment), or answers the one there is. `confirmedName`: the name the
   * person saw; when the name it would get now differs (taken meanwhile), nothing is installed and the answer carries
   * the new one (`nameChanged`). `allowCopy`: go on with a plain copy where the package cannot be cloned.
   * Answers `{ state, launch, … }`: `launch` is `opened`, `failed` or `skipped` (test mode, or nothing installed).
   */
  install(artifactId, { confirmedName, allowCopy = false } = {}) {
    return this.serial(artifactId, async () => {
      const now = await this.stateNow(artifactId);
      if (now.state === 'installed') {
        const launch = await this.launchRecord(this.recordsOf(artifactId).find((entry) => entry.phase === 'installed'));
        return { state: now, launch, reused: true };
      }
      if (now.state !== 'available') return { state: now, launch: 'skipped' };
      if (typeof confirmedName === 'string' && confirmedName !== now.suggestedName) {
        this.log(`installed apps: ${artifactId}: the name is now ${JSON.stringify(now.suggestedName)}, not ${JSON.stringify(confirmedName)}; not installed`);
        return { state: now, launch: 'skipped', nameChanged: true };
      }
      this.busy.add(artifactId);
      try {
        return await this.installNow(artifactId, now.suggestedName, allowCopy);
      } finally {
        this.busy.delete(artifactId);
      }
    });
  }

  async installNow(artifactId, name, allowCopy) {
    const support = await this.support(artifactId);
    if (!support.ok) return { state: { state: 'unavailable', reason: support.reason }, launch: 'skipped' };
    const staging = stagingDirOf(this.installDir);
    this.ops.prepareDir(staging);
    const clone = this.ops.canClone(this.template.bundlePath, staging);
    if (!clone && !allowCopy) {
      this.log(`installed apps: ${artifactId}: the package cannot be cloned into ${this.installDir}; asked to copy first`);
      return { state: { state: 'available', suggestedName: name, needsCopy: true }, launch: 'skipped', needsCopy: true };
    }
    const installId = this.randomId();
    const record = {
      schemaVersion: RECORD_SCHEMA,
      installId,
      artifactId,
      home: this.home,
      bundleId: bundleIdOf(installId),
      bundlePath: join(this.installDir, `${name}.app`),
      tempPath: join(staging, `${installId}.app`),
      displayName: name,
      templateVersion: this.template.version(),
      templatePath: this.template.bundlePath,
      artifactType: support.artifact.type ?? null,
      installedAt: null,
      phase: 'installing',
      cloned: clone,
    };
    const started = Date.now();
    // (2) The record before anything is copied.
    await this.writeRecord(record);
    await this.checkpoint('recorded');
    try {
      // (3) The package, in the staging folder.
      this.ops.copyBundle(this.template.bundlePath, record.tempPath, { clone });
      await this.checkpoint('cloned');
      this.ops.clearQuarantine(record.tempPath);
      this.ops.editInfoPlist(record.tempPath, infoPlistEdits({ displayName: name, bundleId: record.bundleId }));
      this.ops.writeIcon(record.tempPath, record.artifactType, ICON_FILE);
      this.ops.writeManifest(record.tempPath, manifestOf(record));
      // (4) Signed ad hoc, the outer package only, and checked.
      this.ops.sign(record.tempPath);
      if (!this.ops.verify(record.tempPath)) throw new Error('the signature of the new package does not check');
      await this.checkpoint('signed');
      // (5) In place, never over what is there.
      this.ops.place(record.tempPath, record.bundlePath);
      await this.checkpoint('placed');
    } catch (error) {
      const conflict = error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY';
      this.log(`installed apps: ${artifactId}: install failed${conflict ? ` (${record.bundlePath} is taken)` : ''}: ${error?.message ?? error}`);
      if (this.ops.exists(record.tempPath)) this.ops.remove(record.tempPath);
      this.forget(record, { data: true });
      // Nothing is being installed any more: the state as it is now.
      this.busy.delete(artifactId);
      const state = await this.stateNow(artifactId);
      return { state, launch: 'skipped', ...(conflict ? { conflict: true } : { error: String(error?.message ?? error) }) };
    }
    // (6) Committed, then opened once.
    const done = { ...record, phase: 'installed', installedAt: this.now().toISOString() };
    delete done.tempPath;
    await this.writeRecord(done, () => this.checkpoint('committing'));
    this.log(`installed apps: ${artifactId}: installed ${JSON.stringify({ installId, bundlePath: done.bundlePath, bundleId: done.bundleId, cloned: clone, ms: Date.now() - started })}`);
    const launch = await this.launchRecord(done);
    return { state: this.installedState(done), launch };
  }

  /** Opens a record's package (test mode: `skipped`, only logged). */
  async launchRecord(record) {
    if (!record) return 'failed';
    try {
      return await this.ops.launch(record.bundlePath);
    } catch (error) {
      this.log(`installed apps: open ${record.bundlePath}: ${error?.message ?? error}`);
      return 'failed';
    }
  }

  /** The installed record of `artifactId` that is `installId`, checked; throws otherwise. */
  installedRecord(artifactId, installId) {
    const record = this.recordsOf(artifactId).find((entry) => entry.installId === installId);
    if (!record || record.phase !== 'installed') throw new Error(`no installed app ${installId} of ${artifactId}`);
    if (!this.isOurs(record.bundlePath, record)) throw new Error(`the app at ${record.bundlePath} is not ${installId}`);
    return record;
  }

  /** Opens the app of `artifactId` that is `installId` (only the package its record names). */
  open(artifactId, installId) {
    return this.serial(artifactId, async () => ({ launch: await this.launchRecord(this.installedRecord(artifactId, installId)) }));
  }

  /** The package of the app of `artifactId` that is `installId` (to show in the Finder). */
  revealPath(artifactId, installId) {
    return this.serial(artifactId, async () => this.installedRecord(artifactId, installId).bundlePath);
  }
}

