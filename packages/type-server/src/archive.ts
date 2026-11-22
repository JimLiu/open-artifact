/**
 * The whole artifact folder as one .zip (`archive <dir> [--out file.zip]`),
 * to back it up, move it to another computer or send it to someone:
 * unzipped anywhere, it opens again with `open <folder>`. Node built-ins only.
 *
 * The zip holds one folder, named as the artifact folder is, with what makes
 * the artifact: `project/` (or `db/`), `_blobs/`, `comments.json`, `history/`
 * and `.artifact.json`. Left out is what belongs to this computer or to
 * nobody: the agent channel (`_agent/`: inbox, waiting, view context), dot
 * files (a server's state and log, share links, temp files of atomic
 * writes), `node_modules`, `.git` and the OS's `.DS_Store` / `Thumbs.db`.
 * Symbolic links are not followed.
 *
 * Plain zip (no Zip64): at most 65 535 files and 4 GiB, checked before the
 * first byte goes out. Names are UTF-8 (flag bit 11), Unix permissions ride
 * in the external attributes, and each file is deflated unless it is a
 * format that is compressed already or deflate would not shrink it.
 */

import { randomBytes } from 'node:crypto';
import { constants, existsSync, statSync, type Dirent } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { deflateRaw as deflateRawCallback } from 'node:zlib';
import { HttpError } from './http.ts';
import { MAX_FILE_BYTES } from './store.ts';
import { unpackEntry, entryBytes, ZipError, zipEntries, type ZipEntry } from './unzip.ts';

/** Hidden paths carrying portable artifact data, relative to the archive root. */
const KEPT_DOT_FILES = new Set(['.artifact.json', '.gitignore', 'doc/.sessions.json', 'doc/.people.json', 'doc/tabs/.deleted']);
/** Never in the zip, at any depth. */
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.git', 'node_modules']);
/** Never in the zip, at the folder's top. */
const LOCAL_DIRS = new Set(['_agent']);
/** An atomic write's temp file. */
const isTemp = (name: string): boolean => name.endsWith('.tmp') || name.startsWith('.tmp-');

/**
 * Whether the archive carries `name`, found at `path` (its path under the artifact folder, forward slashes) in the
 * folder `parent` (`''` at the top). A path is in the archive when every step down to it is.
 */
function keepsStep(parent: string, name: string, path: string): boolean {
  if (JUNK.has(name) || isTemp(name)) return false;
  if (name.startsWith('.') && !KEPT_DOT_FILES.has(path)) return false;
  return !(parent === '' && LOCAL_DIRS.has(name));
}

/**
 * Whether a path under the artifact folder (forward slashes, no leading slash) is one {@link archiveEntries} would
 * put in the zip, by name alone. The export and the import share it, so what one leaves out the other refuses.
 */
export function archiveKeeps(path: string): boolean {
  const steps = path.split('/');
  let parent = '';
  for (const name of steps) {
    const inner = parent ? `${parent}/${name}` : name;
    if (!keepsStep(parent, name, inner)) return false;
    parent = inner;
  }
  return true;
}

/** Formats that are compressed already: stored as they are. */
const STORED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.heic', '.mp4', '.m4v', '.mov', '.webm', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.woff', '.woff2', '.zip', '.gz', '.br', '.zst', '.7z']);

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/** One file of the zip. */
export interface ArchiveEntry {
  /** The path inside the zip: `<folder>/<path under root>`, with forward slashes. */
  name: string;
  file: string;
  size: number;
  mode: number;
  mtime: Date;
}

/** A folder over plain zip's limits. */
export class ArchiveTooLarge extends Error {
  readonly code = 'TOO_LARGE';
}

/** The files to zip, sorted by path. `skip`: absolute paths to leave out too (the zip itself, written inside the folder). */
export async function archiveEntries(root: string, skip: string[] = []): Promise<ArchiveEntry[]> {
  const top = resolve(root);
  const folder = basename(top) || 'artifact';
  const skipped = new Set(skip.map((file) => resolve(file)));
  const entries: ArchiveEntry[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let names: Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (rel && (error as NodeJS.ErrnoException).code === 'ENOENT') return; // removed meanwhile
      throw error;
    }
    for (const dirent of names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const name = dirent.name;
      const inner = rel ? `${rel}/${name}` : name;
      if (!keepsStep(rel, name, inner)) continue;
      const file = join(dir, name);
      if (skipped.has(file)) continue;
      if (dirent.isDirectory()) await walk(file, inner);
      else if (dirent.isFile()) {
        const info = await stat(file).catch(() => null);
        if (info?.isFile()) entries.push({ name: `${folder}/${inner}`, file, size: info.size, mode: info.mode & 0o777, mtime: info.mtime });
      }
    }
  };
  await walk(top, '');
  if (entries.length > MAX_ENTRIES) throw new ArchiveTooLarge(`The folder holds ${entries.length} files, more than a zip holds (${MAX_ENTRIES}); copy the folder itself instead.`);
  const bound = entries.reduce((sum, entry) => sum + entry.size + 2 * (46 + Buffer.byteLength(entry.name)), 22);
  if (bound > MAX_BYTES) throw new ArchiveTooLarge(`The folder holds ${(bound / 2 ** 30).toFixed(1)} GiB, more than a zip holds (4 GiB); copy the folder itself instead.`);
  return entries;
}

/* -------------------------------------------------------------------------- */
/* The zip format                                                             */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of bytes. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date, local time; the format starts in 1980 and ends in 2107. */
function dosTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const deflateRaw = promisify(deflateRawCallback);
const UTF8 = 1 << 11;

/**
 * Writes the zip of `entries` through `write`, one file at a time: its local
 * header and data, then the central directory. A file gone since the listing
 * is left out. Resolves with the number of bytes written.
 */
export async function writeZip(entries: ArchiveEntry[], write: (chunk: Buffer) => Promise<void>): Promise<{ bytes: number; files: number }> {
  const central: Buffer[] = [];
  let offset = 0;
  let files = 0;
  const put = async (chunk: Buffer): Promise<void> => {
    await write(chunk);
    offset += chunk.length;
  };
  for (const entry of entries) {
    let data: Buffer;
    try {
      data = await readFile(entry.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (data.length > 0 && !STORED.has(extname(entry.name).toLowerCase())) {
      const deflated = await deflateRaw(data);
      if (deflated.length < data.length) {
        method = 8;
        body = deflated;
      }
    }
    if (offset + body.length > MAX_BYTES) throw new ArchiveTooLarge('The folder grew past what a zip holds (4 GiB) while it was being zipped.');
    const name = Buffer.from(entry.name, 'utf8');
    const { time, date } = dosTime(entry.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    // extra, comment, disk, internal attributes: 0
    header.writeUInt32LE(((0o100000 | (entry.mode || 0o644) | 0o600) << 16) >>> 0, 38); // a regular file, its permissions
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    await put(Buffer.concat([local, name]));
    await put(body);
    files++;
  }
  const start = offset;
  const directory = Buffer.concat(central);
  await put(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files, 8);
  end.writeUInt16LE(files, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(start, 16);
  await put(end);
  return { bytes: offset, files };
}

/* -------------------------------------------------------------------------- */
/* Where it goes                                                              */
/* -------------------------------------------------------------------------- */

/** `<folder>-<yyyy-mm-dd>.zip`: a day's backup beside the last one, not over it. */
export function archiveFileName(root: string, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${basename(resolve(root)) || 'artifact'}-${day}.zip`;
}

/**
 * Writes the folder's zip to `out` (through a temp file beside it, so a
 * failure leaves no half zip). `out` may be inside the folder: it is never
 * zipped into itself.
 */
export async function writeArchive(root: string, out: string): Promise<{ file: string; files: number; bytes: number }> {
  const file = resolve(out);
  const entries = await archiveEntries(root, [file]);
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  const handle = await open(temp, 'w');
  let result: { bytes: number; files: number };
  try {
    result = await writeZip(entries, async (chunk) => {
      await handle.write(chunk);
    });
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temp, { force: true });
    throw error;
  }
  await rename(temp, file);
  return { file, ...result };
}

/** `attachment` with the file's name: plain ASCII in `filename`, the real name in `filename*`. */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Answers `GET|HEAD /__open-artifact/archive`: the folder's zip, streamed as
 * it is written (no length: each file is deflated on the way). `HEAD` lists
 * the files only, so a folder over plain zip's limits answers 413 before
 * anything is zipped. A connection that closes stops the zipping.
 */
export async function sendArchive(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  const method = req.method ?? 'GET';
  req.resume();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let entries: ArchiveEntry[];
  try {
    entries = await archiveEntries(root);
  } catch (error) {
    if (error instanceof ArchiveTooLarge) {
      const body = JSON.stringify({ code: 'too_large', message: error.message });
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(method === 'HEAD' ? undefined : body);
      return;
    }
    throw error;
  }
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': attachmentHeader(archiveFileName(root)), 'cache-control': 'no-store' });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  let closed = false;
  res.on('close', () => (closed = true));
  try {
    await writeZip(entries, (chunk) => {
      if (closed || res.destroyed) return Promise.reject(new Error('The connection closed.'));
      if (res.write(chunk)) return Promise.resolve();
      return new Promise<void>((done, fail) => {
        const onDrain = (): void => {
          res.off('close', onClose);
          done();
        };
        const onClose = (): void => {
          res.off('drain', onDrain);
          fail(new Error('The connection closed.'));
        };
        res.once('drain', onDrain);
        res.once('close', onClose);
      });
    });
    res.end();
  } catch {
    // Headers are out: the only way to say it failed is to cut the download short.
    res.destroy();
  }
}

/**
 * `archive <dir> [--out file.zip | folder]`: by default the zip goes beside
 * the artifact folder (in its parent), named by {@link archiveFileName};
 * `--out` an existing folder puts it there under that name.
 */
export async function archiveCommand(root: string, out: string | undefined): Promise<{ file: string; folder: string; files: number; bytes: number }> {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${root} is not a folder.`);
  const where = out ? resolve(out) : dirname(resolve(root));
  const target = existsSync(where) && statSync(where).isDirectory() ? join(where, archiveFileName(root)) : where;
  const { file, files, bytes } = await writeArchive(root, target);
  return { file, folder: basename(resolve(root)), files, bytes };
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

/** Caps on what an imported archive may unpack to. */
export interface ImportLimits {
  /** Files, at most. Default 65 535 (what a plain zip holds). */
  maxFiles?: number;
  /** Unpacked bytes of all files together, at most. Default 4 GiB. */
  maxBytes?: number;
  /** Unpacked bytes of any one file, at most; when given it replaces the per-folder defaults ({@link importFileLimit}). */
  maxFileBytes?: number;
}

/** An archive unpacked into an artifact folder. */
export interface ImportedArchive {
  /** The artifact folder (`dest`, resolved). */
  root: string;
  /** Its type, detected from the unpacked folder. */
  type: string;
  files: number;
  bytes: number;
}

/** Largest upload under `_blobs/`, as the type server takes one (its `MAX_UPLOAD`). */
const IMPORT_MAX_BLOB_BYTES = 25 * 1024 * 1024;
/** Largest other file outside `project/` (history, comments, a sheet's imported workbook of up to 50 MB, a db document). */
const IMPORT_MAX_OTHER_BYTES = 64 * 1024 * 1024;

/**
 * The most one imported file may unpack to: a `project/` file what a page may write ({@link MAX_FILE_BYTES},
 * 16 MB), an upload under `_blobs/` what the server takes (25 MB), anything else 64 MB.
 */
export function importFileLimit(path: string): number {
  if (path.startsWith('project/')) return MAX_FILE_BYTES;
  if (path.startsWith('_blobs/')) return IMPORT_MAX_BLOB_BYTES;
  return IMPORT_MAX_OTHER_BYTES;
}

const UNIX_HOST = 3;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const DOS_DIRECTORY = 0x10;
/** Flag bits of an encrypted entry: encrypted, strong encryption, masked local header. */
const ENCRYPTED = (1 << 0) | (1 << 6) | (1 << 13);
/** `wx`, and never through a symbolic link. */
const WRITE_NEW = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);

const refuse = (message: string): HttpError => new HttpError(400, 'invalid_archive', message);
const tooLarge = (message: string): HttpError => new HttpError(413, 'too_large', message);

/** How a name compares on a case-insensitive, normalization-insensitive disk. */
const folded = (path: string): string => path.normalize('NFC').toLowerCase();

/** One entry, checked: where it goes under the artifact folder and its permissions. */
interface ImportEntry {
  entry: ZipEntry;
  path: string;
  mode: number;
}

/** Checks one central directory entry and splits its name into the top folder and the path under it. */
function checkEntry(entry: ZipEntry): { top: string; path: string; mode: number } {
  const name = entry.name;
  const shown = JSON.stringify(name);
  if (entry.flags & ENCRYPTED) throw refuse(`${shown} is encrypted; an artifact archive never is.`);
  if (entry.method !== 0 && entry.method !== 8) throw refuse(`${shown} is packed with method ${entry.method}; only stored and deflated files are read.`);
  const mode = entry.externalAttributes >>> 16;
  if (entry.madeBy >>> 8 !== UNIX_HOST || (mode & S_IFMT) !== S_IFREG || entry.externalAttributes & DOS_DIRECTORY || name.endsWith('/')) {
    throw refuse(`${shown} is not a regular file (a folder, a symbolic link or another kind of entry); an artifact archive holds files only.`);
  }
  if (name.includes('\0') || name.includes('\\')) throw refuse(`${shown} has a backslash or a NUL in its name.`);
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw refuse(`${shown} is an absolute path.`);
  const steps = name.split('/');
  if (steps.some((step) => step === '..')) throw refuse(`${shown} climbs out of its folder (..).`);
  if (steps.some((step) => step === '' || step === '.')) throw refuse(`${shown} has an empty or "." step in its path.`);
  if (steps.length < 2) throw refuse(`${shown} is at the top of the zip; an artifact archive holds one folder.`);
  const path = steps.slice(1).join('/');
  if (!archiveKeeps(path) || !archiveKeeps(folded(path))) throw refuse(`${shown} is not part of an artifact archive (the agent channel, a dot file, a temp file or junk).`);
  return { top: steps[0]!, path, mode: (mode & 0o755) | 0o600 };
}

/** Every entry checked, before a byte is unpacked: names, kinds, duplicates, one top folder and the declared sizes. */
function checkEntries(bytes: Uint8Array, limits: Required<Omit<ImportLimits, 'maxFileBytes'>> & { maxFileBytes?: number }): ImportEntry[] {
  let directory: ReturnType<typeof zipEntries>;
  try {
    directory = zipEntries(bytes);
  } catch (error) {
    if (error instanceof ZipError) throw refuse('This file is not a zip.');
    throw error;
  }
  if (directory.declared > limits.maxFiles) throw tooLarge(`The archive holds ${directory.declared} files, more than ${limits.maxFiles}.`);
  if (directory.entries.length !== directory.declared) throw refuse('The zip is damaged: its central directory is short.');
  if (directory.declared === 0) throw refuse('The archive is empty.');
  const checked: ImportEntry[] = [];
  const seen = new Set<string>();
  const folders = new Set<string>();
  let top: string | undefined;
  let declaredBytes = 0;
  for (const entry of directory.entries) {
    const { top: folder, path, mode } = checkEntry(entry);
    if (top === undefined) top = folder;
    else if (folder !== top) throw refuse(`The archive holds more than one folder (${JSON.stringify(top)} and ${JSON.stringify(folder)}); an artifact archive holds one.`);
    const key = folded(path);
    if (seen.has(key)) throw refuse(`${JSON.stringify(entry.name)} is in the archive twice (names that differ only in case count as the same).`);
    seen.add(key);
    const steps = key.split('/');
    for (let index = 1; index < steps.length; index++) folders.add(steps.slice(0, index).join('/'));
    const cap = limits.maxFileBytes ?? importFileLimit(path);
    if (entry.size > cap) throw tooLarge(`${path} unpacks to ${entry.size} bytes, more than ${cap}.`);
    declaredBytes += entry.size;
    if (declaredBytes > limits.maxBytes) throw tooLarge(`The archive unpacks to more than ${limits.maxBytes} bytes.`);
    const local = entryBytes(bytes, entry);
    if (local.start + entry.packedSize > directory.directoryOffset || directory.directoryOffset > bytes.byteLength) throw refuse(`The zip is damaged: the data of ${path} runs past its end.`);
    if (local.localName !== entry.name || local.localMethod !== entry.method || local.localFlags & ENCRYPTED) throw refuse(`The zip is damaged: the local header of ${path} does not match its directory entry.`);
    if (entry.method === 0 && entry.packedSize !== entry.size) throw refuse(`The zip is damaged: ${path} is stored but its sizes differ.`);
    checked.push({ entry, path, mode });
  }
  for (const key of seen) if (folders.has(key)) throw refuse(`${key} is in the archive both as a file and as a folder.`);
  return checked;
}

/** One entry's bytes: never past its declared size, which must be its real size, and its CRC must hold. */
async function unpackChecked(bytes: Uint8Array, item: ImportEntry): Promise<Buffer> {
  let data: Buffer;
  try {
    data = await unpackEntry(bytes, item.entry, item.entry.size);
  } catch (error) {
    if (error instanceof RangeError) throw tooLarge(`${item.path} unpacks to more than the ${item.entry.size} bytes it declares.`);
    if (error instanceof ZipError) throw refuse(error.message);
    throw refuse(`The zip is damaged: ${item.path} cannot be unpacked.`);
  }
  if (data.length !== item.entry.size) throw refuse(`The zip is damaged: ${item.path} unpacks to ${data.length} bytes, not the ${item.entry.size} it declares.`);
  if (crc32(data) !== item.entry.crc) throw refuse(`The zip is damaged: ${item.path} fails its CRC check.`);
  return data;
}

/** Writes a new file, refusing one that exists and never following a symbolic link. */
async function writeNew(file: string, data: Uint8Array, mode: number): Promise<void> {
  const handle = await open(file, WRITE_NEW, mode);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}

/** `.artifact.json` with `id` in place of the archive's: the shape the daemon writes (`{type, id, release}`), other fields kept. */
async function stampId(root: string, type: string, id: string): Promise<void> {
  const file = join(root, '.artifact.json');
  let marker: Record<string, unknown> = { type, id, release: null };
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) marker = { ...(parsed as Record<string, unknown>), id };
  } catch {
    /* none, or not JSON: a fresh marker */
  }
  await rm(file, { force: true });
  await writeNew(file, Buffer.from(`${JSON.stringify(marker, null, 2)}\n`), 0o644);
}

/**
 * Unpacks an artifact archive (what `sendArchive` writes) into `dest`, which must not exist yet.
 * `id`, when given, is written into the folder's `.artifact.json` in place of the archive's.
 *
 * The zip may come from anyone, so it must be exactly the shape {@link archiveEntries} and {@link writeZip} make:
 * regular files only (Unix host, regular-file mode), all under one top folder whose name is dropped, every path one
 * the export would carry ({@link archiveKeeps}, so no `_agent/`, `.sharing.json` or other dot file), no `..`,
 * absolute path, backslash or NUL, no name given twice (case and Unicode normalization ignored), not encrypted, and
 * within `limits`: declared sizes are checked first, and each file is inflated no further than it declared, so a
 * size that lies fails. It unpacks into a temp folder beside `dest` that becomes `dest` only once every file is
 * written and the folder is a known artifact type; on any failure the temp folder is removed. Refusals are
 * {@link HttpError}s: 400 `invalid_archive` or `not_artifact`, 409 `exists`, 413 `too_large`.
 */
export async function importArchive(bytes: Uint8Array, dest: string, options: { id?: string; limits?: ImportLimits } = {}): Promise<ImportedArchive> {
  const root = resolve(dest);
  const limits = { maxFiles: options.limits?.maxFiles ?? MAX_ENTRIES, maxBytes: options.limits?.maxBytes ?? MAX_BYTES, ...(options.limits?.maxFileBytes !== undefined ? { maxFileBytes: options.limits.maxFileBytes } : {}) };
  const exists = async (): Promise<boolean> => lstat(root).then(() => true, () => false);
  if (await exists()) throw new HttpError(409, 'exists', `${root} exists already.`);
  if (options.id !== undefined && (typeof options.id !== 'string' || !options.id)) throw new HttpError(400, 'invalid', 'id must be a non-empty string.');
  const entries = checkEntries(bytes, limits);

  await mkdir(dirname(root), { recursive: true });
  const temp = join(dirname(root), `.${basename(root)}.${randomBytes(6).toString('hex')}.import.tmp`);
  await mkdir(temp);
  try {
    let total = 0;
    for (const item of entries) {
      const data = await unpackChecked(bytes, item);
      total += data.length;
      if (total > limits.maxBytes) throw tooLarge(`The archive unpacks to more than ${limits.maxBytes} bytes.`);
      const file = resolve(temp, ...item.path.split('/'));
      if (!file.startsWith(temp + sep)) throw refuse(`${item.path} would land outside the artifact folder.`);
      await mkdir(dirname(file), { recursive: true });
      await writeNew(file, data, item.mode);
    }
    // Loaded here: server.ts imports this module, and modules the sheets and docs types load import it too.
    const { detectType } = await import('./server.ts');
    const type = await detectType(temp);
    if (!type) throw new HttpError(400, 'not_artifact', 'The archive is not an artifact: it holds no known type\'s marker file.');
    if (options.id !== undefined) await stampId(temp, type, options.id);
    if (await exists()) throw new HttpError(409, 'exists', `${root} exists already.`);
    await rename(temp, root);
    return { root, type, files: entries.length, bytes: total };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    if (error instanceof HttpError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTDIR') throw refuse('The archive\'s paths collide with one another.');
    throw error;
  }
}
