/**
 * A fake npm registry on 127.0.0.1 for the runtime update tests (the daemon's own fixture, runtime-fixtures.ts), and a
 * tarball of a newer runtime that really runs: a copy of the runtime this app carries with its version raised. The
 * daemon switches to a newer runtime by itself once nothing is open, so a tarball that only looked like a runtime would
 * leave the app with a daemon that never starts.
 *
 * No test reaches the real registry: `cleanEnv` points OPEN_ARTIFACT_REGISTRY at a closed loopback port by default.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME } from './env.mjs';

export { startRegistry } from '../../../../packages/daemon/test/runtime-fixtures.ts';

/** The version of the runtime this app carries. */
export const CARRIED = JSON.parse(readFileSync(join(RUNTIME, 'package.json'), 'utf8')).version;

/** A gzipped npm tarball (`package/…`) of the carried runtime, saying `version` everywhere it says its own. */
export function runtimeTarballOf(version, scratch) {
  const work = mkdtempSync(join(scratch, 'runtime-'));
  const pkg = join(work, 'package');
  try {
    cpSync(RUNTIME, pkg, { recursive: true, verbatimSymlinks: true });
    const swap = (file) => writeFileSync(file, readFileSync(file, 'utf8').replaceAll(`"${CARRIED}"`, `"${version}"`));
    swap(join(pkg, 'package.json'));
    swap(join(pkg, 'vendor', 'runtime.json'));
    swap(join(pkg, 'vendor', 'open-artifact.mjs'));
    const out = join(work, 'package.tgz');
    // No macOS metadata (AppleDouble files, extended attributes) in the archive.
    execFileSync('/usr/bin/tar', ['--no-mac-metadata', '--no-xattrs', '-czf', out, '-C', work, 'package'], { env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' } });
    return readFileSync(out);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
