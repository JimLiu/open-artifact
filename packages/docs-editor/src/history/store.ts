/** The version history's state: the open tab's versions, how many are shown, and the version being previewed. */
import type { DocState } from '@open-artifact/docs-core';
import type { DocVersion } from '@open-artifact/runtime/doc-api';
import { create } from 'zustand';

/** Versions the list shows at first, and how many more each "Show older versions" adds. */
export const PAGE_VERSIONS = 50;

/** A version shown in place of the text. */
export interface Preview {
  tab: string;
  rev: number;
  /** The version it is compared with: for the oldest, the tab as first saved (FIRST_REV); `null`: nothing before it. */
  base: number | null;
  at: string;
  /** The tab as it is now. */
  current: boolean;
  /** A folded row: how many versions it holds (the preview is its newest). */
  count: number;
  /** The row that was picked, so the list can mark it. */
  row: string;
}

export type Busy = 'restoring' | 'copying' | null;

/** What a previewed version is compared with: the one before it, or the tab as it is now. */
export type CompareWith = 'previous' | 'current';

/** What a restore is compared with: the version before it, or the version it brought back. */
export type RestoreBase = 'previous' | 'restored';

export interface HistoryState {
  /** The tab the list is of. */
  tab: string | null;
  versions: DocVersion[] | null;
  loading: boolean;
  error: string | null;
  shown: number;
  /** Folded rows opened, by row key. */
  expanded: Record<string, boolean>;
  preview: Preview | null;
  /** Show what the previewed version changed. */
  compare: boolean;
  compareWith: CompareWith;
  /** For a restore: set back to `previous` with each version picked. */
  restoreBase: RestoreBase;
  /** Versions read so far, by `<tab>:<rev>`. */
  docs: Record<string, DocState>;
  /** A version that could not be read, by `<tab>:<rev>`. */
  docErrors: Record<string, string>;
  busy: Busy;
  confirmRestore: boolean;
}

export const useVersionHistory = create<HistoryState>(() => ({
  tab: null,
  versions: null,
  loading: false,
  error: null,
  shown: PAGE_VERSIONS,
  expanded: {},
  preview: null,
  compare: true,
  compareWith: 'previous',
  restoreBase: 'previous',
  docs: {},
  docErrors: {},
  busy: null,
  confirmRestore: false,
}));

export const setHistory = useVersionHistory.setState;
export const getHistory = useVersionHistory.getState;

export const versionKey = (tab: string, rev: number) => `${tab}:${rev}`;

/** True while a past version is shown in place of the text. */
export const useVersionPreviewing = (): boolean => useVersionHistory(state => state.preview !== null);
