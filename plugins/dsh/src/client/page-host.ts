/**
 * The page's {@link PageHost} over the DSH app: sessions are opened and started with the app's own navigation (a new
 * one to make an artifact gets `/open-artifact <type> …` in its input), an artifact shows in its session's right
 * sidebar Browser (the desktop app's), and thumbnails come from the desktop app's Browser guests.
 */
import type { PageHost } from '@open-artifact/library-page';
import type { OpenAnswer } from '../shared/routes.ts';
import { isStore, linkState, openInSidebar, service, sidebarBrowser, type ClientContext, type SessionsSnapshot, type UiWorkspace, type WorkspacesSnapshot } from './host.ts';
import { onAnotherDevice, pendingWindow, type PendingWindow } from './remote.ts';
import { captureThumbnail, desktopBrowser } from './thumbnails.ts';
import { isDshKey, type DshTranslate } from './words.ts';

/**
 * What the input of a new session holds: the `/open-artifact` skill word with the type, which makes the app load the
 * skill (src/server/skill.ts), then the start of a sentence for the person to finish.
 */
export function promptFor(typeId: string, title: string, t: DshTranslate): string {
  const key = `prompt.${typeId}`;
  return `/open-artifact ${typeId} ${isDshKey(key) ? t(key) : t('prompt.generic', { type: title })}`;
}

/** Copies text, with the old way when the page is not focused or the app refuses the clipboard. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    if (!done) throw new Error('the clipboard refused it');
  }
}

/** A store's snapshot, when the service has one. */
function snapshot<T>(ctx: Pick<ClientContext, 'get'>, name: string): T | undefined {
  const list = service<{ list?: unknown }>(ctx, name)?.list;
  return isStore<T>(list) ? list.getSnapshot() : undefined;
}

/** Shows a URL in a window: the one opened already, or a new one. */
function showInWindow(url: string, pending: PendingWindow | null): void {
  if (pending) pending.go(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** The page's host over a DSH client context. */
export function pageHost(ctx: Pick<ClientContext, 'get'>, t: DshTranslate): PageHost {
  const nav = () => service<UiWorkspace>(ctx, 'uiWorkspace');
  const browser = desktopBrowser();
  let storage: Storage | null = null;
  try {
    storage = typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Storage blocked: the layout choice lasts the visit.
  }
  return {
    canCreate: () => typeof nav()?.startSession === 'function',
    create(type) {
      const workspace = nav();
      if (typeof workspace?.startSession !== 'function') return;
      // Added after anything already typed in the new session's input, as the app's own prompts are.
      if (type === undefined) workspace.startSession();
      else workspace.startSession(undefined, { prompt: promptFor(type.id, type.title, t), whenDraftExists: 'append' });
    },
    away: onAnotherDevice,
    pendingWindow,
    async show(answer: OpenAnswer, pending) {
      const workspace = nav();
      const reachable =
        typeof workspace?.openSession === 'function' &&
        linkState(answer.sessionId, snapshot<SessionsSnapshot>(ctx, 'sessions'), snapshot<WorkspacesSnapshot>(ctx, 'workspaces')) === 'available';
      if (!reachable) {
        showInWindow(answer.url, pending);
        return { sessionGone: true };
      }
      workspace.openSession!(answer.sessionId);
      // The right sidebar's Browser is the desktop app's; elsewhere (and if the tab never shows) a window.
      const sidebar = pending === null ? sidebarBrowser(ctx) : undefined;
      const shown = sidebar !== undefined && (await openInSidebar(sidebar, answer.sessionId, answer.url));
      if (!shown) showInWindow(answer.url, pending);
      return { sessionGone: false };
    },
    copy: copyText,
    ...(browser ? { capture: (url: string, type: string, signal: AbortSignal) => captureThumbnail(browser, url, type, signal) } : {}),
    visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    storage,
  };
}
