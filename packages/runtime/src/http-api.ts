/**
 * The HTTP contract between an editor page and its local type server.
 *
 * Every route is relative to the artifact's page base (for example
 * `http://127.0.0.1:4720/design/<token>/`). Both the browser provider
 * ({@link ./local-provider.ts}) and the Node server (`@open-artifact/type-server`)
 * import these names and shapes, so the two sides cannot drift apart.
 */

import type {
  AgentDelivery,
  AgentRequest,
  AgentSendResult,
  AgentStatus,
  ArtifactErrorCode,
  CommentCreate,
  CommentSendOptions,
  CommentThread,
  ConflictPath,
  DbChangeEvent,
  DbDocument,
  DbOrder,
  DbReceipt,
  DbWrite,
  FileListing,
  FilesChangedEvent,
  HistoryChangeEvent,
  HistoryFileDiff,
  HistoryListing,
  HistoryRestoreResult,
  JsonRecord,
  JsonValue,
  McpServerEntry,
  McpToolResult,
  Participant,
  Peer,
  PublishBatch,
  PublishResult,
  RoomMessage,
  SelectionSnapshot,
  Viewer,
} from './capabilities.ts';
import type { SheetFrame, SheetWalkthrough } from './sheet-api.ts';
import type { DocFrame } from './doc-api.ts';

/** Route paths, relative to the page base. */
export const API = {
  session: '_api/session',
  files: '_api/files',
  file: '_api/file',
  publish: '_api/publish',
  assets: '_api/assets',
  events: '_api/events',
  agentSend: '_api/agent/send',
  presence: '_api/presence',
  peers: '_api/peers',
  participants: '_api/participants',
  downloads: '_api/downloads',
  roomEmit: '_api/room/emit',
  dbGet: '_api/db/get',
  dbList: '_api/db/list',
  dbWrite: '_api/db/write',
  comments: '_api/comments',
  commentsCreate: '_api/comments/create',
  commentsReply: '_api/comments/reply',
  commentsEdit: '_api/comments/edit',
  commentsReact: '_api/comments/react',
  commentsResolve: '_api/comments/resolve',
  commentsMove: '_api/comments/move',
  commentsRemove: '_api/comments/remove',
  commentsSend: '_api/comments/send',
  history: '_api/history',
  historyFiles: '_api/history/files',
  historyFile: '_api/history/file',
  historyDiff: '_api/history/diff',
  historyRestore: '_api/history/restore',
  historyDismiss: '_api/history/dismiss',
  systemCopy: '_api/design/system-copy',
  mcpTools: '_api/mcp/tools',
  mcpCall: '_api/mcp/call',
  /**
   * `POST` {@link DataRefreshRequest} → {@link DataRefreshResponse}: a hosted Data dashboard asks its owner's computer to
   * run its live queries again (the host queues it; no connector runs there).
   */
  dataRefresh: '_api/data/refresh',
  /** `GET` → {@link DataSharesResponse}: the connectors whose access the owner shares on this dashboard. */
  dataShares: '_api/data/shares',
  /** `POST` {@link DataShareRequest} → {@link DataShareResponse}: the owner shares (or, with no calls, stops sharing) a connector. */
  dataShare: '_api/data/share',
  /** `POST` {@link DataSharedRequest} → {@link DataSharedResponse}: runs approved calls with the sharer's connector. */
  dataShared: '_api/data/shared',
} as const;

/** One exact call a share approves: its arguments keep their `{{filter}}` blanks. */
export interface SharedConnectorCall {
  connector: string;
  tool: string;
  /** The source is written `kind: "call"` (filters with rules). */
  call?: true;
  args: Record<string, unknown>;
  rules?: Record<string, unknown>;
}

/** Who shares a connector, and since when (ms since the epoch). */
export interface ConnectorShareHolder {
  sharer: { id: string; name: string };
  at: number;
}

/** `GET _api/data/shares`: each shared connector, with the key of every call it approves. */
export interface DataSharesResponse {
  shares: (ConnectorShareHolder & { connector: string; keys: string[] })[];
}

/** `POST _api/data/share`: the calls to approve; none stops sharing. */
export interface DataShareRequest {
  connector: string;
  calls: SharedConnectorCall[];
}

export interface DataShareResponse {
  connector: string;
  /** `null` once sharing stopped. */
  holder: ConnectorShareHolder | null;
  count: number;
}

/** One call a viewer asks to run as the sharer, with the filter values it fills its blanks with. */
export interface SharedCallRequest extends SharedConnectorCall {
  params?: Record<string, unknown>;
}

/** `POST _api/data/shared`. `reuseMs` is how long the page reuses results (never under five minutes here). */
export interface DataSharedRequest {
  calls: SharedCallRequest[];
  reuseMs?: number;
  refresh?: boolean;
}

/** Why a shared call gave no result. */
export type SharedCallCode = 'not_shared' | 'invalid_call' | 'not_approved' | 'value_refused' | 'tool_error' | 'too_large' | 'timeout' | 'connector_unavailable';

export type SharedCallAnswer =
  | (ConnectorShareHolder & { ok: true; result: Record<string, unknown>; ranAt: number })
  | { ok: false; code: SharedCallCode; message?: string; sharer?: { id: string; name: string } };

export interface DataSharedResponse {
  answers: SharedCallAnswer[];
}

/** `POST _api/data/refresh`: the dataset ids to refresh, all live queries when left out. */
export interface DataRefreshRequest {
  queries?: string[];
}

/** `POST _api/data/refresh`'s answer: queued; `online` says whether the owner's computer is linked now to take it. */
export interface DataRefreshResponse {
  queued: true;
  online: boolean;
}

/** Root-relative prefix every upload is served under. */
export const BLOB_PREFIX = '/_blob/';

/** `GET _api/session` */
export interface SessionResponse {
  artifact: { id: string; title: string; type: string };
  viewer: Viewer;
  agent: AgentStatus;
  /** Stores the type keeps beside its files; absent ones are not offered (`db` / `comments` resolve `null`). */
  stores?: { systemCopy?: boolean; db?: boolean; comments?: boolean; history?: boolean; sheet?: boolean; doc?: boolean };
}

/** `GET _api/files` */
export interface FilesResponse {
  files: FileListing;
}

/** Header carrying the SHA-256 of a file returned by `GET _api/file`. */
export const SHA_HEADER = 'x-open-artifact-sha256';

/** `POST _api/publish` request body. */
export interface PublishRequest {
  files: PublishBatch;
  /** The publishing page's client id, so its own change events are not echoed back. */
  client: string;
}

/** `POST _api/publish` 200 body. */
export type PublishResponse = PublishResult;

/** Body of every non-2xx JSON answer. */
export interface ErrorResponse {
  code: ArtifactErrorCode;
  message: string;
  paths?: ConflictPath[];
  /** Asking again later may succeed (connector calls). */
  retryable?: boolean;
}

/** `POST _api/agent/send` request body. */
export interface AgentSendRequest {
  request: AgentRequest;
  deliver: AgentDelivery;
}

/** `POST _api/agent/send` 200 body. */
export type AgentSendResponse = AgentSendResult;

/** `POST _api/presence` request body. */
export interface PresenceRequest {
  client: string;
  patch: Record<string, unknown>;
}

/** `GET _api/peers` */
export interface PeersResponse {
  peers: Peer[];
}

/** `GET _api/participants`: the owner, then the people the artifact is shared with. */
export interface ParticipantsResponse {
  participants: Participant[];
}

/** `POST _api/room/emit` request body. Relayed to every other client as a `room` event. */
export interface RoomEmitRequest {
  client: string;
  topic: string;
  data: JsonValue;
}

/** `GET _api/db/get?path=` 200 body. */
export interface DbGetResponse {
  data: JsonRecord | null;
}

/** `GET _api/db/list?collection=` 200 body: `epoch` and `seq` say where the host stood when it read them (older hosts omit them). */
export interface DbListResponse extends Partial<DbOrder> {
  documents: DbDocument[];
}

/** `POST _api/db/write` request body. */
export interface DbWriteRequest {
  writes: DbWrite[];
  /** The writing page's client id, so the change is not echoed back to it. */
  client: string;
}

/** `POST _api/db/write` 200 body: the {@link DbReceipt} (older hosts omit its fields). */
export interface DbWriteResponse extends Partial<DbReceipt> {
  ok: true;
}

/** `GET _api/comments` 200 body, and the body of `POST _api/comments/remove`. */
export interface CommentsResponse {
  threads: CommentThread[];
}

/** `POST _api/comments/create` request body. */
export interface CommentCreateRequest {
  input: CommentCreate;
}

/** `POST _api/comments/reply` request body. */
export interface CommentReplyRequest {
  threadId: string;
  text: string;
  to?: string[];
  /** The reply assigns the thread to this person (`null`: unassigns it). */
  assignee?: string | null;
}

/** `POST _api/comments/edit` request body. */
export interface CommentEditRequest {
  threadId: string;
  messageId: string;
  text: string;
  to?: string[];
}

/** `POST _api/comments/react` request body. */
export interface CommentReactRequest {
  threadId: string;
  messageId: string;
  emoji: string;
  on: boolean;
}

/** `POST _api/comments/resolve` request body. */
export interface CommentResolveRequest {
  threadId: string;
  resolved: boolean;
}

/** `POST _api/comments/move` request body. */
export interface CommentMoveRequest {
  threadId: string;
  anchor: string;
  location?: JsonRecord;
}

/** `POST _api/comments/remove` request body. */
export interface CommentRemoveRequest {
  threadId: string;
  messageId?: string;
}

/** `POST _api/comments/send` request body. */
export interface CommentSendRequest {
  threadId: string;
  /** A reply that does not ask the agent, sent because it took part in the thread. */
  unasked?: boolean;
  /** See {@link CommentSendOptions.userText}. */
  userText?: string;
  /** See {@link CommentSendOptions.selectionSnapshot}. */
  selectionSnapshot?: SelectionSnapshot;
}

/** 200 body of the comment routes that change one thread. */
export interface CommentThreadResponse {
  thread: CommentThread;
}

/** `GET _api/history` 200 body (versions newest first). */
export type HistoryResponse = HistoryListing;

/** `GET _api/history/files?n=` 200 body. */
export interface HistoryFilesResponse {
  files: FileListing;
}

/**
 * `GET _api/history/file?n=&path=` answers the raw bytes (with
 * {@link SHA_HEADER}); `GET _api/history/diff?n=&path=` a
 * {@link HistoryDiffResponse}.
 */
export type HistoryDiffResponse = HistoryFileDiff;

/** `POST _api/history/restore` request body. */
export interface HistoryRestoreRequest {
  n: number;
  /** Only these paths (default: every path). */
  paths?: string[];
  /** The restoring page's client id (it hears of the restore like every other page). */
  client?: string;
}

/** `POST _api/history/restore` 200 body. */
export type HistoryRestoreResponse = HistoryRestoreResult;

/** `POST _api/history/dismiss` request body. */
export interface HistoryDismissRequest {
  id: string;
}

/** `GET _api/mcp/tools[?server=]` 200 body (the owner only; others get `not_granted`). */
export interface McpToolsResponse {
  servers: McpServerEntry[];
}

/**
 * `POST _api/mcp/call` request body (the owner only). The 200 body is the
 * tool's {@link McpToolResult}; failures are an {@link ErrorResponse} with an
 * `McpErrorCode`. Closing the request cancels the call.
 */
export interface McpCallRequest {
  server: string;
  tool: string;
  args: Record<string, unknown>;
  /** Default `MCP_CALL_TIMEOUT.defaultMs`. */
  timeoutMs?: number;
}

/** `POST _api/mcp/call` 200 body. */
export type McpCallResponse = McpToolResult;

/** Server-sent events on `GET _api/events?client=<id>`, by event name. */
export interface ServerEvents {
  /** Files changed by someone other than the subscribing client. */
  files: FilesChangedEvent;
  /** Agent availability changed. */
  agent: AgentStatus;
  /** The set of present peers changed. */
  peers: Peer[];
  /** Documents changed by someone other than the subscribing client (db-backed types). */
  db: DbChangeEvent;
  /** The full comment thread list, after any change (types with comments). */
  comments: CommentThread[];
  /** An ephemeral message from another client. */
  room: RoomMessage;
  /** A version was recorded (or grew). */
  history: HistoryChangeEvent;
  /** A frame of the workbook's edit log (types with `store: "workbook"`). */
  sheet: SheetFrame;
  /** A walkthrough the agent sent, to one page of the owner's (`SHEET_WALKTHROUGH_EVENT`; types with `store: "workbook"`). */
  sheetWalkthrough: SheetWalkthrough;
  /** A write to a doc, its tabs or its dropdown lists (types with `store: "doc"`). */
  doc: DocFrame;
}

export type ServerEventName = keyof ServerEvents;
