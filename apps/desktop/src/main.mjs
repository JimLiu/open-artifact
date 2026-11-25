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
 * (`history.mjs`), whether the sidebar is collapsed (the app's settings, `settings.mjs`), the look (light or dark,
 * following the system) and the language (the system's: Chinese or English). The page draws what it is sent.
 *
 * Order of things: the profile (home, port, Electron's folders) is decided and checked first (`profile.mjs`), before
 * Electron is ready and before anything connects; then the window, then the connection, then the tabs.
 *
 *   electron . --home <dir> --port <n> [--open <artifact id>]…
 *              [--test-mode --devtools-port <n> [--locale en|zh] [--theme light|dark] [--thumbnails]]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, session, shell } from 'electron';
import { createHarness, readDaemon, runtimeInfo } from '@open-artifact/harness-kit';
import { thumbnailStamp } from '@open-artifact/library-page/library';
import { daemonEnv, daemonOnDefaultPort, resolveProfile } from './profile.mjs';
import { OriginAllowlist } from './navigation.mjs';
import { HOME_TAB, Tabs } from './tabs.mjs';
import { TabHistory } from './history.mjs';
import { Settings } from './settings.mjs';
import { createArg, idArg, libraryClient, patchArg } from './library.mjs';
import { Photographer, registerThumbnailScheme, serveThumbnails } from './thumbnails.mjs';

// The bundle is out/main.mjs: the window's page is out/renderer/, the resources are beside out/.
const here = import.meta.dirname;
const appRoot = join(here, '..');
/** The height of the tab bar (renderer `--bar-height`). */
const BAR_HEIGHT = 40;
/** The sidebar's width when it is open (renderer `--sidebar-width`). */
const SIDEBAR_WIDTH = 240;
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
if (profile.testMode) {
  if (profile.debugPort) app.commandLine.appendSwitch('remote-debugging-port', String(profile.debugPort));
  // Never in the person's way: no Dock icon, no activation, no shown window.
  if (process.platform === 'darwin') app.setActivationPolicy?.('accessory');
}
registerThumbnailScheme();

const runtimeDir = app.isPackaged ? join(process.resourcesPath, 'runtime') : join(appRoot, 'resources', 'runtime');

/** Links out: the system browser; in test mode only logged. */
const openExternal = (url) => {
  log(`external ${url}`);
  if (!profile.testMode) void shell.openExternal(url);
};

/** The system's language, as the page has words for it: Chinese or English. */
function systemLocale() {
  if (profile.locale) return profile.locale;
  const preferred = app.getPreferredSystemLanguages?.()[0] ?? app.getLocale();
  return /^zh\b/i.test(preferred ?? '') ? 'zh' : 'en';
}

app.on('window-all-closed', () => app.quit());

app.whenReady().then(start, fail);

function fail(error) {
  console.error(`[desktop] ${error?.stack ?? error}`);
  app.exit(1);
}

async function start() {
  log(`profile ${JSON.stringify({ home: profile.home, port: profile.port, packaged: profile.packaged, testMode: profile.testMode, paths: profile.paths })}`);
  if (profile.testMode && process.platform === 'darwin') app.dock?.hide();
  // A test run may ask for a look; otherwise the system's, and the views follow the same.
  if (profile.theme) nativeTheme.themeSource = profile.theme;

  const info = runtimeInfo(runtimeDir);
  if (!info?.version) throw new Error(`No Open Artifact runtime in ${runtimeDir}: run npm run build in apps/desktop.`);

  // A daemon already runs for this home: a development build must not connect to one on 4800.
  if (!profile.packaged && daemonOnDefaultPort(await readDaemon(profile.home))) {
    throw new Error(`The daemon of ${profile.home} listens on port 4800; this development build does not connect to it.`);
  }

  // Nothing here may ask for a permission, and the window's own page never navigates.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const settings = new Settings(app.getPath('userData'), { log });
  const locale = systemLocale();
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
  const chromeUrl = new URL(`file://${pagePath}`).href;
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  // The thumbnail scheme before the page: a page knows only the schemes its session handled when it loaded.
  let harness = null;
  const library = libraryClient({ state: () => harness?.client.state ?? null });
  serveThumbnails(library, log);
  // Until the connection is made, the page's question for the state is answered "not yet" (null), so it asks again.
  ipcMain.handle('desktop:state', (event) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== chromeUrl) throw new Error('not allowed');
    return null;
  });
  // The page first (it waits for this process's answers), so the window is not empty while the daemon starts.
  await window.loadFile(pagePath);

  const allowlist = new OriginAllowlist();
  harness = await createHarness({
    harness: 'open-artifact-desktop',
    // The runtime this app carries; updates are offered, never installed without the person (a later stage).
    runtime: { dir: runtimeDir, version: info.version, update: 'prompt' },
    home: profile.home,
    daemon: { env: daemonEnv(process.env, profile), timeoutMs: 60_000 },
    // Views of its own (`view.open` gives a ticket only to `embed: 'view'`); a remote type's page is not shown yet.
    embed: { origins: [], mode: 'view', remote: 'deny' },
    // Opens asked for by an agent's session never come here (this app attaches none): nothing is shown for them.
    open: () => false,
    reconnect: { minMs: 500, maxMs: 5000 },
    log: (line) => log(`kit: ${line}`),
  });
  const photographer = new Photographer({ allowlist, log });

  /** The daemon's origin and the page origins it lists; refused when a development build reached a daemon on 4800. */
  const refreshOrigins = async () => {
    const state = harness.client.state;
    if (!profile.packaged && daemonOnDefaultPort(state)) {
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
  const snapshot = () => ({
    ...tabs.snapshot(),
    canBack: history.canBack,
    canForward: history.canForward,
    sidebarCollapsed: settings.get('sidebarCollapsed'),
    look: look(),
    /** Thumbnails are taken only while the window is on screen (or a test asks for them). */
    thumbnails: profile.thumbnails || (window.isVisible() && !window.isMinimized()),
  });
  const send = () => {
    if (window.isDestroyed()) return;
    // Back and forward follow every tab the person goes to, and forget the ones that closed.
    const open = new Set([HOME_TAB, ...tabs.tabs.keys()]);
    for (const id of new Set(history.entries)) if (!open.has(id)) history.remove(id, HOME_TAB);
    if (!travelling) history.visit(tabs.current);
    window.webContents.send('desktop:state', snapshot());
  };
  tabs = new Tabs({
    window,
    harness,
    allowlist,
    topInset: () => BAR_HEIGHT,
    leftInset: () => (settings.get('sidebarCollapsed') ? 0 : SIDEBAR_WIDTH),
    onChange: send,
    openExternal,
    log,
    testMode: profile.testMode,
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
  const describe = async (id) => {
    try {
      const artifact = await library.artifact(id);
      tabs.setInfo(id, { title: artifact.title, type: artifact.type });
    } catch (error) {
      log(`artifact ${id}: ${error?.message ?? error}`);
    }
  };
  const openTab = async (ref) => {
    const id = await tabs.open(ref);
    void describe(id);
    return id;
  };
  const libraryEvent = (event) => {
    if (!window.isDestroyed()) window.webContents.send('desktop:library', event);
  };

  harness.on('event', (event) => {
    if (event.type === 'embed/origins') allowlist.fromDaemon(event);
    if (event.type === 'artifacts/changed' && typeof event.id === 'string') {
      // The page's list reloads; an open tab of it follows a rename, and closes when it was deleted.
      if (tabs.tabs.has(event.id)) {
        if (event.removed) void tabs.close(event.id);
        else void describe(event.id);
      }
      libraryEvent({ type: event.type, id: event.id, removed: !!event.removed });
    } else if (event.type === 'types/changed') {
      libraryEvent({ type: event.type });
    }
  });
  harness.on('state', (state) => {
    log(`connection ${state}`);
    if (state === 'connected') {
      void refreshOrigins().then((ok) => {
        if (!ok) return;
        tabs.setConnected(true);
        libraryEvent({ type: 'connected' });
      });
    } else {
      tabs.setConnected(false);
      libraryEvent({ type: 'disconnected' });
    }
  });
  for (const name of ['show', 'hide', 'minimize', 'restore']) window.on(name, send);
  nativeTheme.on('updated', send);

  // ---- the window's calls: only from its own page ----
  const fromChrome = (event) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === chromeUrl;
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
  handle('desktop:open', async (ref) => {
    try {
      return { ok: true, id: await openTab(ref) };
    } catch (error) {
      log(`open ${ref}: ${error?.message ?? error}`);
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
  handle('desktop:select', (id) => tabs.select(String(id)));
  handle('desktop:close', (id) => (id === HOME_TAB ? false : tabs.close(String(id))));
  handle('desktop:reload', (id) => tabs.reload(String(id)));
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
    const made = await library.create(createArg(request));
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

  if (harness.connected && !(await refreshOrigins())) return;
  tabs.setConnected(harness.connected);
  // The page asked before the connection was there: now it can list the library.
  if (harness.connected) libraryEvent({ type: 'connected' });

  window.on('closed', () => app.quit());
  app.on('before-quit', () => {
    photographer.closeAll();
    tabs.closeAll();
    harness.close();
  });

  const state = harness.client.state;
  log(`ready ${JSON.stringify({ daemon: state ? { pid: state.pid, url: state.url, version: state.version } : null, features: harness.features.includes('view.open') })}`);
  for (const ref of profile.open) {
    await openTab(ref).catch((error) => log(`open ${ref}: ${error?.message ?? error}`));
  }
}
