/**
 * The inbox: wake messages that could not reach their session yet, one
 * JSON-lines file per session key. A session takes them when it attaches,
 * on its next tool call, or in a wait.
 */

import { appendFileSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InboxMessage } from '@open-artifact/protocol';
import { ensureDir, files } from './paths.ts';

const safe = (key: string): string => key.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 160);

/** A message to queue; `at` defaults to now. */
export type InboxItem = Omit<InboxMessage, 'at'> & { at?: string };

type Waiter = (messages: InboxMessage[]) => void;

/** Options of {@link Inbox}. */
export interface InboxOptions {
  /**
   * A session took what waited for it ({@link Inbox.take}: an attach, a tool call, a hook, `inbox.take`, a wait that
   * found messages there). Called with what it took, never with nothing.
   */
  taken?: (key: string, messages: InboxMessage[]) => void;
  /** Messages taken earlier were put back ({@link Inbox.giveBack}) and wait again. */
  returned?: (key: string, messages: InboxMessage[]) => void;
}

/** Session inboxes on disk, with in-memory waits. */
export class Inbox {
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly options: InboxOptions;

  constructor(options: InboxOptions = {}) {
    this.options = options;
    ensureDir(files.inbox());
  }

  /** The file of a session key. */
  fileOf(key: string): string {
    return join(files.inbox(), `${safe(key)}.jsonl`);
  }

  /** Appends a message; an open wait for this key takes it at once (`taken: true`). */
  append(key: string, item: InboxItem): { taken: boolean } {
    const entry = { ...item, at: item.at ?? new Date().toISOString() } as InboxMessage;
    const waiting = this.waiters.get(key);
    const first = waiting?.values().next().value;
    if (waiting && first) {
      waiting.delete(first);
      first([entry]);
      return { taken: true };
    }
    ensureDir(files.inbox());
    appendFileSync(this.fileOf(key), `${JSON.stringify(entry)}\n`);
    return { taken: false };
  }

  /** The waiting messages, left in place. */
  peek(key: string): InboxMessage[] {
    let text: string;
    try {
      text = readFileSync(this.fileOf(key), 'utf8');
    } catch {
      return [];
    }
    const out: InboxMessage[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as InboxMessage);
      } catch {
        /* a torn line */
      }
    }
    return out;
  }

  /** How many messages wait. */
  count(key: string): number {
    return this.peek(key).length;
  }

  /** The waiting messages, removed: the session took them. */
  take(key: string): InboxMessage[] {
    const items = this.peek(key);
    if (items.length) {
      rmSync(this.fileOf(key), { force: true });
      this.report('taken', key, items);
    }
    return items;
  }

  /**
   * The waiting messages that `match`, removed; the others stay, in their order. The file is rewritten whole (a new
   * file renamed over it), so a reader never sees half of it. Synchronous: nothing else touches the inbox meanwhile.
   */
  takeWhere(key: string, match: (message: InboxMessage) => boolean): InboxMessage[] {
    const items = this.peek(key);
    const taken = items.filter(match);
    if (!taken.length) return [];
    this.keep(key, items.filter((item) => !match(item)));
    return taken;
  }

  /** The first waiting message that matches, removed (the others stay, in their order), or `null`. As {@link takeWhere}. */
  takeFirst(key: string, match: (message: InboxMessage) => boolean): InboxMessage | null {
    const items = this.peek(key);
    const at = items.findIndex(match);
    if (at < 0) return null;
    const [taken] = items.splice(at, 1);
    this.keep(key, items);
    return taken!;
  }

  /**
   * Puts back messages that were taken but not delivered: an open wait takes them at once; otherwise they wait again,
   * ahead of what came since (they are older). Synchronous, as {@link takeWhere}.
   */
  giveBack(key: string, messages: InboxMessage[]): void {
    if (!messages.length) return;
    const waiting = this.waiters.get(key);
    const first = waiting?.values().next().value;
    if (waiting && first) {
      waiting.delete(first);
      first(messages);
      this.report('taken', key, messages);
      return;
    }
    ensureDir(files.inbox());
    this.keep(key, [...messages, ...this.peek(key)]);
    this.report('returned', key, messages);
  }

  /** Tells the {@link InboxOptions} callback; what it throws never reaches the caller, who has the messages now. */
  private report(what: 'taken' | 'returned', key: string, messages: InboxMessage[]): void {
    try {
      this.options[what]?.(key, messages);
    } catch {
      /* a listener's failure is not the inbox's */
    }
  }

  /** Rewrites a key's file with `kept` only (removes it when empty). */
  private keep(key: string, kept: InboxMessage[]): void {
    const file = this.fileOf(key);
    if (!kept.length) rmSync(file, { force: true });
    else {
      const next = `${file}.${process.pid}.tmp`;
      writeFileSync(next, kept.map((item) => `${JSON.stringify(item)}\n`).join(''));
      renameSync(next, file);
    }
  }

  /** The messages that are there, or the next ones to come, or `[]` after `timeoutMs`. */
  wait(key: string, timeoutMs = 600_000, signal?: AbortSignal): Promise<InboxMessage[]> {
    const now = this.take(key);
    if (now.length) return Promise.resolve(now);
    return new Promise((resolveWait) => {
      let set = this.waiters.get(key);
      if (!set) this.waiters.set(key, (set = new Set()));
      const waiters = set;
      const done: Waiter = (messages) => {
        clearTimeout(timer);
        waiters.delete(done);
        if (!waiters.size) this.waiters.delete(key);
        resolveWait(messages);
      };
      const timer = setTimeout(() => done([]), timeoutMs);
      timer.unref?.();
      signal?.addEventListener('abort', () => done([]), { once: true });
      waiters.add(done);
    });
  }

  /** True while a wait for this key is open. */
  waiting(key: string): boolean {
    return (this.waiters.get(key)?.size ?? 0) > 0;
  }
}
