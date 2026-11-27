/**
 * Edits left unsaved by a page that was then reloaded. A tab that halts (an undo or redo that couldn't be saved)
 * leaves a mark (left-unsaved.ts), renewed as the page goes away and cleared once the tab is restored. The next load of
 * that tab owes a notice, shown once the tab has nothing waiting (or after a while) and kept until it is dismissed.
 */
import { create } from 'zustand';
import { getDocs, useDocs } from '../app/store.ts';
import { type TabSync, onUndoLost } from '../sync/tab-sync.ts';
import { type MarkStore, RELOAD_NOTICE_WAIT_MS, clearLeft, markKey, markLeft, sessionMarks, wasLeft } from './left-unsaved.ts';
import { useRescue } from './rescue.ts';

interface NoticeState {
  /** The tab the notice is owed for. */
  tab: string | null;
  /** Shown (the tab has nothing waiting, or the wait ran out). */
  shown: boolean;
}

export const useReloadNotice = create<NoticeState>(() => ({ tab: null, shown: false }));

export function dismissReloadNotice(): void {
  useReloadNotice.setState({ tab: null, shown: false });
}

/** Where marks are kept and what time it is (tests pass their own). */
export interface LeftUnsavedDeps {
  marks(): MarkStore | null;
  now(): number;
  waitMs: number;
}

const DEFAULT_DEPS: LeftUnsavedDeps = { marks: sessionMarks, now: () => Date.now(), waitMs: RELOAD_NOTICE_WAIT_MS };

/** Starts watching; the answer stops it. */
export function watchLeftUnsaved(deps: LeftUnsavedDeps = DEFAULT_DEPS): () => void {
  /** Marks this page left, by key: a page that left a mark still shows its own trouble, and keeps the mark. */
  const madeHere = new Set<string>();
  const halted = new Set<TabSync>();
  const checked = new Set<string>();
  let wait: ReturnType<typeof setTimeout> | null = null;
  const docId = (): string | null => getDocs().project?.id ?? null;

  const show = (): void => {
    const { tab, shown } = useReloadNotice.getState();
    const doc = docId();
    if (wait) clearTimeout(wait);
    wait = null;
    if (!tab || shown || !doc) return;
    useReloadNotice.setState({ shown: true });
    // Said once: the mark goes, unless this page left it.
    if (!madeHere.has(markKey(doc, tab))) clearLeft(deps.marks(), doc, tab);
  };

  /** The open tab: is a notice owed for it, and is it time to show it. */
  const check = (): void => {
    const { activeTab, saving } = getDocs();
    const doc = docId();
    if (!activeTab || !doc) return;
    const key = markKey(doc, activeTab);
    if (!checked.has(key)) {
      checked.add(key);
      if (!madeHere.has(key) && useReloadNotice.getState().tab === null && wasLeft(deps.marks(), doc, activeTab, deps.now())) {
        useReloadNotice.setState({ tab: activeTab, shown: false });
        wait = setTimeout(show, deps.waitMs);
      }
    }
    const owed = useReloadNotice.getState();
    // A tab that has said nothing yet has nothing waiting, as the shell reads it too.
    if (owed.tab === activeTab && !owed.shown && (saving[activeTab] ?? 'saved') === 'saved') show();
  };

  const stopHalts = onUndoLost(sync => {
    const doc = docId();
    if (!doc) return;
    halted.add(sync);
    madeHere.add(markKey(doc, sync.tab));
    markLeft(deps.marks(), doc, sync.tab, deps.now());
  });
  const stopRescue = useRescue.subscribe((state, before) => {
    const doc = docId();
    if (state.state !== 'restored' || before.state === 'restored' || !state.sync || !doc) return;
    halted.delete(state.sync);
    clearLeft(deps.marks(), doc, state.sync.tab);
  });
  const onHide = (): void => {
    const doc = docId();
    if (!doc) return;
    for (const sync of halted) if (sync.needsRescue) markLeft(deps.marks(), doc, sync.tab, deps.now());
  };
  globalThis.addEventListener?.('pagehide', onHide);
  const stopDocs = useDocs.subscribe(check);
  check();

  return () => {
    stopHalts();
    stopRescue();
    stopDocs();
    globalThis.removeEventListener?.('pagehide', onHide);
    if (wait) clearTimeout(wait);
    wait = null;
  };
}
