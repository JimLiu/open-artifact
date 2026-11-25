/**
 * What every component of the page reads besides the store: the words, the routes, the app's conversation list, and
 * the host's update offer and release notes when it has them.
 */
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ChangelogReader, ExternalStore, PageApi, PageUpdates, SessionsSnapshot, UpdateState } from './api.ts';
import type { Translate } from './i18n.ts';

/** The page's surroundings. */
export interface PageEnv {
  t: Translate;
  api: PageApi;
  /** The app's conversations, for the titles a card's tooltip and the search show. */
  sessions: ExternalStore<SessionsSnapshot>;
  /** The host's update offer, for the panel at the top of the page; none without one. */
  updates?: PageUpdates;
  /** The host's release notes, for "What's new", the offer's notes and the changelog; none without them. */
  changelog?: ChangelogReader;
}

/** The same snapshot each time: a new one per read makes React draw again forever. */
const NO_SESSIONS: SessionsSnapshot = {};
/** No conversation list. */
export const EMPTY_SESSIONS: ExternalStore<SessionsSnapshot> = { getSnapshot: () => NO_SESSIONS, subscribe: () => () => {} };

/** No update offer: nothing to say, ever. */
const NO_UPDATE: UpdateState = { updates: [], phase: 'idle', to: '', restart: false, failure: null, dismissed: '' };
const NO_UPDATES: PageUpdates = {
  getSnapshot: () => NO_UPDATE,
  subscribe: () => () => {},
  start() {},
  later() {},
  close() {},
  reopen() {},
  t: (key) => key,
};

const EnvContext = createContext<PageEnv | null>(null);

/** Hands the page's surroundings to the components below. */
export function EnvProvider({ env, children }: { env: PageEnv; children: ReactNode }) {
  return <EnvContext.Provider value={env}>{children}</EnvContext.Provider>;
}

/** The page's surroundings. */
export function usePageEnv(): PageEnv {
  const env = useContext(EnvContext);
  if (env === null) throw new Error('usePageEnv needs an EnvProvider');
  return env;
}

/** A session's title, by id ('' when unknown), kept current. */
export function useSessionTitle(): (sessionId: string) => string {
  const { sessions } = usePageEnv();
  const snapshot = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot);
  return useCallback((id: string) => snapshot.byId?.[id]?.title?.trim() ?? '', [snapshot]);
}

/** The host's update offer ({@link NO_UPDATES} without one), and where it stands, kept current. */
export function useUpdates(): UpdateState & { offer: PageUpdates } {
  const offer = usePageEnv().updates ?? NO_UPDATES;
  return { ...useSyncExternalStore(offer.subscribe, offer.getSnapshot), offer };
}
