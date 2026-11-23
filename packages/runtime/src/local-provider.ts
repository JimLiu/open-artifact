/**
 * A capability provider backed by the local type server's HTTP API.
 *
 * This is what makes an editor page work when it is served by
 * `@open-artifact/type-server`: every capability call becomes a `fetch`
 * against the page base, and pushed changes arrive over one EventSource.
 */

import { getDbWriteBaseMeta, setDbChangeDeletes, setDbDocMeta, type DbDocMeta } from '@open-artifact/protocol';
import {
  ArtifactError,
  canEdit,
  type AgentCapability,
  type AgentStatus,
  type ArtifactCapability,
  type ArtifactErrorCode,
  type AssetRecord,
  type AssetsCapability,
  type CapabilityMap,
  type CapabilityName,
  type CommentsCapability,
  type CommentThread,
  type DbCapability,
  type DbChangeEvent,
  type DocCapability,
  type DownloadsCapability,
  type FilesChangedEvent,
  type HistoryCapability,
  type HistoryChangeEvent,
  type McpCapability,
  type Peer,
  type RoomCapability,
  type SheetCapability,
  type RoomMessage,
  type UserCapability,
} from './capabilities.ts';
import { canRetryCapability, type CapabilityProvider } from './client.ts';
import {
  API,
  type AgentSendRequest,
  type AgentSendResponse,
  type CommentCreateRequest,
  type CommentMoveRequest,
  type CommentRemoveRequest,
  type CommentReplyRequest,
  type CommentResolveRequest,
  type CommentSendRequest,
  type CommentEditRequest,
  type CommentReactRequest,
  type CommentsResponse,
  type CommentThreadResponse,
  type DbGetResponse,
  type DbListResponse,
  type DbWatermark,
  type DbWriteRequest,
  type DbWriteResponse,
  type ErrorResponse,
  type FilesResponse,
  type HistoryDiffResponse,
  type HistoryDismissRequest,
  type HistoryFilesResponse,
  type HistoryResponse,
  type HistoryRestoreRequest,
  type HistoryRestoreResponse,
  type McpCallRequest,
  type McpCallResponse,
  type McpToolsResponse,
  type PeersResponse,
  type PresenceRequest,
  type PublishRequest,
  type PublishResponse,
  type RoomEmitRequest,
  type ServerEventName,
  type ServerEvents,
  type SessionResponse,
} from './http-api.ts';
import { SHEET_API, SHEET_EVENT, SHEET_WALKTHROUGH_EVENT, type ImportFileResponse, type SheetFrame, type SheetSendResponse, type SheetWalkthrough, type WidgetResponse } from './sheet-api.ts';
import {
  DOC_API,
  type DocHistoryRequest,
  type DocImportResponse,
  type DocReadRequest,
  type DocSessionRequest,
  type DocVersionRequest,
} from './doc-api.ts';

/**
 * Why the page's access changed: `removed` (the server now refuses this
 * viewer: a share link was turned off or reset, the guest was removed, or
 * sharing stopped) or `changed` (the viewer is someone else now, or has
 * another role).
 */
export type AccessChange = 'removed' | 'changed';

type DocExportedNotes = Awaited<ReturnType<DocCapability['exportFile']>>['notes'];

/** Options of {@link createLocalProvider}. */
export interface LocalProviderOptions {
  /** The page base URL; defaults to the directory of `location.href`. */
  base?: string;
  /**
   * Called once when the event stream was cut and the server no longer lets
   * this viewer in as before (instead of reconnecting forever). Default:
   * reload the page, so it opens with the new role, or the server's
   * "No access" page.
   */
  onAccessChange?: (change: AccessChange) => void;
}

/**
 * What a session answer means for a page that started as `was`: `null` when
 * nothing changed, else how its access changed. `status` is the HTTP status
 * of `_api/session`.
 */
export function accessChangeOf(was: { id: string; role: string }, status: number, now?: { id?: unknown; role?: unknown } | null): AccessChange | null {
  if (status === 401 || status === 403) return 'removed';
  if (status < 200 || status >= 300 || !now) return null;
  return now.id === was.id && now.role === was.role ? null : 'changed';
}

/** Turns a non-2xx response into an {@link ArtifactError}. */
async function toError(response: Response): Promise<ArtifactError> {
  let body: Partial<ErrorResponse> = {};
  try {
    body = (await response.json()) as Partial<ErrorResponse>;
  } catch {
    /* not JSON: fall through to a status-based code */
  }
  const fallback: ArtifactErrorCode =
    response.status === 409 ? 'conflict' : response.status === 401 ? 'not_granted' : response.status === 403 ? 'not_writer' : response.status === 404 ? 'not_found' : 'unavailable';
  return new ArtifactError(body.code ?? fallback, body.message ?? `HTTP ${response.status}`, body.paths, body.retryable === true);
}

/** A random id for this page load, used to suppress echoes of our own writes. */
function makeClientId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds capabilities on first use and shares the session returned by GET _api/session.
 * A timeout or transient failure allows a fresh request. An explicit denial stays cached.
 */
export function createLocalProvider(options: LocalProviderOptions = {}): CapabilityProvider {
  const base = new URL(options.base ?? './', globalThis.location?.href);
  const client = makeClientId();
  const url = (path: string, query?: Record<string, string>): string => {
    const target = new URL(path, base);
    for (const [key, value] of Object.entries(query ?? {})) target.searchParams.set(key, value);
    return target.toString();
  };

  const json = async <T>(path: string, init?: RequestInit, query?: Record<string, string>): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(url(path, query), init);
    } catch (error) {
      throw new ArtifactError('unavailable', error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw await toError(response);
    return (await response.json()) as T;
  };

  /** POSTs a JSON body and reads the JSON answer. */
  const post = <T>(path: string, body: unknown): Promise<T> =>
    json<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  /* ---- one shared event stream, fanned out per event name ---- */
  type Listener<N extends ServerEventName> = (payload: ServerEvents[N]) => void;
  const listeners = new Map<ServerEventName, Set<Listener<ServerEventName>>>();
  const dispatch = (name: ServerEventName, payload: ServerEvents[ServerEventName]): void => {
    for (const fn of listeners.get(name) ?? []) fn(payload);
  };
  const subscribe = <N extends ServerEventName>(name: N, listener: Listener<N>): (() => void) => {
    let set = listeners.get(name);
    if (!set) {
      set = new Set();
      listeners.set(name, set);
      fallback?.addEventListener(name, fromSource);
    }
    set.add(listener as Listener<ServerEventName>);
    connect();
    return () => set.delete(listener as Listener<ServerEventName>);
  };

  // The stream is a WebSocket: browsers open at most six HTTP connections to
  // one host, for all tabs together, and an EventSource held open by every
  // page would use them up once six pages are open. WebSockets do not count
  // against that limit. When no WebSocket ever opens (a proxy that does not
  // pass upgrades), the same events come as server-sent events instead.
  let socket: WebSocket | null = null;
  let opened = false;
  let fallback: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const fromSource = (event: Event): void => {
    dispatch(event.type as ServerEventName, JSON.parse((event as MessageEvent<string>).data) as ServerEvents[ServerEventName]);
  };
  const useEventSource = (): void => {
    const source = new EventSource(url(API.events, { client }));
    fallback = source;
    for (const name of listeners.keys()) source.addEventListener(name, fromSource);
    // An EventSource retries by itself, but gives up (CLOSED) on a refusal.
    source.onerror = () => {
      void checkAccess().then((ended) => {
        if (ended || source.readyState !== EventSource.CLOSED || fallback !== source) return;
        fallback = null;
        retry = setTimeout(() => {
          retry = null;
          connect();
        }, 2000);
      });
    };
  };
  /*
   * A guest who lost access has their stream cut, and every reconnect is
   * refused (a WebSocket never says it was a 403). So when the stream drops,
   * ask the session first: refused, or answered for someone else, ends the
   * page's connection instead of retrying forever.
   */
  let accessEnded = false;
  let checking = false;
  const endAccess = (change: AccessChange): void => {
    if (accessEnded) return;
    accessEnded = true;
    if (retry) clearTimeout(retry);
    retry = null;
    fallback?.close();
    fallback = null;
    socket?.close();
    socket = null;
    if (options.onAccessChange) options.onAccessChange(change);
    else location.reload();
  };
  /** Resolves true when access ended (the stream must not reconnect). */
  const checkAccess = async (): Promise<boolean> => {
    if (accessEnded) return true;
    if (!session || checking) return false;
    checking = true;
    try {
      const was = (await session.request.catch(() => null))?.viewer;
      if (!was) return false;
      let response: Response;
      try {
        response = await fetch(url(API.session), { cache: 'no-store' });
      } catch {
        return false; // the server is down: keep reconnecting
      }
      const now = response.ok ? ((await response.json().catch(() => null)) as Partial<SessionResponse> | null)?.viewer : null;
      const change = accessChangeOf(was, response.status, now);
      if (change) endAccess(change);
      return change !== null;
    } finally {
      checking = false;
    }
  };

  function connect(): void {
    if (socket || fallback || retry || accessEnded) return;
    if (typeof WebSocket === 'undefined') return useEventSource();
    const target = new URL(url(API.events, { client }));
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(target);
    socket = ws;
    ws.onopen = () => {
      opened = true;
    };
    ws.onmessage = (event) => {
      let message: { event?: ServerEventName; data?: unknown };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (message.event) dispatch(message.event, message.data as ServerEvents[ServerEventName]);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (accessEnded) return;
      if (!opened) return useEventSource();
      // Reconnect as an EventSource would, unless access ended.
      void checkAccess().then((ended) => {
        if (ended || socket || fallback || retry) return;
        retry = setTimeout(() => {
          retry = null;
          connect();
        }, 2000);
      });
    };
  }

  let session: { request: Promise<SessionResponse>; controller: AbortController } | undefined;
  const getSession = (signal?: AbortSignal): Promise<SessionResponse> => {
    signal?.throwIfAborted();
    if (!session) {
      const controller = new AbortController();
      const request = json<SessionResponse>(API.session, { signal: controller.signal }).catch((error: unknown) => {
        if (session?.controller === controller && canRetryCapability(error)) session = undefined;
        throw error;
      });
      session = { request, controller };
    }
    const current = session;
    if (!signal) return current.request;
    const expire = () => {
      if (session === current) session = undefined;
      current.controller.abort();
    };
    signal.addEventListener('abort', expire, { once: true });
    return current.request.finally(() => signal.removeEventListener('abort', expire));
  };

  const builders: { [K in CapabilityName]: (signal?: AbortSignal) => Promise<CapabilityMap[K] | null> } = {
    async artifact(signal) {
      const { artifact, stores } = await getSession(signal);
      const capability: ArtifactCapability = {
        id: artifact.id,
        ...(stores?.systemCopy ? {
          systemCopy: (namespace: string, action: 'sync' | 'status') =>
            json<import('./capabilities.ts').SystemCopyStatus>(API.systemCopy, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ namespace, action }) }),
        } : {}),
        title: async () => (await json<SessionResponse>(API.session)).artifact.title,
        list: async () => (await json<FilesResponse>(API.files)).files,
        readText: async (path) => new TextDecoder().decode(await readBytes(path)),
        readBytes: (path) => readBytes(path),
        publish: async (files) => {
          const body: PublishRequest = { files, client };
          return json<PublishResponse>(API.publish, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        },
        onChange: (listener: (event: FilesChangedEvent) => void) => subscribe('files', listener),
      };
      return capability;
    },

    async assets(signal) {
      const { viewer } = await getSession(signal);
      if (!canEdit(viewer.role)) return null;
      const capability: AssetsCapability = {
        upload: async (data, opts) =>
          json<AssetRecord>(
            API.assets,
            { method: 'POST', headers: { 'content-type': data.type || 'application/octet-stream' }, body: data },
            opts?.name ? { name: opts.name } : undefined,
          ),
      };
      return capability;
    },

    async user(signal) {
      const { viewer } = await getSession(signal);
      const capability: UserCapability = { me: async () => viewer };
      return capability;
    },

    async agent() {
      const capability: AgentCapability = {
        send: async (request, opts) => {
          const body: AgentSendRequest = { request, deliver: opts?.deliver ?? 'send' };
          return json<AgentSendResponse>(API.agentSend, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        },
        status: async () => (await json<SessionResponse>(API.session)).agent,
        onStatus: (listener: (status: AgentStatus) => void) => subscribe('agent', listener),
      };
      return capability;
    },

    async room() {
      const capability: RoomCapability = {
        self: async () => client,
        presence: async (patch) => {
          const body: PresenceRequest = { client, patch };
          await json<{ ok: true }>(API.presence, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        },
        peers: async () => (await json<PeersResponse>(API.peers)).peers,
        onPeers: (listener: (peers: Peer[]) => void) => subscribe('peers', listener),
        emit: async (topic, data) => {
          const body: RoomEmitRequest = { client, topic, data };
          await post<{ ok: true }>(API.roomEmit, body);
        },
        onMessage: (listener: (message: RoomMessage) => void) => subscribe('room', listener),
      };
      return capability;
    },

    async db(signal) {
      const { stores } = await getSession(signal);
      if (!stores?.db) return null;
      let streamEpoch: string | undefined;
      const retiredEpochs = new Set<string>();
      const acceptEpoch = ({ epoch, seq }: DbWatermark): boolean => {
        if (typeof epoch !== 'string' || typeof seq !== 'number' || epoch === streamEpoch) return true;
        if (retiredEpochs.has(epoch)) return false;
        if (streamEpoch !== undefined) retiredEpochs.add(streamEpoch);
        streamEpoch = epoch;
        return true;
      };
      const attach = (value: unknown, { epoch, seq }: DbWatermark, deletedSeq?: number): void => {
        if (typeof epoch === 'string' && typeof seq === 'number') {
          setDbDocMeta(value, { epoch, seq, ...(typeof deletedSeq === 'number' ? { deletedSeq } : {}) });
        }
      };
      const callbacks = new Set<(event: DbChangeEvent) => void>();
      let unsubscribe: (() => void) | undefined;
      const receive = (raw: ServerEvents['db']): void => {
        if (!acceptEpoch(raw)) return;
        const { changes } = raw;
        if (typeof raw.epoch === 'string' && typeof raw.seq === 'number') {
          let deleted: Record<string, DbDocMeta> | undefined;
          for (const [path, data] of Object.entries(changes)) {
            if (data === null) (deleted ??= {})[path] = { epoch: raw.epoch, seq: raw.seq };
            else attach(data, raw, raw.deletedSeqs?.[path]);
          }
          if (deleted) setDbChangeDeletes(changes, deleted);
        }
        const event = { changes, ...(raw.author !== undefined ? { author: raw.author } : {}) };
        for (const callback of callbacks) callback(event);
      };
      const capability: DbCapability = {
        get: async (path) => {
          const res = await json<DbGetResponse>(API.dbGet, { cache: 'no-store' }, { path });
          acceptEpoch(res);
          attach(res.data, res, res.deletedSeq);
          return res.data;
        },
        list: async (collection) => {
          const res = await json<DbListResponse>(API.dbList, { cache: 'no-store' }, { collection });
          acceptEpoch(res);
          attach(res.documents, res);
          for (const doc of res.documents) attach(doc.data, res, res.deletedSeqs?.[doc.path]);
          return res.documents;
        },
        write: async (writes) => {
          const body: DbWriteRequest = { writes, client };
          const guards = writes.map(write => {
            const base = typeof write.ifMatch === 'string' ? getDbWriteBaseMeta(write) : undefined;
            return base ? { epoch: base.epoch, seq: base.seq } : null;
          });
          if (guards.some(Boolean)) body.guards = guards;
          const res = await post<DbWriteResponse>(API.dbWrite, body);
          acceptEpoch(res);
          for (const write of writes) attach(write, res, res.deletedSeqs?.[write.path]);
        },
        onChange: listener => {
          callbacks.add(listener);
          unsubscribe ??= subscribe('db', receive);
          return () => {
            callbacks.delete(listener);
            if (callbacks.size === 0) {
              unsubscribe?.();
              unsubscribe = undefined;
            }
          };
        },
      };
      return capability;
    },

    async comments(signal) {
      const { stores } = await getSession(signal);
      if (!stores?.comments) return null;
      const thread = async (path: string, body: unknown): Promise<CommentThread> => (await post<CommentThreadResponse>(path, body)).thread;
      const capability: CommentsCapability = {
        list: async () => (await json<CommentsResponse>(API.comments, { cache: 'no-store' })).threads,
        create: (input) => thread(API.commentsCreate, { input } satisfies CommentCreateRequest),
        reply: (threadId, text, options) => thread(API.commentsReply, { threadId, text, ...(options?.to?.length ? { to: options.to } : {}) } satisfies CommentReplyRequest),
        edit: (threadId, messageId, text, options) =>
          thread(API.commentsEdit, { threadId, messageId, text, ...(options?.to ? { to: options.to } : {}) } satisfies CommentEditRequest),
        react: (threadId, messageId, emoji, on) => thread(API.commentsReact, { threadId, messageId, emoji, on } satisfies CommentReactRequest),
        setResolved: (threadId, resolved) => thread(API.commentsResolve, { threadId, resolved } satisfies CommentResolveRequest),
        move: (threadId, anchor, location) => thread(API.commentsMove, { threadId, anchor, ...(location ? { location } : {}) } satisfies CommentMoveRequest),
        remove: async (threadId, messageId) => {
          await post<CommentsResponse>(API.commentsRemove, { threadId, ...(messageId ? { messageId } : {}) } satisfies CommentRemoveRequest);
        },
        sendToAgent: (threadId, options) => thread(API.commentsSend, { threadId, ...(options?.unasked ? { unasked: true } : {}) } satisfies CommentSendRequest),
        onChange: (listener: (threads: CommentThread[]) => void) => subscribe('comments', listener),
      };
      return capability;
    },

    async doc(signal) {
      const { stores } = await getSession(signal);
      if (!stores?.doc) return null;
      const capability: DocCapability = {
        session: () => post(DOC_API.session, { client } satisfies DocSessionRequest),
        read: (tab) => post(DOC_API.read, { tab } satisfies DocReadRequest),
        call: (request) => post(DOC_API.call, { ...request, client }),
        history: (tab) => post(DOC_API.history, { tab } satisfies DocHistoryRequest),
        version: (tab, rev) => post(DOC_API.version, { tab, rev } satisfies DocVersionRequest),
        restore: (request) => post(DOC_API.restore, request),
        importFile: (name, bytes, tabName) =>
          json<DocImportResponse>(
            DOC_API.importFile,
            { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes as BodyInit },
            { name, ...(tabName ? { tabName } : {}) },
          ),
        exportFile: async (query) => {
          let response: Response;
          try {
            response = await fetch(url(DOC_API.exportFile, { format: query.format, ...(query.tab ? { tab: query.tab } : {}), ...(query.paper ? { paper: query.paper } : {}) }), { cache: 'no-store' });
          } catch (error) {
            throw new ArtifactError('unavailable', error instanceof Error ? error.message : String(error));
          }
          if (!response.ok) throw await toError(response);
          const disposition = response.headers.get('content-disposition') ?? '';
          const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '') || `doc.${query.format === 'markdown' ? 'md' : query.format}`;
          let notes: DocExportedNotes = [];
          try {
            notes = JSON.parse(decodeURIComponent(response.headers.get('x-doc-export-notes') ?? '%5B%5D')) as DocExportedNotes;
          } catch {
            /* no notes */
          }
          return { name, mime: response.headers.get('content-type') ?? 'application/octet-stream', bytes: new Uint8Array(await response.arrayBuffer()), notes };
        },
        onFrame: (listener) => subscribe('doc', listener),
      };
      return capability;
    },

    async history(signal) {
      const { stores } = await getSession(signal);
      if (!stores?.history) return null;
      const at = (n: number, path?: string): Record<string, string> => ({ n: String(n), ...(path === undefined ? {} : { path }) });
      const capability: HistoryCapability = {
        list: () => json<HistoryResponse>(API.history, { cache: 'no-store' }),
        files: async (n) => (await json<HistoryFilesResponse>(API.historyFiles, { cache: 'no-store' }, at(n))).files,
        read: async (n, path) => new TextDecoder().decode(await fetchBytes(API.historyFile, at(n, path))),
        readBytes: (n, path) => fetchBytes(API.historyFile, at(n, path)),
        diff: (n, path) => json<HistoryDiffResponse>(API.historyDiff, { cache: 'no-store' }, at(n, path)),
        restore: (n, paths) => post<HistoryRestoreResponse>(API.historyRestore, { n, ...(paths ? { paths } : {}), client } satisfies HistoryRestoreRequest),
        dismissNotice: async (id) => {
          await post<{ ok: true }>(API.historyDismiss, { id } satisfies HistoryDismissRequest);
        },
        onChange: (listener: (event: HistoryChangeEvent) => void) => subscribe('history', listener),
      };
      return capability;
    },

    async mcp(signal) {
      const { viewer } = await getSession(signal);
      if (viewer.role !== 'owner') return null;
      const capability: McpCapability = {
        callTool: async (server, tool, args, opts) => {
          const signal = opts?.signal;
          signal?.throwIfAborted();
          const body: McpCallRequest = { server, tool, args, ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }) };
          try {
            return await json<McpCallResponse>(API.mcpCall, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
              ...(signal ? { signal } : {}),
            });
          } catch (error) {
            // Closing the request cancels the call on the server too.
            if (signal?.aborted) throw signal.reason;
            throw error;
          }
        },
        listTools: (server) => json<McpToolsResponse>(API.mcpTools, { cache: 'no-store' }, server === undefined ? undefined : { server }),
      };
      return capability;
    },

    async sheet(signal) {
      const { stores } = await getSession(signal);
      if (!stores?.sheet) return null;
      // Sends go one at a time, each once the one before it is answered: the server takes them, and the page hears
      // their answers, in the order the page made them, though each request is a fetch of its own.
      let sending: Promise<unknown> = Promise.resolve();
      const capability: SheetCapability = {
        read: (request) => post(SHEET_API.read, request),
        send: (request) => {
          const answer = sending.then(() => post<SheetSendResponse>(SHEET_API.send, request));
          sending = answer.catch(() => undefined);
          return answer;
        },
        widget: (request) => post<WidgetResponse>(SHEET_API.widget, request),
        importFile: (file, name) =>
          json<ImportFileResponse>(
            SHEET_API.importFile,
            { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file },
            { name },
          ),
        onFrame: (listener: (frame: SheetFrame) => void) => subscribe(SHEET_EVENT, listener),
        onWalkthrough: (listener: (walkthrough: SheetWalkthrough) => void) => subscribe(SHEET_WALKTHROUGH_EVENT, listener),
      };
      return capability;
    },

    async downloads() {
      const capability: DownloadsCapability = {
        save: async ({ name, data }) =>
          json<{ savedTo?: string }>(
            API.downloads,
            { method: 'POST', headers: { 'content-type': data.type || 'application/octet-stream' }, body: data },
            { name },
          ),
      };
      return capability;
    },
  };

  function readBytes(path: string): Promise<Uint8Array> {
    return fetchBytes(API.file, { path });
  }

  async function fetchBytes(route: string, query: Record<string, string>): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetch(url(route, query), { cache: 'no-store' });
    } catch (error) {
      throw new ArtifactError('unavailable', error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw await toError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  return {
    get(name, signal) {
      const build = builders[name] as ((signal?: AbortSignal) => Promise<CapabilityMap[typeof name] | null>) | undefined;
      return build ? build(signal) : null;
    },
  };
}
