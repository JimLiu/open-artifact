/**
 * The browser half of dsh-open-artifact (`dsh.client` in package.json):
 *
 * - the Open Artifact page in the app's left sidebar, listing the daemon's library through the server half's routes
 *   (src/server/routes.ts);
 * - the chat cards of what a person sends to the agent from an artifact, a comment or a request (cards.ts);
 * - the artifacts the agent opens (`host.open`), shown in the conversation's right-sidebar Browser (host-open.ts);
 * - a newer release of the plugin, offered and installed from the page (updates.tsx).
 *
 * The page itself is `@open-artifact/library-page`'s: this half hands it the routes (api.ts), the app (page-host.ts),
 * the update (update-state.ts), the app's tokens (styles.ts) and its look (dark, macOS) on the page's root.
 *
 * scripts/build.mjs bundles this file, the page with it, with React and the platform modules left to the app's module
 * loader, and wraps it in `window.__ModuleLoader__.load`. The CSS is in styles.ts and the page's package.
 */
import {
  ArtifactsIcon,
  ArtifactsPage,
  createPageStore,
  EMPTY_SESSIONS,
  EnvProvider,
  injectStyles,
  PAGE_CSS,
  StoreProvider,
  translator,
  type PageEnv,
  type Translate,
} from '@open-artifact/library-page';
import { useSyncExternalStore, type ComponentType } from 'react';
import { httpApi, readChangelog } from './api.ts';
import { cardDefinition, threadUrl, type CardData } from './cards.ts';
import { EventCards, type EventCardsProps } from './components/EventCards.tsx';
import { followHostOpens } from './host-open.ts';
import { isStore, service, sidebarBrowser, toDisposer, type ClientContext, type SessionsSnapshot } from './host.ts';
import { pageHost } from './page-host.ts';
import { onAnotherDevice, pendingWindow } from './remote.ts';
import { CARD_CSS, TOKEN_CSS } from './styles.ts';
import { pageUpdates } from './update-state.ts';
import { joinUpdates, UpdateMark, type UpdateContext } from './updates.tsx';
import { dshTranslator, en, zh, type DshTranslate } from './words.ts';

/** The package, as the app's module loader knows it. */
const PLUGIN = 'dsh-open-artifact';
/** The page's panel id, and its locale namespace. */
export const PANEL_ID = 'open-artifact';
const NS = 'open-artifact';

/** The services the browser half needs. */
export const inject = ['slots', 'locale', 'uiConversation'];

/** A translate function the app hands a slot component (`locale: NS`). */
type HostTranslate = (key: string, params?: Record<string, string>) => string;

/**
 * A thread opened from another device: the daemon's address is this computer's loopback, out of reach there, so the
 * open route answers with the Shell's link, in a window opened at once.
 */
async function openRemote(artifactId: string, threadId: string): Promise<void> {
  const pending = pendingWindow();
  if (!pending) return;
  try {
    const { url } = await httpApi.open(artifactId);
    pending.go(threadUrl(url, threadId));
  } catch {
    pending.close();
  }
}

/** Registers the chat cards: the definition that claims a wake message, and the chat node that draws it. */
function joinCards(ctx: ClientContext, t: DshTranslate): void {
  const kind = `${PLUGIN}:event`;
  ctx.uiConversation.events.register(cardDefinition(kind));
  const Cards = (props: Omit<EventCardsProps, 't'> & { t?: HostTranslate }) => (
    <EventCards node={props.node} openThread={props.openThread} t={props.t ? dshTranslator(props.t) : t} />
  );
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: kind,
        locale: NS,
        inject: (sessionId: string) => ({
          openThread: (data: CardData, threadId: string) => {
            if (data.artifactId && (onAnotherDevice() || !data.viewUrl)) return void openRemote(data.artifactId, threadId);
            const target = threadUrl(data.viewUrl, threadId);
            const sidebar = sidebarBrowser(ctx);
            if (sidebar) sidebar.openTabIn(sessionId, 'browser', { params: { url: target } });
            else window.open(target, '_blank', 'noopener,noreferrer');
          },
        }),
      },
      Cards as ComponentType<never>,
    ),
  );
}

/** The app's look, as the page's root says it: dark (`body[data-ds-dark-theme]`), and macOS (`[data-platform=darwin]`). */
interface Look {
  theme: 'light' | 'dark';
  platform: 'darwin' | undefined;
}

let look: Look | null = null;
function readLook(): Look {
  if (typeof document === 'undefined') return { theme: 'light', platform: undefined };
  const theme = document.body?.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
  const platform = document.querySelector('[data-platform=darwin]:not(.oa-page)') ? 'darwin' : undefined;
  // The same object while nothing changed: a new one per read makes React draw again forever.
  if (look === null || look.theme !== theme || look.platform !== platform) look = { theme, platform };
  return look;
}
function watchLook(listener: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-platform'], subtree: true });
  return () => observer.disconnect();
}

/** Registers the page and its sidebar entry. */
function joinPage(ctx: ClientContext, t: Translate, words: DshTranslate): void {
  const host = pageHost(ctx, words);
  const store = createPageStore({ api: httpApi, host, t });
  const sessions = () => {
    const list = service<{ list?: unknown }>(ctx, 'sessions')?.list;
    return isStore<SessionsSnapshot>(list) ? list : EMPTY_SESSIONS;
  };

  const Page = (props: { t?: HostTranslate }) => {
    const env: PageEnv = { t: props.t ? translator(props.t) : t, api: httpApi, sessions: sessions(), updates: pageUpdates, changelog: readChangelog };
    const { theme, platform } = useSyncExternalStore(watchLook, readLook, readLook);
    return (
      <EnvProvider env={env}>
        <StoreProvider store={store}>
          <ArtifactsPage canCreate={host.canCreate()} theme={theme} platform={platform} />
        </StoreProvider>
      </EnvProvider>
    );
  };

  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) }, Page as ComponentType<never>));
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel'), inject: () => ({}) },
      ArtifactsEntry as ComponentType<never>,
    ),
  );
}

/** The sidebar entry: the icon, and the update's mark. The app draws it at 16 in a wide row and at 18 on the collapsed rail. */
function ArtifactsEntry({ size = 16 }: { size?: number }) {
  return (
    <UpdateMark wide={size <= 16}>
      <ArtifactsIcon size={size} />
    </UpdateMark>
  );
}

/** Applies the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(`${PLUGIN}/page.css`, TOKEN_CSS + PAGE_CSS), `${PLUGIN}: page styles`);
  ctx.effect(() => injectStyles(`${PLUGIN}/cards.css`, CARD_CSS), `${PLUGIN}: card styles`);
  ctx.effect(() => toDisposer(ctx.locale.register(NS, { zh, en })), `${PLUGIN}: dictionaries`);
  const bound = ctx.locale.bind?.(NS);
  const t = translator(bound);
  const words = dshTranslator(bound);
  joinCards(ctx, words);
  joinPage(ctx, t, words);
  ctx.effect(() => followHostOpens(ctx), `${PLUGIN}: host.open`);
  joinUpdates(ctx as unknown as UpdateContext, PLUGIN);
}
