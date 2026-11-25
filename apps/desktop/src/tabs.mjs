/**
 * The tabs: one `WebContentsView` per artifact under the window's tab bar and beside its sidebar, each loading the
 * artifact's Shell (`harness.view(url)`: the daemon's `/a/<id>` with a one-time view ticket) and talking to it through
 * the daemon (`embedArtifact` with a transport). The first tab is the app's own home page (the window's own page draws
 * it); it has no view. While the window's page shows something over the views (the new-artifact dialog), the current
 * view is hidden (`setOverlay`): a view is drawn above the window's page, whatever the page draws.
 *
 * Each view: sandboxed, context-isolated, no Node, no preload, its own storage partition; hidden views are kept (not
 * destroyed), so switching back does not reload. The Shell is told the app has its own toolbar and its own way between
 * artifacts (`toolbar`, `switcher`), so it leaves out its close button and its library links; what still navigates
 * away (Duplicate, the doc's "Copy as…", a link to the daemon's home page) is caught in `will-navigate`
 * (`navigation.mjs`). The Shell's `close` closes the tab; its `saved` marks the tab while something is not saved.
 *
 * When the daemon goes away (stopped, restarted, replaced) the views stay as they are and the tabs say they are
 * reconnecting (or, when the person stopped the service here, that it is stopped). Once the kit is connected again, each tab whose page had nothing unsaved is loaded again with a new
 * view (the old ticket and the type server's port died with the old daemon), at the place it showed; a tab that had
 * unsaved work is left as it is, marked, for the person to reload when they choose (`reload`).
 */
import { WebContentsView, nativeTheme, session as electronSession } from 'electron';
import { embedArtifact } from '@open-artifact/harness-kit/embed';
import { artifactIdOf, decide, httpish, subframeAllowed } from './navigation.mjs';

export { artifactIdOf };

/** The views' own storage: nothing the window keeps (or a page sets) is shared with it. */
export const PARTITION = 'persist:open-artifact-pages';
/** The only permission a page gets: writing to the clipboard (and only on an allowed origin). */
const PERMISSIONS = new Set(['clipboard-sanitized-write']);
/** The app's own first tab: the home page. */
export const HOME_TAB = 'home';

const themeOf = () => ({ scheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' });
const artifactLink = (id) => `open-artifact://artifact/${id}`;
export class Tabs {
  /**
   * `window`: the BrowserWindow; `harness`: the kit's connection; `allowlist`: an `OriginAllowlist`; `topInset()`: the
   * height of the window's own bar; `leftInset()`: the width of its sidebar (0 when collapsed); `onChange()`: the tabs
   * changed (the window redraws its bar); `openExternal(url)`; `log(line)`; `testMode`.
   */
  constructor({ window, harness, allowlist, topInset, leftInset = () => 0, onChange, openExternal, log, testMode = false }) {
    Object.assign(this, { window, harness, allowlist, topInset, leftInset, onChange, openExternal, log, testMode });
    /** The window's page draws over the views: the current one is hidden. */
    this.overlay = false;
    /** Artifact id → tab. */
    this.tabs = new Map();
    this.current = HOME_TAB;
    this.connected = harness.connected;
    this.guardSession(electronSession.fromPartition(PARTITION));
    nativeTheme.on('updated', () => {
      for (const tab of this.tabs.values()) tab.embed?.setTheme(themeOf());
    });
    window.on('resize', () => this.layout());
  }

  /** Permissions for every page in the partition: only clipboard writes, only from an allowed origin. */
  guardSession(ses) {
    const allowed = (permission, origin) => PERMISSIONS.has(permission) && !!origin && this.allowlist.allows(origin);
    ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
      const ok = allowed(permission, details?.requestingUrl);
      if (!ok) this.log(`permission denied: ${permission} for ${details?.requestingUrl ?? '?'}`);
      callback(ok);
    });
    ses.setPermissionCheckHandler((_contents, permission, origin) => allowed(permission, origin));
    ses.setDevicePermissionHandler(() => false);
  }

  /** What the window's bar shows. */
  snapshot() {
    return {
      current: this.current,
      connected: this.connected,
      tabs: [...this.tabs.values()].map((tab) => ({
        id: tab.id,
        title: tab.title || tab.id,
        type: tab.type ?? '',
        unsaved: tab.saved ? tab.saved.leaveLosesWork || tab.saved.state === 'unsaved' || tab.saved.state === 'saving' : false,
        saved: tab.saved?.state ?? null,
        status: tab.status,
      })),
    };
  }

  changed() {
    this.onChange?.(this.snapshot());
  }

  /** Opens an artifact in a tab (or goes to its tab). `ref`: an id, `open-artifact://artifact/<id>` or a Shell address. */
  async open(ref) {
    const id = artifactIdOf(ref);
    if (!id) throw new Error(`not an artifact: ${ref}`);
    const known = this.tabs.get(id);
    if (known) {
      this.select(id);
      return id;
    }
    const tab = { id, title: '', type: '', saved: null, status: 'opening', view: null, embed: null, ticket: null, place: null, discard: false };
    this.tabs.set(id, tab);
    this.current = id;
    this.changed();
    try {
      await this.load(tab);
    } catch (error) {
      this.tabs.delete(id);
      if (this.current === id) this.current = HOME_TAB;
      this.layout();
      this.changed();
      throw error;
    }
    return id;
  }

  /** Asks the daemon for a view of the tab's artifact and loads it (into the tab's view, made on first use). */
  async load(tab) {
    const request = await this.harness.view(artifactLink(tab.id));
    if (!request.view) throw new Error('the daemon gave no view ticket (caps.open.embed must be "view")');
    if (!httpish(request.embedUrl) || !this.allowlist.allows(request.embedUrl)) throw new Error(`the page address is not allowed: ${request.embedUrl}`);
    tab.title = request.title ?? tab.title;
    tab.ticket = request.view;
    if (!tab.view) {
      tab.view = new WebContentsView({
        webPreferences: {
          partition: PARTITION,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          nodeIntegrationInWorker: false,
          webviewTag: false,
          // A test window is never shown: keep its pages drawing and their timers running.
          backgroundThrottling: !this.testMode,
        },
      });
      this.guardNavigation(tab);
      this.window.contentView.addChildView(tab.view);
    }
    tab.embed?.destroy();
    tab.embed = embedArtifact(this.transport(request.view), {
      url: request.embedUrl,
      harness: 'open-artifact-desktop',
      toolbar: true,
      switcher: true,
      theme: themeOf(),
      onReady: () => {
        tab.status = 'ready';
        this.changed();
      },
      onPlace: ({ hash }) => {
        tab.place = hash;
      },
      onSaved: (saved) => {
        tab.saved = saved;
        this.changed();
      },
      onClose: () => void this.close(tab.id),
      onOpenExternal: (url) => this.external(url),
      // A window that is not on screen (test mode, minimized) has nothing to capture.
      capture: async () =>
        tab.view && !tab.view.webContents.isDestroyed() && this.window.isVisible() && this.current === tab.id ? (await tab.view.webContents.capturePage()).toJPEG(70) : null,
      saveThumbnail: (jpeg, artifact) => this.harness.saveThumbnail(artifact, jpeg),
      onError: (error) => this.log(`tab ${tab.id}: ${error?.message ?? error}`),
    });
    tab.status = 'loading';
    this.layout();
    this.changed();
    const target = tab.place ? `${request.embedUrl.replace(/#.*$/, '')}${tab.place.startsWith('#') ? tab.place : `#${tab.place}`}` : request.embedUrl;
    await tab.view.webContents.loadURL(target);
  }

  /** Host messages to one view's Shell, through the daemon: the view's ticket names it. */
  transport(ticket) {
    return {
      send: (command) => this.harness.shellCommand(ticket, command),
      onEvent: (listener) => this.harness.on('shell', (event) => event.view === ticket && listener(event.event)),
    };
  }

  /** Navigation in a tab's view: see `navigation.mjs`. New windows are never opened. */
  guardNavigation(tab) {
    const contents = tab.view.webContents;
    const onTop = (event, legacyUrl) => {
      const url = event.url ?? legacyUrl;
      const verdict = decide(url, { allowlist: this.allowlist, current: tab.id });
      if (verdict.action === 'allow') return;
      event.preventDefault();
      if (verdict.action === 'open-tab') {
        this.log(`navigation to ${verdict.id} opens a tab`);
        void this.open(verdict.id).catch((error) => this.log(`open ${verdict.id}: ${error?.message ?? error}`));
      } else if (verdict.action === 'home') {
        this.log('navigation to the home page goes to the first tab');
        this.select(HOME_TAB);
      } else if (verdict.action === 'external') {
        this.external(verdict.url);
      } else {
        this.log(`blocked navigation to ${url}`);
      }
    };
    contents.on('will-navigate', onTop);
    contents.on('will-redirect', (event, legacyUrl) => {
      if (event.isMainFrame === false) return;
      onTop(event, legacyUrl);
    });
    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) return;
      if (subframeAllowed(event.url, this.allowlist)) return;
      event.preventDefault();
      this.log(`blocked frame navigation to ${event.url}`);
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (httpish(url) && !this.allowlist.allows(url)) this.external(url);
      else this.log(`blocked new window for ${url}`);
      return { action: 'deny' };
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    // A page with unsaved work asks to stay (`beforeunload`): it stays, unless the person asked to load it again.
    contents.on('will-prevent-unload', (event) => {
      if (!tab.discard) return this.log(`tab ${tab.id}: the page kept itself (unsaved work)`);
      event.preventDefault();
      this.log(`tab ${tab.id}: unsaved work let go for the reload asked for`);
    });
    contents.on('did-finish-load', () => {
      const title = contents.getTitle();
      if (title && !tab.title) tab.title = title;
      this.changed();
    });
    contents.on('render-process-gone', (_event, details) => {
      tab.status = 'crashed';
      this.log(`tab ${tab.id}: renderer gone (${details.reason})`);
      this.changed();
    });
  }

  external(url) {
    if (!httpish(url)) return this.log(`blocked link out to ${url}`);
    this.openExternal(url);
  }

  /** What the library says of an open tab's artifact now (renamed, its type). */
  setInfo(id, { title, type } = {}) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    if (typeof title === 'string' && title) tab.title = title;
    if (typeof type === 'string' && type) tab.type = type;
    this.changed();
    return true;
  }

  /** The window's page draws over the views (a dialog), or stops. */
  setOverlay(on) {
    this.overlay = !!on;
    this.layout();
  }

  select(id) {
    if (id !== HOME_TAB && !this.tabs.has(id)) return false;
    this.current = id;
    this.layout();
    this.changed();
    return true;
  }

  /** Closes a tab (the Shell's `close`, or the bar's close button). */
  async close(id) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    const order = [...this.tabs.keys()];
    const at = order.indexOf(id);
    this.tabs.delete(id);
    tab.embed?.destroy();
    if (tab.view) {
      this.window.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    if (this.current === id) {
      const rest = [...this.tabs.keys()];
      this.current = rest[Math.min(at, rest.length - 1)] ?? HOME_TAB;
    }
    this.layout();
    this.changed();
    return true;
  }

  /** The visible tab's view under the bar and beside the sidebar; the others hidden (kept). Returns its bounds (or null). */
  layout() {
    if (this.window.isDestroyed()) return null;
    let placed = null;
    const { width, height } = this.window.getContentBounds();
    const top = this.topInset();
    const left = Math.min(width, this.leftInset());
    for (const tab of this.tabs.values()) {
      if (!tab.view) continue;
      const shown = tab.id === this.current && !this.overlay;
      tab.view.setVisible(shown);
      if (shown) {
        placed = { x: left, y: top, width: Math.max(0, width - left), height: Math.max(0, height - top) };
        tab.view.setBounds(placed);
      }
    }
    return placed;
  }

  /**
   * The connection went down or came back. `stopped`: the person stopped the service, so the tabs wait for it to be
   * started rather than say they are reconnecting.
   */
  setConnected(connected, { stopped = false } = {}) {
    const was = this.connected;
    this.connected = connected;
    if (!connected) {
      for (const tab of this.tabs.values()) if (tab.status !== 'crashed') tab.status = stopped ? 'stopped' : 'reconnecting';
      this.changed();
      return;
    }
    if (was) return this.changed();
    for (const tab of this.tabs.values()) {
      // Something was not saved when the daemon went away: leave the page as it is, for the person to decide.
      const unsaved = tab.saved && (tab.saved.leaveLosesWork || tab.saved.state === 'unsaved' || tab.saved.state === 'saving');
      if (unsaved) {
        tab.status = 'stale';
        this.log(`tab ${tab.id}: kept as it was (it had unsaved work when the daemon went away)`);
        continue;
      }
      void this.reload(tab.id);
    }
    this.changed();
  }

  /**
   * Loads a tab's artifact again with a new view (after the daemon came back). `discard`: the person asked for it (the
   * tab's Reload), so a page that holds unsaved work (its Shell's `beforeunload`) is let go: that work could not be
   * saved any more, its view's channel went with the old daemon.
   */
  async reload(id, { discard = false } = {}) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    tab.discard = discard;
    try {
      await this.load(tab);
      this.log(`tab ${id}: loaded again`);
      return true;
    } catch (error) {
      tab.status = 'stale';
      this.log(`tab ${id}: could not load again: ${error?.message ?? error}`);
      this.changed();
      return false;
    } finally {
      tab.discard = false;
    }
  }

  closeAll() {
    for (const tab of this.tabs.values()) {
      tab.embed?.destroy();
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
  }
}
