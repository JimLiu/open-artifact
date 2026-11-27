import type { Harness } from '@open-artifact/harness-kit';
import type { EmbeddedArtifact, EmbedSavedState } from '@open-artifact/harness-kit/embed';
import type { BrowserWindow, Session, WebContentsView } from 'electron';
import { errorInfo } from './errors.ts';
import type { OriginAllowlist } from './navigation.ts';
import type { Log, MaybePromise } from './types.ts';
export type TabStatus = 'opening' | 'loading' | 'ready' | 'offline' | 'crashed' | 'stale' | 'missing' | 'reconnecting' | 'stopped';
export interface ArtifactTab {
  id: string;
  title: string;
  type: string;
  kind: 'local' | 'server' | 'site';
  server: string | null;
  saved: EmbedSavedState | null;
  status: TabStatus;
  view: WebContentsView | null;
  embed: EmbeddedArtifact | null;
  ticket: string | null;
  place: string | null;
  discard: boolean;
  closing: boolean;
  missing?: string | null;
  failed?: boolean;
}
export interface TabsOptions {
  window: BrowserWindow;
  harness: Harness;
  allowlist: OriginAllowlist;
  topInset: () => number;
  leftInset?: () => number;
  onChange?: (snapshot: TabsSnapshot) => void;
  openExternal: (url: string) => void;
  onSavedFile?: (path: string, id: string) => void;
  requestClose?: ((id: string) => MaybePromise<unknown>) | null;
  folderGone?: (id: string) => Promise<string | null>;
  log: Log;
  testMode?: boolean;
}
export type TabsSnapshot = ReturnType<Tabs['snapshot']>;
export type TabSnapshot = TabsSnapshot['tabs'][number];
/**
 * The tabs: one `WebContentsView` per artifact under the window's tab bar and beside its sidebar, each loading the
 * artifact's Shell (`harness.view(url)`: the daemon's `/a/<id>` with a one-time view ticket) and talking to it through
 * the daemon (`embedArtifact` with a transport; the view, its guards and its Shell's channel are `artifact-view.ts`'s,
 * shared with the single-artifact window). The first tab is the app's own home page (the window's own page draws
 * it); it has no view. While the window's page shows something over the views (the new-artifact dialog), the current
 * view is hidden (`setOverlay`): a view is drawn above the window's page, whatever the page draws.
 *
 * Each view: sandboxed, context-isolated, no Node, no preload, its own storage partition; hidden views are kept (not
 * destroyed), so switching back does not reload. The Shell is told the app has its own toolbar and its own way between
 * artifacts (`toolbar`, `switcher`), so it leaves out its close button and its library links; what still navigates
 * away (Duplicate, the doc's "Copy as…", a link to the daemon's home page) is caught in `will-navigate`
 * (`navigation.ts`). The Shell's `close` closes the tab; its `saved` marks the tab while something is not saved.
 *
 * When the daemon goes away (stopped, restarted, replaced) the views stay as they are and the tabs say they are
 * reconnecting (or, when the person stopped the service here, that it is stopped). Once the kit is connected again, each tab whose page had nothing unsaved is loaded again with a new
 * view (the old ticket and the type server's port died with the old daemon), at the place it showed; a tab that had
 * unsaved work is left as it is, marked, for the person to reload when they choose (`reload`).
 *
 * Closing a tab the person asks for (the bar's close, ⌘W, the Shell's `close`) goes to `requestClose`, which the main
 * process gives: it waits for unsaved work to be saved and asks before letting it go. `close` itself closes at once.
 *
 * An artifact whose folder is gone (moved or renamed outside Open Artifact: the daemon's `folderMissing`) gets a tab
 * with no view (`status: 'missing'`, `missing`: the folder the library still names); the window's page draws what to
 * do about it. Its Shell is never loaded: the daemon would show it as an empty artifact to start again.
 *
 * A published artifact is edited on its site: the daemon answers its `/a/<id>` with a redirect to the site while the
 * site can be reached. Such a redirect of a tab's view (to one of the sites in `remotes`, `allowlist.serverOf`) is
 * not followed in the local view: the tab gets a view of the servers' partition ({@link SERVER_PARTITION}: no preload,
 * no daemon channel, never the daemon's token; what the site's sign-in leaves stays there) loading that address
 * (`kind: 'server'`). The site's Shell does not take this app's host messages, so such a tab has no saved state and no
 * place, its title is the library's, and closing it asks nothing. When the site cannot be reached any more (the
 * page failed to load, or the servers' list says so: `serversChanged`), the same tab loads the artifact's local Shell
 * again (the working copy, editable); it stays there once the site is back, the daemon syncing what changed.
 * A site's own home page opens in a tab of that partition too (`openSite`, `kind: 'site'`, id `site:<name>`).
 */
import { session as electronSession, nativeTheme } from 'electron';
import {
  connectShell,
  guardArtifactNavigation,
  guardSession,
  guardSiteNavigation,
  makeView,
  PARTITION,
  requestView,
  SERVER_PARTITION,
  themeOf,
  unsavedOf,
  viewTarget,
} from './artifact-view.ts';
import { artifactIdOf } from './navigation.ts';

export { artifactIdOf, PARTITION, SERVER_PARTITION, unsavedOf };

/** A site's home page tab: `site:<remote name>`. */
export const SITE_TAB = /^site:([a-z0-9][a-z0-9_-]{0,31})$/i;
/** The app's own first tab: the home page. */
export const HOME_TAB = 'home';
export class Tabs {
  window: BrowserWindow;
  harness: Harness;
  allowlist: OriginAllowlist;
  topInset: () => number;
  leftInset: () => number;
  onChange: TabsOptions['onChange'];
  openExternal: TabsOptions['openExternal'];
  onSavedFile: NonNullable<TabsOptions['onSavedFile']>;
  folderGone: NonNullable<TabsOptions['folderGone']>;
  log: Log;
  testMode: boolean;
  requestClose: NonNullable<TabsOptions['requestClose']>;
  overlay = false;
  /** Test mode only (`test:fail-next-load`): the next artifact load fails after its view is in the window. */
  failNextLoad = false;
  tabs = new Map<string, ArtifactTab>();
  current: string = HOME_TAB;
  connected: boolean;
  onServerFailed?: (origin: string | null) => void;
  /**
   * `window`: the BrowserWindow; `harness`: the kit's connection; `allowlist`: an `OriginAllowlist`; `topInset()`: the
   * height of the window's own bar; `leftInset()`: the width of its sidebar (0 when collapsed); `onChange()`: the tabs
   * changed (the window redraws its bar); `openExternal(url)`; `onSavedFile(path, id)`: a page's server saved a file
   * (the Shell's `saved_file`); `requestClose(id)`: the Shell asked to close its tab (default: closed at once);
   * `folderGone(id)`: the folder the library names for an artifact whose folder is not there, else null; `log(line)`;
   * `testMode`.
   */
  constructor({
    window,
    harness,
    allowlist,
    topInset,
    leftInset = () => 0,
    onChange,
    openExternal,
    onSavedFile = () => {},
    requestClose = null,
    folderGone = async () => null,
    log,
    testMode = false,
  }: TabsOptions) {
    this.window = window;
    this.harness = harness;
    this.allowlist = allowlist;
    this.topInset = topInset;
    this.leftInset = leftInset;
    this.onChange = onChange;
    this.openExternal = openExternal;
    this.onSavedFile = onSavedFile;
    this.folderGone = folderGone;
    this.log = log;
    this.testMode = testMode;
    this.requestClose = requestClose ?? ((id) => this.close(id));
    /** The window's page draws over the views: the current one is hidden. */
    this.overlay = false;
    /** Artifact id → tab. */
    this.tabs = new Map();
    this.current = HOME_TAB;
    this.connected = harness.connected;
    this.guardSession(electronSession.fromPartition(PARTITION));
    this.guardSession(electronSession.fromPartition(SERVER_PARTITION), (origin) => !!this.allowlist.serverOf(origin));
    nativeTheme.on('updated', () => {
      for (const tab of this.tabs.values()) tab.embed?.setTheme(themeOf());
    });
    window.on('resize', () => this.layout());
  }

  /** Permissions for every page in the partition: only clipboard writes, only from an allowed origin (`allows`). */
  guardSession(ses: Session, allows: (origin: string) => boolean = (origin) => this.allowlist.allows(origin)) {
    guardSession(ses, allows, (line) => this.log(line));
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
        /** `local` (the artifact's Shell here), `server` (its page on a site) or `site` (a site's home page). */
        kind: tab.kind ?? 'local',
        /** The site's origin a `server` or `site` tab shows, else null. */
        server: tab.server ?? null,
        unsaved: unsavedOf(tab),
        saved: tab.saved?.state ?? null,
        status: tab.status,
        /** Waiting for its work to be saved before it closes (or the app quits). */
        closing: !!tab.closing,
        /** Its folder is gone: the folder the library still names. */
        missing: tab.missing ?? null,
      })),
    };
  }

  changed() {
    this.onChange?.(this.snapshot());
  }

  /** Opens an artifact in a tab (or goes to its tab). `ref`: an id, `open-artifact://artifact/<id>` or a Shell address. */
  async open(ref: string) {
    const id = artifactIdOf(ref);
    if (!id) throw new Error(`not an artifact: ${ref}`);
    const known = this.tabs.get(id);
    if (known) {
      this.select(id);
      return id;
    }
    const tab: ArtifactTab = {
      id,
      kind: 'local',
      server: null,
      title: '',
      type: '',
      saved: null,
      status: 'opening',
      view: null,
      embed: null,
      ticket: null,
      place: null,
      discard: false,
      closing: false,
      missing: null,
    };
    this.tabs.set(id, tab);
    this.current = id;
    this.changed();
    try {
      const gone = await this.folderGone(id);
      if (gone) {
        if (this.tabs.get(id) !== tab) return id;
        this.markMissing(tab, gone);
        return id;
      }
      await this.load(tab);
    } catch (error) {
      this.abandon(id);
      throw error;
    }
    return id;
  }

  /**
   * An open that did not finish: its view (made and put in the window by `load`, or `loadSite`) is closed too, or it
   * would stay drawn over the home page with nothing to lay it out, its Shell's channel still listening.
   */
  abandon(id: string) {
    const failed = this.tabs.get(id);
    if (failed) this.dropView(failed);
    this.tabs.delete(id);
    if (this.current === id) this.current = HOME_TAB;
    this.layout();
    this.changed();
  }

  /** Asks the daemon for a view of the tab's artifact and loads it (into the tab's view, made on first use). */
  async load(tab: ArtifactTab) {
    if (tab.kind === 'site') return this.loadSite(tab);
    const request = await requestView(this.harness, this.allowlist, tab.id);
    tab.title = request.title ?? tab.title;
    tab.ticket = request.view;
    // A tab that showed the site's page: back to a local view (the daemon redirects again while the site is there).
    if (tab.view && tab.kind !== 'local') this.dropView(tab);
    tab.kind = 'local';
    tab.server = null;
    if (!tab.view) {
      tab.view = this.makeView(PARTITION);
      this.guardNavigation(tab);
      this.window.contentView.addChildView(tab.view);
    }
    tab.embed?.destroy();
    tab.embed = connectShell({
      harness: this.harness,
      ticket: request.view,
      url: request.embedUrl,
      harnessName: 'open-artifact-desktop',
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
      onClose: () =>
        void Promise.resolve(this.requestClose(tab.id)).catch((error: unknown) => this.log(`close ${tab.id}: ${errorInfo(error).message ?? error}`)),
      onOpenExternal: (url) => this.external(url),
      onSavedFile: (path) => this.onSavedFile(path, tab.id),
      // A window that is not on screen (test mode, minimized) has nothing to capture.
      capture: async () =>
        tab.view && !tab.view.webContents.isDestroyed() && this.window.isVisible() && this.current === tab.id
          ? (await tab.view.webContents.capturePage()).toJPEG(70)
          : null,
      saveThumbnail: (jpeg, artifact) => this.harness.saveThumbnail(artifact, jpeg),
      onError: (error) => this.log(`tab ${tab.id}: ${errorInfo(error).message ?? error}`),
    });
    tab.status = 'loading';
    this.layout();
    this.changed();
    const target = viewTarget(request.embedUrl, tab.place);
    const contents = tab.view!.webContents;
    // Test mode can make this one load fail (`failNextLoad`), after the view is in the window: what a page that does
    // not load leaves behind is what `open` has to clean up.
    const loading = this.failNextLoad ? Promise.reject(new Error('the page did not load (test)')) : contents.loadURL(target);
    this.failNextLoad = false;
    await loading.catch((error: unknown) => {
      // The daemon redirected it to the artifact's site: the tab went to a view of the servers' partition.
      if (tab.kind === 'server' || tab.view?.webContents !== contents) return;
      throw error;
    });
  }

  /** A sandboxed view with no Node and no preload, in `partition`. */
  makeView(partition: string) {
    return makeView(partition, { testMode: this.testMode });
  }

  /** Lets go of a tab's view (and its Shell's channel). */
  dropView(tab: ArtifactTab) {
    tab.embed?.destroy();
    tab.embed = null;
    if (tab.view) {
      this.window.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      tab.view = null;
    }
  }

  /**
   * The daemon sent a tab's view to the artifact's page on a site (`origin`): the tab shows `url` in a view of the
   * servers' partition instead, with no saved state and no place (the site's Shell does not take this app's messages).
   */
  async toServer(tab: ArtifactTab, url: string, origin: string) {
    if (this.tabs.get(tab.id) !== tab) return;
    this.dropView(tab);
    Object.assign(tab, { kind: 'server', server: origin, saved: null, place: null, ticket: null, status: 'loading', failed: false });
    tab.view = this.makeView(SERVER_PARTITION);
    this.guardServerNavigation(tab);
    this.window.contentView.addChildView(tab.view);
    this.log(`tab ${tab.id}: shown on its site ${origin}`);
    this.layout();
    this.changed();
    await tab.view.webContents.loadURL(url).catch((error: unknown) => this.log(`tab ${tab.id}: ${errorInfo(error).message ?? error}`));
  }

  /** A site's home page in a tab (or its tab): `name` (the remote's), `origin` (its address). Returns the tab's id. */
  async openSite(name: string, origin: string) {
    const id = `site:${name}`;
    if (!SITE_TAB.test(id)) throw new Error(`not a site: ${name}`);
    if (!this.allowlist.serverOf(origin)) throw new Error(`not a site this computer is connected to: ${origin}`);
    const known = this.tabs.get(id);
    if (known) {
      this.select(id);
      return id;
    }
    const tab: ArtifactTab = {
      id,
      kind: 'site',
      server: new URL(origin).origin,
      title: name,
      type: '',
      saved: null,
      status: 'opening',
      view: null,
      embed: null,
      ticket: null,
      place: null,
      discard: false,
      closing: false,
      missing: null,
    };
    this.tabs.set(id, tab);
    this.current = id;
    this.changed();
    try {
      await this.loadSite(tab);
    } catch (error) {
      this.abandon(id);
      throw error;
    }
    return id;
  }

  async loadSite(tab: ArtifactTab) {
    if (!this.allowlist.serverOf(tab.server)) {
      tab.status = 'stale';
      this.changed();
      throw new Error(`not a site this computer is connected to: ${tab.server}`);
    }
    if (!tab.view) {
      tab.view = this.makeView(SERVER_PARTITION);
      this.guardServerNavigation(tab);
      this.window.contentView.addChildView(tab.view);
    }
    tab.status = 'loading';
    this.layout();
    this.changed();
    await tab.view.webContents.loadURL(`${tab.server}/`).catch((error: unknown) => this.log(`tab ${tab.id}: ${errorInfo(error).message ?? error}`));
  }

  /** Navigation in a view of a site's page: see `navigation.mjs` (`decideServer`). New windows are never opened. */
  guardServerNavigation(tab: ArtifactTab) {
    const contents = tab.view!.webContents;
    guardSiteNavigation(contents, {
      allowlist: this.allowlist,
      live: () => tab.view?.webContents === contents,
      onLocal: (id) => {
        // The site's page went back to this computer's Shell: the site cannot be reached, or the artifact is local.
        if (id === tab.id && tab.kind === 'server') return void this.toLocal(tab, 'the site sent it back here');
        void this.open(id).catch((error: unknown) => this.log(`open ${id}: ${errorInfo(error).message ?? error}`));
      },
      onHome: () => this.select(HOME_TAB),
      external: (url: string) => this.external(url),
      onLoaded: () => {
        tab.status = 'ready';
        tab.failed = false;
        if (tab.kind === 'site' && !tab.title) tab.title = contents.getTitle();
        this.changed();
      },
      onFailed: (description, address) => {
        this.log(`tab ${tab.id}: the site's page did not load (${description}) ${address}`);
        tab.failed = true;
        tab.status = 'offline';
        this.changed();
        this.onServerFailed?.(tab.server);
      },
      onGone: (reason) => {
        tab.status = 'crashed';
        this.log(`tab ${tab.id}: renderer gone (${reason})`);
        this.changed();
      },
      log: (line) => this.log(line),
    });
  }

  /** A tab of a site's page loads the artifact's local Shell again (the working copy). */
  async toLocal(tab: ArtifactTab, why: string) {
    if (this.tabs.get(tab.id) !== tab || tab.kind !== 'server') return;
    this.log(`tab ${tab.id}: the local working copy (${why})`);
    this.dropView(tab);
    tab.kind = 'local';
    tab.server = null;
    tab.status = 'opening';
    this.changed();
    try {
      await this.load(tab);
    } catch (error) {
      tab.status = 'stale';
      this.log(`tab ${tab.id}: could not load the working copy: ${errorInfo(error).message ?? error}`);
      this.changed();
    }
  }

  /**
   * The servers' list changed (`reachable` by origin): a tab on a site that cannot be reached shows the working copy;
   * a site tab whose site is no longer in the list closes.
   */
  serversChanged(reachable: ReadonlyMap<string, boolean>) {
    for (const tab of [...this.tabs.values()]) {
      if (!tab.server) continue;
      const known = reachable.has(tab.server);
      if (tab.kind === 'site' && !known) {
        this.log(`tab ${tab.id}: the site was removed`);
        void this.close(tab.id);
      } else if (tab.kind === 'server' && (!known || reachable.get(tab.server) === false)) {
        void this.toLocal(tab, known ? 'the site cannot be reached' : 'the site was removed');
      }
    }
  }

  /** An open local tab of an artifact that is now published (and its site reachable): loaded again, to the site. */
  async followPublished(id: string) {
    const tab = this.tabs.get(id);
    if (!tab || tab.kind !== 'local' || tab.status === 'missing' || unsavedOf(tab)) return false;
    this.log(`tab ${id}: published, loaded again`);
    return this.reload(id);
  }

  /** Navigation in a tab's view: see `navigation.mjs`. New windows are never opened. */
  guardNavigation(tab: ArtifactTab) {
    const contents = tab.view!.webContents;
    guardArtifactNavigation(contents, {
      allowlist: this.allowlist,
      id: () => tab.id,
      live: () => tab.view?.webContents === contents,
      onOther: (id) => {
        this.log(`navigation to ${id} opens a tab`);
        void this.open(id).catch((error: unknown) => this.log(`open ${id}: ${errorInfo(error).message ?? error}`));
      },
      onHome: () => {
        this.log('navigation to the home page goes to the first tab');
        this.select(HOME_TAB);
      },
      // The daemon's redirect of a published artifact to its site: shown in a view of the servers' partition.
      onServer: (url, origin) => void this.toServer(tab, url, origin),
      external: (url: string) => this.external(url),
      discard: () => tab.discard,
      label: () => `tab ${tab.id}`,
      onLoaded: (title) => {
        if (title && !tab.title) tab.title = title;
        this.changed();
      },
      onGone: (reason) => {
        tab.status = 'crashed';
        this.log(`tab ${tab.id}: renderer gone (${reason})`);
        this.changed();
      },
      log: (line) => this.log(line),
    });
  }

  external(url: string) {
    this.openExternal(url);
  }

  /** What the library says of an open tab's artifact now (renamed, its type). */
  setInfo(id: string, { title, type }: { title?: string; type?: string } = {}) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    if (typeof title === 'string' && title) tab.title = title;
    if (typeof type === 'string' && type) tab.type = type;
    this.changed();
    return true;
  }

  /** A tab's artifact has no folder (at `root`, where the library had it): no view, the window's page says so. */
  markMissing(tab: ArtifactTab, root: string) {
    tab.status = 'missing';
    tab.missing = root;
    tab.saved = null;
    tab.embed?.destroy();
    tab.embed = null;
    if (tab.view) {
      this.window.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      tab.view = null;
    }
    this.log(`tab ${tab.id}: its folder is gone (${root})`);
    this.layout();
    this.changed();
  }

  /** The folder of a tab marked missing is known again (relocated): its Shell is loaded. */
  async found(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    tab.missing = null;
    tab.status = 'opening';
    this.changed();
    try {
      await this.load(tab);
      return true;
    } catch (error) {
      tab.status = 'stale';
      this.log(`tab ${id}: could not load: ${errorInfo(error).message ?? error}`);
      this.changed();
      return false;
    }
  }

  /** Waiting for a tab's work to be saved before it closes: its bar says so. */
  setClosing(id: string, on: boolean) {
    const tab = this.tabs.get(id);
    if (!tab || tab.closing === !!on) return;
    tab.closing = !!on;
    this.changed();
  }

  /** Test mode only: what the tab's Shell said of its saving, set by a test (`{ state, leaveLosesWork }`). */
  setSaved(id: string, saved: EmbedSavedState | null) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    tab.saved = saved;
    this.log(`tab ${id}: saved set by the test to ${JSON.stringify(saved)}`);
    this.changed();
    return true;
  }

  /** The view of the tab in front (null on the home page). */
  currentView() {
    const tab = this.tabs.get(this.current);
    return tab?.view && !tab.view.webContents.isDestroyed() ? tab.view : null;
  }

  /** The tab next to the current one (`step` 1 or -1), the home page counted first; wraps around. */
  neighbour(step: number) {
    const order = [HOME_TAB, ...this.tabs.keys()];
    const at = Math.max(0, order.indexOf(this.current));
    return order[(at + step + order.length) % order.length];
  }

  /**
   * The window's page draws over the views (a dialog), or stops. Hiding the view does not move keyboard focus: the
   * window's page takes it while the dialog is up, and the tab in front takes it back.
   */
  setOverlay(on: boolean) {
    const next = !!on;
    const flipped = next !== this.overlay;
    this.overlay = next;
    this.layout();
    if (!flipped || this.window.isDestroyed()) return;
    if (next) {
      this.log('overlay: focus window');
      this.window.webContents.focus();
    } else if (this.current !== HOME_TAB) {
      const view = this.currentView();
      if (view) {
        this.log(`overlay: focus tab ${this.current}`);
        view.webContents.focus();
      }
    }
    this.changed();
  }

  select(id: string) {
    if (id !== HOME_TAB && !this.tabs.has(id)) return false;
    this.current = id;
    this.layout();
    this.changed();
    return true;
  }

  /** Puts a tab at `index` among the artifact tabs (the home page not counted): the bar's drag and Move keys. */
  move(id: string, index: number) {
    if (!this.tabs.has(id) || !Number.isInteger(index)) return false;
    const order = [...this.tabs.entries()];
    const from = order.findIndex(([key]) => key === id);
    const to = Math.max(0, Math.min(order.length - 1, index));
    if (from === to) return true;
    const [entry] = order.splice(from, 1);
    order.splice(to, 0, entry);
    this.tabs = new Map(order);
    this.changed();
    return true;
  }

  /** Closes a tab (the Shell's `close`, or the bar's close button). */
  async close(id: string) {
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
    let placed: Electron.Rectangle | null = null;
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
  setConnected(connected: boolean, { stopped = false } = {}) {
    const was = this.connected;
    this.connected = connected;
    if (!connected) {
      // A site's home page does not need this computer's daemon.
      for (const tab of this.tabs.values())
        if (tab.status !== 'crashed' && tab.status !== 'missing' && tab.kind !== 'site') tab.status = stopped ? 'stopped' : 'reconnecting';
      this.changed();
      return;
    }
    if (was) return this.changed();
    for (const tab of this.tabs.values()) {
      // No folder: nothing to load; the person relocates it (or removes it) from the tab. A site's page: not this daemon's.
      if (tab.status === 'missing' || tab.kind === 'site') continue;
      // Something was not saved when the daemon went away: leave the page as it is, for the person to decide.
      if (unsavedOf(tab)) {
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
  async reload(id: string, { discard = false } = {}) {
    const tab = this.tabs.get(id);
    if (!tab || tab.status === 'missing') return false;
    tab.discard = discard;
    try {
      await this.load(tab);
      this.log(`tab ${id}: loaded again`);
      return true;
    } catch (error) {
      tab.status = 'stale';
      this.log(`tab ${id}: could not load again: ${errorInfo(error).message ?? error}`);
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
