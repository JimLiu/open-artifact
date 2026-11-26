/**
 * The viewer's unread threads on this doc, kept in this browser (unread.ts): opening a card reads it at once; a card the
 * viewer has had in sight is only written down, so its dot stays until the page is opened again; another window's
 * reads come in as it writes them.
 */
import type { CommentThread } from '@open-artifact/runtime';
import { create } from 'zustand';
import { docComments, myName } from './store.ts';
import { freshReads, lookedAtTab, mergeReads, newestUnread, parseReads, type Reads, readThread, tabHasNews, trimReads, unreadSince } from './unread.ts';

interface ReadsState {
  /** Whose reads of which doc, as `doc|viewer`. */
  scope: string | null;
  /** What this page shows as read; null until the threads are in. */
  reads: Reads | null;
}

export const useReads = create<ReadsState>(() => ({ scope: null, reads: null }));

const keyOf = (scope: string) => `oa-docs.comments.read.${scope}`;

function load(scope: string): Reads | null {
  try {
    return parseReads(localStorage.getItem(keyOf(scope)));
  } catch {
    return null;
  }
}

/** Writes `reads` down, with whatever another window wrote meanwhile. */
function save(scope: string, reads: Reads): void {
  try {
    const kept = load(scope);
    localStorage.setItem(keyOf(scope), JSON.stringify(trimReads(kept ? mergeReads(kept, reads) : reads)));
  } catch {
    // Storage blocked: the reads last while the page is open.
  }
}

let stopListening: (() => void) | null = null;

/** Starts keeping the viewer's reads of a doc, once its threads are in. */
export function startReads(scope: string, threads: readonly CommentThread[], now = Date.now()): void {
  const reads = load(scope) ?? freshReads(threads, now);
  save(scope, reads);
  useReads.setState({ scope, reads });
  stopListening?.();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== keyOf(scope)) return;
    const theirs = parseReads(event.newValue);
    const current = useReads.getState();
    if (theirs && current.scope === scope && current.reads) useReads.setState({ reads: mergeReads(current.reads, theirs) });
  };
  window.addEventListener('storage', onStorage);
  stopListening = () => window.removeEventListener('storage', onStorage);
}

/** When something is read: now, or the news itself when this clock is behind the server's. */
const readTime = (thread: CommentThread | undefined, reads: Reads): number =>
  Math.max(Date.now(), thread ? unreadSince(thread, reads, myName()) : 0);

const threadOf = (id: string) => docComments.store.getState().threads.find(thread => thread.id === id);

/** The viewer opened thread `id`: it is read, here and from now on. */
export function readNow(id: string): void {
  const { scope, reads } = useReads.getState();
  if (!scope || !reads) return;
  const next = readThread(reads, id, readTime(threadOf(id), reads));
  if (next === reads) return;
  useReads.setState({ reads: next });
  save(scope, next);
}

/** The viewer has had thread `id` in sight: it is read from the next opening of the doc on; its dot stays for now. */
export function seen(id: string): void {
  const { scope, reads } = useReads.getState();
  if (!scope || !reads) return;
  save(scope, readThread(reads, id, readTime(threadOf(id), reads)));
}

/** The viewer has the list open on tab `tab` (`''`: the doc): its news is no longer news for the comments button. */
export function lookedAt(tab: string): void {
  const { scope, reads } = useReads.getState();
  if (!scope || !reads) return;
  const next = lookedAtTab(reads, tab, Date.now());
  if (next === reads) return;
  useReads.setState({ reads: next });
  save(scope, next);
}

/** When a thread's news came, or 0 (none, or reads not started). */
export const useUnread = (thread: CommentThread): number => useReads(state => (state.reads ? unreadSince(thread, state.reads, myName()) : 0));

/** Whether any of the threads `ids` has news. */
export function useAnyUnread(ids: readonly string[]): boolean {
  const threads = docComments.store(state => state.threads);
  return useReads(state => {
    const reads = state.reads;
    if (!reads) return false;
    const me = myName();
    return threads.some(thread => ids.includes(thread.id) && unreadSince(thread, reads, me) > 0);
  });
}

/** The threads on tab `tab` and on the whole doc. */
const onTab = (threads: readonly CommentThread[], tab: string | null): CommentThread[] =>
  threads.filter(thread => {
    const at = docComments.anchorOf(thread).tab;
    return at === null || at === tab;
  });

/** The newest news on tab `tab` (and the doc), or 0. */
export function useNewestOnTab(tab: string | null): number {
  const threads = docComments.store(state => state.threads);
  return useReads(state => (state.reads ? newestUnread(onTab(threads, tab), state.reads, myName()) : 0));
}

/** Whether the comments button calls for a look: news on the open tab since the list was last open on it. */
export function useTabNews(tab: string | null): boolean {
  const newest = useNewestOnTab(tab);
  return useReads(state => !!state.reads && tabHasNews(newest, state.reads, tab ?? ''));
}

// Opening a card reads it; so does news coming to the card that is open.
docComments.store.subscribe((state, before) => {
  if (!state.active) return;
  if (state.active !== before.active || state.threads !== before.threads) {
    const thread = state.threads.find(each => each.id === state.active);
    const reads = useReads.getState().reads;
    if (thread && reads && unreadSince(thread, reads, myName())) readNow(thread.id);
  }
});
