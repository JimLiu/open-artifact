/**
 * The subset of the DSH (DeepSeek Harness) client API the page uses, declared locally: DSH publishes no types for it.
 * Services are read with `ctx.get(name)` and may be missing in an older or smaller app, so every use checks first.
 */
import type { ExternalStore, SessionsSnapshot } from '@open-artifact/library-page';
import type { ComponentType } from 'react';

/** A store the app hands out (`useSyncExternalStore` shape), and its conversation list (`ctx.get('sessions').list`). */
export type { ExternalStore, SessionsSnapshot };

/** The app's workspaces (`ctx.get('workspaces').list`). */
export interface WorkspacesSnapshot {
  state?: string;
  phase?: string;
  archivedSessionIds?: string[];
}

/** `ctx.get('uiWorkspace')`: the main area's navigation. */
export interface UiWorkspace {
  openSession?(id: string): void;
  startSession?(workspaceId?: string, options?: { prompt: string; whenDraftExists: 'append' }): void;
}

/** `ctx.get('sidebarRight')`: the conversation's right sidebar, whose Browser tab is the desktop app's. */
export interface SidebarRight {
  openTabIn(sessionId: string, kind: string, options: { params: { url: string } }): void;
  tabsIn?(sessionId: string): Array<{ kind: string }>;
}

/** The locale service. */
export interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): (() => void) | unknown;
  bind?(ns: string): (key: string, params?: Record<string, string>) => string;
}

/** The slot service: where a plugin puts its components. */
export interface SlotService {
  inject(name: string, register: () => unknown): unknown;
  register(options: Record<string, unknown>, component: ComponentType<never>): unknown;
}

/** The conversation's event definitions (`uiConversation.events`). */
export interface ConversationService {
  events: { register(definition: unknown): unknown };
}

/** The Cordis context DSH hands a client plugin's `apply`: the subset this plugin uses. */
export interface ClientContext {
  /** Run `execute` while the plugin is on; its result is the disposer. */
  effect(execute: () => () => void, label?: string): unknown;
  /** A service by name; undefined (or a throw) when the app has none. */
  get(name: string): unknown;
  locale: LocaleService;
  slots: SlotService;
  uiConversation: ConversationService;
  /** Cordis: run `apply` once these services are there. */
  inject?(deps: string[], apply: (ctx: never) => void): unknown;
}

/** A service, or undefined. */
export function service<T>(ctx: Pick<ClientContext, 'get'>, name: string): T | undefined {
  try {
    return (ctx.get(name) ?? undefined) as T | undefined;
  } catch {
    return undefined;
  }
}

/** Whether a value is an {@link ExternalStore}. */
export function isStore<T>(value: unknown): value is ExternalStore<T> {
  const v = value as Partial<ExternalStore<T>> | null | undefined;
  return typeof v?.getSnapshot === 'function' && typeof v.subscribe === 'function';
}

/** What a disposer-returning registration gave, as a function. */
export function toDisposer(value: unknown): () => void {
  return typeof value === 'function' ? (value as () => void) : () => {};
}

/** Whether a conversation can be opened, as the app's own links to one decide it. */
export function linkState(
  id: string,
  sessions: SessionsSnapshot | undefined,
  workspaces: WorkspacesSnapshot | undefined,
): 'available' | 'loading' | 'archived' | 'unavailable' {
  if (!id || sessions === undefined) return 'unavailable';
  if (workspaces?.state === 'error') return 'unavailable';
  if (sessions.phase === 'pending' || workspaces?.phase === 'pending') return 'loading';
  if (workspaces?.archivedSessionIds?.includes(id)) return 'archived';
  if (!sessions.ids?.includes(id)) return 'unavailable';
  return 'available';
}

/** How long {@link openInSidebar} waits for the conversation it switched to to take tabs in its right sidebar. */
const SIDEBAR_WAIT_MS = 5_000;

/**
 * Opens `url` in a Browser tab of the conversation's right sidebar; false when the tab never showed up. The sidebar
 * takes a conversation's tabs only once its view has mounted after `openSession`, and `openTabIn` does nothing before
 * that, so it is tried until a new Browser tab is there.
 */
export async function openInSidebar(sidebar: SidebarRight, sessionId: string, url: string, waitMs = SIDEBAR_WAIT_MS): Promise<boolean> {
  const tabsIn = sidebar.tabsIn?.bind(sidebar);
  if (typeof tabsIn !== 'function') {
    sidebar.openTabIn(sessionId, 'browser', { params: { url } });
    return true;
  }
  const browsers = () => tabsIn(sessionId).filter((tab) => tab.kind === 'browser').length;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const before = browsers();
    sidebar.openTabIn(sessionId, 'browser', { params: { url } });
    if (browsers() > before) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The right sidebar, when the app has one with a Browser tab (the desktop app). */
export function sidebarBrowser(ctx: Pick<ClientContext, 'get'>): SidebarRight | undefined {
  const sidebar = service<SidebarRight>(ctx, 'sidebarRight');
  const tabs = service<{ get(kind: string): unknown }>(ctx, 'sidebarRightTabs');
  return sidebar && typeof sidebar.openTabIn === 'function' && tabs?.get('browser') !== undefined ? sidebar : undefined;
}
