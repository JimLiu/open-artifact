/**
 * The artifact's versions, kept in memory: each version is an author's burst of changes (it ends after a 30 s pause),
 * with a snapshot of every entry right after it, so previews, diffs and restores read straight from it. The first
 * version is the seed (`system`). There are no notices: one person on one page never overwrites someone else.
 */

import { ArtifactError, type FileListing, type HistoryChangeEvent, type HistoryFileChange, type HistoryFileDiff, type HistoryListing, type HistoryRestoreResult, type HistoryVersion, type PublishBatch, type DbWrite, type JsonRecord } from '@open-artifact/runtime';
import { channel, toBase64 } from './events.ts';
import type { DemoStore, Entry } from './store.ts';

export type Author = HistoryVersion['author'];

type Op = HistoryFileChange['op'];

interface Version {
  n: number;
  first: string;
  at: string;
  author: Author;
  files: Map<string, Op>;
  restoredFrom?: number;
  snapshot: Map<string, Entry>;
}

const BURST_MS = 30_000;
const SYSTEM: Author = { kind: 'system', id: 'system', name: '' };
const TEXT = /\.(?:json|html?|css|md|txt|svg|js|mjs|csv|tsv|xml|ya?ml)$/i;
const decoder = new TextDecoder();

export class HistoryLog {
  private versions: Version[] = [];
  private restoring: number | null = null;
  readonly changes = channel<HistoryChangeEvent>();

  constructor(private readonly store: DemoStore) {}

  start(paths: string[]): void {
    const now = new Date().toISOString();
    this.versions = [{ n: 1, first: now, at: now, author: SYSTEM, files: new Map(paths.map((p) => [p, 'added'])), snapshot: new Map(this.store.entries) }];
  }

  /** Records a change the store just made. */
  record(author: Author, ops: Record<string, Op>): void {
    const now = new Date();
    const last = this.versions[this.versions.length - 1];
    const sameBurst =
      last &&
      (this.restoring !== null
        ? last.restoredFrom === this.restoring
        : last.restoredFrom === undefined && last.author.kind !== 'system' && last.author.id === author.id && now.getTime() - Date.parse(last.at) < BURST_MS);
    const version: Version = sameBurst
      ? last
      : {
          n: (last?.n ?? 0) + 1,
          first: now.toISOString(),
          at: now.toISOString(),
          author,
          files: new Map(),
          snapshot: new Map(),
          ...(this.restoring !== null ? { restoredFrom: this.restoring } : {}),
        };
    for (const [path, op] of Object.entries(ops)) {
      const was = version.files.get(path);
      // Added then edited in one burst is still an addition; added then deleted leaves nothing.
      if (was === 'added' && op === 'deleted') version.files.delete(path);
      else version.files.set(path, was === 'added' ? 'added' : op);
    }
    version.at = now.toISOString();
    version.snapshot = new Map(this.store.entries);
    if (!sameBurst) this.versions.push(version);
    this.changes.emit({ n: version.n });
  }

  list(): HistoryListing {
    const newest = this.versions[this.versions.length - 1]?.n;
    const versions = [...this.versions].reverse().map((v): HistoryVersion => ({
      n: v.n,
      first: v.first,
      at: v.at,
      author: v.author,
      files: [...v.files].map(([path, op]) => ({ path, op })).sort((a, b) => a.path.localeCompare(b.path)),
      ...(v.restoredFrom !== undefined ? { restoredFrom: v.restoredFrom } : {}),
      ...(v.n === newest ? { current: true as const } : {}),
    }));
    return { versions, notices: [], canRestore: true };
  }

  private version(n: number): Version {
    const found = this.versions.find((v) => v.n === n);
    if (!found) throw new ArtifactError('not_found', `No version ${n}.`);
    return found;
  }

  files(n: number): FileListing {
    const out: FileListing = {};
    for (const [path, entry] of this.version(n).snapshot) out[path] = { sha256: entry.sha256, size: entry.bytes.length };
    return out;
  }

  readBytes(n: number, path: string): Uint8Array {
    const entry = this.version(n).snapshot.get(path);
    if (!entry) throw new ArtifactError('not_found', `${path} did not exist after version ${n}.`);
    return entry.bytes.slice();
  }

  diff(n: number, path: string): HistoryFileDiff {
    const version = this.version(n);
    const index = this.versions.indexOf(version);
    const before = index > 0 ? this.versions[index - 1]!.snapshot.get(path) : undefined;
    const after = version.snapshot.get(path);
    const op: Op = version.files.get(path) ?? (before ? (after ? 'edited' : 'deleted') : 'added');
    const binary = !path.startsWith('db/') && !TEXT.test(path);
    const text = (entry: Entry | undefined): string | null => (entry && !binary ? decoder.decode(entry.bytes) : null);
    return { path, n, op, before: text(before), after: text(after), ...(binary ? { binary: true as const } : {}) };
  }

  /** Brings version `n` back through the store's own write paths, as one version of its own. */
  async restore(n: number, paths?: string[]): Promise<HistoryRestoreResult> {
    const target = this.version(n).snapshot;
    // An engine's own files (a doc's `doc/…`, a workbook's `sheet/…`) are its to restore: the editor's own version
    // history does that through the engine. Only project files and documents come back from here.
    const restorable = (path: string): boolean => path.startsWith('project/') || path.startsWith('db/');
    const wanted = (paths ?? [...new Set([...target.keys(), ...this.store.entries.keys()])]).filter(restorable);
    const batch: PublishBatch = {};
    const writes: DbWrite[] = [];
    const changed: string[] = [];
    for (const path of wanted) {
      const then = target.get(path);
      const now = this.store.entries.get(path);
      if (then?.sha256 === now?.sha256) continue;
      changed.push(path);
      if (path.startsWith('db/')) {
        const doc = path.slice(3);
        writes.push(then ? { op: 'set', path: doc, data: JSON.parse(decoder.decode(then.bytes)) as JsonRecord } : { op: 'delete', path: doc });
      } else {
        batch[path] = then ? { content: toBase64(then.bytes), encoding: 'base64' } : null;
      }
    }
    if (!changed.length) return { version: null, changed };
    this.restoring = n;
    try {
      if (Object.keys(batch).length) await this.store.publish(batch, 'restore');
      if (writes.length) await this.store.writeDocs(writes, 'restore');
    } finally {
      this.restoring = null;
    }
    return { version: this.versions[this.versions.length - 1]!.n, changed };
  }
}
