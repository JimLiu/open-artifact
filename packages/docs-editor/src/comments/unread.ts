/**
 * Which threads have news for the viewer since they last looked, kept in this browser only: when they first opened the
 * doc here, when they last read each thread, and when they last looked at each tab's list. Times are milliseconds.
 */
import type { CommentThread } from '@open-artifact/runtime';
import { isOwn, isReactionThread } from './threads.ts';

export interface Reads {
  /** Nothing older than this is news: the doc's first opening in this browser, or its newest message then. */
  since: number;
  /** Thread id → when the viewer last read it. */
  marks: Record<string, number>;
  /** Tab id (`''`: the doc) → when the viewer last had the list open on it. */
  looked: Record<string, number>;
}

const timeOf = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/** The newest message time among `threads`, or 0. */
function newestMessage(threads: readonly CommentThread[]): number {
  let newest = 0;
  for (const thread of threads) for (const message of thread.messages) newest = Math.max(newest, timeOf(message.at));
  return newest;
}

/** Reads for a doc opened here for the first time: what is there already is not news. */
export function freshReads(threads: readonly CommentThread[], now: number): Reads {
  return { since: Math.max(now, newestMessage(threads)), marks: {}, looked: {} };
}

/**
 * When a thread's news came, or 0 for none: an open thread (not a lone reaction) whose latest message someone else
 * wrote (the agent included) after the viewer last read it.
 */
export function unreadSince(thread: CommentThread, reads: Reads, me: string | null): number {
  if (thread.status !== 'open' || isReactionThread(thread)) return 0;
  const latest = thread.messages.at(-1);
  if (!latest || isOwn(latest.author, me)) return 0;
  const at = timeOf(latest.at);
  return at > Math.max(reads.since, reads.marks[thread.id] ?? 0) ? at : 0;
}

/** Whether a thread's news is a reply (the thread itself is older), rather than the thread being new. */
export const unreadIsReply = (thread: CommentThread): boolean => thread.messages.length > 1;

/** The newest news among `threads`, or 0. */
export function newestUnread(threads: readonly CommentThread[], reads: Reads, me: string | null): number {
  return threads.reduce((newest, thread) => Math.max(newest, unreadSince(thread, reads, me)), 0);
}

/** Whether a tab's threads have news the viewer has not seen in the list since. */
export const tabHasNews = (newest: number, reads: Reads, tab: string): boolean => newest > (reads.looked[tab] ?? 0);

const later = (record: Record<string, number>, key: string, at: number): Record<string, number> =>
  (record[key] ?? 0) >= at ? record : { ...record, [key]: at };

/** The viewer read thread `id` at `at`. */
export function readThread(reads: Reads, id: string, at: number): Reads {
  const marks = later(reads.marks, id, at);
  return marks === reads.marks ? reads : { ...reads, marks };
}

/** The viewer had the list open on tab `tab` at `at`. */
export function lookedAtTab(reads: Reads, tab: string, at: number): Reads {
  const looked = later(reads.looked, tab, at);
  return looked === reads.looked ? reads : { ...reads, looked };
}

function mergeTimes(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [key, at] of Object.entries(b)) if (at > (out[key] ?? 0)) out[key] = at;
  return out;
}

/** Two records of the same doc (another window wrote one): the later of each time. */
export function mergeReads(a: Reads, b: Reads): Reads {
  return { since: Math.max(a.since, b.since), marks: mergeTimes(a.marks, b.marks), looked: mergeTimes(a.looked, b.looked) };
}

const isTime = (at: unknown): at is number => typeof at === 'number' && Number.isFinite(at);

/** The times of a kept record that are times; anything else in it is dropped. */
function timesIn(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => isTime(entry[1])));
}

/** A kept record, or null for one missing or not readable. */
export function parseReads(text: string | null): Reads | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as { since?: unknown; marks?: unknown; looked?: unknown } | null;
    if (!value || !isTime(value.since)) return null;
    return { since: value.since, marks: timesIn(value.marks), looked: timesIn(value.looked) };
  } catch {
    return null;
  }
}

/** The record without marks no newer than `since` (they say nothing), to keep it small. */
export function trimReads(reads: Reads): Reads {
  const marks: Record<string, number> = {};
  for (const [id, at] of Object.entries(reads.marks)) if (at > reads.since) marks[id] = at;
  return { ...reads, marks };
}
