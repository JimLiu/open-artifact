import type { readDaemon as readDaemonType } from '@open-artifact/harness-kit';
import type { DaemonState } from '@open-artifact/protocol';
import { errorInfo, objectOf } from './errors.ts';
import type { LibraryClient } from './library.ts';
import type { Profile } from './profile.ts';
import type { Log, MaybePromise } from './types.ts';
export interface CliOptions {
  runtimeDir: string;
  profile: Pick<Profile, 'home' | 'port'>;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  args: string[];
  timeoutMs?: number;
}
export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export interface ServiceOptions {
  harness: {
    connected: boolean;
    daemon: {
      stopped: boolean;
      restart(): Promise<Partial<DaemonState> | null>;
      start(): Promise<Partial<DaemonState> | null>;
      stop(): Promise<{ stopped: Partial<DaemonState> | null; others: { title: string; harness: string; sessions: number }[] | null }>;
    };
    client: { state: Partial<DaemonState> | null; hello?: { connection: string } | null };
  };
  library: Pick<LibraryClient, 'call'>;
  profile: Pick<Profile, 'home' | 'port'>;
  runtimeDir: string;
  carried: string;
  onChange?: (view: ServiceView) => void;
  log?: Log;
  actions: { openPath(path: string): boolean; reveal(path: string): boolean };
  readDaemonImpl?: typeof readDaemonType;
  cli?: (options: CliOptions) => Promise<CliResult>;
}
export type ServiceView = ReturnType<Service['view']>;
export interface DoctorState {
  running?: boolean;
  report?: ReturnType<typeof doctorView>;
  error?: string;
}
/**
 * The service panel's side in the main process: what the daemon is doing, the apps connected to it, its type servers,
 * and the person's restart, stop and start. Every call runs here, with the daemon's token; the page is sent only what
 * it draws, picked field by field (never `daemon.json`, never a spread of a daemon answer), so the token cannot reach
 * it.
 *
 * The state the page shows:
 *
 * - `running`: the kit is connected.
 * - `reconnecting`: it is not, and it is trying again (the daemon went away by itself).
 * - `stopped`: the person stopped it here (`harness.daemon.stop()`), and no daemon runs for this home.
 * - `elsewhere`: the person stopped it here, but a daemon runs again for this home: another app (or a command line)
 *   started it. The kit does not connect by itself after a stop; the panel offers to connect.
 * - `failed`: a start or restart asked for here failed (its message is shown) and the kit is not connected.
 *
 * After a stop the home's `daemon.json` is read every {@link POLL_MS} (the kit's `readDaemon`, which also asks the
 * daemon's health), so `stopped` never stays on screen while a daemon runs again.
 *
 * The command line (`open-artifact doctor`, `runtime …`) runs with this app's executable as Node
 * (`ELECTRON_RUN_AS_NODE=1`) and the carried runtime's entry, with the daemon's environment: no `node` needs to be
 * installed, and it reads the app's home.
 */
import { readDaemon } from '@open-artifact/harness-kit';
import { LIBRARY_ROUTES } from '@open-artifact/protocol';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { daemonEnv } from './profile.ts';

/** How often the home is read while the daemon is stopped, ms. */
export const POLL_MS = 1500;
/** The longest a command line run may take, ms. */
const CLI_TIMEOUT_MS = 60_000;
/** The most output of a command line run that is read, bytes. */
const CLI_MAX = 1 << 20;
/** A type id, as the page may name one to restart. */
const TYPE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const str = (value: unknown, max = 500) => (typeof value === 'string' ? value.slice(0, max) : '');
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** `127.0.0.1:4890` of a daemon url. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

/** The daemon as the page shows it: picked from a daemon state (which holds the token), nothing else. */
export function daemonView(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const state = objectOf(value);
  return { version: str(state.version, 40), address: hostOf(str(state.url)), port: num(state.port), pid: num(state.pid), startedAt: str(state.startedAt, 40) };
}

/**
 * The apps connected, from the daemon's `harnesses` answer: one row per connection (this app's own marked `self`),
 * with its title and how many sessions it attached.
 */
export function appsView(value: unknown, ownConnection: string | null) {
  const answer = objectOf(value);
  const titles = new Map(
    (Array.isArray(answer?.harnesses) ? answer.harnesses : []).map((value: unknown) => {
      const h = objectOf(value);
      return [str(h.name, 100), str(h.title, 100)] as const;
    }),
  );
  return (Array.isArray(answer?.adapters) ? answer.adapters : [])
    .map(objectOf)
    .filter((a) => a && typeof a.id === 'string')
    .map((a) => ({
      connection: str(a.id, 100),
      harness: str(a.harness, 100),
      title: titles.get(str(a.harness, 100)) || str(a.harness, 100),
      sessions: Array.isArray(a.sessions) ? a.sessions.length : 0,
      polling: a.polling === true,
      self: a.id === ownConnection,
    }));
}

/** The type servers, from `types.servers`. */
export function serversView(value: unknown) {
  const answer = objectOf(value);
  return (Array.isArray(answer?.servers) ? answer.servers : [])
    .map(objectOf)
    .filter((s) => s && typeof s.type === 'string')
    .map((s) => ({ type: str(s.type, 64), state: str(s.state, 20), pid: num(s.pid), restarts: num(s.restarts) ?? 0, error: str(s.error) || null }));
}

/** What `open-artifact doctor --json` found, as the panel lists it. */
export function doctorView(value: unknown) {
  const report = objectOf(value);
  const findings = (Array.isArray(report?.findings) ? report.findings : [])
    .slice(0, 100)
    .map(objectOf)
    .map((f) => ({ id: str(f?.id, 64), status: str(f?.status, 10), message: str(f?.message, 1000), ...(f?.fix ? { fix: str(f.fix, 1000) } : {}) }));
  const counts = { ok: 0, warn: 0, fail: 0, 'n/a': 0 };
  for (const key of ['ok', 'warn', 'fail', 'n/a'] as const) counts[key] = num(objectOf(report.counts)[key]) ?? 0;
  return { ok: report?.ok === true, findings, counts };
}

/**
 * Runs the carried runtime's command line with this app's executable as Node: `args` after the entry, the daemon's
 * environment (this app's home and port). Resolves `{ code, stdout, stderr }`; never rejects on a non-zero exit.
 */
export function runCli({
  runtimeDir,
  profile,
  env = process.env,
  execPath = process.execPath,
  args,
  timeoutMs = CLI_TIMEOUT_MS,
}: CliOptions): Promise<CliResult> {
  return new Promise((done, fail) => {
    const child = spawn(execPath, [join(runtimeDir, 'scripts', 'open-artifact.mjs'), ...args], {
      env: { ...daemonEnv(env, profile), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < CLI_MAX) stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < CLI_MAX) stderr += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

/** The JSON a command line printed (its last JSON value), or null. */
export function jsonOf(stdout: string): unknown {
  const text = String(stdout ?? '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const at = text.indexOf('{');
    try {
      return at >= 0 ? JSON.parse(text.slice(at)) : null;
    } catch {
      return null;
    }
  }
}

/** The first line of a command line's error output, for the page. */
export const errorLine = (text: unknown) =>
  String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^at /.test(l)) ?? '';

/**
 * The service: the kit's daemon calls and what the panel shows. `harness`: the kit; `library`: the Library API client
 * (`library.ts`); `profile`; `runtimeDir`; `carried`: the version of the runtime this app carries; `onChange()`:
 * the view changed (the main process sends it to the page); `actions`: `openPath(path)`, `reveal(path)` (the system's,
 * or only logged in test mode).
 */
export class Service {
  harness: ServiceOptions['harness'];
  library: ServiceOptions['library'];
  profile: ServiceOptions['profile'];
  runtimeDir: string;
  carried: string;
  onChange: NonNullable<ServiceOptions['onChange']>;
  log: Log;
  actions: ServiceOptions['actions'];
  readDaemon: NonNullable<ServiceOptions['readDaemonImpl']>;
  cli: NonNullable<ServiceOptions['cli']>;
  elsewhere: ReturnType<typeof daemonView> = null;
  failure: string | null = null;
  busy: 'restart' | 'stop' | 'start' | null = null;
  apps: ReturnType<typeof appsView> = [];
  servers: ReturnType<typeof serversView> = [];
  doctor: DoctorState | null = null;
  timer: ReturnType<typeof setInterval> | null = null;
  closed = false;
  constructor({
    harness,
    library,
    profile,
    runtimeDir,
    carried,
    onChange = () => {},
    log = () => {},
    actions,
    readDaemonImpl = readDaemon,
    cli = runCli,
  }: ServiceOptions) {
    this.harness = harness;
    this.library = library;
    this.profile = profile;
    this.runtimeDir = runtimeDir;
    this.carried = carried;
    this.onChange = onChange;
    this.log = log;
    this.actions = actions;
    this.readDaemon = readDaemonImpl;
    this.cli = cli;
    /** The daemon running for this home while this app is not connected (read after a stop), picked. */
    this.elsewhere = null;
    /** Why the last start or restart asked for here failed, until the kit connects again. */
    this.failure = null;
    /** A restart, stop or start under way here. */
    this.busy = null;
    /** What the panel last read from the daemon. */
    this.apps = [];
    this.servers = [];
    /** The last `doctor` run: `{ running }`, `{ report }` or `{ error }`. */
    this.doctor = null;
    this.timer = null;
    this.closed = false;
  }

  /** The state word the status button and the panel show. */
  state(): 'running' | 'elsewhere' | 'stopped' | 'failed' | 'reconnecting' {
    if (this.harness.connected && !this.harness.daemon.stopped) return 'running';
    if (this.harness.daemon.stopped) return this.elsewhere ? 'elsewhere' : 'stopped';
    if (this.failure) return 'failed';
    return 'reconnecting';
  }

  /** What the page draws: display data only. */
  view() {
    const state = this.state();
    const connected = state === 'running';
    return {
      state,
      busy: this.busy,
      failure: this.failure,
      daemon: connected ? daemonView(this.harness.client.state) : state === 'elsewhere' ? this.elsewhere : null,
      home: this.profile.home,
      logs: join(this.profile.home, 'logs'),
      carried: this.carried,
      apps: connected ? this.apps : [],
      servers: connected ? this.servers : [],
      doctor: this.doctor,
    };
  }

  changed() {
    if (!this.closed) this.onChange(this.view());
  }

  /** Reads the apps and the type servers again (connected only); the view changes. */
  async refresh() {
    if (!this.harness.connected) {
      this.apps = [];
      this.servers = [];
      return this.changed();
    }
    const [apps, servers] = await Promise.all([
      this.library.call(LIBRARY_ROUTES.harnesses).then(
        (answer) => appsView(answer, this.harness.client.hello?.connection ?? null),
        (error: unknown) => (this.log(`service: harnesses: ${errorInfo(error).message ?? error}`), this.apps),
      ),
      this.library
        .call(LIBRARY_ROUTES.typesServers)
        .then(serversView, (error: unknown) => (this.log(`service: types.servers: ${errorInfo(error).message ?? error}`), this.servers)),
    ]);
    this.apps = apps;
    this.servers = servers;
    this.changed();
  }

  /** The kit's connection changed. */
  connection(state: 'connected' | 'disconnected' | 'stopped') {
    // A doctor report is about the daemon it ran against: another one (or none) makes it stale.
    if (!this.doctor?.running) this.doctor = null;
    if (state === 'connected') {
      this.failure = null;
      this.elsewhere = null;
      this.stopPolling();
      void this.refresh();
    } else {
      if (state === 'stopped') this.startPolling();
      this.changed();
    }
  }

  /** The other apps connected now (this app's own left out), for the restart and stop confirmations. */
  others() {
    return this.apps.filter((a) => !a.self).map((a) => ({ title: a.title, harness: a.harness, sessions: a.sessions }));
  }

  async run<T>(name: NonNullable<Service['busy']>, work: () => MaybePromise<T>): Promise<T> {
    if (this.busy) throw new Error(`${this.busy} is under way`);
    this.busy = name;
    this.changed();
    try {
      return await work();
    } finally {
      this.busy = null;
      this.changed();
    }
  }

  /** The person's restart: the daemon stops, a new one starts (the newest compatible runtime), the tabs come back. */
  restart() {
    return this.run('restart', async () => {
      try {
        const daemon = daemonView(await this.harness.daemon.restart());
        this.failure = null;
        this.log(`service: restarted, daemon ${daemon?.pid} ${daemon?.version}`);
        return { daemon };
      } catch (error) {
        this.failure = String(errorInfo(error).message ?? error);
        this.log(`service: restart failed: ${this.failure}`);
        throw error;
      }
    });
  }

  /**
   * The person's stop: the daemon stops and this app does not start it again by itself. Answers the other apps that
   * were connected (they reconnect, and may start it again).
   */
  stop() {
    return this.run('stop', async () => {
      const { stopped, others } = await this.harness.daemon.stop();
      this.elsewhere = null;
      this.log(
        `service: stopped ${stopped ? `daemon ${stopped.pid}` : '(none ran)'}; ${others ? `${others.length} other app(s) were connected` : 'other apps unknown'}`,
      );
      this.startPolling();
      return {
        stopped: daemonView(stopped),
        others: Array.isArray(others)
          ? others.map((o) => ({ title: str(o?.title, 100), harness: str(o?.harness, 100), sessions: num(o?.sessions) ?? 0 }))
          : null,
      };
    });
  }

  /** Starts the daemon (or connects to the one another app started) and connects. */
  start() {
    return this.run('start', async () => {
      try {
        const daemon = daemonView(await this.harness.daemon.start());
        this.failure = null;
        this.elsewhere = null;
        this.stopPolling();
        this.log(`service: started, daemon ${daemon?.pid} ${daemon?.version}`);
        return { daemon };
      } catch (error) {
        this.failure = String(errorInfo(error).message ?? error);
        this.log(`service: start failed: ${this.failure}`);
        throw error;
      }
    });
  }

  /** Restarts one type's server (`types.restart`): the next page that needs it starts it again. */
  async restartType(id: string) {
    if (typeof id !== 'string' || !TYPE_ID.test(id)) throw new Error('not a type');
    const answer = await this.library.call(LIBRARY_ROUTES.typesRestart, { body: { id } });
    this.log(`service: type server ${id} ${answer?.stopped ? 'restarted' : 'was not running'}`);
    await this.refresh();
    return { id, stopped: answer?.stopped === true };
  }

  openLogs() {
    return this.actions.openPath(join(this.profile.home, 'logs'));
  }

  revealHome() {
    return this.actions.reveal(this.profile.home);
  }

  /** `open-artifact doctor --json`, with this app's executable as Node; the view carries the findings. */
  async runDoctor() {
    if (this.doctor?.running) return this.doctor;
    this.doctor = { running: true };
    this.changed();
    try {
      const { code, stdout, stderr } = await this.cli({ runtimeDir: this.runtimeDir, profile: this.profile, args: ['doctor', '--json'] });
      const report = objectOf(jsonOf(stdout));
      this.doctor = report && Array.isArray(report.findings) ? { report: doctorView(report) } : { error: errorLine(stderr) || `doctor exited ${code}` };
    } catch (error) {
      this.doctor = { error: String(errorInfo(error).message ?? error) };
    }
    this.log(`service: doctor ${this.doctor.report ? JSON.stringify(this.doctor.report.counts) : `failed: ${this.doctor.error}`}`);
    this.changed();
    return this.doctor;
  }

  startPolling() {
    if (this.timer || this.closed) return;
    const poll = async () => {
      if (!this.harness.daemon.stopped) return this.stopPolling();
      const running = await this.readDaemon(this.profile.home).catch(() => null);
      const next = running ? daemonView(running) : null;
      if (JSON.stringify(next) !== JSON.stringify(this.elsewhere)) {
        this.elsewhere = next;
        this.log(`service: ${next ? `a daemon runs again for this home (pid ${next.pid}), started elsewhere` : 'no daemon runs for this home'}`);
        this.changed();
      }
    };
    this.timer = setInterval(() => void poll(), POLL_MS);
    void poll();
  }

  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  close() {
    this.closed = true;
    this.stopPolling();
  }
}
