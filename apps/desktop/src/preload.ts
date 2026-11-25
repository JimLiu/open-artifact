import type { DesktopIpc } from './contracts.ts';
import { ipcClient } from './ipc-client.ts';
const invoke = ipcClient<DesktopIpc>();
// The window's own page (renderer/) gets this bridge and nothing else; artifact views get no preload at all.
// Every call is checked again in the main process: it must come from this window's own page, and its arguments are
// checked there too. Nothing here hands out the daemon's address or token: the library calls are answered in the main
// process with them.
import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './contracts.ts';

const listen =
  <T>(channel: string) =>
  (listener: (value: T) => void) => {
    const handler = (_event: IpcRendererEvent, value: T) => listener(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };

const desktop: DesktopBridge = {
  /** Opens an artifact in a tab: an id or an `open-artifact://artifact/<id>` link. */
  open: (ref) => invoke('desktop:open')(String(ref)),
  select: (id) => invoke('desktop:select')(String(id)),
  close: (id) => invoke('desktop:close')(String(id)),
  reload: (id) => invoke('desktop:reload')(String(id)),
  /** Back and forward over the tabs the person went to. */
  back: () => invoke('desktop:back')(),
  forward: () => invoke('desktop:forward')(),
  /** Collapses (true) or opens (false) the sidebar; kept in the app's settings. */
  setSidebarCollapsed: (collapsed) => invoke('desktop:sidebar')(collapsed === true),
  /** The page draws over the artifact views (a dialog is open), or stops. */
  setOverlay: (on) => invoke('desktop:overlay')(on === true),
  /**
   * The look (`theme`: system, light, dark) and the language (`locale`: system, en, zh-CN): `get()` answers the
   * settings, what this run uses and `restartNeeded` (a changed language takes effect when the app is opened again);
   * `set(name, value)` keeps one and answers the same (the look changes at once).
   */
  settings: {
    get: () => invoke('desktop:settings')(),
    set: (name, value) => invoke('desktop:setting')(String(name) as typeof name, String(value) as typeof value),
    /** Where new artifacts go: the system's folder dialog (`set('artifactsFolder', '')` goes back to the default). */
    chooseFolder: () => invoke('desktop:choose-folder')(),
    /** Shows the profile folder in the Finder. */
    revealHome: () => invoke('desktop:reveal-home')(),
  },
  /** Opens the app again, with the arguments it was started with (a changed language takes effect then). */
  relaunch: () => invoke('desktop:relaunch')(),
  /**
   * The service (the daemon): `get(refresh)` its state, the apps connected and the type servers; `do(act, arg)` runs
   * `restart`, `stop`, `start`, `restart-type` (a type id), `logs`, `reveal-home`, `doctor` or `others`, answering
   * `{ ok, value }` or `{ ok: false, error }`. Display data only: never the daemon's token.
   */
  service: {
    get: (refresh) => invoke('desktop:service')(refresh === true),
    do: (act, arg) => invoke('desktop:service-do')(String(act) as typeof act, arg === undefined ? undefined : String(arg)),
    onChange: listen<import('./service.ts').ServiceView>('desktop:service'),
  },
  /**
   * The runtime's updates: `get(refresh)`; `do(act, arg)` runs `check`, `update`, `later`, `close` or `checking`
   * (arg true or false: the "check for updates" setting).
   */
  runtime: {
    get: (refresh) => invoke('desktop:runtime')(refresh === true),
    do: (act, arg) => invoke('desktop:runtime-do')(String(act) as typeof act, arg === true ? true : arg === false ? false : undefined),
    onChange: listen<import('./runtime.ts').RuntimeView>('desktop:runtime'),
  },
  /**
   * The servers (the sites this computer is connected to; the daemon's settings, shared with the command line):
   * `get(refresh)` the list, the default, automatic publishing and a sign-in under way; `do(act, arg)` runs `add`
   * (`{ host, name, insecure }`), `cancel`, `dismiss`, `default` (`{ name }`), `publish` (`{ on }`), `answer-ask`
   * (`{ on }`), `remove` (`{ name, force }`), `home` (`{ name }`), `approve-page` or `open-in-desktop` (`{ on }`),
   * answering `{ ok, value }` or `{ ok: false, error }`. Display data only: never a token.
   */
  servers: {
    get: (refresh) => invoke('desktop:servers')(refresh === true),
    do: (act, arg) => invoke('desktop:servers-do')(String(act) as typeof act, arg && typeof arg === 'object' ? { ...arg } : undefined),
    onChange: listen<import('./servers.ts').ServersView>('desktop:servers'),
  },
  /**
   * What the menu bar asks of this page (`{ name, arg }`): `settings`, `new-dialog`, `service` (the service panel) or
   * `toast` (`{ message, kind }`).
   */
  onCommand: listen<import('./contracts.ts').PageCommand>('desktop:command'),
  /**
   * "Install as app" (an artifact as an app of its own in ~/Applications/Open Artifact Apps): `state(id)`,
   * `install(id, { confirmedName, allowCopy })`, `open(id, installId)`, `reveal(id, installId)`,
   * `uninstall(id, installId)`, `refresh(id, installId, { allowCopy })`, `repair(id, installId, { allowCopy })`,
   * `forget(id, installId)` (Remove Record), each answering `{ ok, value }` or `{ ok: false, error }`.
   */
  apps: {
    state: (id) => invoke('desktop:apps.state')(String(id)),
    install: (id, options) =>
      invoke('desktop:apps.install')(
        String(id),
        options && typeof options === 'object' ? { confirmedName: options.confirmedName, allowCopy: options.allowCopy === true } : {},
      ),
    open: (id, installId) => invoke('desktop:apps.open')(String(id), String(installId)),
    reveal: (id, installId) => invoke('desktop:apps.reveal')(String(id), String(installId)),
    uninstall: (id, installId) => invoke('desktop:apps.uninstall')(String(id), String(installId)),
    refresh: (id, installId, options) => invoke('desktop:apps.refresh')(String(id), String(installId), { allowCopy: options?.allowCopy === true }),
    repair: (id, installId, options) => invoke('desktop:apps.repair')(String(id), String(installId), { allowCopy: options?.allowCopy === true }),
    forget: (id, installId) => invoke('desktop:apps.forget')(String(id), String(installId)),
  },
  /**
   * An artifact's Show in Finder (`reveal`), Move To… (`move`) or Relocate… (`relocate`, a tab whose folder is gone):
   * `{ ok, value }` or `{ ok: false, error }` (the daemon's words).
   */
  artifactDo: (act, id) => invoke('desktop:artifact-do')(String(act) as typeof act, String(id)),
  /**
   * Test mode only (the main process answers these only then): a menu command by name, the menu as built, the
   * notice showing, the addresses --offline refused, the downloads folder, a tab's saved state, the next pick, a link
   * from open-url, and quitting.
   */
  /** The person's answer to the question about unsaved work (`state.ask`): its id, and true for the action, false to cancel. */
  answer: (id, yes) => invoke('desktop:answer')(String(id), yes === true),
  test: {
    command: (name, arg) => invoke('test:command')(String(name), arg ?? null),
    /** What a tab's Shell said of its saving (`{ state, leaveLosesWork }`), set by the test. */
    saved: (id, saved) => invoke('test:saved')(String(id), saved ?? null),
    /** The path the next folder or file dialog picks (a button of the page's names none). */
    pickNext: (path) => invoke('test:pick-next')(String(path)),
    /** macOS's open-url, as the system would send it. */
    openUrl: (url) => invoke('test:open-url')(String(url)),
    /** ⌘Q (asked about as the person's would be); `force`: without asking, for a test's cleanup. */
    quit: (force) => invoke('test:quit')(force === true),
    /** The window's close button (closed by the main process, as the person's click would). */
    closeWindow: () => invoke('test:close-window')(),
    menu: () => invoke('test:menu')(),
    notice: () => invoke('test:notice')(),
    blocked: () => invoke('test:blocked')(),
    downloads: () => invoke('test:downloads')(),
    /** A tab's view as Electron made it (its partition, its preload), and the servers this process lets in. */
    tabInfo: (id) => invoke('test:tab-info')(String(id)),
    servers: () => invoke('test:servers')(),
    /** "Install as app": the next call waits at `step` (e.g. `recorded`) until `appsRelease()`. */
    appsHold: (step) => invoke('test:apps-hold')(String(step)),
    appsRelease: () => invoke('test:apps-release')(),
  },
  /** Keyboard focus back to this page. */
  focus: () => invoke('desktop:focus')(),
  /** The tabs, the connection, back and forward, the sidebar and the look, now and on every change. */
  state: () => invoke('desktop:state')(),
  onState: listen<import('./contracts.ts').DesktopState>('desktop:state'),
  /** The library, for the home page: each call answers `{ ok, value }` or `{ ok: false, error }`. */
  library: {
    list: () => invoke('library:list')(),
    update: (id, patch) => invoke('library:update')(String(id), { ...patch }),
    remove: (id) => invoke('library:remove')(String(id)),
    restore: (trash) => invoke('library:restore')(String(trash)),
    create: (type, title) => invoke('library:create')({ type: String(type), title: String(title ?? '') }),
    capture: (id, type) => invoke('library:capture')(String(id), String(type)),
    saveThumbnail: (id, version, jpeg) => invoke('library:save-thumbnail')(String(id), String(version), jpeg),
    copy: (text) => invoke('library:copy')(String(text)),
    /** The library changed (or the connection went or came back). */
    onEvent: listen<import('./contracts.ts').LibraryChange>('desktop:library'),
  },
};
contextBridge.exposeInMainWorld('desktop', desktop);
