/**
 * A Sheet's store: an edit log in the artifact's `sheet/` folder, the workbook it makes in the engine, and the answers
 * and frames of the `sheet` capability (SHEET_API) for the pages, with the agent's calls beside them.
 *
 *   sheet/sheet.json      {id, createdAt, title}: the workbook's id (a UUID), when it was made, and its title
 *   sheet/edits.jsonl     the edits, one JSON line each, in order: {revision, v, base, ops, opId?, by, at}. Revision n
 *                         is the workbook after the first n lines; `ops` are the engine's operations, `v` the format
 *                         version they were written in, `by` the server's id of who made it ("agent" for the agent)
 *   sheet/widgets/        the chart widgets (widgets.ts)
 *   sheet/version-names.json   the names given to versions in the history pane: {"<revision>": name}, the revision
 *                         being the last of the named version; names past the log's end are not read
 *   sheet/imports/        the .xlsx files people chose to import, for the agent (files.ts)
 *   sheet/tables/, sheet/refreshes.jsonl   connected tables' records, and refreshes that brought none (tables.ts)
 *
 * The workbook as it stands is kept in an engine session that loaded every edit's operations. A page's edit is applied
 * there first: what the engine refuses (an operation on a row someone deleted meanwhile, an id taken twice) is refused
 * to the page (`changedSince`) and never reaches the log. Edits are id-based, so one built on an earlier revision
 * applies on top of the edits made since without rebasing.
 *
 * Another process (the agent's command line) may append to the log while a server holds the store: `rescan` reads the
 * lines it did not write, applies them and sends them to the pages. A store with pages open rescans every second.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import {
  AgentError,
  applyEdits,
  ChartReader,
  checkWalkthrough,
  clockReading,
  csvOf,
  deletedSheets,
  describeEngine,
  type DescribedChart,
  type EditActor,
  type EditFrame,
  type EditsToTakeBack,
  type Engine,
  type EngineMessage,
  type EngineSession,
  engineOf,
  excelDifferences,
  type ImportFileResponse,
  importRequest,
  isCount,
  isObject,
  type Json,
  type JsonObject,
  type LoadPage,
  MAX_EDIT_BYTES,
  MOST_VERSION_NAME_LENGTH,
  MOST_VERSION_NAMES,
  oldestFormatVersion,
  personId,
  pickSheet,
  readWorkbook,
  recordEdits,
  type SheetFrame,
  type SheetPerson,
  type SheetReadAnswers,
  type SheetReadRefusal,
  type SheetReadRequest,
  SheetRefusalError,
  type SheetEditsRequest,
  type SheetSendRequest,
  type SheetSendResponse,
  type SheetVersionNameRequest,
  type SheetRefreshRequest,
  refreshFailure,
  refreshRequest,
  tableFileOf,
  type SheetView,
  sheetsOf,
  type SnapshotFrame,
  undeleted,
  versionsOf,
  type VersionRow,
  type VersionRowWithChanges,
  type WidgetRequest,
  type WidgetResponse,
  type WidgetState,
  type SheetWalkthrough,
  type WorkbookContents,
  workbookOf,
  xlsxChartsOf,
  xlsxFileName,
  xlsxPartsOf,
  xlsxRequest,
  chartCodeErrorText,
} from '@open-artifact/sheets-core';
import { sheetsEngine } from '@open-artifact/wasm-sheets/node';
import type { AgentRequest } from '@open-artifact/runtime/capabilities';
import { importFileName, looksLikeXlsx, MAX_IMPORT_BYTES, saveImport, zipXlsxParts } from './files.ts';
import { appendRefreshOutcome, isSnapshotId, SNAPSHOT_EDIT_FORMAT_VERSION, readRefreshOutcomes, refreshesSize, sliceOfTableFile, tableFileText, writeTableFile } from './tables.ts';
import { type Widget, WidgetStore } from './widgets.ts';

export const SHEET_DIR = 'sheet';
export const META_FILE = 'sheet.json';
export const EDITS_FILE = 'edits.jsonl';
export const VERSION_NAMES_FILE = 'version-names.json';
export const DEFAULT_TITLE = 'Untitled sheet';
/** Who the log names for the agent's edits. */
export const AGENT = 'agent';
/** The server's id of the owner, the person the agent's edits are made for. */
export const OWNER = 'owner';
/** The most calls in one batch. */
const MAX_BATCH = 16;
/** The most kinds of acts told of one version for its summary. */
const MOST_ACTS_OF_A_VERSION = 40;
/** How many widget creates are remembered by their opId (a page sends one again when it did not hear the answer). */
const MAX_REMEMBERED = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLOCK_MS = 60_000;
const RESCAN_MS = 1_000;
/**
 * How long a refresh the agent was asked for keeps another of the same call from being asked: long enough to turn
 * away a second press or another tab's, short enough that an agent that ended its turn without the records (and
 * without saying why) holds Refresh back for a minute, not a quarter of an hour. A press after it asks again.
 */
export const REFRESH_WAIT_MS = 60_000;
/** How long the agent's read waits for the formulas to be worked out. */
const CALCULATION_MS = 20_000;
const COLORS = ['#3987e5', '#d95926', '#0ca30c', '#8173e3', '#d55181', '#199e70', '#b77700', '#e34948'];

export interface SheetMeta {
  id: string;
  createdAt: string;
  title: string;
}

export interface StoredEdit {
  revision: number;
  v: number;
  base: number;
  ops: Json[];
  opId?: string;
  /** Who made it: the server's id of a person, or "agent". */
  by: string;
  at: string;
}

/** Who asks: the page's person, whether they may change the workbook, and whether they own it. */
export interface Viewer {
  id: string;
  name: string;
  canEdit: boolean;
  isOwner: boolean;
}

export interface SheetStoreOptions {
  /** The artifact's folder; the store keeps its files in `<root>/sheet/`. */
  root: string;
  /** The workbook engine (one is made when left out). */
  engine?: Engine;
  /** The title a new Sheet gets. */
  title?: string;
  /** The server's id of the owner: the agent's edits are made under them. */
  ownerId?: string;
  ownerName?: string;
  /** More people the page may name in cells (people chips), beyond the owner and those who opened it. */
  people?: () => SheetPerson[];
  /** Hands a request to the agent ("Import from Excel"); true when it was taken. */
  sendToAgent?: (request: AgentRequest) => boolean | Promise<boolean>;
  log?: (line: string) => void;
  /**
   * How an edit written by another process is noticed while a page listens: `poll` (default) rereads the edit log
   * each second; `events` (this process the only writer, its `fs.watch` reporting every write) watches the folder
   * instead, and polls only when that watch cannot start.
   */
  watch?: 'poll' | 'events';
}

/** The answer to a page's read. */
export type SheetReadAnswer = SheetReadAnswers[keyof SheetReadAnswers] | SheetReadRefusal;

/** A file of the workbook: its name, its bytes, and what the format leaves out (in the page's words). */
export interface ExportedFile {
  filename: string;
  bytes: Uint8Array;
  notCarriedOver: string[];
}

/** What `info` tells of a Sheet's folder. */
export interface SheetInfo {
  root: string;
  id: string;
  createdAt: string;
  title: string;
  revision: number;
  lastEditAt?: string;
  damagedLine?: number;
}

const refused = (refusal: string): SheetReadRefusal => ({ kind: 'refused', refusal });

/** A version's name as it is kept: control characters, line breaks and runs of spaces made one space, the ends trimmed. */
export function versionNameOf(given: string): string {
  return given.replace(/[\p{Cc}\s]+/gu, ' ').trim();
}

export function readMeta(sheetDir: string, files?: WorkspaceDirectory): SheetMeta | null {
  const file = path.resolve(sheetDir, META_FILE);
  let meta: unknown;
  try {
    meta = JSON.parse(fs.readFileSync(files?.resolve(file) ?? file, 'utf8'));
  } catch {
    return null;
  }
  if (!isObject(meta) || typeof meta.id !== 'string' || !UUID.test(meta.id)) return null;
  return {
    id: meta.id,
    createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : new Date(0).toISOString(),
    title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : DEFAULT_TITLE,
  };
}

function writeMeta(sheetDir: string, meta: SheetMeta, files?: WorkspaceDirectory): void {
  const requested = path.resolve(sheetDir, META_FILE);
  const file = files?.resolve(requested, false) ?? requested;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(meta, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, file);
}

/** The Sheet's meta, written now if the folder has none (a new, empty workbook). */
export function ensureMeta(sheetDir: string, title = DEFAULT_TITLE, files?: WorkspaceDirectory): SheetMeta {
  const meta = readMeta(sheetDir, files);
  if (meta) return meta;
  const made: SheetMeta = { id: randomUUID(), createdAt: new Date().toISOString(), title: title.trim() || DEFAULT_TITLE };
  writeMeta(sheetDir, made, files);
  return made;
}

/**
 * Reads the edit log: the whole lines that parse as edits, in order. A torn last line (a write cut short, or one still
 * being written) is left out; `damaged` is the revision of a whole line that is not an edit, where the log stops.
 */
export function readEdits(sheetDir: string, files?: WorkspaceDirectory): { edits: StoredEdit[]; bytes: number; damaged: number | null } {
  const file = path.resolve(sheetDir, EDITS_FILE);
  let text: string;
  try {
    text = fs.readFileSync(files?.resolve(file) ?? file, 'utf8');
  } catch {
    return { edits: [], bytes: 0, damaged: null };
  }
  const edits: StoredEdit[] = [];
  let bytes = 0;
  let damaged: number | null = null;
  const lines = text.split('\n');
  // The last piece has no newline after it: still being written, or torn.
  for (const line of lines.slice(0, -1)) {
    bytes += Buffer.byteLength(line) + 1;
    if (line.trim() === '') continue;
    let edit: unknown;
    try {
      edit = JSON.parse(line);
    } catch {
      damaged = edits.length + 1;
      break;
    }
    if (!isObject(edit) || edit.revision !== edits.length + 1 || !isCount(edit.v) || !isCount(edit.base) || !Array.isArray(edit.ops)) {
      damaged = edits.length + 1;
      break;
    }
    edits.push({
      revision: edit.revision,
      v: edit.v,
      base: edit.base,
      ops: edit.ops as Json[],
      ...(typeof edit.opId === 'string' ? { opId: edit.opId } : {}),
      by: typeof edit.by === 'string' ? edit.by : AGENT,
      at: typeof edit.at === 'string' ? edit.at : new Date(0).toISOString(),
    });
  }
  return { edits, bytes, damaged };
}

/** A stream a page opened: who it is for, and where its frames go. */
interface Stream {
  viewer: Viewer;
  emit: (frame: SheetFrame) => void;
  /** Tells the page the clock each minute. */
  clock: ReturnType<typeof setInterval>;
}

/** One Sheet's store. */
export class SheetStore {
  readonly root: string;
  readonly dir: string;
  readonly widgets: WidgetStore;
  private meta: SheetMeta;
  private readonly engine: Engine;
  private readonly files: WorkspaceDirectory;
  private readonly ownerId: string;
  private readonly ownerName: string;
  private readonly morePeople: () => SheetPerson[];
  private readonly sendToAgent: ((request: AgentRequest) => boolean | Promise<boolean>) | null;
  private readonly log: (line: string) => void;
  private readonly newest: number;
  /** The oldest format version the engine takes: operations no engine edit makes are logged in it. */
  private readonly oldest: number;
  private readonly localeOfANewWorkbook: string;
  private workbook: EngineSession;
  private edits: StoredEdit[] = [];
  /** Bytes of edits.jsonl read so far (what this store wrote or found). */
  private bytesRead = 0;
  private damaged: number | null = null;
  private readonly streams = new Set<Stream>();
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  /** `watch: 'events'`: the folder's watch while a page listens, and the short wait that gathers its events. */
  private watcher: fs.FSWatcher | null = null;
  private watchWait: ReturnType<typeof setTimeout> | null = null;
  private readonly watchMode: 'poll' | 'events';
  /** The workbook's time zone (its last setTimeZone operation), null for none: the clock is told in it. */
  private timeZone: string | null = null;
  /** The session the agent's reads are answered from: the workbook at `revision`, its formulas worked out. */
  private reading: { revision: number; session: EngineSession } | null = null;
  /**
   * For the history reads: a session that applied the edits one by one (so it keeps deleted sheets' cells, as a load
   * does not), and each edit's reverse as it answered. Made on the first such read and brought up to date on each; a
   * reload starts it over.
   */
  private history: { session: EngineSession; reverses: Json[][] } | null = null;
  /** The answers to widget creates, by their opId. */
  private readonly answered = new Map<string, WidgetResponse>();
  /** The names of the people who opened the Sheet, by their server id. */
  private readonly names = new Map<string, string>();
  /** How far refreshes.jsonl was read: refreshes told of before the store opened are not told again. */
  private refreshesRead = 0;
  /** The connected tables the agent was asked to refresh, by sheet id: the call asked for, and until when it is waited for. */
  private readonly refreshing = new Map<string, { callDigest: string; until: number }>();

  constructor(options: SheetStoreOptions) {
    this.root = path.resolve(options.root);
    fs.mkdirSync(this.root, { recursive: true });
    this.files = new WorkspaceDirectory(this.root);
    this.dir = path.join(this.root, SHEET_DIR);
    this.engine = options.engine ?? engineOf(sheetsEngine());
    this.ownerId = options.ownerId ?? OWNER;
    this.ownerName = options.ownerName ?? 'Owner';
    this.morePeople = options.people ?? (() => []);
    this.sendToAgent = options.sendToAgent ?? null;
    this.log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
    this.watchMode = options.watch ?? 'poll';
    this.meta = ensureMeta(this.dir, options.title, this.files);
    this.widgets = new WidgetStore(this.dir, this.files);
    const described = describeEngine(this.engine);
    this.newest = described.newest;
    this.localeOfANewWorkbook = described.localeOfANewWorkbook;
    this.oldest = oldestFormatVersion(this.engine, this.newest);
    this.workbook = this.engine.session();
    this.reload();
    this.refreshesRead = refreshesSize(this.dir, this.files);
  }

  get revision(): number {
    return this.edits.length;
  }

  get title(): string {
    return this.meta.title;
  }

  /** Renames the Sheet (the name its exports get). */
  setTitle(title: string): void {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('A Sheet\'s title is some words, not "".');
    this.meta = { ...this.meta, title: trimmed };
    writeMeta(this.dir, this.meta, this.files);
  }

  info(): SheetInfo {
    this.rescan();
    const last = this.edits.at(-1);
    return {
      root: this.root,
      id: this.meta.id,
      createdAt: this.meta.createdAt,
      title: this.meta.title,
      revision: this.revision,
      ...(last ? { lastEditAt: last.at } : {}),
      ...(this.damaged !== null ? { damagedLine: this.damaged } : {}),
    };
  }

  // ---------- the log ----------

  /** Reads the whole log again into a new session (at start, or after the file shrank or changed under us). */
  private reload(): void {
    const { edits, bytes, damaged } = readEdits(this.dir, this.files);
    this.damaged = damaged;
    const session = this.engine.session();
    const all = edits.flatMap((e) => e.ops);
    if (all.length === 0 || session.answer({ kind: 'load', ops: all }).kind === 'loaded') {
      this.replace(session, edits, bytes);
    } else {
      // Some edit does not apply: keep those before it, edit by edit.
      session.free();
      const fresh = this.engine.session();
      const kept: StoredEdit[] = [];
      for (const edit of edits) {
        const answer = fresh.answer({ kind: 'apply', ops: edit.ops });
        if (answer.kind !== 'applied') {
          this.log(`${EDITS_FILE}: edit ${edit.revision} does not apply (${String(answer.refusal ?? answer.kind)}); the workbook stops at revision ${kept.length}`);
          break;
        }
        kept.push(edit);
      }
      this.replace(fresh, kept, bytes);
    }
    if (damaged !== null) this.log(`${EDITS_FILE}: line ${damaged} is not an edit; the workbook stops at revision ${this.revision}`);
  }

  private replace(session: EngineSession, edits: StoredEdit[], bytes: number): void {
    this.workbook.free();
    this.dropSessions();
    this.workbook = session;
    this.edits = edits;
    this.bytesRead = bytes;
    this.timeZone = null;
    for (const edit of edits) this.noteTimeZone(edit);
  }

  private dropSessions(): void {
    this.reading?.session.free();
    this.reading = null;
    this.history?.session.free();
    this.history = null;
  }

  /**
   * Follows the workbook's time zone: the one an edit sets, or the browser's, which the page's first edit of a workbook
   * with none adopts (`adoptTimeZone`). The name stays as given: the engine counts a clock reading only under the name
   * the workbook was given. True when it changed.
   */
  private noteTimeZone(edit: StoredEdit): boolean {
    const before = this.timeZone;
    for (const op of edit.ops) {
      if (!isObject(op)) continue;
      const zone = typeof op.timeZone === 'string' ? op.timeZone : null;
      if (op.kind === 'setTimeZone') this.timeZone = zone;
      else if (op.kind === 'adoptTimeZone' && this.timeZone === null) this.timeZone = zone;
    }
    return this.timeZone !== before;
  }

  /**
   * Applies operations to the workbook session. Bringing a deleted sheet back (undeleteSheet) is refused by a session
   * that loaded the log (a load leaves deleted sheets' cells out: deletedCellsNotLoaded), so the session is then loaded
   * again with them.
   */
  private applyToWorkbook(ops: readonly unknown[]): EngineMessage {
    const answer = this.workbook.answer({ kind: 'apply', ops });
    if (answer.kind === 'applied' || answer.refusal !== 'deletedCellsNotLoaded') return answer;
    const session = this.engine.session();
    const loaded = session.answer({ kind: 'load', ops: [...this.edits.flatMap((e) => e.ops), ...ops] });
    if (loaded.kind !== 'loaded') {
      session.free();
      return answer;
    }
    this.workbook.free();
    this.workbook = session;
    return { kind: 'applied' };
  }

  /**
   * Looks at edits.jsonl again: lines another process appended are applied and sent to the pages. A file that shrank
   * or changed before the end read so far is read again whole, and the pages get a new snapshot.
   */
  rescan(): void {
    this.rescanRefreshes();
    let size: number;
    try {
      size = fs.statSync(this.files.resolve(path.join(this.dir, EDITS_FILE))).size;
    } catch {
      size = 0;
    }
    if (size === this.bytesRead) return;
    const before = this.revision;
    const { edits, bytes } = readEdits(this.dir, this.files);
    const same = size > this.bytesRead && edits.length >= before && edits.slice(0, before).every((e, i) => e.at === this.edits[i]!.at && e.opId === this.edits[i]!.opId);
    if (!same) {
      this.log(`${EDITS_FILE} changed under the store; reading it again`);
      this.reload();
      for (const stream of this.streams) {
        stream.emit(this.snapshotFor(stream.viewer));
        stream.emit(this.clockFrame());
      }
      return;
    }
    for (const edit of edits.slice(before)) {
      const answer = this.applyToWorkbook(edit.ops);
      if (answer.kind !== 'applied') {
        this.log(`${EDITS_FILE}: edit ${edit.revision} does not apply (${String(answer.refusal ?? answer.kind)}); left out`);
        break;
      }
      this.edits.push(edit);
      this.broadcast(edit);
    }
    // A torn last line is read again once it is whole.
    this.bytesRead = bytes;
  }

  private append(fields: Omit<StoredEdit, 'revision' | 'at'>): StoredEdit {
    const edit: StoredEdit = {
      revision: this.revision + 1,
      v: fields.v,
      base: fields.base,
      ops: fields.ops,
      ...(fields.opId !== undefined ? { opId: fields.opId } : {}),
      by: fields.by,
      at: new Date().toISOString(),
    };
    const line = `${JSON.stringify(edit)}\n`;
    const file = this.files.resolve(path.join(this.dir, EDITS_FILE));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
    this.bytesRead += Buffer.byteLength(line);
    this.edits.push(edit);
    this.broadcast(edit);
    return edit;
  }

  // ---------- the stream ----------

  /** Who made an edit, as pages show them: the agent's edits are made under the owner, as the owner's agent. */
  actorOf(by: string): EditActor {
    return by === AGENT ? { personId: personId(this.ownerId), isAgent: true } : { personId: personId(by), isAgent: false };
  }

  /** The first frame of a page's stream: where the log stands and who the page's person is. */
  snapshotFor(viewer: Viewer): SnapshotFrame {
    this.names.set(viewer.id, viewer.name);
    return {
      phase: 'snapshot',
      workbookId: this.meta.id,
      createdAt: this.meta.createdAt,
      revision: this.revision,
      newestFormatVersion: this.newest,
      widgets: this.widgets.list().map((w) => ({ id: w.id, pub: w.pub })),
      viewer: { personId: personId(viewer.id), canEdit: viewer.canEdit, isOwner: viewer.isOwner },
      // Only the owner's pages ask for a refresh: the agent makes the call with the owner's access.
      ...(viewer.isOwner && this.sendToAgent !== null ? { takesConnectedTables: true } : {}),
    };
  }

  private clockFrame(): SheetFrame {
    return { phase: 'clock', ...clockReading(this.timeZone) };
  }

  /** A page opened its stream: a snapshot and the clock now, the clock each minute, then a frame per edit until it closes. */
  open(viewer: Viewer, emit: (frame: SheetFrame) => void): () => void {
    this.rescan();
    emit(this.snapshotFor(viewer));
    emit(this.clockFrame());
    const clock = setInterval(() => emit(this.clockFrame()), CLOCK_MS);
    clock.unref();
    const stream: Stream = { viewer, emit, clock };
    this.streams.add(stream);
    if (!this.rescanTimer && !this.watcher) this.startNoticing();
    return () => {
      clearInterval(clock);
      this.streams.delete(stream);
      if (this.streams.size === 0) this.stopNoticing();
    };
  }

  /** Rereads the edit log, logging what goes wrong. */
  private rescanLogged(): void {
    try {
      this.rescan();
    } catch (error) {
      this.log(`${EDITS_FILE}: ${(error as Error).message}`);
    }
  }

  /** Starts noticing edits written by others: the folder's watch in `events` mode, else (or failing that) a poll. */
  private startNoticing(): void {
    if (this.watchMode === 'events') {
      try {
        const dir = this.files.resolve(this.dir);
        fs.mkdirSync(dir, { recursive: true });
        const watcher = fs.watch(dir, () => {
          if (this.watchWait) return;
          this.watchWait = setTimeout(() => {
            this.watchWait = null;
            this.rescanLogged();
          }, 50);
        });
        watcher.on('error', () => undefined);
        this.watcher = watcher;
        return;
      } catch (error) {
        this.log(`cannot watch ${this.dir} (${(error as Error).message}); polling it`);
      }
    }
    this.rescanTimer = setInterval(() => this.rescanLogged(), RESCAN_MS);
    this.rescanTimer.unref();
  }

  private stopNoticing(): void {
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    this.rescanTimer = null;
    this.watcher?.close();
    this.watcher = null;
    if (this.watchWait) clearTimeout(this.watchWait);
    this.watchWait = null;
  }

  private broadcast(edit: StoredEdit): void {
    for (const op of edit.ops) {
      if (isObject(op) && op.kind === 'setSnapshots' && Array.isArray(op.snapshots))
        for (const set of op.snapshots) if (isObject(set) && typeof set.sheetId === 'string') this.refreshing.delete(set.sheetId);
    }
    const frame: EditFrame = { phase: 'edit', revision: edit.revision, v: edit.v, base: edit.base, ops: edit.ops, actor: this.actorOf(edit.by) };
    const zoneChanged = this.noteTimeZone(edit);
    for (const stream of this.streams) {
      stream.emit(frame);
      // The clock is told in the workbook's time zone: a new one, a new reading (or TODAY() and NOW() are #N/A).
      if (zoneChanged) stream.emit(this.clockFrame());
    }
  }

  /** Tells the pages a widget's code was published: its charts ask for it again. */
  private published(widget: Widget): void {
    if (widget.pub === 0) return;
    for (const stream of this.streams) stream.emit({ phase: 'widget', id: widget.id, pub: widget.pub });
  }

  // ---------- the page's requests ----------

  /** `POST read`: what a page asks. */
  read<K extends SheetReadRequest['kind']>(request: Extract<SheetReadRequest, { kind: K }>, viewer: Viewer): SheetReadAnswers[K] | SheetReadRefusal;
  read(request: SheetReadRequest, viewer: Viewer): SheetReadAnswer;
  read(request: SheetReadRequest, viewer: Viewer): SheetReadAnswer {
    this.rescan();
    this.names.set(viewer.id, viewer.name);
    if (!isObject(request)) return refused('unreadableRequest');
    switch (request.kind) {
      case 'snapshot':
        return this.snapshotFor(viewer);
      case 'load': {
        const from = isCount(request.from) ? Math.min(request.from, this.revision) : 0;
        return this.loadPage(from, this.revision);
      }
      case 'loadAtRevision': {
        const { revision } = request;
        if (!isCount(revision) || revision > this.revision) return refused('unknownRevision');
        return this.loadPage(0, revision);
      }
      case 'versions':
        return { kind: 'versions', rows: this.versionRows(request.limit, request.before ?? request.beforeSeq) };
      case 'versionsWithChanges': {
        // The same rows, each with what its edits did; the summary itself is the agent's to write.
        const rows = this.versionRows(request.limit, request.before ?? request.beforeSeq);
        const sheetNames = this.sheetNames();
        return { kind: 'versionsWithChanges', rows: rows.map((row) => ({ ...row, content: this.changesOfVersion(row, sheetNames) })) };
      }
      case 'loadTableFile':
        if (typeof request.snapshotId !== 'string' || !isCount(request.from)) return refused('unreadableRequest');
        // An id no snapshot could have names no file here.
        if (!isSnapshotId(request.snapshotId)) return { kind: 'tableFile', isGone: true };
        return sliceOfTableFile(this.dir, this.files, request.snapshotId, request.from);
      case 'editsThatRestore':
      case 'editsThatUndo':
      case 'cellHistory':
      case 'rowHistory':
        return this.readHistory(request);
      case 'people':
        return { kind: 'people', people: this.people() };
      case 'sheets': {
        const { revision, locale, sheets } = this.agentRead({ kind: 'readSheets' }, this.revision);
        return { kind: 'sheets', revision: revision as number, locale: locale as string, sheets: sheets as JsonObject[] };
      }
      case 'xlsxCharts': {
        const asked = Array.isArray(request.charts) ? request.charts.flatMap((c) => (isObject(c) && typeof c.viewId === 'string' ? [c.viewId] : [])) : [];
        const { workbook, session } = this.contents();
        const descriptions = this.describedCharts(workbook, session, asked.length ? new Set(asked) : undefined);
        return { kind: 'xlsxCharts', descriptions: descriptions.map(({ viewId, description }) => ({ viewId, description: description as JsonObject })) };
      }
      default:
        return refused('unknownReadKind');
    }
  }

  /**
   * The workbook's operations from edit `from` up to `revision` as one load page. The engine takes a page only from
   * where its load stands (`from`, 0 for a page that starts), so all of them go in one page (`next` null). An empty
   * log's page is written in the newest format version.
   */
  private loadPage(from: number, revision: number): LoadPage {
    const edits = this.edits.slice(from, revision);
    const v = edits.length === 0 ? this.newest : edits.reduce((most, e) => Math.max(most, e.v), 0);
    return { kind: 'loadPage', from, revision, v, ops: edits.flatMap((e) => e.ops), next: null };
  }

  /**
   * The versions, newest first, that end before `before`. A version's first edit stands in the log at its revision,
   * so `firstSeq` is `firstRevision`, and a page asked for `beforeSeq` is the one asked for `before`.
   */
  private versionRows(limit: unknown, before: unknown): VersionRow[] {
    const most = isCount(limit) && limit > 0 ? Math.min(limit, 200) : 50;
    const until = isCount(before) ? before : this.revision + 1;
    const names = this.versionNames();
    return versionsOf(this.edits, new Set(names.keys()))
      .filter((version) => version.last < until)
      .slice(0, most)
      .map(({ first, last, by }) => {
        const name = names.get(last);
        return { revision: last, firstRevision: first, firstSeq: first, at: this.edits[last - 1]!.at, authors: by.map((who) => this.actorOf(who)), ...(name === undefined ? {} : { name }) };
      });
  }

  /** The sheets' names now, by sheet id. */
  private sheetNames(): Map<string, string> {
    const { workbook, release } = this.contents();
    try {
      return new Map(workbook.sheets.map(({ sheetId, name }) => [sheetId, name]));
    } finally {
      release();
    }
  }

  /** What a version's edits did: each kind of operation by the sheet it is on, as its name stands now, and how many. */
  private changesOfVersion({ firstRevision, revision }: VersionRow, sheetNames: Map<string, string>): VersionRowWithChanges['content'] {
    const acts = new Map<string, { kind: string; sheet?: string; count: number }>();
    for (const { ops } of this.edits.slice(firstRevision - 1, revision))
      for (const op of ops) {
        if (!isObject(op) || typeof op.kind !== 'string') continue;
        const sheet = typeof op.sheetId === 'string' ? sheetNames.get(op.sheetId) : undefined;
        const key = JSON.stringify([op.kind, sheet ?? null]);
        const act = acts.get(key) ?? { kind: op.kind, ...(sheet === undefined ? {} : { sheet }), count: 0 };
        act.count += op.kind === 'setCells' && Array.isArray(op.cells) ? op.cells.length : 1;
        acts.set(key, act);
      }
    const told = [...acts.values()];
    return { acts: told.slice(0, MOST_ACTS_OF_A_VERSION), ...(told.length > MOST_ACTS_OF_A_VERSION ? { areActsLeftOut: true as const } : {}) };
  }

  /** The names given to versions, by the revision each named version ends at (only revisions the log has). */
  versionNames(): Map<number, string> {
    const kept = this.files.readJson<unknown>(path.join(this.dir, VERSION_NAMES_FILE), {});
    const names = new Map<number, string>();
    if (!isObject(kept)) return names;
    for (const [key, name] of Object.entries(kept)) {
      const revision = Number(key);
      if (String(revision) === key && isCount(revision) && revision >= 1 && revision <= this.revision && typeof name === 'string' && name !== '') names.set(revision, name);
    }
    return names;
  }

  /** Names the version that ends at a revision, or takes its name away (an empty name). The log does not move. */
  private setVersionName(request: SheetVersionNameRequest): SheetSendResponse {
    const refuse = (refusal: string): SheetSendResponse => ({ kind: 'refused', refusal });
    if (typeof request.name !== 'string') return refuse('unreadableVersionName');
    const { revision } = request;
    if (!isCount(revision) || revision < 1 || revision > this.revision) return refuse('unknownRevision');
    const name = versionNameOf(request.name);
    if ([...name].length > MOST_VERSION_NAME_LENGTH) return refuse('versionNameNotAllowed');
    const names = this.versionNames();
    if (name === '') names.delete(revision);
    else if (!names.has(revision) && names.size >= MOST_VERSION_NAMES) return refuse('tooManyVersionNames');
    else names.set(revision, name);
    const kept = Object.fromEntries([...names].sort(([a], [b]) => a - b).map(([at, given]) => [String(at), given]));
    this.files.writeJson(path.join(this.dir, VERSION_NAMES_FILE), kept);
    return { kind: 'versionNamed', revision, name: name === '' ? null : name };
  }

  /** The owner, the people who opened the Sheet, the people the server names, and whoever made an edit. */
  private people(): SheetPerson[] {
    const out = new Map<string, SheetPerson>();
    const viewing = new Set([...this.streams].map((s) => s.viewer.id));
    const add = (id: string, name: string, colored: boolean): void => {
      const pid = personId(id);
      if (out.has(pid)) return;
      out.set(pid, { personId: pid, name, ...(colored ? { color: COLORS[out.size % COLORS.length]! } : {}) });
    };
    add(this.ownerId, this.ownerName, true);
    for (const [id, name] of this.names) add(id, name, viewing.has(id));
    for (const person of this.morePeople()) if (!out.has(person.personId)) out.set(person.personId, person);
    for (const edit of this.edits) if (edit.by !== AGENT) add(edit.by, this.names.get(edit.by) ?? edit.by, false);
    return [...out.values()];
  }

  /** `POST send`: one of a page's edits, saved as the next revision or refused. */
  send(request: SheetSendRequest, viewer: Viewer): SheetSendResponse {
    this.rescan();
    const refuse = (refusal: string): SheetSendResponse => ({ kind: 'refused', refusal });
    if (!viewer.canEdit) return refuse('notWriter');
    if (!isObject(request)) return refuse('unreadableEdit');
    // An edit has no kind; a request with one is a version's name (a refresh is asked with refreshConnectedTable).
    if ('kind' in request) return request.kind === 'setVersionName' ? this.setVersionName(request as SheetVersionNameRequest) : refuse('unreadableEdit');
    if ('edits' in request) return this.sendEdits(request as SheetEditsRequest, viewer);
    const { v, base, ops } = request;
    if (!isCount(v) || !isCount(base) || !Array.isArray(ops) || ops.length === 0) return refuse('unreadableEdit');
    if (v > this.newest) return refuse('unknownFormatVersion');
    if (base > this.revision) return refuse('pageIsBehind');
    if (JSON.stringify(ops).length > MAX_EDIT_BYTES) return refuse('tooLarge');
    const opId = typeof request.opId === 'string' && request.opId !== '' ? request.opId : undefined;
    // A page sends an edit again when it did not hear the answer: the same edit (by its opId) is answered as saved.
    if (opId !== undefined) {
      const earlier = this.edits.findLast((e) => e.opId === opId);
      if (earlier) return { kind: 'saved', revision: earlier.revision };
    }
    const answer = this.applyToWorkbook(ops);
    if (answer.kind !== 'applied') {
      const why = String(answer.refusal ?? answer.kind);
      this.log(`an edit was refused (${why}) from ${viewer.id}, built on revision ${base} of ${this.revision}`);
      return refuse(base < this.revision ? 'changedSince' : why);
    }
    const edit = this.append({ v, base, ops, ...(opId !== undefined ? { opId } : {}), by: viewer.id });
    return { kind: 'saved', revision: edit.revision };
  }

  /**
   * Edits a page asks the server to make, as the agent's are made but under the page's person: a new workbook's first
   * sheet and its locale. They are made on the revision now only; a refusal tells where the log stands.
   */
  private sendEdits(request: SheetEditsRequest, viewer: Viewer): SheetSendResponse {
    const { base, edits } = request;
    if (!isCount(base) || !Array.isArray(edits) || edits.length === 0) return { kind: 'refused', refusal: 'unreadableEdit' };
    const opId = typeof request.opId === 'string' && request.opId !== '' ? request.opId : undefined;
    if (opId !== undefined) {
      const earlier = this.edits.findLast((e) => e.opId === opId);
      if (earlier) return { kind: 'saved', revision: earlier.revision };
    }
    if (base !== this.revision) return { kind: 'refused', refusal: 'baseIsNotTheRevision', revision: this.revision };
    try {
      const made = this.applyEditsAs(base, edits, viewer.id, opId);
      return made.revision === base ? { kind: 'refused', refusal: 'changedNothing', revision: base } : { kind: 'saved', revision: made.revision };
    } catch (error) {
      if (error instanceof AgentError) return { kind: 'refused', refusal: error.code, revision: this.revision };
      throw error;
    }
  }

  // ---------- widgets ----------

  private widgetState(widget: Widget): WidgetState {
    return { id: widget.id, code: widget.code, pub: widget.pub, errors: widget.errors.map(chartCodeErrorText) };
  }

  /** The chart that draws with a widget, or undefined. */
  private chartOfWidget(id: string): string | undefined {
    return this.contents().workbook.views?.find((v) => v.view.elements.some((e) => e.embed.ref === `node/${id}`))?.viewId;
  }

  /** `POST widget`: a chart widget's create, read, projection, draft or delete. */
  widget(request: WidgetRequest, viewer: Viewer): WidgetResponse {
    const refuse = (refusal: string, extra: { chartId?: string; pub?: number } = {}): WidgetResponse => ({ kind: 'refused', refusal, ...extra });
    if (!isObject(request)) return refuse('unreadableRequest');
    this.rescan();
    switch (request.verb) {
      case 'create': {
        if (!viewer.canEdit) return refuse('notWriter');
        if (typeof request.code !== 'string') return refuse('unreadableRequest');
        const opId = typeof request.opId === 'string' && request.opId !== '' ? request.opId : null;
        const earlier = opId === null ? undefined : this.answered.get(opId);
        if (earlier) return earlier;
        const widget = this.widgets.create(request.code);
        this.published(widget);
        const answer: WidgetResponse = { kind: 'widget', widget: this.widgetState(widget) };
        if (opId !== null) {
          this.answered.set(opId, answer);
          if (this.answered.size > MAX_REMEMBERED) this.answered.delete(this.answered.keys().next().value!);
        }
        return answer;
      }
      case 'read': {
        const widget = this.widgets.get(request.id);
        return widget ? { kind: 'widget', widget: this.widgetState(widget) } : refuse('unknownWidget');
      }
      case 'projection': {
        const projection = this.widgets.projection(request.id);
        return projection.kind === 'bundle' ? { kind: 'projection', id: request.id, module: projection.module } : refuse(projection.kind);
      }
      case 'draft': {
        if (!viewer.canEdit) return refuse('notWriter');
        const widget = this.widgets.get(request.id);
        if (!widget) return refuse('unknownWidget');
        if (typeof request.code !== 'string' || !isCount(request.basePub)) return refuse('unreadableRequest');
        if (request.basePub !== widget.pub) return refuse('changedSince', { pub: widget.pub });
        const next = this.widgets.draft(widget, request.code);
        if (next.pub !== widget.pub) this.published(next);
        return { kind: 'widget', widget: this.widgetState(next) };
      }
      case 'delete': {
        if (!viewer.canEdit) return refuse('notWriter');
        if (!this.widgets.get(request.id)) return refuse('unknownWidget');
        const chartId = this.chartOfWidget(request.id);
        if (chartId !== undefined) return refuse('widgetInUse', { chartId });
        this.widgets.delete(request.id);
        return { kind: 'deleted' };
      }
      default:
        return refuse('unknownVerb');
    }
  }

  // ---------- importing ----------

  /**
   * `POST importFile`: an .xlsx file someone chose with "Import from Excel", kept in `imports/` for the agent, which
   * gets a request naming it. Refuses (SheetRefusalError) a file that is no .xlsx file or is too large.
   */
  async importFile(name: string, bytes: Uint8Array): Promise<ImportFileResponse> {
    this.rescan();
    const kept = importFileName(name);
    if (kept === null || !looksLikeXlsx(bytes)) throw SheetRefusalError.of(new AgentError('notAnXlsxFile', 'Import from Excel takes an .xlsx file.'));
    if (bytes.length > MAX_IMPORT_BYTES) throw SheetRefusalError.of(new AgentError('fileTooLarge', `The file is over ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`));
    const file = saveImport(this.dir, kept, bytes, this.files);
    let sentToAgent = false;
    try {
      sentToAgent = await this.sendToAgent?.(importRequest(`${SHEET_DIR}/${file}`)) ?? false;
    } catch (error) {
      this.log(`import: the request did not reach the agent (${(error as Error).message})`);
    }
    if (!sentToAgent) fs.rmSync(this.files.resolve(path.join(this.dir, file), false), { force: true });
    return { path: `${SHEET_DIR}/${file}`, sentToAgent };
  }

  // ---------- version history ----------

  /** The history session, brought up to the revision; null when an edit does not apply there (historyDoesNotMatch). */
  private historySession(): { session: EngineSession; reverses: Json[][] } | null {
    this.history ??= { session: this.engine.session(), reverses: [] };
    const history = this.history;
    for (let i = history.reverses.length; i < this.edits.length; i++) {
      const answer = history.session.answer({ kind: 'apply', ops: this.edits[i]!.ops });
      if (answer.kind !== 'applied' || !Array.isArray(answer.reverse)) {
        this.log(`history: edit ${i + 1} does not apply on its own (${String(answer.refusal ?? answer.kind)})`);
        history.session.free();
        this.history = null;
        return null;
      }
      history.reverses.push(answer.reverse as Json[]);
    }
    return history;
  }

  /** Restoring a version, undoing an agent's turn, and a cell's or a row's history. */
  private readHistory(request: Extract<SheetReadRequest, { kind: 'editsThatRestore' | 'editsThatUndo' | 'cellHistory' | 'rowHistory' }>): SheetReadAnswer {
    const history = this.historySession();
    if (!history) return refused('historyDoesNotMatch');
    const withReverse = (edit: StoredEdit): EngineMessage => ({ ops: edit.ops, reverse: history.reverses[edit.revision - 1]! });
    const none: EditsToTakeBack = { kind: 'editsToTakeBack', revision: this.revision, edits: [] };
    /** The engine's take-back edits, as a page saves them: built on the revision now. */
    const takeBack = (asked: EngineMessage): SheetReadAnswer => {
      const answer = history.session.answer(asked);
      if (answer.kind !== 'editsThatTakeBack' || !Array.isArray(answer.edits)) return refused(String(answer.refusal ?? 'reverseNotAccepted'));
      const edits = answer.edits.filter(isObject).map((edit) => ({ ...(edit as JsonObject), base: this.revision }));
      return { kind: 'editsToTakeBack', revision: this.revision, edits };
    };
    switch (request.kind) {
      case 'editsThatRestore': {
        const { revision } = request;
        if (!isCount(revision) || revision > this.revision) return refused('unknownRevision');
        if (revision === this.revision) return none;
        return takeBack({ kind: 'editsThatTakeBackAllSince', edits: this.edits.slice(revision).map(withReverse) });
      }
      case 'editsThatUndo': {
        const picked = new Set<number>();
        for (const range of Array.isArray(request.ranges) ? request.ranges : []) {
          if (!isObject(range) || !isCount(range.first) || !isCount(range.last) || range.first < 1 || range.first > range.last) return refused('unreadableRequest');
          if (range.last > this.revision) return refused('unknownRevision');
          for (let r = range.first; r <= range.last; r++) picked.add(r);
        }
        if (picked.size === 0) return none;
        return takeBack({ kind: 'editsThatUndo', edits: [...picked].sort((a, b) => a - b).map((r) => withReverse(this.edits[r - 1]!)) });
      }
      case 'cellHistory':
      case 'rowHistory': {
        const ofACell = request.kind === 'cellHistory';
        const { sheetId, r } = request;
        const c = ofACell ? request.c : undefined;
        if (typeof sheetId !== 'string' || typeof r !== 'string' || (ofACell && typeof c !== 'string')) return refused('unreadableRequest');
        const edits = this.edits.map((edit) => ({ revision: edit.revision, v: edit.v, base: edit.base, ops: edit.ops, reverse: history.reverses[edit.revision - 1]! }));
        const answer = history.session.answer(ofACell ? { kind: 'historyOfACell', sheetId, cell: { r, c }, edits } : { kind: 'historyOfARow', sheetId, r, edits });
        if (answer.kind !== (ofACell ? 'historyOfACell' : 'historyOfARow') || !Array.isArray(answer.changes)) return refused(String(answer.refusal ?? 'historyDoesNotMatch'));
        const rows = answer.changes.filter(isObject).flatMap((change) => {
          const edit = isCount(change.revision) ? this.edits[change.revision - 1] : undefined;
          if (!edit) return [];
          const { revision: _revision, ...held } = change as JsonObject;
          return [{ ...held, revision: edit.revision, at: edit.at, actor: this.actorOf(edit.by) }];
        });
        return { kind: 'cellHistory', rows, truncated: answer.areEarlierLeftOut === true };
      }
    }
  }

  // ---------- the agent's calls ----------

  /**
   * The workbook at a revision (the one it stands at when left out), its formulas worked out by this computer's clock
   * (TODAY(), NOW()). A session of its own: a clock reading turns a load/apply session into a sync one, so the store's
   * own session never gets one. The session at the revision now is kept for the next read.
   */
  private contents(at = this.revision): { workbook: WorkbookContents; session: EngineSession; unfinished: boolean; release: () => void } {
    let session: EngineSession;
    let release = (): void => {};
    if (at === this.revision && this.reading?.revision === at) session = this.reading.session;
    else {
      session = this.engine.session();
      const ops = this.edits.slice(0, at).flatMap((e) => e.ops);
      if (ops.length > 0 && session.answer({ kind: 'load', ops }).kind !== 'loaded') {
        session.free();
        throw new Error(`The engine did not load the workbook at revision ${at}.`);
      }
      this.holdTableFiles(session);
      if (at === this.revision) {
        this.reading?.session.free();
        this.reading = { revision: at, session };
      } else release = () => session.free();
    }
    session.answer({ kind: 'receiveClockReading', ...clockReading(this.timeZone) });
    let unfinished = true;
    const until = Date.now() + CALCULATION_MS;
    for (let step = 0; step < 100_000 && Date.now() < until; step++) {
      if (session.answer({ kind: 'calculate' }).calculation !== 'unfinished') {
        unfinished = false;
        break;
      }
    }
    const workbook = workbookOf(session.answer({ kind: 'readWorkbook' }));
    if (!workbook) {
      release();
      throw new Error('The engine did not read the workbook back.');
    }
    return { workbook: { locale: this.localeOfANewWorkbook, ...workbook, revision: at }, session, unfinished, release };
  }

  private describedCharts(workbook: WorkbookContents, session: EngineSession, only?: ReadonlySet<string>): DescribedChart[] {
    return xlsxChartsOf(workbook, (request) => session.answer(request), (id) => this.widgets.get(id)?.published, only);
  }

  /** Runs one of the agent's calls: its refusals leave as SheetRefusalError. */
  private refusing<T>(call: () => T): T {
    try {
      return call();
    } catch (error) {
      if (error instanceof AgentError) throw SheetRefusalError.of(error);
      throw error;
    }
  }

  /**
   * A new Sheet has one blank sheet, Sheet1. The page makes it when it first opens a blank workbook; the agent, which
   * may come first, makes it the same way (revision 1).
   */
  private ensureFirstSheet(): void {
    if (this.revision === 0) this.applyAgentEdits(0, [{ kind: 'addSheet', name: 'Sheet1' }]);
  }

  /**
   * One of the agent's reads (readSheets, readCells, readCellFormats, readConditionalFormats, readCharts,
   * readInteractive, readCellsChangedFromTheirDefaults, readNamedRanges), from the workbook as it stands, or as it stood at `atRevision`.
   */
  agentRead(payload: unknown = { kind: 'readSheets' }, atRevision?: number): EngineMessage {
    this.rescan();
    return this.refusing(() => {
      if (atRevision === undefined) this.ensureFirstSheet();
      else if (!isCount(atRevision) || atRevision > this.revision) throw new AgentError('unknownRevision', `The Sheet is at revision ${this.revision}: read at a revision from 0 to it.`, { revision: this.revision });
      const at = atRevision ?? this.revision;
      const { workbook, session, unfinished, release } = this.contents(at);
      try {
        let charts: ChartReader | undefined;
        const before = this.edits.slice(0, at).flatMap((e) => e.ops);
        const reader = (sheets: SheetView[]) => (charts ??= new ChartReader(workbook, sheets, (more) => undeleted(this.engine, [...before, ...more])));
        return readWorkbook(payload, {
          workbook,
          answer: (request) => session.answer(request),
          utility: (request) => this.engine.utility(request),
          calculationTookTooLong: unfinished,
          timeZone: this.timeZone,
          charts: (view, sheets) => reader(sheets).chartsOf(view),
          interactive: (view, sheets) => reader(sheets).interactiveOf(view),
        });
      } finally {
        release();
      }
    });
  }

  /**
   * A walkthrough the agent sends (showGuide's `guide`), checked against the workbook as it stands: its stops, or a
   * refusal (unreadableRead, unknownSheetName, outsideTheSheet). Showing it is the host's (cli.ts, runSheetCall).
   */
  checkWalkthrough(guide: unknown): SheetWalkthrough {
    this.rescan();
    return this.refusing(() => {
      const { workbook, release } = this.contents();
      try {
        return checkWalkthrough(guide, sheetsOf(workbook));
      } finally {
        release();
      }
    });
  }

  /**
   * The agent's applyEdits: {kind: "applyEdits", base, edits}, made as one revision when base is the revision. Answers
   * {revision, changedNothing?}. An update on base 0 of a new Sheet builds on its first sheet.
   */
  agentUpdate(payload: unknown): EngineMessage {
    this.rescan();
    return this.refusing(() => {
      const isNew = this.revision === 0;
      this.ensureFirstSheet();
      return this.update(isNew && isObject(payload) && payload.base === 0 ? { ...payload, base: this.revision } : payload);
    });
  }

  private update(payload: unknown): EngineMessage {
    if (!isObject(payload) || payload.kind !== 'applyEdits') throw new AgentError('unreadableEdit', 'An update\'s payload is {"kind": "applyEdits", "base": <revision>, "edits": [...]}.');
    const { base, edits } = payload;
    const extra = Object.keys(payload).find((k) => k !== 'kind' && k !== 'base' && k !== 'edits');
    if (extra !== undefined) throw new AgentError('unreadableEdit', `applyEdits takes no "${extra}": its keys are base and edits.`);
    if (!isCount(base)) throw new AgentError('unreadableEdit', `base is the revision the edits build on (now ${this.revision}), as the last read or applyEdits gave it.`, { revision: this.revision });
    if (base !== this.revision) {
      throw new AgentError('baseIsNotTheRevision', `The Sheet is at revision ${this.revision}, not ${base}: it was edited since. Read what you change again, then send the edits with base ${this.revision}.`, { revision: this.revision });
    }
    const { revision, changedNothing } = this.applyAgentEdits(base, edits);
    return { revision, ...(changedNothing.length ? { changedNothing } : {}) };
  }

  /** The agent's edits recorded in the engine and logged as one edit by the agent. */
  private applyAgentEdits(base: number, edits: unknown): { revision: number; changedNothing: number[] } {
    return this.applyEditsAs(base, edits, AGENT);
  }

  /** Edits recorded in the engine and logged as one edit by `by`. */
  private applyEditsAs(base: number, edits: unknown, by: string, opId?: string): { revision: number; changedNothing: number[] } {
    let changedNothing: number[] = [];
    // The agent edits as the owner, whom the owner's pages name by the same id: its protections leave the owner in.
    const person = personId(by === AGENT ? this.ownerId : by);
    const recorded = recordEdits(
      { engine: this.engine, steps: this.edits.map((e) => e.ops), newest: this.newest, oldest: this.oldest, localeOfANewWorkbook: this.localeOfANewWorkbook, widgets: this.widgets, person },
      (context) => {
        changedNothing = applyEdits(edits, context).changedNothing;
      },
    );
    if (!recorded) return { revision: this.revision, changedNothing };
    const applied = this.applyToWorkbook(recorded.ops);
    if (applied.kind !== 'applied') throw new AgentError(String(applied.refusal ?? 'unreadableEdit'), `The Sheet refused it: ${String(applied.refusal ?? 'unreadableEdit')}.`);
    const edit = this.append({ v: recorded.v, base, ops: recorded.ops as Json[], ...(opId !== undefined ? { opId } : {}), by });
    return { revision: edit.revision, changedNothing };
  }

  /**
   * The agent's batch: widget creates, then at most one applyEdits, last (the one call that cannot be taken back).
   * "$lid:<name>" anywhere in a later call stands for the id of the widget made under $lid <name>. All of it is made or
   * none: when the applyEdits is refused, the widgets made before it are deleted. Answers {lids, acks}.
   */
  agentBatch(items: unknown): EngineMessage {
    this.rescan();
    return this.refusing(() => {
      const notMade = (item: number | undefined, why: string): AgentError => new AgentError('unreadableRequest', why, { committed: false, ...(item !== undefined ? { item } : {}) });
      if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) throw notMade(undefined, `batch is a list of 1 to ${MAX_BATCH} calls.`);
      for (const [i, item] of items.entries()) {
        if (!isObject(item)) throw notMade(i, 'Each call is an object.');
        const isCreate = item.verb === 'create';
        const isUpdate = item.verb === 'update' && isObject(item.payload) && item.payload.kind === 'applyEdits';
        if (!isCreate && !isUpdate) throw notMade(i, 'A batch holds widget creates and one applyEdits of the workbook.');
        if (isUpdate && i !== items.length - 1) throw notMade(i, 'The applyEdits goes last.');
      }
      const isNew = this.revision === 0;
      this.ensureFirstSheet();
      const lids: Record<string, string> = {};
      const acks: EngineMessage[] = [];
      const made: Widget[] = [];
      const undo = (): void => {
        for (const widget of made) this.widgets.delete(widget.id);
      };
      for (const [i, raw] of (items as EngineMessage[]).entries()) {
        const item = withLids(raw, lids) as EngineMessage;
        const payload = isObject(item.payload) ? item.payload : {};
        if (item.verb === 'create') {
          if (typeof payload.code !== 'string') {
            undo();
            throw notMade(i, 'A create\'s payload is {"code": "<the chart\'s code>"}.');
          }
          const widget = this.widgets.create(payload.code);
          made.push(widget);
          if (typeof raw.$lid === 'string') lids[raw.$lid] = widget.id;
          acks.push(widgetAnswer(widget, { minted: widget.id }));
          continue;
        }
        try {
          acks.push({ outcome: 'applied', data: this.update(isNew && payload.base === 0 ? { ...payload, base: this.revision } : payload) });
        } catch (error) {
          undo();
          if (error instanceof AgentError) throw new AgentError(error.code, error.message, { ...error.extra, committed: false, item: i }, error.hint);
          throw error;
        }
      }
      for (const widget of made) this.published(widget);
      return { lids, acks };
    });
  }

  /**
   * The agent's calls on widgets: {action: "create", code}, {action: "read", widget}, {action: "draft", widget,
   * basePub, code}, {action: "list"}.
   */
  agentWidget(payload: unknown): EngineMessage {
    this.rescan();
    return this.refusing(() => {
      if (!isObject(payload) || typeof payload.action !== 'string') throw new AgentError('unreadableRequest', 'A widget call is {"action": "create" | "read" | "draft" | "list", …}.');
      const id = typeof payload.widget === 'string' ? payload.widget.replace(/^node\//, '') : '';
      const unknown = (): AgentError => new AgentError('unknownWidget', `This Sheet has no widget ${JSON.stringify(payload.widget)}: the list action gives each widget's id.`);
      switch (payload.action) {
        case 'create': {
          if (typeof payload.code !== 'string') throw new AgentError('unreadableRequest', 'A create is {"action": "create", "code": "<the chart\'s code>"}.');
          const widget = this.widgets.create(payload.code);
          this.published(widget);
          return widgetAnswer(widget, { minted: widget.id });
        }
        case 'read': {
          const widget = this.widgets.get(id);
          if (!widget) throw unknown();
          return { widget: id, code: widget.code, pub: widget.pub, errors: widget.errors };
        }
        case 'draft': {
          const widget = this.widgets.get(id);
          if (!widget) throw unknown();
          if (typeof payload.code !== 'string' || !isCount(payload.basePub)) throw new AgentError('unreadableRequest', 'A draft is {"widget": <id>, "basePub": <the pub a read gives>, "code": "<the whole code>"}.');
          if (payload.basePub !== widget.pub) throw new AgentError('changedSince', `The widget's code was published again since: it is at pub ${widget.pub}. Read it, then send the draft with that basePub.`, { pub: widget.pub });
          const next = this.widgets.draft(widget, payload.code);
          if (next.pub !== widget.pub) this.published(next);
          return { widget: id, ...widgetAnswer(next) };
        }
        case 'list': {
          const views = this.contents().workbook.views ?? [];
          return {
            widgets: this.widgets.list().map((w) => ({
              widget: w.id,
              pub: w.pub,
              outcome: w.errors.length ? 'staged-with-errors' : 'published',
              chartId: views.find((v) => v.view.elements.some((e) => e.embed.ref === `node/${w.id}`))?.viewId ?? null,
              at: w.at,
            })),
          };
        }
        default:
          throw new AgentError('unreadableRequest', `"${payload.action}" is not a widget call: create, read, draft, list.`);
      }
    });
  }

  // ---------- exports ----------

  /**
   * The workbook as a file: an .xlsx file as the engine writes it (with the charts it can describe), or one sheet as
   * CSV (the first, or the one `sheet` names).
   */
  exportFile(format: 'xlsx' | 'csv', options: { sheet?: string } = {}): ExportedFile {
    this.rescan();
    const { workbook, session } = this.contents();
    const firstSheet = workbook.sheets[0]?.name ?? 'Sheet1';
    if (format === 'csv') {
      const sheets = sheetsOf(workbook);
      const view = this.refusing(() => (options.sheet === undefined ? sheets[0] : pickSheet(sheets, options.sheet)));
      const text = view ? csvOf(view) : '';
      const stem = xlsxFileName(this.meta.title, firstSheet).replace(/\.xlsx$/, '');
      return { filename: `${stem}${view && sheets.length > 1 ? ` - ${view.name}` : ''}.csv`, bytes: new TextEncoder().encode(text), notCarriedOver: [] };
    }
    const answer = session.answer(xlsxRequest(this.describedCharts(workbook, session)));
    const parts = xlsxPartsOf(answer);
    if (!parts) {
      const refusal = String(answer.refusal ?? 'xlsxNotWritten');
      throw SheetRefusalError.of(new AgentError(refusal, refusal === 'noSheetToWrite' ? 'The Sheet has no sheets yet: write some cells first.' : `The engine did not write the workbook as a file (${refusal}).`));
    }
    return { filename: xlsxFileName(this.meta.title, firstSheet), bytes: zipXlsxParts(parts), notCarriedOver: excelDifferences(answer.notCarriedOver) };
  }

  // ---------- connected tables ----------

  /**
   * Hands a session the records of its connected tables, so its cells, formulas and exports hold them. A session that
   * takes them takes no more operations: only the sessions reads are made in (contents) get them.
   */
  private holdTableFiles(session: EngineSession): void {
    const notHeld = session.answer({ kind: 'readSnapshotsNotHeld' });
    if (notHeld.kind !== 'snapshotsNotHeld' || !Array.isArray(notHeld.snapshotIds)) return;
    for (const snapshotId of notHeld.snapshotIds) {
      if (typeof snapshotId !== 'string') continue;
      const lines = tableFileText(this.dir, this.files, snapshotId);
      const answer = lines === null ? null : session.answer({ kind: 'receiveLinesOfTableFile', snapshotId, lines, isLast: true });
      if (answer?.kind !== 'syncState') {
        if (lines !== null) this.log(`tables: the file of snapshot ${snapshotId} was not read (${String(answer?.refusal ?? answer?.kind)})`);
        session.answer({ kind: 'tableFileIsGone', snapshotId });
      }
    }
  }

  /** A sheet's connected table as the workbook stands: its sheet, its call's digest and its columns; null when it is none. */
  private connectedTable(find: (sheets: SheetView[]) => SheetView | undefined): { view: SheetView; sheetNumber: number; callDigest: string; fields: string[] } | null {
    const { workbook, session, release } = this.contents();
    try {
      const sheets = sheetsOf(workbook);
      const view = find(sheets);
      const table = view?.contents.connectedTable;
      if (!view || !table) return null;
      const read = session.answer({ kind: 'readConnectedTable', sheetId: view.sheetId });
      if (read.kind !== 'connectedTable' || typeof read.callDigest !== 'string') return null;
      const fields = table.columns.flatMap(({ column }) => (isObject(column.from) && typeof column.from.field === 'string' ? [column.from.field] : []));
      return { view, sheetNumber: sheets.indexOf(view) + 1, callDigest: read.callDigest, fields };
    } finally {
      release();
    }
  }

  /**
   * `POST send` {kind: "refreshConnectedTable"}: hands the table's call to the agent, which sends the records back
   * (agentRefresh). Answers at once; only the owner may ask.
   */
  async refreshConnectedTable(request: SheetRefreshRequest, viewer: Viewer): Promise<SheetSendResponse> {
    this.rescan();
    const refuse = (refusal: string): SheetSendResponse => ({ kind: 'refused', refusal });
    if (!viewer.isOwner) return refuse('notOwner');
    if (!isObject(request) || typeof request.sheetId !== 'string' || typeof request.callDigest !== 'string') return refuse('unreadableEdit');
    const table = this.connectedTable((sheets) => sheets.find((s) => s.sheetId === request.sheetId));
    if (table === null) return refuse('notAConnectedTable');
    if (table.callDigest !== request.callDigest) return refuse('callChanged');
    const under = this.refreshing.get(request.sheetId);
    if (under !== undefined && under.until > Date.now() && under.callDigest === request.callDigest) return refuse('refreshUnderWay');
    if (this.sendToAgent === null) return refuse('agentNotListening');
    // Kept before the agent is asked: a second press while the first is on its way is refused, not asked again.
    const asking = { callDigest: request.callDigest, until: Date.now() + REFRESH_WAIT_MS };
    this.refreshing.set(request.sheetId, asking);
    let taken = false;
    try {
      taken = await this.sendToAgent(refreshRequest(table.view.name, table.sheetNumber, table.callDigest));
    } catch (error) {
      this.log(`refresh: the request did not reach the agent (${(error as Error).message})`);
    }
    if (!taken) {
      if (this.refreshing.get(request.sheetId) === asking) this.refreshing.delete(request.sheetId);
      return refuse('agentNotListening');
    }
    return { kind: 'refreshAsked' };
  }

  /**
   * The agent's refresh: {sheet, callDigest, records, isCutOff?} keeps the records as the table's new snapshot (one
   * edit by the agent); {sheet, callDigest, failed: {why, toolSaid?}} tells the owner's pages why there are none.
   * `callDigest` is the call the agent made, as readConnectedTable gave it: a call changed since is refused.
   */
  agentRefresh(payload: unknown): EngineMessage {
    this.rescan();
    return this.refusing(() => {
      if (!isObject(payload)) throw new AgentError('unreadableRefresh', 'A refresh is {"sheet", "callDigest", "records": [...]} or {"sheet", "callDigest", "failed": {"why"}}.');
      const keys = Object.keys(payload).filter((k) => !['sheet', 'callDigest', 'records', 'isCutOff', 'failed'].includes(k));
      if (keys.length > 0) throw new AgentError('unreadableRefresh', `A refresh takes no "${keys[0]}": its keys are sheet, callDigest, and records (with isCutOff?) or failed.`);
      if (('records' in payload) === ('failed' in payload)) throw new AgentError('unreadableRefresh', 'A refresh has records, or failed: one of them.');
      let named: SheetView | undefined;
      const table = this.connectedTable((sheets) => (named = pickSheet(sheets, payload.sheet)));
      if (table === null) throw new AgentError('notAConnectedTable', `Sheet "${named?.name ?? String(payload.sheet)}" is no connected table.`);
      if (payload.callDigest !== table.callDigest) {
        throw new AgentError('callChanged', `The call of "${table.view.name}" is not the one you made (callDigest ${table.callDigest} now): read it again with readConnectedTable, and make the call as it stands.`, { callDigest: table.callDigest });
      }
      const sheetId = table.view.sheetId;
      if ('failed' in payload) {
        const failed = refreshFailure(payload.failed);
        this.refreshing.delete(sheetId);
        const outcome = { sheetId, callDigest: table.callDigest, ...failed, at: new Date().toISOString() };
        const size = refreshesSize(this.dir, this.files);
        const bytes = appendRefreshOutcome(this.dir, this.files, outcome);
        // Told here at once when nothing else was written meanwhile; a store in another process reads it as it rescans.
        if (this.refreshesRead === size) {
          this.refreshesRead = size + bytes;
          this.tellRefreshOutcome(outcome);
        }
        return { sheet: table.view.name, told: failed.why };
      }
      if (payload.isCutOff !== undefined && typeof payload.isCutOff !== 'boolean') throw new AgentError('unreadableRefresh', 'isCutOff is true when the records stop short of what the call has (a page limit you did not follow to the end).');
      const file = tableFileOf(payload.records, payload.isCutOff === true);
      const snapshotId = randomBytes(16).toString('hex');
      writeTableFile(this.dir, this.files, snapshotId, file.lines);
      const snapshot = {
        snapshotId,
        rowCount: file.rowCount,
        fieldCount: file.fieldCount,
        textInBytes: file.textInBytes,
        isCutOff: file.isCutOff,
        fetchedAtInSecondsSince1970: Math.floor(Date.now() / 1000),
        callDigest: table.callDigest,
      };
      const ops: Json[] = [{ kind: 'setSnapshots', snapshots: [{ sheetId, snapshot }] }];
      const applied = this.applyToWorkbook(ops);
      if (applied.kind !== 'applied') throw new AgentError(String(applied.refusal ?? 'unreadableRefresh'), `The Sheet refused the records: ${String(applied.refusal ?? applied.kind)}.`);
      const edit = this.append({ v: SNAPSHOT_EDIT_FORMAT_VERSION, base: this.revision, ops, by: AGENT });
      const given = new Set(JSON.parse(file.lines[0]!).table.fields as string[]);
      const fieldsMissing = table.fields.filter((field) => !given.has(field));
      return {
        revision: edit.revision,
        sheet: table.view.name,
        rowCount: file.rowCount,
        ...(file.isCutOff ? { isCutOff: true } : {}),
        ...(fieldsMissing.length ? { fieldsNoRecordHas: fieldsMissing } : {}),
      };
    });
  }

  /** Refreshes another process told of (the agent's command line), sent to the owner's pages. */
  private rescanRefreshes(): void {
    if (refreshesSize(this.dir, this.files) === this.refreshesRead) return;
    const { outcomes, end } = readRefreshOutcomes(this.dir, this.files, this.refreshesRead);
    this.refreshesRead = end;
    for (const outcome of outcomes) this.tellRefreshOutcome(outcome);
  }

  private tellRefreshOutcome({ sheetId, callDigest, why, toolSaid }: { sheetId: string; callDigest: string; why: string; toolSaid?: string }): void {
    this.refreshing.delete(sheetId);
    for (const stream of this.streams) {
      if (stream.viewer.isOwner) stream.emit({ phase: 'tableRefresh', sheetId, callDigest, outcome: { state: 'refused', why, ...(toolSaid ? { toolSaid } : {}) } });
    }
  }

  /** Deleted sheets, the latest first, by the names they had (what restoreSheet can bring back). */
  deletedSheets(): { sheetId: string; name: string }[] {
    return deletedSheets(this.engine, this.edits.map((e) => e.ops));
  }

  close(): void {
    for (const stream of this.streams) clearInterval(stream.clock);
    this.streams.clear();
    this.stopNoticing();
    this.dropSessions();
    this.workbook.free();
  }
}

/** What a create or a draft of a widget answers the agent: its outcome, its pub, and the errors that staged it. */
function widgetAnswer(widget: Widget, extra: EngineMessage = {}): EngineMessage {
  return { outcome: widget.errors.length ? 'staged-with-errors' : 'published', ...extra, pub: widget.pub, ...(widget.errors.length ? { errors: widget.errors } : {}) };
}

/** A batch call with each "$lid:<name>" in it put as the id made under that $lid. */
function withLids(value: unknown, lids: Record<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith('$lid:')) return lids[value.slice(5)] ?? value;
  if (Array.isArray(value)) return value.map((v) => withLids(v, lids));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withLids(v, lids)]));
  return value;
}
