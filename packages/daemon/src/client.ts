/**
 * The client side of the daemon, for harness adapters and the `open-artifact` command:
 * find or start the daemon, call its Library API, and hold a Harness API
 * connection.
 *
 * Uses the global `fetch` and `WebSocket` (Node ≥ 22, Electron's Node).
 */

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HARNESS_PATH,
  HARNESS_SUBPROTOCOL,
  OpenArtifactError,
  RPC_ERRORS,
  type AdapterCaps,
  type AdapterToDaemon,
  type AttachParams,
  type DaemonCallHandlers,
  type DaemonHealth,
  type DaemonState,
  type DaemonToAdapter,
  type HarnessEvent,
  type HelloResult,
  type RpcRequest,
  type RpcResponse,
  type SessionParams,
  type SessionStatus,
  type ToolCallResult,
  type ToolDefinition,
} from '@open-artifact/protocol';
import { files, readJson } from './paths.ts';
import pkg from '../package.json' with { type: 'json' };

/** This client's daemon version, the one {@link ensureDaemon} starts. */
const VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';

/** Whether version `a` is older than `b` (`x.y.z`, ignoring any pre-release part). */
export function isOlderVersion(a: string, b: string): boolean {
  const parts = (v: string) => v.split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/**
 * The `open-artifact` entry the client starts when no daemon runs: `$OPEN_ARTIFACT_DAEMON_BIN`,
 * else `bin/open-artifact.ts` beside this file (bundled builds set the variable or pass
 * `bin` to {@link ensureDaemon}).
 */
export function defaultDaemonBin(): string {
  return process.env.OPEN_ARTIFACT_DAEMON_BIN || resolve(dirname(fileURLToPath(import.meta.url)), 'bin', 'open-artifact.ts');
}

/** True when a process with this id is alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** `daemon.json` when its process is alive and answers health; `null` otherwise. */
export async function readDaemon(): Promise<DaemonState | null> {
  const state = readJson<DaemonState | null>(files.daemon(), null);
  if (!state?.url || !state.pid || !alive(state.pid)) return null;
  try {
    const response = await fetch(`${state.url}/__open-artifact/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await response.json()) as Partial<DaemonHealth>;
    return body?.openArtifact === 1 ? state : null;
  } catch {
    return null;
  }
}

/** Options of {@link ensureDaemon}. */
export interface EnsureDaemonOptions {
  /** How long to wait for the daemon to answer, ms. Default 15 s. */
  timeoutMs?: number;
  /** Environment of the started daemon. */
  env?: NodeJS.ProcessEnv;
  /** The `open-artifact` entry to run (default {@link defaultDaemonBin}). */
  bin?: string;
}

/** Stops a running daemon and waits until it has gone, so a new one can take its port. */
async function replaceDaemon(state: DaemonState, timeoutMs: number): Promise<void> {
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (alive(state.pid) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
}

/**
 * The running daemon, started in the background when there is none. A daemon older than this client is replaced, so
 * an upgraded harness gets its own types and tools; the harnesses connected to the old one reconnect.
 */
export async function ensureDaemon(options: EnsureDaemonOptions = {}): Promise<DaemonState> {
  const { timeoutMs = 15_000, env = process.env, bin = defaultDaemonBin() } = options;
  const running = await readDaemon();
  if (running && !isOlderVersion(running.version ?? '0.0.0', VERSION)) return running;
  if (running) await replaceDaemon(running, 5_000);
  mkdirSync(files.logs(), { recursive: true });
  const logFile = join(files.logs(), 'daemon.out');
  const fd = openSync(logFile, 'a');
  // ELECTRON_RUN_AS_NODE lets an Electron host's execPath run plain Node.
  const child = spawn(process.execPath, [bin, 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.unref();
  closeSync(fd);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 150));
    const state = await readDaemon();
    if (state) return state;
  }
  throw new OpenArtifactError('daemon_failed', `The open-artifact daemon did not start; see ${logFile}`);
}

/** Options of {@link api}. */
export interface ApiOptions {
  /** Defaults to `GET` without a body and `POST` with one. */
  method?: 'GET' | 'POST' | 'DELETE';
  /** Query parameters. */
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** More request headers (the CLI says who it is: `X-Open-Artifact-Client`, `X-Open-Artifact-Agent`). */
  headers?: Record<string, string>;
}

/** One Library API call (`/api/open-artifact.<name>`) with the daemon token. Returns the parsed JSON body. */
export async function api<T = unknown>(state: DaemonState, name: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
  const url = new URL(`/api/open-artifact.${name}`, state.url);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...options.headers, Authorization: `Bearer ${state.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return (await response.json()) as T;
}

/** Connection state reported to {@link HarnessClientOptions.onState}. */
export type HarnessConnectionState = 'connected' | 'disconnected';

/** Options of {@link HarnessClient}. */
export interface HarnessClientOptions {
  /** The harness name said in `hello`. */
  harness: string;
  caps?: AdapterCaps;
  /** Answers the daemon's calls (`wake.deliver`, `host.open`). */
  handlers?: DaemonCallHandlers;
  /** Takes events; when set, the client subscribes after connecting. */
  onEvent?: (event: HarnessEvent) => void;
  onState?: (state: HarnessConnectionState) => void;
  /** Start the daemon when none runs (default `true`). */
  autoStart?: boolean;
  /** Passed to {@link ensureDaemon}. */
  daemon?: EnsureDaemonOptions;
  /** Diagnostic log. */
  log?: (line: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Delay before reconnecting a dropped connection, ms. */
const RECONNECT_MS = 2000;

/**
 * A Harness API connection. It reconnects when dropped, and says hello and
 * attaches the sessions again.
 */
export class HarnessClient {
  readonly harness: string;
  /** The daemon this client talks to, once connected. */
  state: DaemonState | null = null;

  private readonly options: HarnessClientOptions;
  private readonly pending = new Map<string, Pending>();
  private readonly attached = new Map<string, AttachParams>();
  private nextId = 1;
  private closed = false;
  private ready: Promise<HelloResult> | null = null;
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(options: HarnessClientOptions) {
    this.options = options;
    this.harness = options.harness;
  }

  /** Connects (once); later calls share the same attempt. */
  connect(): Promise<HelloResult> {
    if (this.ready) return this.ready;
    this.ready = this.open().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async open(): Promise<HelloResult> {
    const state = this.options.autoStart === false ? await readDaemon() : await ensureDaemon(this.options.daemon);
    if (!state) throw new OpenArtifactError('no_daemon', 'No open-artifact daemon is running.');
    this.state = state;
    const ws = new WebSocket(`${state.url.replace(/^http/, 'ws')}${HARNESS_PATH}`, [HARNESS_SUBPROTOCOL]);
    this.ws = ws;
    await new Promise<void>((resolveOpen, rejectOpen) => {
      ws.addEventListener('open', () => resolveOpen(), { once: true });
      ws.addEventListener('error', () => rejectOpen(new OpenArtifactError('connect_failed', 'Could not connect to the open-artifact daemon.')), { once: true });
    });
    ws.addEventListener('message', (event) => void this.onMessage(String(event.data)));
    ws.addEventListener('close', () => this.onClose());
    const hello = await this.call('hello', { harness: this.harness, caps: this.options.caps ?? {}, token: state.token });
    this.options.onState?.('connected');
    if (this.options.onEvent) await this.call('subscribe', { on: true });
    // A reconnect attaches the sessions again.
    for (const params of this.attached.values()) await this.call('session.attach', params).catch(() => undefined);
    return hello;
  }

  private onClose(): void {
    for (const pending of this.pending.values()) pending.reject(new OpenArtifactError('disconnected', 'The open-artifact daemon went away.'));
    this.pending.clear();
    this.ready = null;
    this.ws = null;
    this.options.onState?.('disconnected');
    if (this.closed) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.connect().catch((error: unknown) => this.options.log?.(`open-artifact reconnect: ${(error as Error).message}`));
    }, RECONNECT_MS);
    (this.retry as { unref?: () => void }).unref?.();
  }

  private async onMessage(text: string): Promise<void> {
    let message: RpcRequest & Partial<RpcResponse>;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    // A response to one of our calls.
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) {
        const data = message.error.data ?? {};
        pending.reject(new OpenArtifactError(data.code ?? String(message.error.code), message.error.message, data.fix ? { fix: data.fix } : {}));
      } else pending.resolve(message.result);
      return;
    }
    if (message.method === 'event') {
      this.options.onEvent?.(message.params as HarnessEvent);
      return;
    }
    if (message.id === undefined) return;
    const handler = this.options.handlers?.[message.method as keyof DaemonToAdapter] as ((params: unknown) => unknown) | undefined;
    if (!handler) {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: RPC_ERRORS.methodNotFound, message: `No handler for ${message.method}` } });
      return;
    }
    try {
      const result = await handler(message.params ?? {});
      this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
    } catch (error) {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: RPC_ERRORS.server, message: (error as Error)?.message ?? String(error) } });
    }
  }

  private send(message: RpcRequest | RpcResponse): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  /** Calls a daemon method on the current connection (without connecting). */
  private call<M extends keyof AdapterToDaemon>(method: M, params: AdapterToDaemon[M]['params']): Promise<AdapterToDaemon[M]['result']> {
    const id = `a${this.nextId++}`;
    return new Promise((resolveCall, rejectCall) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        rejectCall(new OpenArtifactError('disconnected', 'Not connected to the open-artifact daemon.'));
        return;
      }
      this.pending.set(id, { resolve: resolveCall as (value: unknown) => void, reject: rejectCall });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Connects if needed, then calls a daemon method. */
  async request<M extends keyof AdapterToDaemon>(method: M, params: AdapterToDaemon[M]['params']): Promise<AdapterToDaemon[M]['result']> {
    await this.connect();
    return this.call(method, params);
  }

  private static keyOf(params: SessionParams): string {
    return `${params.session ?? ''}|${params.workspace ?? ''}`;
  }

  /** Attaches a session; a reconnect attaches it again. Returns what waited in its inbox. */
  attach(params: AttachParams): Promise<AdapterToDaemon['session.attach']['result']> {
    this.attached.set(HarnessClient.keyOf(params), params);
    return this.request('session.attach', params);
  }

  /** The session's agent is `running` or `idle` now; a reconnect attaches it with this status. */
  status(params: SessionParams & { status: SessionStatus }): Promise<{ ok: true }> {
    const key = HarnessClient.keyOf(params);
    const attached = this.attached.get(key);
    if (attached) this.attached.set(key, { ...attached, status: params.status });
    return this.request('session.status', params);
  }

  /** Detaches a session. */
  detach(params: SessionParams): Promise<{ ok: true }> {
    this.attached.delete(HarnessClient.keyOf(params));
    return this.request('session.detach', params);
  }

  /** The tool definitions. */
  async tools(): Promise<ToolDefinition[]> {
    return (await this.request('tools.list', {})).tools;
  }

  /** Calls a tool as `caller`. */
  callTool(name: string, args: Record<string, unknown>, caller?: SessionParams): Promise<ToolCallResult> {
    return this.request('tools.call', { name, arguments: args, ...(caller ? { caller } : {}) });
  }

  /** Closes the connection for good. */
  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
  }
}
