/**
 * Type servers: URL entries and the local servers the daemon starts for
 * server entries. The daemon resolves an artifact's page here: a URL
 * template filled in, or `/__open-artifact/open` asked of the type's server (started
 * first when it is not running). One process per type, shared by all its
 * artifacts.
 *
 * Start-up follows the protocol: the server gets the `OPEN_ARTIFACT_*` variables, has
 * `READY_TIMEOUT_MS` to print its ready line, is probed every
 * `HEALTH_INTERVAL_MS`, counts as stopped after `HEALTH_MISSES` misses, and
 * is given up on after `MAX_RESTARTS` failed starts (with back-off between).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  HEALTH_INTERVAL_MS,
  HEALTH_MISSES,
  MAX_RESTARTS,
  OPEN_ARTIFACT_PROTOCOL,
  OpenArtifactError,
  READY_TIMEOUT_MS,
  TYPE_SERVER_ROUTES,
  type OpenRequest,
  type OpenResult,
  type ReadyLine,
  type ResolvedEntry,
  type TypeServerEnv,
  type TypeServerStatus,
} from '@open-artifact/protocol';
import { ensureDir, files, readJson, writeJson } from './paths.ts';
import { isLoopbackUrl, type TypeInfo } from './types.ts';

const KILL_MS = 5_000;
const CALL_MS = 10_000;
/** How long the agent's action calls may take (a check of a big project, an upload, a snapshot); long ones answer at once with a task. */
export const ACTION_CALL_MS = 90_000;

/** Where a type server's files go under the daemon's home. */
export const serverFiles = {
  /** Last address and pid (`servers/<type>.json`), to reuse the port. */
  state: (type: string): string => join(files.servers(), `${type}.json`),
  /** The server's own state folder (`OPEN_ARTIFACT_STATE_DIR`). */
  stateDir: (type: string): string => join(files.servers(), type),
  log: (type: string): string => join(files.logs(), 'servers', `${type}.log`),
  /** The last action list the server gave (`servers/<type>.actions.json`). */
  actions: (type: string): string => join(files.servers(), `${type}.actions.json`),
};

/** One action a type server lists (`GET /__open-artifact/actions`). */
export interface TypeAction {
  name: string;
  title: string;
  description?: string;
  /** JSON Schema of `args`. */
  schema?: Record<string, unknown>;
  effect?: 'read' | 'write';
  long?: boolean;
}

/** An action name the agent may call: not empty, not reserved. */
export const ACTION_NAME = /^[a-z0-9_-][a-z0-9_.-]{0,63}$/i;

/** The entries of a `GET /__open-artifact/actions` answer that are well formed, reserved `open-artifact.*` ones left out. */
export function parseActions(raw: unknown): TypeAction[] {
  if (!Array.isArray(raw)) return [];
  const out: TypeAction[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (typeof a.name !== 'string' || !ACTION_NAME.test(a.name) || a.name.startsWith('open-artifact.')) continue;
    const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const description = text(a.description, 1000);
    out.push({
      name: a.name,
      title: text(a.title, 200) || a.name,
      ...(description ? { description } : {}),
      ...(a.schema && typeof a.schema === 'object' && !Array.isArray(a.schema) ? { schema: a.schema as Record<string, unknown> } : {}),
      ...(a.effect === 'read' || a.effect === 'write' ? { effect: a.effect } : {}),
      ...(a.long === true ? { long: true } : {}),
    });
  }
  return out;
}

/** What {@link serverFiles.actions} holds. */
interface ActionCache {
  stamp: string;
  /** The process that gave the list (`null`: a URL entry or a server the daemon did not start). */
  pid: number | null;
  actions: TypeAction[];
}

/** Fills a URL template's `{id}`, `{lang}` and `{root}`. */
export function fillTemplate(template: string, values: { id: string; lang?: string | undefined; root: string }): string {
  return template.replace(/\{(id|lang|root)\}/g, (_, key: string) =>
    encodeURIComponent(key === 'id' ? values.id : key === 'lang' ? values.lang || 'en' : values.root),
  );
}

const withSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`);

/** The base of a URL template: what comes before its first placeholder. */
const templateBase = (template: string): string => withSlash(new URL(template.replace(/\{[a-z]+\}.*$/, '')).href);

/** What, changed, means a running server is stale (the type folder was updated or reinstalled). */
function stampOf(type: TypeInfo): string {
  let mtime = 0;
  try {
    mtime = statSync(join(type.dir, 'artifact-type.json')).mtimeMs;
  } catch {
    /* no manifest */
  }
  return JSON.stringify([type.dir, type.version, mtime, type.entry]);
}

type ServerState = 'stopped' | 'starting' | 'ready';

interface Running {
  type: TypeInfo;
  stamp: string;
  child: ChildProcess | null;
  base: string | null;
  secret: string | null;
  state: ServerState;
  starting: Promise<string> | null;
  failures: number;
  retryAt: number;
  error: string | null;
  misses: number;
}

/** Options of {@link TypeServers}. */
export interface TypeServersOptions {
  /** The daemon's base URL (`OPEN_ARTIFACT_DAEMON_URL`). */
  daemonUrl: () => string;
  /** The Type API token of a type (`OPEN_ARTIFACT_TYPE_TOKEN`). */
  tokenFor: (typeId: string) => string;
  log: (line: string) => void;
}

/** A type's entry needs a server or URL to answer `/__open-artifact/*`. */
type RemoteEntry = Extract<ResolvedEntry, { kind: 'url' | 'server' }>;

const remoteEntry = (type: TypeInfo): RemoteEntry => {
  const entry = type.entry;
  if (!entry || entry.kind === 'static') throw new OpenArtifactError('unsupported', `${type.id} has no server.`);
  return entry;
};

/** The type servers of one daemon. */
export class TypeServers {
  private readonly options: TypeServersOptions;
  private readonly byType = new Map<string, Running>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly onExit: () => void;

  constructor(options: TypeServersOptions) {
    this.options = options;
    this.timer = setInterval(() => void this.checkHealth(), HEALTH_INTERVAL_MS);
    this.timer.unref?.();
    // A daemon that exits without closeAll() (a crash) does not leave its servers behind.
    this.onExit = () => this.killAll('SIGTERM');
    process.on('exit', this.onExit);
  }

  /** What the type list shows about a type's server; `null` when it never started. */
  status(typeId: string): TypeServerStatus | null {
    const s = this.byType.get(typeId);
    if (!s) return null;
    const state: TypeServerStatus['state'] =
      s.state === 'ready' ? 'running' : s.state === 'starting' ? 'starting' : s.failures >= MAX_RESTARTS || s.error ? 'failed' : 'stopped';
    return {
      state,
      ...(s.base ? { url: s.base } : {}),
      ...(s.child?.pid ? { pid: s.child.pid } : {}),
      ...(s.error ? { error: s.error } : {}),
      restarts: s.failures,
    };
  }

  /** True when the type's server is up. */
  isReady(typeId: string): boolean {
    return this.byType.get(typeId)?.state === 'ready';
  }

  /** The artifact's page (absolute addresses): a URL template filled in, or `/__open-artifact/open` asked of the server. */
  async open(type: TypeInfo, record: { id: string; root: string; title: string }, context: { lang?: string; shell: string; hosted?: OpenRequest['hosted'] }): Promise<{ url: string; page_url: string; content_url?: string }> {
    const entry = remoteEntry(type);
    if (entry.kind === 'url' && !entry.open) {
      const url = fillTemplate(entry.url, { id: record.id, lang: context.lang, root: record.root });
      return { url, page_url: url };
    }
    const base = await this.base(type);
    if (!entry.open) {
      // A server with a url template: the server is up, its page is the template filled in.
      const url = fillTemplate(entry.url!, { id: record.id, lang: context.lang, root: record.root });
      return { url, page_url: url };
    }
    const request: OpenRequest = { id: record.id, root: record.root, title: record.title, lang: context.lang || 'en', shell: context.shell, ...(context.hosted ? { hosted: context.hosted } : {}) };
    const out = await this.call<Partial<OpenResult>>(type, 'POST', TYPE_SERVER_ROUTES.open, request);
    if (!out || typeof out.url !== 'string') throw new OpenArtifactError('server_failed', `${type.id}: ${TYPE_SERVER_ROUTES.open} returned no url.`);
    const url = new URL(out.url, base).href;
    const pageUrl = typeof out.page_url === 'string' ? new URL(out.page_url, base).href : url;
    return { url, page_url: pageUrl, ...(typeof out.content_url === 'string' ? { content_url: new URL(out.content_url, base).href } : {}) };
  }

  /** Calls one of the server's `/__open-artifact/*` routes with its secret. */
  async call<T = unknown>(type: TypeInfo, method: 'GET' | 'POST', route: string, body?: unknown, query?: Record<string, string>, timeoutMs = CALL_MS): Promise<T> {
    const base = await this.base(type);
    const secret = this.byType.get(type.id)?.secret;
    const url = new URL(route.replace(/^\//, ''), base);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new OpenArtifactError('server_failed', `${type.id}: ${url.pathname} did not answer (${(error as Error)?.message ?? error}).`);
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!response.ok) {
      const e = (json ?? {}) as { code?: unknown; message?: unknown; fix?: unknown; current?: unknown };
      throw new OpenArtifactError(typeof e.code === 'string' ? e.code : 'server_failed', typeof e.message === 'string' ? e.message : `${type.id}: ${url.pathname} answered ${response.status}.`, {
        status: response.status,
        ...(typeof e.fix === 'string' && e.fix.trim() ? { fix: e.fix.trim().slice(0, 1000) } : {}),
        // A conflict's current state is data the caller merges with: it travels in its own field.
        ...(e.code === 'conflict' && e.current !== undefined ? { current: e.current } : {}),
      });
    }
    return json as T;
  }

  /**
   * Calls one of the server's `/__open-artifact/*` routes with its secret and
   * hands back the answer as it is, body unread (a download to pass on). The
   * timeout covers the wait for the headers only.
   */
  async fetchRaw(type: TypeInfo, method: 'GET' | 'HEAD', route: string, query?: Record<string, string>, timeoutMs = CALL_MS): Promise<Response> {
    const base = await this.base(type);
    const secret = this.byType.get(type.id)?.secret;
    const url = new URL(route.replace(/^\//, ''), base);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error('timed out')), timeoutMs);
    try {
      return await fetch(url, { method, headers: secret ? { Authorization: `Bearer ${secret}` } : {}, signal: abort.signal });
    } catch (error) {
      throw new OpenArtifactError('server_failed', `${type.id}: ${url.pathname} did not answer (${(error as Error)?.message ?? error}).`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The type's actions (`GET /__open-artifact/actions`). The list is kept on disk until
   * the type changes and asked again when its server process changes. With
   * `start: false` a stopped server is not started: the kept list answers,
   * or `null` when there is none. `[]`: the type has no actions.
   */
  async actions(type: TypeInfo, options: { start?: boolean } = {}): Promise<TypeAction[] | null> {
    const entry = type.entry;
    if (!entry || entry.kind === 'static' || !entry.actions) return [];
    const stamp = stampOf(type);
    const kept = readJson<ActionCache | null>(serverFiles.actions(type.id), null);
    const cached = kept && kept.stamp === stamp && Array.isArray(kept.actions) ? kept : null;
    const pid = (): number | null => this.byType.get(type.id)?.child?.pid ?? null;
    const ready = entry.kind === 'url' || this.isReady(type.id);
    if (cached && (!ready || cached.pid === pid())) return cached.actions;
    if (!ready && options.start === false) return null;
    try {
      const out = await this.call<{ actions?: unknown }>(type, 'GET', TYPE_SERVER_ROUTES.actions.slice(0, -1));
      const actions = parseActions(out?.actions);
      try {
        writeJson(serverFiles.actions(type.id), { stamp, pid: pid(), actions } satisfies ActionCache);
      } catch {
        /* kept in memory only for this call */
      }
      return actions;
    } catch (error) {
      this.options.log(`server ${type.id}: ${TYPE_SERVER_ROUTES.actions.slice(0, -1)} failed (${(error as Error)?.message ?? error})`);
      return cached?.actions ?? null;
    }
  }

  /** The server's base address: the entry's url, or the one its process printed, starting it when needed. */
  async base(type: TypeInfo): Promise<string> {
    const entry = remoteEntry(type);
    if (entry.kind === 'url') return templateBase(entry.url);
    let s = this.byType.get(type.id);
    const stamp = stampOf(type);
    if (s && s.stamp !== stamp) {
      // The type folder changed: its server starts again from the new files.
      this.stop(type.id);
      s = undefined;
    }
    if (!s) {
      s = { type, stamp, child: null, base: null, secret: null, state: 'stopped', starting: null, failures: 0, retryAt: 0, error: null, misses: 0 };
      this.byType.set(type.id, s);
    }
    if (s.state === 'ready' && s.base) return s.base;
    if (s.starting) return s.starting;
    const log = serverFiles.log(type.id);
    if (s.failures >= MAX_RESTARTS) throw new OpenArtifactError('server_failed', `${type.id}: its server failed to start ${s.failures} times (${s.error}). See ${log}.`);
    if (Date.now() < s.retryAt) {
      throw new OpenArtifactError('server_failed', `${type.id}: its server failed (${s.error}); trying again in ${Math.ceil((s.retryAt - Date.now()) / 1000)} s. See ${log}.`);
    }
    const running = s;
    running.starting = this.launch(running)
      .then((started) => {
        // A new process: ask for its actions now, so the next read and create list them.
        if (type.entry?.kind !== 'static' && type.entry?.actions) setImmediate(() => void this.actions(type).catch(() => {}));
        return started;
      })
      .finally(() => {
        running.starting = null;
      });
    return running.starting;
  }

  private async launch(s: Running): Promise<string> {
    const { type } = s;
    if (!type.trusted) throw new OpenArtifactError('not_granted', `${type.id} is in a project folder that is not trusted yet; trust it to start its server.`);
    const entry = remoteEntry(type);
    // `url` with `start`: a server already running there (a developer's own) is used as it is.
    if (entry.url) {
      const base = templateBase(entry.url);
      if (await this.healthy(base, null)) {
        Object.assign(s, { base, state: 'ready', secret: null, child: null, error: null, misses: 0 });
        this.options.log(`server ${type.id}: using the one already at ${base}`);
        return base;
      }
    }
    try {
      const base = await this.spawn(s);
      s.failures = 0;
      return base;
    } catch (error) {
      s.failures += 1;
      s.error = (error as Error)?.message ?? String(error);
      s.retryAt = Date.now() + Math.min(60_000, 1000 * 2 ** (s.failures - 1));
      s.state = 'stopped';
      this.options.log(`server ${type.id}: ${s.error}`);
      throw new OpenArtifactError('server_failed', `${type.id}: its server did not start (${s.error}). See ${serverFiles.log(type.id)}.`);
    }
  }

  private spawn(s: Running): Promise<string> {
    const { type } = s;
    const entry = type.entry;
    if (entry?.kind !== 'server') return Promise.reject(new Error('not a server entry'));
    const { start } = entry;
    const last = readJson<{ port?: number } | null>(serverFiles.state(type.id), null);
    const secret = randomBytes(24).toString('base64url');
    ensureDir(dirname(serverFiles.log(type.id)));
    const stateDir = ensureDir(serverFiles.stateDir(type.id));
    const log = createWriteStream(serverFiles.log(type.id), { flags: 'a' });
    log.write(`\n--- ${new Date().toISOString()} start ${start.command} ${start.args.join(' ')}\n`);
    // `node` is this process's own runtime (in an Electron host, the app run as Node), so no node is needed on PATH.
    const isNode = start.command === 'node';
    const command = isNode ? process.execPath : start.command;
    const openArtifactEnv: TypeServerEnv = {
      OPEN_ARTIFACT_PROTOCOL: String(OPEN_ARTIFACT_PROTOCOL),
      OPEN_ARTIFACT_TYPE: type.id,
      OPEN_ARTIFACT_TYPE_DIR: type.dir,
      OPEN_ARTIFACT_PORT: String(Number(last?.port) || 0),
      OPEN_ARTIFACT_SECRET: secret,
      OPEN_ARTIFACT_DAEMON_URL: this.options.daemonUrl(),
      OPEN_ARTIFACT_TYPE_TOKEN: this.options.tokenFor(type.id),
      OPEN_ARTIFACT_STATE_DIR: stateDir,
    };
    const env: NodeJS.ProcessEnv = { ...process.env, ...(isNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}), ...start.env, ...openArtifactEnv };
    const readyMs = Number(process.env.OPEN_ARTIFACT_SERVER_READY_MS) || READY_TIMEOUT_MS;
    return new Promise((resolveReady, rejectReady) => {
      let child: ChildProcess;
      try {
        child = spawn(command, start.args, { cwd: type.dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        log.end();
        rejectReady(error);
        return;
      }
      s.child = child;
      s.secret = secret;
      s.state = 'starting';
      let settled = false;
      let buffered = '';
      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.kill(child, 'SIGTERM');
        rejectReady(new Error(message));
      };
      const timer = setTimeout(() => fail(`no ready line within ${readyMs / 1000} s`), readyMs);
      child.stderr?.pipe(log, { end: false });
      child.stdout?.on('data', (chunk: Buffer) => {
        log.write(chunk);
        if (settled) return;
        buffered += chunk.toString('utf8');
        let nl: number;
        while ((nl = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, nl).trim();
          buffered = buffered.slice(nl + 1);
          if (!line.startsWith('{')) continue;
          let message: Partial<ReadyLine>;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message?.openArtifact !== 'ready') continue;
          if (typeof message.url !== 'string' || !/^http:\/\//.test(message.url) || !isLoopbackUrl(message.url)) {
            fail(`its ready line has no loopback url: ${line.slice(0, 200)}`);
            return;
          }
          settled = true;
          clearTimeout(timer);
          const base = withSlash(message.url);
          Object.assign(s, { base, state: 'ready', error: null, misses: 0 });
          try {
            writeJson(serverFiles.state(type.id), { port: Number(new URL(base).port) || null, url: base, pid: child.pid, at: new Date().toISOString() });
          } catch {
            /* the port is a suggestion */
          }
          this.options.log(`server ${type.id}: ready at ${base} (pid ${child.pid})`);
          resolveReady(base);
          return;
        }
      });
      child.on('error', (error) => fail(`could not run ${start.command}: ${error.message}`));
      child.on('exit', (code, signal) => {
        log.write(`--- exit ${code ?? signal}\n`);
        log.end();
        if (s.child === child) {
          s.child = null;
          if (s.state === 'ready') this.options.log(`server ${type.id}: exited (${code ?? signal})`);
          s.state = 'stopped';
          s.base = null;
        }
        fail(`it exited (${code ?? signal}) before it was ready`);
      });
    });
  }

  private async healthy(base: string, secret: string | null): Promise<boolean> {
    try {
      const response = await fetch(new URL(TYPE_SERVER_ROUTES.health.replace(/^\//, ''), base), {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { openArtifact?: unknown };
      return Number(body?.openArtifact) >= 1;
    } catch {
      return false;
    }
  }

  /** One health round: a server that misses `HEALTH_MISSES` probes in a row is stopped; the next open starts it again. */
  async checkHealth(): Promise<void> {
    for (const [id, s] of this.byType) {
      if (s.state !== 'ready' || !s.base) continue;
      if (await this.healthy(s.base, s.secret)) {
        s.misses = 0;
        continue;
      }
      s.misses += 1;
      if (s.misses >= HEALTH_MISSES) {
        this.options.log(`server ${id}: no health for ${s.misses} checks; stopping it`);
        this.stop(id);
      }
    }
  }

  /** The type folders changed: servers whose type changed or went away stop (the next open starts the new one). */
  typesChanged(lookup: (id: string, old: TypeInfo) => TypeInfo | null): void {
    for (const [id, s] of this.byType) {
      const now = lookup(id, s.type);
      if (!now || stampOf(now) !== s.stamp) {
        this.options.log(`server ${id}: its type changed; stopping it`);
        this.stop(id);
      }
    }
  }

  /** Stops a type's server. */
  stop(typeId: string): void {
    const s = this.byType.get(typeId);
    if (!s) return;
    this.byType.delete(typeId);
    if (s.child) this.kill(s.child, 'SIGTERM');
  }

  private kill(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill(signal);
    } catch {
      return;
    }
    if (signal === 'SIGTERM') {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, KILL_MS);
      timer.unref?.();
    }
  }

  private killAll(signal: NodeJS.Signals): void {
    for (const s of this.byType.values()) if (s.child) this.kill(s.child, signal);
  }

  /** Stops every server. */
  closeAll(): void {
    clearInterval(this.timer);
    process.off('exit', this.onExit);
    for (const id of [...this.byType.keys()]) this.stop(id);
  }
}
