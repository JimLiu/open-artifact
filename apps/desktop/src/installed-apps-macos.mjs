/**
 * What "install as app" does to packages on macOS (the `ops` of `installed-apps.mjs`). Every command is run with its
 * arguments as a list (no shell): `/bin/cp -Rc` (an APFS clone), `/usr/bin/ditto` (a plain copy, only when asked),
 * `/usr/bin/xattr`, `/usr/bin/plutil`, `/usr/bin/codesign`.
 *
 * Nothing is written or removed outside the install folder, and the install folder must be inside the account's home
 * (`os.homedir()`, which reads HOME): both are checked on real paths before every write. In test mode the home must
 * not be the account's own (a test runs with a HOME of its own), and nothing is opened: `launch` answers `skipped` and
 * only logs. The desktop app never registers itself or its copies with Launch Services from here; the system does,
 * when the Finder or `open` first sees a package.
 *
 * Signing: ad hoc, the outer package only (`codesign --force --sign -`, no `--deep`): the frameworks and helpers inside
 * keep the desktop app's signatures, which the copy leaves as they were; then `codesign --verify --strict`.
 */
import { execFile, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ARTIFACT_APP_FILE } from './profile.mjs';

const resources = (bundle) => join(bundle, 'Contents', 'Resources');
/** The bundle id of an app made by "install as app": the prefix and an install id (a UUID), nothing else. */
const APP_BUNDLE_ID = /^dev\.openartifact\.app\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The nearest folder of `path` (itself included) that exists, as a real path. */
function nearestReal(path) {
  let at = path;
  for (;;) {
    try {
      return realpathSync(at);
    } catch {
      const up = dirname(at);
      if (up === at) return null;
      at = up;
    }
  }
}

/** `path` as a real path: its nearest existing folder's real path, and what is left of it (which may not exist yet). */
function realish(path) {
  const near = nearestReal(path);
  if (!near) return null;
  let at = path;
  const tail = [];
  while (nearestReal(at) !== near || !existsSync(at)) {
    tail.unshift(basename(at));
    at = dirname(at);
  }
  return join(near, ...tail);
}

/** Whether `inner` is strictly inside `outer` (both real paths). */
const within = (outer, inner) => {
  const rel = relative(outer, inner);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..');
};

/**
 * The ops for `installDir`. `iconsDir`: the type icons the desktop app carries (`<type>.icns`, `default.icns`);
 * `testMode`; `log`; `userHome` (default `os.homedir()`); `accountHome` (default `userInfo().homedir`).
 */
export function macosOps({ installDir, iconsDir, testMode = false, log = () => {}, userHome = homedir(), accountHome = userInfo().homedir, trashItem = null }) {
  /** Throws unless `path` (to be written or removed) is inside the install folder, inside the home. */
  const guard = (path, what) => {
    const home = nearestReal(userHome);
    const dir = realish(installDir);
    const at = realish(path);
    if (!home || !dir || !at) throw new Error(`${what}: no home or install folder`);
    if (testMode && accountHome && home === nearestReal(accountHome)) throw new Error(`${what}: refused: a test must run with a HOME of its own, not ${accountHome}`);
    if (!within(home, dir)) throw new Error(`${what}: refused: the install folder ${installDir} is not inside the home ${userHome}`);
    // The path itself may not exist yet; as a real path it must be inside the install folder.
    if (!within(dir, at)) throw new Error(`${what}: refused: ${path} is not inside ${installDir}`);
  };
  const run = (file, args) => execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  return {
    installDir,
    exists: (path) => existsSync(path),

    /** The `artifact-app.json` a package carries, or null. */
    readManifest(bundle) {
      try {
        return JSON.parse(readFileSync(join(resources(bundle), ARTIFACT_APP_FILE), 'utf8'));
      } catch {
        return null;
      }
    },

    /** The install folder and its staging folder, made when missing. */
    prepareDir(staging) {
      guard(staging, 'prepare');
      mkdirSync(staging, { recursive: true });
    },

    /** Whether the template and the install folder are on one volume (a clone is likely; `canClone` makes sure). */
    sameVolume(template, dir) {
      const there = nearestReal(dir);
      try {
        return !!there && statSync(template).dev === statSync(there).dev;
      } catch {
        return false;
      }
    },

    /**
     * Whether the template clones into `staging`: one volume, and that volume APFS (`df -P` names its mount point,
     * `mount` its file system). `cp -c` would copy without a word where it cannot clone, so this is asked first.
     */
    canClone(template, staging) {
      guard(staging, 'probe');
      if (!this.sameVolume(template, staging)) return false;
      try {
        const lines = String(execFileSync('/bin/df', ['-P', nearestReal(staging)], { encoding: 'utf8' })).trim().split('\n');
        const mountPoint = lines.at(-1).split(/\s+/).slice(5).join(' ');
        const mounts = String(execFileSync('/sbin/mount', [], { encoding: 'utf8' })).split('\n');
        const line = mounts.find((entry) => entry.includes(` on ${mountPoint} (`));
        return !!line && /\(apfs[,)]/.test(line);
      } catch (error) {
        log(`installed apps: probe ${staging}: ${error?.message ?? error}`);
        return false;
      }
    },

    /** The template's package copied to `dest` (which must not exist): cloned (`cp -Rc`), or copied (`ditto`). */
    copyBundle(template, dest, { clone }) {
      guard(dest, 'copy');
      if (existsSync(dest)) throw Object.assign(new Error(`${dest} exists`), { code: 'EEXIST' });
      if (clone) run('/bin/cp', ['-Rc', template, dest]);
      else run('/usr/bin/ditto', [template, dest]);
    },

    /** Removes a quarantine the copy may carry (a package copied from a download keeps it). */
    clearQuarantine(bundle) {
      guard(bundle, 'xattr');
      try {
        run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', bundle]);
      } catch (error) {
        log(`installed apps: xattr ${bundle}: ${error?.message ?? error}`);
      }
    },

    /** Applies `edits` (`infoPlistEdits`) to the package's `Info.plist` with `plutil`; every other key is kept. */
    editInfoPlist(bundle, edits) {
      const plist = join(bundle, 'Contents', 'Info.plist');
      guard(plist, 'plutil');
      for (const edit of edits) {
        if (edit.op === 'replace') run('/usr/bin/plutil', ['-replace', edit.key, `-${edit.type}`, edit.value, plist]);
        else {
          // `plutil -remove` fails when the key is not there: nothing to do then.
          try {
            run('/usr/bin/plutil', ['-remove', edit.key, plist]);
          } catch {
            // Not there.
          }
        }
      }
      run('/usr/bin/plutil', ['-lint', '-s', plist]);
    },

    /** The type's icon (else the default one) as the package's `iconFile`. */
    writeIcon(bundle, type, iconFile) {
      const dest = join(resources(bundle), iconFile);
      guard(dest, 'icon');
      const own = type && /^[a-z0-9][a-z0-9-]*$/.test(type) ? join(iconsDir, `${type}.icns`) : null;
      copyFileSync(own && existsSync(own) ? own : join(iconsDir, 'default.icns'), dest);
    },

    /** The package's `artifact-app.json`. */
    writeManifest(bundle, manifest) {
      const dest = join(resources(bundle), ARTIFACT_APP_FILE);
      guard(dest, 'manifest');
      writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
    },

    /** Signs the outer package ad hoc. */
    sign(bundle) {
      guard(bundle, 'codesign');
      run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
    },

    /** Whether the package's signature checks (`codesign --verify --strict`). */
    verify(bundle) {
      try {
        run('/usr/bin/codesign', ['--verify', '--strict', bundle]);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Moves the package from `temp` to `target`, never over anything: `target` is made as an empty folder first (it
     * fails when a file or package of that name, in any letter case, is there), then `temp` is renamed onto it (a
     * rename may replace an empty folder, nothing else).
     */
    place(temp, target) {
      guard(temp, 'place');
      guard(target, 'place');
      mkdirSync(target);
      try {
        renameSync(temp, target);
      } catch (error) {
        try {
          rmdirSync(target);
        } catch {
          // Not empty: not ours to remove.
        }
        throw error;
      }
    },

    /** Removes `path` if it is an empty folder (a place made for a package that never moved in); anything else stays. */
    removeEmpty(path) {
      guard(path, 'remove');
      try {
        rmdirSync(path);
      } catch {
        // Not there, or not empty: not ours to remove.
      }
    },

    /** Removes a package (or a staging one) of ours, inside the install folder only. */
    remove(path) {
      guard(path, 'remove');
      rmSync(path, { recursive: true, force: true });
    },

    /**
     * Moves a package of ours aside (`from` to `to`, both inside the install folder; `to` must not exist): a rebuild's
     * old package, into the staging folder, before the new one takes its place.
     */
    moveAside(from, to) {
      guard(from, 'move aside');
      guard(to, 'move aside');
      if (existsSync(to)) throw Object.assign(new Error(`${to} exists`), { code: 'EEXIST' });
      renameSync(from, to);
    },

    /**
     * A package of ours to the Trash (an uninstall): `trashItem` (Electron's `shell.trashItem`, the Finder's own
     * "Move to Trash": it can be put back). Test mode never calls it: the package, inside the test's own install
     * folder, is removed, and that is logged.
     */
    async trash(path) {
      guard(path, 'trash');
      if (testMode || !trashItem) {
        if (!testMode) throw new Error('trash: no trashItem');
        log(`installed apps: trash ${path} (test mode: removed, not moved to the Trash)`);
        rmSync(path, { recursive: true, force: true });
        return 'removed';
      }
      await trashItem(path);
      return 'trashed';
    },

    /**
     * Forgets the preferences macOS keeps for an app's bundle id (`/usr/bin/defaults delete <id>`): only an id of the
     * apps' own form (the prefix and a UUID), never a pattern; a domain that is not there is not an error. cfprefsd
     * keeps them in the account's own `~/Library/Preferences` whatever HOME says, so this runs in test mode too, for
     * the exact ids of the test's own apps.
     */
    forgetDefaults(bundleId) {
      if (!APP_BUNDLE_ID.test(String(bundleId))) {
        log(`installed apps: defaults: refused ${bundleId}`);
        return false;
      }
      try {
        execFileSync('/usr/bin/defaults', ['delete', bundleId], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },

    /** The size of a package on disk, in bytes (`du -sk`), or null. */
    sizeOf(path) {
      try {
        return Number(String(execFileSync('/usr/bin/du', ['-sk', path], { encoding: 'utf8' })).split(/\s+/)[0]) * 1024 || null;
      } catch {
        return null;
      }
    },

    /**
     * Opens the package once, as the Finder would. Test mode: only logged (`skipped`); a test starts an app's
     * executable itself.
     */
    launch(bundle) {
      if (testMode) {
        log(`installed apps: open ${bundle} (test mode: not opened)`);
        return Promise.resolve('skipped');
      }
      return new Promise((done) => {
        execFile('/usr/bin/open', [bundle], (error) => {
          if (error) log(`installed apps: open ${bundle}: ${error.message}`);
          done(error ? 'failed' : 'opened');
        });
      });
    },
  };
}

