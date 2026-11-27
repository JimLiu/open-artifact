/**
 * A page whose saving stopped with text only on it (an undo or redo that couldn't be saved) leaves a mark in this
 * browser tab's session storage, per doc and tab, and renews it as the page goes away. If the page is reloaded before
 * the text is restored, the next load of that tab finds the mark and asks the person to check that nothing is missing.
 * A mark goes once that is said, once the text is restored, and after an hour. Pure: the storage is passed in.
 */

/** The part of `Storage` the marks use. */
export interface MarkStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'open-artifact.docs.left-unsaved.';

/** A mark older than this is let go unread. */
export const LEFT_UNSAVED_MAX_AGE_MS = 60 * 60 * 1000;

/** The notice waits for the tab to say it is saved, but no longer than this. */
export const RELOAD_NOTICE_WAIT_MS = 10_000;

export const RELOAD_NOTICE_WORDS = 'This page was reloaded before all your edits were saved. Check that nothing is missing.';

export const markKey = (doc: string, tab: string): string => `${PREFIX}${doc}.${tab}`;

/** Leaves (or renews) the mark of `doc`'s `tab`. Storage that refuses it keeps nothing. */
export function markLeft(store: MarkStore | null, doc: string, tab: string, now: number): void {
  try {
    store?.setItem(markKey(doc, tab), String(now));
  } catch {
    // Not kept: the next load says nothing.
  }
}

export function clearLeft(store: MarkStore | null, doc: string, tab: string): void {
  try {
    store?.removeItem(markKey(doc, tab));
  } catch {
    // Nothing to clear.
  }
}

/** Lets go of marks older than {@link LEFT_UNSAVED_MAX_AGE_MS} (and unreadable ones); whether `doc`'s `tab` still has one. */
export function wasLeft(store: MarkStore | null, doc: string, tab: string, now: number): boolean {
  if (!store) return false;
  try {
    const stale: string[] = [];
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const at = Number(store.getItem(key));
      if (!Number.isFinite(at) || now - at > LEFT_UNSAVED_MAX_AGE_MS) stale.push(key);
    }
    for (const key of stale) store.removeItem(key);
    return store.getItem(markKey(doc, tab)) !== null;
  } catch {
    return false;
  }
}

/** The page's session storage, when it has one it may use. */
export function sessionMarks(): MarkStore | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
