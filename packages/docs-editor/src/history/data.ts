/** Reading a tab's versions, previewing one, restoring it and copying it to a new tab. */
import { type DiskDoc, docFromDisk } from '@open-artifact/docs-core';
import { toast } from '@open-artifact/ui';
import { docClient } from '../app/doc-client.ts';
import { session } from '../app/session.ts';
import { showTab } from '../app/start.ts';
import { getDocs, useDocs } from '../app/store.ts';
import { afterCopy, copyMembers, copyName, mintedTab } from './copy.ts';
import { isFirstSaved } from './compare-target.ts';
import { compareBase } from './groups.ts';
import { type CompareWith, PAGE_VERSIONS, type Preview, getHistory, setHistory, versionKey } from './store.ts';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

let listing = 0;

/** Reads the tab's versions (again). A list of another tab starts over. */
export async function loadHistory(tab: string): Promise<void> {
  const call = ++listing;
  const fresh = getHistory().tab !== tab;
  setHistory(fresh ? { tab, versions: null, loading: true, error: null, shown: PAGE_VERSIONS, expanded: {} } : { loading: true });
  try {
    const answer = await session().doc.history(tab);
    if (call !== listing) return;
    // The newest version is the tab as it is now; it is read at the tab's own rev, which keeps no other snapshot.
    const versions = answer.versions.map((version, index) => (index === 0 && version.rev !== answer.rev ? { ...version, rev: answer.rev } : version));
    setHistory({ versions, loading: false, error: null });
    keepPreviewInList();
  } catch (error) {
    if (call !== listing) return;
    setHistory({ loading: false, error: messageOf(error) });
  }
}

/** The preview of "Current version" follows the tab as it changes; a preview of a version no longer kept closes. */
function keepPreviewInList(): void {
  const { preview, versions } = getHistory();
  if (!preview || !versions) return;
  const newest = versions[0];
  if (preview.current) {
    if (newest && newest.rev !== preview.rev) setHistory({ preview: { ...preview, rev: newest.rev, at: newest.at, base: compareBase(versions, newest.rev) } });
    return;
  }
  if (!versions.some(version => version.rev === preview.rev)) setHistory({ preview: null });
}

export function showOlder(): void {
  setHistory(state => ({ shown: state.shown + PAGE_VERSIONS }));
}

export function toggleExpanded(key: string): void {
  setHistory(state => ({ expanded: { ...state.expanded, [key]: !state.expanded[key] } }));
}

export function selectPreview(preview: Preview): void {
  const now = getHistory().preview;
  if (now && now.row === preview.row && now.rev === preview.rev) return;
  setHistory({ preview, confirmRestore: false, restoreBase: 'previous' });
}

export function clearPreview(): void {
  if (getHistory().preview || getHistory().confirmRestore) setHistory({ preview: null, confirmRestore: false });
}

export function setCompare(compare: boolean): void {
  setHistory({ compare });
}

/** Compare with the version before, the tab as it is now, or (a restore) the version it brought back. */
export function setCompareBase(base: CompareWith | 'restored'): void {
  if (base === 'restored') setHistory({ compare: true, restoreBase: 'restored' });
  else setHistory({ compare: true, compareWith: base, restoreBase: 'previous' });
}

const reading = new Map<string, Promise<void>>();

/** Reads a version once; it lands in `docs` (or `docErrors`). A version that is gone sends the list to be read again. */
export function loadVersion(tab: string, rev: number): Promise<void> {
  const key = versionKey(tab, rev);
  if (getHistory().docs[key]) return Promise.resolve();
  const known = reading.get(key);
  if (known) return known;
  const read = (async () => {
    try {
      const answer = await session().doc.version(tab, rev);
      const doc = docFromDisk(answer.doc as unknown as DiskDoc);
      setHistory(state => ({ docs: { ...state.docs, [key]: doc }, docErrors: withoutKey(state.docErrors, key) }));
    } catch (error) {
      setHistory(state => ({ docErrors: { ...state.docErrors, [key]: messageOf(error) } }));
      // A version gone from the list sends it to be read again; the tab as first saved is in no list.
      if (getHistory().tab === tab && !isFirstSaved(getHistory().versions, rev)) void loadHistory(tab);
    } finally {
      reading.delete(key);
    }
  })();
  reading.set(key, read);
  return read;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _gone, ...rest } = record;
  return rest;
}

/** Restoring and copying take an editor whose page holds a writing session. */
export const canRestoreVersions = (): boolean => session().canRestore && getDocs().writable;
export const canCopyVersions = (): boolean => session().canEdit && getDocs().writable;

export async function restorePreview(): Promise<void> {
  const { preview, busy } = getHistory();
  if (!preview || preview.current || busy) return;
  setHistory({ busy: 'restoring', confirmRestore: false });
  try {
    const client = docClient();
    await client.settled();
    const answer = await session().doc.restore({ tab: preview.tab, rev: preview.rev });
    if (answer.restored) {
      setHistory({ preview: null });
      toast.add({ title: 'Version restored', description: 'Your previous version stays in the history.' });
    } else {
      toast.add({ title: 'Nothing to restore', description: 'This version already matches the current one.' });
    }
  } catch (error) {
    toast.add({ title: 'Couldn’t restore this version', description: messageOf(error) });
  } finally {
    setHistory({ busy: null });
    void loadHistory(preview.tab);
  }
}

export async function copyPreview(): Promise<void> {
  const { preview, busy } = getHistory();
  if (!preview || busy) return;
  const file = getDocs().project?.files.find(item => item.id === preview.tab);
  if (!file) return;
  setHistory({ busy: 'copying' });
  try {
    await loadVersion(preview.tab, preview.rev);
    const doc = getHistory().docs[versionKey(preview.tab, preview.rev)];
    if (!doc) throw new Error(getHistory().docErrors[versionKey(preview.tab, preview.rev)] ?? 'This version could not be read.');
    const answer = await docClient().call({ batch: copyMembers(copyName(file.name, preview.at), doc) });
    const tab = mintedTab(answer);
    const listed = tab ? await tabListed(tab) : false;
    // Decided once the copy can be opened: the person may have gone on meanwhile.
    const next = afterCopy(preview, getHistory().preview);
    if (tab && listed && next.open) {
      setHistory({ preview: null });
      showTab(tab);
      toast.add({ title: next.title });
    } else {
      const made = afterCopy(preview, null);
      toast.add({ title: made.title, ...(tab ? { actionProps: { children: 'Open', onClick: () => void openCopy(tab) } } : {}) });
    }
  } catch (error) {
    toast.add({ title: 'Couldn’t make a copy of this version. Try again.', description: messageOf(error) });
  } finally {
    setHistory({ busy: null });
  }
}

/** Opens a copy made earlier, once the doc lists it. */
async function openCopy(tab: string): Promise<void> {
  if (!(await tabListed(tab))) return;
  setHistory({ preview: null });
  showTab(tab);
}

/** Waits (a little) for the doc to list a new tab: it can't be opened before. */
function tabListed(tab: string, timeoutMs = 5000): Promise<boolean> {
  const listed = () => !!getDocs().project?.files.some(file => file.id === tab);
  if (listed()) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      stop();
      resolve(false);
    }, timeoutMs);
    const stop = useDocs.subscribe(() => {
      if (!listed()) return;
      clearTimeout(timer);
      stop();
      resolve(true);
    });
  });
}
