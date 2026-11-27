/**
 * The versions of a Sheet's version history: its edits, put together by when they were made, worked out from the edit
 * log each time they are asked for.
 *
 * Edits made close together are one version: a pause of more than VERSION_PAUSE_MS starts a new one, and so does a
 * version that has gone on for VERSION_SPAN_MS (someone who edits all afternoon still gets versions to go back to).
 * Everyone who edited in a version is one of its authors, the agent too, the latest first. A version someone named in
 * the history pane ends at the revision they named: the next edit starts a version of its own, however soon it came.
 */

export const VERSION_PAUSE_MS = 5 * 60_000;
export const VERSION_SPAN_MS = 30 * 60_000;

/** What grouping needs of an edit: its revision, who made it, and when (ISO 8601). */
export interface VersionEdit {
  revision: number;
  by: string;
  at: string;
}

export interface Version {
  /** The version's first and last edits' revisions: the version is the workbook at `last`. */
  first: number;
  last: number;
  /** Who made its edits (an edit's `by`), the latest first. */
  by: string[];
}

/** The versions, newest first. `named`: the revisions that end a named version. */
export function versionsOf(edits: readonly VersionEdit[], named: ReadonlySet<number> = new Set()): Version[] {
  const versions: Version[] = [];
  let current: { first: number; last: number; startMs: number; lastMs: number; by: string[] } | null = null;
  const close = (): void => {
    if (current) versions.push({ first: current.first, last: current.last, by: current.by });
  };
  for (const edit of edits) {
    const parsed = Date.parse(edit.at);
    const ms: number = Number.isNaN(parsed) ? (current?.lastMs ?? 0) : parsed;
    if (current === null || named.has(current.last) || ms - current.lastMs > VERSION_PAUSE_MS || ms - current.startMs > VERSION_SPAN_MS) {
      close();
      current = { first: edit.revision, last: edit.revision, startMs: ms, lastMs: ms, by: [] };
    }
    current.last = edit.revision;
    current.lastMs = Math.max(current.lastMs, ms);
    current.by = [edit.by, ...current.by.filter((who) => who !== edit.by)];
  }
  close();
  return versions.reverse();
}
