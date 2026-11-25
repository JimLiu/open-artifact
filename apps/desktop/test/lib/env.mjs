/**
 * What every desktop test shares: a throwaway profile (its own HOME and Open Artifact home), a clean environment with
 * no `node` on PATH, a free port that is not 4800, and stopping a daemon only by the pid its own `daemon.json` names.
 *
 * Nothing here reads or touches the person's own Open Artifact home or port: the environment of every process a test
 * starts is built from a short allowlist, never from `process.env`, so variables of the shell the tests run in
 * (`OPEN_ARTIFACT_*`, an agent's session markers) never reach the daemon.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNTIME = join(APP, 'resources', 'runtime');
/** The person's own home; a test refuses to run against it. */
export const DEFAULT_HOME = join(homedir(), '.agents', 'open-artifact');
/** The port the person's own daemon uses by default. */
export const DEFAULT_PORT = 4800;
/** A PATH with the system's tools (`ps`, `env`) and no `node`. */
export const NO_NODE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/** Electron's executable (installed by `npm install` and `npx install-electron` in apps/desktop). */
export function electronBinary() {
  const file = join(APP, 'node_modules', 'electron', 'path.txt');
  if (!existsSync(file)) throw new Error('Electron is not installed: in apps/desktop run npm install, then npx install-electron');
  const bin = join(APP, 'node_modules', 'electron', 'dist', readFileSync(file, 'utf8').trim());
  if (!existsSync(bin)) throw new Error(`Electron's binary is missing (${bin}): in apps/desktop run npx install-electron`);
  return bin;
}

/** A fresh profile under the system's temp folder (set TMPDIR to move it). */
export function makeProfile(prefix = 'oa-desktop-') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const profile = {
    root,
    home: join(root, 'home'),
    oaHome: join(root, 'oa'),
    tmp: join(root, 'tmp'),
    artifacts: join(root, 'artifacts'),
    userData: join(root, 'electron'),
  };
  for (const dir of [profile.home, profile.oaHome, profile.tmp, profile.artifacts]) mkdirSync(dir, { recursive: true });
  if (resolve(profile.oaHome) === resolve(DEFAULT_HOME)) throw new Error('the test profile is the default home');
  return profile;
}

/** A free loopback port that is not 4800. */
export async function freePort() {
  for (;;) {
    const port = await new Promise((done, fail) => {
      const server = net.createServer();
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => {
        const { port: got } = server.address();
        server.close(() => done(got));
      });
    });
    if (port !== DEFAULT_PORT) return port;
  }
}

/** The environment of a process a test starts: only these variables. */
export function cleanEnv(profile, port, extra = {}) {
  return {
    PATH: NO_NODE_PATH,
    HOME: profile.home,
    TMPDIR: profile.tmp,
    OPEN_ARTIFACT_HOME: profile.oaHome,
    OPEN_ARTIFACT_PORT: String(port),
    // No update checks against the registry from a test.
    OPEN_ARTIFACT_RUNTIME_UPDATE: 'off',
    // Never the real registry: a test that checks passes its own fake registry; anything else reaches nothing.
    OPEN_ARTIFACT_REGISTRY: 'http://127.0.0.1:9',
    // Never the computer's policy file.
    OPEN_ARTIFACT_MACHINE_POLICY: join(profile.tmp, 'no-machine-policy.json'),
    // Never this computer's browser, and never Open Artifact Desktop started by its link, from a test's daemon.
    OPEN_ARTIFACT_BROWSER: 'none',
    OPEN_ARTIFACT_DESKTOP_LAUNCH: 'off',
    ...extra,
  };
}

/** `daemon.json` of the profile's home, or null. */
export function daemonState(profile) {
  try {
    return JSON.parse(readFileSync(join(profile.oaHome, 'daemon.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function until(check, timeoutMs = 10_000, everyMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return value;
    await sleep(everyMs);
  }
}

/**
 * Every process on this computer as `{ pid, ppid, command }` (`ps`, read only).
 */
export function processes({ withEnv = false } = {}) {
  const text = execFileSync('/bin/ps', [withEnv ? '-axwwE' : '-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  return text
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
}

/** `pid` and every process under it. */
export function treeOf(pid, all = processes()) {
  const out = [];
  const walk = (id) => {
    for (const p of all) {
      if (p.ppid === id) {
        out.push(p);
        walk(p.pid);
      }
    }
  };
  const self = all.find((p) => p.pid === pid);
  if (self) out.push(self);
  walk(pid);
  return out;
}

/**
 * Processes whose command line or environment names the profile (what a test left running: a daemon names it only in
 * its environment, `HOME` and `OPEN_ARTIFACT_HOME`; `ps -E` shows the environment of this user's processes).
 */
export function leftovers(profile) {
  return processes({ withEnv: true })
    .filter((p) => p.command.includes(profile.root) && p.pid !== process.pid)
    .map((p) => ({ ...p, command: p.command.slice(0, 300) }));
}

/**
 * Stops the profile's daemon: `SIGTERM` to the pid in its own `daemon.json` (never by name), then waits for it and
 * its type servers to end. Returns the pid it stopped, or null when none ran.
 */
export async function stopDaemon(profile, timeoutMs = 15_000) {
  const state = daemonState(profile);
  if (!state?.pid || !alive(state.pid)) return null;
  const tree = treeOf(state.pid);
  // Only a process started from this profile is ours to stop.
  const own = processes().find((p) => p.pid === state.pid);
  if (!own) return null;
  process.kill(state.pid, 'SIGTERM');
  await until(() => !alive(state.pid) && tree.every((p) => !alive(p.pid)), timeoutMs);
  return state.pid;
}
