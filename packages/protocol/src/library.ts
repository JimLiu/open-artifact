/**
 * The daemon's records and the Library API (`/api/open-artifact.*`): what the Shell,
 * the home page and host pages (such as the DSH plugin's Artifacts page)
 * list and change.
 *
 * Reads are `GET`; writes are `POST` with a JSON body, from the daemon's own
 * origin or with `Authorization: Bearer <daemon token>`.
 */

import type { ResolvedEntry, TypeRuntime, TypeScope } from './manifest.ts';
import type { SessionRef } from './refs.ts';

/** The record the daemon keeps for one artifact (`artifacts/<id>.json`). */
export interface ArtifactRecord {
  id: string;
  /** Absolute path of the artifact folder. */
  root: string;
  /** Type id. */
  type: string;
  /** Marketplace the type came from, when known. */
  typeSource: string | null;
  /** Type version the artifact was made with. */
  typeRelease: string | null;
  /** The session that owns it: comments wake this session. */
  owner: SessionRef | null;
  createdBy: Pick<SessionRef, 'harness' | 'session'> | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinnedAt: string | null;
  openedAt?: string | null;
  /** Last time the agent read or wrote, to tell its edits from the person's. */
  agentSeenAt: string | null;
  lastUserEditAt: string | null;
  /**
   * Files people changed from the page, with when (paths as the type server
   * reported them, the newest 200). Artifact read lists those changed since
   * {@link agentSeenAt} as `changed_files`.
   */
  userEdits?: Record<string, string>;
}

/** `.artifact.json` in the artifact folder: lets a moved folder be recognized. */
export interface ArtifactMarker {
  type: string;
  id: string;
  release: string | null;
}

/** Live state of the owner session. */
export type OwnerStatus = 'idle' | 'running' | 'offline';

/** One artifact as lists show it (`GET /api/open-artifact.artifacts`). */
export interface ArtifactView {
  id: string;
  url: string;
  title: string;
  type: string;
  typeTitle: string;
  /** The type is not installed any more. */
  typeMissing: boolean;
  root: string;
  /** The Shell page: `<daemon>/a/<id>`. */
  view_url: string;
  /** The page without the Shell. */
  page_url: string;
  owner: (SessionRef & { live: boolean; status: OwnerStatus }) | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  /** Last change of the content files. */
  contentAt: string | null;
  /** Thumbnail URL, when one was captured. */
  thumbnail: string | null;
  /** Shared on the LAN. */
  shared: boolean;
  /** A type server has the page open. */
  open: boolean;
}

/** `GET /api/open-artifact.artifact?id=`: one artifact with its folder size. */
export interface ArtifactDetail extends ArtifactView {
  bytes: number;
}

/** State of a type's local server. */
export interface TypeServerStatus {
  state: 'stopped' | 'starting' | 'running' | 'failed';
  url?: string;
  pid?: number;
  error?: string;
  restarts?: number;
}

/** One type as the Types list shows it (`GET /api/open-artifact.types`). */
export interface TypeView {
  id: string;
  title: string;
  description: string;
  scope: TypeScope;
  /** The type root it was found in. */
  root: string;
  runtime: TypeRuntime;
  entry: ResolvedEntry['kind'] | null;
  server: TypeServerStatus | null;
  runnable: boolean;
  enabled: boolean;
  /** Id of the root whose type of the same id wins over this one. */
  shadowedBy: string | null;
  version: string | null;
  problems: string[];
  /** The type has an icon (`GET /api/open-artifact.type.icon?id=`). */
  icon: boolean;
}

/** `GET /api/open-artifact.types`. */
export interface TypesResponse {
  roots: Array<{ scope: TypeScope; dir: string }>;
  types: TypeView[];
}

/** One connected adapter (`GET /api/open-artifact.harnesses`). */
export interface HarnessInfo {
  name: string;
  title: string;
  agentName: string;
  connected: boolean;
  sessions: Array<SessionRef & { key: string; status: OwnerStatus; title?: string }>;
}

/** Events on `GET /api/open-artifact.events` (server-sent events, `data:` is JSON). */
export type LibraryEvent =
  | { type: 'artifacts/changed'; id: string; author?: string; paths?: string[]; removed?: boolean }
  | { type: 'types/changed' }
  | { type: 'harness/changed' }
  | { type: 'wake/state'; artifactId: string; via: string; status?: string };

/** `POST /api/open-artifact.artifacts.create`. */
export interface CreateArtifactRequest {
  type: string;
  title?: string;
  /** Folder (absolute). Default: `<homeWorkspace>/<artifactsDir>/<slug>`. */
  folder?: string;
  /** Hand the new artifact to an agent with this prompt. */
  prompt?: string;
}

/** `POST /api/open-artifact.artifacts.update`. */
export interface UpdateArtifactRequest {
  id: string;
  title?: string;
  pinned?: boolean;
}

/** `POST /api/open-artifact.artifacts.ask`: the person asks the owner agent from the Shell. */
export interface AskRequest {
  id: string;
  text: string;
  label?: string;
}

/** Library API route names (after `/api/open-artifact.`). */
export const LIBRARY_ROUTES = {
  /** GET hosting preferences/status; POST validated preferences (local owner/process only). */
  hosting: 'hosting',
  artifacts: 'artifacts',
  artifact: 'artifact',
  types: 'types',
  harnesses: 'harnesses',
  events: 'events',
  share: 'artifact.share',
  /** `GET`/`HEAD ?id=`: the artifact's folder as a .zip (the type server's `/__open-artifact/archive`). */
  archive: 'artifact.archive',
  thumbnail: 'artifacts.thumbnail',
  restore: 'artifacts.restore',
  open: 'artifacts.open',
  preview: 'artifacts.preview',
  create: 'artifacts.create',
  update: 'artifacts.update',
  duplicate: 'artifacts.duplicate',
  delete: 'artifacts.delete',
  ask: 'artifacts.ask',
  adopt: 'artifacts.adopt',
  tools: 'tools',
} as const;

/**
 * What the daemon injects into the Shell page (`/a/<id>`) as its boot
 * object. The Shell reads it from `window.__OPEN_ARTIFACT_BOOT__`.
 */
export interface ShellBoot {
  /** The same Shell served by a type server for CLI and LAN visits, without the daemon library. */
  typeServer?: { role: 'owner' | 'editor' | 'commenter' | 'viewer'; invite?: string; sharePath?: string };
  /** Copyable owner Shell address; hosted daemons include the owner capability. Never sent to guests. */
  viewUrl?: string;
  id: string;
  url: string;
  title: string;
  type: string;
  typeTitle: string;
  root: string;
  /** The artifact page's address (absolute), once opened. */
  page: string | null;
  /** The page without the Shell. */
  pageUrl: string | null;
  pageKind: ResolvedEntry['kind'] | null;
  /** Why the page could not be opened. */
  problem: string | null;
  /** Made but nothing written yet (none of the type's `detect` files exist). */
  empty: boolean;
  /** For an empty artifact: the prompt that hands it to an agent. */
  prompt: string | null;
  owner: { harness: string; key: string | null } | null;
  /** What the Shell calls the agent, e.g. `Agent`. */
  agentName: string;
  /** This computer's account name, shown as the owner in the Share panel. */
  userName: string;
  /** Daemon version. */
  version: string;
}

/** `~/.agents/open-artifact/daemon.json`: how clients find the running daemon. */
export interface DaemonState {
  /** Base URL, e.g. `http://127.0.0.1:4800`. */
  url: string;
  port: number;
  pid: number;
  /** Bearer token of the Library and Harness APIs. */
  token: string;
  version: string;
  startedAt: string;
}

/** `GET /__open-artifact/health` on the daemon. */
export interface DaemonHealth {
  openArtifact: 1;
  version: string;
}
