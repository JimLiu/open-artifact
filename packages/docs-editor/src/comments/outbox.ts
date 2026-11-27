/**
 * Comments and replies that could not reach the server, kept until they can (IndexedDB `oa-docs.comment-outbox`, or
 * memory for this page's life without it). They go out oldest first when the connection comes back, after a wait that
 * doubles from 250 ms up to 30 s, and when the doc is next opened. One the server refuses for any other reason is let
 * go, and the person is told.
 */
import type { CommentCreate } from '@open-artifact/runtime';
import { Backoff } from '../sync/backoff.ts';
import { committed, openStore, settle } from '../sync/idb.ts';

export const OUTBOX_DB = 'oa-docs.comment-outbox';
const OUTBOX_STORE = 'comments';

/** A kept comment older than this is let go instead of sent. */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type OutboxEntry =
  | { id: string; scope: string; at: number; kind: 'create'; input: CommentCreate }
  | { id: string; scope: string; at: number; kind: 'reply'; threadId: string; text: string; to?: string[]; assignee?: string; quiet?: true };

/** What an entry is, without its id, scope and time. */
export type OutboxItem = { kind: 'create'; input: CommentCreate } | { kind: 'reply'; threadId: string; text: string; to?: string[]; assignee?: string; quiet?: true };

export interface OutboxStore {
  load(scope: string): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

/** The text an entry would post. */
export const outboxText = (entry: OutboxItem): string => (entry.kind === 'create' ? entry.input.text : entry.text);

/** Whether a failure is the connection's (worth sending again), not the server's answer. */
export function isNetworkError(error: unknown): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  } catch {
    // No navigator: go by the error.
  }
  if (error instanceof TypeError) return true;
  const { code, retryable } = (error ?? {}) as { code?: unknown; retryable?: unknown };
  return code === 'unavailable' || retryable === true;
}

export function memoryOutboxStore(): OutboxStore {
  const kept = new Map<string, OutboxEntry>();
  return {
    load: async scope => [...kept.values()].filter(entry => entry.scope === scope).sort((a, b) => a.at - b.at),
    put: async entry => {
      kept.set(entry.id, entry);
    },
    remove: async id => {
      kept.delete(id);
    },
  };
}

/** Entries in IndexedDB; when it can't be opened (or fails), in memory for this page's life. */
export function indexedDbOutboxStore(name = OUTBOX_DB): OutboxStore {
  const memory = memoryOutboxStore();
  const db = () => openStore(name, OUTBOX_STORE, 'id');
  return {
    async load(scope) {
      const kept = await memory.load(scope);
      try {
        const open = await db();
        if (!open) return kept;
        const tx = open.transaction(OUTBOX_STORE, 'readonly');
        const all = (await settle(tx.objectStore(OUTBOX_STORE).getAll())) as OutboxEntry[];
        const ids = new Set(kept.map(entry => entry.id));
        return [...kept, ...all.filter(entry => entry.scope === scope && !ids.has(entry.id))].sort((a, b) => a.at - b.at);
      } catch {
        return kept;
      }
    },
    async put(entry) {
      try {
        const open = await db();
        if (open) {
          const tx = open.transaction(OUTBOX_STORE, 'readwrite');
          tx.objectStore(OUTBOX_STORE).put(entry);
          await committed(tx);
          return;
        }
      } catch {
        // Kept in memory instead.
      }
      await memory.put(entry);
    },
    async remove(id) {
      await memory.remove(id);
      try {
        const open = await db();
        if (!open) return;
        const tx = open.transaction(OUTBOX_STORE, 'readwrite');
        tx.objectStore(OUTBOX_STORE).delete(id);
        await committed(tx);
      } catch {
        // Nothing more to do.
      }
    },
  };
}

export interface OutboxHandlers {
  /** Whose kept comments these are (the doc and the viewer); `null` while not known yet. */
  scope(): string | null;
  /** Posts an entry; throws as the comments capability does. */
  send(entry: OutboxEntry): Promise<void>;
  /** The server refused an entry for good. */
  refused?(entry: OutboxEntry, error: unknown): void;
  /** How many entries wait, after every change. */
  waiting?(count: number): void;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Kept comments, sent again until they land. */
export class CommentOutbox {
  private readonly store: OutboxStore;
  private readonly backoff: Backoff;
  private readonly now: () => number;
  private handlers: OutboxHandlers | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private again = false;
  private listening = false;

  constructor(options: { store?: OutboxStore; backoff?: Backoff; now?: () => number } = {}) {
    this.store = options.store ?? memoryOutboxStore();
    this.backoff = options.backoff ?? new Backoff();
    this.now = options.now ?? Date.now;
  }

  /** Says how to send; sends what an earlier page kept. */
  start(handlers: OutboxHandlers): Promise<void> {
    this.handlers = handlers;
    this.listen();
    return this.flush();
  }

  /** Keeps a comment that could not be sent; it goes out after the next wait. */
  async keep(item: OutboxItem): Promise<OutboxEntry | null> {
    const scope = this.handlers?.scope() ?? null;
    if (!scope) return null;
    const entry = { ...item, id: newId(), scope, at: this.now() } as OutboxEntry;
    await this.store.put(entry);
    this.listen();
    await this.report(scope);
    this.schedule(this.backoff.fail());
    return entry;
  }

  /** Sends every kept comment in order; stops at the first the connection fails, and tries again later. */
  flush(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = this.run().finally(() => {
      this.flushing = null;
      if (this.again) {
        this.again = false;
        void this.flush();
      }
    });
    return this.flushing;
  }

  private async run(): Promise<void> {
    const handlers = this.handlers;
    const scope = handlers?.scope() ?? null;
    if (!handlers || !scope) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const entries = await this.store.load(scope).catch(() => [] as OutboxEntry[]);
    for (const entry of entries) {
      if (this.now() - entry.at > OUTBOX_MAX_AGE_MS) {
        await this.store.remove(entry.id);
        continue;
      }
      try {
        await handlers.send(entry);
      } catch (error) {
        if (isNetworkError(error)) {
          this.schedule(this.backoff.fail());
          await this.report(scope);
          return;
        }
        handlers.refused?.(entry, error);
      }
      this.backoff.succeed();
      await this.store.remove(entry.id);
    }
    await this.report(scope);
  }

  private schedule(wait: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private async report(scope: string): Promise<void> {
    if (!this.handlers?.waiting) return;
    const count = (await this.store.load(scope).catch(() => [])).length;
    this.handlers.waiting(count);
  }

  /** The browser came back online: what waits goes now. */
  private listen(): void {
    if (this.listening || typeof window === 'undefined' || !window.addEventListener) return;
    this.listening = true;
    window.addEventListener('online', () => {
      this.backoff.succeed();
      void this.flush();
    });
  }
}
