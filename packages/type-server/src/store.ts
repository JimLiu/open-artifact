/**
 * Storage of one artifact folder.
 *
 * Pages see artifact-relative paths under `project/` only. Everything else in
 * the folder (`.artifact.json`, `_blobs/`, `_agent/`, `history/`, …) belongs to
 * the host and is never listed, read or written through the page API.
 *
 * Writes are atomic per file (temp file + rename) and a publish batch is
 * checked as a whole before anything is written: if one `ifMatch` is stale the
 * batch fails with every stale path and the folder is left untouched.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, type Dirent } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import type { ConflictPath, FileListing, PublishBatch } from '@open-artifact/runtime/capabilities';
import { HttpError, extensionOf, mimeOf } from './http.ts';

/** The folder pages may see. */
export const PROJECT_DIR = 'project';

/** Largest single file a page may write, bytes. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** Largest publish batch, files. */
export const MAX_BATCH_FILES = 500;

/** Names skipped while walking `project/`. */
const SKIPPED = new Set(['.DS_Store', 'node_modules', '.git']);

/** Temp files of {@link writeAtomic}, never listed. */
const TEMP_FILE = /\.[0-9a-f]{8}\.tmp$/;

/** Lower-case hex SHA-256. */
export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Validates an artifact-relative path a page sent. Returns the reason it is
 * refused, or `null` when it is a plain path under `project/`.
 */
export function pagePathProblem(path: string): string | null {
  if (typeof path !== 'string' || !path) return 'is empty';
  if (path.length > 512) return 'is longer than 512 characters';
  if (path.includes('\\') || path.includes('\0')) return 'contains a backslash or NUL';
  const parts = path.split('/');
  if (parts[0] !== PROJECT_DIR || parts.length < 2) return `must start with ${PROJECT_DIR}/`;
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return 'has an empty, "." or ".." segment';
    if (part.startsWith('.')) return 'has a hidden segment';
  }
  return null;
}

/** A cached hash, valid while size and mtime are unchanged. */
interface HashEntry {
  sha256: string;
  size: number;
  mtimeMs: number;
}

/** An uploaded asset. */
export interface StoredBlob {
  id: string;
  file: string;
  contentType: string;
  size: number;
}

export function blobFilenames(entries: Dirent[]): Map<string, string> {
  const files = new Map<string, string>();
  const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  for (const name of names) {
    const match = /^([a-f0-9]{32})\.([a-z0-9]+)$/.exec(name);
    if (!match) continue;
    const id = match[1]!;
    files.set(id, names.has(id) && names.has(id + '.json') ? id : name);
  }
  return files;
}

const BOARD_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);

/** A sidecar may label the bytes only as media that the original whiteboard accepts. */
async function boardMediaType(sidecar: string): Promise<string> {
  try {
    const info = await lstat(sidecar);
    if (info.isFile() && info.size <= 16_384) {
      const meta = JSON.parse(await readFile(sidecar, 'utf8'));
      if (BOARD_MEDIA.has(meta?.contentType)) return meta.contentType;
    }
  } catch { /* An unreadable sidecar still leaves the bytes available. */ }
  return 'application/octet-stream';
}

/** One artifact folder. */
export class ArtifactStore {
  /** Cache of file hashes, by artifact-relative path. */
  private readonly hashes = new Map<string, HashEntry>();
  /** Serializes publishes. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Absolute path of the artifact folder. */
  readonly root: string;
  private directory: WorkspaceDirectory | undefined;

  constructor(root: string) {
    this.root = root;
  }

  /**
   * Absolute path of an artifact-relative path: the real path, checked to stay in the folder (a link in it that leads
   * out is refused). A folder not made yet (a first upload makes it) has no links in it: the path as written.
   */
  resolve(path: string, followLeaf = true): string {
    if (!this.directory) {
      if (!existsSync(this.root)) return join(this.root, ...path.split('/'));
      this.directory = new WorkspaceDirectory(this.root);
    }
    return this.directory.resolve(path, followLeaf);
  }

  /** Lists every file under `project/` with its hash. */
  async list(): Promise<FileListing> {
    const out: FileListing = {};
    const seen = new Set<string>();
    const walk = async (path: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(this.resolve(path), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIPPED.has(entry.name) || entry.name.startsWith('.') || TEMP_FILE.test(entry.name)) continue;
        const relative = `${path}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(relative);
        } else if (entry.isFile()) {
          const hash = await this.hashOf(relative);
          if (hash) {
            out[relative] = { sha256: hash.sha256, size: hash.size };
            seen.add(relative);
          }
        }
      }
    };
    await walk(PROJECT_DIR);
    for (const path of this.hashes.keys()) if (!seen.has(path)) this.hashes.delete(path);
    return out;
  }

  /** The hash of one file, or `null` when it does not exist. */
  async hashOf(path: string): Promise<HashEntry | null> {
    let info;
    try {
      info = await stat(this.resolve(path));
    } catch {
      this.hashes.delete(path);
      return null;
    }
    if (!info.isFile()) return null;
    const cached = this.hashes.get(path);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached;
    const bytes = await readFile(this.resolve(path));
    const entry = { sha256: sha256(bytes), size: bytes.length, mtimeMs: info.mtimeMs };
    this.hashes.set(path, entry);
    return entry;
  }

  /** Reads a file the page asked for. */
  async read(path: string): Promise<{ bytes: Buffer; sha256: string }> {
    const problem = pagePathProblem(path);
    if (problem) throw new HttpError(400, 'invalid', `Path ${JSON.stringify(path)} ${problem}.`);
    let bytes: Buffer;
    try {
      bytes = await readFile(this.resolve(path));
    } catch {
      throw new HttpError(404, 'not_found', `${path} does not exist.`);
    }
    return { bytes, sha256: sha256(bytes) };
  }

  /** Reads every text file of `project/`, keyed by path under `project/`. Binary files map to ''. */
  async readProject(): Promise<Map<string, string>> {
    const listing = await this.list();
    const files = new Map<string, string>();
    for (const path of Object.keys(listing).sort()) {
      const inner = path.slice(PROJECT_DIR.length + 1);
      const type = mimeOf(path);
      const isText = /^text\/|json|svg|javascript/.test(type) || /\.(dc\.html|jsx|tsx|mdx)$/.test(path);
      files.set(inner, isText ? await readFile(this.resolve(path), 'utf8') : '');
    }
    return files;
  }

  /**
   * Writes a batch. Every `ifMatch` is checked first; on any mismatch nothing
   * is written and a 409 lists every stale path. Returns the new hashes.
   */
  publish(batch: PublishBatch): Promise<Record<string, string | null>> {
    const run = this.queue.then(() => this.publishNow(batch));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async publishNow(batch: PublishBatch): Promise<Record<string, string | null>> {
    if (!batch || typeof batch !== 'object') throw new HttpError(400, 'invalid', 'files must be an object.');
    const paths = Object.keys(batch);
    if (paths.length === 0) return {};
    if (paths.length > MAX_BATCH_FILES) throw new HttpError(400, 'invalid', `At most ${MAX_BATCH_FILES} files per publish.`);

    // Decode and validate everything before touching the disk.
    const writes = new Map<string, Buffer | null>();
    for (const path of paths) {
      const problem = pagePathProblem(path);
      if (problem) throw new HttpError(400, 'invalid', `Path ${JSON.stringify(path)} ${problem}.`);
      this.resolve(path);
      const file = batch[path];
      if (file === null) {
        writes.set(path, null);
        continue;
      }
      if (!file || typeof file.content !== 'string') throw new HttpError(400, 'invalid', `${path}: content must be a string.`);
      const bytes = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8');
      if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'invalid', `${path} is larger than 16 MB.`);
      writes.set(path, bytes);
    }

    // Optimistic concurrency: collect every stale path.
    const conflicts: ConflictPath[] = [];
    for (const path of paths) {
      const file = batch[path];
      const expected = file === null ? undefined : file.ifMatch;
      if (expected === undefined) continue;
      const actual = (await this.hashOf(path))?.sha256 ?? null;
      if (actual !== expected) conflicts.push({ path, expected, actual });
    }
    if (conflicts.length) {
      throw new HttpError(409, 'conflict', `${conflicts.length} file(s) changed since they were read.`, { paths: conflicts });
    }

    const hashes: Record<string, string | null> = {};
    for (const [path, bytes] of writes) {
      const absolute = this.resolve(path, false);
      if (bytes === null) {
        await rm(absolute, { force: true });
        this.hashes.delete(path);
        hashes[path] = null;
        continue;
      }
      await writeAtomic(absolute, bytes);
      const info = await stat(absolute);
      const hash = sha256(bytes);
      this.hashes.set(path, { sha256: hash, size: bytes.length, mtimeMs: info.mtimeMs });
      hashes[path] = hash;
    }
    return hashes;
  }

  /* ---------------------------------------------------------------------- */
  /* Blobs                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Folder of uploads. */
  get blobDir(): string {
    return this.resolve('_blobs');
  }

  /**
   * Stores bytes content-addressed. The id is the first 32 hex digits of the
   * SHA-256; the stored file name carries an extension for the media type.
   */
  async putBlob(bytes: Buffer, contentType: string): Promise<StoredBlob> {
    const id = sha256(bytes).slice(0, 32);
    const type = contentType.split(';')[0]!.trim().toLowerCase() || 'application/octet-stream';
    const existing = await this.findBlob(id);
    if (existing) return existing;
    const file = this.resolve(`_blobs/${id}.${extensionOf(type)}`, false);
    await writeAtomic(file, bytes);
    return { id, file, contentType: type === 'application/octet-stream' ? mimeOf(file) : type, size: bytes.length };
  }

  async designAsset(id: string): Promise<(StoredBlob & { sha256: string }) | null> {
    if (!/^[0-9a-f]{32}$/.test(id)) return null;
    const project = this.resolve(PROJECT_DIR);
    const assets = this.resolve(`${PROJECT_DIR}/assets`);
    try {
      if (!(await lstat(project)).isDirectory() || !(await lstat(assets)).isDirectory()) return null;
      const entries = await readdir(assets, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.startsWith(id + '.')) continue;
        if (!/^(image|font|audio|video)\//.test(mimeOf(entry.name))) continue;
        const path = 'project/assets/' + entry.name;
        const hash = await this.hashOf(path);
        if (hash) return { id, sha256: hash.sha256, file: this.resolve(path), size: hash.size, contentType: mimeOf(entry.name) };
      }
    } catch { /* Missing project or asset directory. */ }
    return null;
  }

  /** Finds a stored blob by id. */
  async findBlob(id: string): Promise<StoredBlob | null> {
    if (!/^[0-9a-f]{32}$/.test(id)) return null;
    try {
      if (!(await lstat(this.blobDir)).isDirectory()) return null;
      const entries = await readdir(this.blobDir, { withFileTypes: true });
      const name = blobFilenames(entries).get(id);
      if (!name) return null;
      const file = this.resolve(`_blobs/${name}`);
      const info = await lstat(file);
      if (!info.isFile()) return null;
      const contentType = name === id ? await boardMediaType(this.resolve(`_blobs/${name}.json`)) : mimeOf(name);
      return { id, file, contentType, size: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

/** Writes a file through a temp file and rename, creating parent folders. */
export async function writeAtomic(file: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, bytes, { flag: 'wx' });
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
