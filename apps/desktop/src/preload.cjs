// The window's own page (renderer/) gets this bridge and nothing else; artifact views get no preload at all.
// Every call is checked again in the main process: it must come from this window's own page, and its arguments are
// checked there too. Nothing here hands out the daemon's address or token: the library calls are answered in the main
// process with them.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (listener) => {
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', {
  /** Opens an artifact in a tab: an id or an `open-artifact://artifact/<id>` link. */
  open: (ref) => ipcRenderer.invoke('desktop:open', String(ref)),
  select: (id) => ipcRenderer.invoke('desktop:select', String(id)),
  close: (id) => ipcRenderer.invoke('desktop:close', String(id)),
  reload: (id) => ipcRenderer.invoke('desktop:reload', String(id)),
  /** Back and forward over the tabs the person went to. */
  back: () => ipcRenderer.invoke('desktop:back'),
  forward: () => ipcRenderer.invoke('desktop:forward'),
  /** Collapses (true) or opens (false) the sidebar; kept in the app's settings. */
  setSidebarCollapsed: (collapsed) => ipcRenderer.invoke('desktop:sidebar', collapsed === true),
  /** The page draws over the artifact views (a dialog is open), or stops. */
  setOverlay: (on) => ipcRenderer.invoke('desktop:overlay', on === true),
  /**
   * The look (`theme`: system, light, dark) and the language (`locale`: system, en, zh-CN): `get()` answers the
   * settings, what this run uses and `restartNeeded` (a changed language takes effect when the app is opened again);
   * `set(name, value)` keeps one and answers the same (the look changes at once).
   */
  settings: {
    get: () => ipcRenderer.invoke('desktop:settings'),
    set: (name, value) => ipcRenderer.invoke('desktop:setting', String(name), String(value)),
    /** Where new artifacts go: the system's folder dialog (`set('artifactsFolder', '')` goes back to the default). */
    chooseFolder: () => ipcRenderer.invoke('desktop:choose-folder'),
    /** Shows the profile folder in the Finder. */
    revealHome: () => ipcRenderer.invoke('desktop:reveal-home'),
  },
  /** Opens the app again, with the arguments it was started with (a changed language takes effect then). */
  relaunch: () => ipcRenderer.invoke('desktop:relaunch'),
  /**
   * The service (the daemon): `get(refresh)` its state, the apps connected and the type servers; `do(act, arg)` runs
   * `restart`, `stop`, `start`, `restart-type` (a type id), `logs`, `reveal-home`, `doctor` or `others`, answering
   * `{ ok, value }` or `{ ok: false, error }`. Display data only: never the daemon's token.
   */
  service: {
    get: (refresh) => ipcRenderer.invoke('desktop:service', refresh === true),
    do: (act, arg) => ipcRenderer.invoke('desktop:service-do', String(act), arg === undefined ? undefined : String(arg)),
    onChange: listen('desktop:service'),
  },
  /**
   * The runtime's updates: `get(refresh)`; `do(act, arg)` runs `check`, `update`, `later`, `close` or `checking`
   * (arg true or false: the "check for updates" setting).
   */
  runtime: {
    get: (refresh) => ipcRenderer.invoke('desktop:runtime', refresh === true),
    do: (act, arg) => ipcRenderer.invoke('desktop:runtime-do', String(act), arg === true ? true : arg === false ? false : undefined),
    onChange: listen('desktop:runtime'),
  },
  /**
   * The servers (the sites this computer is connected to; the daemon's settings, shared with the command line):
   * `get(refresh)` the list, the default, automatic publishing and a sign-in under way; `do(act, arg)` runs `add`
   * (`{ host, name, insecure }`), `cancel`, `dismiss`, `default` (`{ name }`), `publish` (`{ on }`), `answer-ask`
   * (`{ on }`), `remove` (`{ name, force }`), `home` (`{ name }`), `approve-page` or `open-in-desktop` (`{ on }`),
   * answering `{ ok, value }` or `{ ok: false, error }`. Display data only: never a token.
   */
  servers: {
    get: (refresh) => ipcRenderer.invoke('desktop:servers', refresh === true),
    do: (act, arg) => ipcRenderer.invoke('desktop:servers-do', String(act), arg && typeof arg === 'object' ? { ...arg } : undefined),
    onChange: listen('desktop:servers'),
  },
  /**
   * What the menu bar asks of this page (`{ name, arg }`): `settings`, `new-dialog`, `service` (the service panel) or
   * `toast` (`{ message, kind }`).
   */
  onCommand: listen('desktop:command'),
  /**
   * An artifact's Show in Finder (`reveal`), Move To… (`move`) or Relocate… (`relocate`, a tab whose folder is gone):
   * `{ ok, value }` or `{ ok: false, error }` (the daemon's words).
   */
  artifactDo: (act, id) => ipcRenderer.invoke('desktop:artifact-do', String(act), String(id)),
  /**
   * Test mode only (the main process answers these only then): a menu command by name, the menu as built, the
   * notice showing, the addresses --offline refused, the downloads folder, a tab's saved state, the next pick, a link
   * from open-url, and quitting.
   */
  /** The person's answer to the question about unsaved work (`state.ask`): its id, and true for the action, false to cancel. */
  answer: (id, yes) => ipcRenderer.invoke('desktop:answer', String(id), yes === true),
  test: {
    command: (name, arg) => ipcRenderer.invoke('test:command', String(name), arg ?? null),
    /** What a tab's Shell said of its saving (`{ state, leaveLosesWork }`), set by the test. */
    saved: (id, saved) => ipcRenderer.invoke('test:saved', String(id), saved ?? null),
    /** The path the next folder or file dialog picks (a button of the page's names none). */
    pickNext: (path) => ipcRenderer.invoke('test:pick-next', String(path)),
    /** macOS's open-url, as the system would send it. */
    openUrl: (url) => ipcRenderer.invoke('test:open-url', String(url)),
    /** ⌘Q (asked about as the person's would be); `force`: without asking, for a test's cleanup. */
    quit: (force) => ipcRenderer.invoke('test:quit', force === true),
    /** The window's close button (closed by the main process, as the person's click would). */
    closeWindow: () => ipcRenderer.invoke('test:close-window'),
    menu: () => ipcRenderer.invoke('test:menu'),
    notice: () => ipcRenderer.invoke('test:notice'),
    blocked: () => ipcRenderer.invoke('test:blocked'),
    downloads: () => ipcRenderer.invoke('test:downloads'),
    /** A tab's view as Electron made it (its partition, its preload), and the servers this process lets in. */
    tabInfo: (id) => ipcRenderer.invoke('test:tab-info', String(id)),
    servers: () => ipcRenderer.invoke('test:servers'),
  },
  /** Keyboard focus back to this page. */
  focus: () => ipcRenderer.invoke('desktop:focus'),
  /** The tabs, the connection, back and forward, the sidebar and the look, now and on every change. */
  state: () => ipcRenderer.invoke('desktop:state'),
  onState: listen('desktop:state'),
  /** The library, for the home page: each call answers `{ ok, value }` or `{ ok: false, error }`. */
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    update: (id, patch) => ipcRenderer.invoke('library:update', String(id), { ...patch }),
    remove: (id) => ipcRenderer.invoke('library:remove', String(id)),
    restore: (trash) => ipcRenderer.invoke('library:restore', String(trash)),
    create: (type, title) => ipcRenderer.invoke('library:create', { type: String(type), title: String(title ?? '') }),
    capture: (id, type) => ipcRenderer.invoke('library:capture', String(id), String(type)),
    saveThumbnail: (id, version, jpeg) => ipcRenderer.invoke('library:save-thumbnail', String(id), String(version), jpeg),
    copy: (text) => ipcRenderer.invoke('library:copy', String(text)),
    /** The library changed (or the connection went or came back). */
    onEvent: listen('desktop:library'),
  },
});
