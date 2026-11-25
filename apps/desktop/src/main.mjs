/**
 * Open Artifact Desktop, the skeleton (stage 1.2): one window with a tab bar, one `WebContentsView` per artifact.
 *
 * The app is a host with no agent: it connects with `createHarness({ harness: 'open-artifact-desktop' })`, attaches no
 * session and registers no `wake`. It carries its own runtime (`resources/runtime`, the `@open-artifact/cli` folder)
 * and the kit starts the daemon with this app's executable and ELECTRON_RUN_AS_NODE=1, detached, so the daemon outlives
 * the app (other agent apps share it) and no Node.js needs to be installed. The daemon's token stays in this process.
 *
 * Order of things: the profile (home, port, Electron's folders) is decided and checked first (`profile.mjs`), before
 * Electron is ready and before anything connects; then the window, then the connection, then the tabs.
 *
 *   electron . --home <dir> --port <n> [--open <artifact id>]… [--test-mode --devtools-port <n>]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { createHarness, readDaemon, runtimeInfo } from '@open-artifact/harness-kit';
import { daemonEnv, daemonOnDefaultPort, resolveProfile } from './profile.mjs';
import { OriginAllowlist } from './navigation.mjs';
import { HOME_TAB, Tabs } from './tabs.mjs';

// The bundle is out/main.mjs: the renderer and the resources are beside out/.
const here = import.meta.dirname;
const appRoot = join(here, '..');
/** The height of the window's own bar (renderer/chrome.css `--bar-height`). */
const BAR_HEIGHT = 40;

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

const runtimeDir = app.isPackaged ? join(process.resourcesPath, 'runtime') : join(appRoot, 'resources', 'runtime');

/** Links out: the system browser; in test mode only logged. */
const openExternal = (url) => {
  log(`external ${url}`);
  if (!profile.testMode) void shell.openExternal(url);
};

app.on('window-all-closed', () => app.quit());

app.whenReady().then(start, fail);

function fail(error) {
  console.error(`[desktop] ${error?.stack ?? error}`);
  app.exit(1);
}

async function start() {
  log(`profile ${JSON.stringify({ home: profile.home, port: profile.port, packaged: profile.packaged, testMode: profile.testMode, paths: profile.paths })}`);
  if (profile.testMode && process.platform === 'darwin') app.dock?.hide();

  const info = runtimeInfo(runtimeDir);
  if (!info?.version) throw new Error(`No Open Artifact runtime in ${runtimeDir}: run npm run build in apps/desktop.`);

  // A daemon already runs for this home: a development build must not connect to one on 4800.
  if (!profile.packaged && daemonOnDefaultPort(await readDaemon(profile.home))) {
    throw new Error(`The daemon of ${profile.home} listens on port 4800; this development build does not connect to it.`);
  }

  // Nothing here may ask for a permission, and the bar's own page never navigates.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    title: 'Open Artifact',
    show: !profile.testMode,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: !profile.testMode,
    },
  });
  const chromeUrl = new URL(`file://${join(appRoot, 'renderer', 'index.html')}`).href;
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadFile(join(appRoot, 'renderer', 'index.html'));

  const allowlist = new OriginAllowlist();
  const harness = await createHarness({
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

  const send = (state) => {
    if (!window.isDestroyed()) window.webContents.send('desktop:state', state);
  };
  const tabs = new Tabs({ window, harness, allowlist, topInset: () => BAR_HEIGHT, onChange: send, openExternal, log, testMode: profile.testMode });

  harness.on('event', (event) => {
    if (event.type === 'embed/origins') allowlist.fromDaemon(event);
  });
  harness.on('state', (state) => {
    log(`connection ${state}`);
    if (state === 'connected') void refreshOrigins().then((ok) => ok && tabs.setConnected(true));
    else tabs.setConnected(false);
  });
  if (harness.connected && !(await refreshOrigins())) return;
  tabs.setConnected(harness.connected);

  // ---- the bar's calls: only from this window's own page ----
  const fromChrome = (event) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === chromeUrl;
  const handle = (channel, run) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromChrome(event)) {
        log(`refused ${channel} from ${event.senderFrame?.url ?? '?'}`);
        throw new Error('not allowed');
      }
      return run(...args);
    });
  handle('desktop:state', () => tabs.snapshot());
  handle('desktop:open', async (ref) => {
    try {
      return { ok: true, id: await tabs.open(ref) };
    } catch (error) {
      log(`open ${ref}: ${error?.message ?? error}`);
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
  handle('desktop:select', (id) => tabs.select(id));
  handle('desktop:close', (id) => (id === HOME_TAB ? false : tabs.close(id)));
  handle('desktop:reload', (id) => tabs.reload(id));

  window.on('closed', () => app.quit());
  app.on('before-quit', () => {
    tabs.closeAll();
    harness.close();
  });

  const state = harness.client.state;
  log(`ready ${JSON.stringify({ daemon: state ? { pid: state.pid, url: state.url, version: state.version } : null, features: harness.features.includes('view.open') })}`);
  for (const ref of profile.open) {
    await tabs.open(ref).catch((error) => log(`open ${ref}: ${error?.message ?? error}`));
  }
}
