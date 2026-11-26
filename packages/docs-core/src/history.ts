/**
 * A tab's version history, kept beside the doc:
 *
 *   <root>/history/<tab>/index.json  the versions, oldest first: who made each (a person or the agent), when, its rev
 *   <root>/history/<tab>/<rev>.json  the tab as it stood at that version (DiskDoc), for every version but the newest
 *
 * Every write to a tab lands in a version. The agent's writes make one version per CLI call. A person's typing on the
 * page joins their open version until they pause or it grows long, so one burst of edits is one version (the page
 * then groups versions by author and day itself). The newest version is the tab as it is now: its snapshot is written
 * only when the next version starts. A tab that had content before it had any history gets a first version for that
 * content, by no one in particular (`system`, which the page shows as auto-save).
 *
 * The store does the file writes (so a transaction that fails puts them back); this module decides what to write.
 */
import type { DocState } from './model.ts';

export const HISTORY_DIR = 'history';
export const HISTORY_INDEX = 'index.json';

/** A person's edits join their open version until a pause this long… */
export const IDLE_MS = 30_000;
/** …or until the version spans this long. */
export const SPAN_MS = 5 * 60_000;
/** Versions kept per tab; the oldest go first. */
export const MAX_VERSIONS = 500;

export type Author = 'human' | 'agent' | 'system';

/** Who is writing: the page (a person) or the CLI (the agent, acting for the local user). */
export interface Writer {
  by: 'human' | 'agent';
  /** The person: the local user's email (the agent acts for them). */
  user: string;
  /** The writing session. A person's open version only takes edits from the same session. */
  sess: string;
  /** The agent's call: one version per call. */
  call?: string;
  /** A restore: the rev it brought back. */
  restoredFrom?: number;
}

export interface Version {
  /** Numbers the tab's versions; the page's row id. */
  n: number;
  /** The tab's rev at this version. */
  rev: number;
  /** First and last write in it (ISO). */
  first: string;
  at: string;
  by: Author;
  user: string;
  sess?: string;
  call?: string;
  restoredFrom?: number;
}

export interface HistoryIndex {
  next: number;
  versions: Version[];
}

export const emptyIndex = (): HistoryIndex => ({ next: 1, versions: [] });

/** What a write does to the index: the snapshots to write (rev → state) and to remove. */
export interface Recorded {
  index: HistoryIndex;
  write: Map<number, DocState>;
  remove: number[];
}

/** A tab holding nothing yet: one empty paragraph (a new tab). Its state needs no version of its own. */
const isBlank = (doc: DocState) => {
  const only = doc.blocks.length === 1 ? doc.blocks[0]! : null;
  return !!only && only.type === 'paragraph' && !only.inline?.length && !only.attrs?.heading;
};

/**
 * Records a write. `before` is the tab before it (with when it was last saved, for a tab that had no history yet);
 * `after` the tab after it; `index` the history so far (null when the tab has none on disk).
 */
export function recordWrite(index: HistoryIndex | null, before: DocState, beforeAt: string, after: DocState, writer: Writer, now: Date): Recorded {
  const next: HistoryIndex = index ? { next: index.next, versions: index.versions.map(version => ({ ...version })) } : emptyIndex();
  const write = new Map<number, DocState>();
  const remove: number[] = [];
  const iso = now.toISOString();
  let last = next.versions.at(-1);

  // The tab changed outside the history (or never had any): keep what it held as a version of its own.
  if (last ? last.rev !== before.rev : !isBlank(before)) {
    last = { n: next.next++, rev: before.rev, first: beforeAt, at: beforeAt, by: 'system', user: 'system' };
    next.versions.push(last);
  }

  const joins =
    !!last &&
    writer.restoredFrom === undefined &&
    last.restoredFrom === undefined &&
    last.by === writer.by &&
    last.user === writer.user &&
    (writer.by === 'agent'
      ? writer.call !== undefined && last.call === writer.call
      : last.sess === writer.sess && now.getTime() - Date.parse(last.at) < IDLE_MS && now.getTime() - Date.parse(last.first) < SPAN_MS);

  if (joins) {
    last!.rev = after.rev;
    last!.at = iso;
  } else {
    // The open version closes: its state is `before`, kept from now on.
    if (last) write.set(last.rev, before);
    next.versions.push({
      n: next.next++,
      rev: after.rev,
      first: iso,
      at: iso,
      by: writer.by,
      user: writer.user,
      sess: writer.sess,
      ...(writer.call !== undefined ? { call: writer.call } : {}),
      ...(writer.restoredFrom !== undefined ? { restoredFrom: writer.restoredFrom } : {}),
    });
  }

  while (next.versions.length > MAX_VERSIONS) {
    const old = next.versions.shift()!;
    write.delete(old.rev);
    remove.push(old.rev);
  }
  return { index: next, write, remove };
}

/** The rev a tab is born at: what the page calls the tab "as first saved". */
export const FIRST_REV = 1;

/**
 * Whether the tab was blank when its history began: its first version is still the first one made, by a writer (not
 * auto-save, which would hold content the tab already had), and came after the tab's first rev. The tab as first saved
 * is then an empty tab, which no version keeps.
 */
export function startedBlank(index: HistoryIndex | null): boolean {
  const first = index?.versions[0];
  return !!first && first.n === 1 && first.by !== 'system' && first.rev > FIRST_REV;
}

/** The newest kept version at or before `rev` (the newest version is the tab now). */
export function versionAt(index: HistoryIndex, rev: number): Version | undefined {
  let found: Version | undefined;
  for (const version of index.versions) if (version.rev <= rev && (!found || version.rev > found.rev)) found = version;
  return found;
}
