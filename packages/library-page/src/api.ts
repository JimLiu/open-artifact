/**
 * What a host hands the page: its routes ({@link PageApi}), stores in React's `useSyncExternalStore` shape, a window
 * opened ahead of its address, and, when it has them, an update offer ({@link PageUpdates}) and its release notes
 * ({@link ChangelogReader}). How a session is opened or started and how a thumbnail is taken are the store's
 * `PageHost` (store.ts).
 */
import type { ChangelogAnswer } from './library/changelog.ts';
import type { ArtifactList, DeleteAnswer, OpenAnswer, PageArtifact } from './library/routes.ts';

/** The routes, as functions. Replaceable in tests. */
export interface PageApi {
  list(): Promise<ArtifactList>;
  open(id: string): Promise<OpenAnswer>;
  preview(id: string): Promise<string | null>;
  update(id: string, patch: { title?: string; pinned?: boolean }): Promise<PageArtifact>;
  remove(id: string): Promise<DeleteAnswer>;
  restore(trash: string): Promise<PageArtifact>;
  saveThumbnail(id: string, version: string, jpeg: Uint8Array): Promise<string | null>;
  /** The thumbnail's address, for an `<img>`. */
  thumbnailUrl(id: string, version: string): string;
  /** The library's events; the returned function stops them. Null where the browser has no EventSource. */
  events(onEvent: () => void, onError: () => void): (() => void) | null;
}

/** A store the host hands out (`useSyncExternalStore` shape). */
export interface ExternalStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/** The host's conversation list: ids, and each one's title. */
export interface SessionsSnapshot {
  phase?: string;
  ids?: string[];
  byId?: Record<string, { title?: string } | undefined>;
}

/** A window opened before its address is known. */
export interface PendingWindow {
  /** Show `url` in it. */
  go(url: string): void;
  close(): void;
}

/** The release notes: the installed version's, and with `upcoming` an offered update's too. Null when there is no answer. */
export type ChangelogReader = (upcoming: boolean) => Promise<ChangelogAnswer | null>;

/** A newer release the host offers. */
export interface UpdateOffer {
  /** The package. */
  name: string;
  /** The version installed. */
  version: string;
  /** The version it can go to. */
  latest: string;
}

/** Where an update stands: the offer, then a run and how it went. */
export interface UpdateState {
  updates: readonly UpdateOffer[];
  phase: 'idle' | 'running' | 'done' | 'failed';
  /** The version the run went to. */
  to: string;
  /** The install takes effect only after a restart. */
  restart: boolean;
  /** Why the run stopped, and how it left the plugin: on its old version, or nobody knows. */
  failure: { plugin: string; message: string; left: 'kept' | 'unknown' } | null;
  /** The version whose offer was put away with Later. */
  dismissed: string;
}

/** The words the update panel says, in the host's language. */
export type UpdateWord =
  | 'available'
  | 'current'
  | 'update'
  | 'update.one'
  | 'later'
  | 'busy'
  | 'done'
  | 'done.session'
  | 'done.restart'
  | 'failed'
  | 'failed.kept'
  | 'failed.unknown'
  | 'retry'
  | 'close'
  | 'show';

/** A host's update offer and its run: what the panel at the top of the page draws and starts. */
export interface PageUpdates extends ExternalStore<UpdateState> {
  /** Starts updating. */
  start(): void;
  /** Puts the offer of this version away. */
  later(): void;
  /** Puts a run's result away. */
  close(): void;
  /** Unfolds what Later folded. */
  reopen(): void;
  t(key: UpdateWord, params?: Record<string, string>): string;
}
