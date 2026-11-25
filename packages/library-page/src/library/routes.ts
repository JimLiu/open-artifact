/**
 * The shapes the library page reads: what a host's routes answer with once they have asked the daemon's Library API
 * (shape.ts makes them). No Node or DOM code here, so both a host's server and the page can import it.
 */
import type { OwnerStatus } from '@open-artifact/protocol';

/** Whether version `a` is later than version `b` (`x.y.z`, a prerelease coming before its release). */
export function isNewer(a: string, b: string): boolean {
  const parts = (version: string) => {
    const [core = '', pre] = version.split('+')[0]!.split(/-(.*)/s);
    return { numbers: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i++) {
    const difference = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  if (left.pre === undefined || right.pre === undefined) return left.pre === undefined && right.pre !== undefined;
  return left.pre.localeCompare(right.pre, 'en', { numeric: true }) > 0;
}

/** The latest version among a host's update offers; '' when there is none. */
export const latestOf = (updates: readonly { latest: string }[]): string =>
  updates.reduce((best, u) => (best === '' || isNewer(u.latest, best) ? u.latest : best), '');

/** One artifact as the list route answers with it. */
export interface PageArtifact {
  /** The artifact's id in the library (`open-artifact://artifact/<id>`): what the routes take. */
  id: string;
  /** The artifact folder. */
  root: string;
  /** Its type's id (`design`, …). */
  type: string;
  /** Its type's title, for a type the page has no words of its own for. */
  typeTitle: string;
  /** The host's session that owns it; empty when it belongs to another harness, or to none. */
  sessionId: string;
  /** The owner session's agent, as its adapter reports it; null without an owner. */
  ownerStatus: OwnerStatus | null;
  title: string;
  /** When it was last opened, or made when it never was. */
  openedAt: string;
  /** When it was made. */
  createdAt: string;
  /** When a file of the artifact last changed (the daemon's `contentAt`). */
  updatedAt: string;
  pinned: boolean;
  /** Open to the local network. */
  shared: boolean;
  /** The `updatedAt` its saved thumbnail was taken at; null when it has none. */
  thumbnail: string | null;
  /** Its type is installed: the page can start. */
  openable: boolean;
  /** The Shell's address (`<daemon>/a/<id>`): the link to copy. */
  viewUrl: string;
}

/** A type a new session can make one of: every installed, runnable type. */
export interface TypeTile {
  id: string;
  title: string;
  description: string;
}

/** What the list route answers. */
export interface ArtifactList {
  artifacts: PageArtifact[];
  types: TypeTile[];
}

/** What the open route answers. */
export interface OpenAnswer {
  /** The Shell's address. */
  url: string;
  sessionId: string;
  title: string;
}

/** What the delete route answers. */
export interface DeleteAnswer {
  /** What the restore route takes to put it back. */
  trash: string;
  /** The folder, which stays where it is. */
  path: string;
}
