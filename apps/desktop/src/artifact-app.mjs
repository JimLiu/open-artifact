/**
 * An artifact installed as an app (`installed-apps.mjs`): the desktop app's own package, copied, that carries
 * `Contents/Resources/artifact-app.json` (`{ installId, artifactId, home, … }`). `start.mjs` runs this instead of the
 * desktop app (`main.mjs`) when that file is there. One window, one artifact (`artifact-window.mjs`), no sidebar, no
 * tabs, no library.
 *
 * - **Its profile** (`resolveArtifactAppProfile`): the home is the file's, never `--home` or `$OPEN_ARTIFACT_HOME`;
 *   Electron's folders are `<home>/desktop/apps/<installId>/` in every run, so its single-instance lock is its own (a
 *   second start of it exits; the desktop app and other artifacts' apps run beside it). Test mode's guards are the
 *   desktop app's (`--test-mode` needs a home of its own and a port that is not 4800).
 * - **Before it connects**, its install record is checked (`checkLaunch`: there, `installed`, the same `installId` and
 *   `artifactId`, for this very package): otherwise the window says it needs repair and nothing is started. Once
 *   connected, the artifact must still be in the library with its folder: otherwise the window says which.
 * - **The daemon** is the home's, shared with the desktop app and the agents. When none runs, it is started with the
 *   desktop app's own executable and runtime (the package the record names, `templatePath`), else this package's own:
 *   `ELECTRON_RUN_AS_NODE=1`, detached, its output appended to `<home>/logs/daemon.out`, as the kit itself would.
 * - **The harness** is `open-artifact-app`: the daemon gives it views (`embed: 'view'`, an `open` that never shows
 *   anything), and never hands it an agent's open (the daemon hands those only to `open-artifact-desktop`).
 * - **Leaving the artifact** (another artifact's link, Duplicate's new artifact, the library, the menu's "Open Library")
 *   is the desktop app's: it is started (or the running one asked) with `--home` and `--open`. Test mode only logs it
 *   (`hand-off {…}`) and keeps it for the test (`test.info().handoffs`).
 * - **The look and the language** are the desktop app's settings (its `settings.json`), read when the app starts.
 * - **The menu bar's bold name** stays "Open Artifact" (the package's `CFBundleName`, which Electron needs to find its
 *   helpers); the Dock, ⌘Tab and the Finder show the artifact's name (`CFBundleDisplayName`).
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } from 'electron';
import { createHarness, readDaemon, runtimeInfo } from '@open-artifact/harness-kit';
import { bundleOfExecutable, daemonEnv, daemonOnDefaultPort, desktopSettingsDir, resolveArtifactAppProfile } from './profile.mjs';
import { OriginAllowlist } from './navigation.mjs';
import { PARTITION, SERVER_PARTITION, unsavedOf } from './artifact-view.mjs';
import { ArtifactWindow } from './artifact-window.mjs';
import { Settings, chromiumLang } from './settings.mjs';
import { libraryClient } from './library.mjs';
import { Downloads } from './downloads.mjs';
import { Notice } from './notice.mjs';
import { artifactMenuTemplate, describeMenu, templateCommands } from './menu.mjs';
import { checkLaunch } from './installed-apps.mjs';
import { wordsFor } from '../renderer/src/words.js';

/** The harness an artifact's app is to the daemon (not the desktop app's: agents' opens never come here). */
export const ARTIFACT_APP_HARNESS = 'open-artifact-app';
/** How long a close or a quit waits for unsaved work to be saved before it asks, ms (the desktop app's). */
const SAVE_WAIT_MS = 3000;

const here = import.meta.dirname;
const log = (line) => console.log(`[artifact-app] ${line}`);
const testModeOf = (argv, env) => argv.includes('--test-mode') || /^(1|true|yes|on)$/i.test(String(env.OA_DESKTOP_TEST ?? ''));

/** Says why the app cannot start and leaves: printed (test mode, exit 2), or a message box (the person's run). */
function refuse(lines, testMode) {
  for (const line of lines) console.error(`[artifact-app] cannot start: ${line}`);
  if (testMode) {
    app.exit(2);
    process.exit(2);
  }
  // A folder of its own for this run: never the desktop app's (no lock is taken, nothing is kept).
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'open-artifact-app-')));
  void app.whenReady().then(() => {
    dialog.showErrorBox('This app cannot open', lines.join('\n'));
    app.exit(2);
  });
}

/** Runs the app of `found` (`readArtifactApp`'s answer: `{ file, manifest, problems }`). */
export function run(found) {
  const argv = process.argv.slice(1);
  const testMode = testModeOf(argv, process.env);
  if (found.problems.length || !found.manifest) return refuse(found.problems.length ? found.problems : ['artifact-app.json cannot be read'], testMode);
  const manifest = found.manifest;
  const profile = resolveArtifactAppProfile({ manifest, argv, env: process.env, packaged: app.isPackaged });
  if (profile.problems.length) return refuse(profile.problems, profile.testMode);

  // The desktop app's settings folder, before this app's own folders are set (Electron's default is the desktop app's:
  // both packages are "Open Artifact").
  const settingsDir = desktopSettingsDir({ home: profile.home, guarded: profile.guarded, defaultUserData: app.getPath('userData') });
  for (const dir of Object.values(profile.paths)) mkdirSync(dir, { recursive: true });
  app.setPath('userData', profile.paths.userData);
  app.setPath('sessionData', profile.paths.sessionData);
  app.setAppLogsPath(profile.paths.logs);
  app.setPath('crashDumps', profile.paths.crashDumps);
  if (!app.requestSingleInstanceLock({ argv })) {
    log('another instance of this app runs: it comes to the front');
    app.exit(0);
    process.exit(0);
  }
  if (profile.ignoredHome) log(`--home / OPEN_ARTIFACT_HOME ${profile.ignoredHome} ignored: this app's home is ${profile.home}`);

  let toFront = () => {};
  app.on('second-instance', () => {
    log('second start');
    toFront();
  });
  // A link given to this app (macOS's open-url): the desktop app's.
  let handOff = (what, id) => log(`hand-off before ready ignored: ${what} ${id ?? ''}`);
  app.on('open-url', (event, url) => {
    event.preventDefault();
    log(`link (open-url) goes to the desktop app: ${String(url).slice(0, 200)}`);
    const id = /^open-artifact:\/\/artifact\/([A-Za-z0-9_-]{1,80})$/.exec(String(url))?.[1];
    if (id) handOff('artifact', id);
  });

  if (profile.testMode) {
    if (profile.debugPort) app.commandLine.appendSwitch('remote-debugging-port', String(profile.debugPort));
    if (process.platform === 'darwin') app.setActivationPolicy?.('accessory');
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  }
  // The desktop app's look and language (read only: this app changes no setting).
  const settings = new Settings(settingsDir, { log });
  const startLocale = profile.locale ? (profile.locale === 'zh' ? 'zh-CN' : 'en') : settings.get('locale');
  const lang = chromiumLang(startLocale);
  if (lang) app.commandLine.appendSwitch('lang', lang);

  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(
    () => start({ manifest, profile, settings, startLocale, settingsDir, setToFront: (f) => (toFront = f), setHandOff: (f) => (handOff = f) }),
    (error) => {
      console.error(`[artifact-app] ${error?.stack ?? error}`);
      app.exit(1);
    },
  );
}

async function start({ manifest, profile, settings, startLocale, settingsDir, setToFront, setHandOff }) {
  const bundlePath = bundleOfExecutable(process.execPath);
  log(`profile ${JSON.stringify({ home: profile.home, port: profile.port, installId: profile.installId, artifactId: profile.artifactId, bundle: bundlePath, testMode: profile.testMode, guarded: profile.guarded, paths: profile.paths, settings: settingsDir })}`);
  if (profile.testMode && process.platform === 'darwin') app.dock?.hide();
  nativeTheme.themeSource = profile.theme ?? settings.get('theme');
  const locale = /^zh\b/i.test(app.getLocale() ?? '') ? 'zh' : 'en';
  const t = wordsFor(locale);

  // ---- the install record: this very package, installed, of this artifact ----
  const launch = checkLaunch({ manifest, bundlePath: bundlePath ?? '' });
  const record = launch.ok ? launch.record : null;
  // The desktop app the record names (its executable starts the daemon and takes what leaves this artifact), else this one.
  const exeName = basename(process.execPath);
  const templateExe = record?.templatePath && existsSync(join(record.templatePath, 'Contents', 'MacOS', exeName)) ? join(record.templatePath, 'Contents', 'MacOS', exeName) : null;
  const templateRuntime = record?.templatePath ? join(record.templatePath, 'Contents', 'Resources', 'runtime') : null;
  const ownRuntime = join(process.resourcesPath, 'runtime');
  const runtimeDir = templateRuntime && runtimeInfo(templateRuntime)?.version ? templateRuntime : ownRuntime;
  const daemonExe = templateExe ?? process.execPath;

  const openExternal = (url) => {
    log(`external ${url}`);
    if (!profile.testMode) void shell.openExternal(url);
  };
  const system = {
    reveal(path) {
      log(`reveal ${path}${profile.testMode ? ' (test mode: not shown)' : ''}`);
      if (!profile.testMode) shell.showItemInFolder(path);
      return true;
    },
  };

  // ---- the window: the status page, then the artifact's view over it ----
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    title: record?.displayName ?? 'Open Artifact',
    show: !profile.testMode,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    webPreferences: {
      preload: join(here, 'artifact-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: !profile.testMode,
    },
  });
  // The title is the artifact's (the status page's own <title> never replaces it).
  window.on('page-title-updated', (event) => event.preventDefault());
  const pagePath = join(here, 'renderer', 'artifact-app', 'index.html');
  const pageUrl = new URL(`file://${pagePath}`).href;
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  setToFront(() => {
    if (window.isDestroyed()) return;
    if (profile.testMode) return log('second start: the window would come to the front (test mode: not shown)');
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    app.focus({ steal: true });
  });

  // ---- what leaves this artifact: the desktop app's ----
  const handoffs = [];
  const handOff = (what, id) => {
    const entry = { to: 'desktop', what, id: id ?? null, home: profile.home, exe: templateExe };
    log(`hand-off ${JSON.stringify(entry)}${profile.testMode ? ' (test mode: not started)' : ''}`);
    handoffs.push(entry);
    if (profile.testMode) return true;
    if (!templateExe) {
      log('hand-off: no desktop app to hand to (its package is not where the record says)');
      return false;
    }
    // The desktop app, started (or the running one asked: its single-instance lock takes the arguments).
    const logs = join(profile.home, 'logs');
    mkdirSync(logs, { recursive: true });
    const fd = openSync(join(logs, 'artifact-app-handoff.out'), 'a');
    try {
      const child = spawn(templateExe, ['--home', profile.home, ...(what === 'artifact' && id ? ['--open', id] : [])], { detached: true, stdio: ['ignore', fd, fd], env: daemonEnv(process.env, { home: profile.home, port: null }) });
      child.on('error', (error) => log(`hand-off: ${error?.message ?? error}`));
      child.unref();
    } finally {
      closeSync(fd);
    }
    return true;
  };
  setHandOff(handOff);

  let harness = null;
  /** The "saved" notice and the downloads (made once the record checked). */
  let notice = null;
  let downloads = null;
  const allowlist = new OriginAllowlist();
  const library = libraryClient({ state: () => harness?.client.state ?? null });
  let aw = null;
  /** The question about unsaved work: `{ id, kind, done(yes) }`. */
  let asking = null;
  let askCount = 0;
  /** Before the window has an artifact: `connecting`, or a problem it was given. */
  const view = () => {
    const snap = aw?.snapshot() ?? { status: 'connecting', problem: null, title: record?.displayName ?? '' };
    const out = { status: snap.status, busy: false, title: '', body: '', actions: [], ask: null, lang: locale === 'zh' ? 'zh-CN' : 'en' };
    const open = { id: 'open-desktop', label: t('artifactApp.openDesktop') };
    switch (snap.status) {
      case 'connecting':
        Object.assign(out, { busy: true, body: t('artifactApp.connecting') });
        break;
      case 'opening':
      case 'loading':
      case 'ready':
        Object.assign(out, { busy: true, body: t('artifactApp.opening') });
        break;
      case 'reconnecting':
        Object.assign(out, { busy: true, body: t('artifactApp.reconnecting') });
        break;
      case 'stopped':
        Object.assign(out, { body: t('artifactApp.stopped'), actions: [open] });
        break;
      case 'stale':
        Object.assign(out, { body: t('artifactApp.stale'), actions: [{ id: 'reload', label: t('artifactApp.reload'), primary: true }] });
        break;
      case 'crashed':
        Object.assign(out, { body: t('artifactApp.crashed'), actions: [{ id: 'reload', label: t('artifactApp.reload'), primary: true }] });
        break;
      case 'problem': {
        const { kind, detail } = snap.problem;
        if (kind === 'not-found') Object.assign(out, { title: t('artifactApp.notFoundTitle'), body: t('artifactApp.notFoundBody'), actions: [open] });
        else if (kind === 'folder-missing') Object.assign(out, { title: t('artifactApp.folderMissingTitle'), body: t('artifactApp.folderMissingBody', { folder: detail }), actions: [{ id: 'retry', label: t('artifactApp.retry') }, open] });
        else if (kind === 'needs-repair') Object.assign(out, { title: t('artifactApp.needsRepairTitle'), body: t('artifactApp.needsRepairBody', { reason: detail }), actions: [open] });
        else Object.assign(out, { title: t('artifactApp.failedTitle'), body: detail, actions: [{ id: 'retry', label: t('artifactApp.retry'), primary: true }, open] });
        out.problem = snap.problem.kind;
        break;
      }
      default:
        break;
    }
    if (asking) {
      const title = aw?.tab.title || record?.displayName || '';
      out.ask = {
        id: asking.id,
        kind: asking.kind,
        title: t(asking.kind === 'reload' ? 'unsaved.reloadTitle' : 'unsaved.closeTitle', { title }),
        body: t(asking.kind === 'reload' ? 'unsaved.reloadBody' : 'unsaved.windowBody'),
        yes: t(asking.kind === 'reload' ? 'unsaved.reload' : asking.kind === 'quit' ? 'unsaved.quit' : 'unsaved.close'),
        cancel: t('unsaved.cancel'),
      };
    }
    return out;
  };
  const send = () => {
    if (!window.isDestroyed()) window.webContents.send('artifact-app:state', view());
  };

  // ---- the window's own calls: only from its page ----
  const fromPage = (event) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === pageUrl;
  const handle = (channel, runIt) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromPage(event)) {
        log(`refused ${channel} from ${event.senderFrame?.url ?? '?'}`);
        throw new Error('not allowed');
      }
      return runIt(...args);
    });
  handle('artifact-app:state', () => view());
  await window.loadFile(pagePath);

  // ---- downloads and the "saved" notice, as in the desktop app ----
  notice = new Notice({
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
  downloads.refuse(session.fromPartition(SERVER_PARTITION), 'the sites');

  function makeWindow() {
    const made = new ArtifactWindow({
      window,
      harness: harness ?? { connected: false },
      allowlist,
      artifactId: manifest.artifactId,
      harnessName: ARTIFACT_APP_HARNESS,
      external: openExternal,
      handOff,
      onSavedFile: (path) => {
        log(`saved_file from ${manifest.artifactId}`);
        downloads?.fromShell(path);
      },
      requestClose: () => requestQuit('close'),
      onChange: () => {
        send();
        notice?.raise();
      },
      log,
      testMode: profile.testMode,
    });
    if (record?.displayName) made.setTitle(record.displayName);
    return made;
  }

  // ---- unsaved work: waited for, then asked about (one window: closing it quits) ----
  const ask = (kind) =>
    new Promise((done) => {
      if (window.isDestroyed()) return done(false);
      if (asking) return done(false);
      asking = {
        id: `ask-${++askCount}`,
        kind,
        done: (yes) => {
          asking = null;
          aw?.setOverlay(false);
          send();
          done(yes);
        },
      };
      log(`ask ${kind}: ${JSON.stringify([aw?.tab.title ?? ''])}`);
      aw?.setOverlay(true);
      send();
    });
  handle('artifact-app:answer', (id, yes) => {
    if (!asking || asking.id !== id) return false;
    log(`answer ${asking.kind}: ${yes === true ? 'yes' : 'cancel'}`);
    asking.done(yes === true);
    return true;
  });
  const unsaved = () => !!aw && unsavedOf(aw.tab);
  const settled = async (ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (!unsaved()) return true;
      if (Date.now() > deadline) return false;
      await new Promise((done) => setTimeout(done, 100));
    }
  };
  let quitAllowed = false;
  let quitting = null;
  /** The window's close, ⌘W, ⌘Q, the Shell's close: with unsaved work, waited for, then asked about. */
  function requestQuit(kind) {
    return (quitting ??= (async () => {
      if (window.isDestroyed() || !unsaved()) {
        quitAllowed = true;
        app.quit();
        return true;
      }
      aw.setClosing(true);
      const saved = await settled(SAVE_WAIT_MS);
      aw.setClosing(false);
      if (!saved) {
        if (!(await ask(kind))) {
          log(`${kind}: kept (it has unsaved work)`);
          return false;
        }
        log(`${kind}: with its unsaved work let go, as asked`);
      } else log(`${kind}: its work was saved`);
      quitAllowed = true;
      app.quit();
      return true;
    })().finally(() => (quitting = null)));
  }
  async function reloadArtifact() {
    if (!aw) return false;
    const stale = aw.tab.status === 'stale' || aw.tab.status === 'crashed';
    if (aw.tab.status === 'stale' && unsaved() && !(await ask('reload'))) {
      log('reload: kept (cancelled)');
      return false;
    }
    return aw.reload({ discard: stale });
  }

  // ---- the connection ----
  /** Whether the artifact can be shown: in the library, with its folder. Sets the window's problem otherwise. */
  const describe = async () => {
    try {
      const found = await library.record(manifest.artifactId);
      if (!found || found.id !== manifest.artifactId) {
        aw.setProblem('not-found');
        return false;
      }
      if (found.folderMissing === true) {
        aw.setProblem('folder-missing', String(found.root ?? ''));
        return false;
      }
      aw.setType(found.type);
      if (found.title) aw.setTitle(found.title);
      return true;
    } catch (error) {
      if (error?.status === 404 || error?.code === 'not_found') aw.setProblem('not-found', error?.message ?? '');
      else aw.setProblem('failed', error?.message ?? String(error));
      return false;
    }
  };
  const refreshOrigins = async () => {
    const state = harness.client.state;
    if (profile.guarded && daemonOnDefaultPort(state)) {
      console.error(`[artifact-app] connected to a daemon on port 4800 (${state.url}); quitting.`);
      app.exit(3);
      return false;
    }
    allowlist.setDaemon(state?.url ?? null);
    try {
      allowlist.fromDaemon(await harness.embedOrigins());
    } catch (error) {
      log(`embed.origins: ${error?.message ?? error}`);
    }
    // The sites this computer is connected to: a published artifact is shown on its site, as in the desktop app.
    try {
      const out = await library.call('remotes');
      allowlist.setServers((Array.isArray(out?.remotes) ? out.remotes : []).map((remote) => remote?.host).filter((host) => typeof host === 'string'));
    } catch (error) {
      log(`remotes: ${error?.message ?? error}`);
    }
    return true;
  };
  /** Checks the artifact and opens it (at start, and the page's Try Again). */
  let opened = false;
  const openArtifact = async () => {
    aw.clearProblem();
    if (!(await describe())) return false;
    opened = await aw.open();
    return opened;
  };

  if (!launch.ok) {
    aw = makeWindow();
    aw.setProblem('needs-repair', launch.reason);
    finishSetup();
    log(`ready ${JSON.stringify({ problem: 'needs-repair', reason: launch.reason, detail: launch.detail })}`);
    return;
  }
  if (profile.guarded && daemonOnDefaultPort(await readDaemon(profile.home))) {
    console.error(`[artifact-app] The daemon of ${profile.home} listens on port 4800; this test run does not connect to it.`);
    app.exit(3);
    return;
  }

  aw = makeWindow();
  send();
  try {
    harness = await createHarness({
      harness: ARTIFACT_APP_HARNESS,
      runtime: { dir: runtimeDir, version: runtimeInfo(runtimeDir)?.version, update: 'prompt' },
      home: profile.home,
      daemon: {
        env: daemonEnv(process.env, profile),
        timeoutMs: 60_000,
        // The desktop app's executable (else this one's), as plain Node: the daemon outlives this app.
        spawn: (startIt) => {
          const fd = openSync(startIt.logFile, 'a');
          try {
            log(`daemon start: ${daemonExe === process.execPath ? 'this app' : 'the desktop app'} (${daemonExe})`);
            const child = spawn(daemonExe, [startIt.bin, ...startIt.args], { detached: true, stdio: ['ignore', fd, fd], env: { ...startIt.env, ELECTRON_RUN_AS_NODE: '1' } });
            child.on('error', (error) => log(`daemon start: ${error?.message ?? error}`));
            child.unref();
            return child;
          } finally {
            closeSync(fd);
          }
        },
      },
      embed: { origins: [], mode: 'view', remote: 'deny' },
      // Views of its own (`view.open` gives tickets only to `embed: 'view'`, which needs an `open`); an agent's open is
      // never shown here (the daemon hands those to the desktop app only).
      open: async (request) => {
        log(`host.open refused: ${String(request?.url ?? '').slice(0, 200)} (agents' opens are the desktop app's)`);
        return false;
      },
      reconnect: { minMs: 500, maxMs: 5000 },
      log: (line) => log(`kit: ${line}`),
    });
  } catch (error) {
    aw.setProblem('failed', error?.message ?? String(error));
    finishSetup();
    log(`ready ${JSON.stringify({ problem: 'failed' })}`);
    return;
  }
  aw.harness = harness;

  harness.on('event', (event) => {
    if (event.type === 'embed/origins') allowlist.fromDaemon(event);
    if (event.type === 'artifacts/changed' && event.id === manifest.artifactId) {
      if (event.removed) aw.setProblem('not-found', 'removed from the library');
      else void describe();
    }
  });
  harness.on('state', (state) => {
    log(`connection ${state}`);
    if (state === 'connected') {
      void refreshOrigins().then((ok) => {
        if (!ok) return;
        if (!opened && !aw.problem) void openArtifact();
        else aw.setConnected(true);
      });
    } else aw.setConnected(false, { stopped: state === 'stopped' });
  });
  nativeTheme.on('updated', () => {
    if (!window.isDestroyed()) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff');
  });

  if (harness.connected && !(await refreshOrigins())) return;
  aw.connected = harness.connected;
  if (harness.connected) await openArtifact();
  finishSetup();
  const state = harness.client.state;
  log(`ready ${JSON.stringify({ daemon: state ? { pid: state.pid, url: state.url, version: state.version } : null, artifact: manifest.artifactId, status: aw.snapshot().status, problem: aw.problem?.kind ?? null, runtime: runtimeDir, daemonExe })}`);

  /** The menu, the commands, the window's close and quit, test mode's calls: once, whatever the start came to. */
  function finishSetup() {
    const targetContents = () => (aw?.tab.view && !aw.overlay && !aw.problem ? aw.tab.view.webContents : window.webContents);
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
      log(`edit ${method} on ${contents === window.webContents ? 'the window' : 'the artifact'}`);
      return true;
    };
    const commands = {
      about: () => {
        log(`about${profile.testMode ? ' (test mode: not shown)' : ''}`);
        if (!profile.testMode) app.showAboutPanel();
        return true;
      },
      library: () => handOff('library', null),
      reveal: async () => {
        const found = await library.record(manifest.artifactId);
        return system.reveal(found.root);
      },
      'close-window': () => {
        window.close();
        return true;
      },
      reload: () => reloadArtifact(),
      'zoom-reset': () => zoom(0),
      'zoom-in': () => zoom(0.5),
      'zoom-out': () => zoom(-0.5),
      fullscreen: () => {
        if (profile.testMode) return (log('full screen (test mode: not done)'), false);
        window.setFullScreen(!window.isFullScreen());
        return window.isFullScreen();
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
    const connected = () => !!harness?.connected;
    const enabled = (name) => {
      if (name === 'reveal') return connected() && aw?.problem?.kind !== 'not-found' && aw?.problem?.kind !== 'needs-repair';
      if (name === 'reload') return connected() && !aw?.problem && !!aw?.tab.view;
      return true;
    };
    const runCommand = async (name, arg) => {
      const runIt = commands[name];
      if (!runIt) throw new Error(`not a command: ${name}`);
      if (!enabled(name)) throw new Error(`${name} cannot run now`);
      log(`command ${name}`);
      return runIt(arg);
    };
    let menuKey = '';
    const refreshMenu = () => {
      const key = JSON.stringify(['reveal', 'reload'].map(enabled));
      if (key === menuKey) return;
      menuKey = key;
      const template = artifactMenuTemplate({ t, run: (name, arg) => void runCommand(name, arg).catch((error) => log(`command ${name}: ${error?.message ?? error}`)), enabled, appName: record?.displayName ?? aw?.tab.title ?? 'Open Artifact' });
      for (const name of templateCommands(template)) if (!commands[name]) log(`menu: no command ${name}`);
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    };
    refreshMenu();
    const onChange = aw.onChange;
    aw.onChange = (snap) => {
      onChange(snap);
      refreshMenu();
    };

    handle('artifact-app:act', async (id) => {
      log(`act ${id}`);
      if (id === 'open-desktop') return handOff('library', null);
      if (id === 'retry') return harness?.connected ? openArtifact() : false;
      if (id === 'reload') return reloadArtifact();
      throw new Error(`not an action: ${id}`);
    });

    window.on('close', (event) => {
      if (quitAllowed || !unsaved()) return;
      event.preventDefault();
      void requestQuit('close');
    });
    window.on('closed', () => app.quit());
    app.on('before-quit', (event) => {
      if (!quitAllowed && unsaved()) {
        event.preventDefault();
        void requestQuit('quit');
        return;
      }
      quitAllowed = true;
      notice?.close?.();
      aw?.close();
      harness?.close();
    });

    if (profile.testMode) {
      const answer = (channel, runIt) =>
        handle(channel, async (...args) => {
          try {
            return { ok: true, value: await runIt(...args) };
          } catch (error) {
            return { ok: false, error: String(error?.message ?? error) };
          }
        });
      answer('test:command', (name, arg) => runCommand(String(name), arg ?? undefined));
      handle('test:menu', () => describeMenu(Menu.getApplicationMenu()));
      handle('test:artifact-app', () => {
        const contents = aw?.tab.view?.webContents;
        const prefs = contents && !contents.isDestroyed() ? (contents.getLastWebPreferences?.() ?? {}) : null;
        return {
          ...aw?.snapshot(),
          windowTitle: window.getTitle(),
          home: profile.home,
          installId: profile.installId,
          artifactId: profile.artifactId,
          harness: ARTIFACT_APP_HARNESS,
          handoffs: handoffs.slice(),
          view: view(),
          daemonExe,
          runtimeDir,
          locale,
          theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
          page: prefs
            ? {
                url: contents.getURL(),
                partition: contents.session === session.fromPartition(SERVER_PARTITION) ? SERVER_PARTITION : contents.session === session.fromPartition(PARTITION) ? PARTITION : 'other',
                preload: prefs.preload ?? null,
                sandbox: prefs.sandbox === true,
                nodeIntegration: prefs.nodeIntegration === true,
                ticket: aw.tab.ticket ?? null,
              }
            : null,
        };
      });
      handle('test:saved', (saved) => {
        if (saved === null) return aw?.setSaved(null);
        if (!['saved', 'saving', 'unsaved', 'error'].includes(saved?.state)) throw new Error('not a saved state');
        return aw?.setSaved({ state: saved.state, leaveLosesWork: saved.leaveLosesWork === true });
      });
      handle('test:close-window', () => {
        window.close();
        return true;
      });
      handle('test:quit', (force) => {
        if (force === true) quitAllowed = true;
        app.quit();
        return true;
      });
    }
    send();
  }
}
