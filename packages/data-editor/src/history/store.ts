/**
 * Version history of the dashboard, from the host's `history` capability:
 * the panel's open state and listing, the version opened in it (an earlier
 * one is shown on the page with today's data), and restores.
 *
 * In a Shell, the Shell draws the History button (the page reports
 * `history: true` and answers `{cmd:'history'}`).
 */

import { create } from 'zustand';
import { announce, readVersionFiles, wireVersionHistory } from '@open-artifact/editor-kit';
import type { HistoryCapability, HistoryVersion } from '@open-artifact/runtime';
import { composeDashboardDocuments, getCollectionPath, parseDashboardContent, type UnknownRecord } from '@open-artifact/data-core';
import { maybeSession } from '../services/session.ts';
import { onShellCommand, setShellReport } from '../services/shell.ts';
import { setShownVersion } from '../state/shown.ts';
import { RESTORED_MESSAGE, RESTORE_FAILED_MESSAGE, RESTORE_GONE_MESSAGE, RESTORE_NOT_ALLOWED_MESSAGE, storePathOf } from './describe.ts';

interface VersionHistoryState {
  /** The host keeps a history of this dashboard. */
  available: boolean;
  /** The panel is open. */
  open: boolean;
  /** Every kept version, newest first (`null` until read). */
  versions: readonly HistoryVersion[] | null;
  /** The listing could not be read. */
  failed: boolean;
  /** This viewer may restore (owner or editor). */
  canRestore: boolean;
  /** The version open in the panel. */
  opened: number | null;
  /** The earlier version shown on the page, and when it was made. */
  shown: { n: number; at: number } | null;
  restoring: boolean;
  /** The version being restored. */
  restoringN: number | null;
  /** Why the last restore from the version's own page did not happen. */
  problem: string | null;
}

const INITIAL: VersionHistoryState = {
  available: false,
  open: false,
  versions: null,
  failed: false,
  canRestore: false,
  opened: null,
  shown: null,
  restoring: false,
  restoringN: null,
  problem: null,
};

export const useVersionHistory = create<VersionHistoryState>()(() => ({ ...INITIAL }));

/** How many documents a preview reads at once. */
const READ_WORKERS = 12;

/** Bumped per preview and listing request, so a slow answer never replaces a newer one. */
let previewRequest = 0;
let listRequest = 0;

export function historyCapability(): HistoryCapability | null {
  return maybeSession()?.history ?? null;
}

function isDashboardDocument(historyPath: string): boolean {
  const path = storePathOf(historyPath);
  if (path === null) return false;
  const collection = getCollectionPath(path);
  return collection === 'dash' || collection === 'datasets' || collection === 'files';
}

/** Reads version `n`'s dashboard documents, by store path. */
export async function readVersionDocuments(history: Pick<HistoryCapability, 'files' | 'read'>, n: number): Promise<Map<string, UnknownRecord>> {
  const texts = await readVersionFiles(history, n, (paths) => paths.filter(isDashboardDocument), READ_WORKERS);
  const documents = new Map<string, UnknownRecord>();
  for (const [historyPath, text] of texts) {
    const path = storePathOf(historyPath);
    if (path === null) continue;
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) documents.set(path, value as UnknownRecord);
    } catch {
      continue;
    }
  }
  return documents;
}

async function reload(): Promise<void> {
  const history = historyCapability();
  if (history === null) return;
  const id = ++listRequest;
  try {
    const listing = await history.list();
    if (id !== listRequest) return;
    useVersionHistory.setState({ versions: listing.versions, failed: false });
    const { opened } = useVersionHistory.getState();
    if (opened !== null && !listing.versions.some((version) => version.n === opened)) openVersion(null);
  } catch {
    if (id === listRequest) useVersionHistory.setState({ failed: useVersionHistory.getState().versions === null });
  }
}

/** Opens or closes the panel (closing goes back to the latest version). */
export function toggleVersionHistory(open?: boolean): void {
  const state = useVersionHistory.getState();
  if (!state.available) return;
  const next = open ?? !state.open;
  if (next === state.open) return;
  if (next) {
    useVersionHistory.setState({ open: true });
    void reload();
  } else {
    openVersion(null);
    useVersionHistory.setState({ open: false });
  }
}

/** Shows the page as it is now. */
export function backToLatest(): void {
  previewRequest++;
  useVersionHistory.setState({ shown: null });
  setShownVersion(null);
}

/**
 * Opens version `n` in the panel (`null`: back to the list): an earlier
 * version is put on the page (its page and queries, with today's data).
 */
export function openVersion(n: number | null): void {
  const { versions } = useVersionHistory.getState();
  useVersionHistory.setState({ opened: n, problem: null });
  const version = n === null ? undefined : versions?.find((item) => item.n === n);
  if (version === undefined || version.current === true) return backToLatest();
  void showVersion(version);
}

async function showVersion(version: HistoryVersion): Promise<void> {
  const history = historyCapability();
  if (history === null) return;
  const id = ++previewRequest;
  try {
    const documents = await readVersionDocuments(history, version.n);
    if (id !== previewRequest) return;
    const content = parseDashboardContent(composeDashboardDocuments(documents).content);
    useVersionHistory.setState({ shown: { n: version.n, at: Date.parse(version.at) } });
    setShownVersion({ n: version.n, content });
  } catch {
    if (id === previewRequest) backToLatest();
  }
}

function restoreProblem(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'not_writer') return RESTORE_NOT_ALLOWED_MESSAGE;
  if (code === 'not_found') return RESTORE_GONE_MESSAGE;
  return RESTORE_FAILED_MESSAGE;
}

/**
 * Brings version `n` back for everyone and reads the listing again. Resolves to null once restored, else to why not;
 * one restore runs at a time.
 */
export async function restoreVersionNow(n: number): Promise<string | null> {
  const history = historyCapability();
  const state = useVersionHistory.getState();
  if (history === null || state.restoring) return RESTORE_FAILED_MESSAGE;
  if (!state.canRestore) return RESTORE_NOT_ALLOWED_MESSAGE;
  useVersionHistory.setState({ restoring: true, restoringN: n });
  try {
    await history.restore(n);
    void reload();
    return null;
  } catch (error) {
    return restoreProblem(error);
  } finally {
    useVersionHistory.setState({ restoring: false, restoringN: null });
  }
}

/** Brings version `n` back from its own page: on success the panel goes back to the list, else the page says why. */
export async function restoreVersion(n: number): Promise<void> {
  const state = useVersionHistory.getState();
  if (historyCapability() === null || !state.canRestore || state.restoring) return;
  useVersionHistory.setState({ problem: null });
  const problem = await restoreVersionNow(n);
  if (problem !== null) return void useVersionHistory.setState({ problem });
  announce(RESTORED_MESSAGE);
  openVersion(null);
}

/**
 * Finds the history, reports it to the Shell, answers its `history`
 * command and follows new versions. Returns a stop function.
 */
export function startVersionHistory(): () => void {
  const history = historyCapability();
  if (history === null) return () => {};
  useVersionHistory.setState({ available: true });
  const stopWiring = wireVersionHistory({
    history,
    roleMayRestore: maybeSession()?.canRestore ?? false,
    report: setShellReport,
    onCommand: onShellCommand,
    toggle: () => toggleVersionHistory(),
    setCanRestore: (canRestore) => useVersionHistory.setState({ canRestore }),
  });
  const stopChanges = history.onChange(() => {
    if (useVersionHistory.getState().open) void reload();
    else useVersionHistory.setState({ versions: null });
  });
  return () => {
    stopWiring();
    stopChanges();
    previewRequest++;
    listRequest++;
    setShownVersion(null);
    useVersionHistory.setState({ ...INITIAL });
  };
}
