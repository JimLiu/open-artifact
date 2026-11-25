/**
 * Sorting, filtering and searching the list: pure functions of the artifacts and what the person picked.
 */
import type { PageArtifact } from './library/routes.ts';

/** What the list is sorted by. */
export type Sort = 'opened' | 'updated' | 'created' | 'name';
/** When an artifact was last opened. */
export type DateRange = 'any' | 'today' | 'yesterday' | 'week' | 'month';
/** Whether it is shared on the local network. */
export type Sharing = 'any' | 'shared' | 'private';

/** The filter menu's choices. */
export interface Filters {
  sort: Sort;
  /** Type ids; empty: all. */
  types: readonly string[];
  date: DateRange;
  sharing: Sharing;
  pinned: boolean;
}

/** Nothing picked. */
export const NO_FILTERS: Filters = Object.freeze({ sort: 'opened', types: [], date: 'any', sharing: 'any', pinned: false });
/** The sort choices, in menu order. */
export const SORTS: readonly Sort[] = ['opened', 'updated', 'created', 'name'];
/** The date choices, in menu order. */
export const DATES: readonly DateRange[] = ['any', 'today', 'yesterday', 'week', 'month'];
/** The sharing choices, in menu order. */
export const SHARINGS: readonly Sharing[] = ['any', 'shared', 'private'];

/** Whether anything but the sort narrows the list. */
export function isFiltered(f: Filters): boolean {
  return f.types.length > 0 || f.date !== 'any' || f.sharing !== 'any' || f.pinned;
}

const DAY = 86_400_000;

/** Whether an ISO time falls in a range, as of `now`. */
export function inRange(iso: string, range: DateRange, now: number): boolean {
  if (range === 'any') return true;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return false;
  const day = new Date(now);
  const today = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  switch (range) {
    case 'today':
      return then >= today;
    case 'yesterday':
      return then >= new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1).getTime() && then < today;
    case 'week':
      return then >= now - 7 * DAY;
    case 'month':
      return then >= now - 30 * DAY;
  }
}

/** The artifacts in sort order; newest first for the times. */
export function sortArtifacts(list: readonly PageArtifact[], sort: Sort, locale: string): PageArtifact[] {
  if (sort === 'name') return [...list].sort((a, b) => a.title.localeCompare(b.title, locale));
  const key = sort === 'updated' ? 'updatedAt' : sort === 'created' ? 'createdAt' : 'openedAt';
  return [...list].sort((a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0));
}

/** What {@link visibleArtifacts} filters by. */
export interface ListQuery {
  filters: Filters;
  /** The search box's text. */
  query: string;
  now: number;
  locale: string;
  /** A session's title, which the search also matches. */
  sessionTitle?: (sessionId: string) => string;
}

/** The artifacts the page lists: filtered, searched (title, session title, folder) and sorted. */
export function visibleArtifacts(list: readonly PageArtifact[], { filters, query, now, locale, sessionTitle }: ListQuery): PageArtifact[] {
  const q = query.trim().toLowerCase();
  const kept = list.filter((a) => {
    if (filters.types.length > 0 && !filters.types.includes(a.type)) return false;
    if (filters.pinned && !a.pinned) return false;
    if (filters.sharing !== 'any' && a.shared !== (filters.sharing === 'shared')) return false;
    if (!inRange(a.openedAt, filters.date, now)) return false;
    if (!q) return true;
    const session = a.sessionId && sessionTitle ? sessionTitle(a.sessionId) : '';
    return a.title.toLowerCase().includes(q) || session.toLowerCase().includes(q) || a.root.toLowerCase().includes(q);
  });
  return sortArtifacts(kept, filters.sort, locale);
}

/** How many artifacts each type has. */
export function countByType(list: readonly PageArtifact[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of list) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  return counts;
}
