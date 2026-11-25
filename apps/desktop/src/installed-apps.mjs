/**
 * "Install as app": one artifact of this home as an app of its own in `~/Applications/Open Artifact Apps/`. The app is
 * a copy of the desktop app's own package (an APFS clone: no disk is used for it on the same volume) with its own
 * name, icon and bundle id, signed ad hoc on this computer; it starts in the single-artifact mode
 * (`artifact-app.mjs`) because its package carries `Contents/Resources/artifact-app.json`. Edits still go to the
 * artifact's own folder; installing or removing the app never changes the artifact or its owner.
 *
 * This module is the logic only (no Electron): the records, the order of an install, an uninstall and a rebuild, what
 * is checked after one was cut short, and the state the window is told. Everything that touches the package (clone,
 * `Info.plist`, icon, signature, placing, swapping, the Trash, the preferences, opening) goes through the `ops` given
 * (`installed-apps-macos.mjs` on macOS; a test's own).
 *
 * **Names.** `artifactId` (the library's), `installId` (a random UUID per install), `bundleId`
 * (`dev.openartifact.app.<installId>`). One app per `(home, artifactId)`: the records are kept per home, and calls of
 * one artifact run one after the other (`serial`). Two artifacts of the same title each get their own app.
 *
 * **The record** (`<home>/desktop/apps/<installId>.json`, written whole and renamed into place: never half written)
 * is the source of truth: `schemaVersion, installId, artifactId, home, bundleId, bundlePath, displayName,
 * templateVersion, templatePath, artifactType, installedAt, phase, cloned` (+ `tempPath` while installing, `before`
 * while uninstalling, `targetVersion` while rebuilding). `phase`: `installing` (written before anything is copied),
 * `installed` (the package is in place and checked), `uninstalling`, `refreshing` (a rebuild: a refresh or a repair).
 * The app's own Electron folder is `<home>/desktop/apps/<installId>/`.
 *
 * **An install** (`install`), in order: (1) the artifact and the conditions are read again, the name is checked
 * against what the person confirmed; (2) the record, `installing`; (3) the package cloned into a staging folder beside
 * the install folder (same volume), its quarantine removed, `Info.plist` rewritten, the icon and `artifact-app.json`
 * written; (4) the outer package signed ad hoc and checked (nested frameworks and helpers keep their signatures);
 * (5) placed under its name, never over anything that is there; (6) the record `installed`, then the app opened once:
 * what was written and whether it opened are answered apart (`{ state, launch }`).
 *
 * **Whether an app runs** (never `ps`): the app writes `<its folder>/running.json` (`{ pid, bundlePath, startedAt }`)
 * once it holds its single-instance lock, and removes it when its process exits. It runs while that file is there and
 * names a process that is alive (`process.kill(pid, 0)`). A file left by a crash names a dead process (not running); a
 * pid used again by another process since makes an app look running, which only ever makes an uninstall or a rebuild
 * wait, then say "close it first": the safe side. Once a pid was seen, the wait is for that process to end, not for the
 * file to go (Electron still writes to the folder after the file is gone).
 *
 * **An uninstall** (`uninstall(artifactId, installId)`): the record `uninstalling` → the app, when it runs, sees that in
 * its record (it reads it every second) and quits as the person's ⌘Q would (unsaved work waited for, then asked
 * about); the desktop app waits up to {@link QUIT_TIMEOUT_MS} for it to end, and when it does not, puts the record back
 * as it was and says the app is still open → the package to the Trash, only when its `artifact-app.json` is the
 * record's (anything else at that path is left, and said) → the bundle id's preferences forgotten → the record and the
 * app's folder removed. An uninstall names its `installId`: a later install of the same artifact is never removed.
 *
 * **A rebuild** (`refresh`: the desktop app changed since, `stale`; `repair`: a record that needs repair whose place
 * holds its own package or nothing): a new package in the staging folder under the same `installId`, bundle id and
 * name (`<installId>.app`), built and checked as an install's, then swapped in: the package in place renamed to
 * `<installId>.old.app` in the staging folder, the new one renamed into its place, the old one removed, the record
 * `installed` with the new `templateVersion`. Only while the app does not run (asked again before the swap).
 *
 * **Putting right what was cut short** (`reconcile`, at start and before every state), from what is on disk:
 * - `installing`: a package in place whose `artifact-app.json` names the record and whose signature checks is
 *   committed; else the staging package of the record's own is removed with the record (and the empty folder of its
 *   name, if that is all there is); anything else is "needs repair", and nothing of the person's is touched.
 * - `installed`: the package gone from its place is looked for in the install folder (renamed in the Finder): exactly
 *   one package there that names the record and whose signature checks is claimed (the record takes its path and its
 *   name); none: needs repair (`missing`: moved to the Trash, or out of the install folder, which the app itself then
 *   says; the record is kept so that a package moved back opens again, and Repair builds it again, Remove Record
 *   forgets it); a package in its place that is not the record's: needs repair (`replaced`). A record
 *   whose desktop app is not the one running now takes this one's path (`templatePath`).
 * - `uninstalling` (the desktop app went away during one): the package still the record's → back to `installed`;
 *   else the rest is removed.
 * - `refreshing`: in place the record's package, and `<installId>.old.app` in staging or (the old one removed
 *   already) the package in place says the new version and no new one waits in staging → the swap was done: committed;
 *   in place the record's package otherwise → not swapped: the new one removed, back to `installed`; nothing in place
 *   and the old one in staging → the old one put back; nothing in place, no old one, a new one that checks → it is put
 *   in place, committed; nothing at all → back to `installed` (and so `missing`); in place something not the record's
 *   → needs repair.
 *
 * **State** (`state`, worked out on every call): `InstalledAppState`
 *   `{ state: 'unavailable', reason }` | `{ state: 'available', suggestedName, needsCopy, installDir, copyBytes? }` |
 *   `{ state: 'installing' }` | `{ state: 'busy', task: 'uninstalling' | 'refreshing' }` |
 *   `{ state: 'installed', installId, displayName, bundlePath, stale, running }` |
 *   `{ state: 'needsRepair', installId, reason, repairable }`.
 * `needsCopy`: the package cannot be cloned there (another volume, or not APFS): an install takes `copyBytes` (about
 * 260 MB), and is done only when asked again with `allowCopy`. `stale`: the desktop app changed since (its
 * `templateVersion`): `refresh` rebuilds it, and the desktop app does so by itself at start for the apps that do not
 * run (`refreshStale`).
 *
 * **The daemon in a package** (`daemonHost()`, `releaseDaemon()`, given): the home's daemon may run from an app's own
 * package (its executable and runtime: the app started it while the desktop app was not where its record says, or
 * another caller started it from the runtime that app registered). Moving or removing that package leaves a daemon
 * that cannot load a type it has not loaded yet. So before an uninstall's Trash and a rebuild's swap, when the daemon
 * lives in that package (`daemonInside`), it is restarted from elsewhere first (`releaseDaemon()`: the desktop app's
 * own runtime); when that cannot be done (unsaved work in the desktop app's tabs, or the daemon is still in the
 * package after it), nothing is moved, the record is as it was, and the answer says `daemonInUse`. The refresh at start
 * (`refreshStale`) never restarts the shared daemon: such an app is left (`daemon-in-use`) for the dialog's Update.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
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
/** How long an uninstall waits for the app to quit by itself, ms. */
export const QUIT_TIMEOUT_MS = 15_000;
/** The file a running app keeps in its own folder: `{ pid, bundlePath, startedAt }`. */
export const RUNNING_FILE = 'running.json';
/** A record's file name: `<installId>.json`. */
const RECORD_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
/** The reasons of "needs repair" a rebuild does not put right (what is in the app's place is not its own). */
const NOT_REPAIRABLE = new Set(['replaced', 'duplicates', 'staging']);

/** Where the apps are installed: `<HOME>/Applications/Open Artifact Apps` (`os.homedir()`, which reads HOME). */
export const installDirOf = (userHome = homedir()) => join(userHome, 'Applications', INSTALL_DIR_NAME);
/** Where a home keeps its records (and each app's Electron folder). */
export const recordsDirOf = (home) => join(home, 'desktop', 'apps');
export const recordPathOf = (home, installId) => join(recordsDirOf(home), `${installId}.json`);
export const bundleIdOf = (installId, prefix = BUNDLE_ID_PREFIX) => `${prefix}${installId}`;
/** The staging folder an install builds its package in: beside the apps, so the last step is a rename. */
export const stagingDirOf = (installDir) => join(installDir, '.staging');
/** A rebuild's new package and the package it replaces, in the staging folder. */
export const newBundleOf = (installDir, installId) => join(stagingDirOf(installDir), `${installId}.app`);
export const oldBundleOf = (installDir, installId) => join(stagingDirOf(installDir), `${installId}.old.app`);
/** The running app's file (see the module comment). */
export const runningPathOf = (home, installId) => join(artifactAppDir(home, installId), RUNNING_FILE);

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
 *
 * Every other character stays (`#`, `?`, `%`, quotes…): the paths inside the package are written into URLs escaped
 * (`page-url.mjs`).
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
 * included): the name the Finder shows (`CFBundleDisplayName`), the bundle id and the icon. `CFBundleName` and
 * `CFBundleExecutable` stay the desktop app's: Electron finds its helpers by `CFBundleName`
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

/** Whether a package's `artifact-app.json` (`manifest`) names `record`'s install. */
export const manifestNames = (manifest, record) => manifest?.installId === record.installId && manifest?.artifactId === record.artifactId && manifest?.home === record.home;

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

/** An install record of `home`, read now (null when there is none, or it is not one). */
export function readRecord(home, installId) {
  const record = readJson(recordPathOf(home, installId));
  return record?.schemaVersion === RECORD_SCHEMA && record.installId === installId ? record : null;
}

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
    return realpathSync(path).normalize('NFC');
  } catch {
    return null;
  }
};

/** Whether `path` is a package directly in `installDir` (compared as real paths). */
export function inInstallDir(path, installDir) {
  const dir = realOf(installDir);
  const here = realOf(path);
  return !!dir && !!here && dirname(here) === dir;
}

/** Whether `path` is `dir` or inside it: as real paths when they are there, else as written (NFC). */
export function pathWithin(path, dir) {
  if (!path || !dir) return false;
  const written = (p) => resolve(p).normalize('NFC').replace(/[\\/]+$/, '');
  const pairs = [
    [realOf(path) ?? written(path), realOf(dir) ?? written(dir)],
    [written(path), written(dir)],
  ];
  return pairs.some(([p, d]) => p === d || p.startsWith(`${d}${sep}`));
}

/** Whether a process is alive (`kill(pid, 0)`: EPERM is another user's, alive too). */
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/** The pid of the running app of `installId` (its `running.json`, naming a process alive), or null. */
export function runningPid(home, installId, alive = processAlive) {
  const info = readJson(runningPathOf(home, installId));
  return Number.isInteger(info?.pid) && alive(info.pid) ? info.pid : null;
}

/** The app says it runs (see the module comment); `bundlePath`: its package. */
export function markRunning(home, installId, { pid = process.pid, bundlePath = null } = {}) {
  writeJsonAtomicSync(runningPathOf(home, installId), { pid, bundlePath, startedAt: new Date().toISOString() });
}

/** The app's process ends: its file goes, when it is still this process's. */
export function clearRunning(home, installId, pid = process.pid) {
  const path = runningPathOf(home, installId);
  if (readJson(path)?.pid !== pid) return;
  try {
    unlinkSync(path);
  } catch {
    // Gone already.
  }
}

/**
 * The packages directly in `installDir` whose `artifact-app.json` names `record` (`readManifest(path)`), other than
 * `except`: where a package renamed in the Finder went.
 */
export function packagesOf(record, installDir, readManifest, except = null) {
  let names = [];
  try {
    names = readdirSync(installDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.toLowerCase().endsWith('.app') && !name.startsWith('.'))
    .map((name) => join(installDir, name))
    .filter((path) => path !== except && manifestNames(readManifest(path), record));
}

/**
 * A package renamed in the install folder takes its record: the record's `bundlePath` and `displayName` become the
 * package's (its `Info.plist` is not touched: that would break its signature; a rebuild writes the new name in).
 * Answers the record as written.
 */
export function claimPackage(record, path) {
  const claimed = { ...record, bundlePath: path, displayName: basename(path).replace(/\.app$/i, '') };
  writeJsonAtomicSync(recordPathOf(record.home, record.installId), claimed);
  return claimed;
}

/**
 * What an artifact app checks before it connects to anything: its record in the home its package names is there and
 * says `installed`, with the same `installId` and `artifactId`, for this very package (`bundlePath`, compared as real
 * paths). `{ ok: true, record }`, or `{ ok: false, reason, record? }` (the app then needs repair: it says so and
 * connects to no daemon; `uninstalling` and `refreshing` are said apart: the app then quits).
 */
export function checkLaunch({ manifest, bundlePath }) {
  const record = readJson(recordPathOf(manifest.home, manifest.installId));
  if (!record) return { ok: false, reason: 'no-record', detail: `No install record ${manifest.installId} in ${manifest.home}.` };
  if (record.schemaVersion !== RECORD_SCHEMA || record.installId !== manifest.installId) return { ok: false, reason: 'record-mismatch', detail: 'The install record is not this app\'s.' };
  if (record.artifactId !== manifest.artifactId) return { ok: false, reason: 'record-mismatch', detail: 'The install record names another artifact.' };
  if (record.phase === 'uninstalling' || record.phase === 'refreshing') return { ok: false, reason: record.phase, record, detail: `The install record says ${record.phase}.` };
  if (record.phase !== 'installed') return { ok: false, reason: 'not-installed', record, detail: `The install record says ${record.phase}.` };
  const here = realOf(bundlePath);
  if (!here || here !== realOf(record.bundlePath)) return { ok: false, reason: 'moved', record, detail: `This app is at ${bundlePath}; its record names ${record.bundlePath}.` };
  return { ok: true, record };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * The installs of one home. `home`; `installDir` (default {@link installDirOf}); `template`: the desktop app running
 * this (`{ bundlePath, executable, version() }`, `bundlePath` null when it is not a package); `packaged`; `platform`;
 * `library`: `{ record(id), types() }` (the daemon's word on an artifact and the types); `ops`: what touches packages
 * (see `installed-apps-macos.mjs`); `checkpoint(step)`: awaited after each step (an install's `recorded`, `cloned`,
 * `signed`, `placed`, `committing`; an uninstall's `uninstall-recorded`, `uninstall-quit`, `uninstall-trashed`; a
 * rebuild's `rebuild-recorded`, `rebuild-built`, `rebuild-aside`, `rebuild-placed`, `rebuild-removed`,
 * `rebuild-committing`), for tests that cut one short there; `isRunning(record)`: the pid of its running app, or null
 * (default: its `running.json`); `alive(pid)`; `quitTimeoutMs`; `pollMs`; `log`; `randomId`; `now`; `daemonHost()`: where the home's daemon lives (`{ pid, paths }`, or null; may be async; `daemon-host.mjs`);
 * `releaseDaemon()`: restarts it from elsewhere, true once done (may refuse: false).
 */
export class InstalledApps {
  constructor({
    home,
    installDir = installDirOf(),
    template,
    packaged,
    platform = process.platform,
    library,
    ops,
    checkpoint = async () => {},
    isRunning = null,
    alive = processAlive,
    quitTimeoutMs = QUIT_TIMEOUT_MS,
    pollMs = 200,
    log = () => {},
    randomId = randomUUID,
    now = () => new Date(),
    daemonHost = () => null,
    releaseDaemon = async () => false,
  }) {
    Object.assign(this, { home, installDir, template, packaged, platform, library, ops, checkpoint, alive, quitTimeoutMs, pollMs, log, randomId, now, daemonHost, releaseDaemon });
    this.isRunning = isRunning ?? ((record) => runningPid(this.home, record.installId, this.alive));
    /** artifactId → the call of it under way (calls of one artifact run one after the other). */
    this.chains = new Map();
    /** artifactId → what this process is doing with its app now (`installing`, `uninstalling`, `refreshing`). */
    this.busy = new Map();
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

  /** Runs `run` with `artifactId` marked busy with `task` (what `state` says meanwhile). */
  async doing(artifactId, task, run) {
    this.busy.set(artifactId, task);
    try {
      return await run();
    } finally {
      this.busy.delete(artifactId);
    }
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

  writeRecordSync(record) {
    writeJsonAtomicSync(recordPathOf(this.home, record.installId), record);
  }

  /** Removes the record (and with `data`, the app's own folder; with `defaults`, its bundle id's preferences). */
  forget(record, { data = false, defaults = false } = {}) {
    try {
      unlinkSync(recordPathOf(this.home, record.installId));
    } catch {
      // Gone already.
    }
    this.forgetTemps(record);
    if (defaults && record.bundleId) this.ops.forgetDefaults?.(record.bundleId);
    if (data) rmSync(artifactAppDir(this.home, record.installId), { recursive: true, force: true });
  }

  /** The record's own leftovers of a cut-short write (`<installId>.json.<pid>.tmp`). */
  forgetTemps(record) {
    const dir = recordsDirOf(this.home);
    try {
      for (const name of readdirSync(dir)) if (name.startsWith(`${record.installId}.json.`) && name.endsWith('.tmp')) rmSync(join(dir, name), { force: true });
    } catch {
      // No folder.
    }
  }

  /** Whether the package at `path` is the record's: its `artifact-app.json` names the record's install. */
  isOurs(path, record) {
    if (!path || !this.ops.exists(path)) return false;
    return manifestNames(this.ops.readManifest(path), record);
  }

  /**
   * Whether the home's daemon lives in the package at `bundlePath`: any path it runs from (`daemonHost().paths`) is
   * inside it (compared as real paths when they are there, else as written: a package gone from there still counts),
   * or the app that started it says it is that install (`installId`, its marker's).
   */
  async daemonInside(bundlePath, installId = null) {
    if (!bundlePath) return false;
    let host = null;
    try {
      host = await this.daemonHost();
    } catch (error) {
      this.log(`installed apps: where the daemon lives: ${error?.message ?? error}`);
    }
    if (!host) return false;
    if (installId && host.marker?.installId === installId) return true;
    return (host.paths ?? []).some((path) => pathWithin(path, bundlePath));
  }

  /**
   * Before `record`'s package is moved or removed: true when the daemon does not live in it, or it was restarted from
   * elsewhere (`releaseDaemon`) and lives in it no more; false otherwise (`release: false`: never restarted).
   */
  async freeOfDaemon(record, { release = true } = {}) {
    if (!(await this.daemonInside(record.bundlePath, record.installId))) return true;
    if (!release) return false;
    this.log(`installed apps: ${record.artifactId} ${record.installId}: the daemon runs from ${record.bundlePath}; restarted from elsewhere first`);
    let released = false;
    try {
      released = (await this.releaseDaemon()) === true;
    } catch (error) {
      this.log(`installed apps: ${record.artifactId} ${record.installId}: restarting the daemon: ${error?.message ?? error}`);
    }
    if (released && !(await this.daemonInside(record.bundlePath, record.installId))) return true;
    this.log(`installed apps: ${record.artifactId} ${record.installId}: the daemon still runs from ${record.bundlePath}${released ? ' after its restart' : ' (not restarted)'}; left as it is`);
    return false;
  }

  /** Removes the rebuild's packages of `record` left in the staging folder (only those that are its own). */
  removeStaged(record, { old = true } = {}) {
    for (const path of [newBundleOf(this.installDir, record.installId), ...(old ? [oldBundleOf(this.installDir, record.installId)] : [])]) {
      if (this.ops.exists(path) && this.isOurs(path, record)) this.ops.remove(path);
    }
  }

  /** The desktop app's package now, when this is one (a record's `templatePath` follows it). */
  templateNow() {
    return this.packaged && this.template?.bundlePath ? this.template.bundlePath : null;
  }

  /**
   * Puts right what calls of `artifactId` that were cut short left, follows packages renamed or removed in the
   * Finder, and the desktop app's own package. Answers `{ verdicts }`: per record what was done (`committed`,
   * `cleaned`, `forgotten`, `claimed`, `restored`, `refreshed`, `ok`, `repair`). Only within the artifact's turn
   * (`serial`), so never while a call of it runs here.
   */
  reconcileOne(artifactId) {
    const verdicts = [];
    for (const record of this.recordsOf(artifactId)) {
      let verdict;
      try {
        verdict = this.reconcileRecord(record);
      } catch (error) {
        verdict = { action: 'repair', reason: 'reconcile', detail: String(error?.message ?? error) };
      }
      verdicts.push({ installId: record.installId, ...verdict });
      if (verdict.action !== 'ok') this.log(`installed apps: ${artifactId} ${record.installId}: ${verdict.action}${verdict.reason ? ` (${verdict.reason})` : ''}${verdict.detail ? `: ${verdict.detail}` : ''}`);
    }
    return verdicts;
  }

  reconcileRecord(record) {
    switch (record.phase) {
      case 'installing':
        return this.reconcileInstalling(record);
      case 'installed':
        return this.reconcileInstalled(record);
      case 'uninstalling':
        return this.reconcileUninstalling(record);
      case 'refreshing':
        return this.reconcileRefreshing(record);
      default:
        return { action: 'repair', reason: 'phase' };
    }
  }

  reconcileInstalling(record) {
    // The package reached its place: committed when it is the record's and its signature checks.
    if (this.isOurs(record.bundlePath, record)) {
      if (!this.ops.verify(record.bundlePath)) return { action: 'repair', reason: 'signature' };
      const done = { ...record, phase: 'installed', installedAt: record.installedAt ?? this.now().toISOString() };
      delete done.tempPath;
      this.writeRecordSync(done);
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

  reconcileInstalled(record) {
    if (!this.ops.exists(record.bundlePath)) {
      // Renamed in the install folder: exactly one package there names the record, and its signature checks.
      const found = packagesOf(record, this.installDir, (path) => this.ops.readManifest(path));
      if (found.length > 1) return { action: 'repair', reason: 'duplicates', detail: found.join(', ') };
      if (found.length === 1) {
        if (!this.ops.verify(found[0])) return { action: 'repair', reason: 'signature', detail: found[0] };
        const claimed = claimPackage(record, found[0]);
        this.log(`installed apps: ${record.artifactId} ${record.installId}: ${record.bundlePath} is now ${claimed.bundlePath}`);
        this.followTemplate(claimed);
        return { action: 'claimed', bundlePath: claimed.bundlePath };
      }
      // Gone from the install folder (to the Trash, or moved out of it: the app then says to move it back): the record
      // is kept, and "needs repair" says so (Repair builds it again in its place; Remove Record forgets it).
      return { action: 'repair', reason: 'missing' };
    }
    if (!this.isOurs(record.bundlePath, record)) return { action: 'repair', reason: 'replaced' };
    this.followTemplate(record);
    return { action: 'ok' };
  }

  /** The record names the desktop app running now (`templatePath`), when this is a package and it moved. */
  followTemplate(record) {
    const now = this.templateNow();
    if (!now || record.templatePath === now) return record;
    const moved = { ...record, templatePath: now };
    this.writeRecordSync(moved);
    this.log(`installed apps: ${record.artifactId} ${record.installId}: the desktop app is now ${now} (was ${record.templatePath ?? 'none'})`);
    return moved;
  }

  reconcileUninstalling(record) {
    // Its package still the record's: the uninstall did not get that far; the app stays installed.
    if (this.isOurs(record.bundlePath, record)) {
      const back = { ...record, phase: 'installed' };
      delete back.before;
      delete back.uninstallAskedAt;
      this.writeRecordSync(back);
      return { action: 'restored' };
    }
    // The package went (to the Trash): the rest of the uninstall.
    this.forget(record, { data: true, defaults: true });
    return { action: 'cleaned' };
  }

  reconcileRefreshing(record) {
    const fresh = newBundleOf(this.installDir, record.installId);
    const old = oldBundleOf(this.installDir, record.installId);
    const oursAt = (path) => this.isOurs(path, record);
    if (this.ops.exists(record.bundlePath)) {
      if (!oursAt(record.bundlePath)) {
        this.removeStaged(record, { old: false });
        return { action: 'repair', reason: 'replaced' };
      }
      // Swapped (the old one aside in staging, or already removed: the package in place is the new version and
      // checks): the old one goes, and the rebuild is committed.
      const swapped = oursAt(old) || (this.ops.readManifest(record.bundlePath)?.templateVersion === record.targetVersion && !this.ops.exists(fresh));
      if (swapped) {
        if (!this.ops.verify(record.bundlePath)) return { action: 'repair', reason: 'signature' };
        this.removeStaged(record);
        this.commitRebuild(record, record.bundlePath);
        return { action: 'refreshed' };
      }
      // Not swapped: the package in place is the one there was; the new one goes.
      this.removeStaged(record);
      this.writeRecordSync(this.unrebuilt(record));
      return { action: 'restored' };
    }
    if (oursAt(old)) {
      // Cut short between the two renames: the old package back in its place.
      this.ops.place(old, record.bundlePath);
      this.removeStaged(record);
      this.writeRecordSync(this.unrebuilt(record));
      return { action: 'restored' };
    }
    if (oursAt(fresh) && this.ops.verify(fresh)) {
      // A repair of a package that was gone: the new one, built and checked, goes in.
      this.ops.place(fresh, record.bundlePath);
      this.commitRebuild(record, record.bundlePath);
      return { action: 'refreshed' };
    }
    // Nothing anywhere: as it was before (a package that is missing, which "needs repair" says).
    this.removeStaged(record);
    this.writeRecordSync(this.unrebuilt(record));
    return { action: 'restored' };
  }

  /** The record as it was before a rebuild (its phase back to `installed`). */
  unrebuilt(record) {
    const back = { ...record, phase: 'installed' };
    delete back.targetVersion;
    delete back.tempPath;
    return back;
  }

  /** A rebuild's commit: `installed`, with the version the package in place says it is. */
  commitRebuild(record, path) {
    const manifest = this.ops.readManifest(path);
    const done = { ...this.unrebuilt(record), templateVersion: manifest?.templateVersion ?? record.targetVersion ?? record.templateVersion, refreshedAt: this.now().toISOString() };
    if (!done.installedAt) done.installedAt = done.refreshedAt;
    const template = this.templateNow();
    if (template) done.templatePath = template;
    this.writeRecordSync(done);
    this.forgetTemps(record);
    return done;
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

  stale(record) {
    return record.templateVersion !== this.template.version();
  }

  installedState(record) {
    return { state: 'installed', installId: record.installId, displayName: record.displayName, bundlePath: record.bundlePath, stale: this.stale(record), running: !!this.isRunning(record) };
  }

  /** The state of `artifactId`'s app (see the module comment), worked out now. */
  state(artifactId) {
    // While this process works on it, at once (not after the work).
    const now = this.busyState(artifactId);
    if (now) return Promise.resolve(now);
    return this.serial(artifactId, () => this.stateNow(artifactId));
  }

  busyState(artifactId) {
    const task = this.busy.get(artifactId);
    if (!task) return null;
    return task === 'installing' ? { state: 'installing' } : { state: 'busy', task };
  }

  async stateNow(artifactId) {
    const busy = this.busyState(artifactId);
    if (busy) return busy;
    const verdicts = this.reconcileOne(artifactId);
    const repair = verdicts.find((verdict) => verdict.action === 'repair');
    if (repair) return { state: 'needsRepair', installId: repair.installId, reason: repair.reason, repairable: !NOT_REPAIRABLE.has(repair.reason) };
    const record = this.recordsOf(artifactId).find((entry) => entry.phase === 'installed');
    if (record) return this.installedState(record);
    const support = await this.support(artifactId);
    if (!support.ok) return { state: 'unavailable', reason: support.reason };
    const needsCopy = !this.ops.sameVolume(this.template.bundlePath, this.installDir);
    return {
      state: 'available',
      suggestedName: this.suggestedName(support.artifact, support.type),
      needsCopy,
      installDir: this.installDir,
      ...(needsCopy ? { copyBytes: this.ops.sizeOf?.(this.template.bundlePath) ?? null } : {}),
    };
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
      this.busy.set(artifactId, 'installing');
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
      return { state: { state: 'available', suggestedName: name, needsCopy: true, installDir: this.installDir, copyBytes: this.ops.sizeOf?.(this.template.bundlePath) ?? null }, launch: 'skipped', needsCopy: true };
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
      // (3, 4) The package, in the staging folder, signed and checked.
      await this.build(record, record.tempPath, { clone, name, templateVersion: record.templateVersion, step: (at) => this.checkpoint(at === 'cloned' ? 'cloned' : at) });
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

  /**
   * A package of `record` at `dest` (in the staging folder): the template cloned (or copied), its quarantine removed,
   * `Info.plist`, the icon and `artifact-app.json` written (`name`, `templateVersion`), signed ad hoc and checked.
   * `step(name)` is awaited after the copy (`cloned`).
   */
  async build(record, dest, { clone, name, templateVersion, step = async () => {} }) {
    this.ops.copyBundle(this.template.bundlePath, dest, { clone });
    await step('cloned');
    this.ops.clearQuarantine(dest);
    this.ops.editInfoPlist(dest, infoPlistEdits({ displayName: name, bundleId: record.bundleId }));
    this.ops.writeIcon(dest, record.artifactType, ICON_FILE);
    this.ops.writeManifest(dest, manifestOf({ ...record, templateVersion }));
    this.ops.sign(dest);
    if (!this.ops.verify(dest)) throw new Error('the signature of the new package does not check');
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
    return this.serial(artifactId, async () => {
      this.reconcileOne(artifactId);
      return { launch: await this.launchRecord(this.installedRecord(artifactId, installId)) };
    });
  }

  /** The package of the app of `artifactId` that is `installId` (to show in the Finder). */
  revealPath(artifactId, installId) {
    return this.serial(artifactId, async () => {
      this.reconcileOne(artifactId);
      return this.installedRecord(artifactId, installId).bundlePath;
    });
  }

  /** Waits for the app of `record` to end (`pid`: the process seen running): true once it did, false at the timeout. */
  async waitQuit(record, pid, timeoutMs = this.quitTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let seen = pid;
    for (;;) {
      seen = seen ?? this.isRunning(record);
      if (!seen || !this.alive(seen)) {
        // That process ended; another start of the app since would have written its own pid.
        const again = this.isRunning(record);
        if (!again || again === seen) return true;
        seen = again;
      }
      if (Date.now() > deadline) return false;
      await sleep(this.pollMs);
    }
  }

  /**
   * Uninstalls the app of `artifactId` that is `installId` (see the module comment). Idempotent: no such record,
   * `{ removed: false }`. Answers `{ state, removed, stillRunning?, left? }`: `stillRunning`, the app did not quit
   * (the record is as it was); `left: 'not-ours'`, what is at the app's place is not its package and was left there.
   */
  uninstall(artifactId, installId) {
    return this.serial(artifactId, async () => {
      this.reconcileOne(artifactId);
      const record = this.recordsOf(artifactId).find((entry) => entry.installId === installId);
      if (!record) return { state: await this.stateNow(artifactId), removed: false };
      const out = await this.doing(artifactId, 'uninstalling', () => this.uninstallNow(record));
      return { ...out, state: await this.stateNow(artifactId) };
    });
  }

  async uninstallNow(record) {
    const { artifactId, installId } = record;
    // (1) The record says so: the app, when it runs, quits by itself. `uninstallAskedAt` tells one ask from the next (the
    // app reads the record once a second, and may never see the `installed` between an ask given up and the next).
    const asked = { ...record, phase: 'uninstalling', before: record.phase, uninstallAskedAt: this.now().toISOString() };
    this.writeRecordSync(asked);
    await this.checkpoint('uninstall-recorded');
    // (2) Its app quits (its unsaved work saved or let go, as the person says): waited for.
    const pid = this.isRunning(record);
    if (pid) {
      this.log(`installed apps: ${artifactId} ${installId}: the app runs (pid ${pid}); asked to quit`);
      if (!(await this.waitQuit(record, pid))) {
        this.writeRecordSync(record);
        this.log(`installed apps: ${artifactId} ${installId}: the app did not quit in ${this.quitTimeoutMs} ms; not uninstalled`);
        return { removed: false, stillRunning: true };
      }
    }
    await this.checkpoint('uninstall-quit');
    // (3) The daemon running from this package is restarted from elsewhere first; when it cannot be, the record as it was.
    if (this.isOurs(record.bundlePath, record) && !(await this.freeOfDaemon(record))) {
      this.writeRecordSync(record);
      return { removed: false, daemonInUse: true };
    }
    // (4) The package to the Trash, only when it is the record's. A Trash that fails: the record as it was.
    let left = null;
    try {
      if (this.isOurs(record.bundlePath, record)) {
        await this.ops.trash(record.bundlePath);
      } else if (this.ops.exists(record.bundlePath)) {
        left = 'not-ours';
        this.log(`installed apps: ${artifactId} ${installId}: ${record.bundlePath} is not this app's package; left where it is`);
      }
    } catch (error) {
      this.log(`installed apps: ${artifactId} ${installId}: to the Trash: ${error?.message ?? error}; not uninstalled`);
      if (this.isOurs(record.bundlePath, record)) this.writeRecordSync(record);
      return { removed: false, error: String(error?.message ?? error) };
    }
    this.removeStaged(record);
    await this.checkpoint('uninstall-trashed');
    // (5, 6) Its preferences, its record and its own folder.
    this.forget(record, { data: true, defaults: true });
    this.log(`installed apps: ${artifactId} ${installId}: uninstalled${left ? ` (${left})` : ''}`);
    return { removed: true, ...(left ? { left } : {}) };
  }

  /**
   * Forgets the record of `artifactId` that is `installId` without touching what is at its place ("Remove Record":
   * the place holds something that is not its package). Its own staging leftovers, its folder and its preferences go.
   */
  forgetRecord(artifactId, installId) {
    return this.serial(artifactId, async () => {
      const record = this.recordsOf(artifactId).find((entry) => entry.installId === installId);
      if (!record) return { state: await this.stateNow(artifactId), removed: false };
      if (this.isRunning(record)) return { state: await this.stateNow(artifactId), removed: false, stillRunning: true };
      this.removeStaged(record);
      this.forget(record, { data: true, defaults: true });
      this.log(`installed apps: ${artifactId} ${installId}: record removed (the package place left as it is)`);
      return { state: await this.stateNow(artifactId), removed: true };
    });
  }

  /** Rebuilds the installed app of `artifactId` that is `installId` with this desktop app (see the module comment). */
  refresh(artifactId, installId, { allowCopy = false, releaseDaemon = true } = {}) {
    return this.serial(artifactId, async () => {
      const now = await this.stateNow(artifactId);
      const record = this.recordsOf(artifactId).find((entry) => entry.installId === installId);
      if (!record || record.phase !== 'installed' || now.state !== 'installed') return { state: now, rebuilt: false };
      return this.rebuildThen(artifactId, record, { allowCopy, releaseDaemon });
    });
  }

  /** Repairs the app of `artifactId` that is `installId`: a rebuild, when its place holds its own package or nothing. */
  repair(artifactId, installId, { allowCopy = false } = {}) {
    return this.serial(artifactId, async () => {
      const now = await this.stateNow(artifactId);
      const record = this.recordsOf(artifactId).find((entry) => entry.installId === installId);
      if (!record || now.state !== 'needsRepair' || now.installId !== installId) return { state: now, rebuilt: false };
      if (!now.repairable) return { state: now, rebuilt: false, notOurs: true };
      return this.rebuildThen(artifactId, record, { allowCopy });
    });
  }

  async rebuildThen(artifactId, record, options) {
    if (!this.packaged || !this.template?.bundlePath) return { state: { state: 'unavailable', reason: 'not-packaged' }, rebuilt: false };
    const out = await this.doing(artifactId, 'refreshing', () => this.rebuild(record, options));
    return { ...out, state: await this.stateNow(artifactId) };
  }

  /**
   * The rebuild itself (see the module comment). Answers `{ rebuilt, stillRunning?, needsCopy?, daemonInUse?, error? }`;
   * whatever happens, the record ends `installed` (the package that was there, or the new one) or as reconcile leaves
   * it. `releaseDaemon: false`: a daemon running from the package is never restarted (the rebuild is given up).
   */
  async rebuild(record, { allowCopy = false, releaseDaemon = true } = {}) {
    const { artifactId, installId } = record;
    if (this.isRunning(record)) return { rebuilt: false, stillRunning: true };
    const staging = stagingDirOf(this.installDir);
    const fresh = newBundleOf(this.installDir, installId);
    const old = oldBundleOf(this.installDir, installId);
    this.ops.prepareDir(staging);
    // A leftover of an earlier rebuild of its own (reconcile put the package in place right already).
    this.removeStaged(record);
    if (this.ops.exists(fresh) || this.ops.exists(old)) return { rebuilt: false, error: `the staging folder holds ${basename(fresh)} or ${basename(old)} that is not this app's` };
    const clone = this.ops.canClone(this.template.bundlePath, staging);
    // A package first installed as a clone is not made a 260 MB copy without being asked.
    if (!clone && record.cloned !== false && !allowCopy) return { rebuilt: false, needsCopy: true };
    const targetVersion = this.template.version();
    const working = { ...record, phase: 'refreshing', targetVersion };
    delete working.tempPath;
    this.writeRecordSync(working);
    await this.checkpoint('rebuild-recorded');
    const started = Date.now();
    try {
      await this.build(working, fresh, { clone, name: record.displayName, templateVersion: targetVersion });
      await this.checkpoint('rebuild-built');
      // Asked again: the app may have been opened meanwhile.
      if (this.isRunning(record)) {
        this.ops.remove(fresh);
        this.writeRecordSync(this.unrebuilt(working));
        return { rebuilt: false, stillRunning: true };
      }
      // Only its own package is moved aside (and then removed): anything else at its place is left, and so is the record.
      if (this.ops.exists(record.bundlePath) && !this.isOurs(record.bundlePath, record)) {
        this.ops.remove(fresh);
        this.writeRecordSync(record);
        this.log(`installed apps: ${artifactId} ${installId}: ${record.bundlePath} is not this app's package; not rebuilt`);
        return { rebuilt: false, notOurs: true };
      }
      // The daemon running from the package in place is restarted from elsewhere first; when it cannot be, as it was.
      if (!(await this.freeOfDaemon(record, { release: releaseDaemon }))) {
        this.ops.remove(fresh);
        this.writeRecordSync(this.unrebuilt(working));
        return { rebuilt: false, daemonInUse: true };
      }
      if (this.ops.exists(record.bundlePath)) {
        this.ops.moveAside(record.bundlePath, old);
        await this.checkpoint('rebuild-aside');
      }
      this.ops.place(fresh, record.bundlePath);
      await this.checkpoint('rebuild-placed');
      if (this.ops.exists(old)) this.ops.remove(old);
      await this.checkpoint('rebuild-removed');
    } catch (error) {
      this.log(`installed apps: ${artifactId} ${installId}: rebuild failed: ${error?.message ?? error}`);
      // Back to the package there was: put back when it was moved aside, the new one removed.
      try {
        if (!this.ops.exists(record.bundlePath) && this.isOurs(old, record)) this.ops.place(old, record.bundlePath);
        this.removeStaged(record);
        if (this.isOurs(record.bundlePath, record) || !this.ops.exists(record.bundlePath)) this.writeRecordSync(record);
      } catch (undo) {
        this.log(`installed apps: ${artifactId} ${installId}: undo after the failed rebuild: ${undo?.message ?? undo}; left to reconcile`);
      }
      return { rebuilt: false, error: String(error?.message ?? error) };
    }
    const done = { ...this.unrebuilt(working), templateVersion: targetVersion, cloned: clone, refreshedAt: this.now().toISOString() };
    if (!done.installedAt) done.installedAt = done.refreshedAt;
    done.templatePath = this.template.bundlePath;
    await this.writeRecord(done, () => this.checkpoint('rebuild-committing'));
    this.forgetTemps(record);
    this.log(`installed apps: ${artifactId} ${installId}: rebuilt ${JSON.stringify({ bundlePath: done.bundlePath, templateVersion: targetVersion, cloned: clone, ms: Date.now() - started })}`);
    return { rebuilt: true };
  }

  /**
   * Refreshes, one after the other, every installed app of this home whose desktop app changed since (`stale`) and
   * that does not run now (at start, after `reconcileAll`). A running one is left for the next start (or its dialog's
   * Update); so is one the home's daemon runs from (`daemon-in-use`: the shared daemon is never restarted by itself,
   * the agents' pages may hold unsaved work). Answers `{ [installId]: outcome }`.
   */
  async refreshStale() {
    const out = {};
    if (!this.packaged || !this.template?.bundlePath) return out;
    for (const { record } of readRecords(this.home)) {
      if (record.phase !== 'installed' || !this.stale(record)) continue;
      if (this.isRunning(record)) {
        out[record.installId] = 'running';
        this.log(`installed apps: ${record.artifactId} ${record.installId}: stale, but it runs: refreshed later`);
        continue;
      }
      if (await this.daemonInside(record.bundlePath, record.installId)) {
        out[record.installId] = 'daemon-in-use';
        this.log(`installed apps: ${record.artifactId} ${record.installId}: stale, but the daemon runs from it: left for its Update`);
        continue;
      }
      const result = await this.refresh(record.artifactId, record.installId, { releaseDaemon: false }).catch((error) => ({ error: String(error?.message ?? error) }));
      out[record.installId] = result.rebuilt ? 'refreshed' : result.stillRunning ? 'running' : result.needsCopy ? 'needs-copy' : result.daemonInUse ? 'daemon-in-use' : (result.error ?? 'not refreshed');
    }
    return out;
  }
}
