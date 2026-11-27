/**
 * Shared connector access, the page's side.
 *
 * Connectors are the owner's alone. The owner may share one connector's access with everyone who opens the
 * dashboard: their computer then runs the exact source calls they approved for any viewer (see type-server's
 * `connector-shares.ts`), and `dash/settings.shared[connector]` marks the connector as shared.
 *
 * On everyone else's page, a source's own call on a shared connector asks the owner's computer
 * (`POST _api/data/shared`) with its template and the filter values it uses; the answer goes through the usual
 * readers and loaders. A connector nobody shares, a call the server doesn't know or a server that doesn't share
 * (a cloud host) leaves the call to the page's own access (a published snapshot, or none). On the sharer's own page
 * a source call the share doesn't hold fails until it is shared too, so what the sharer sees is what everyone sees.
 */

import { create } from 'zustand';
import {
  canonicalJson,
  getDatasetParameterNames,
  isPlainObject,
  parseStoredQueryArgs,
  type ConnectorShareMark,
  type Dataset,
  type DatasetRun,
  type LoadFailure,
  type McpToolResult,
  type UnknownRecord,
} from '@open-artifact/data-core';
import type {
  DataShareResponse,
  DataSharedResponse,
  DataSharesResponse,
  SharedCallAnswer,
  SharedCallCode,
  SharedCallRequest,
  SharedConnectorCall,
} from '@open-artifact/runtime';
import type { McpToolClient } from './mcp.ts';
import { markFlaky } from './retry.ts';

/* ---- words ------------------------------------------------------------------------------------------------------- */

export const SHARED_RESULTS_UPDATING_MESSAGE = 'Shared results are updating.';
export const SHARED_VALUE_REFUSED_MESSAGE = 'A filter’s value can’t be used with this shared query. Try a different one.';
export const SHARED_TOO_LARGE_MESSAGE = 'Result too large to share. Aggregate it in the query.';
export const SHARED_RESULTS_FAILED_MESSAGE = 'Couldn’t load shared results.';

export function describeUnsharedQueries(connector: string): string {
  return `${connector} has queries you haven’t shared yet.`;
}

/* ---- calls ------------------------------------------------------------------------------------------------------- */

/** The share key of a call: what the server approves (connector, tool, kind, arguments with blanks, rules). */
export function sharedCallKey(call: SharedConnectorCall): string {
  return canonicalJson({
    connector: call.connector,
    tool: call.tool,
    ...(call.call === true ? { call: true } : {}),
    args: call.args,
    ...(call.rules === undefined ? {} : { rules: call.rules }),
  });
}

/**
 * A source's own call as a share holds it: its written arguments (blanks kept) and rules, with the filter values it
 * uses now. `null` for a source that isn't a query that can run (no connector or tool, a problem, unreadable rules).
 */
export function getSharedSourceCall(dataset: Dataset): SharedCallRequest | null {
  const source = dataset.source;
  if (source.kind !== 'query' || source.connector === '' || source.tool === '' || source.problem !== undefined || source.rulesRefused === true) return null;
  const names = getDatasetParameterNames(dataset);
  const args = names.length === 0 ? parseStoredQueryArgs(source) : parseStoredQueryArgs({ args: source.template ?? source.args });
  const params: Record<string, unknown> = {};
  for (const name of names) params[name] = source.values !== undefined && Object.hasOwn(source.values, name) ? (source.values[name] ?? null) : null;
  return {
    connector: source.connector,
    tool: source.tool,
    ...(source.call === true ? { call: true as const } : {}),
    args,
    ...(source.rules === undefined ? {} : { rules: source.rules as Record<string, unknown> }),
    ...(names.length === 0 ? {} : { params }),
  };
}

/** Every distinct source call on a connector, as a share approves them. */
export function collectSharedCalls(connector: string, datasets: readonly Dataset[]): SharedConnectorCall[] {
  const calls = new Map<string, SharedConnectorCall>();
  for (const dataset of datasets) {
    const call = getSharedSourceCall(dataset);
    if (call === null || call.connector !== connector) continue;
    const { params: _params, ...approved } = call;
    calls.set(sharedCallKey(approved), approved);
  }
  return [...calls.values()];
}

/** The source whose current call this is (connector, tool and filled arguments), or `null` (a loader's further call). */
export function findSourceCall(datasets: readonly Dataset[], connector: string, tool: string, args: UnknownRecord): SharedCallRequest | null {
  const wanted = canonicalJson(args);
  for (const dataset of datasets) {
    const source = dataset.source;
    if (source.kind !== 'query' || source.connector !== connector || source.tool !== tool) continue;
    if (canonicalJson(parseStoredQueryArgs(source)) !== wanted) continue;
    const call = getSharedSourceCall(dataset);
    if (call !== null) return call;
  }
  return null;
}

/* ---- state ------------------------------------------------------------------------------------------------------- */

export interface ServerShare {
  sharer: { id: string; name: string };
  at: number;
  keys: ReadonlySet<string>;
}

export interface SharedAccessState {
  /** The shares the owner's computer keeps, by connector; `null` until read, or where shares can't be read. */
  shares: ReadonlyMap<string, ServerShare> | null;
  /** Calls on the sharer's own page that a share doesn't hold yet, by connector (their keys). */
  unshared: Readonly<Record<string, readonly string[]>>;
  /** Whether the page's server shares connectors: `null` until asked, `false` on a cloud host. */
  supported: boolean | null;
}

export const useSharedAccess = create<SharedAccessState>(() => ({ shares: null, unshared: {}, supported: null }));

/** Forgets what the page knows (a test, or a page that reloads its dashboard). */
export function resetSharedAccess(): void {
  useSharedAccess.setState({ shares: null, unshared: {}, supported: null }, true);
}

/* ---- transport --------------------------------------------------------------------------------------------------- */

/** The routes beside the page, as the owner's computer serves them. */
export interface SharedAccessTransport {
  shares(): Promise<DataSharesResponse>;
  share(connector: string, calls: SharedConnectorCall[]): Promise<DataShareResponse>;
  run(calls: SharedCallRequest[], options: { reuseMs: number; refresh: boolean }): Promise<DataSharedResponse>;
}

/** An error the share routes answered with; `code` is the server's. */
export class ShareRouteError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ShareRouteError';
    this.status = status;
    this.code = code;
  }
}

export function createSharedAccessTransport(fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)): SharedAccessTransport {
  const send = async <T,>(route: string, body?: unknown): Promise<T> => {
    const url = new URL(route, globalThis.location?.href).toString();
    const response = await fetcher(
      url,
      body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    );
    const answer = (await response.json().catch(() => ({}))) as UnknownRecord;
    if (!response.ok) throw new ShareRouteError(response.status, typeof answer.code === 'string' ? answer.code : '', typeof answer.message === 'string' ? answer.message : `HTTP ${response.status}`);
    return answer as T;
  };
  return {
    shares: () => send<DataSharesResponse>('_api/data/shares'),
    share: (connector, calls) => send<DataShareResponse>('_api/data/share', { connector, calls }),
    run: (calls, { reuseMs, refresh }) => send<DataSharedResponse>('_api/data/shared', { calls, reuseMs, ...(refresh ? { refresh: true } : {}) }),
  };
}

/** Reads the owner's computer's shares into the state; where it shares none (a cloud host), the state stays `null`. */
export async function loadServerShares(transport: SharedAccessTransport): Promise<void> {
  try {
    const answer = await transport.shares();
    const shares = new Map<string, ServerShare>();
    for (const share of Array.isArray(answer.shares) ? answer.shares : []) {
      if (!isPlainObject(share) || typeof share.connector !== 'string') continue;
      shares.set(share.connector, { sharer: share.sharer, at: share.at, keys: new Set(share.keys) });
    }
    useSharedAccess.setState({ shares, supported: true });
  } catch {
    useSharedAccess.setState({ shares: null, supported: false });
  }
}

/* ---- the tool client with shared access in front ----------------------------------------------------------------- */

export interface SharedAccessOptions {
  transport: SharedAccessTransport;
  /** Whether this page's viewer is the one who shares the connector (their own page runs their own calls). */
  isSharer: (mark: ConnectorShareMark) => boolean;
  /** `dash/settings.shared[connector]`, when someone shares it. */
  markOf: (connector: string) => ConnectorShareMark | undefined;
  /** The source whose current call this is. */
  resolve: (connector: string, tool: string, args: UnknownRecord) => SharedCallRequest | null;
  /** How long the page reuses results (`dash/settings.updates`). */
  reuseMs: () => number;
  /** Resolves once the owner's computer's shares are read (the sharer's page checks its calls against them). */
  ensureShares?: () => Promise<void>;
}

/** What a shared call that gave no result rejects with: `code` is `shared_<server code>`. */
export interface SharedCallError {
  code: `shared_${SharedCallCode | 'unshared'}`;
  connector: string;
  message: string;
}

const FALLS_BACK: ReadonlySet<SharedCallCode> = new Set<SharedCallCode>(['not_shared', 'invalid_call']);

function sharedError(connector: string, code: SharedCallError['code'], message = ''): SharedCallError {
  return { code, connector, message };
}

/**
 * The tool client with shared access in front: on everyone else's page, a source's own call on a shared connector
 * runs as the sharer; on the sharer's page, a source call the share doesn't hold fails until shared.
 * Every other call (and every call while nothing is shared) goes as it did.
 */
export function withSharedAccess(client: McpToolClient, options: SharedAccessOptions): McpToolClient {
  let batch: { calls: SharedCallRequest[]; refresh: boolean; waiting: ((answer: SharedCallAnswer | Error) => void)[] } | null = null;
  const ask = (call: SharedCallRequest, refresh: boolean): Promise<SharedCallAnswer> =>
    new Promise<SharedCallAnswer>((resolve, reject) => {
      if (batch === null) {
        const current = { calls: [] as SharedCallRequest[], refresh: false, waiting: [] as ((answer: SharedCallAnswer | Error) => void)[] };
        batch = current;
        queueMicrotask(() => {
          batch = null;
          options.transport.run(current.calls, { reuseMs: options.reuseMs(), refresh: current.refresh }).then(
            (answer) => current.waiting.forEach((settle, index) => settle(answer.answers?.[index] ?? new Error('No answer.'))),
            (error: unknown) => current.waiting.forEach((settle) => settle(error instanceof Error ? error : new Error(String(error)))),
          );
        });
      }
      batch.calls.push(call);
      batch.refresh ||= refresh;
      batch.waiting.push((answer) => (answer instanceof Error ? reject(answer) : resolve(answer)));
    });

  return {
    ...client,
    async call(connector, tool, args, callOptions) {
      const mark = options.markOf(connector);
      if (mark === undefined) return client.call(connector, tool, args, callOptions);
      const source = options.resolve(connector, tool, args);
      if (source === null) return client.call(connector, tool, args, callOptions);
      if (options.isSharer(mark)) {
        // The sharer's page: what the share doesn't hold waits to be shared.
        await options.ensureShares?.();
        const share = useSharedAccess.getState().shares?.get(connector);
        if (share !== undefined) {
          const { params: _params, ...approved } = source;
          const key = sharedCallKey(approved);
          if (!share.keys.has(key)) {
            const unshared = useSharedAccess.getState().unshared;
            const keys = unshared[connector] ?? [];
            if (!keys.includes(key)) useSharedAccess.setState({ unshared: { ...unshared, [connector]: [...keys, key] } });
            throw sharedError(connector, 'shared_unshared', describeUnsharedQueries(connector));
          }
        }
        return client.call(connector, tool, args, callOptions);
      }
      let answer: SharedCallAnswer;
      try {
        answer = await ask(source, callOptions?.cache?.refresh === true);
      } catch {
        // The page's server doesn't share connectors (a cloud host): the page's own access, as before.
        return client.call(connector, tool, args, callOptions);
      }
      if (answer.ok) return { ...(answer.result as McpToolResult), cache: { storedAt: answer.ranAt } };
      if (FALLS_BACK.has(answer.code)) return client.call(connector, tool, args, callOptions);
      throw sharedError(connector, `shared_${answer.code}`, answer.message ?? '');
    },
  };
}

/** Whether an error is a shared call's. */
export function isSharedCallError(error: unknown): error is SharedCallError {
  return isPlainObject(error) && typeof error.code === 'string' && error.code.startsWith('shared_') && typeof error.connector === 'string';
}

/** A shared call's error as a load's failure. */
export function sharedErrorToLoadFailure(error: SharedCallError): LoadFailure {
  switch (error.code) {
    case 'shared_unshared':
      return { ok: false, kind: 'refused', message: describeUnsharedQueries(error.connector) };
    case 'shared_not_approved':
      return { ok: false, kind: 'declined', message: SHARED_RESULTS_UPDATING_MESSAGE };
    case 'shared_value_refused':
      return { ok: false, kind: 'refused', message: SHARED_VALUE_REFUSED_MESSAGE };
    case 'shared_too_large':
      return { ok: false, kind: 'refused', message: SHARED_TOO_LARGE_MESSAGE };
    case 'shared_tool_error':
      return { ok: false, kind: 'failed', message: error.message || SHARED_RESULTS_FAILED_MESSAGE };
    case 'shared_timeout':
      return { ok: false, kind: 'failed', message: SHARED_RESULTS_FAILED_MESSAGE, unanswered: true, crowded: true };
    default:
      return markFlaky({ ok: false, kind: 'failed', message: SHARED_RESULTS_FAILED_MESSAGE });
  }
}

/** When the run's latest successful result was taken, or `null` when it has none. */
function lastResultAt(run: DatasetRun | null): number | null {
  if (run === null) return null;
  if (run.status === 'ok') return run.at;
  if (run.status === 'running') return run.prev === null ? (run.cached?.at ?? null) : lastResultAt(run.prev);
  return run.status === 'idle' ? null : (run.kept?.at ?? null);
}

/**
 * runSinceShare: while a source loads again after its connector was (re)shared, it shows no result taken before the
 * share, so nobody reads an answer from before as one given with the shared access.
 */
export function dropRunBeforeShare(run: DatasetRun, mark: ConnectorShareMark | undefined): DatasetRun {
  if (mark === undefined || run.status !== 'running') return run;
  const at = lastResultAt(run);
  if (at === null || at >= mark.at) return run;
  const { cached: _cached, ...rest } = run;
  return { ...rest, prev: null };
}
