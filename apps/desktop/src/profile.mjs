/**
 * Where the app keeps things, decided before anything else runs.
 *
 * - The Open Artifact home (the profile: the daemon, the library, the settings): `--home <dir>`, else
 *   `$OPEN_ARTIFACT_HOME`, else `~/.agents/open-artifact`.
 * - The daemon's port: `--port <n>`, else `$OPEN_ARTIFACT_PORT`, else the daemon's own setting (4800, or the next free one).
 * - Electron's own folders (`userData`, `sessionData`, `logs`, `crashDumps`): packaged, Electron's defaults; not
 *   packaged, `<home>/desktop/…`, so a development run never writes beside the installed app and does not depend on HOME.
 *
 * Not packaged (a development or test run), two things refuse to start, before the app connects to anything:
 * the default home (`~/.agents/open-artifact`, the person's own library), and port 4800 (the person's own daemon), or
 * no port at all (the daemon would take 4800 when it is free).
 *
 * Pure functions: `main.mjs` passes `process.argv`, `process.env` and `app.isPackaged`; the tests pass their own.
 */
import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';

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

  if (!packaged) {
    if (defaultHomes.has(home)) problems.push(`This development build does not run on the default home (${defaultHome}): pass --home <dir> or set OPEN_ARTIFACT_HOME to a folder of its own.`);
    if (port === DEFAULT_PORT) problems.push(`This development build does not use port ${DEFAULT_PORT}, the port of your own Open Artifact daemon: pass --port <n> with another port.`);
    else if (port === null && !problems.some((line) => line.startsWith('--port'))) problems.push(`This development build needs a port of its own for its daemon: pass --port <n> (not ${DEFAULT_PORT}) or set OPEN_ARTIFACT_PORT.`);
  }

  const appDir = packaged ? null : join(home, 'desktop');
  const testMode = truthy(env.OA_DESKTOP_TEST) || argv.includes('--test-mode');
  const debugRaw = argValue(argv, 'devtools-port') ?? env.OA_DESKTOP_DEBUG_PORT;
  const debugPort = debugRaw ? Number(debugRaw) : null;
  if (debugRaw && (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535)) problems.push(`--devtools-port ${debugRaw}: not a port number.`);
  if (debugPort && !testMode) problems.push('--devtools-port is for test mode only (--test-mode or OA_DESKTOP_TEST=1).');

  return {
    packaged,
    home,
    port,
    /** Electron's folders (null: Electron's defaults, in a packaged app). */
    paths: appDir
      ? { userData: join(appDir, 'user-data'), sessionData: join(appDir, 'session'), logs: join(appDir, 'logs'), crashDumps: join(appDir, 'crash-dumps') }
      : null,
    testMode,
    debugPort: problems.length ? null : debugPort,
    /** Artifacts to open in tabs at start (`--open <id or open-artifact:// link>`, repeatable). */
    open: argValues(argv, 'open'),
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
