/** What the home page's controls do: Library API calls, with results in the store and failures as toasts. */

import { ARCHIVE_CONTENT_TYPE, type ArtifactView, type TypeView } from '@open-artifact/protocol';
import { toast } from '@open-artifact/ui';
import { api, ApiError, errorText, subscribeLibraryEvents } from '../lib/api.ts';
import { copyText } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { homeBoot, toHost } from './host.ts';
import { replaceArtifact, withoutArtifact } from './model.ts';
import { useHome } from './store.ts';
import { purgeOutcome } from './trash.ts';
import { failureOfAnswer, importedId, pickZip, tooLargeToSend, uploadBusy, uploadFailure } from './upload.ts';

const notify = (title: string): void => {
  toast.add({ title });
};

/** The Shell's address of an artifact. */
export const shellHref = (id: string): string => `/a/${encodeURIComponent(id)}`;

/** Loads the artifact list (locally, each says where it is published to the web). */
export async function loadArtifacts(): Promise<void> {
  try {
    // Each artifact says where it is published (`remote`): no `GET remotes` just for the cards' web marks.
    useHome.getState().setArtifacts(await api.artifacts());
    useHome.getState().setError(null);
  } catch (error) {
    useHome.getState().setError(t('couldNotLoad', { error: errorText(error) }));
  }
}

/** Opens a published artifact's web address in a new tab. */
export function openOnWeb(url: string): void {
  window.open(url, '_blank', 'noopener');
}

/** Copies a published artifact's web address. */
export async function copyWebLink(url: string): Promise<void> {
  await copyText(url);
  notify(t('webLinkCopied'));
}

/** Loads the types. */
export async function loadTypes(): Promise<void> {
  try {
    useHome.getState().setTypes(await api.types());
  } catch (error) {
    useHome.getState().setError(t('couldNotLoad', { error: errorText(error) }));
  }
}

const applyView = (next: ArtifactView): void => {
  const list = useHome.getState().artifacts;
  if (list) useHome.getState().setArtifacts(replaceArtifact(list, next));
};

/** Pins or unpins an artifact. */
export async function togglePin(artifact: ArtifactView): Promise<void> {
  const pinned = !artifact.pinned;
  try {
    applyView(await api.update({ id: artifact.id, pinned }));
  } catch (error) {
    notify(t(pinned ? 'couldNotPin' : 'couldNotUnpin', { error: errorText(error) }));
  }
}

/** Renames an artifact (nothing for an empty or unchanged title). */
export async function renameArtifact(artifact: ArtifactView, next: string): Promise<void> {
  const title = next.trim();
  if (!title || title === artifact.title) return;
  try {
    applyView(await api.update({ id: artifact.id, title }));
  } catch (error) {
    notify(t('couldNotRename', { error: errorText(error) }));
  }
}

/** Duplicates an artifact; the list picks the copy up. */
export async function duplicateArtifact(artifact: ArtifactView): Promise<void> {
  try {
    await api.duplicate(artifact.id);
    notify(t('duplicated'));
    await loadArtifacts();
  } catch (error) {
    notify(t('couldNotDuplicate', { error: errorText(error) }));
  }
}

let undoTimer: ReturnType<typeof setTimeout> | null = null;

/** Deletes an artifact's record (the folder stays), offering Undo for a few seconds. */
export async function deleteArtifact(artifact: ArtifactView): Promise<void> {
  const store = useHome.getState();
  const before = store.artifacts;
  if (before) store.setArtifacts(withoutArtifact(before, artifact.id));
  try {
    await api.remove(artifact.id);
    store.setUndo({ id: artifact.id, title: artifact.title, ...(homeBoot.cloud ? { trash: true } : {}) });
    if (useHome.getState().trash) void loadTrash();
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      if (useHome.getState().undo?.id === artifact.id) useHome.getState().setUndo(null);
    }, 8000);
  } catch (error) {
    if (before) store.setArtifacts(before);
    notify(t('couldNotDelete', { error: errorText(error) }));
  }
}

/** Brings back the artifact just deleted. */
export async function undoDelete(): Promise<void> {
  const undo = useHome.getState().undo;
  if (!undo) return;
  useHome.getState().setUndo(null);
  try {
    await api.restore(undo.id);
    notify(t('restored'));
    await loadArtifacts();
    if (useHome.getState().trash) void loadTrash();
  } catch (error) {
    notify(t('couldNotRestore', { error: errorText(error) }));
  }
}

// ---- the cloud home page: the trash ------------------------------------------------------------------------------

/** Loads the trash (a cloud host). */
export async function loadTrash(): Promise<void> {
  try {
    useHome.getState().setTrash(await api.trashed());
  } catch (error) {
    useHome.getState().setError(t('couldNotLoad', { error: errorText(error) }));
  }
}

/** Takes an artifact out of the trash; it is back in the list. */
export async function restoreTrashed(item: { id: string; title: string }): Promise<void> {
  const store = useHome.getState();
  const before = store.trash;
  if (before) store.setTrash(before.filter((a) => a.id !== item.id));
  try {
    await api.restore(item.id);
    notify(t('restoredTitle', { title: item.title }));
    await Promise.all([loadArtifacts(), loadTrash()]);
  } catch (error) {
    if (before) useHome.getState().setTrash(before);
    notify(t('couldNotRestore', { error: errorText(error) }));
  }
}

/**
 * Deletes a trashed artifact for good (its owner, after the confirmation). A host that cannot (501) is not asked again:
 * "Delete forever" goes away and nothing claims it was deleted.
 */
export async function purgeTrashed(item: { id: string; title: string }): Promise<void> {
  try {
    await api.purge(item.id);
    const trash = useHome.getState().trash;
    if (trash) useHome.getState().setTrash(trash.filter((a) => a.id !== item.id));
    notify(t('purged', { title: item.title }));
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    const outcome = purgeOutcome(status, errorText(error));
    if (outcome.unsupported) useHome.getState().setPurgeUnsupported();
    else notify(t(outcome.said.key, outcome.said.vars));
    void loadTrash();
  }
}

// ---- the cloud home page: uploading a zip ------------------------------------------------------------------------

/** Where an uploaded zip goes (same-origin, `application/zip`). */
export const IMPORT_URL = '/api/open-artifact.artifacts.import';

/**
 * Sends a zip to the host with upload progress (XHR: a fetch cannot report how far a request body is), then opens the
 * new artifact. A file that is not a zip is refused here; the host's refusals are said in plain words.
 */
export function uploadFiles(files: readonly File[]): void {
  const store = useHome.getState();
  if (uploadBusy(store.upload)) return;
  const picked = pickZip(files);
  if (!picked) return;
  if ('said' in picked) {
    const name = files[0]?.name ?? '';
    store.uploadEvent({ type: 'start', name, size: 0 });
    store.uploadEvent({ type: 'failed', said: picked.said });
    return;
  }
  const file = picked.file;
  store.uploadEvent({ type: 'start', name: file.name, size: file.size });
  // Over the site's limit: said now, not after sending it all for a 413.
  const tooLarge = tooLargeToSend(file.size, homeBoot.cloud?.limits?.importBytes);
  if (tooLarge) {
    store.uploadEvent({ type: 'failed', said: tooLarge });
    return;
  }
  const xhr = new XMLHttpRequest();
  xhr.open('POST', IMPORT_URL);
  xhr.setRequestHeader('Content-Type', ARCHIVE_CONTENT_TYPE);
  xhr.upload.onprogress = (event) => useHome.getState().uploadEvent({ type: 'progress', loaded: event.loaded, total: event.lengthComputable ? event.total : 0 });
  xhr.upload.onload = () => useHome.getState().uploadEvent({ type: 'sent' });
  xhr.onload = () => {
    const id = xhr.status === 201 || xhr.status === 200 ? importedId(xhr.responseText) : null;
    if (id) {
      useHome.getState().uploadEvent({ type: 'done', id });
      location.href = shellHref(id);
      return;
    }
    useHome.getState().uploadEvent({ type: 'failed', said: uploadFailure(failureOfAnswer(xhr.status, xhr.responseText)) });
  };
  xhr.onerror = () => useHome.getState().uploadEvent({ type: 'failed', said: uploadFailure({ status: 0, code: 'connect_failed', message: '' }) });
  xhr.send(file);
}

/** Creates an artifact of a type and opens it in the Shell. Resolves with an error message, or `null`. */
export async function createArtifact(type: TypeView, title: string, folder: string): Promise<string | null> {
  if (!title.trim()) return t('needTitle');
  try {
    const made = await api.create({ type: type.id, title: title.trim(), ...(folder.trim() ? { folder: folder.trim() } : {}) });
    location.href = shellHref(made.id);
    return null;
  } catch (error) {
    return t('couldNotCreate', { error: errorText(error) });
  }
}

/** Asks the host to show an artifact's owner session. */
export function backToSession(artifact: ArtifactView): void {
  if (!artifact.owner) return;
  toHost({ openArtifact: 'open_session', session: artifact.owner.session, harness: artifact.owner.harness });
}

/** Reloads on library events (debounced). Returns a function that stops. */
export function startEvents(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let types = false;
  const stop = subscribeLibraryEvents((event) => {
    if (event.type === 'types/changed') types = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void loadArtifacts();
      if (types && !homeBoot.cloud) void loadTypes();
      if (homeBoot.cloud && useHome.getState().cloudTab === 'trash') void loadTrash();
      types = false;
    }, 200);
  });
  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}
