/**
 * Zip icon packs: a `.zip` whose `.svg` files become one library, a shape
 * per file, named after the file, its folders (nearest first) as tags.
 *
 * The reader is small on purpose: the central directory, and stored or
 * deflated entries (deflate through {@link inflateRawLimited}). Every limit
 * holds while reading: the zip's size, how many drawings are read, each
 * drawing's unpacked size (inflating stops there) and the total unpacked.
 * Encrypted entries and zip64 are left out with a reason. Entry names are
 * only ever text (a shape's name and tags), never paths.
 */

import { inflateRawLimited, type Inflated } from './inflate.ts';
import { cleanLibraryText, readLibraryShape, shapeLibraryOf, SHAPE_LIBRARY_LIMITS, type LeftOutShape, type LibraryShape, type ShapeLibraryRead, type ShapeLibraryRefusal } from './library.ts';

/** Limits of a zip pack, on top of {@link SHAPE_LIBRARY_LIMITS}. */
export const ZIP_PACK_LIMITS = {
  /** Unpacked bytes of one drawing. */
  entryBytes: 400_000,
  /** Unpacked bytes read from one pack in all. */
  totalBytes: 16 * 1024 * 1024,
} as const;

/** One central-directory entry, as the zip states it. */
export interface ZipDirectoryEntry {
  /** The stored name, as text (UTF-8). */
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  /** Where its local header starts. */
  offset: number;
  /** Its sizes or offset need zip64. */
  zip64: boolean;
}

/** A zip's directory, or why it cannot be read. */
export type ZipDirectory = { ok: true; entries: ZipDirectoryEntry[] } | { ok: false; reason: string };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;
const DAMAGED = 'This zip file is damaged, or is not a zip file.';

/** True when `bytes` start like a zip file. */
export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}

/** Reads the central directory. */
export function readZipDirectory(bytes: Uint8Array): ZipDirectory {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) return { ok: false, reason: DAMAGED };
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (count === 0xffff || size === MAX32 || start === MAX32) return { ok: false, reason: 'This zip file uses zip64, which boards cannot read: zip it again without it.' };
  if (start + size > end) return { ok: false, reason: DAMAGED };
  const decoder = new TextDecoder('utf-8');
  const entries: ZipDirectoryEntry[] = [];
  let at = start;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) return { ok: false, reason: DAMAGED };
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > end) return { ok: false, reason: DAMAGED };
    const compressedSize = view.getUint32(at + 20, true);
    const entrySize = view.getUint32(at + 24, true);
    const offset = view.getUint32(at + 42, true);
    entries.push({
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      compressedSize,
      size: entrySize,
      offset,
      zip64: compressedSize === MAX32 || entrySize === MAX32 || offset === MAX32,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { ok: true, entries };
}

/** The stored (still compressed) bytes of an entry, or `undefined` when its local header does not hold together. */
export function zipEntryData(bytes: Uint8Array, entry: ZipDirectoryEntry): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== LOCAL) return undefined;
  const from = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  if (from + entry.compressedSize > bytes.length) return undefined;
  return bytes.subarray(from, from + entry.compressedSize);
}

/**
 * The shape name and tags an entry's name gives, or `undefined` for an
 * entry that is not a drawing of the pack (not `.svg`, a folder, a dot-file
 * or inside one, the OS's `__MACOSX/` copies). `.` and `..` parts are
 * dropped: the name is text, not a path.
 */
export function zipEntryShapeName(path: string): { name: string; tags: string[] } | undefined {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '' && part !== '.' && part !== '..');
  const file = parts.pop();
  if (file === undefined || !/\.svg$/i.test(file) || parts[0] === '__MACOSX' || [...parts, file].some((part) => part.startsWith('.'))) return undefined;
  const name = cleanLibraryText(file.replace(/\.svg$/i, ''), SHAPE_LIBRARY_LIMITS.name);
  const tags = parts
    .reverse()
    .map((part) => cleanLibraryText(part, SHAPE_LIBRARY_LIMITS.tag))
    .filter((tag) => tag !== '')
    .slice(0, SHAPE_LIBRARY_LIMITS.tags);
  return { name, tags };
}

/** The library name a zip file's name gives (without `.zip`). */
export function zipPackName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  return cleanLibraryText(base.replace(/\.zip$/i, ''), SHAPE_LIBRARY_LIMITS.name) || 'Shapes';
}

/** Inflates raw deflate data up to a size (see {@link inflateRawLimited}). */
export type Inflate = (data: Uint8Array, max: number) => Promise<Inflated>;

/** Reads a zip pack into a library named `name`. */
export async function readZipShapeLibrary(bytes: Uint8Array, name: string, inflate: Inflate = inflateRawLimited): Promise<ShapeLibraryRead | ShapeLibraryRefusal> {
  if (bytes.length > SHAPE_LIBRARY_LIMITS.bytes) return { ok: false, reason: `This zip file is larger than ${SHAPE_LIBRARY_LIMITS.bytes / 1024 / 1024} MB: split it into smaller packs.` };
  const directory = readZipDirectory(bytes);
  if (!directory.ok) return directory;
  const decoder = new TextDecoder('utf-8');
  const read: Array<LibraryShape | LeftOutShape> = [];
  let drawings = 0;
  let overLimit = 0;
  let total = 0;
  for (const entry of directory.entries) {
    const shape = zipEntryShapeName(entry.name);
    if (shape === undefined) continue;
    drawings += 1;
    if (drawings > SHAPE_LIBRARY_LIMITS.shapes) {
      overLimit += 1;
      continue;
    }
    const name = shape.name || `Shape ${drawings}`;
    const leave = (reason: string) => read.push({ name, reason });
    if (total >= ZIP_PACK_LIMITS.totalBytes) {
      leave(`was not read: the pack unpacks to more than ${ZIP_PACK_LIMITS.totalBytes / 1024 / 1024} MB`);
      continue;
    }
    if (entry.flags & 1) {
      leave('is encrypted');
      continue;
    }
    if (entry.zip64) {
      leave('is stored as zip64, which boards cannot read');
      continue;
    }
    const data = zipEntryData(bytes, entry);
    if (data === undefined) {
      leave('is damaged in the zip file');
      continue;
    }
    const room = Math.min(ZIP_PACK_LIMITS.entryBytes, ZIP_PACK_LIMITS.totalBytes - total);
    let svg: Uint8Array;
    if (entry.method === 0) {
      if (data.length > room) {
        total += room;
        leave(room < ZIP_PACK_LIMITS.entryBytes ? `was not read: the pack unpacks to more than ${ZIP_PACK_LIMITS.totalBytes / 1024 / 1024} MB` : 'is too large (over 400,000 bytes)');
        continue;
      }
      svg = data;
    } else if (entry.method === 8) {
      const inflated = await inflate(data, room);
      if (!inflated.ok) {
        if (inflated.reason === 'too_large') total += room;
        leave(inflated.reason === 'damaged' ? 'is damaged in the zip file' : room < ZIP_PACK_LIMITS.entryBytes ? `was not read: the pack unpacks to more than ${ZIP_PACK_LIMITS.totalBytes / 1024 / 1024} MB` : 'is too large (over 400,000 bytes)');
        continue;
      }
      svg = inflated.bytes;
    } else {
      leave('is compressed in a way boards cannot read');
      continue;
    }
    total += svg.length;
    read.push(readLibraryShape({ name, ...(shape.tags.length > 0 ? { tags: shape.tags } : {}), svg: decoder.decode(svg) }, read.length));
  }
  return shapeLibraryOf(cleanLibraryText(name, SHAPE_LIBRARY_LIMITS.name) || 'Shapes', undefined, undefined, read, overLimit);
}
