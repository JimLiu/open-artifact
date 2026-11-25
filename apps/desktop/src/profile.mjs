/**
 * Where the app keeps things, decided before anything else runs.
 *
 * - The Open Artifact home (the profile: the daemon, the library, the settings): `--home <dir>`, else
 *   `$OPEN_ARTIFACT_HOME`, else `~/.agents/open-artifact`.
 * - The daemon's port: `--port <n>`, else `$OPEN_ARTIFACT_PORT`, else the daemon's own setting (4800, or the next free one).
 * - Electron's own folders (`userData`, `sessionData`, `logs`, `crashDumps`): a packaged app run by the person,
 *   Electron's defaults; a development run, or any run in test mode (the packaged app's too), `<home>/desktop/…`, so it
 *   never writes beside the installed app and does not depend on HOME.
 *
 * Guarded (not packaged, or in test mode: how the tests start the packaged app), two things refuse to start, before
 * the app connects to anything: the default home (`~/.agents/open-artifact`, the person's own library), and port 4800
 * (the person's own daemon), or no port at all (the daemon would take 4800 when it is free).
 *
 * Pure functions: `main.mjs` passes `process.argv`, `process.env` and `app.isPackaged`; the tests pass their own.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';

/** The home the person's own agents use. */
export const DEFAULT_HOME = '~/.agents/open-artifact';
/** The port the person's own daemon listens on by default. */
export const DEFAULT_PORT = 4800;

/** `~` and `~/…` against the home folder; everything else resolved. */
export function expandHome(path, home = homedir()) {
  if (path === '~') return home;
  return resolve(path.startsWith('~/') ? join(home, path.slice(2)) : path);
}

/** The value after `--name` (or of `--name=value`), the last one given; `undefined` when absent. */
export function argValue(argv, name) {
  let value;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${name}` && i + 1 < argv.length) value = argv[++i];
    else if (arg.startsWith(`--${name}=`)) value = arg.slice(name.length + 3);
  }
  return value;
}

/** Every value of a repeated `--name`. */
export function argValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${name}` && i + 1 < argv.length) values.push(argv[++i]);
    else if (arg.startsWith(`--${name}=`)) values.push(arg.slice(name.length + 3));
  }
  return values;
}

/** The account's home folder from the user database, whatever HOME says. */
function accountHomeDir() {
  try {
    return userInfo().homedir || null;
  } catch {
    return null;
  }
}

const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value ?? ''));

/**
 * The profile of this run. `problems` lists why it must not start (empty: it may); the app prints them and exits.
 *
 * `testMode` (`--test-mode` or `OA_DESKTOP_TEST=1`): the window is never shown, the Dock icon is hidden, links out are
 * only logged, and `debugPort` (`--devtools-port` or `OA_DESKTOP_DEBUG_PORT`) opens Chrome's remote debugging there.
 */
export function resolveProfile({ argv = [], env = {}, packaged = false, userHome = homedir(), accountHome = accountHomeDir() } = {}) {
  const problems = [];
  const homeArg = argValue(argv, 'home') ?? env.OPEN_ARTIFACT_HOME;
  const home = expandHome(homeArg || DEFAULT_HOME, userHome);
  const defaultHome = expandHome(DEFAULT_HOME, userHome);
  // The default home under HOME, and under the account's real home folder (HOME may point elsewhere).
  const defaultHomes = new Set([defaultHome, ...(accountHome ? [expandHome(DEFAULT_HOME, accountHome)] : [])]);

  const portArg = argValue(argv, 'port') ?? env.OPEN_ARTIFACT_PORT;
  let port = null;
  if (portArg !== undefined && portArg !== '') {
    port = Number(portArg);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push(`--port ${portArg}: not a port number.`);
      port = null;
    }
  }

  const testMode = truthy(env.OA_DESKTOP_TEST) || argv.includes('--test-mode');
  // Guarded: a development run, and any test-mode run (the packaged app's too, which tests start), never touches the
  // person's own home, port or Electron folders.
  const guarded = !packaged || testMode;
  if (guarded) {
    if (defaultHomes.has(home)) problems.push(`This development or test run does not use the default home (${defaultHome}): pass --home <dir> or set OPEN_ARTIFACT_HOME to a folder of its own.`);
    if (port === DEFAULT_PORT) problems.push(`This development or test run does not use port ${DEFAULT_PORT}, the port of your own Open Artifact daemon: pass --port <n> with another port.`);
    else if (port === null && !problems.some((line) => line.startsWith('--port'))) problems.push(`This development or test run needs a port of its own for its daemon: pass --port <n> (not ${DEFAULT_PORT}) or set OPEN_ARTIFACT_PORT.`);
  }

  const appDir = guarded ? join(home, 'desktop') : null;
  const debugRaw = argValue(argv, 'devtools-port') ?? env.OA_DESKTOP_DEBUG_PORT;
  const debugPort = debugRaw ? Number(debugRaw) : null;
  if (debugRaw && (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535)) problems.push(`--devtools-port ${debugRaw}: not a port number.`);
  if (debugPort && !testMode) problems.push('--devtools-port is for test mode only (--test-mode or OA_DESKTOP_TEST=1).');

  // Test mode only: the language and the look a run uses instead of the system's, and thumbnails taken although the
  // window is not shown. Outside test mode these are refused, so a person's run always follows the system.
  const testOnly = { locale: argValue(argv, 'locale'), theme: argValue(argv, 'theme') };
  if (testOnly.locale !== undefined && !/^(en|zh)$/.test(testOnly.locale)) problems.push(`--locale ${testOnly.locale}: en or zh.`);
  if (testOnly.theme !== undefined && !/^(light|dark)$/.test(testOnly.theme)) problems.push(`--theme ${testOnly.theme}: light or dark.`);
  const thumbnails = argv.includes('--thumbnails');
  const offline = argv.includes('--offline');
  for (const [name, given] of [['locale', testOnly.locale !== undefined], ['theme', testOnly.theme !== undefined], ['thumbnails', thumbnails], ['offline', offline]]) {
    if (given && !testMode) problems.push(`--${name} is for test mode only (--test-mode or OA_DESKTOP_TEST=1).`);
  }

  return {
    packaged,
    /** A development or test-mode run: refuses the default home and port 4800, and keeps Electron's folders in the home. */
    guarded,
    home,
    port,
    /** Electron's folders (null: Electron's defaults, in a packaged app the person runs). */
    paths: appDir
      ? { userData: join(appDir, 'user-data'), sessionData: join(appDir, 'session'), logs: join(appDir, 'logs'), crashDumps: join(appDir, 'crash-dumps') }
      : null,
    testMode,
    debugPort: problems.length ? null : debugPort,
    /** Artifacts to open in tabs at start (`--open <id or open-artifact:// link>`, repeatable). */
    open: argValues(argv, 'open'),
    /** Test mode: `--locale en|zh` (null: the system's language). */
    locale: testMode ? (testOnly.locale ?? null) : null,
    /** Test mode: `--theme light|dark` (null: the system's look). */
    theme: testMode ? (testOnly.theme ?? null) : null,
    /** Test mode: `--thumbnails` takes thumbnails although the window is never shown. */
    thumbnails: testMode && thumbnails,
    /** Test mode: `--offline` refuses (and logs) every request a page makes off this computer (`offline.mjs`). */
    offline: testMode && offline,
    problems,
  };
}

/** The daemon a home's `daemon.json` names listens on 4800: the person's own, which a development build must not use. */
export function daemonOnDefaultPort(state) {
  if (!state?.url) return false;
  try {
    const url = new URL(state.url);
    return Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === DEFAULT_PORT;
  } catch {
    return false;
  }
}

/**
 * The environment the daemon starts with: this app's, without what would point it elsewhere (another daemon's entry
 * or address, an agent's harness and session), plus the home and the port of this profile.
 */
export function daemonEnv(env, profile) {
  const out = { ...env };
  for (const name of ['OPEN_ARTIFACT_DAEMON_BIN', 'OPEN_ARTIFACT_DAEMON_URL', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'ELECTRON_RUN_AS_NODE', 'OA_DESKTOP_TEST', 'OA_DESKTOP_DEBUG_PORT']) delete out[name];
  out.OPEN_ARTIFACT_HOME = profile.home;
  if (profile.port) out.OPEN_ARTIFACT_PORT = String(profile.port);
  return out;
}

// ---- the single-artifact app: an artifact installed as an app of its own ----

/**
 * The file an artifact's app carries in its package (`Contents/Resources/artifact-app.json`, inside the package's
 * seal): `{ schemaVersion, installId, artifactId, home, templateVersion }`. The desktop app's own package has none.
 * Its presence alone decides the mode: present, this run is the single-artifact app whatever it holds (a file that
 * does not parse or lacks a field is that app's problem, never a desktop app); absent, the desktop app as always.
 * Only a packaged app reads it (a development run is always the desktop app).
 */
export const ARTIFACT_APP_FILE = 'artifact-app.json';
/** The version of `artifact-app.json` this code writes and reads. */
export const ARTIFACT_APP_SCHEMA = 1;
const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * The single-artifact app's file, or null when there is none (the desktop app). `{ manifest, problems }`: `manifest`
 * is the file's fields once they are all there and well formed (else null), `problems` why this app cannot start
 * (none: it may). `exists(path)`: whether the home folder is there (a test's own).
 */
export function readArtifactApp(resourcesPath, { packaged = true, read = (path) => readFileSync(path, 'utf8'), exists = (path) => existsSync(path) } = {}) {
  if (!packaged || typeof resourcesPath !== 'string' || !resourcesPath) return null;
  const file = join(resourcesPath, ARTIFACT_APP_FILE);
  let text;
  try {
    text = read(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { file, manifest: null, problems: [`${ARTIFACT_APP_FILE} cannot be read: ${error?.message ?? error}`] };
  }
  return { file, ...checkArtifactApp(text, { exists }) };
}

/** `artifact-app.json`'s text, checked: `{ manifest, problems }` (see {@link readArtifactApp}). Pure but for `exists`. */
export function checkArtifactApp(text, { exists = (path) => existsSync(path) } = {}) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { manifest: null, problems: [`${ARTIFACT_APP_FILE} is not JSON.`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, problems: [`${ARTIFACT_APP_FILE} is not an object.`] };
  const problems = [];
  if (raw.schemaVersion !== ARTIFACT_APP_SCHEMA) problems.push(`${ARTIFACT_APP_FILE}: schemaVersion ${JSON.stringify(raw.schemaVersion)} is not ${ARTIFACT_APP_SCHEMA}.`);
  if (typeof raw.installId !== 'string' || !INSTALL_ID.test(raw.installId)) problems.push(`${ARTIFACT_APP_FILE}: installId is missing or not an install id.`);
  if (typeof raw.artifactId !== 'string' || !ARTIFACT_ID.test(raw.artifactId)) problems.push(`${ARTIFACT_APP_FILE}: artifactId is missing or not an artifact id.`);
  if (typeof raw.home !== 'string' || !isAbsolute(raw.home) || normalize(raw.home) !== raw.home || raw.home.includes('\0')) problems.push(`${ARTIFACT_APP_FILE}: home is missing or not an absolute folder.`);
  else if (!exists(raw.home)) problems.push(`The Open Artifact home of this app is not there: ${raw.home}`);
  if (typeof raw.templateVersion !== 'string' || !raw.templateVersion) problems.push(`${ARTIFACT_APP_FILE}: templateVersion is missing.`);
  if (problems.length) return { manifest: null, problems };
  return { manifest: { schemaVersion: raw.schemaVersion, installId: raw.installId, artifactId: raw.artifactId, home: raw.home, templateVersion: raw.templateVersion }, problems };
}

/** `argv` without any `--name <value>` or `--name=value`. */
function withoutArg(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) i++;
    else if (!argv[i].startsWith(`--${name}=`)) out.push(argv[i]);
  }
  return out;
}

/**
 * The profile of a single-artifact app's run (see {@link resolveProfile}): the same switches and the same guards, but
 * the home is the one its own `artifact-app.json` names, never `--home`, never `$OPEN_ARTIFACT_HOME`, never the
 * default (`ignoredHome` says what was given and not used). Electron's folders are this app's own,
 * `<home>/desktop/apps/<installId>/`, in every run (the person's too): Electron's single-instance lock is on that
 * folder, so the app never meets the desktop app's lock (which would make it a second desktop app) or another
 * artifact's. `--open` and links are not taken: this app shows its one artifact.
 */
export function resolveArtifactAppProfile({ manifest, argv = [], env = {}, packaged = true, userHome = homedir(), accountHome = accountHomeDir() } = {}) {
  const ignoredHome = argValue(argv, 'home') ?? env.OPEN_ARTIFACT_HOME ?? null;
  const ownEnv = { ...env };
  delete ownEnv.OPEN_ARTIFACT_HOME;
  const base = resolveProfile({ argv: [...withoutArg(withoutArg(argv, 'home'), 'open'), '--home', manifest.home], env: ownEnv, packaged, userHome, accountHome });
  const appDir = artifactAppDir(manifest.home, manifest.installId);
  return {
    ...base,
    mode: 'artifact-app',
    installId: manifest.installId,
    artifactId: manifest.artifactId,
    ignoredHome: ignoredHome && ignoredHome !== manifest.home ? ignoredHome : null,
    open: [],
    paths: { userData: appDir, sessionData: join(appDir, 'session'), logs: join(appDir, 'logs'), crashDumps: join(appDir, 'crash-dumps') },
  };
}

/** An installed artifact app's own Electron folder: `<home>/desktop/apps/<installId>/`. */
export const artifactAppDir = (home, installId) => join(home, 'desktop', 'apps', installId);

/** The `.app` package an executable runs from (`<x>.app/Contents/MacOS/<exe>`), or null. */
export function bundleOfExecutable(execPath) {
  const contents = dirname(dirname(String(execPath ?? '')));
  const bundle = dirname(contents);
  return basename(contents) === 'Contents' && bundle.endsWith('.app') ? bundle : null;
}

/**
 * Where the desktop app keeps its settings (`settings.json`: the look and the language the artifact apps follow too):
 * its Electron `userData`. A guarded run (test mode) keeps it in the home (`<home>/desktop/user-data`); the person's
 * packaged run in Electron's default for the app's name (`defaultUserData`, read before the artifact app moves its own).
 */
export const desktopSettingsDir = ({ home, guarded, defaultUserData }) => (guarded ? join(home, 'desktop', 'user-data') : defaultUserData);
