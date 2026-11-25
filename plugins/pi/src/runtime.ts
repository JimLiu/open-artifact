/**
 * The Open Artifact runtime this package carries: the `@open-artifact/cli` dependency when installed from npm, else,
 * inside the Open Artifact repository, the skill folder `node scripts/build-plugins.mjs` builds. The kit starts the
 * newest compatible runtime on this computer when no daemon runs; this one is a candidate.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeInfo } from '@open-artifact/harness-kit';

/** Where a runtime may be, best first. */
export function runtimeFolders(from: string = import.meta.url): string[] {
  const folders: string[] = [];
  try {
    folders.push(dirname(createRequire(from).resolve('@open-artifact/cli/package.json')));
  } catch {
    // not installed
  }
  for (let dir = dirname(fileURLToPath(from)); dir !== dirname(dir); dir = dirname(dir)) {
    const skill = join(dir, 'skills', 'open-artifact');
    if (existsSync(join(skill, 'SKILL.md'))) {
      folders.push(skill);
      break;
    }
  }
  return folders;
}

/**
 * The runtime as `createHarness({ runtime })` takes it, or `undefined` when there is none here: then the kit starts
 * `$OPEN_ARTIFACT_DAEMON_BIN`, or another runtime on this computer, and fails with its own message when there is none.
 */
export function hostRuntime(folders: string[] = runtimeFolders()): { dir: string; version: string } | undefined {
  for (const dir of folders) {
    const version = runtimeInfo(dir)?.version;
    if (version) return { dir, version };
  }
  return undefined;
}
