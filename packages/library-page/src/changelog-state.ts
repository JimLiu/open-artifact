/**
 * The release notes the page shows (changelog.tsx draws them): what the version installed brings, once after it is
 * installed ("What's new"); what an offered update brings, beside the offer; and every release, in the changelog. Here,
 * without React, so the tests can run it. The notes come from the host ({@link ChangelogReader}).
 *
 * Which version's notes were last seen is kept in localStorage. One never seen (a profile that had no such key, as
 * before this existed) sees the installed version's notes once.
 */
import type { ChangelogReader } from './api.ts';
import { releasesBetween, type ReleaseNotes } from './library/changelog.ts';
import { isNewer } from './library/routes.ts';

const SEEN_KEY = 'open-artifact.changelog.seen';

export interface ChangelogState {
  /** The version installed; empty until the route answered. */
  version: string;
  /** Its notes and the ones before, newest first. */
  releases: ReleaseNotes[];
  /** An offered update's notes, newest first. */
  upcoming: ReleaseNotes[];
  /** The latest version {@link upcoming} was asked for. */
  upcomingFor: string;
  /** The version whose notes were put away; null when none ever was. */
  seen: string | null;
  /** The changelog is open. */
  open: boolean;
}

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

let state: ChangelogState = { version: '', releases: [], upcoming: [], upcomingFor: '', seen: readSeen(), open: false };
const listeners = new Set<() => void>();

function set(patch: Partial<ChangelogState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

export const subscribeChangelog = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const changelogState = (): ChangelogState => state;

/** Reads the installed version's notes; an answer that does not come changes nothing. */
export async function loadChangelog(read: ChangelogReader): Promise<void> {
  const answer = await read(false);
  if (answer === null) return;
  // Updated since the offer's notes were read: the ones it has now are no longer ahead of it.
  const upcoming = state.upcoming.filter((r) => isNewer(r.version, answer.version));
  set({ version: answer.version, releases: answer.releases, upcoming });
}

/** Reads what the update to `latest` brings, once per version offered. */
export async function loadUpcoming(latest: string, read: ChangelogReader): Promise<void> {
  if (latest === '' || latest === state.upcomingFor) return;
  set({ upcomingFor: latest });
  const answer = await read(true);
  if (answer === null || state.upcomingFor !== latest) {
    if (state.upcomingFor === latest) set({ upcomingFor: '' });
    return;
  }
  set({ version: answer.version, releases: answer.releases, upcoming: answer.upcoming });
}

/** The notes "What's new" shows: the releases since the one last seen; none once this one is seen. */
export function whatsNew({ version, releases, seen }: Pick<ChangelogState, 'version' | 'releases' | 'seen'>): ReleaseNotes[] {
  if (version === '' || seen === version) return [];
  if (seen === null) return releases.filter((r) => r.version === version);
  // Seen a later one: this is a step back, which has nothing new to say.
  if (isNewer(seen, version)) return [];
  return releasesBetween(releases, seen, version);
}

/** Puts "What's new" away until the next version. */
export function markSeen(): void {
  const { version } = state;
  if (version === '') return;
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Then it shows again next time.
  }
  set({ seen: version });
}

export const openChangelog = () => set({ open: true });
export const closeChangelog = () => set({ open: false });
