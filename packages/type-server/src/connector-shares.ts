/**
 * Shared connector access for Data dashboards.
 *
 * Connectors live on the owner's computer, so a guest's page has none. The owner can share one connector's access
 * with everyone who opens the dashboard, for the exact source calls it makes: each approved call is kept here, its
 * `{{filter}}` blanks unfilled. A guest's page then asks for a call with the filter values it uses; this computer
 * fills the blanks itself (the approval's rules decide which values pass), runs the call with the owner's connector
 * and hands back the answer. Nothing a page sends widens what was approved.
 *
 * Approvals are kept beside `connectors.json` (by artifact id), never in the artifact's folder: an export, a copy or
 * a cloud host never carries them. Answers are kept in memory only, for at least five minutes per call.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  canonicalJson,
  fillCallArguments,
  fillKnownConnectorArguments,
  getSourceConnectorSpec,
  isPlainObject,
  parseParameters,
  type UnknownRecord,
} from '@open-artifact/data-core';
import type {
  ConnectorShareHolder,
  DataShareResponse,
  DataSharesResponse,
  SharedCallAnswer,
  SharedCallRequest,
  SharedConnectorCall,
} from '@open-artifact/runtime/http-api';

/** The shortest time a shared answer is reused, whatever the page asks. */
export const SHARED_RESULT_FLOOR_MS = 5 * 60_000;
/** The longest. */
export const SHARED_RESULT_CEILING_MS = 24 * 60 * 60_000;
/** A larger answer is not shared. */
export const SHARED_RESULT_MAX_BYTES = 4 * 1024 * 1024;
/** How long one shared call may run. */
export const SHARED_CALL_TIMEOUT_MS = 120_000;
/** How many calls one request may ask for. */
export const SHARED_CALLS_PER_REQUEST = 64;

/** A share request the server refuses (its calls aren't calls of that connector). */
export class ShareRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareRefusal';
  }
}

interface StoredShare extends ConnectorShareHolder {
  calls: SharedConnectorCall[];
}

interface SharesFile {
  version: 1;
  artifacts: Record<string, Record<string, StoredShare>>;
}

export interface ConnectorSharesOptions {
  /** Where approvals are kept. */
  file: string;
  /** Calls a connector's tool with the owner's credentials. */
  call: (connector: string, tool: string, args: Record<string, unknown>, timeoutMs: number) => Promise<UnknownRecord>;
  now?: () => number;
  log?: (line: string) => void;
}

/** What a run of shared calls needs to know of the page that asks. */
export interface SharedRunOptions {
  viewerId: string;
  reuseMs?: number;
  refresh?: boolean;
}

/** The approval key of a call: its connector, tool, kind, arguments and rules, key order aside. */
export function sharedCallKey(call: SharedConnectorCall): string {
  return canonicalJson({
    connector: call.connector,
    tool: call.tool,
    ...(call.call === true ? { call: true } : {}),
    args: call.args,
    ...(call.rules === undefined ? {} : { rules: call.rules }),
  });
}

/** A call as a page sent it, or `null` when it isn't one. */
export function readSharedCall(value: unknown): SharedConnectorCall | null {
  if (!isPlainObject(value)) return null;
  const { connector, tool, args, rules } = value;
  if (typeof connector !== 'string' || connector === '' || typeof tool !== 'string' || tool === '' || !isPlainObject(args)) return null;
  if (rules !== undefined && !isPlainObject(rules)) return null;
  return {
    connector,
    tool,
    ...(value.call === true ? { call: true as const } : {}),
    args,
    ...(rules === undefined ? {} : { rules }),
  };
}

/** The call's arguments with its blanks filled from `params`, or why a value can't be used. */
export function fillSharedCall(call: SharedConnectorCall, params: unknown): { args: Record<string, unknown> } | { refused: string } {
  const template = canonicalJson(call.args);
  const values = parseParameters(params);
  const filled =
    call.call === true
      ? fillCallArguments(template, values, call.rules as Parameters<typeof fillCallArguments>[2], false)
      : fillKnownConnectorArguments(template, getSourceConnectorSpec({ connector: call.connector }), call.tool, values);
  if ('unfilled' in filled && typeof filled.unfilled === 'string') return { refused: filled.unfilled };
  try {
    const args: unknown = JSON.parse(filled.args);
    return isPlainObject(args) ? { args } : { refused: 'The filled arguments are not an object.' };
  } catch {
    return { refused: 'The filled arguments are not JSON.' };
  }
}

function toolErrorText(result: UnknownRecord): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content.flatMap((item) => (isPlainObject(item) && typeof item.text === 'string' ? [item.text] : []));
  return texts.join('\n').trim();
}

/** The connector error a failed run gives, as a shared call's code. */
function failureCode(error: unknown): 'timeout' | 'connector_unavailable' {
  const code = isPlainObject(error) || error instanceof Error ? (error as { code?: unknown }).code : undefined;
  const retryable = isPlainObject(error) || error instanceof Error ? (error as { retryable?: unknown }).retryable === true : false;
  return code === 'rate_limited' || (code === 'upstream_error' && retryable) ? 'timeout' : 'connector_unavailable';
}

/** Every dashboard's shared connectors on this computer. */
export class ConnectorShares {
  readonly #file: string;
  readonly #call: ConnectorSharesOptions['call'];
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  #data: SharesFile | null = null;
  readonly #answers = new Map<string, { result: UnknownRecord; ranAt: number }>();
  readonly #running = new Map<string, Promise<{ result: UnknownRecord; ranAt: number }>>();

  constructor(options: ConnectorSharesOptions) {
    this.#file = options.file;
    this.#call = options.call;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => undefined);
  }

  #load(): SharesFile {
    if (this.#data !== null) return this.#data;
    let data: SharesFile = { version: 1, artifacts: {} };
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#file, 'utf8'));
      if (isPlainObject(parsed) && isPlainObject(parsed.artifacts)) data = { version: 1, artifacts: parsed.artifacts as SharesFile['artifacts'] };
    } catch {
      /* none yet */
    }
    this.#data = data;
    return data;
  }

  #save(): void {
    const data = this.#load();
    mkdirSync(dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.#file);
  }

  #shareOf(artifact: string, connector: string): StoredShare | null {
    const shares = this.#load().artifacts[artifact];
    return shares !== undefined && Object.hasOwn(shares, connector) ? (shares[connector] ?? null) : null;
  }

  /** The dashboard's shared connectors. */
  list(artifact: string): DataSharesResponse['shares'] {
    const shares = this.#load().artifacts[artifact] ?? {};
    return Object.entries(shares).map(([connector, share]) => ({
      connector,
      sharer: share.sharer,
      at: share.at,
      keys: share.calls.map(sharedCallKey),
    }));
  }

  /** Approves exactly these calls of `connector` for everyone, as `sharer`; none stops sharing it. */
  share(artifact: string, connector: string, calls: readonly unknown[], sharer: { id: string; name: string }): DataShareResponse {
    if (connector === '') throw new ShareRefusal('Name the connector to share.');
    const approved = new Map<string, SharedConnectorCall>();
    for (const value of calls) {
      const call = readSharedCall(value);
      if (call === null || call.connector !== connector) throw new ShareRefusal(`${connector} access can’t be shared with its queries as written.`);
      approved.set(sharedCallKey(call), call);
    }
    const data = this.#load();
    const shares = (data.artifacts[artifact] ??= {});
    this.#forget(artifact, connector);
    if (approved.size === 0) {
      delete shares[connector];
      if (Object.keys(shares).length === 0) delete data.artifacts[artifact];
      this.#save();
      this.#log(`${artifact}: stopped sharing ${connector}`);
      return { connector, holder: null, count: 0 };
    }
    const holder: ConnectorShareHolder = { sharer: { id: sharer.id, name: sharer.name }, at: this.#now() };
    shares[connector] = { ...holder, calls: [...approved.values()] };
    this.#save();
    this.#log(`${artifact}: sharing ${connector} for ${approved.size} call(s)`);
    return { connector, holder, count: approved.size };
  }

  /** Forgets every answer kept for a connector of a dashboard. */
  #forget(artifact: string, connector: string): void {
    const prefix = `${artifact}\n${connector}\n`;
    for (const key of [...this.#answers.keys()]) if (key.startsWith(prefix)) this.#answers.delete(key);
  }

  /** Runs each asked call as its connector's sharer, when the share approves it. */
  async run(artifact: string, requests: readonly unknown[], options: SharedRunOptions): Promise<SharedCallAnswer[]> {
    const reuse = Math.min(SHARED_RESULT_CEILING_MS, Math.max(SHARED_RESULT_FLOOR_MS, Number.isFinite(options.reuseMs) ? (options.reuseMs as number) : 0));
    return Promise.all(requests.slice(0, SHARED_CALLS_PER_REQUEST).map((request) => this.#runOne(artifact, request, reuse, options)));
  }

  async #runOne(artifact: string, request: unknown, reuse: number, options: SharedRunOptions): Promise<SharedCallAnswer> {
    const call = readSharedCall(request);
    if (call === null) return { ok: false, code: 'invalid_call' };
    const share = this.#shareOf(artifact, call.connector);
    if (share === null) return { ok: false, code: 'not_shared' };
    const key = sharedCallKey(call);
    const approved = share.calls.find((each) => sharedCallKey(each) === key);
    if (approved === undefined) return { ok: false, code: 'not_approved', sharer: share.sharer };
    // The approval's own call (and its rules) is filled, never what the page sent beyond the values.
    const filled = fillSharedCall(approved, (request as SharedCallRequest).params);
    if ('refused' in filled) return { ok: false, code: 'value_refused', sharer: share.sharer };
    const runKey = `${artifact}\n${call.connector}\n${canonicalJson([approved.tool, filled.args])}`;
    const now = this.#now();
    const kept = this.#answers.get(runKey);
    const keptAge = kept === undefined ? Number.POSITIVE_INFINITY : now - kept.ranAt;
    let answer: { result: UnknownRecord; ranAt: number };
    if (kept !== undefined && (keptAge < SHARED_RESULT_FLOOR_MS || (keptAge < reuse && options.refresh !== true))) answer = kept;
    else {
      let running = this.#running.get(runKey);
      if (running === undefined) {
        const started = this.#call(approved.connector, approved.tool, filled.args, SHARED_CALL_TIMEOUT_MS)
          .then((result) => ({ result, ranAt: this.#now() }))
          .finally(() => {
            if (this.#running.get(runKey) === started) this.#running.delete(runKey);
          });
        running = started;
        this.#running.set(runKey, running);
      }
      try {
        answer = await running;
      } catch (error) {
        return { ok: false, code: failureCode(error), sharer: share.sharer };
      }
      // Kept only while the share it ran for still stands.
      if (this.#shareOf(artifact, call.connector) === share && !answer.result.isError) this.#answers.set(runKey, answer);
    }
    if (answer.result.isError === true) {
      const own = options.viewerId === share.sharer.id;
      const said = toolErrorText(answer.result);
      return { ok: false, code: 'tool_error', sharer: share.sharer, ...(own && said !== '' ? { message: said } : {}) };
    }
    if (Buffer.byteLength(JSON.stringify(answer.result)) > SHARED_RESULT_MAX_BYTES) return { ok: false, code: 'too_large', sharer: share.sharer };
    return { ok: true, result: answer.result, ranAt: answer.ranAt, sharer: share.sharer, at: share.at };
  }
}
