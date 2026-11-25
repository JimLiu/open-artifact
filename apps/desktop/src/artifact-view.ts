import type { Harness } from '@open-artifact/harness-kit';
import type { EmbedArtifactOptions, EmbedSavedState, EmbedTransport, HostTheme } from '@open-artifact/harness-kit/embed';
import type { Session, WebContents } from 'electron';
import type { OriginAllowlist } from './navigation.ts';
import type { Log } from './types.ts';
export interface NavigationOptions {
  allowlist: OriginAllowlist;
  id: () => string;
  live: () => boolean;
  onOther: (id: string) => void;
  onHome: () => void;
  onServer: (url: string, origin: string) => void;
  external: (url: string) => void;
  discard: () => boolean;
  label: () => string;
  onLoaded: (title: string) => void;
  onGone: (reason: string) => void;
  log: Log;
}
export interface SiteNavigationOptions {
  allowlist: OriginAllowlist;
  live: () => boolean;
  onLocal: (id: string) => void;
  onHome: () => void;
  external: (url: string) => void;
  onLoaded: () => void;
  onFailed: (description: string | number, address: string) => void;
  onGone: (reason: string) => void;
  log: Log;
}
/**
 * One artifact's view, as both windows make it: the desktop app's tabs (`tabs.ts`) and the single-artifact window of
 * an artifact installed as an app (`artifact-window.ts`). What is here is the same for both, so the two never drift:
 *
 * - the partitions and their permissions (`guardSession`): only clipboard writes, only from an allowed origin;
 * - the view itself (`makeView`): sandboxed, context-isolated, no Node, no preload, its own partition;
 * - asking the daemon for a view of the artifact (`requestView`: `harness.view(link)`, a one-time ticket, an address
 *   the allowlist lets in) and talking to its Shell through the daemon (`connectShell`: `embedArtifact` with a
 *   transport, `toolbar` and `switcher` on: the host has its own close and its own way between artifacts);
 * - the guards of a view's navigation (`guardArtifactNavigation`, `guardSiteNavigation`), with what is the caller's
 *   (another artifact's Shell, the daemon's home page, a published artifact's redirect to its site) left to callbacks.
 *   The decisions themselves are `navigation.ts`'s.
 *
 * Electron only through the objects the caller passes (a view's `webContents`, a session) and `WebContentsView`.
 */
import { embedArtifact } from '@open-artifact/harness-kit/embed';
import { WebContentsView, nativeTheme } from 'electron';
import { decide, decideServer, httpish, serverSubframeAllowed, subframeAllowed } from './navigation.ts';

/** The views' own storage: nothing the window keeps (or a page sets) is shared with it. */
export const PARTITION = 'persist:open-artifact-pages';
/** The sites' pages (published artifacts, a site's home page): a partition of their own, apart from the local pages'. */
export const SERVER_PARTITION = 'persist:open-artifact-servers';
/** The only permission a page gets: writing to the clipboard (and only on an allowed origin). */
const PERMISSIONS = new Set(['clipboard-sanitized-write']);

/** The look the Shell is told (`host_hello`'s theme): the one Chromium draws with. */
export const themeOf = (): HostTheme => ({ scheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' });

/** Whether a view holds work that is not saved, as its Shell said (`saved`: null when it said nothing: not counted). */
export const unsavedOf = (tab: { saved?: EmbedSavedState | null } | null | undefined) =>
  !!tab?.saved && (tab.saved.leaveLosesWork === true || tab.saved.state === 'unsaved' || tab.saved.state === 'saving');

/** `open-artifact://artifact/<id>`. */
export const artifactLink = (id: string) => `open-artifact://artifact/${id}`;

/** Permissions for every page in a partition: only clipboard writes, only from an origin `allows` lets in. */
export function guardSession(ses: Session, allows: (origin: string) => boolean, log: Log) {
  const allowed = (permission: string, origin: string | undefined) => PERMISSIONS.has(permission) && !!origin && allows(origin);
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const ok = allowed(permission, details?.requestingUrl);
    if (!ok) log(`permission denied: ${permission} for ${details?.requestingUrl ?? '?'}`);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_contents, permission, origin) => allowed(permission, origin));
  ses.setDevicePermissionHandler(() => false);
}

/** A sandboxed view with no Node and no preload, in `partition`. `testMode`: its pages keep drawing while hidden. */
export function makeView(partition: string, { testMode = false } = {}) {
  return new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      // A test window is never shown: keep its pages drawing and their timers running.
      backgroundThrottling: !testMode,
    },
  });
}

/**
 * The daemon's view of artifact `id` (`view.open`): `{ view, embedUrl, title, … }`. Throws when the daemon gave no
 * ticket (the harness must say `embed: 'view'`) or an address the allowlist does not let in.
 */
export async function requestView(harness: Harness, allowlist: OriginAllowlist, id: string) {
  const request = await harness.view(artifactLink(id));
  if (!request.view) throw new Error('the daemon gave no view ticket (caps.open.embed must be "view")');
  if (!httpish(request.embedUrl) || !allowlist.allows(request.embedUrl)) throw new Error(`the page address is not allowed: ${request.embedUrl}`);
  return { ...request, view: request.view, embedUrl: request.embedUrl };
}

/** The address a view loads: the Shell's, at the place it last showed (`place`: a fragment), when there is one. */
export const viewTarget = (embedUrl: string, place: string | null) =>
  place ? `${embedUrl.replace(/#.*$/, '')}${place.startsWith('#') ? place : `#${place}`}` : embedUrl;

/** Host messages to one view's Shell, through the daemon: the view's ticket names it. */
export function shellTransport(harness: Harness, ticket: string): EmbedTransport {
  return {
    send: (command) => harness.shellCommand(ticket, command),
    onEvent: (listener) => harness.on('shell', (event) => event.view === ticket && listener(event.event)),
  };
}

/**
 * The channel to a view's Shell (`embedArtifact` over the daemon): `harness`, `ticket` and `url` from `requestView`;
 * `harnessName`: the harness the Shell is told the host is; the callbacks are `embedArtifact`'s. The host draws its
 * own close (`toolbar`) and has its own way between artifacts (`switcher`: no "Switch artifact", no "All artifacts").
 */
export function connectShell({
  harness,
  ticket,
  url,
  harnessName,
  ...callbacks
}: { harness: Harness; ticket: string; url: string; harnessName: string } & Omit<EmbedArtifactOptions, 'url' | 'harness'>) {
  return embedArtifact(shellTransport(harness, ticket), {
    url,
    harness: harnessName,
    toolbar: true,
    switcher: true,
    theme: themeOf(),
    ...callbacks,
  });
}

/**
 * The guards of a view of an artifact's local Shell (see `navigation.ts`, `decide`). New windows are never opened.
 *
 * `contents`: the view's; `allowlist`; `id()`: the artifact it shows; `live()`: the view is still the one shown
 * (a redirect of one let go is ignored); `onOther(id)`: another artifact's Shell; `onHome()`: the daemon's home page;
 * `onServer(url, origin)`: the daemon redirected it to the artifact's site (`allowlist.serverOf`); `external(url)`;
 * `discard()`: a page with unsaved work that asks to stay is let go (the person asked to load it again); `label`:
 * how the log names the view; `onLoaded(title)`, `onGone(reason)`; `log(line)`.
 */
export function guardArtifactNavigation(
  contents: WebContents,
  { allowlist, id, live, onOther, onHome, onServer, external, discard, label, onLoaded, onGone, log }: NavigationOptions,
) {
  const onTop = (event: Electron.Event & { url?: string }, legacyUrl: string) => {
    const url = event.url ?? legacyUrl;
    const verdict = decide(url, { allowlist, current: id() });
    if (verdict.action === 'allow') return;
    event.preventDefault();
    if (verdict.action === 'open-tab') onOther(verdict.id);
    else if (verdict.action === 'home') onHome();
    else if (verdict.action === 'external') external(verdict.url);
    else log(`blocked navigation to ${url}`);
  };
  contents.on('will-navigate', onTop);
  contents.on('will-redirect', (event, legacyUrl) => {
    if (event.isMainFrame === false) return;
    // The daemon's redirect of a published artifact to its site: the caller's.
    const url = event.url ?? legacyUrl;
    const origin = allowlist.serverOf(url);
    if (origin && live()) {
      event.preventDefault();
      onServer(url, origin);
      return;
    }
    onTop(event, legacyUrl);
  });
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    if (subframeAllowed(event.url, allowlist)) return;
    event.preventDefault();
    log(`blocked frame navigation to ${event.url}`);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (httpish(url) && !allowlist.allows(url)) external(url);
    else log(`blocked new window for ${url}`);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // A page with unsaved work asks to stay (`beforeunload`): it stays, unless the person asked to load it again.
  contents.on('will-prevent-unload', (event) => {
    if (!discard()) return log(`${label()}: the page kept itself (unsaved work)`);
    event.preventDefault();
    log(`${label()}: unsaved work let go for the reload asked for`);
  });
  contents.on('did-finish-load', () => onLoaded(contents.getTitle()));
  contents.on('render-process-gone', (_event, details) => onGone(details.reason));
}

/**
 * The guards of a view of a site's page (see `navigation.ts`, `decideServer`). New windows are never opened.
 * `onLocal(id)`: this computer's Shell of an artifact; `onHome()`; `external(url)`; `log(line)`; the load callbacks
 * `onLoaded()`, `onFailed(description, address)`, `onGone(reason)` (only for loads of `live()` views).
 */
export function guardSiteNavigation(
  contents: WebContents,
  { allowlist, live, onLocal, onHome, external, onLoaded, onFailed, onGone, log }: SiteNavigationOptions,
) {
  const onTop = (event: Electron.Event & { url?: string }, legacyUrl: string) => {
    const url = event.url ?? legacyUrl;
    const verdict = decideServer(url, { allowlist });
    if (verdict.action === 'allow') return;
    event.preventDefault();
    if (verdict.action === 'open-tab') onLocal(verdict.id);
    else if (verdict.action === 'home') onHome();
    else if (verdict.action === 'external') external(verdict.url);
    else log(`blocked navigation to ${url}`);
  };
  contents.on('will-navigate', onTop);
  contents.on('will-redirect', (event, legacyUrl) => {
    if (event.isMainFrame === false) return;
    onTop(event, legacyUrl);
  });
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    if (serverSubframeAllowed(event.url, allowlist)) return;
    event.preventDefault();
    log(`blocked frame navigation to ${event.url}`);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (httpish(url)) external(url);
    else log(`blocked new window for ${url}`);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('did-finish-load', () => {
    if (live()) onLoaded();
  });
  contents.on('did-fail-load', (_event, code, description, address, isMainFrame) => {
    // -3: aborted (a navigation this app stopped, or the next one started).
    if (!isMainFrame || code === -3 || !live()) return;
    onFailed(description || code, address);
  });
  contents.on('render-process-gone', (_event, details) => onGone(details.reason));
}
