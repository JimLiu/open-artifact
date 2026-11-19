/**
 * What the plugin's Host routes (src/server/routes.ts) and the Artifacts page (src/client) share: the route paths and the
 * shapes the routes answer with. The routes carry the page's calls to the daemon's Library API with its token and answer
 * in these page-sized shapes. No Node or DOM code here, so both bundles can import it.
 */
import type { OwnerStatus } from '@open-artifact/protocol';

/** The prefix of every route the page calls. */
export const ROUTE_BASE = '/api/open-artifact.artifacts';

/** The Host routes, by what they do. */
export const PATHS = Object.freeze({
  /** GET: every artifact in the library and the types a new session can make ({@link ArtifactList}). */
  list: ROUTE_BASE,
  /** GET/POST: shared hosting preferences; saving does not enable public serving. */
  hosting: `${ROUTE_BASE}.hosting`,
  /** POST `?id=`: count it as opened and start its page (`{ url, sessionId, title }`; `url` is the Shell). */
  open: `${ROUTE_BASE}.open`,
  /** POST `?id=`: start its page without counting an opening (`{ url }`, the page itself): for a thumbnail. */
  preview: `${ROUTE_BASE}.preview`,
  /** GET `?id=&v=`: the saved thumbnail (a JPEG). POST the bytes to save one (`{ thumbnail }`). */
  thumbnail: `${ROUTE_BASE}.thumbnail`,
  /** POST `?id=` with `{ pinned?, title? }`: the artifact as it is now. */
  update: `${ROUTE_BASE}.update`,
  /** POST `?id=`: take it off the library (`{ trash, path }`); its folder stays where it is. */
  delete: `${ROUTE_BASE}.delete`,
  /** POST `?trash=<id>`: put back what the delete route took away. */
  restore: `${ROUTE_BASE}.restore`,
  /** GET: the daemon's library events as server-sent events (`data:` is a `LibraryEvent`). */
  events: `${ROUTE_BASE}.events`,
  /** GET: the daemon's `host.open` requests as server-sent events (`data:` is a {@link HostOpenRequest}). */
  hostOpens: `${ROUTE_BASE}.host-opens`,
  /** POST `?id=&opened=1|0`: whether a browser half showed the artifact of one {@link HostOpenRequest}. */
  hostOpened: `${ROUTE_BASE}.host-opened`,
  /** GET: whether this plugin has a newer release on its registry ({@link UpdateCheck}). */
  updates: `${ROUTE_BASE}.updates`,
});

/** This plugin's newer release, which the browser half installs over it. */
export interface PluginUpdate {
  /** The package. */
  name: string;
  /** The version installed. */
  version: string;
  /** The version the registry calls latest. */
  latest: string;
  /**
   * What to install: the release's tarball. The plugin manager refuses a package's name while it is installed; a
   * tarball goes over it, and a run that fails puts the profile back, so nothing is uninstalled along the way.
   */
  spec: string;
  /** The registry that answered: the install asks it for the plugin's dependencies. */
  registry: string;
  /** The plugin's switch, which the install keeps. */
  enabled: boolean;
  /** The app offers its own Update on the plugin's page in Plugins (`updatable`), so that page needs none from here. */
  native: boolean;
}

/** What the updates route answers. */
export interface UpdateCheck {
  /** Empty when it is current, or not installed from a registry (a linked folder is the person's own to update). */
  updates: PluginUpdate[];
  /** The packages no registry answered for. */
  failed: string[];
}

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

/**
 * The daemon asks the harness to show an artifact (`host.open`: the agent opened it, or its share or export panel):
 * the browser half shows `url` in the session's Browser and answers through the `hostOpened` route.
 */
export interface HostOpenRequest {
  id: string;
  /** The DSH session the artifact is opened for. */
  session: string;
  /** The Shell's address, with any `?panel=` the agent asked for. */
  url: string;
  title: string;
}

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
  /** The DSH session that owns it; empty when it belongs to another harness, or to none. */
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

/** A type a new session can make one of: every installed, runnable type is usable in every DSH session. */
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
