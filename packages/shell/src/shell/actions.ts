/**
 * What the Shell's controls do: Library API calls and host messages, with
 * their results written to the store and failures shown as toasts.
 */

import { DOC_FRAGMENT, SLIDE_FRAGMENT, artifactIdOf, type ShareView, type ShareRequest, type ShellBoot } from '@open-artifact/protocol';
import { toast } from '@open-artifact/ui';
import { ApiError, api, errorText, subscribeLibraryEvents } from '../lib/api.ts';
import { copyText, fileNameOf } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { appendSent, deliveryOf, designPageFragment, sheetPageFragment, devBoot, parseSent } from './model.ts';
import { filesChanged, toHost } from './bridge.ts';
import { useShell } from './store.ts';

const notify = (title: string): void => {
  toast.add({ title });
};

const bootOf = (): ShellBoot => {
  const boot = useShell.getState().boot;
  if (!boot) throw new Error('No boot.');
  return boot;
};

function shareFragment(boot: ShellBoot | null, fragment: string): string {
  if (boot?.type === 'docs' && DOC_FRAGMENT.test(fragment)) return fragment;
  if (boot?.type === 'sheets') return sheetPageFragment(fragment);
  if (boot?.type === 'design') return designPageFragment(fragment);
  return boot?.type === 'slides' && SLIDE_FRAGMENT.test(fragment) ? fragment : '';
}

/** The Shell's own address for this artifact. */
export function shellLink(fragment = location.hash): string {
  const boot = bootOf();
  const base = boot.typeServer ? boot.typeServer.invite ?? location.origin + location.pathname : boot.viewUrl ?? `${location.origin}/a/${encodeURIComponent(boot.id)}`;
  const url = new URL(base);
  url.hash = shareFragment(boot, fragment);
  return url.href;
}

/**
 * The boot: the one the daemon injected, or, in development (no daemon
 * page), one built from `?id=` through the Library API.
 */
export async function loadBoot(): Promise<void> {
  const injected = (window as { __OPEN_ARTIFACT_BOOT__?: ShellBoot | null }).__OPEN_ARTIFACT_BOOT__;
  const store = useShell.getState();
  if (injected) return store.setBoot(injected);
  const id = artifactIdOf(new URLSearchParams(location.search).get('id'));
  if (!id) return store.setBoot(null, t('noBoot'));
  try {
    const detail = await api.artifact(id);
    let page: { page: string; page_url: string } | null = null;
    let problem: string | null = null;
    try {
      page = await api.open(id);
    } catch (error) {
      problem = errorText(error);
    }
    store.setBoot(devBoot(detail, page, problem));
  } catch (error) {
    store.setBoot(null, errorText(error));
  }
}

/** Reloads the artifact's library record. */
export async function refreshArtifact(): Promise<void> {
  try {
    useShell.getState().setArtifact(await api.artifact(bootOf().id));
  } catch {
    // Keep what we had: the bar still works on the boot.
  }
}

/** Loads every artifact for Switch artifact. */
export async function loadLibrary(): Promise<void> {
  try {
    useShell.getState().setLibrary(await api.artifacts());
  } catch {
    if (!useShell.getState().library) useShell.getState().setLibrary([]);
  }
}

/** Pins or unpins the artifact. */
export async function togglePin(): Promise<void> {
  const pinned = !useShell.getState().artifact?.pinned;
  try {
    useShell.getState().mergeArtifact(await api.update({ id: bootOf().id, pinned }));
    notify(t(pinned ? 'pinned' : 'unpinned'));
  } catch (error) {
    notify(t(pinned ? 'couldNotPin' : 'couldNotUnpin', { error: errorText(error) }));
  }
}

/** Renames the artifact (nothing for an empty or unchanged title). */
export async function rename(next: string): Promise<void> {
  const title = next.trim();
  const store = useShell.getState();
  const current = store.artifact?.title ?? bootOf().title;
  if (!title || title === current) return;
  store.mergeArtifact({ title });
  try {
    store.mergeArtifact(await api.update({ id: bootOf().id, title }));
  } catch (error) {
    store.mergeArtifact({ title: current });
    notify(t('couldNotRename', { error: errorText(error) }));
  }
}

/** Duplicates the artifact and opens the copy. */
export async function duplicate(): Promise<void> {
  try {
    const copy = await api.duplicate(bootOf().id);
    notify(t('duplicated'));
    location.href = `/a/${encodeURIComponent(copy.id)}${location.search}`;
  } catch (error) {
    notify(t('couldNotDuplicate', { error: errorText(error) }));
  }
}

/** Hands the Shell back to the host, or goes to all artifacts. */
export function closeShell(): void {
  const { host, report } = useShell.getState();
  if (host) {
    // The host removes the Shell without unloading it: ask here (standalone, `beforeunload` asks).
    if (report.leaveLosesWork && !window.confirm(t('leaveLosesWork'))) return;
    toHost({ openArtifact: 'close' });
  } else location.href = '/';
}

/** Deletes the artifact's record (the folder stays) and closes the Shell. */
export async function deleteArtifact(): Promise<void> {
  try {
    await api.remove(bootOf().id);
    closeShell();
  } catch (error) {
    notify(t('couldNotDelete', { error: errorText(error) }));
  }
}

/** Asks the host to show the owner session. */
export function openSession(): void {
  const owner = useShell.getState().artifact?.owner;
  if (!owner) return;
  toHost({ openArtifact: 'open_session', session: owner.session, harness: owner.harness });
}

/** Asks the host to start a session with this prompt. */
export function newSession(prompt: string): void {
  toHost({ openArtifact: 'new_session', prompt, artifact: bootOf().url });
}

/** Copies the Shell's link. */
export async function copyShellLink(fragment?: string): Promise<void> {
  await copyText(shellLink(fragment));
  notify(t('linkCopied'));
}

/** Copies the artifact's folder path. */
export async function copyPath(): Promise<void> {
  await copyText(bootOf().root);
  notify(t('pathCopied'));
}

// ---- sharing -----------------------------------------------------------------------------------------------------

let shareReading = false;

/** Loads the sharing state, or changes it first when `change` is given. */
export async function refreshShare(change?: Omit<ShareRequest, 'id'>): Promise<void> {
  // The panel polls every 4 s: while a read is still out, the next one waits its turn instead of piling up.
  if (!change && shareReading) return;
  const store = useShell.getState();
  if (!change) shareReading = true;
  try {
    const boot = bootOf();
    let view: ShareView;
    if (boot.typeServer?.sharePath) {
      const response = await fetch(boot.typeServer.sharePath, change && {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? response.statusText);
      view = await response.json() as ShareView;
    } else {
      view = change ? await api.setShare({ id: boot.id, ...change }) : await api.share(boot.id);
    }
    store.patchShare({ view, error: '', unsupported: false });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unsupported') store.patchShare({ view: null, unsupported: true, error: '' });
    else if (error instanceof ApiError && error.status === 0) store.patchShare({ error: t('shareNoAnswer') });
    else store.patchShare({ error: t('shareError', { error: errorText(error) }) });
  } finally {
    if (!change) shareReading = false;
  }
}

let copiedTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copies a link and shows "Copied" on its button for a moment. A role's
 * link answers only once the artifact is shared on the network, so copying
 * one turns that on.
 */
export async function copyShareLink(which: string, url: string): Promise<void> {
  const store = useShell.getState();
  const page = which === 'page' ? '' : shareFragment(store.boot, location.hash);
  await copyText(url + page);
  store.patchShare({ copied: which });
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    if (useShell.getState().share.copied === which) useShell.getState().patchShare({ copied: null });
  }, 1600);
  const view = store.share.view;
  if (which !== 'page' && view && !view.lan) await refreshShare({ lan: true });
}

// ---- the folder as a zip ------------------------------------------------------------------------------------------

let zipping = false;

/**
 * Downloads the artifact's folder as a zip (the Export tab's last row): a
 * `HEAD` first, so a folder that will not zip (too large, or a type that
 * cannot) says so here instead of in the browser's download list; then a
 * plain link, which the browser streams to disk however large it is.
 */
export async function downloadArchive(): Promise<void> {
  if (zipping) return;
  zipping = true;
  const boot = bootOf();
  const url = api.archiveUrl(boot.id);
  try {
    let head: Response;
    try {
      head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    } catch (error) {
      throw new Error(t('archiveFailed', { error: errorText(error) }));
    }
    if (!head.ok) {
      if (head.status === 413) throw new Error(t('archiveTooLarge'));
      if (head.status === 409) throw new Error(t('archiveUnsupported', { type: boot.typeTitle }));
      throw new Error(t('archiveFailed', { error: `HTTP ${head.status}` }));
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    toast.add({ title: t('archiveStarted', { name: fileNameOf(head.headers.get('Content-Disposition')) || 'folder.zip' }), description: t('archiveHint') });
  } catch (error) {
    notify(errorText(error));
  } finally {
    zipping = false;
  }
}

// ---- asking the agent ----------------------------------------------------------------------------------------------

const sentKey = (): string => `open-artifact-ask-${bootOf().id}`;

/** Restores the messages sent from this tab. */
export function restoreSent(): void {
  try {
    useShell.getState().setSent(parseSent(sessionStorage.getItem(sentKey())));
  } catch {
    // No session storage: start empty.
  }
}

/** Sends a message to the owner agent. Resolves `true` when it was sent. */
export async function ask(text: string, agent: string): Promise<boolean> {
  const body = text.trim();
  if (!body) return false;
  const store = useShell.getState();
  store.setAskStatus(t('sending'));
  try {
    const out = await api.ask({ id: bootOf().id, text: body });
    const delivery = deliveryOf(out.via);
    const sent = appendSent(useShell.getState().sent, { text: body, at: new Date().toISOString(), delivery });
    store.setSent(sent);
    try {
      sessionStorage.setItem(sentKey(), JSON.stringify(sent));
    } catch {
      // Not kept across reloads; fine.
    }
    store.setAskStatus(delivery === 'inbox' ? t('sentInbox', { agent }) : delivery === 'delivered' ? t('sent') : t('notDelivered'));
    toHost({ openArtifact: 'comment_summon', text: body });
    return true;
  } catch (error) {
    store.setAskStatus(t('notSent', { error: errorText(error) }));
    return false;
  }
}

// ---- live updates --------------------------------------------------------------------------------------------------

/** Follows `/api/open-artifact.events`: refreshes the artifact, forgets the library, passes file changes to the page. */
export function startEvents(): () => void {
  return subscribeLibraryEvents((event) => {
    const boot = useShell.getState().boot;
    if (!boot) return;
    switch (event.type) {
      case 'artifacts/changed':
        useShell.getState().setLibrary(null);
        if (event.id !== boot.id) return;
        void refreshArtifact();
        // A static entry's files changed: the page applies them itself or the frame loads again.
        if (event.paths?.length && boot.pageKind === 'static') filesChanged(event.paths);
        break;
      case 'harness/changed':
        void refreshArtifact();
        break;
      case 'wake/state':
        if (event.artifactId === boot.id) void refreshArtifact();
        break;
      default:
        break;
    }
  });
}
