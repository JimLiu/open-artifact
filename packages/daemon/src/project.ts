/**
 * The project a session works in, and where that project's artifacts go under the person's Open Artifact folder.
 *
 * A session's workspace is just its working folder: a session started in `repo/packages/app`, or in a worktree of
 * `repo`, still works on `repo`. The project is what settings, the folder name under the Open Artifact folder and
 * "this project's artifacts" go by.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PROJECT_SETTINGS_FILE } from '@open-artifact/protocol';
import { files, readJson, samePath, writeJson } from './paths.ts';
import { slugify } from './store.ts';

/** The project of a workspace. */
export interface ProjectInfo {
  /**
   * The project's identity (absolute): its folder, or for a worktree the same folder of the repository's main
   * working tree, so every worktree of a repository is one project.
   */
  project: string;
  /** The project's folder in this checkout: where its settings file is, else the repository's top, else the workspace. */
  dir: string;
  /** The folder that holds the project's settings file ({@link PROJECT_SETTINGS_FILE}), when there is one. */
  configDir: string | null;
  /** The top of the Git checkout the workspace is in (a working tree or a worktree), when it is in one. */
  gitRoot: string | null;
}

/** The marker of a project's folder under the Open Artifact folder: which project it holds. */
export const HOME_PROJECT_MARKER = '.open-artifact-project.json';

/** Most folders walked up from a workspace. */
const MAX_DEPTH = 64;

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * The main working tree of the repository whose worktree is at `top` (its `.git` is a file), or `null`: `top` is a
 * main working tree, a submodule (no `commondir`), a worktree of a bare repository, or its files are not as expected.
 * Reads the files only; never runs `git`.
 */
function mainWorkingTree(top: string): string | null {
  try {
    const dotGit = join(top, '.git');
    if (!statSync(dotGit).isFile()) return null;
    const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))?.[1];
    if (!pointer) return null;
    const gitDir = resolve(top, pointer);
    const common = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
    if (basename(common) !== '.git') return null;
    const main = dirname(common);
    return statSync(main).isDirectory() ? main : null;
  } catch {
    return null;
  }
}

/**
 * The project of `workspace`. Walks up from it: the nearest folder with a project settings file is the project's,
 * else the top of the Git checkout, else the workspace itself. The walk ends at the checkout's top and never reaches
 * the person's home folder (whose `.agents/open-artifact/settings.json` is their own settings, not a project's); a
 * workspace in no Git checkout is looked at alone.
 */
export function projectOf(workspace: string): ProjectInfo {
  const start = resolve(workspace);
  const home = resolve(homedir());
  const own = files.settings();
  const hasConfig = (dir: string): boolean => {
    const file = join(dir, PROJECT_SETTINGS_FILE);
    return isFile(file) && !samePath(file, own);
  };
  let configDir: string | null = null;
  let gitRoot: string | null = null;
  let dir = start;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (samePath(dir, home)) break;
    if (!configDir && hasConfig(dir)) configDir = dir;
    if (existsSync(join(dir, '.git'))) {
      gitRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // No checkout bounds the walk: a settings file found in some parent folder is not this workspace's.
  if (!gitRoot && configDir !== start) configDir = null;
  const projectDir = configDir ?? gitRoot ?? start;
  const main = gitRoot ? mainWorkingTree(gitRoot) : null;
  const project = main && gitRoot ? resolve(main, relative(gitRoot, projectDir)) : projectDir;
  return { project, dir: projectDir, configDir, gitRoot };
}

/** A project path as a settings key names it (`~` expanded), resolved. */
export function projectPath(key: string): string | null {
  const text = key.trim();
  if (!text) return null;
  const full = text === '~' ? homedir() : text.startsWith('~/') || text.startsWith(`~${sep}`) ? join(homedir(), text.slice(2)) : text;
  return isAbsolute(full) ? resolve(full) : null;
}

/** Compares project paths with {@link samePath}, remembering each path's answer (a listing asks once per artifact). */
export function projectMatcher(project: string | null): (other: string | null | undefined) => boolean {
  if (!project) return () => false;
  const known = new Map<string, boolean>();
  return (other) => {
    if (!other) return false;
    let same = known.get(other);
    if (same === undefined) {
      same = resolve(other) === resolve(project) || samePath(other, project);
      known.set(other, same);
    }
    return same;
  };
}

const empty = (dir: string): boolean => {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
};

/**
 * The folder of `project`'s artifacts under the Open Artifact folder `homeWorkspace`, made when it is not there:
 * `<homeWorkspace>/<name>`, where `name` is the project folder's own name as a slug. A folder says which project it
 * holds in {@link HOME_PROJECT_MARKER}; when the name is taken by another project (or is one of `reserved`, or a
 * folder that is not empty and says nothing), a few digits of the path's hash are added: the same project always
 * gets the same folder, with no table to keep.
 */
export function homeProjectDir(homeWorkspace: string, project: string, reserved: string[] = []): string {
  const base = resolve(homeWorkspace);
  const name = slugify(basename(resolve(project)));
  const hash = createHash('sha256').update(resolve(project)).digest('hex');
  const kept = new Set(reserved.map((entry) => entry.toLowerCase()));
  const candidates = [name, `${name}-${hash.slice(0, 4)}`, `${name}-${hash.slice(0, 8)}`, `${name}-${hash.slice(0, 16)}`, `${name}-${hash}`];
  for (const candidate of candidates) {
    if (candidate === name && kept.has(candidate)) continue;
    const dir = join(base, candidate);
    const marker = join(dir, HOME_PROJECT_MARKER);
    const held = readJson<{ project?: unknown } | null>(marker, null);
    if (held && typeof held.project === 'string') {
      if (samePath(held.project, project)) return dir;
      continue;
    }
    if (existsSync(dir) && !empty(dir)) continue;
    mkdirSync(dir, { recursive: true });
    writeJson(marker, { project: resolve(project) });
    return dir;
  }
  // Every candidate is another project's (a full hash collision): not reachable in practice.
  return join(base, candidates[candidates.length - 1]!);
}
