/**
 * Where Open Artifact keeps its things. Every path can be moved with an
 * environment variable, so tests and dev checkouts never touch the real
 * home folder.
 */

import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { OpenArtifactError } from '@open-artifact/protocol';

/** Expands a leading `~` to the home folder. */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/** `~/.agents/open-artifact`, or `$OPEN_ARTIFACT_HOME`. */
export function openArtifactHome(): string {
  return resolve(expandHome(process.env.OPEN_ARTIFACT_HOME || '~/.agents/open-artifact'));
}

/** Well-known files and folders under {@link openArtifactHome}. */
export const files = {
  daemon: (): string => join(openArtifactHome(), 'daemon.json'),
  lock: (): string => join(openArtifactHome(), 'daemon.lock'),
  settings: (): string => join(openArtifactHome(), 'settings.json'),
  artifacts: (): string => join(openArtifactHome(), 'artifacts'),
  inbox: (): string => join(openArtifactHome(), 'inbox'),
  harnesses: (): string => join(openArtifactHome(), 'harnesses'),
  sessions: (): string => join(openArtifactHome(), 'sessions.json'),
  logs: (): string => join(openArtifactHome(), 'logs'),
  trash: (): string => join(openArtifactHome(), 'trash'),
  thumbnails: (): string => join(openArtifactHome(), 'thumbnails'),
  servers: (): string => join(openArtifactHome(), 'servers'),
  /** Cloud remotes and their tokens (`remotes.json`, mode 0600). */
  remotes: (): string => join(openArtifactHome(), 'remotes.json'),
  /** Install-time cloud presets for machines that cannot set environment variables (`preset.json`, read at start). */
  preset: (): string => join(openArtifactHome(), 'preset.json'),
};

/** Creates a folder (and its parents) and returns it. */
export function ensureDir(dir: string, mode?: number): string {
  mkdirSync(dir, { recursive: true, ...(mode ? { mode } : {}) });
  return dir;
}

/** Writes a file through a temporary one, so a reader never sees half of it. */
export function writeFileAtomic(file: string, data: string | Uint8Array, mode?: number): void {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data, mode ? { mode } : undefined);
  renameSync(tmp, file);
}

/** Reads a JSON file, or returns `fallback` when it is missing or broken. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Writes a JSON file atomically, pretty-printed. */
export function writeJson(file: string, value: unknown, mode?: number): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

/** Whether two folder paths point to the same location (resolving symlinks when present, and case on Windows). */
export function samePath(a: string, b: string): boolean {
  const normalize = (dir: string): string => {
    let full = resolve(dir);
    try {
      full = realpathSync(full);
    } catch {
      /* folder may not exist yet */
    }
    return process.platform === 'win32' ? full.toLowerCase() : full;
  };
  return normalize(a) === normalize(b);
}

/** A path under `root` that does not leave it. Throws `bad_path` on `..` and absolute paths. */
export function inside(root: string, rel: unknown): string {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new OpenArtifactError('bad_path', `Not a usable path: ${JSON.stringify(rel)}`);
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = resolve(root, clean);
  if (full !== root && !full.startsWith(root + sep)) throw new OpenArtifactError('bad_path', `${rel} leaves the artifact folder.`);
  return full;
}
