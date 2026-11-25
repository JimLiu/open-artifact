/**
 * One tab kept in step with the server.
 *
 * The page edits a shadow of the tab: the tab as the server will hold it once every op sent so far lands. Each edit is
 * diffed into ops against the shadow (diff.ts) and queued; one call is in flight at a time and carries everything
 * queued. Someone else's write (a frame, or a rev that jumped) makes the tab stale: once nothing is in flight the tab
 * is read again, the ops still queued are laid on top of it (an op the new tab refuses is dropped), and the editor is
 * told to show the result. Ids make the ops land where they were meant on a tab that moved on, so there is nothing to
 * transform.
 *
 * Every group of ops is also kept in the write-ahead log (wal.ts) until the server has it. When the tab opens, what an
 * earlier page left there goes out first, under the `opId` it went out with before (the server answers a call it
 * already landed instead of landing it twice). A call that can't reach the server is tried again after a wait that
 * doubles from 250 ms up to 30 s (backoff.ts), or at once when the connection comes back.
 */
import { type DocState, Refusal, type Session, applyOps, docFromDisk, type DiskDoc, splitId, walk } from '@open-artifact/docs-core';
import type { DocCallAnswer, DocMember, DocSuggestion, DocTabFrame, DocTabResponse } from '@open-artifact/runtime/doc-api';
import { Backoff, BACKOFF_BASE_MS } from './backoff.ts';
import { type PageDiff, type TopWindow, diffPage, diffTop } from './diff.ts';
import { type PageNode, docToPage } from './page.ts';
import { type TabWal, browserTabWal } from './wal.ts';

type Json = Record<string, unknown>;

export interface DocTransport {
  call(request: { sess: string; opId: string; member: DocMember }): Promise<DocCallAnswer>;
  read(tab: string): Promise<DocTabResponse>;
  /**
   * The server let the page's session go (its event stream closed for a while): takes a new one into the session the
   * tabs share. Answers false when the page may no longer write.
   */
  renew?(): Promise<boolean>;
}

/**
 * `saved`: nothing waits; `saving`: edits are going out; `syncing`: others' writes are being read in; `unsaved`: edits
 * have waited a while, or can't go out because the server can't be reached; `reconnecting`: the server can't be reached
 * (it is tried again) and nothing of the page's waits; `stopped`: the page may write no more.
 */
export type SyncStatus = 'saved' | 'saving' | 'syncing' | 'unsaved' | 'reconnecting' | 'stopped';

/** Why the shadow changed under the editor. */
export type ShadowCause = 'remote' | 'refused' | 'local';

export interface TabSyncEvents {
  /** The editor shows this doc (it already shows every edit it made itself). */
  shadow(doc: DocState, cause: ShadowCause): void;
  status?(status: SyncStatus, detail?: string): void;
  suggestions?(suggestions: DocSuggestion[]): void;
  /** What a call answered, for the edits that wait on it (a decision's undo). */
  answered?(answer: DocCallAnswer & Json, ops: Json[]): void;
  /**
   * Edits the server would not take were dropped; `words` is the text they would have added (cut short). Without this
   * handler the words go to {@link onUnsavedWords}.
   */
  unsaved?(words: string, reason?: string): void;
  /** An undo or redo couldn't be saved: the page halted, showing what it shows, and {@link TabSync.rescue} may restore it. */
  undoLost?(): void;
}

export interface TabSyncOptions {
  tab: string;
  /** The tab's body node, which the page writes through. */
  node: string;
  session: Session;
  transport: DocTransport;
  events: TabSyncEvents;
  /** The first wait before a call that could not reach the server is sent again, in ms; it doubles, up to 30 s. */
  retryMs?: number;
  /** The write-ahead log; left out, the page's IndexedDB log (none without IndexedDB). `null`: no log. */
  wal?: TabWal | null;
}

const DENIALS_BEFORE_GIVING_UP = 3;

/** How long edits may wait for the server before the page says they aren't saved. */
export const UNSAVED_AFTER_MS = 4000;

/** How long a call waits for its ops to be in the write-ahead log. */
const WAL_WAIT_MS = 500;

/** The most of the dropped words a notice quotes. */
const WORDS_MAX = 80;

/** A group of ops waiting to land. */
interface Pending {
  ops: Json[];
  /** Its place in the write-ahead log. */
  seq?: number;
  /** When it was made (ms). */
  at: number;
  /** Left by an earlier page: it goes out under this call's `opId`, so the server lands it once. */
  opId?: string;
  /** Left by an earlier page that had sent it: it may have landed already. */
  landed?: boolean;
  /** Made by an undo or redo. */
  undo?: boolean;
}

/** Refusals no retry gets past: what was sent is dropped at once. */
const TERMINAL = new Set(['locked', 'doc_too_large']);

/** How a {@link TabSync.rescue} ended. */
export type RescueOutcome = 'restored' | 'changed_since' | 'refused' | 'not_seen';

// ---- dropped words, for whoever shows them -------------------------------------------------------------------------

const unsavedListeners = new Set<(words: string, tab: string, reason?: string) => void>();

/**
 * Hears the words of edits a tab dropped (when its sync has no `unsaved` handler). `reason` is the server's, when a
 * refusal no retry gets past dropped them (`locked`, `doc_too_large`); `words` may then be empty.
 */
export function onUnsavedWords(listener: (words: string, tab: string, reason?: string) => void): () => void {
  unsavedListeners.add(listener);
  return () => unsavedListeners.delete(listener);
}

const undoLostListeners = new Set<(sync: TabSync) => void>();

/** Hears a tab halting because an undo or redo couldn't be saved (when its sync has no `undoLost` handler). */
export function onUndoLost(listener: (sync: TabSync) => void): () => void {
  undoLostListeners.add(listener);
  return () => undoLostListeners.delete(listener);
}

/** The text ops would add (inserted words, and the words of inserted blocks), cut to `max` characters. */
export function wordsOfOps(ops: readonly Json[], max = WORDS_MAX): string {
  const parts: string[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Json;
    if (typeof node.text === 'string') parts.push(node.text);
    if (node.content !== undefined) collect(node.content);
  };
  for (const op of ops) {
    if (op.op !== 'insert' && op.op !== 'replace') continue;
    const from = ((op.with as Json | undefined)?.from ?? null) as Json | null;
    if (from && Array.isArray(from.content)) collect(from.content);
    else if (from && typeof from.content === 'string') parts.push(from.content);
  }
  const words = parts.join(' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(words);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : words;
}

/** The ids ops name for what they make. */
function idsOfOps(ops: readonly Json[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    const ids = op.ids;
    if (ids && typeof ids === 'object' && !Array.isArray(ids) && typeof (ids as Json).from === 'string') {
      const start = splitId((ids as Json).from as string);
      const count = Number((ids as Json).count ?? 1);
      if (start && Number.isInteger(count) && count > 0) for (let n = 0; n < Math.min(count, 64); n++) out.push(`${start.sess}.${start.n + n}`);
    } else if (Array.isArray(ids)) {
      for (const id of ids) if (typeof id === 'string') out.push(id);
    }
  }
  return out;
}

/** Whether the tab holds any of the ids the ops make: they landed before. */
function madeAlready(doc: DocState, ops: readonly Json[]): boolean {
  const ids = idsOfOps(ops);
  if (!ids.length) return false;
  const wanted = new Set(ids);
  for (const { block } of walk(doc.blocks)) {
    if (wanted.has(block.id)) return true;
    for (const item of block.inline ?? []) if (wanted.has(item.id)) return true;
  }
  return false;
}

export class TabSync {
  readonly tab: string;
  readonly node: string;
  private session: Session;
  private transport: DocTransport;
  private events: TabSyncEvents;
  private backoff: Backoff;
  private current: DocState;
  private queued: Pending[] = [];
  private sending: { opId: string; items: Pending[]; replay: boolean } | null = null;
  private reading = false;
  private stale = false;
  private stopped = false;
  private denials = 0;
  private dropped: Pending[] = [];
  private renewed = false;
  private renewing = false;
  /**
   * Names this sync's calls apart from every other sync's: the page's tabs share one session, and the server answers
   * a call whose `opId` it has seen as a replay of the first, so a second tab counting from 1 again would land nothing.
   */
  private readonly opBase: string;
  private calls = 0;
  private localEdits = 0;

  get editCount(): number {
    return this.localEdits;
  }

  get hasLocalChanges(): boolean {
    return !!(this.sending || this.queued.length || this.recovered?.length || this.halted);
  }
  private rev: number;
  private waiters: Array<() => void> = [];
  private status: SyncStatus = 'saved';
  private held = false;
  /** The server could not be reached; `retry` runs when it is tried again. */
  private offline = false;
  private retry: { timer: ReturnType<typeof setTimeout>; run: () => void } | null = null;
  private unsavedTimer: ReturnType<typeof setTimeout> | null = null;
  private wal: TabWal | null;
  /** What an earlier page left in the log, waiting to go to the front of the queue. */
  private recovered: Pending[] | null = null;
  private readonly forgetOnline: () => void;
  /** Why what went out last was dropped at once, until the tab is read again. */
  private terminal: string | null = null;
  /** Halted after an undo or redo was lost: the tab as saved, and its rev, for {@link rescue}. */
  private halted: { saved: DocState; rev: number } | null = null;

  constructor(options: TabSyncOptions, tab: DocTabResponse) {
    this.tab = options.tab;
    this.node = options.node;
    this.session = options.session;
    this.opBase = `${options.tab}.${nonce()}`;
    this.transport = options.transport;
    this.events = options.events;
    this.backoff = new Backoff(options.retryMs ?? BACKOFF_BASE_MS);
    this.current = docFromDisk(tab.doc as unknown as DiskDoc);
    this.rev = tab.rev;
    // A reader (the page names its session so) writes nothing: it keeps no log and sends nothing left over either.
    const reader = this.session.sess === 'reader';
    this.wal = options.wal === undefined ? (reader ? null : safeWal(this.tab, this.session.sess)) : options.wal;
    this.events.suggestions?.(tab.suggestions);
    this.forgetOnline = listenOnline(() => this.tryNow());
    if (this.wal && !reader) void this.recover();
  }

  /** The tab as the page shows it. */
  get shadow(): DocState {
    return this.current;
  }

  /** The rev of the tab the server last answered with. */
  get serverRev(): number {
    return this.rev;
  }

  get busy(): boolean {
    return this.queued.length > 0 || this.recovered !== null || this.sending !== null || this.reading || this.renewing;
  }

  /**
   * The editor changed the top-level blocks of `window`. Answers the ids the editor writes on its new blocks. `undo`:
   * an undo or redo made the change.
   */
  edit(window: TopWindow, how: { undo?: boolean } = {}): PageDiff {
    return this.take(diffTop(this.current, window, this.session), how.undo);
  }

  /** The editor's doc as a whole (tests, and an editor that can't say what changed). */
  editPage(page: PageNode, how: { undo?: boolean } = {}): PageDiff {
    return this.take(diffPage(this.current, page, this.session), how.undo);
  }

  /** Halted because an undo or redo couldn't be saved; {@link rescue} may restore the tab to what the page shows. */
  get needsRescue(): boolean {
    return this.halted !== null;
  }

  /**
   * Makes the saved tab what the page shows: one write, refused if the tab changed since the page read it. On
   * `restored` the page should be reloaded; on anything else the tab is as it was, and the page stays halted.
   */
  async rescue(): Promise<RescueOutcome> {
    const halted = this.halted;
    if (!halted) return 'refused';
    const next = this.session.next;
    let ops: Json[];
    try {
      ops = diffPage(halted.saved, docToPage(this.current), this.session).ops;
    } catch {
      this.session.next = next;
      return 'refused';
    }
    const finish = (rev: number): RescueOutcome => {
      this.wal?.done(seqsOf(this.queued));
      this.queued = [];
      this.halted = null;
      this.rev = Math.max(this.rev, rev);
      return 'restored';
    };
    if (!ops.length) return finish(halted.rev);
    const opId = `${this.session.sess}.${this.opBase}.r${++this.calls}`;
    const member: DocMember = { verb: 'update', ref: { object: 'node', id: this.node }, payload: { ops, ifRev: halted.rev, strict: true } as DocMember['payload'] };
    let answer: DocCallAnswer & Json;
    try {
      answer = (await this.transport.call({ sess: this.session.sess, opId, member })) as DocCallAnswer & Json;
    } catch {
      return 'not_seen';
    }
    if (answer.verdict === 'allow') return finish(typeof answer.rev === 'number' ? answer.rev : halted.rev + 1);
    // Nothing landed: the ids it minted are free again.
    this.session.next = next;
    return answer.reason === 'guard_mismatch' ? 'changed_since' : 'refused';
  }

  /** Ops the page writes itself (a decision on a suggestion): the editor is shown what they make. */
  write(ops: Json[]): DocState {
    const { doc } = applyOps(this.current, ops, this.session);
    this.current = doc;
    this.enqueue(ops);
    this.events.shadow(doc, 'local');
    this.pump();
    return doc;
  }

  /** A frame of someone else's write to this tab. */
  heard(frame: DocTabFrame): void {
    if (frame.tab !== this.tab || (frame.sess && frame.sess === this.session.sess)) return;
    if (frame.rev <= this.rev && !this.sending) return;
    this.stale = true;
    this.pump();
  }

  /** The event stream came back after a gap: whatever was written meanwhile is read, and a waiting call goes now. */
  reconnected(): void {
    this.stale = true;
    if (this.retry) this.tryNow();
    else this.pump();
  }

  /** Resolves once nothing is queued, out or being read. */
  settled(): Promise<void> {
    if (this.halted || (!this.busy && (!this.stale || this.held))) return Promise.resolve();
    return new Promise(done => this.waiters.push(done));
  }

  /**
   * While held, others' writes are not read in (the editor can't take them now: an input method is composing); the
   * page's own edits still go out. Letting go reads what came meanwhile.
   */
  hold(held: boolean): void {
    this.held = held;
    if (!held) this.pump();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = null;
    if (this.unsavedTimer) clearTimeout(this.unsavedTimer);
    this.unsavedTimer = null;
    this.forgetOnline();
    this.wal?.close();
    this.setStatus('stopped');
  }

  private take(diff: PageDiff, undo?: boolean): PageDiff {
    if (diff.ops.length) {
      this.current = diff.shadow;
      this.enqueue(diff.ops, undo);
      this.pump();
    }
    return diff;
  }

  /** Queues ops the page made, kept in the log first. */
  private enqueue(ops: Json[], undo?: boolean): void {
    this.localEdits++;
    const seq = this.wal?.append(ops);
    this.queued.push({ ops, at: Date.now(), ...(seq !== undefined ? { seq } : {}), ...(undo ? { undo: true } : {}) });
  }

  /** Takes what an earlier page left of this tab: it goes out before anything else waiting. */
  private async recover(): Promise<void> {
    const entries = await this.wal!.recover();
    if (!entries.length || this.stopped) return;
    const now = Date.now();
    this.recovered = entries.map(entry => ({ ops: entry.ops, seq: entry.seq, at: now, ...(entry.opId ? { opId: entry.opId } : {}), ...(entry.sent ? { landed: true } : {}) }));
    this.stale = true;
    this.pump();
  }

  private setStatus(status: SyncStatus, detail?: string): void {
    if (this.status === status && !detail) return;
    this.status = status;
    this.events.status?.(status, detail);
  }

  /** The status the page is in now; edits that waited long enough to count as unsaved are checked again later. */
  private refresh(): void {
    if (this.stopped) return;
    const oldest = this.queued[0]?.at ?? (this.recovered?.length ? Date.now() : null);
    if (this.unsavedTimer) clearTimeout(this.unsavedTimer);
    this.unsavedTimer = null;
    const waited = oldest === null ? 0 : Date.now() - oldest;
    if (oldest !== null && !this.offline && waited < UNSAVED_AFTER_MS) {
      this.unsavedTimer = setTimeout(() => {
        this.unsavedTimer = null;
        this.refresh();
      }, UNSAVED_AFTER_MS - waited);
    }
    let status: SyncStatus;
    if (this.offline) status = oldest !== null ? 'unsaved' : 'reconnecting';
    else if (oldest !== null && waited >= UNSAVED_AFTER_MS) status = 'unsaved';
    else if (oldest !== null || this.sending || this.renewing) status = 'saving';
    else if (this.reading || (this.stale && !this.held)) status = 'syncing';
    else status = 'saved';
    this.setStatus(status);
  }

  private pump(): void {
    if (this.stopped) return;
    if (this.sending || this.reading || this.renewing || this.retry) {
      // An edit made meanwhile may change what the page says (edits waiting while the server can't be reached).
      this.refresh();
      return;
    }
    if (this.recovered) {
      this.queued.unshift(...this.recovered);
      this.recovered = null;
    }
    if (this.stale && !this.held) {
      void this.reread();
      return;
    }
    if (!this.queued.length) {
      if (this.stale) return this.refresh();
      this.refresh();
      const waiters = this.waiters.splice(0);
      for (const done of waiters) done();
      return;
    }
    // Ops an earlier page sent go again alone under their call's opId; the page's own go together under a new one.
    const first = this.queued[0]!;
    let count = 1;
    while (count < this.queued.length && this.queued[count]!.opId === first.opId) count++;
    const items = this.queued.slice(0, count);
    const opId = first.opId ?? `${this.session.sess}.${this.opBase}.w${++this.calls}`;
    this.wal?.sent(seqsOf(items), opId);
    this.sending = { opId, items, replay: first.opId !== undefined };
    this.refresh();
    void this.send(opId, items.flatMap(item => item.ops));
  }

  private async send(opId: string, ops: Json[]): Promise<void> {
    if (this.wal) await this.wal.flushed(WAL_WAIT_MS);
    if (this.stopped) return;
    const member: DocMember = { verb: 'update', ref: { object: 'node', id: this.node }, payload: { ops } as DocMember['payload'] };
    let answer: DocCallAnswer & Json;
    try {
      answer = (await this.transport.call({ sess: this.session.sess, opId, member })) as DocCallAnswer & Json;
    } catch {
      // Unreachable: the same call again later (its opId makes a second landing a replay).
      this.unreachable(() => void this.send(opId, ops));
      return;
    }
    this.reachable();
    const sent = this.sending!;
    this.sending = null;
    if (answer.verdict === 'allow') {
      this.denials = 0;
      this.renewed = false;
      this.queued.splice(0, sent.items.length);
      this.wal?.done(seqsOf(sent.items));
      const rev = typeof answer.rev === 'number' ? answer.rev : undefined;
      if (rev !== undefined) {
        // A rev past ours plus this write: someone else wrote in between.
        if (rev > this.rev + (answer.noop || answer.replayed ? 0 : 1)) this.stale = true;
        this.rev = Math.max(this.rev, rev);
      }
      // What an earlier page sent is read back rather than taken from an answer the page didn't ask for.
      if (sent.replay) this.stale = true;
      // A restored undecide changes the tab beyond this write, and the page keeps no record of its decisions.
      if ((answer.undecided as { outcome?: string } | undefined)?.outcome === 'restored') this.stale = true;
      if (!sent.replay) this.events.answered?.(answer, ops);
    } else if (answer.reason === 'not_your_session' && this.transport.renew && !this.renewed) {
      // Ids already minted under the old session still land: they are taken as given.
      this.renewed = true;
      this.renewing = true;
      const renewed = await this.transport.renew().catch(() => false);
      this.renewing = false;
      if (!renewed) return this.giveUp(answer.reason);
      this.stale = true;
    } else if (answer.reason === 'not_your_session' || answer.reason === 'not_writer') {
      return this.giveUp(answer.reason);
    } else if (TERMINAL.has(String(answer.reason))) {
      // Sent again it is refused again: what went out is dropped now (all of it when nothing may be written).
      const lost = answer.reason === 'locked' ? this.queued.length : sent.items.length;
      const items = this.queued.splice(0, lost);
      this.dropped.push(...items);
      this.wal?.done(seqsOf(items));
      this.terminal = String(answer.reason);
      this.denials = 0;
      this.stale = true;
    } else {
      this.denials++;
      if (this.denials >= DENIALS_BEFORE_GIVING_UP) {
        this.dropped.push(...this.queued);
        this.wal?.done(seqsOf(this.queued));
        this.queued = [];
        this.denials = 0;
      }
      this.stale = true;
    }
    this.pump();
  }

  /** The server could not be reached: `again` runs after the next wait (sooner when the connection comes back). */
  private unreachable(again: () => void): void {
    if (this.stopped) return;
    const wait = this.backoff.fail();
    this.offline = true;
    this.refresh();
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = { timer: setTimeout(() => this.runRetry(), wait), run: again };
  }

  private reachable(): void {
    this.backoff.succeed();
    this.offline = false;
  }

  private runRetry(): void {
    const retry = this.retry;
    if (!retry) return;
    clearTimeout(retry.timer);
    this.retry = null;
    if (!this.stopped) retry.run();
  }

  /** The connection is back: what waits for a retry goes now, and the waits start over. */
  private tryNow(): void {
    if (!this.retry) return;
    this.backoff.succeed();
    this.runRetry();
  }

  /** Nothing queued can land: the page shows the tab as the server holds it, and writes no more. */
  private async giveUp(reason: string): Promise<void> {
    this.dropped.push(...this.queued);
    // Edits the person may no longer make are let go; edits that lost their session wait for a page that has one.
    if (reason === 'not_writer') this.wal?.done(seqsOf(this.queued));
    this.queued = [];
    await this.reread(true);
    this.stopped = true;
    if (this.unsavedTimer) clearTimeout(this.unsavedTimer);
    this.unsavedTimer = null;
    this.setStatus('stopped', reason);
  }

  private async reread(dropped = false): Promise<void> {
    this.reading = true;
    this.stale = false;
    this.refresh();
    let tab: DocTabResponse;
    try {
      tab = await this.transport.read(this.tab);
    } catch {
      this.reading = false;
      this.stale = true;
      if (dropped) {
        // Giving up: the page keeps what it shows.
        this.tellDropped([]);
        return;
      }
      this.unreachable(() => this.pump());
      return;
    }
    this.reachable();
    this.reading = false;
    const shown = this.current;
    const saved = docFromDisk(tab.doc as unknown as DiskDoc);
    const refused = this.rebase(saved);
    const lost = [...this.dropped.splice(0), ...refused];
    const terminal = this.terminal;
    this.terminal = null;
    this.rev = tab.rev;
    this.events.suggestions?.(tab.suggestions);
    if (!dropped && !terminal && lost.some(item => item.undo && !item.landed)) return this.halt(shown, saved, tab.rev);
    this.events.shadow(this.current, lost.length || dropped ? 'refused' : 'remote');
    this.tellDropped(lost, terminal ?? undefined);
    this.pump();
  }

  /**
   * Part of an undo or redo couldn't be saved: laying the tab as saved under the editor would take back text the
   * person just brought back, and a reload would lose it. The page keeps showing what it shows and writes no more, and
   * may restore the tab to it ({@link rescue}).
   */
  private halt(shown: DocState, saved: DocState, rev: number): void {
    this.current = shown;
    this.halted = { saved, rev };
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = null;
    if (this.unsavedTimer) clearTimeout(this.unsavedTimer);
    this.unsavedTimer = null;
    this.setStatus('stopped', 'reseat_failed');
    if (this.events.undoLost) this.events.undoLost();
    else for (const listener of undoLostListeners) listener(this);
    const waiters = this.waiters.splice(0);
    for (const done of waiters) done();
  }

  /**
   * Says which words of dropped edits weren't saved (edits an earlier page may have landed say nothing). Dropped by a
   * refusal no retry gets past, it says so even without words.
   */
  private tellDropped(lost: readonly Pending[], reason?: string): void {
    const all = [...this.dropped.splice(0), ...lost].filter(item => !item.landed);
    const words = wordsOfOps(all.flatMap(item => item.ops));
    if (!words && !reason) return;
    if (this.events.unsaved) this.events.unsaved(words, reason);
    else for (const listener of unsavedListeners) listener(words, this.tab, reason);
  }

  /** Lays the queued ops on the tab as read; answers those refused (and dropped). */
  private rebase(doc: DocState): Pending[] {
    let next = doc;
    const refused: Pending[] = [];
    const kept: Pending[] = [];
    for (const item of this.queued) {
      // Left by an earlier page that sent it, and the tab has what it made: it landed then.
      if (item.landed && madeAlready(next, item.ops)) {
        this.wal?.done(seqsOf([item]));
        continue;
      }
      try {
        next = applyOps(next, item.ops, this.session).doc;
        kept.push(item);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        refused.push(item);
      }
    }
    this.wal?.done(seqsOf(refused));
    this.queued = kept;
    this.current = next;
    return refused;
  }
}

const seqsOf = (items: readonly Pending[]): number[] => items.flatMap(item => (item.seq === undefined ? [] : [item.seq]));

/** Eight hex digits, new for each sync, so a tab opened again does not take up its earlier sync's names. */
function nonce(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeWal(tab: string, sess: string): TabWal | null {
  try {
    return browserTabWal(tab, sess);
  } catch {
    return null;
  }
}

/** Calls `back` when the browser says it is online again; answers how to stop. */
function listenOnline(back: () => void): () => void {
  const target = typeof window !== 'undefined' ? window : null;
  if (!target?.addEventListener) return () => undefined;
  const listener = () => back();
  target.addEventListener('online', listener);
  return () => target.removeEventListener('online', listener);
}
