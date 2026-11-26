/**
 * Version history of one artifact folder: who changed which file when, and
 * what each file held, so people can see what changed, preview an older
 * version and bring it back.
 *
 *     <root>/history/index.json         the versions (oldest first), the base and the notices
 *     <root>/history/objects/<sha256>   every content a kept version holds, once
 *
 * A tracked path is a page file (`project/canvas.json`) or a db document
 * (`db/elements/n1`, held as two-space JSON). A version records what each
 * path it changed holds after it: a sha, or `null` for a delete.
 *
 * Every change the server sees is recorded: a page's publish or db write,
 * with the person who made it, and a change on disk (the agent, an editor,
 * git), which is the agent's. Each record is compared with the head (path →
 * sha after the newest version) first, so a change seen twice (the page's
 * save, then the watcher) is one version, and a change that changes nothing
 * is none. An author's changes join their open version until they pause
 * {@link HISTORY_IDLE_MS} or it spans {@link HISTORY_SPAN_MS}, so one burst of
 * edits is one version. Bringing a version back is a version of its own
 * (`restoredFrom`) and never joins another. Past {@link HISTORY_MAX_VERSIONS}
 * the oldest fold into `base`, what the files held before the first kept
 * version, and contents nobody holds any more are removed.
 *
 * Notices: when someone else's write (usually the agent's) undoes part of a
 * change a person made less than a minute before, the version records
 * `overwrote` and the person gets a notice. Whether part was undone is a
 * guess: the person's change (before → theirs) is applied again to what was
 * written, as a JSON merge patch for JSON contents or line by line for text;
 * if that would change it, part of theirs is gone. A notice goes when it is
 * dismissed, when the lost content is in the file again, or when its person
 * restores that file.
 *
 * Several processes may share one folder (the server, the CLI): the index is
 * re-read whenever it changed on disk, and written atomically.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import type { HistoryAuthor, HistoryFileChange } from '@open-artifact/runtime/capabilities';

/** Folder of the history, under the artifact root. */
export const HISTORY_DIR = 'history';
const INDEX = 'index.json';
const OBJECTS = 'objects';

/** An author's changes join their open version until a pause this long… */
export const HISTORY_IDLE_MS = 30_000;
/** …or until the version spans this long. */
export const HISTORY_SPAN_MS = 5 * 60_000;
/** Versions kept; the oldest fold into the base. */
export const HISTORY_MAX_VERSIONS = 500;
/** Two changes this close, by two authors, on one path: the second may have undone part of the first. */
export const HISTORY_OVERLAP_MS = 60_000;
/** Notices kept per person, and for how many days. */
const MAX_NOTICES = 50;
const NOTICE_DAYS = 7;

/** Changes made on disk, outside the pages: the agent's (or the owner's own in an editor). */
export const HISTORY_AGENT: HistoryAuthor = { kind: 'agent', id: 'agent', name: 'Agent' };
/** What the files held when the history began. */
export const HISTORY_SYSTEM: HistoryAuthor = { kind: 'system', id: 'system', name: '' };

/** What a write undid: `path` as version `n`, by `author`, had left it (`lost`: a sha, or null for a delete). */
export interface StoredOverwrite {
  path: string;
  lost: string | null;
  n: number;
  author: HistoryAuthor;
}

/** One version as stored. */
export interface StoredVersion {
  /** Numbers the versions from 1, never reused. */
  n: number;
  /** First and last change in it (ISO 8601). */
  first: string;
  at: string;
  author: HistoryAuthor;
  /** path → its sha after this version, or null: deleted. */
  changes: Record<string, string | null>;
  /** A restore: the version it brought back. */
  restoredFrom?: number;
  overwrote?: StoredOverwrite[];
}

/** A notice to one person: part of their change was undone. */
export interface StoredNotice {
  id: string;
  /** The person's id (the agent's lost changes go to the owner). */
  to: string;
  at: string;
  path: string;
  /** The version that undid it, and who made it. */
  n: number;
  author: HistoryAuthor;
  /** What was undone: the content their version left (null: their delete). */
  lost: { sha: string | null; n: number; author: HistoryAuthor };
}

interface IndexFile {
  format: 1;
  next: number;
  base: Record<string, string>;
  versions: StoredVersion[];
  notices: StoredNotice[];
}

/** Options of {@link History}. */
export interface HistoryOptions {
  /** Versions kept (default {@link HISTORY_MAX_VERSIONS}). */
  maxVersions?: number;
  /** Pause that ends a version (default {@link HISTORY_IDLE_MS}). */
  idleMs?: number;
  /** Longest version (default {@link HISTORY_SPAN_MS}). */
  spanMs?: number;
  /** Who gets the notices about the agent's lost changes (default `owner`). */
  ownerId?: string;
}

const SHA = /^[0-9a-f]{64}$/;

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const emptyIndex = (): IndexFile => ({ format: 1, next: 1, base: {}, versions: [], notices: [] });

function readAuthor(value: unknown): HistoryAuthor | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  if (value.kind !== 'person' && value.kind !== 'agent' && value.kind !== 'system') return null;
  return { kind: value.kind, id: value.id, name: value.name };
}

/** The index as saved, anything malformed left out (a hand-edited file never stops the server). */
function parseIndex(raw: unknown): IndexFile {
  const index = emptyIndex();
  if (!isRecord(raw)) return index;
  if (isRecord(raw.base)) for (const [p, s] of Object.entries(raw.base)) if (typeof s === 'string' && SHA.test(s)) index.base[p] = s;
  if (Array.isArray(raw.versions)) {
    for (const v of raw.versions) {
      if (!isRecord(v) || typeof v.n !== 'number' || typeof v.at !== 'string' || !isRecord(v.changes)) continue;
      const author = readAuthor(v.author);
      if (!author) continue;
      const changes: Record<string, string | null> = {};
      for (const [p, s] of Object.entries(v.changes)) if (s === null || (typeof s === 'string' && SHA.test(s))) changes[p] = s;
      const version: StoredVersion = { n: v.n, first: typeof v.first === 'string' ? v.first : v.at, at: v.at, author, changes };
      if (typeof v.restoredFrom === 'number') version.restoredFrom = v.restoredFrom;
      if (Array.isArray(v.overwrote)) {
        const list: StoredOverwrite[] = [];
        for (const o of v.overwrote) {
          const who = isRecord(o) ? readAuthor(o.author) : null;
          if (!isRecord(o) || !who || typeof o.path !== 'string' || typeof o.n !== 'number' || (o.lost !== null && typeof o.lost !== 'string')) continue;
          list.push({ path: o.path, lost: o.lost as string | null, n: o.n, author: who });
        }
        if (list.length) version.overwrote = list;
      }
      index.versions.push(version);
    }
  }
  index.versions.sort((a, b) => a.n - b.n);
  index.next = Math.max(typeof raw.next === 'number' ? raw.next : 1, (index.versions.at(-1)?.n ?? 0) + 1);
  if (Array.isArray(raw.notices)) {
    for (const n of raw.notices) {
      if (!isRecord(n) || typeof n.id !== 'string' || typeof n.to !== 'string' || typeof n.path !== 'string' || typeof n.n !== 'number') continue;
      const author = readAuthor(n.author);
      const lost = isRecord(n.lost) ? n.lost : null;
      const lostAuthor = lost ? readAuthor(lost.author) : null;
      if (!author || !lost || !lostAuthor || typeof lost.n !== 'number' || (lost.sha !== null && typeof lost.sha !== 'string')) continue;
      index.notices.push({
        id: n.id,
        to: n.to,
        at: typeof n.at === 'string' ? n.at : new Date(0).toISOString(),
        path: n.path,
        n: n.n,
        author,
        lost: { sha: lost.sha as string | null, n: lost.n, author: lostAuthor },
      });
    }
  }
  return index;
}

function writeAtomicSync(file: string, data: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, data, { flag: 'wx' });
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Whether two authors are the same person (or both the agent). */
export function sameAuthor(a: HistoryAuthor, b: HistoryAuthor): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** The history of one artifact folder. */
export class History {
  /** Absolute path of `history/`. */
  readonly dir: string;
  private readonly root: string;
  private directory: WorkspaceDirectory | undefined;
  private readonly maxVersions: number;
  private readonly idleMs: number;
  private readonly spanMs: number;
  private readonly ownerId: string;
  private index: IndexFile = emptyIndex();
  /** path → sha: what the files hold after the newest version. */
  private headState = new Map<string, string>();
  /** mtime and size of the index as last read or written. */
  private stamp = '';

  constructor(root: string, options: HistoryOptions = {}) {
    this.root = resolve(root);
    this.dir = join(this.root, HISTORY_DIR);
    this.maxVersions = Math.max(1, options.maxVersions ?? HISTORY_MAX_VERSIONS);
    this.idleMs = options.idleMs ?? HISTORY_IDLE_MS;
    this.spanMs = options.spanMs ?? HISTORY_SPAN_MS;
    this.ownerId = options.ownerId ?? 'owner';
    this.sync();
  }

  /* ---- loading ----------------------------------------------------------- */

  private get files(): WorkspaceDirectory {
    return this.directory ??= new WorkspaceDirectory(this.root);
  }

  private writableFiles(): WorkspaceDirectory {
    if (!this.directory) mkdirSync(this.root, { recursive: true });
    return this.files;
  }

  private stampNow(): string {
    try {
      const info = statSync(this.files.resolve(join(this.dir, INDEX)));
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      return 'none';
    }
  }

  /** Re-reads the index when another process changed it. */
  private sync(): void {
    const stamp = this.stampNow();
    if (stamp === this.stamp) return;
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.files.resolve(join(this.dir, INDEX)), 'utf8'));
    } catch {
      // No history yet (or an unreadable one: it starts again).
    }
    this.index = parseIndex(raw);
    this.headState = this.fold(Infinity);
    this.stamp = stamp;
  }

  private save(): void {
    writeAtomicSync(this.writableFiles().resolve(join(this.dir, INDEX), false), `${JSON.stringify(this.index)}\n`);
    this.stamp = this.stampNow();
  }

  /* ---- reading ----------------------------------------------------------- */

  /** True when nothing was ever recorded. */
  get empty(): boolean {
    this.sync();
    return this.index.versions.length === 0 && Object.keys(this.index.base).length === 0;
  }

  /** What the files hold now, as far as the history knows (path → sha). */
  head(): ReadonlyMap<string, string> {
    this.sync();
    return this.headState;
  }

  /** The kept versions, oldest first. */
  versions(): readonly StoredVersion[] {
    this.sync();
    return this.index.versions;
  }

  version(n: number): StoredVersion | undefined {
    this.sync();
    return this.index.versions.find((v) => v.n === n);
  }

  /** The files after the versions numbered up to `upto` (the base and every version at or below it). */
  private fold(upto: number): Map<string, string> {
    const state = new Map(Object.entries(this.index.base));
    for (const version of this.index.versions) {
      if (version.n > upto) break;
      for (const [p, s] of Object.entries(version.changes)) {
        if (s === null) state.delete(p);
        else state.set(p, s);
      }
    }
    return state;
  }

  /** The files right after version `n`; null when it is not kept. */
  stateAt(n: number): Map<string, string> | null {
    return this.version(n) ? this.fold(n) : null;
  }

  /** The files right before version `n`. */
  stateBefore(n: number): Map<string, string> {
    this.sync();
    return this.fold(n - 1);
  }

  /** The content with this sha, or null when it is not kept. */
  read(sha: string): Buffer | null {
    if (!SHA.test(sha)) return null;
    try {
      return readFileSync(this.files.resolve(join(this.dir, OBJECTS, sha)));
    } catch {
      return null;
    }
  }

  /** Size of a kept content, bytes. */
  size(sha: string): number | null {
    if (!SHA.test(sha)) return null;
    try {
      return statSync(this.files.resolve(join(this.dir, OBJECTS, sha))).size;
    } catch {
      return null;
    }
  }

  /** The newest version that changed `path`, with what it left there. */
  lastChange(path: string): { version: StoredVersion; sha: string | null } | null {
    this.sync();
    for (let i = this.index.versions.length - 1; i >= 0; i--) {
      const version = this.index.versions[i]!;
      if (path in version.changes) return { version, sha: version.changes[path]! };
    }
    return null;
  }

  /** Each version's changes as added, edited or deleted (what the file held before it decides). */
  fileChanges(): Map<number, HistoryFileChange[]> {
    this.sync();
    const out = new Map<number, HistoryFileChange[]>();
    const state = new Map(Object.entries(this.index.base));
    for (const version of this.index.versions) {
      const list: HistoryFileChange[] = [];
      for (const [p, s] of Object.entries(version.changes)) {
        list.push({ path: p, op: s === null ? 'deleted' : state.has(p) ? 'edited' : 'added' });
        if (s === null) state.delete(p);
        else state.set(p, s);
      }
      out.set(version.n, list.sort((a, b) => a.path.localeCompare(b.path)));
    }
    return out;
  }

  /* ---- recording --------------------------------------------------------- */

  /**
   * Records changes: path → its content now (null: deleted). Those equal to
   * the head are left out; nothing left, no version (null). The rest join the
   * author's open version, or start a new one.
   */
  record(changes: ReadonlyMap<string, Buffer | null>, who: HistoryAuthor, extra: { restoredFrom?: number } = {}, now = new Date()): StoredVersion | null {
    this.sync();
    const changed: Record<string, string | null> = {};
    const contents = new Map<string, Buffer | null>();
    for (const [p, bytes] of changes) {
      const sha = bytes === null ? null : sha256(bytes);
      if ((this.headState.get(p) ?? null) === sha) continue;
      if (bytes !== null && sha !== null) this.putObject(sha, bytes);
      changed[p] = sha;
      contents.set(p, bytes);
    }
    if (Object.keys(changed).length === 0) return null;

    // What this write undid of someone else's change made moments before (a restore undoes nothing).
    const overwrote: StoredOverwrite[] = [];
    if (extra.restoredFrom === undefined && who.kind !== 'system') {
      for (const [p, written] of contents) {
        const last = this.lastChange(p);
        if (!last || last.version.author.kind === 'system' || last.version.restoredFrom !== undefined) continue;
        if (sameAuthor(last.version.author, who) || now.getTime() - Date.parse(last.version.at) >= HISTORY_OVERLAP_MS) continue;
        const beforeSha = this.fold(last.version.n - 1).get(p) ?? null;
        const before = beforeSha === null ? null : this.read(beforeSha);
        const theirs = last.sha === null ? null : this.read(last.sha);
        if ((beforeSha && !before) || (last.sha && !theirs)) continue;
        if (undoes(before, theirs, written)) overwrote.push({ path: p, lost: last.sha, n: last.version.n, author: { ...last.version.author } });
      }
    }

    const iso = now.toISOString();
    const last = this.index.versions.at(-1);
    const joins =
      !!last &&
      who.kind !== 'system' &&
      sameAuthor(last.author, who) &&
      last.restoredFrom === undefined &&
      extra.restoredFrom === undefined &&
      now.getTime() - Date.parse(last.at) < this.idleMs &&
      now.getTime() - Date.parse(last.first) < this.spanMs;
    let version: StoredVersion;
    if (joins) {
      version = last!;
      version.at = iso;
      Object.assign(version.changes, changed);
      if (who.name) version.author = { ...who };
    } else {
      version = { n: this.index.next++, first: iso, at: iso, author: { ...who }, changes: changed };
      if (extra.restoredFrom !== undefined) version.restoredFrom = extra.restoredFrom;
      this.index.versions.push(version);
    }
    for (const [p, s] of Object.entries(changed)) {
      if (s === null) this.headState.delete(p);
      else this.headState.set(p, s);
    }
    // A notice has nothing left to say once its lost content is back in its file,
    // or once its person put that file back to a version of their choosing.
    this.index.notices = this.index.notices.filter(
      (n) => !(n.path in changed && (changed[n.path] === n.lost.sha || (extra.restoredFrom !== undefined && n.to === who.id))),
    );
    if (overwrote.length) {
      version.overwrote = [...(version.overwrote ?? []).filter((o) => !overwrote.some((x) => x.path === o.path)), ...overwrote];
      for (const o of overwrote) {
        const to = o.author.kind === 'agent' ? this.ownerId : o.author.id;
        if (to === who.id && who.kind === 'person') continue;
        this.index.notices = this.index.notices.filter((n) => !(n.path === o.path && n.n === version.n && n.to === to));
        this.index.notices.push({ id: randomBytes(6).toString('hex'), to, at: iso, path: o.path, n: version.n, author: { ...who }, lost: { sha: o.lost, n: o.n, author: o.author } });
      }
    }
    this.prune(now);
    this.save();
    return version;
  }

  /**
   * What to write to bring version `n` back: path → content (null: delete),
   * for `paths` (default: every path it or the head holds), only where the
   * head differs. Null when the version is not kept or a content is missing.
   */
  restoreTo(n: number, paths?: readonly string[]): Map<string, Buffer | null> | null {
    const target = this.stateAt(n);
    if (!target) return null;
    const out = new Map<string, Buffer | null>();
    const all = paths ?? [...new Set([...target.keys(), ...this.headState.keys()])];
    for (const p of all) {
      const want = target.get(p) ?? null;
      if ((this.headState.get(p) ?? null) === want) continue;
      if (want === null) {
        out.set(p, null);
        continue;
      }
      const bytes = this.read(want);
      if (!bytes) return null;
      out.set(p, bytes);
    }
    return out;
  }

  /* ---- notices ----------------------------------------------------------- */

  /** The notices for this person, newest first. */
  noticesFor(id: string): StoredNotice[] {
    this.sync();
    return this.index.notices.filter((n) => n.to === id).reverse();
  }

  /** Dismisses one of this person's notices; false when they have none by that id. */
  dismiss(id: string, noticeId: string): boolean {
    this.sync();
    const before = this.index.notices.length;
    this.index.notices = this.index.notices.filter((n) => !(n.id === noticeId && n.to === id));
    if (this.index.notices.length === before) return false;
    this.save();
    return true;
  }

  /* ---- storage ----------------------------------------------------------- */

  private putObject(sha: string, bytes: Buffer): void {
    const file = this.writableFiles().resolve(join(this.dir, OBJECTS, sha));
    if (existsSync(file)) return;
    writeAtomicSync(file, bytes);
  }

  /** Past the limit the oldest versions fold into the base; old notices go; unused contents are removed. */
  private prune(now: Date): void {
    let folded = false;
    while (this.index.versions.length > this.maxVersions) {
      const old = this.index.versions.shift()!;
      for (const [p, s] of Object.entries(old.changes)) {
        if (s === null) delete this.index.base[p];
        else this.index.base[p] = s;
      }
      folded = true;
    }
    const oldest = now.getTime() - NOTICE_DAYS * 86_400_000;
    const kept = this.index.versions[0]?.n ?? Infinity;
    const perPerson = new Map<string, number>();
    this.index.notices = this.index.notices
      .filter((n) => Date.parse(n.at) >= oldest && n.lost.n >= kept)
      .reverse()
      .filter((n) => {
        const count = (perPerson.get(n.to) ?? 0) + 1;
        perPerson.set(n.to, count);
        return count <= MAX_NOTICES;
      })
      .reverse();
    if (folded) this.collect();
  }

  /** Removes the contents that neither the base, a version nor a notice holds. */
  private collect(): void {
    const keep = new Set<string>(Object.values(this.index.base));
    for (const version of this.index.versions) for (const s of Object.values(version.changes)) if (s) keep.add(s);
    for (const notice of this.index.notices) if (notice.lost.sha) keep.add(notice.lost.sha);
    let names: string[];
    try {
      names = readdirSync(this.files.resolve(join(this.dir, OBJECTS)));
    } catch {
      return;
    }
    for (const name of names) {
      if (SHA.test(name) && !keep.has(name)) rmSync(this.files.resolve(join(this.dir, OBJECTS, name), false), { force: true });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Did a write undo part of a change?                                         */
/* -------------------------------------------------------------------------- */

/** JSON with sorted keys, so equal values compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** The JSON merge patch (RFC 7396) that turns `a` into `b` (objects only). */
function mergeDiff(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(a)) if (!(key in b)) patch[key] = null;
  for (const [key, value] of Object.entries(b)) {
    const old = a[key];
    if (isRecord(old) && isRecord(value)) {
      const inner = mergeDiff(old, value);
      if (Object.keys(inner).length) patch[key] = inner;
    } else if (stable(old) !== stable(value)) {
      patch[key] = value;
    }
  }
  return patch;
}

function applyPatch(target: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (isRecord(value)) out[key] = applyPatch(out[key], value);
    else out[key] = value;
  }
  return out;
}

function parseObject(bytes: Buffer | null): Record<string, unknown> | null | undefined {
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const lineCounts = (bytes: Buffer | null): Map<string, number> => {
  const counts = new Map<string, number>();
  if (!bytes) return counts;
  for (const line of bytes.toString('utf8').split(/\r?\n/)) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
};

/**
 * Whether `written` undoes part of the change `before` → `theirs` (null: the
 * file did not exist). JSON objects: applying that change again as a merge
 * patch would change `written`. Text: a line they added is missing again, or
 * a line they removed is back.
 */
export function undoes(before: Buffer | null, theirs: Buffer | null, written: Buffer | null): boolean {
  if (theirs === null) return written !== null;
  if (written === null) return true;
  const [a, b, w] = [parseObject(before), parseObject(theirs), parseObject(written)];
  if (a !== undefined && b && w) return stable(applyPatch(w, mergeDiff(a ?? {}, b))) !== stable(w);
  const was = lineCounts(before);
  const now = lineCounts(theirs);
  const out = lineCounts(written);
  for (const line of new Set([...was.keys(), ...now.keys()])) {
    const delta = (now.get(line) ?? 0) - (was.get(line) ?? 0);
    if (delta > 0 && (out.get(line) ?? 0) < (now.get(line) ?? 0)) return true;
    if (delta < 0 && (out.get(line) ?? 0) > (now.get(line) ?? 0)) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Diff sides                                                                 */
/* -------------------------------------------------------------------------- */

/** A side larger than this is not sent for a diff. */
export const MAX_DIFF_BYTES = 1024 * 1024;

const decoder = new TextDecoder('utf-8', { fatal: true });

/** The text of a content (null: absent), or undefined when it is not UTF-8 text. */
export function textOf(bytes: Buffer | null): string | null | undefined {
  if (bytes === null) return null;
  if (bytes.includes(0)) return undefined;
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}
