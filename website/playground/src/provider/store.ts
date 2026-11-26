/**
 * The artifact, in memory: what the type server keeps on disk. One map of entries by artifact-relative path holds both
 * storage models: `project/…` files (the `artifact` capability) and `db/<document path>` documents (the `db`
 * capability, each kept as its compact JSON, so its hash is the one the db contract names). Every change is recorded
 * as a version ({@link HistoryLog}) and, unless the page made it, reported to the page as the type server would.
 */

import {
  ArtifactError,
  type ConflictPath,
  type DbChangeEvent,
  type DbDocument,
  type DbReceipt,
  type DbWrite,
  type FileListing,
  type FilesChangedEvent,
  type JsonRecord,
  type JsonValue,
  type PublishBatch,
  type PublishResult,
} from '@open-artifact/runtime';
import { channel, randomId, sha256 } from './events.ts';
import { HistoryLog, type Author } from './history.ts';

export interface Entry {
  bytes: Uint8Array;
  sha256: string;
}

const DB = 'db/';
const SEGMENT = /^[A-Za-z0-9_.~:@+-]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Whether `path` is a document path: an even number of segments, none `.` or `..`. */
function isDocPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length >= 2 && parts.length % 2 === 0 && parts.every((part) => SEGMENT.test(part) && part !== '.' && part !== '..');
}

function isProjectPath(path: string): boolean {
  return /^project\/[^\0]+$/.test(path) && !path.split('/').some((part) => part === '' || part === '.' || part === '..');
}

const isPlain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** RFC 7396 JSON merge patch. */
function mergePatch(target: JsonValue | undefined, patch: JsonValue): JsonValue {
  if (!isPlain(patch)) return patch;
  const out: Record<string, JsonValue> = isPlain(target) ? { ...(target as Record<string, JsonValue>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, JsonValue>)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}

function base64Bytes(content: string): Uint8Array {
  return Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
}

/** Who changed something: the page's person, the simulated agent, or a history restore. */
export type Origin = 'person' | 'agent' | 'restore';

export class DemoStore {
  readonly entries = new Map<string, Entry>();
  /** The db order: a new epoch per page load, `seq` counts change events. */
  readonly epoch = randomId(6);
  seq = 0;
  readonly files = channel<FilesChangedEvent>();
  readonly db = channel<DbChangeEvent>();
  readonly history = new HistoryLog(this);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly id: string,
    public title: string,
  ) {}

  /** Runs `task` after every change before it (writes hash asynchronously; this keeps them in order). */
  serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Fills the store from a seed (no events, no version but the first). */
  async load(files: Map<string, Uint8Array>, docs: Map<string, JsonRecord>): Promise<void> {
    for (const [path, bytes] of files) this.entries.set(path, { bytes, sha256: await sha256(bytes) });
    for (const [path, data] of docs) {
      const bytes = encoder.encode(JSON.stringify(data));
      this.entries.set(DB + path, { bytes, sha256: await sha256(bytes) });
    }
    this.history.start([...this.entries.keys()]);
  }

  /* ---- files ----------------------------------------------------------- */

  list(): FileListing {
    const out: FileListing = {};
    for (const [path, entry] of [...this.entries].sort(([a], [b]) => a.localeCompare(b))) {
      if (!path.startsWith(DB)) out[path] = { sha256: entry.sha256, size: entry.bytes.length };
    }
    return out;
  }

  readBytes(path: string): Uint8Array {
    const entry = path.startsWith(DB) ? undefined : this.entries.get(path);
    if (!entry) throw new ArtifactError('not_found', `No file ${path}.`);
    return entry.bytes.slice();
  }

  readText(path: string): string {
    return decoder.decode(this.readBytes(path));
  }

  /** Writes a batch atomically (every `ifMatch` checked first). The page's own publishes are not echoed back to it. */
  publish(batch: PublishBatch, origin: Origin): Promise<PublishResult> {
    return this.serial(async () => {
      const entries = Object.entries(batch ?? {});
      const conflicts: ConflictPath[] = [];
      for (const [path, file] of entries) {
        if (!isProjectPath(path)) throw new ArtifactError('invalid', `${path} is not a project/ path.`);
        if (file && file.ifMatch !== undefined) {
          const actual = this.entries.get(path)?.sha256 ?? null;
          if (actual !== file.ifMatch) conflicts.push({ path, expected: file.ifMatch, actual });
        }
      }
      if (conflicts.length) throw new ArtifactError('conflict', 'The files changed since they were read.', conflicts);
      const hashes: Record<string, string | null> = {};
      const changed: Record<string, 'added' | 'edited' | 'deleted'> = {};
      for (const [path, file] of entries) {
        const had = this.entries.get(path);
        if (!file) {
          if (had) {
            this.entries.delete(path);
            changed[path] = 'deleted';
          }
          hashes[path] = null;
          continue;
        }
        const bytes = file.encoding === 'base64' ? base64Bytes(file.content) : encoder.encode(file.content);
        const hash = await sha256(bytes);
        hashes[path] = hash;
        if (had?.sha256 === hash) continue;
        this.entries.set(path, { bytes, sha256: hash });
        changed[path] = had ? 'edited' : 'added';
      }
      if (Object.keys(changed).length) {
        this.history.record(authorOf(origin), changed);
        if (origin !== 'person') {
          const changes: Record<string, string | null> = {};
          for (const path of Object.keys(changed)) changes[path] = this.entries.get(path)?.sha256 ?? null;
          this.files.emit({ changes, author: origin === 'agent' ? 'agent' : 'owner' });
        }
      }
      return { hashes };
    });
  }

  /* ---- documents ------------------------------------------------------- */

  getDoc(path: string): JsonRecord | null {
    if (!isDocPath(path)) throw new ArtifactError('invalid', `${path} is not a document path.`);
    const entry = this.entries.get(DB + path);
    return entry ? (JSON.parse(decoder.decode(entry.bytes)) as JsonRecord) : null;
  }

  listDocs(collection: string): DbDocument[] {
    const prefix = `${DB}${collection}/`;
    const out: DbDocument[] = [];
    for (const [path, entry] of this.entries) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
      out.push({ path: path.slice(DB.length), data: JSON.parse(decoder.decode(entry.bytes)) as JsonRecord });
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /** Applies a batch in order, all or nothing. The page's own writes are not echoed back to it. */
  writeDocs(writes: DbWrite[], origin: Origin): Promise<DbReceipt> {
    return this.serial(async () => {
      if (!Array.isArray(writes)) throw new ArtifactError('invalid', 'writes is a list.');
      const conflicts: ConflictPath[] = [];
      const next = new Map<string, JsonRecord | null>();
      const current = (path: string): JsonRecord | null => (next.has(path) ? next.get(path)! : this.getDoc(path));
      for (const write of writes) {
        if (!write || typeof write.path !== 'string' || !isDocPath(write.path)) throw new ArtifactError('invalid', `Bad document path ${String(write?.path)}.`);
        if (write.ifMatch !== undefined) {
          const doc = current(write.path);
          const actual = doc ? await sha256(encoder.encode(JSON.stringify(doc))) : null;
          if (actual !== write.ifMatch) conflicts.push({ path: write.path, expected: write.ifMatch, actual });
        }
        if (write.op === 'set') {
          if (!isPlain(write.data)) throw new ArtifactError('invalid', `set ${write.path}: data is an object.`);
          next.set(write.path, write.data);
        } else if (write.op === 'update') {
          next.set(write.path, mergePatch(current(write.path) ?? {}, write.patch) as JsonRecord);
        } else if (write.op === 'delete') {
          next.set(write.path, null);
        } else {
          throw new ArtifactError('invalid', `Unknown op ${String((write as { op?: unknown }).op)}.`);
        }
      }
      if (conflicts.length) throw new ArtifactError('conflict', 'The documents changed since they were read.', conflicts);
      const changes: Record<string, JsonRecord | null> = {};
      const ops: Record<string, 'added' | 'edited' | 'deleted'> = {};
      for (const [path, data] of next) {
        const key = DB + path;
        const had = this.entries.get(key);
        if (data === null) {
          if (!had) continue;
          this.entries.delete(key);
          changes[path] = null;
          ops[key] = 'deleted';
          continue;
        }
        const bytes = encoder.encode(JSON.stringify(data));
        const hash = await sha256(bytes);
        if (had?.sha256 === hash) continue;
        this.entries.set(key, { bytes, sha256: hash });
        changes[path] = data;
        ops[key] = had ? 'edited' : 'added';
      }
      if (Object.keys(changes).length) {
        this.seq += 1;
        this.history.record(authorOf(origin), ops);
        if (origin !== 'person') this.db.emit({ changes, author: origin === 'agent' ? 'agent' : 'owner', epoch: this.epoch, seq: this.seq });
      }
      const documents: Record<string, JsonRecord | null> = {};
      for (const path of next.keys()) documents[path] = this.getDoc(path);
      return { epoch: this.epoch, seq: this.seq, documents };
    });
  }

  /* ---- engine folders -------------------------------------------------- */

  /**
   * Takes in the files an engine keeps (the Docs host's `doc/…`, the Sheets store's `sheet/…`) as they stand now, as
   * one change of `origin` in the history: the engine is where they are written, this is the artifact's copy of them
   * (what history versions and `artifact.list` show). Nothing is reported to the page, which hears the engine itself.
   * Only paths under `prefix` are touched.
   */
  mirror(prefix: string, files: Record<string, Uint8Array>, origin: Origin): Promise<number> {
    return this.serial(async () => {
      const ops: Record<string, 'added' | 'edited' | 'deleted'> = {};
      for (const [path, bytes] of Object.entries(files)) {
        if (!path.startsWith(prefix)) continue;
        const had = this.entries.get(path);
        const hash = await sha256(bytes);
        if (had?.sha256 === hash) continue;
        this.entries.set(path, { bytes, sha256: hash });
        ops[path] = had ? 'edited' : 'added';
      }
      for (const path of [...this.entries.keys()]) {
        if (path.startsWith(prefix) && !(path in files)) {
          this.entries.delete(path);
          ops[path] = 'deleted';
        }
      }
      const count = Object.keys(ops).length;
      if (count) this.history.record(authorOf(origin), ops);
      return count;
    });
  }

  /** The entry's content as text, for history previews. */
  static text(entry: Entry): string {
    return decoder.decode(entry.bytes);
  }
}

export const PERSON: Author = { kind: 'person', id: 'demo-visitor', name: 'You' };
export const AGENT: Author = { kind: 'agent', id: 'agent', name: 'Agent' };

function authorOf(origin: Origin): Author {
  return origin === 'agent' ? AGENT : PERSON;
}
