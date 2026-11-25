/**
 * Open Artifact Desktop: one window with a sidebar, a tab bar and the home page (the window's own React page,
 * renderer/), and one `WebContentsView` per artifact.
 *
 * The app is a host with no agent: it connects with `createHarness({ harness: 'open-artifact-desktop' })`, attaches no
 * session and registers no `wake`. It carries its own runtime (`resources/runtime`, the `@open-artifact/cli` folder)
 * and the kit starts the daemon with this app's executable and ELECTRON_RUN_AS_NODE=1, detached, so the daemon outlives
 * the app (other agent apps share it) and no Node.js needs to be installed. The daemon's token stays in this process:
 * the home page's library calls come here over the preload's bridge and are answered with it (`library.mjs`).
 *
 * This process holds what the window shows: the tabs and the current one, back and forward over them
 * (`history.mjs`), and the app's settings (`settings.mjs`): whether the sidebar is collapsed, the look and the
 * language. The page draws what it is sent.
 *
 * The look and the language reach every page the app shows, the artifacts' Shells and their editors' frames included,
 * through Chromium rather than any message: the look is `nativeTheme.themeSource` (`prefers-color-scheme` everywhere,
 * at once; the Shell is also told it in `host_hello`), the language is Chromium's `--lang` (`navigator.language`, the
 * `Accept-Language` the pages send), which only takes effect when the app starts: a changed language setting says
 * `restartNeeded` until the app is opened again. Test mode's `--locale` and `--theme` come before the settings.
 *
 * Order of things: the profile (home, port, Electron's folders) is decided and checked first (`profile.mjs`), before
 * Electron is ready and before anything connects; then the window, then the connection, then the tabs.
 *
 * One app runs per profile (Electron's single-instance lock, on its userData folder): a second start hands its
 * arguments to it and exits 0; the one running comes to the front and opens what they ask (`--open`, links).
 * `open-artifact://artifact/<id>` links (`links.mjs`) come from the start's arguments, macOS's `open-url` and a second
 * start; the app never registers itself for the scheme.
 *
 *   electron . --home <dir> --port <n> [--open <artifact id>]… [open-artifact://artifact/<id>]…
 *              [--test-mode --devtools-port <n> [--locale en|zh] [--theme light|dark] [--thumbnails] [--offline]]
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, session, shell } from 'electron';
import { createHarness, readDaemon, runtimeInfo } from '@open-artifact/harness-kit';
import { thumbnailStamp } from '@open-artifact/library-page/library';
import { LIBRARY_ROUTES } from '@open-artifact/protocol';
import { bundleOfExecutable, daemonEnv, daemonOnDefaultPort, resolveProfile } from './profile.mjs';
import { OriginAllowlist } from './navigation.mjs';
import { HOME_TAB, PARTITION, SERVER_PARTITION, SITE_TAB, Tabs, unsavedOf } from './tabs.mjs';
import { Servers } from './servers.mjs';
import { TabHistory } from './history.mjs';
import { CHOICES, Settings, chromiumLang, validSetting } from './settings.mjs';
import { createArg, idArg, libraryClient, patchArg } from './library.mjs';
import { CAPTURE_PARTITION, Photographer, registerThumbnailScheme, serveThumbnails } from './thumbnails.mjs';
import { Downloads } from './downloads.mjs';
import { blockOffline } from './offline.mjs';
import { Notice } from './notice.mjs';
import { describeMenu, menuTemplate, templateCommands } from './menu.mjs';
import { moveArtifact } from './move.mjs';
import { wordsFor } from '../renderer/src/words.js';
import { Service } from './service.mjs';
import { RuntimeUpdates } from './runtime.mjs';
import { libraryDefaultFolder, newArtifactFolder } from './folders.mjs';
import { linkedArtifact, opensOf } from './links.mjs';
import { InstalledApps, installDirOf } from './installed-apps.mjs';
import { macosOps } from './installed-apps-macos.mjs';
import { isPageAt, pageUrlOf } from './page-url.mjs';

// The bundle is out/main.mjs: the window's page is out/renderer/, the resources are beside out/.
const here = import.meta.dirname;
const appRoot = join(here, '..');
/** The height of the tab bar (renderer `--bar-height`). */
const BAR_HEIGHT = 40;
/** The sidebar's width when it is open (renderer `--sidebar-width`). */
const SIDEBAR_WIDTH = 240;
/** How long a close or a quit waits for unsaved work to be saved before it asks, ms. */
const SAVE_WAIT_MS = 3000;
/** The largest thumbnail the page may hand back to save (the daemon takes up to 4 MiB). */
const JPEG_MAX = 4 << 20;

const log = (line) => console.log(`[desktop] ${line}`);

// ---- the profile, before anything else ----

const profile = resolveProfile({ argv: process.argv.slice(1), env: process.env, packaged: app.isPackaged });
if (profile.problems.length) {
  for (const line of profile.problems) console.error(`[desktop] ${line}`);
  app.exit(2);
  process.exit(2);
}
if (profile.paths) {
  for (const dir of Object.values(profile.paths)) mkdirSync(dir, { recursive: true });
  app.setPath('userData', profile.paths.userData);
  app.setPath('sessionData', profile.paths.sessionData);
  app.setAppLogsPath(profile.paths.logs);
  app.setPath('crashDumps', profile.paths.crashDumps);
}
// One app per profile: Electron's lock is its userData folder's (`<home>/desktop/user-data` for a development or test
// run, so two homes never meet). A second start hands its arguments to the one running and leaves.
if (!app.requestSingleInstanceLock({ argv: process.argv.slice(1) })) {
  console.log('[desktop] another instance runs for this profile: its arguments were handed to it');
  app.exit(0);
  process.exit(0);
}

// ---- what asks to open an artifact: the start's arguments, macOS's open-url, a second start ----

/** What came before the window and the tabs were there, in order; `receive` takes them from then on. */
const incoming = [];
let receive = (ref, from) => incoming.push({ ref, from });
/** The start's or a second start's arguments: each `--open` and each link (a link of another form is refused). */
function takeArgs(argv, from) {
  const { refs, refused } = opensOf(argv);
  for (const link of refused) log(`link refused (${from}): ${link.slice(0, 200)}`);
  for (const ref of refs) receive(ref, from);
}
/** A link from macOS (`open-url`), or test mode's command: `open-artifact://artifact/<id>` only. */
function takeLink(url, from = 'open-url') {
  const id = linkedArtifact(url);
  if (!id) {
    log(`link refused (${from}): ${String(url).slice(0, 200)}`);
    return false;
  }
  log(`link (${from}): ${id}`);
  receive(id, from);
  return true;
}
// Before ready: macOS sends the link that started the app before the app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  takeLink(url, 'open-url');
});
/** Brings the window to the front once it is there (test mode: only logged, the person's screen is left alone). */
let toFront = () => {};
app.on('second-instance', (_event, argv, _cwd, data) => {
  // The arguments the second start sent (Chromium rewrites `argv`); its own `argv` only when it sent none.
  const args = Array.isArray(data?.argv) && data.argv.every((arg) => typeof arg === 'string') ? data.argv : argv;
  log(`second start: ${JSON.stringify(args.slice(0, 40)).slice(0, 600)}`);
  toFront();
  takeArgs(args, 'second start');
});
takeArgs(process.argv.slice(1), 'arguments');

if (profile.testMode) {
  if (profile.debugPort) app.commandLine.appendSwitch('remote-debugging-port', String(profile.debugPort));
  // Never in the person's way: no Dock icon, no activation, no shown window.
  if (process.platform === 'darwin') app.setActivationPolicy?.('accessory');
  // A window never shown still runs its pages' animation frames and timers (without these, a page's
  // requestAnimationFrame was seen not to fire for seconds).
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}
registerThumbnailScheme();

// The settings before Chromium starts: the language is a command-line switch.
const settings = new Settings(app.getPath('userData'), { log });
/** The language this run speaks (`system`, `en` or `zh-CN`): the test switch, else the setting as the app started. */
const startLocale = profile.locale ? (profile.locale === 'zh' ? 'zh-CN' : 'en') : settings.get('locale');
const startLang = chromiumLang(startLocale);
if (startLang) app.commandLine.appendSwitch('lang', startLang);

const runtimeDir = app.isPackaged ? join(process.resourcesPath, 'runtime') : join(appRoot, 'resources', 'runtime');

/** Links out: the system browser; in test mode only logged. */
const openExternal = (url) => {
  log(`external ${url}`);
  if (!profile.testMode) void shell.openExternal(url);
};

/** What reaches the system (a folder opened, a file shown in the Finder): in test mode only logged. */
const system = {
  openPath(path) {
    log(`open folder ${path}${profile.testMode ? ' (test mode: not opened)' : ''}`);
    if (!profile.testMode) void shell.openPath(path);
    return true;
  },
  reveal(path) {
    log(`reveal ${path}${profile.testMode ? ' (test mode: not shown)' : ''}`);
    if (!profile.testMode) shell.showItemInFolder(path);
    return true;
  },
};

/**
 * The window's language, as the page has words for it (`zh` or `en`): the one Chromium runs with, so the app's own
 * words, the Shell's (`navigator.language`) and the editors' agree.
 */
function runningLocale() {
  return /^zh\b/i.test(app.getLocale() ?? '') ? 'zh' : 'en';
}

/** The look Chromium draws with: the test switch, else the setting (`system` follows the system). */
const themeSource = () => profile.theme ?? settings.get('theme');

/** The look and language settings, what this run uses, and whether a changed language waits for the app to reopen. */
function settingsView() {
  return {
    theme: settings.get('theme'),
    locale: settings.get('locale'),
    choices: { theme: [...CHOICES.theme], locale: [...CHOICES.locale] },
    /** Test mode's switches, which come before the settings (null: none given). */
    forced: { theme: profile.theme ?? null, locale: profile.locale ? startLocale : null },
    running: { theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', locale: startLocale, language: app.getLocale() },
    restartNeeded: !profile.locale && settings.get('locale') !== startLocale,
    /** Where new artifacts go: the folder chosen here (empty: the library's own default, `libraryFolder`). */
    artifactsFolder: settings.get('artifactsFolder'),
    libraryFolder: libraryDefaultFolder(profile.home),
    /** The profile folder (the Open Artifact home) and the versions, for the Advanced section. */
    home: profile.home,
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, runtime: carriedVersion },
  };
}

/** The version of the runtime this app carries (read at start). */
let carriedVersion = null;

/** A folder the page may set as where new artifacts go: an absolute folder that exists. */
function folderArg(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !validSetting('artifactsFolder', value)) throw new Error('not an absolute folder');
  let isDir = false;
  try {
    isDir = statSync(value).isDirectory();
  } catch {
    // Not there.
  }
  if (!isDir) throw new Error(`not a folder: ${value}`);
  return value;
}

app.on('window-all-closed', () => app.quit());

app.whenReady().then(start, fail);

function fail(error) {
  console.error(`[desktop] ${error?.stack ?? error}`);
  app.exit(1);
}

async function start() {
  log(`profile ${JSON.stringify({ home: profile.home, port: profile.port, packaged: profile.packaged, testMode: profile.testMode, guarded: profile.guarded, paths: profile.paths })}`);
  if (profile.testMode && process.platform === 'darwin') app.dock?.hide();
  // The look of every page (the window's, the views', their frames'): a test run's switch, else the setting.
  nativeTheme.themeSource = themeSource();

  const info = runtimeInfo(runtimeDir);
  if (!info?.version) throw new Error(`No Open Artifact runtime in ${runtimeDir}: run npm run build in apps/desktop.`);
  carriedVersion = info.version;

  // A daemon already runs for this home: a development or test run must not connect to one on 4800.
  if (profile.guarded && daemonOnDefaultPort(await readDaemon(profile.home))) {
    throw new Error(`The daemon of ${profile.home} listens on port 4800; this development or test run does not connect to it.`);
  }

  // Test mode's --offline: no page of the app reaches past this computer (the views', the window's, the thumbnails').
  /** The addresses refused so far (test mode's --offline), in order. */
  const blocked = [];
  if (profile.offline) {
    for (const [name, ses] of [
      ['window', session.defaultSession],
      ['views', session.fromPartition(PARTITION)],
      ['sites', session.fromPartition(SERVER_PARTITION)],
      ['thumbnails', session.fromPartition(CAPTURE_PARTITION)],
    ]) {
      blockOffline(ses, (url, details) => {
        blocked.push({ session: name, url, type: details.resourceType ?? '' });
        log(`offline: blocked ${name} ${details.resourceType ?? ''} ${url.slice(0, 300)}`);
      });
    }
    log('offline: only this computer is reachable');
  }

  // Nothing here may ask for a permission, and the window's own page never navigates.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const locale = runningLocale();
  log(`look ${JSON.stringify({ theme: themeSource(), locale: startLocale, language: app.getLocale() })}`);
  const look = () => ({ theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', platform: process.platform, locale });

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'Open Artifact',
    show: !profile.testMode,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 13 } } : {}),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: !profile.testMode,
    },
  });
  const pagePath = join(here, 'renderer', 'index.html');
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  // The thumbnail scheme before the page: a page knows only the schemes its session handled when it loaded.
  let harness = null;
  const library = libraryClient({ state: () => harness?.client.state ?? null });
  serveThumbnails(library, log);
  // Until the connection is made, the page's question for the state is answered "not yet" (null), so it asks again.
  ipcMain.handle('desktop:state', (event) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isPageAt(event.senderFrame?.url, pagePath)) throw new Error('not allowed');
    return null;
  });
  // The page first (it waits for this process's answers), so the window is not empty while the daemon starts.
  await window.loadURL(pageUrlOf(pagePath));

  const allowlist = new OriginAllowlist();
  const t = wordsFor(locale);
  // The "saved" notice over the views, and the downloads that end in it.
  let downloads = null;
  const notice = new Notice({
    window,
    dir: here,
    words: () => ({ saved: (folder) => t('notice.saved', { folder }), reveal: t('notice.reveal'), close: t('notice.close'), lang: locale === 'zh' ? 'zh-CN' : 'en' }),
    reveal: (id) => downloads.reveal(id),
    log,
    testMode: profile.testMode,
  });
  downloads = new Downloads({ allowlist, notify: (n) => void notice.show(n), reveal: (path) => system.reveal(path), log });
  downloads.attach(session.fromPartition(PARTITION));
  downloads.refuse(session.defaultSession, 'the window');
  downloads.refuse(session.fromPartition(CAPTURE_PARTITION), 'the thumbnails');
  // A site's pages (the servers' partition) save nothing to this computer through this app.
  downloads.refuse(session.fromPartition(SERVER_PARTITION), 'the sites');
  /** The daemon's `host.open` with no session: an agent's open handed to this app ("open agents' artifacts here"). */
  let showOpen = async () => false;
  harness = await createHarness({
    harness: 'open-artifact-desktop',
    // The runtime this app carries; updates are offered, never installed without the person (a later stage).
    runtime: { dir: runtimeDir, version: info.version, update: 'prompt' },
    home: profile.home,
    daemon: { env: daemonEnv(process.env, profile), timeoutMs: 60_000 },
    // Views of its own (`view.open` gives a ticket only to `embed: 'view'`); a remote type's page is not shown yet.
    embed: { origins: [], mode: 'view', remote: 'deny' },
    // This app attaches no session: a `host.open` comes only when the person turned on "open agents' artifacts in this
    // app" (the daemon's `openInDesktop`) and an agent's app could not show the page itself. It opens a tab.
    open: (request) => showOpen(request),
    reconnect: { minMs: 500, maxMs: 5000 },
    log: (line) => log(`kit: ${line}`),
  });
  const photographer = new Photographer({ allowlist, log });
  // The service panel and the runtime's updates: every call here, the page gets display data only.
  const service = new Service({
    harness,
    library,
    profile,
    runtimeDir,
    carried: info.version,
    log,
    actions: system,
    onChange: (view) => {
      if (!window.isDestroyed()) window.webContents.send('desktop:service', view);
      if (tabs) send();
    },
  });
  const runtime = new RuntimeUpdates({
    harness,
    runtimeDir,
    profile,
    carried: info.version,
    log,
    onChange: (view) => {
      if (!window.isDestroyed()) window.webContents.send('desktop:runtime', view);
    },
  });

  /** The daemon's origin and the page origins it lists; refused when a development build reached a daemon on 4800. */
  const refreshOrigins = async () => {
    const state = harness.client.state;
    if (profile.guarded && daemonOnDefaultPort(state)) {
      console.error(`[desktop] connected to a daemon on port 4800 (${state.url}); quitting.`);
      app.exit(3);
      return false;
    }
    allowlist.setDaemon(state?.url ?? null);
    try {
      allowlist.fromDaemon(await harness.embedOrigins());
    } catch (error) {
      log(`embed.origins: ${error?.message ?? error}`);
    }
    return true;
  };

  // ---- what the window shows ----

  const history = new TabHistory(HOME_TAB);
  let travelling = false;
  let tabs = null;
  /** The menu bar's types (File ▸ New) and what it was last built for; it is built once the commands are there. */
  let menuTypes = [];
  let menuKey = '';
  let menuReady = false;
  const snapshot = () => ({
    ...tabs.snapshot(),
    canBack: history.canBack,
    canForward: history.canForward,
    sidebarCollapsed: settings.get('sidebarCollapsed'),
    look: look(),
    settings: settingsView(),
    /** The service's state word (the status button's): running, reconnecting, stopped, elsewhere, failed. */
    service: service.state(),
    /** Thumbnails are taken only while the window is on screen (or a test asks for them). */
    thumbnails: profile.thumbnails || (window.isVisible() && !window.isMinimized()),
    /** The question asked about unsaved work (`{ id, kind, names }`), or null. */
    ask: asking ? { id: asking.id, kind: asking.kind, names: asking.names } : null,
    // The window's page draws over the views (a dialog or the question above): the view in front is hidden.
    overlay: tabs.overlay === true,
  });
  const send = () => {
    if (window.isDestroyed()) return;
    // Back and forward follow every tab the person goes to, and forget the ones that closed.
    const open = new Set([HOME_TAB, ...tabs.tabs.keys()]);
    for (const id of new Set(history.entries)) if (!open.has(id)) history.remove(id, HOME_TAB);
    if (!travelling) history.visit(tabs.current);
    window.webContents.send('desktop:state', snapshot());
    notice.raise();
    refreshMenu();
  };
  tabs = new Tabs({
    window,
    harness,
    allowlist,
    topInset: () => BAR_HEIGHT,
    leftInset: () => (settings.get('sidebarCollapsed') ? 0 : SIDEBAR_WIDTH),
    onChange: send,
    openExternal,
    onSavedFile: (path, id) => {
      log(`saved_file from ${id}`);
      downloads.fromShell(path);
    },
    // The Shell's own close asks as the bar's close does.
    requestClose: (id) => requestClose(id),
    // A folder moved or renamed outside Open Artifact: the daemon's `folderMissing`.
    folderGone: async (id) => {
      try {
        const record = await library.record(id);
        return record?.folderMissing === true ? String(record.root ?? '') : null;
      } catch (error) {
        log(`artifact ${id}: ${error?.message ?? error}`);
        return null;
      }
    },
    log,
    testMode: profile.testMode,
  });

  // ---- unsaved work: waited for, then asked about ----

  /** The question asked now: `{ id, kind, names, done(yes) }` (one at a time). */
  let asking = null;
  let askCount = 0;
  /**
   * Asks the person in the window's page (`kind`: close, quit, reload; `names`: the artifacts' titles); resolves
   * true for "close anyway", "quit anyway" or "reload", false for Cancel. While another question is up, it is
   * answered false at once.
   */
  const ask = (kind, names) =>
    new Promise((done) => {
      if (window.isDestroyed()) return done(false);
      if (asking) {
        log(`ask ${kind}: another question (${asking.kind}) is up; not asked`);
        return done(false);
      }
      asking = {
        id: `ask-${++askCount}`,
        kind,
        names,
        done: (yes) => {
          asking = null;
          send();
          done(yes);
        },
      };
      log(`ask ${kind}: ${JSON.stringify(names)}`);
      send();
    });
  const titleOf = (id) => {
    const tab = tabs.tabs.get(id);
    return tab?.title || id;
  };
  /** The tabs with unsaved work. */
  const unsavedTabs = () => [...tabs.tabs.values()].filter(unsavedOf);
  /** Waits (up to `ms`) for every tab of `ids` to have nothing unsaved; true when none has. */
  const settled = async (ids, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (!ids.some((id) => unsavedOf(tabs.tabs.get(id)))) return true;
      if (Date.now() > deadline) return false;
      await new Promise((done) => setTimeout(done, 100));
    }
  };
  /** Closes of a tab under way (its unsaved work waited for, then asked about), by id. */
  const closing = new Map();
  /**
   * The person's close of a tab (the bar's ×, ⌘W, Close Tab, the Shell's `close`): with unsaved work, waited for up
   * to {@link SAVE_WAIT_MS} (the tab says so), then asked about. Resolves true when it closed.
   */
  function requestClose(id) {
    if (closing.has(id)) return closing.get(id);
    const run = (async () => {
      if (!tabs.tabs.has(id)) return false;
      if (!unsavedOf(tabs.tabs.get(id))) return tabs.close(id);
      tabs.setClosing(id, true);
      const saved = await settled([id], SAVE_WAIT_MS);
      tabs.setClosing(id, false);
      if (!tabs.tabs.has(id)) return false;
      if (!saved) {
        const yes = await ask('close', [titleOf(id)]);
        if (!yes) {
          log(`close ${id}: kept (it has unsaved work)`);
          return false;
        }
        log(`close ${id}: closed with its unsaved work let go, as asked`);
      } else log(`close ${id}: its work was saved`);
      return tabs.close(id);
    })().finally(() => closing.delete(id));
    closing.set(id, run);
    return run;
  }
  /** The person's reload of a tab: a tab kept as it was (`stale`) with unsaved work is asked about first. */
  async function reloadTab(id) {
    const tab = tabs.tabs.get(id);
    if (!tab) return false;
    const stale = tab.status === 'stale';
    if (stale && unsavedOf(tab) && !(await ask('reload', [titleOf(id)]))) {
      log(`reload ${id}: kept (cancelled)`);
      return false;
    }
    return tabs.reload(id, { discard: stale });
  }
  /** The quit was asked about (or nothing was unsaved): the window may close and the app may quit. */
  let quitAllowed = false;
  let quitting = null;
  /** ⌘Q or the window's close with unsaved work: waited for, then asked about with the tabs' names. */
  const confirmQuit = () =>
    (quitting ??= (async () => {
      // The window is gone (its page closed it, which no close event can hold): there is nowhere to ask.
      if (window.isDestroyed()) {
        log('quit: the window is gone, nothing to ask in');
        quitAllowed = true;
        app.quit();
        return true;
      }
      const ids = unsavedTabs().map((tab) => tab.id);
      for (const id of ids) tabs.setClosing(id, true);
      await settled(ids, SAVE_WAIT_MS);
      for (const id of ids) tabs.setClosing(id, false);
      const left = unsavedTabs();
      if (left.length && !(await ask('quit', left.map((tab) => titleOf(tab.id))))) {
        log('quit: cancelled (unsaved work)');
        return false;
      }
      log(left.length ? `quit: with unsaved work let go in ${left.length} tab(s), as asked` : 'quit: the work was saved');
      quitAllowed = true;
      app.quit();
      return true;
    })().finally(() => (quitting = null)));
  window.on('close', (event) => {
    if (quitAllowed || !unsavedTabs().length) return;
    event.preventDefault();
    void confirmQuit();
  });
  const travel = (to) => {
    if (to === null) return false;
    travelling = true;
    try {
      tabs.select(to);
    } finally {
      travelling = false;
    }
    send();
    return true;
  };
  /** The library's word on an open tab's artifact (its title and type). */
  /** Open tabs' artifacts last seen published (by id → the site's name), to follow one that was just published. */
  const publishedTo = new Map();
  const describe = async (id) => {
    if (SITE_TAB.test(id)) return;
    try {
      const artifact = await library.artifact(id);
      tabs.setInfo(id, { title: artifact.title, type: artifact.type });
    } catch (error) {
      log(`artifact ${id}: ${error?.message ?? error}`);
    }
  };
  /** An open local tab whose artifact was just published (now on a site that can be reached): loaded again, there. */
  const followPublishing = async (id) => {
    const was = publishedTo.get(id) ?? null;
    try {
      const record = await library.record(id);
      const now = record?.remote?.name ?? null;
      publishedTo.set(id, now);
      if (now && now !== was && servers.remotes.some((remote) => remote.name === now && remote.reachable)) await tabs.followPublished(id);
    } catch (error) {
      log(`artifact ${id}: ${error?.message ?? error}`);
    }
  };
  const openTab = async (ref) => {
    const id = await tabs.open(ref);
    void describe(id);
    if (!publishedTo.has(id)) void library.record(id).then((record) => publishedTo.set(id, record?.remote?.name ?? null), () => {});
    return id;
  };
  const libraryEvent = (event) => {
    if (!window.isDestroyed()) window.webContents.send('desktop:library', event);
  };

  // ---- the servers (sites) this computer is connected to: the daemon's settings, read and changed here ----
  const servers = new Servers({
    library,
    connected: () => harness.connected,
    asked: () => settings.get('autoPublishAsked'),
    setAsked: (on) => settings.set('autoPublishAsked', on === true),
    log,
    onChange: (view) => {
      // Only those sites' origins are let into the servers' partition (none of them into the local one).
      allowlist.setServers(view.remotes.map((remote) => remote.host));
      tabs.serversChanged(servers.reachable());
      if (!window.isDestroyed()) window.webContents.send('desktop:servers', view);
    },
  });
  // A site's page did not load: the list is read again now (a site that cannot be reached shows the working copy).
  tabs.onServerFailed = () => void servers.refresh();
  /** A server's home page in a tab of the servers' partition. */
  const openServerHome = async (name) => {
    const home = servers.homeOf(name);
    if (!home.origin) throw new Error(`no address for ${name}`);
    allowlist.setServers(servers.remotes.map((remote) => remote.host));
    return tabs.openSite(home.name, home.origin);
  };
  // An agent's open the daemon handed to this app: a tab of it, the window in front.
  showOpen = async (request) => {
    const id = await openTab(request.url);
    log(`open from the daemon: ${id}`);
    toFront();
    return true;
  };

  harness.on('event', (event) => {
    if (event.type === 'embed/origins') allowlist.fromDaemon(event);
    if (event.type === 'artifacts/changed' && typeof event.id === 'string') {
      // The page's list reloads; an open tab of it follows a rename, and closes when it was deleted.
      if (tabs.tabs.has(event.id)) {
        if (event.removed) void tabs.close(event.id);
        else void describe(event.id).then(() => followPublishing(event.id));
      }
      libraryEvent({ type: event.type, id: event.id, removed: !!event.removed });
    } else if (event.type === 'types/changed') {
      libraryEvent({ type: event.type });
      void refreshTypes();
    } else if (event.type === 'runtime/update') {
      log(`runtime/update ${JSON.stringify({ current: event.current, available: event.available, installed: event.installed })}`);
      runtime.event();
    }
  });
  harness.on('state', (state) => {
    log(`connection ${state}`);
    service.connection(state);
    if (state === 'connected') {
      void refreshOrigins().then((ok) => {
        if (!ok) return;
        tabs.setConnected(true);
        libraryEvent({ type: 'connected' });
        void refreshTypes();
        servers.start();
      });
      void runtime.refresh();
    } else {
      tabs.setConnected(false, { stopped: state === 'stopped' });
      libraryEvent({ type: 'disconnected' });
      servers.stop();
      void servers.refresh();
      void runtime.refresh();
    }
  });
  for (const name of ['show', 'hide', 'minimize', 'restore']) window.on(name, send);
  nativeTheme.on('updated', () => {
    if (!window.isDestroyed()) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff');
    send();
  });

  // ---- the window's calls: only from its own page ----
  const fromChrome = (event) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isPageAt(event.senderFrame?.url, pagePath);
  const handle = (channel, run) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromChrome(event)) {
        log(`refused ${channel} from ${event.senderFrame?.url ?? '?'}`);
        throw new Error('not allowed');
      }
      return run(...args);
    });
  /** A library call: its answer, or `{ error }` with the daemon's words (a thrown error loses its message over IPC). */
  const answer = (channel, run) =>
    handle(channel, async (...args) => {
      try {
        return { ok: true, value: await run(...args) };
      } catch (error) {
        log(`${channel}: ${error?.message ?? error}`);
        return { ok: false, error: String(error?.message ?? error) };
      }
    });

  ipcMain.removeHandler('desktop:state');
  handle('desktop:state', () => snapshot());
  // The person's answer to the question about unsaved work.
  handle('desktop:answer', (id, yes) => {
    if (!asking || asking.id !== id) return false;
    log(`answer ${asking.kind}: ${yes === true ? 'yes' : 'cancel'}`);
    asking.done(yes === true);
    return true;
  });

  handle('desktop:open', async (ref) => {
    try {
      return { ok: true, id: await openTab(ref) };
    } catch (error) {
      log(`open ${ref}: ${error?.message ?? error}`);
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
  handle('desktop:select', (id) => tabs.select(String(id)));
  handle('desktop:close', (id) => (id === HOME_TAB ? false : requestClose(String(id))));
  // The person's Reload of a tab kept as it was (`stale`): its unsaved work, which can no longer be saved, is let go
  // once they said so. Any other reload leaves a page that holds unsaved work as it is.
  handle('desktop:reload', (id) => reloadTab(String(id)));
  handle('desktop:back', () => travel(history.back()));
  handle('desktop:forward', () => travel(history.forward()));
  handle('desktop:sidebar', (collapsed) => {
    settings.set('sidebarCollapsed', collapsed === true);
    const bounds = tabs.layout();
    log(`sidebar ${settings.get('sidebarCollapsed') ? 'collapsed' : 'open'}${bounds ? `: view at x=${bounds.x} width=${bounds.width}` : ''}`);
    send();
    return settings.get('sidebarCollapsed');
  });
  handle('desktop:overlay', (on) => {
    tabs.setOverlay(on === true);
    return true;
  });
  // The look and the language: the look applies at once (every view follows `nativeTheme`), the language when the app
  // starts again (`restartNeeded`). The answer is the settings as `desktop:settings` gives them.
  handle('desktop:settings', () => settingsView());
  handle('desktop:setting', (name, value) => {
    if (name === 'artifactsFolder') {
      // The page may put it back to the library's default; a folder is chosen with the system's dialog
      // (`desktop:choose-folder`), or, in test mode only, given here.
      if (value !== '' && !profile.testMode) throw new Error('a folder is chosen with the dialog');
      value = folderArg(value);
    } else if (name !== 'theme' && name !== 'locale') throw new Error(`not a setting: ${name}`);
    settings.set(name, value);
    log(`setting ${name} = ${value}`);
    if (name === 'theme') nativeTheme.themeSource = themeSource();
    send();
    return settingsView();
  });
  // Where new artifacts go, chosen with the system's folder dialog (never in test mode: no dialog is shown there).
  // The servers switcher: the daemon's list (display data only), and the person's changes, each a daemon call here.
  handle('desktop:servers', async (fresh) => (fresh === true ? servers.refresh() : servers.view()));
  answer('desktop:servers-do', async (what, arg) => {
    const a = arg && typeof arg === 'object' ? arg : {};
    switch (what) {
      case 'add':
        return servers.add({ host: String(a.host ?? ''), name: typeof a.name === 'string' ? a.name : '', insecure: a.insecure === true });
      case 'cancel':
        return servers.cancel();
      case 'dismiss':
        return servers.dismiss();
      case 'default':
        return servers.setDefault(String(a.name ?? ''));
      case 'publish':
        return servers.setPublish(a.on === true);
      case 'answer-ask':
        return servers.answerAsk(a.on === true);
      case 'remove':
        return servers.remove(String(a.name ?? ''), a.force === true);
      case 'home':
        return { id: await openServerHome(String(a.name ?? '')) };
      case 'approve-page': {
        // The site's approval page for the sign-in under way, in the system browser (test mode: only logged).
        const link = servers.adding?.state === 'waiting' ? servers.adding.verificationUri : '';
        if (!/^https?:\/\//.test(link)) throw new Error('no sign-in under way');
        openExternal(link);
        return true;
      }
      case 'open-in-desktop':
        return servers.setOpenInDesktop(a.on === true);
      default:
        throw new Error(`not a servers action: ${what}`);
    }
  });
  handle('desktop:choose-folder', async () => {
    if (profile.testMode) {
      log('choose folder (test mode: no dialog)');
      return settingsView();
    }
    const current = settings.get('artifactsFolder') || libraryDefaultFolder(profile.home);
    const picked = await dialog.showOpenDialog(window, { defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
    if (!picked.canceled && picked.filePaths[0]) {
      settings.set('artifactsFolder', folderArg(picked.filePaths[0]));
      log(`setting artifactsFolder = ${settings.get('artifactsFolder')}`);
      send();
    }
    return settingsView();
  });
  // Opens the app again (a changed language takes effect then), with the arguments it was started with.
  handle('desktop:relaunch', () => {
    if (profile.testMode) {
      log(`relaunch ${JSON.stringify(process.argv.slice(1))} (test mode: not done)`);
      return false;
    }
    log('relaunch');
    app.relaunch({ args: process.argv.slice(1) });
    app.quit();
    return true;
  });
  handle('desktop:reveal-home', () => system.reveal(profile.home));

  // ---- the service panel and the runtime's updates ----
  handle('desktop:service', async (refresh) => {
    if (refresh === true) await service.refresh();
    return service.view();
  });
  answer('desktop:service-do', async (act, arg) => {
    switch (act) {
      case 'restart':
        return service.restart();
      case 'stop':
        return service.stop();
      case 'start':
        return service.start();
      case 'restart-type':
        return service.restartType(arg);
      case 'logs':
        return service.openLogs();
      case 'reveal-home':
        return service.revealHome();
      case 'doctor':
        return service.runDoctor();
      case 'others':
        await service.refresh();
        return service.others();
      default:
        throw new Error(`not a service action: ${act}`);
    }
  });
  handle('desktop:runtime', async (refresh) => {
    if (refresh === true) await runtime.refresh();
    return runtime.view();
  });
  answer('desktop:runtime-do', async (act, arg) => {
    switch (act) {
      case 'check':
        return runtime.check();
      case 'update':
        return runtime.update();
      case 'later':
        return runtime.later();
      case 'reopen':
        return runtime.reopen();
      case 'close':
        return runtime.closeDone();
      case 'checking':
        return runtime.setChecking(arg === true);
      default:
        throw new Error(`not a runtime action: ${act}`);
    }
  });
  // Keyboard focus back to the window's own page (from an artifact's view), for the search field.
  handle('desktop:focus', () => {
    window.webContents.focus();
    return true;
  });

  answer('library:list', () => library.list());
  answer('library:update', (id, patch) => library.update(idArg(id), patchArg(patch)));
  answer('library:remove', async (id) => {
    const out = await library.remove(idArg(id));
    if (tabs.tabs.has(id)) await tabs.close(id);
    return out;
  });
  answer('library:restore', (trash) => library.restore(trash));
  answer('library:create', async (request) => {
    const asked = createArg(request);
    // Under the folder chosen in Settings, named as the daemon would name it; else where the daemon puts new ones.
    const base = settings.get('artifactsFolder');
    const made = await library.create({ ...asked, ...(base ? { folder: newArtifactFolder(base, asked.title || asked.type) } : {}) });
    await openTab(made.id);
    return { id: made.id, title: made.title ?? '' };
  });
  answer('library:capture', async (id, type) => {
    const page = await library.preview(idArg(id));
    if (!page) throw new Error('no preview page');
    return photographer.take(page, typeof type === 'string' ? type : '');
  });
  answer('library:save-thumbnail', async (id, version, jpeg) => {
    if (!(jpeg instanceof Uint8Array) || jpeg.length < 4 || jpeg.length > JPEG_MAX) throw new Error('not a picture');
    if (typeof version !== 'string' || version.length > 100) throw new Error('not a version');
    return thumbnailStamp(await library.saveThumbnail(idArg(id), version, jpeg));
  });
  answer('library:copy', (text) => {
    if (typeof text !== 'string' || text.length > 4096) throw new Error('not a link');
    clipboard.writeText(text);
    return true;
  });

  // ---- the commands: what the menu bar, the cards' and the sidebar's menus run, each by name ----

  /** Test mode: the paths the next folder or file dialogs pick (`test.pickNext`). */
  const picks = [];
  /** To the window's page: open a dialog or panel of its own, or say something (`toast`). */
  const toPage = (name, arg) => {
    if (!window.isDestroyed()) window.webContents.send('desktop:command', { name, ...(arg === undefined ? {} : { arg }) });
  };
  /**
   * Says how something went: the home page's toast while the library is in front, else the notice over the tab's view
   * (which is drawn over the window's page, toast and all).
   */
  const say = (message, kind = 'info') => {
    if (tabs.current === HOME_TAB) return toPage('toast', { message, kind });
    void notice.say({ message, kind });
  };
  /** The artifact in front (null on the home page). */
  // A server's home page (`site:<name>`) is no artifact: nothing to reveal, move or reload as one.
  const currentArtifact = () => (tabs.current === HOME_TAB || SITE_TAB.test(tabs.current) ? null : tabs.current);
  /** The page the Edit and View items act on: the dialog's or the home page's (the window's own), else the tab's. */
  const targetContents = () => (tabs.overlay ? null : tabs.currentView()?.webContents) ?? window.webContents;
  /**
   * A folder or file the person picks with the system's dialog; in test mode no dialog is shown: the test gives the
   * path (`given`), else nothing is picked.
   */
  const pick = async (given, { file = false, title = '' } = {}) => {
    if (profile.testMode) {
      if (typeof given === 'string' && isAbsolute(given)) return given;
      // A button of the page's (Relocate…) names no path: the test said beforehand what to pick (`test.pickNext`).
      const next = picks.shift();
      if (next) {
        log(`choose ${file ? 'file' : 'folder'} (test mode: the test's ${next})`);
        return next;
      }
      log(`choose ${file ? 'file' : 'folder'} (test mode: no dialog)`);
      return null;
    }
    const picked = await dialog.showOpenDialog(window, {
      title,
      properties: file ? ['openFile'] : ['openDirectory', 'createDirectory'],
      ...(file ? { filters: [{ name: 'Zip', extensions: ['zip'] }] } : {}),
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  };
  /** Waits (up to `ms`) until the tab of `id` has nothing unsaved; false when it still has. */
  const savedNow = async (id, ms = 10_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (!unsavedOf(tabs.tabs.get(id))) return true;
      if (Date.now() > deadline) return false;
      await new Promise((done) => setTimeout(done, 100));
    }
  };
  const artifactArg = (arg) => {
    const id = typeof arg === 'string' ? arg : typeof arg?.id === 'string' ? arg.id : currentArtifact();
    if (!id) throw new Error('no artifact in front');
    return idArg(id);
  };
  const zoom = (by) => {
    const contents = targetContents();
    const level = by === 0 ? 0 : Math.max(-5, Math.min(5, contents.getZoomLevel() + by));
    contents.setZoomLevel(level);
    log(`zoom ${level}`);
    return level;
  };
  const edit = (method) => () => {
    const contents = targetContents();
    contents[method]();
    log(`edit ${method} on ${contents === window.webContents ? 'the window' : `tab ${tabs.current}`}`);
    return true;
  };
  const makeOfType = async (type) => {
    const asked = createArg({ type, title: '' });
    const base = settings.get('artifactsFolder');
    const made = await library.create({ ...asked, ...(base ? { folder: newArtifactFolder(base, asked.type) } : {}) });
    await openTab(made.id);
    return { id: made.id };
  };

  const commands = {
    about: () => {
      log(`about${profile.testMode ? ' (test mode: not shown)' : ''}`);
      if (!profile.testMode) app.showAboutPanel();
      return true;
    },
    settings: () => (toPage('settings'), true),
    // "Install as app" of an artifact (the one named, else the one in front): the window's dialog asks the rest.
    'install-app': (arg) => (toPage('install-app', { id: artifactArg(arg) }), true),
    'new-dialog': () => (toPage('new-dialog'), true),
    'open-folder': async (arg) => {
      const folder = await pick(arg, { title: t('menu.openFolder') });
      if (!folder) return null;
      try {
        const made = await library.add(folder);
        await openTab(made.id);
        say(t('add.done', { title: made.title || basename(folder) }));
        return { id: made.id };
      } catch (error) {
        say(t('add.failed', { message: error?.message ?? String(error) }), 'error');
        throw error;
      }
    },
    import: async (arg) => {
      const file = await pick(arg, { file: true, title: t('menu.import') });
      if (!file) return null;
      try {
        const made = await library.importZip(readFileSync(file), basename(file));
        await openTab(made.id);
        say(t('import.done', { title: made.title || basename(file) }));
        return { id: made.id };
      } catch (error) {
        say(t('import.failed', { message: error?.message ?? String(error) }), 'error');
        throw error;
      }
    },
    reveal: async (arg) => {
      const record = await library.record(artifactArg(arg));
      return system.reveal(record.root);
    },
    move: async (arg) => {
      const id = artifactArg(arg);
      const into = await pick(arg?.into, { title: t('menu.move') });
      if (!into) return null;
      const open = tabs.tabs.has(id);
      // Said once the tab is back, so it is said over the tab when the tab is in front.
      let said = null;
      try {
        if (open) {
          if (!(await savedNow(id))) throw new Error('it still has changes that are not saved');
          await tabs.close(id);
        }
        const moved = await moveArtifact({ library, id, into, log });
        said = [t('move.done', { folder: basename(into) }), 'info'];
        return moved;
      } catch (error) {
        said = [t('move.failed', { message: error?.message ?? String(error) }), 'error'];
        throw error;
      } finally {
        if (open) await openTab(id).catch((error) => log(`open ${id}: ${error?.message ?? error}`));
        if (said) say(...said);
      }
    },
    'close-tab': () => {
      const id = currentArtifact();
      return id ? requestClose(id) : false;
    },
    reload: () => {
      const id = currentArtifact();
      return id ? reloadTab(id) : false;
    },
    // A tab whose folder is gone: the person picks where it went, the library is told, the tab opens from there.
    relocate: async (arg) => {
      const id = artifactArg(arg);
      const folder = await pick(arg?.folder, { title: t('missing.relocate') });
      if (!folder) return null;
      const moved = await library.relocate(id, folder);
      log(`relocate ${id}: ${moved?.root ?? folder}`);
      if (tabs.tabs.get(id)?.status === 'missing') await tabs.found(id);
      else if (!tabs.tabs.has(id)) await openTab(id);
      void describe(id);
      return { id, root: typeof moved?.root === 'string' ? moved.root : folder };
    },
    'toggle-sidebar': () => {
      settings.set('sidebarCollapsed', !settings.get('sidebarCollapsed'));
      tabs.layout();
      log(`sidebar ${settings.get('sidebarCollapsed') ? 'collapsed' : 'open'}`);
      send();
      return settings.get('sidebarCollapsed');
    },
    'zoom-reset': () => zoom(0),
    'zoom-in': () => zoom(0.5),
    'zoom-out': () => zoom(-0.5),
    fullscreen: () => {
      // A test window is never shown: going full screen would take a Space of the person's screen.
      if (profile.testMode) return (log('full screen (test mode: not done)'), false);
      window.setFullScreen(!window.isFullScreen());
      return window.isFullScreen();
    },
    'previous-tab': () => travel(tabs.neighbour(-1)),
    'next-tab': () => travel(tabs.neighbour(1)),
    logs: () => service.openLogs(),
    doctor: async () => {
      toPage('service');
      const out = await service.runDoctor();
      return out.report ? { counts: out.report.counts, ok: out.report.ok } : { error: out.error ?? 'no report' };
    },
    'edit:undo': edit('undo'),
    'edit:redo': edit('redo'),
    'edit:cut': edit('cut'),
    'edit:copy': edit('copy'),
    'edit:paste': edit('paste'),
    'edit:paste-plain': edit('pasteAndMatchStyle'),
    'edit:delete': edit('delete'),
    'edit:select-all': edit('selectAll'),
  };
  /** Commands that need an artifact in front, and those that need the daemon. */
  const NEEDS_ARTIFACT = new Set(['reveal', 'move', 'close-tab', 'reload', 'install-app']);
  const NEEDS_DAEMON = new Set(['new-dialog', 'open-folder', 'import', 'reveal', 'move', 'relocate', 'doctor']);
  const enabled = (name) => {
    if (NEEDS_ARTIFACT.has(name) && !currentArtifact()) return false;
    if ((NEEDS_DAEMON.has(name) || name.startsWith('new:')) && !harness.connected) return false;
    return true;
  };
  /** Runs a command; `named`: an artifact is named (a card's, a row's), so none need be in front. */
  const runCommand = async (name, arg, { named = false } = {}) => {
    const run = name.startsWith('new:') ? () => makeOfType(name.slice(4)) : commands[name];
    if (!run) throw new Error(`not a command: ${name}`);
    if (named ? !harness.connected : !enabled(name)) throw new Error(`${name} cannot run now`);
    log(`command ${name}`);
    return run(arg);
  };
  /** A menu item's click: a failure is logged (and said by the command), never thrown into Electron. */
  const fromMenu = (name, arg) => {
    void runCommand(name, arg).catch((error) => log(`command ${name}: ${error?.message ?? error}`));
  };

  function refreshMenu(force = false) {
    if (!menuReady) return;
    const key = JSON.stringify([currentArtifact() !== null, harness.connected, menuTypes.map((type) => [type.id, type.title])]);
    if (!force && key === menuKey) return;
    menuKey = key;
    const template = menuTemplate({ t, types: menuTypes, run: fromMenu, enabled, appName: 'Open Artifact' });
    for (const name of templateCommands(template)) if (!name.startsWith('new:') && !commands[name]) log(`menu: no command ${name}`);
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
  async function refreshTypes() {
    try {
      const { types } = await library.list();
      menuTypes = (types ?? []).map((type) => ({ id: type.id, title: type.title }));
    } catch (error) {
      log(`menu types: ${error?.message ?? error}`);
    }
    refreshMenu(true);
  }
  menuReady = true;
  refreshMenu(true);

  // ---- "install as app": an artifact as an app of its own (`installed-apps.mjs`). The window's dialog
  // (`InstallAppDialog.jsx`, from a card's menu, a sidebar row's, a tab's, or File → Install as App…) asks the state
  // when it opens and makes these calls. ----
  const installDir = installDirOf(homedir());
  /** Test mode: a step an install, uninstall or rebuild waits at until the test lets it go (`test.appsHold`). */
  let appsHold = null;
  const installedApps = new InstalledApps({
    home: profile.home,
    installDir,
    template: {
      bundlePath: app.isPackaged ? bundleOfExecutable(process.execPath) : null,
      executable: process.execPath,
      // What a copy is "stale" against: this app and the runtime it carries.
      version: () => `${app.getVersion()}+${carriedVersion}`,
    },
    packaged: app.isPackaged,
    library: { record: (id) => library.record(id), types: () => library.call(LIBRARY_ROUTES.types) },
    // The Trash is the Finder's (`shell.trashItem`); test mode never calls it (`macosOps` removes the test's own package).
    ops: macosOps({ installDir, iconsDir: join(process.resourcesPath ?? appRoot, 'app-icons'), testMode: profile.testMode, log, trashItem: profile.testMode ? null : (path) => shell.trashItem(path) }),
    checkpoint: async (step) => {
      if (!profile.testMode || appsHold?.step !== step) return;
      log(`installed apps: held at ${step} (test mode)`);
      await appsHold.released;
    },
    log,
  });
  const installArg = (value) => ({
    ...(typeof value?.confirmedName === 'string' ? { confirmedName: value.confirmedName } : {}),
    allowCopy: value?.allowCopy === true,
  });
  const installIdArg = (value) => {
    if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) throw new Error('not an install id');
    return value;
  };
  answer('desktop:apps.state', (id) => installedApps.state(idArg(id)));
  answer('desktop:apps.install', (id, options) => installedApps.install(idArg(id), installArg(options)));
  answer('desktop:apps.open', (id, installId) => installedApps.open(idArg(id), installIdArg(installId)));
  answer('desktop:apps.reveal', async (id, installId) => system.reveal(await installedApps.revealPath(idArg(id), installIdArg(installId))));
  answer('desktop:apps.uninstall', (id, installId) => installedApps.uninstall(idArg(id), installIdArg(installId)));
  answer('desktop:apps.refresh', (id, installId, options) => installedApps.refresh(idArg(id), installIdArg(installId), { allowCopy: options?.allowCopy === true }));
  answer('desktop:apps.repair', (id, installId, options) => installedApps.repair(idArg(id), installIdArg(installId), { allowCopy: options?.allowCopy === true }));
  answer('desktop:apps.forget', (id, installId) => installedApps.forgetRecord(idArg(id), installIdArg(installId)));
  // What a call cut short left (a quit, a crash) is put right at start, then the apps the desktop app changed since
  // are rebuilt (those that do not run), one after the other; nothing here waits on it.
  void installedApps
    .reconcileAll()
    .then(() => installedApps.refreshStale())
    .then((out) => Object.keys(out).length && log(`installed apps: refreshed at start ${JSON.stringify(out)}`))
    .catch((error) => log(`installed apps: ${error?.message ?? error}`));

  answer('desktop:artifact-do', (act, id) => {
    if (act !== 'reveal' && act !== 'move' && act !== 'relocate') throw new Error(`not an artifact action: ${act}`);
    return runCommand(act, { id: idArg(id) }, { named: true });
  });

  // Test mode only: a command by name, the menu as built, the notice, what --offline refused.
  if (profile.testMode) {
    answer('test:command', (name, arg) => runCommand(String(name), arg ?? undefined));
    handle('test:menu', () => describeMenu(Menu.getApplicationMenu()));
    handle('test:notice', () => notice.state());
    handle('test:blocked', () => blocked.slice());
    handle('test:downloads', () => downloads.folder);
    // A tab's view as Electron made it: its session's partition, its preload (none) and the address it shows.
    handle('test:tab-info', (id) => {
      const tab = tabs.tabs.get(String(id));
      const contents = tab?.view?.webContents;
      if (!contents || contents.isDestroyed()) return null;
      const prefs = contents.getLastWebPreferences?.() ?? {};
      return {
        kind: tab.kind,
        server: tab.server,
        url: contents.getURL(),
        partition: contents.session === session.fromPartition(SERVER_PARTITION) ? SERVER_PARTITION : contents.session === session.fromPartition(PARTITION) ? PARTITION : 'other',
        preload: prefs.preload ?? null,
        preloads: contents.session.getPreloads?.() ?? [],
        sandbox: prefs.sandbox === true,
        nodeIntegration: prefs.nodeIntegration === true,
        ticket: tab.ticket ?? null,
      };
    });
    handle('test:servers', () => ({ view: servers.view(), servers: [...allowlist.servers] }));
    // "Install as app": hold the next call at a step (`installing`'s state is then what the dialog shows), then let it go.
    handle('test:apps-hold', (step) => {
      appsHold?.release();
      let release;
      const released = new Promise((done) => (release = done));
      appsHold = { step: String(step), released, release };
      return true;
    });
    handle('test:apps-release', () => {
      const held = appsHold;
      appsHold = null;
      held?.release();
      return !!held;
    });
    // What the Shell said of a tab's saving, set by a test (`{ state, leaveLosesWork }`), so a test does not wait on timing.
    handle('test:saved', (id, saved) => {
      // null: as a tab whose Shell never said anything of its saving.
      if (saved === null) return tabs.setSaved(idArg(String(id)), null);
      const state = saved?.state;
      if (!['saved', 'saving', 'unsaved', 'error'].includes(state)) throw new Error('not a saved state');
      return tabs.setSaved(idArg(String(id)), { state, leaveLosesWork: saved.leaveLosesWork === true });
    });
    handle('test:pick-next', (path) => {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('not an absolute path');
      picks.push(path);
      return picks.length;
    });
    // macOS's open-url, called as the system would (no system involved).
    handle('test:open-url', (url) => takeLink(String(url), 'open-url'));
    // ⌘Q: asked about as the person's would be; `force`: let it go without asking (a test's cleanup).
    // The window's close button, as the person's click would close it (the main process's close: it can be held).
    handle('test:close-window', () => {
      window.close();
      return true;
    });
    handle('test:quit', (force) => {
      if (force === true) quitAllowed = true;
      app.quit();
      return true;
    });
    commands['open-url'] = (url) => takeLink(String(url ?? ''), 'command');
  }

  if (harness.connected && !(await refreshOrigins())) return;
  tabs.setConnected(harness.connected);
  if (harness.connected) void service.refresh();
  void runtime.refresh();
  // The page asked before the connection was there: now it can list the library.
  if (harness.connected) libraryEvent({ type: 'connected' });
  if (harness.connected) void refreshTypes();
  if (harness.connected) servers.start();

  window.on('closed', () => app.quit());
  app.on('before-quit', (event) => {
    // ⌘Q with unsaved work: waited for, then asked about; the app quits once that is settled.
    if (!quitAllowed && unsavedTabs().length) {
      event.preventDefault();
      void confirmQuit();
      return;
    }
    quitAllowed = true;
    service.close();
    runtime.close();
    photographer.closeAll();
    notice.close();
    tabs.closeAll();
    harness.close();
  });

  const state = harness.client.state;
  log(`ready ${JSON.stringify({ daemon: state ? { pid: state.pid, url: state.url, version: state.version } : null, features: harness.features.includes('view.open') })}`);
  // What asked to be opened so far (the arguments, open-url, a second start), then what asks from now on.
  toFront = () => {
    if (window.isDestroyed()) return;
    if (profile.testMode) return log('second start: the window would come to the front (test mode: not shown)');
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    app.focus({ steal: true });
  };
  receive = (ref, from) => void openTab(ref).catch((error) => log(`open ${ref} (${from}): ${error?.message ?? error}`));
  for (const { ref, from } of incoming.splice(0)) {
    await openTab(ref).catch((error) => log(`open ${ref} (${from}): ${error?.message ?? error}`));
  }
}
