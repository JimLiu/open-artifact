/**
 * Reads plain zip files (no Zip64), the shape `archive.ts` writes and Office files use. Node built-ins only.
 *
 * {@link zipEntries} lists the central directory as it is, without judging it; {@link readZip} gives each name a
 * lazy reader (the Word import's view); {@link entryBytes} and {@link unpackEntry} read one entry's data. Callers that
 * take a zip from someone they do not trust check the entries themselves (see `importArchive` in `archive.ts`).
 */

import { promisify } from 'node:util';
import { inflateRaw as inflateRawCallback, inflateRawSync } from 'node:zlib';

/** A file that is not a zip (`not_zip`), or a zip whose parts do not hold together (`damaged`). */
export class ZipError extends Error {
  readonly code: 'not_zip' | 'damaged';

  constructor(code: 'not_zip' | 'damaged', message: string) {
    super(message);
    this.code = code;
  }
}

/** One entry of the central directory, as the zip states it (sizes and attributes may lie). */
export interface ZipEntry {
  /** The name, decoded as UTF-8. */
  name: string;
  /** "Version made by": the high byte is the host system (3 = Unix, 0 = MS-DOS). */
  madeBy: number;
  /** General purpose flags (bit 0: encrypted, bit 6: strong encryption, bit 11: UTF-8 names). */
  flags: number;
  /** 0 stored, 8 deflated. */
  method: number;
  crc: number;
  /** Bytes in the zip. */
  packedSize: number;
  /** Bytes once unpacked, as declared. */
  size: number;
  /** External attributes; on a Unix host the high 16 bits are the file's `st_mode`. */
  externalAttributes: number;
  /** Offset of the entry's local header. */
  localOffset: number;
}

/** The end of central directory record: where the directory starts and how many entries it claims. */
export interface ZipDirectory {
  entries: ZipEntry[];
  /** Entries the end record claims (may be more than were readable). */
  declared: number;
  /** Offset of the central directory, which is where the entries' data must end. */
  directoryOffset: number;
}

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function view(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * The central directory. Reading stops at the first record that is not one (the end record's count is in
 * `declared`, so a strict caller can see a short directory). Throws `not_zip` when there is no end record.
 */
export function zipEntries(bytes: Uint8Array): ZipDirectory {
  const zip = view(bytes);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== END_SIGNATURE) end--;
  if (end < 0) throw new ZipError('not_zip', 'This file is not a zip: it has no end of central directory record.');
  const declared = zip.readUInt16LE(end + 10);
  const directoryOffset = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < declared && at + 46 <= zip.length && zip.readUInt32LE(at) === CENTRAL_SIGNATURE; index++) {
    const nameLength = zip.readUInt16LE(at + 28);
    entries.push({
      name: zip.toString('utf8', at + 46, at + 46 + nameLength),
      madeBy: zip.readUInt16LE(at + 4),
      flags: zip.readUInt16LE(at + 8),
      method: zip.readUInt16LE(at + 10),
      crc: zip.readUInt32LE(at + 16),
      packedSize: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      externalAttributes: zip.readUInt32LE(at + 38),
      localOffset: zip.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return { entries, declared, directoryOffset };
}

/** Where an entry's packed data sits, read from its local header: the data and the name the local header gives. Throws `damaged` when the local header is missing. */
export function entryBytes(bytes: Uint8Array, entry: ZipEntry): { data: Buffer; start: number; localName: string; localMethod: number; localFlags: number } {
  const zip = view(bytes);
  const local = entry.localOffset;
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL_SIGNATURE) throw new ZipError('damaged', `The zip is damaged: the data of ${entry.name} is missing.`);
  const nameLength = zip.readUInt16LE(local + 26);
  const start = local + 30 + nameLength + zip.readUInt16LE(local + 28);
  return {
    data: zip.subarray(start, start + entry.packedSize),
    start,
    localName: zip.toString('utf8', local + 30, local + 30 + nameLength),
    localMethod: zip.readUInt16LE(local + 8),
    localFlags: zip.readUInt16LE(local + 6),
  };
}

const inflateRaw = promisify(inflateRawCallback);

/**
 * An entry's bytes, unpacked: stored data is copied, anything else is inflated, never past `maxBytes`
 * (zlib refuses with a `RangeError` when the data would grow past it).
 */
export async function unpackEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Promise<Buffer> {
  const { data } = entryBytes(bytes, entry);
  return entry.method === 0 ? Buffer.from(data) : inflateRaw(data, { maxOutputLength: Math.max(1, maxBytes) });
}

/** {@link unpackEntry}, synchronously. */
export function unpackEntrySync(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Buffer {
  const { data } = entryBytes(bytes, entry);
  return entry.method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: Math.max(1, maxBytes) });
}

/**
 * Every name of the zip with a reader of its bytes, unpacked on demand and never past `maxEntryBytes`. A name given
 * twice keeps its last entry. Throws `not_zip`; a reader throws `damaged` when its entry's data is missing.
 */
export function readZip(bytes: Uint8Array, maxEntryBytes: number): Map<string, () => Buffer> {
  const entries = new Map<string, () => Buffer>();
  for (const entry of zipEntries(bytes).entries) entries.set(entry.name, () => unpackEntrySync(bytes, entry, maxEntryBytes));
  return entries;
}
