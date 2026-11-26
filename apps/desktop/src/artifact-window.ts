import type { Harness } from '@open-artifact/harness-kit';
import type { EmbedSavedState } from '@open-artifact/harness-kit/embed';
import type { BrowserWindow } from 'electron';
import { errorInfo } from './errors.ts';
import type { OriginAllowlist } from './navigation.ts';
import type { ArtifactTab } from './tabs.ts';
import type { Log, MaybePromise } from './types.ts';
export type ArtifactProblem = { kind: 'not-found' | 'folder-missing' | 'needs-repair' | 'failed'; detail: string };
export interface ArtifactWindowOptions {
  window: BrowserWindow;
  harness: Harness | null;
  allowlist: OriginAllowlist;
  artifactId: string;
  harnessName: string;
  external: (url: string) => void;
  handOff: (what: 'artifact' | 'library', id?: string | null) => MaybePromise<unknown>;
  onSavedFile: (path: string) => void;
  requestClose: () => MaybePromise<unknown>;
  onChange?: (snapshot: ArtifactWindowSnapshot) => void;
  log: Log;
  testMode?: boolean;
}
export type ArtifactWindowSnapshot = ReturnType<ArtifactWindow['snapshot']>;
/**
 * The window of an artifact installed as an app (`artifact-app.ts`): one artifact, no sidebar, no tab bar, the
 * standard title bar with the artifact's title. Its own page (`renderer/artifact-app/`) is a status page under the
 * artifact's view: what is happening while there is no view to show (opening, reconnecting, why the artifact cannot be
 * shown) and the question about unsaved work. The view is made as the desktop app's tabs make theirs
 * (`artifact-view.ts`: sandboxed, its own partition, no preload, the origin allowlist, the same navigation guards, the
 * Shell told `toolbar` and `switcher`), and fills the window's content.
 *
 * What would leave this artifact (a link to another artifact, the daemon's home page, "All artifacts", Duplicate's new
 * artifact) is handed to the desktop app (`handOff(what, id)`), never shown here. A published artifact the daemon
 * redirects to its site is shown in a view of the sites' partition, as a desktop tab would.
 *
 * `status`: `opening`, `loading`, `ready`, `reconnecting`, `stopped`, `stale` (the daemon went away while something was
 * not saved: the page is kept as it is, for the person to reload), `crashed`, `problem` (`problem`: `{ kind, detail }`,
 * kinds `not-found`, `folder-missing`, `needs-repair`, `failed`).
 */
import { nativeTheme, session } from 'electron';
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

export class ArtifactWindow {
  window: BrowserWindow;
  harness: Harness | null;
  allowlist: OriginAllowlist;
  artifactId: string;
  harnessName: string;
  externalOut: ArtifactWindowOptions['external'];
  handOff: ArtifactWindowOptions['handOff'];
  onSavedFile: ArtifactWindowOptions['onSavedFile'];
  requestClose: ArtifactWindowOptions['requestClose'];
  onChange: ArtifactWindowOptions['onChange'];
  log: Log;
  testMode: boolean;
  tab: ArtifactTab;
  problem: ArtifactProblem | null = null;
  overlay = false;
  connected = false;
  /**
   * `window`; `harness`; `allowlist`; `artifactId`; `harnessName` (what the Shell is told the host is); `external(url)`;
   * `handOff(what, id)`: `what` is `artifact` (another one) or `library`; `onSavedFile(path)`; `requestClose()`: the
   * Shell's close; `onChange()`; `log`; `testMode`.
   */
  constructor({
    window,
    harness,
    allowlist,
    artifactId,
    harnessName,
    external,
    handOff,
    onSavedFile,
    requestClose,
    onChange,
    log,
    testMode = false,
  }: ArtifactWindowOptions) {
    this.window = window;
    this.harness = harness;
    this.allowlist = allowlist;
    this.artifactId = artifactId;
    this.harnessName = harnessName;
    this.externalOut = external;
    this.handOff = handOff;
    this.onSavedFile = onSavedFile;
    this.requestClose = requestClose;
    this.onChange = onChange;
    this.log = log;
    this.testMode = testMode;
    this.tab = {
      id: artifactId,
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
    };
    this.problem = null;
    /** The window's page draws over the view (the question about unsaved work): the view is hidden. */
    this.overlay = false;
    this.connected = false;
    this.window.on('resize', () => this.layout());
    guardSession(
      session.fromPartition(PARTITION),
      (origin) => this.allowlist.allows(origin),
      (line) => this.log(line),
    );
    guardSession(
      session.fromPartition(SERVER_PARTITION),
      (origin) => !!this.allowlist.serverOf(origin),
      (line) => this.log(line),
    );
    nativeTheme.on('updated', () => this.tab.embed?.setTheme(themeOf()));
  }

  snapshot() {
    const tab = this.tab;
    return {
      id: tab.id,
      title: tab.title,
      type: tab.type,
      kind: tab.kind,
      status: this.problem ? ('problem' as const) : tab.status,
      problem: this.problem,
      saved: tab.saved?.state ?? null,
      unsaved: unsavedOf(tab),
      closing: tab.closing,
      hasView: !!tab.view,
    };
  }

  changed() {
    this.layout();
    this.onChange?.(this.snapshot());
  }

  /** The window's title: the artifact's. */
  setTitle(title: string) {
    if (typeof title !== 'string' || !title) return;
    this.tab.title = title;
    if (!this.window.isDestroyed()) this.window.setTitle(title);
    this.changed();
  }

  setType(type: string) {
    if (typeof type === 'string' && type) this.tab.type = type;
  }

  /** Why the artifact cannot be shown: no view, the window's page says so. */
  setProblem(kind: ArtifactProblem['kind'], detail = '') {
    this.problem = { kind, detail: String(detail ?? '') };
    this.dropView();
    this.log(`artifact app: ${kind}${detail ? `: ${detail}` : ''}`);
    this.changed();
  }

  clearProblem() {
    if (!this.problem) return;
    this.problem = null;
    this.changed();
  }

  /** The window's page draws over the view (the unsaved-work question), or stops. Focus follows, as it does for a tab. */
  setOverlay(on: boolean) {
    const next = !!on;
    const flipped = next !== this.overlay;
    this.overlay = next;
    this.layout();
    if (!flipped || this.window.isDestroyed()) return;
    if (next) {
      this.log('overlay: focus window');
      this.window.webContents.focus();
    } else if (!this.problem && this.tab.view && !this.tab.view.webContents.isDestroyed()) {
      this.log('overlay: focus view');
      this.tab.view.webContents.focus();
    }
    this.changed();
  }

  /** The view fills the window's content, unless the window's page is in front (a problem, the question). */
  layout() {
    const view = this.tab.view;
    if (!view || this.window.isDestroyed()) return null;
    // A page that went away (crashed) is not shown: the window's page offers to load it again.
    const shown = !this.overlay && !this.problem && this.tab.status !== 'crashed';
    view.setVisible(shown);
    if (!shown) return null;
    const { width, height } = this.window.getContentBounds();
    const placed = { x: 0, y: 0, width, height };
    view.setBounds(placed);
    return placed;
  }

  external(url: string) {
    this.externalOut(url);
  }

  /** Asks the daemon for a view of the artifact and loads it (into the view, made on first use). */
  async load() {
    const tab = this.tab;
    const harness = this.harness;
    if (!harness) throw new Error('not connected to Open Artifact');
    const request = await requestView(harness, this.allowlist, tab.id);
    if (request.title) this.setTitle(request.title);
    tab.ticket = request.view;
    if (tab.view && tab.kind !== 'local') this.dropView();
    tab.kind = 'local';
    tab.server = null;
    if (!tab.view) {
      tab.view = makeView(PARTITION, { testMode: this.testMode });
      this.guardLocal(tab.view.webContents);
      this.window.contentView.addChildView(tab.view);
    }
    tab.embed?.destroy();
    tab.embed = connectShell({
      harness,
      ticket: request.view,
      url: request.embedUrl,
      harnessName: this.harnessName,
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
      onClose: () => void Promise.resolve(this.requestClose()).catch((error: unknown) => this.log(`close: ${errorInfo(error).message ?? error}`)),
      onOpenExternal: (url) => this.external(url),
      onSavedFile: (path) => this.onSavedFile(path),
      capture: async () =>
        tab.view && !tab.view.webContents.isDestroyed() && this.window.isVisible() ? (await tab.view.webContents.capturePage()).toJPEG(70) : null,
      saveThumbnail: (jpeg, artifact) => harness.saveThumbnail(artifact, jpeg),
      onError: (error) => this.log(`artifact ${tab.id}: ${errorInfo(error).message ?? error}`),
    });
    tab.status = 'loading';
    this.changed();
    const contents = tab.view.webContents;
    await contents.loadURL(viewTarget(request.embedUrl, tab.place)).catch((error: unknown) => {
      if (tab.kind === 'server' || tab.view?.webContents !== contents) return;
      throw error;
    });
  }

  guardLocal(contents: Electron.WebContents) {
    const tab = this.tab;
    guardArtifactNavigation(contents, {
      allowlist: this.allowlist,
      id: () => tab.id,
      live: () => tab.view?.webContents === contents,
      // Another artifact (a link, Duplicate's new one): the desktop app's.
      onOther: (id) => this.handOff('artifact', id),
      onHome: () => this.handOff('library', null),
      onServer: (url, origin) => void this.toServer(url, origin),
      external: (url: string) => this.external(url),
      discard: () => tab.discard,
      label: () => `artifact ${tab.id}`,
      onLoaded: (title) => {
        if (title && !tab.title) this.setTitle(title);
        this.changed();
      },
      onGone: (reason) => {
        tab.status = 'crashed';
        this.log(`artifact ${tab.id}: renderer gone (${reason})`);
        this.changed();
      },
      log: (line) => this.log(line),
    });
  }

  /** The daemon sent the view to the artifact's page on its site: shown in a view of the sites' partition. */
  async toServer(url: string, origin: string) {
    const tab = this.tab;
    this.dropView();
    Object.assign(tab, { kind: 'server', server: origin, saved: null, place: null, ticket: null, status: 'loading' });
    tab.view = makeView(SERVER_PARTITION, { testMode: this.testMode });
    const contents = tab.view.webContents;
    guardSiteNavigation(contents, {
      allowlist: this.allowlist,
      live: () => tab.view?.webContents === contents,
      onLocal: (id) => (id === tab.id ? void this.reload() : this.handOff('artifact', id)),
      onHome: () => this.handOff('library', null),
      external: (address: string) => this.external(address),
      onLoaded: () => {
        tab.status = 'ready';
        this.changed();
      },
      // The site cannot be reached: the working copy, here.
      onFailed: (description, address) => {
        this.log(`artifact ${tab.id}: its site did not load (${description}: ${address}); the local copy`);
        void this.reload();
      },
      onGone: (reason) => {
        tab.status = 'crashed';
        this.log(`artifact ${tab.id}: renderer gone (${reason})`);
        this.changed();
      },
      log: (line) => this.log(line),
    });
    this.window.contentView.addChildView(tab.view);
    this.log(`artifact ${tab.id}: shown on its site ${origin}`);
    this.changed();
    await contents.loadURL(url).catch((error: unknown) => this.log(`artifact ${tab.id}: ${errorInfo(error).message ?? error}`));
  }

  /** Lets go of the view (and its Shell's channel). */
  dropView() {
    const tab = this.tab;
    tab.embed?.destroy();
    tab.embed = null;
    if (tab.view) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      tab.view = null;
    }
  }

  /** Opens the artifact (the first time, or after a problem was put right). */
  async open() {
    this.problem = null;
    this.tab.status = 'opening';
    this.changed();
    try {
      await this.load();
      return true;
    } catch (error) {
      this.setProblem('failed', errorInfo(error).message ?? String(error));
      return false;
    }
  }

  /** The connection went down or came back (as a desktop tab: a page with unsaved work is kept, marked `stale`). */
  setConnected(connected: boolean, { stopped = false } = {}) {
    const was = this.connected;
    this.connected = connected;
    const tab = this.tab;
    if (!connected) {
      if (tab.status !== 'crashed' && !this.problem) tab.status = stopped ? 'stopped' : 'reconnecting';
      this.changed();
      return false;
    }
    if (was || this.problem) return this.changed();
    if (unsavedOf(tab)) {
      tab.status = 'stale';
      this.log(`artifact ${tab.id}: kept as it was (it had unsaved work when the daemon went away)`);
      this.changed();
      return false;
    }
    return tab.view ? void this.reload() : false;
  }

  /** Loads the artifact again with a new view; `discard`: the person asked, so unsaved work in the page is let go. */
  async reload({ discard = false } = {}) {
    const tab = this.tab;
    if (this.problem) return false;
    tab.discard = discard;
    try {
      await this.load();
      this.log(`artifact ${tab.id}: loaded again`);
      return true;
    } catch (error) {
      tab.status = 'stale';
      this.log(`artifact ${tab.id}: could not load again: ${errorInfo(error).message ?? error}`);
      this.changed();
      return false;
    } finally {
      tab.discard = false;
    }
  }

  setClosing(on: boolean) {
    if (this.tab.closing === !!on) return;
    this.tab.closing = !!on;
    this.changed();
  }

  /** Test mode only: what the Shell said of its saving, set by a test. */
  setSaved(saved: EmbedSavedState | null) {
    this.tab.saved = saved;
    this.changed();
    return true;
  }

  close() {
    this.dropView();
  }
}
