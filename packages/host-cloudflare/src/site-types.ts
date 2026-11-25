/**
 * The Cloudflare site's published types (the catalog's rows are the host core's table `types`): their packages in D1,
 * and what an artifact's object runs for an artifact of one. The Node site's `node/site-types.ts` is the model.
 *
 * Where a package lives. The site has D1 and nothing else to keep bytes in, so a package is kept in D1, as it was
 * published (the zip), cut into chunks:
 *
 *     type_packages        (uid, version) → sha256, bytes, chunks, complete     one row per kept version
 *     type_package_chunks  (uid, version, n) → data (base64 text)               {@link CHUNK_BYTES} of the zip each
 *
 * - A chunk is {@link CHUNK_BYTES} (768 KiB) of the zip, kept as base64 text of 1 MiB: half of D1's 2,000,000-byte
 *   limit on a row (and on one string or BLOB). Text, not a BLOB: D1 hands a BLOB back as an array of numbers (8 bytes
 *   a byte in the isolate), a string as a string. A chunk is a bound parameter, so the 100 KB limit on a statement's
 *   text does not apply to it. A package of the most a Cloudflare site takes ({@link CLOUDFLARE_TYPE_MAX_BYTES},
 *   16 MiB) is 22 chunks, written {@link WRITE_BATCH} to a D1 batch (6 batches: a batch is one query of the 50 a Free
 *   plan invocation may make, of the 1000 a Paid one may).
 * - Written so a half-written version is never served: the chunks first, then the version's row is marked
 *   `complete`; the catalog row (`types`) is switched to the new version after that, by the Link route; the old
 *   version's rows are deleted last ({@link SiteTypeServices.removeFiles}). A room copies only a complete version
 *   whose sha256 is the catalog row's, and checks the bytes it put together against it.
 * - A version is checked whole when it is published, as on Node: `checkTypePackage` (the zip, its entries, the
 *   manifest, the id, the declaration), then every file inflated once and checked against its size and CRC, one at a
 *   time (nothing is kept unpacked in D1).
 * - The tables are made on first use (`CREATE TABLE IF NOT EXISTS`), not by a catalog migration: they are this
 *   platform's, and a migration number of its own would sit among the core's.
 *
 * How a room reads them. An artifact's object copies its type's served files (index.html, artifact-type.json,
 * `artifact-type/**`) into its own SQLite the first time it opens an artifact of that version
 * ({@link catalogFrameTypes}): the zip is read from D1 (a few queries), its sha256 checked, the served files
 * inflated one at a time and written in {@link ROOM_CHUNK_BYTES} BLOB chunks, keyed by the fingerprint
 * `uid@version:sha` (as on Node). The core reads a file synchronously from there (`FrameTypeSource.file`), so an
 * isolate holds at most one file of a type at a time, never the whole type; the object keeps the version across
 * evictions (a page that reopens reads nothing from D1 but the row), and drops it when a new one is copied. Type
 * files are served `no-cache` with an ETag made from the size and the package's sha256, as on Node.
 *
 * How a change reaches a room. The row of a type is read again at most every {@link ROW_MAX_AGE_MS} by a room, and
 * at once when the hub says the type changed (`type-changed`, sent by {@link SiteTypeServices.activated} and
 * `removed` to every room that registered an open artifact of it). A room with an open core of a published type also
 * checks the row every {@link ROOM_CHECK_MS} while it has pages connected, in case the hub forgot it (evicted).
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { installedTypeCsp, OpenArtifactError, parseTitleFrom, readStaticDeclaration, titleInFile } from '@open-artifact/protocol';
import type { SiteTypeServices, SqlDriver } from '@open-artifact/host';
import type { FrameFile, FrameTypeSource } from '@open-artifact/server-sdk/frame/env';
import { checkTypePackage, type CheckedTypePackage } from '@open-artifact/server-sdk/type-package';
import { unpackZipFile, ZipRefusal } from '@open-artifact/server-sdk/zip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameClientFiles } from '@open-artifact/server-sdk/frame/env';
import type { RoomFrameTypes, SiteFrameType } from './frames.ts';
import type { SyncStorage } from './fs/sql.ts';
import { blobBinding, blobBytes } from './fs/backend.ts';

/** The largest package a Cloudflare site keeps, bytes (a Node site takes up to the Link's 100 MiB body). */
export const CLOUDFLARE_TYPE_MAX_BYTES = 16 * 1024 * 1024;
/** One D1 chunk of a package, bytes of the zip (base64: 1 MiB of text, half of D1's 2,000,000-byte row). */
export const CHUNK_BYTES = 768 * 1024;
/** Chunks written per D1 batch (about 4 MiB of statements). */
export const WRITE_BATCH = 4;
/** Chunks read per D1 query. */
export const READ_BATCH = 4;
/** One chunk of a served file in an object's SQLite, bytes (a Durable Object's row is at most 2 MB). */
export const ROOM_CHUNK_BYTES = 1024 * 1024;
/** How long a room keeps a type's row before reading it again, ms. */
export const ROW_MAX_AGE_MS = 2_000;
/** How often a room with pages of a published type open checks its row (the hub may have forgotten it), ms. */
export const ROOM_CHECK_MS = 30_000;
/** The object's tables of copied type files. */
export const ROOM_TYPE_VERSIONS_TABLE = 'oa_type_versions';
export const ROOM_TYPE_FILES_TABLE = 'oa_type_files';

/** A uid and a version a site keeps (the host core's rules, `catalog/site-types.ts`). */
const SITE_TYPE_UID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SITE_TYPE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

const MIB = 1024 * 1024;

/** A row of the catalog's `types` table. */
export type SiteTypeRow = Parameters<SiteTypeServices['activated']>[0];
type SiteTypeCandidate = Awaited<ReturnType<SiteTypeServices['read']>>;

interface RawTypeRow {
  uid: string;
  id: string;
  name: string;
  version: string;
  description: string;
  publisher_user: string;
  visibility: string;
  sha256: string;
  bytes: number;
  capabilities: string;
  network: string;
  unpublished: number;
  created_at: string;
  updated_at: string;
}

const parseList = (text: string): string[] => {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

function rowOf(raw: RawTypeRow): SiteTypeRow {
  return {
    uid: raw.uid,
    id: raw.id,
    name: raw.name,
    version: raw.version,
    description: raw.description,
    publisherUser: raw.publisher_user,
    visibility: raw.visibility as SiteTypeRow['visibility'],
    sha256: raw.sha256,
    bytes: Number(raw.bytes),
    capabilities: parseList(raw.capabilities),
    network: parseList(raw.network),
    unpublished: Number(raw.unpublished) === 1,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

const ROW_COLUMNS = 'uid, id, name, version, description, publisher_user, visibility, sha256, bytes, capabilities, network, unpublished, created_at, updated_at';

/** The catalog row of a published type's id (listed or delisted), or null. */
export async function siteTypeRow(driver: SqlDriver, id: string): Promise<SiteTypeRow | null> {
  const raw = await driver.get<RawTypeRow>(`SELECT ${ROW_COLUMNS} FROM types WHERE id = ?`, [id]);
  return raw ? rowOf(raw) : null;
}

/** Every published type's row. */
export async function siteTypeRows(driver: SqlDriver): Promise<SiteTypeRow[]> {
  return (await driver.all<RawTypeRow>(`SELECT ${ROW_COLUMNS} FROM types ORDER BY id`)).map(rowOf);
}

/** The fingerprint of what a row serves (as on Node). */
export const stampOf = (row: Pick<SiteTypeRow, 'uid' | 'version' | 'sha256'>): string => `${row.uid}@${row.version}:${row.sha256.slice(0, 16)}`;

/** The CSP and `network` capability of a published type: its manifest's `openArtifact.network` (as on Node). */
export const policyOf = (row: Pick<SiteTypeRow, 'network'>): { contentSecurityPolicy: string; allowedNetworkOrigins: string[] } => ({
  contentSecurityPolicy: installedTypeCsp(row.network),
  allowedNetworkOrigins: [...row.network],
});

const tables = new WeakMap<object, Promise<void>>();

/** Makes the package tables, once per driver (a failure is tried again on the next call). */
export function ensureTypeTables(driver: SqlDriver): Promise<void> {
  let done = tables.get(driver);
  if (!done) {
    done = driver.batch([
      {
        sql: 'CREATE TABLE IF NOT EXISTS type_packages (uid TEXT NOT NULL, version TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, chunks INTEGER NOT NULL, complete INTEGER NOT NULL DEFAULT 0, written_at TEXT NOT NULL, PRIMARY KEY (uid, version))',
      },
      { sql: 'CREATE TABLE IF NOT EXISTS type_package_chunks (uid TEXT NOT NULL, version TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (uid, version, n))' },
    ]);
    done.catch(() => tables.delete(driver));
    tables.set(driver, done);
  }
  return done;
}

const mib = (bytes: number): string => `${(bytes / MIB).toFixed(1)} MiB`;

/** The refusal of a package over {@link CLOUDFLARE_TYPE_MAX_BYTES}. */
export function tooLargePackage(bytes?: number): OpenArtifactError {
  return new OpenArtifactError(
    'too_large',
    `The package is ${bytes === undefined ? 'larger than 16 MiB' : `${mib(bytes)} (${bytes} bytes)`}: a Cloudflare site keeps type packages of at most 16 MiB (a Node site takes more).`,
    { fix: 'Make the type smaller (its artifact-type/ files), or publish it to a Node site.', status: 413 },
  );
}

/** Reads every chunk of a complete version; null when it is not there whole (or not complete). */
async function readPackage(driver: SqlDriver, uid: string, version: string, sha256?: string): Promise<Uint8Array | null> {
  const head = await driver.get<{ sha256: string; bytes: number; chunks: number; complete: number }>('SELECT sha256, bytes, chunks, complete FROM type_packages WHERE uid = ? AND version = ?', [uid, version]);
  if (!head || Number(head.complete) !== 1 || (sha256 !== undefined && head.sha256 !== sha256)) return null;
  const chunks = Number(head.chunks);
  const out = new Uint8Array(Number(head.bytes));
  let at = 0;
  for (let from = 0; from < chunks; from += READ_BATCH) {
    const rows = await driver.all<{ n: number; data: string }>('SELECT n, data FROM type_package_chunks WHERE uid = ? AND version = ? AND n >= ? AND n < ? ORDER BY n', [uid, version, from, Math.min(chunks, from + READ_BATCH)]);
    for (let i = 0; i < rows.length; i++) {
      if (Number(rows[i]!.n) !== from + i) return null;
      const data = Buffer.from(rows[i]!.data, 'base64');
      if (at + data.byteLength > out.byteLength) return null;
      out.set(data, at);
      at += data.byteLength;
    }
    if (rows.length !== Math.min(chunks, from + READ_BATCH) - from) return null;
  }
  if (at !== out.byteLength) return null;
  if (createHash('sha256').update(out).digest('hex') !== head.sha256) return null;
  return out;
}

const CHECKED = Symbol('open-artifact.cloudflare.site-type.checked');

/** Every file of a package inflated once and checked (size, CRC), one at a time: refused as on Node. */
async function checkUnpacks(bytes: Uint8Array, pkg: CheckedTypePackage): Promise<void> {
  for (const file of pkg.files) {
    try {
      await unpackZipFile(bytes, file);
    } catch (error) {
      if (error instanceof ZipRefusal) throw new OpenArtifactError(error.code === 'too_large' ? 'too_large' : 'bad_archive', `The package: ${error.message}`);
      throw error;
    }
  }
}

export interface CloudflareSiteTypesOptions {
  driver: SqlDriver;
  /** A type's row changed or went: the rooms running it are told (the hub's `types/changed`). */
  changed(type: string): Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
}

/** The Link's `SiteTypeServices` over D1 (see the module comment). */
export function cloudflareSiteTypeServices(options: CloudflareSiteTypesOptions): SiteTypeServices {
  const { driver } = options;
  const now = options.now ?? (() => new Date());
  const tell = async (type: string): Promise<void> => {
    await options.changed(type).catch((error: unknown) => options.log?.(`types: telling the rooms of ${type} failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  return {
    async read(bytes): Promise<SiteTypeCandidate> {
      if (bytes.byteLength > CLOUDFLARE_TYPE_MAX_BYTES) throw tooLargePackage(bytes.byteLength);
      const pkg = await checkTypePackage(bytes, 'The package', { idFix: 'Give the type another slug in its artifact-type.json.' });
      const manifest = pkg.manifest as Record<string, unknown> & { entry?: unknown; openArtifact?: { style?: unknown } };
      if (manifest.entry !== undefined) throw new OpenArtifactError('unsupported', `${pkg.id} has an entry (a server of its own): a site runs only types that are pages.`);
      if (manifest.openArtifact?.style === 'page') throw new OpenArtifactError('unsupported', `${pkg.id} is a page type (openArtifact.style "page"): a site runs page artifacts as its own page type.`);
      if (!pkg.declared) throw new OpenArtifactError('unsupported', `${pkg.id} has no index.html with a // artifact.json declaration: a site runs only types that are pages.`);
      if (!SITE_TYPE_UID.test(pkg.uid)) throw new OpenArtifactError('invalid_argument', `The package's uid ${JSON.stringify(pkg.uid)} is not one a site keeps.`);
      if (!SITE_TYPE_VERSION.test(pkg.version)) throw new OpenArtifactError('invalid_argument', `The package's version ${JSON.stringify(pkg.version)} is not one a site keeps.`);
      return {
        id: pkg.id,
        uid: pkg.uid,
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        sha256: pkg.sha256,
        bytes: pkg.bytes,
        capabilities: pkg.capabilities,
        network: pkg.network,
        ...({ [CHECKED]: pkg } as object),
      };
    },

    async store(candidate, bytes) {
      if (bytes.byteLength > CLOUDFLARE_TYPE_MAX_BYTES) throw tooLargePackage(bytes.byteLength);
      const pkg = (candidate as { [CHECKED]?: CheckedTypePackage })[CHECKED] ?? (await checkTypePackage(bytes, 'The package'));
      await checkUnpacks(bytes, pkg);
      await ensureTypeTables(driver);
      const { uid, version } = candidate;
      const chunks = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES));
      // What an earlier, failed write of this version left (never the version a row serves: `plan` refuses that).
      await driver.batch([
        { sql: 'DELETE FROM type_packages WHERE uid = ? AND version = ?', params: [uid, version] },
        { sql: 'DELETE FROM type_package_chunks WHERE uid = ? AND version = ?', params: [uid, version] },
        { sql: 'INSERT INTO type_packages (uid, version, sha256, bytes, chunks, complete, written_at) VALUES (?, ?, ?, ?, ?, 0, ?)', params: [uid, version, candidate.sha256, bytes.byteLength, chunks, now().toISOString()] },
      ]);
      for (let from = 0; from < chunks; from += WRITE_BATCH) {
        const statements = [];
        for (let n = from; n < Math.min(chunks, from + WRITE_BATCH); n++) {
          const data = Buffer.from(bytes.buffer, bytes.byteOffset + n * CHUNK_BYTES, Math.min(CHUNK_BYTES, bytes.byteLength - n * CHUNK_BYTES)).toString('base64');
          statements.push({ sql: 'INSERT INTO type_package_chunks (uid, version, n, data) VALUES (?, ?, ?, ?)', params: [uid, version, n, data] });
        }
        await driver.batch(statements);
      }
      await driver.run('UPDATE type_packages SET complete = 1 WHERE uid = ? AND version = ?', [uid, version]);
    },

    async package(uid, version) {
      if (!SITE_TYPE_UID.test(uid) || !SITE_TYPE_VERSION.test(version)) return null;
      await ensureTypeTables(driver);
      return readPackage(driver, uid, version);
    },

    async removeFiles(uid, version) {
      if (!SITE_TYPE_UID.test(uid) || (version !== undefined && !SITE_TYPE_VERSION.test(version))) return;
      await ensureTypeTables(driver);
      const where = version === undefined ? 'uid = ?' : 'uid = ? AND version = ?';
      const params = version === undefined ? [uid] : [uid, version];
      // The version row first: a room never takes a version whose row is gone.
      await driver.batch([
        { sql: `DELETE FROM type_packages WHERE ${where}`, params },
        { sql: `DELETE FROM type_package_chunks WHERE ${where}`, params },
      ]);
    },

    async activated(row) {
      await tell(row.id);
    },

    async removed(row) {
      await tell(row.id);
    },
  };
}

/**
 * How an artifact archive names a published type (the Node site's `siteTypeImport`): its `.artifact.json` `type` and
 * `typeUid`, checked against the rows. `builtIn` says which ids the site runs itself.
 */
export function siteTypeImportRules(rows: readonly SiteTypeRow[], builtIn: (type: string) => boolean): { markerTypes: string[]; inspect: (marker: Record<string, unknown> | null) => void } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    markerTypes: [...byId.keys()],
    inspect(marker) {
      const type = typeof marker?.type === 'string' ? marker.type : null;
      if (!type || builtIn(type)) return;
      const uid = typeof marker?.typeUid === 'string' && marker.typeUid ? marker.typeUid : null;
      const row = byId.get(type);
      if (!row) {
        throw new OpenArtifactError('type_missing', `The archive was made with the type ${type}${uid ? ` (uid ${uid})` : ''}, and this site has no published type ${uid ? 'with that id and uid' : 'with that id'}.`, {
          fix: `Publish the type to this site first (open-artifact types publish ${type} --remote <site>), or publish the artifact with --with-type.`,
        });
      }
      if (!uid) throw new OpenArtifactError('type_mismatch', `The archive names the type ${type} without its uid, so it cannot be told from the type ${type} published here (uid ${row.uid}).`, { fix: "Publish it from the computer that made it: its .artifact.json there carries the type's uid." });
      if (uid !== row.uid) {
        throw new OpenArtifactError('type_mismatch', `The archive was made with the type ${type} (uid ${uid}), but the type ${type} published on this site is another one (uid ${row.uid}).`, {
          fix: 'Give one of the two types another id, then publish the type and the artifact again.',
        });
      }
      if (row.unpublished) throw new OpenArtifactError('not_granted', `The type ${type} was unpublished from this site: it takes no new artifacts.`, { fix: `Publish the type again (open-artifact types publish ${type} --remote <site>), then publish the artifact.` });
    },
  };
}

/** The title an artifact's own files hold at a type manifest's `titleFrom`, or undefined. */
export function titleFromManifest(manifest: Record<string, unknown>, root: string): string | undefined {
  const spec = manifest.titleFrom;
  const parsed = typeof spec === 'string' ? parseTitleFrom(spec) : null;
  if (!parsed) return undefined;
  let text: string;
  try {
    text = readFileSync(join(root, ...parsed.file.split('/')), 'utf8');
  } catch {
    return undefined;
  }
  return titleInFile(parsed.file, text, parsed.pointer)?.trim().slice(0, 200) || undefined;
}

// ---- the room's side ------------------------------------------------------------------------------------------------

/** What an object keeps of one copied version (its files are rows of {@link ROOM_TYPE_FILES_TABLE}). */
interface CopiedVersion {
  fp: string;
  manifest: Record<string, unknown>;
  indexHtml: string | null;
  sizes: Map<string, number>;
  mtimeMs: number;
}

/** The type source of a published type in an object: its current version's copied files, swapped on a new one. */
class CatalogTypeSource implements FrameTypeSource {
  readonly label: string;
  #v: CopiedVersion;
  readonly #read: (fp: string, path: string) => Uint8Array | null;

  constructor(id: string, v: CopiedVersion, read: (fp: string, path: string) => Uint8Array | null) {
    this.label = id;
    this.#v = v;
    this.#read = read;
  }

  swap(v: CopiedVersion): void {
    this.#v = v;
  }

  get fp(): string {
    return this.#v.fp;
  }

  fingerprint(): string {
    return this.#v.fp;
  }

  declaration() {
    const html = this.#v.indexHtml;
    const found = html === null ? null : readStaticDeclaration(html);
    return found ? { key: found.key, capabilities: found.capabilities, monitoring: found.monitoring } : null;
  }

  manifest(): Record<string, unknown> {
    return this.#v.manifest;
  }

  indexHtml(): string | null {
    return this.#v.indexHtml;
  }

  file(rel: string): FrameFile | null {
    if (!rel.startsWith('artifact-type/')) return null;
    const size = this.#v.sizes.get(rel);
    if (size === undefined) return null;
    const body = this.#read(this.#v.fp, rel);
    if (!body || body.byteLength !== size) return null;
    return { size, mtimeMs: this.#v.mtimeMs, body };
  }
}

/** Whether a package's file is one a room serves or reads (the rest stays in the package). */
const served = (path: string): boolean => path === 'index.html' || path === 'artifact-type.json' || path.startsWith('artifact-type/');


export interface CatalogFrameTypesOptions {
  /** The catalog's database (D1). */
  driver: SqlDriver;
  /** The object's own storage (its SQLite). */
  storage: SyncStorage;
  now?: () => number;
  log?: (line: string) => void;
}

/** A room's published types: {@link RoomFrameTypes} without the browser files (the bundled source has them). */
export interface CatalogFrameTypes {
  typeOf(type: string, options?: { fresh?: boolean }): Promise<SiteFrameType | null>;
  /** How an archive names a published type (import), read fresh. */
  imports(builtIn: (type: string) => boolean): Promise<{ markerTypes: string[]; inspect: (marker: Record<string, unknown> | null) => void }>;
  /** The title an artifact's files hold at its published type's `titleFrom`, or undefined. */
  contentTitle(type: string, root: string): Promise<string | undefined>;
  /** Drops what the object copied (the artifact was deleted). */
  drop(): void;
}

/** The published types as an object runs them (see the module comment). */
export function catalogFrameTypes(options: CatalogFrameTypesOptions): CatalogFrameTypes {
  const { driver, storage } = options;
  const sql = storage.sql;
  const now = options.now ?? (() => Date.now());
  const rows = new Map<string, { row: SiteTypeRow | null; at: number }>();
  const types = new Map<string, { source: CatalogTypeSource; type: SiteFrameType }>();
  const copying = new Map<string, Promise<CopiedVersion>>();
  let made = false;

  const ensureTables = (): void => {
    if (made) return;
    sql.exec(`CREATE TABLE IF NOT EXISTS ${ROOM_TYPE_VERSIONS_TABLE} (fp TEXT PRIMARY KEY, type TEXT NOT NULL, manifest TEXT NOT NULL, index_html TEXT, sizes TEXT NOT NULL) WITHOUT ROWID`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ${ROOM_TYPE_FILES_TABLE} (fp TEXT NOT NULL, path TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (fp, path, seq)) WITHOUT ROWID`);
    made = true;
  };

  const readFile = (fp: string, path: string): Uint8Array | null => {
    ensureTables();
    const parts = sql.exec<{ data: unknown }>(`SELECT data FROM ${ROOM_TYPE_FILES_TABLE} WHERE fp = ? AND path = ? ORDER BY seq`, fp, path).toArray().map((r) => blobBytes(r.data));
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : new Uint8Array(Buffer.concat(parts));
  };

  const mtimeOf = (row: SiteTypeRow): number => parseInt(row.sha256.slice(0, 12), 16) || 1;

  const kept = (row: SiteTypeRow): CopiedVersion | null => {
    ensureTables();
    const fp = stampOf(row);
    const meta = sql.exec<{ manifest: string; index_html: string | null; sizes: string }>(`SELECT manifest, index_html, sizes FROM ${ROOM_TYPE_VERSIONS_TABLE} WHERE fp = ?`, fp).toArray()[0];
    if (!meta) return null;
    const sizes = new Map(Object.entries(JSON.parse(meta.sizes) as Record<string, number>));
    // index.html is a file row like the others (a page can be larger than one SQLite value); an older copy kept it inline.
    let indexHtml = meta.index_html;
    if (sizes.has('index.html')) {
      const body = readFile(fp, 'index.html');
      if (!body || body.byteLength !== sizes.get('index.html')) return null;
      indexHtml = Buffer.from(body).toString('utf8');
    }
    return { fp, manifest: JSON.parse(meta.manifest) as Record<string, unknown>, indexHtml, sizes, mtimeMs: mtimeOf(row) };
  };

  /** Copies a version from D1 into the object (the old versions of the type are dropped in the same transaction). */
  const copy = async (row: SiteTypeRow): Promise<CopiedVersion> => {
    await ensureTypeTables(driver);
    const bytes = await readPackage(driver, row.uid, row.version, row.sha256);
    if (!bytes) throw Object.assign(new Error(`The package of ${row.id} ${row.version} is not on this site whole (being published or removed): open the artifact again in a moment.`), { code: 'unavailable', status: 503 });
    const pkg = await checkTypePackage(bytes, `The package of ${row.id} ${row.version}`);
    const fp = stampOf(row);
    let manifest: Record<string, unknown> = {};
    let indexHtml: string | null = null;
    const sizes: Record<string, number> = {};
    ensureTables();
    // Written file by file (an isolate holds the zip and one file), then the version's row, in one transaction.
    storage.transactionSync(() => {
      sql.exec(`DELETE FROM ${ROOM_TYPE_FILES_TABLE} WHERE fp = ?`, fp);
      sql.exec(`DELETE FROM ${ROOM_TYPE_VERSIONS_TABLE} WHERE fp = ?`, fp);
    });
    for (const file of pkg.files) {
      if (!served(file.path)) continue;
      let data: Uint8Array;
      try {
        data = await unpackZipFile(bytes, file);
      } catch (error) {
        throw Object.assign(new Error(`The package of ${row.id} ${row.version}: ${error instanceof Error ? error.message : String(error)}`), { code: 'bad_archive', status: 500 });
      }
      if (file.path === 'artifact-type.json') manifest = JSON.parse(Buffer.from(data).toString('utf8')) as Record<string, unknown>;
      else {
        // index.html and the artifact-type/ files go in rows of at most ROOM_CHUNK_BYTES (an object's SQLite keeps a
        // value of at most 8 MB; a package's file may be 16 MiB).
        if (file.path === 'index.html') indexHtml = Buffer.from(data).toString('utf8');
        sizes[file.path] = data.byteLength;
        const parts = Math.max(1, Math.ceil(data.byteLength / ROOM_CHUNK_BYTES));
        storage.transactionSync(() => {
          for (let seq = 0; seq < parts; seq++) sql.exec(`INSERT INTO ${ROOM_TYPE_FILES_TABLE} (fp, path, seq, data) VALUES (?, ?, ?, ?)`, fp, file.path, seq, blobBinding(data.subarray(seq * ROOM_CHUNK_BYTES, (seq + 1) * ROOM_CHUNK_BYTES)));
        });
      }
    }
    storage.transactionSync(() => {
      sql.exec(`INSERT INTO ${ROOM_TYPE_VERSIONS_TABLE} (fp, type, manifest, index_html, sizes) VALUES (?, ?, ?, NULL, ?)`, fp, row.id, JSON.stringify(manifest), JSON.stringify(sizes));
      // The type's other versions: nothing serves them now (a core of this type swaps to this one).
      for (const old of sql.exec<{ fp: string }>(`SELECT fp FROM ${ROOM_TYPE_VERSIONS_TABLE} WHERE type = ? AND fp != ?`, row.id, fp).toArray()) {
        sql.exec(`DELETE FROM ${ROOM_TYPE_FILES_TABLE} WHERE fp = ?`, old.fp);
        sql.exec(`DELETE FROM ${ROOM_TYPE_VERSIONS_TABLE} WHERE fp = ?`, old.fp);
      }
    });
    options.log?.(`types: ${row.id} ${row.version} copied (${Object.keys(sizes).length} files)`);
    return { fp, manifest, indexHtml, sizes: new Map(Object.entries(sizes)), mtimeMs: mtimeOf(row) };
  };

  const versionOf = (row: SiteTypeRow): Promise<CopiedVersion> => {
    const fp = stampOf(row);
    let loading = copying.get(fp);
    if (!loading) {
      loading = (async () => kept(row) ?? (await copy(row)))();
      copying.set(fp, loading);
      loading.then(
        () => copying.delete(fp),
        () => copying.delete(fp),
      );
    }
    return loading;
  };

  const rowFor = async (id: string, fresh: boolean): Promise<SiteTypeRow | null> => {
    const have = rows.get(id);
    if (have && !fresh && now() - have.at < ROW_MAX_AGE_MS) return have.row;
    const row = await siteTypeRow(driver, id);
    rows.set(id, { row, at: now() });
    return row;
  };

  return {
    async typeOf(type, o = {}) {
      const row = await rowFor(type, o.fresh === true);
      if (!row) {
        types.delete(type);
        return null;
      }
      const have = types.get(type);
      const policy = policyOf(row);
      if (have && have.source.fp === stampOf(row)) {
        have.type.policy = policy;
        return have.type;
      }
      const version = await versionOf(row);
      const again = types.get(type);
      if (again) {
        again.source.swap(version);
        again.type.policy = policy;
        return again.type;
      }
      const source = new CatalogTypeSource(type, version, readFile);
      const entry = { source, type: { source, page: false, policy, published: true } satisfies SiteFrameType };
      types.set(type, entry);
      return entry.type;
    },

    async imports(builtIn) {
      return siteTypeImportRules(await siteTypeRows(driver), builtIn);
    },

    async contentTitle(type, root) {
      const found = await this.typeOf(type).catch(() => null);
      return found ? titleFromManifest(found.source.manifest(), root) : undefined;
    },

    drop() {
      sql.exec(`DROP TABLE IF EXISTS ${ROOM_TYPE_FILES_TABLE}`);
      sql.exec(`DROP TABLE IF EXISTS ${ROOM_TYPE_VERSIONS_TABLE}`);
      made = false;
      types.clear();
      rows.clear();
    },
  };
}

/** The built-in frame types first (`page`), then the published ones. */
export function withCatalogTypes(base: RoomFrameTypes, catalog: CatalogFrameTypes): RoomFrameTypes {
  return {
    typeOf: async (type, o) => (await base.typeOf(type, o)) ?? catalog.typeOf(type, o),
    client: (): Promise<FrameClientFiles> => base.client(),
    catalog,
  };
}
