/**
 * The browser half of dsh-open-artifact (`dsh.client` in package.json):
 *
 * - the Open Artifact page in the app's left sidebar, listing the daemon's library through the server half's routes
 *   (src/server/routes.ts);
 * - the chat cards of what a person sends to the agent from an artifact, a comment or a request (cards.ts);
 * - the artifacts the agent opens (`host.open`), shown in the conversation's right-sidebar Browser (host-open.ts);
 * - a newer release of the plugin, offered and installed from the page (updates.tsx).
 *
 * scripts/build.mjs bundles this file with React and the platform modules left to the app's module loader, and wraps it
 * in `window.__ModuleLoader__.load`. The CSS is in styles.ts.
 */
import type { ComponentType } from 'react';
import { httpApi } from './api.ts';
import { cardDefinition, threadUrl, type CardData } from './cards.ts';
import { ArtifactsPage } from './components/ArtifactsPage.tsx';
import { HostingSettings } from './components/HostingSettings.tsx';
import { EventCards, type EventCardsProps } from './components/EventCards.tsx';
import { followHostOpens } from './host-open.ts';
import { EMPTY_SESSIONS, EnvProvider, type PageEnv } from './env.tsx';
import { isStore, service, sidebarBrowser, toDisposer, type ClientContext, type SessionsSnapshot } from './host.ts';
import { en, translator, zh, type Translate } from './i18n.ts';
import { pageHost } from './page-host.ts';
import { onAnotherDevice, pendingWindow } from './remote.ts';
import { createPageStore, StoreProvider } from './store.ts';
import { ArtifactsIcon } from './look.tsx';
import { CARD_CSS, injectStyles, PAGE_CSS } from './styles.ts';
import { joinUpdates, UpdateMark, type UpdateContext } from './updates.tsx';

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
function joinCards(ctx: ClientContext, t: Translate): void {
  const kind = `${PLUGIN}:event`;
  ctx.uiConversation.events.register(cardDefinition(kind));
  const Cards = (props: Omit<EventCardsProps, 't'> & { t?: HostTranslate }) => (
    <EventCards node={props.node} openThread={props.openThread} t={props.t ? translator(props.t) : t} />
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

/** Registers the page and its sidebar entry. */
function joinPage(ctx: ClientContext, t: Translate): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'open-artifact-hosting', order: 65, label: () => 'Artifact Hosting' }, HostingSettings as ComponentType<never>));
  const host = pageHost(ctx);
  const store = createPageStore({ api: httpApi, host, t });
  const sessions = () => {
    const list = service<{ list?: unknown }>(ctx, 'sessions')?.list;
    return isStore<SessionsSnapshot>(list) ? list : EMPTY_SESSIONS;
  };

  const Page = (props: { t?: HostTranslate }) => {
    const env: PageEnv = { t: props.t ? translator(props.t) : t, api: httpApi, sessions: sessions() };
    return (
      <EnvProvider env={env}>
        <StoreProvider store={store}>
          <ArtifactsPage canCreate={host.canCreate()} />
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
  ctx.effect(() => injectStyles(`${PLUGIN}/page.css`, PAGE_CSS), `${PLUGIN}: page styles`);
  ctx.effect(() => injectStyles(`${PLUGIN}/cards.css`, CARD_CSS), `${PLUGIN}: card styles`);
  ctx.effect(() => toDisposer(ctx.locale.register(NS, { zh, en })), `${PLUGIN}: dictionaries`);
  const t = translator(ctx.locale.bind?.(NS));
  joinCards(ctx, t);
  joinPage(ctx, t);
  ctx.effect(() => followHostOpens(ctx), `${PLUGIN}: host.open`);
  joinUpdates(ctx as unknown as UpdateContext, PLUGIN);
}
