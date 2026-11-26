/**
 * The daemon's records and the Library API (`/api/open-artifact.*`): what the Shell,
 * the home page and host pages (such as the DSH plugin's Artifacts page)
 * list and change.
 *
 * Reads are `GET`; writes are `POST` with a JSON body, from the daemon's own
 * origin or with `Authorization: Bearer <daemon token>`.
 */

import { OpenArtifactError } from './errors.ts';
import type { ResolvedEntry, TypeRuntime, TypeScope } from './manifest.ts';
import type { LinkSiteType, SiteTypeDetail } from './link.ts';
import type { TypeSourceKind } from './type-package.ts';
import type { SessionRef } from './refs.ts';
import type { ArtifactRole, ShareCloudView } from './type-server.ts';
import type { WorkspaceDirectoryIdentity } from './workspace-files.ts';

/** The record the daemon keeps for one artifact (`artifacts/<id>.json`). */
export interface ArtifactRecord {
  id: string;
  /** Absolute path of the artifact folder. */
  root: string;
  /** A local embedding host may pin the workspace that contains this artifact. */
  workspaceDirectory?: WorkspaceDirectoryIdentity;
  /**
   * The project a session made or adopted it for (the project's folder, absolute), when the session had a working
   * folder: what makes it one of "this project's artifacts" wherever its own folder is. Only here, never in
   * `.artifact.json`: an archive of the artifact must not carry a path of this computer. Absent: made before this was
   * kept, or without a session; such an artifact is the project's when its folder is in the session's working folder.
   */
  project?: string | null;
  /** Type id. */
  type: string;
  /** Marketplace the type came from, when known. */
  typeSource: string | null;
  /** Type version the artifact was made with. */
  typeRelease: string | null;
  /**
   * The `uid` of the type it was made with (the manifest's), when that type has one; also in `.artifact.json`. The
   * artifact is then opened and written only by a type of the same id and uid (`type_mismatch` otherwise). Absent:
   * made before types had uids, or with a type without one; nothing is checked.
   */
  typeUid?: string | null;
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
  /** The cloud host this artifact is published to (its working copy syncs there through Link), or none. */
  remote?: ArtifactRemote | null;
  /**
   * Automatic publishing (`settings.cloud.publish: "auto"`): `pending` for an artifact created while it was on and not
   * on its site yet (the daemon publishes it in the background, retrying failures); `off` once the person unpublished
   * it, so it is never published by itself again. Absent for everything else (made before, or published by hand).
   */
  autoPublish?: 'pending' | 'off' | null;
  /**
   * A Data dashboard's live data goes to its host with it: `true` once the person confirmed it (publishing it from the
   * Share panel or the CLI, or "Publish its data" there), `false` once they took it back. Until then the daemon never
   * runs its queries for the host, so an automatic publish carries no rows. Absent for every other type.
   */
  dataPublish?: boolean | null;
  /**
   * A `page` artifact's declared runtime capabilities (`{name: true | config}`), as the agent gave them to `Artifact`
   * publish; also in `.artifact.json`. Absent: none declared (the page has only `artifact` and `permissions`). Absent
   * for every other type.
   */
  capabilities?: Record<string, unknown> | null;
}

/** Where an artifact is published on a cloud host, as {@link ArtifactRecord.remote}. */
export interface ArtifactRemote {
  /** Name of the remote in the daemon's remotes file, e.g. `work`. */
  name: string;
  /** The host's app origin. */
  host: string;
  /** The artifact's address on the host (`<host>/a/<id>`): what tools give as `view_url`. */
  url: string;
  /** Path -> etag (sha256 hex) at the last sync. */
  base: Record<string, string>;
  /** ISO time of the last sync, or `null` before the first. */
  syncedAt: string | null;
  /**
   * A page artifact's declared capabilities as the host and this computer last agreed on them (`link.capabilities`
   * and the `artifact` event carry them: no file push does); absent before the first agreement and for other types.
   */
  capabilities?: Record<string, unknown>;
}

/** Where an artifact is published, as lists show it: {@link ArtifactRemote} without the sync bookkeeping (`base`, `capabilities`). */
export type ArtifactRemoteView = Omit<ArtifactRemote, 'base' | 'capabilities'>;

/**
 * Why a remote or a published artifact's last sync failed, as a stable code beside its English `lastError`: the host
 * could not be reached (`unreachable`), the person must sign in again (`signed_out`), the id is taken there
 * (`conflict`), the artifact is larger than the host takes (`too_large`), the host refused otherwise (`refused`), or
 * anything else (`error`).
 */
export type RemoteErrorCode = 'unreachable' | 'signed_out' | 'conflict' | 'too_large' | 'refused' | 'error';

/** `.artifact.json` in the artifact folder: lets a moved folder be recognized. */
export interface ArtifactMarker {
  type: string;
  id: string;
  release: string | null;
  /** {@link ArtifactRecord.typeUid}. */
  typeUid?: string;
  /**
   * Where the type came from, with {@link typeUid}: `builtin`, `local`, or the address an installed type was installed
   * from. `import` names it when no type of that uid is here (`type_missing`).
   */
  typeSource?: string;
  /** A `page` artifact's declared capabilities ({@link ArtifactRecord.capabilities}): what its frame host grants. */
  capabilities?: Record<string, unknown>;
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
  /**
   * Set by the daemon: no folder is at `root` any more (it was moved, renamed or deleted outside Open Artifact). The
   * record is kept; `artifacts.relocate` points it at the folder's new place, `artifacts.delete` forgets it. Opening it
   * meanwhile shows an empty artifact (`ShellBoot.empty`): a host should offer those two instead. A cloud host leaves it
   * out.
   */
  folderMissing?: boolean;
  /**
   * Set by the daemon: the project the artifact was made for, as its folder (the top of the Git checkout the session
   * worked in, the main working tree's for a worktree), wherever the artifact's own folder is. `null` for one made
   * with no session (the home page), or before projects were kept. A cloud host leaves it out.
   */
  project?: string | null;
  /** The Shell page: `<daemon>/a/<id>`. */
  view_url: string;
  /** The page without the Shell. */
  page_url: string;
  /**
   * The owner session and its live state. `wakeMode: 'draft'`: its harness puts what is sent into the conversation for
   * the person to send there, instead of giving it to the agent. `harnessTitle`: the harness's display name from its
   * profile (shipped, the person's, or reported in `hello`), left out when the profile has none.
   */
  owner: (SessionRef & { live: boolean; status: OwnerStatus; wakeMode?: 'draft'; harnessTitle?: string }) | null;
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
  /** Set by a cloud host: the viewer's role on this artifact (own artifacts are `owner`). The daemon leaves it out. */
  role?: ArtifactRole;
  /**
   * Set by the daemon: where the artifact is published (its web address is `remote.url`), or `null` when it is local
   * only. The sync state is `GET remotes`'s. A cloud host leaves it out.
   */
  remote?: ArtifactRemoteView | null;
  /** Set by a cloud host in the trash list (`artifacts?trashed=1`): when the artifact went to the trash. */
  trashedAt?: string | null;
  /** Set by a cloud host on one artifact (`artifact?id=`): the owner's agent, for the Ask pane. */
  agent?: CloudAgentView;
  /**
   * Set by the daemon: a newer release of the type wrote the artifact (`type_release`) than the one installed here
   * (`type_version`), so it is read-only on this computer until Open Artifact is updated. Either version is `null`
   * when unknown. A cloud host leaves these out.
   */
  read_only?: boolean;
  type_release?: string | null;
  type_version?: string | null;
}

/**
 * What a cloud host says of the artifact owner's agent: whether what is asked from the page reaches it now.
 *
 * - `online`: a computer the owner linked (`open-artifact remote add`) is connected now: it gets a request at once.
 * - `offline`: the owner linked a computer, and it is not connected: a request waits until it is.
 * - `mcp`: no computer connected, but an MCP client of the owner's used the site lately: its agent sees a request
 *   the next time it works on the artifact.
 * - `none`: no agent at all: a request waits until the owner connects one.
 */
export interface CloudAgentView {
  state: 'online' | 'offline' | 'mcp' | 'none';
  /** The agent's name as the owner labelled it (a linked computer's, an MCP client's), else a generic one. */
  name: string;
}

/**
 * `POST /api/open-artifact.artifacts.ask`'s answer from a cloud host: `via: 'link'` (kept in the owner's outbox), and
 * `status` `delivered` when the owner's linked computer is connected (it gets it now), else `inbox` (it waits).
 */
export interface CloudAskAnswer {
  via: 'link';
  status: 'delivered' | 'inbox';
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
  /** Its page and actions are on another computer (a URL entry that is not loopback); `origin` says where. */
  remote?: boolean;
  origin?: string;
  /** The manifest's `uid`, when it has one. */
  uid?: string;
  /** The type's folder. */
  dir?: string;
  /**
   * A project type only: whether its project root is trusted (`trustedProjects`). An untrusted one's static and frame
   * pages are served; a server of its own (`entry.start`) does not start.
   */
  trusted?: boolean;
  /**
   * Where it comes from: one of the built-in types, a folder on this computer (`local`: user, project and extra
   * roots), or a package installed with `types install` (`installed`, with {@link installedFrom}).
   */
  source?: TypeSourceKind;
  /** An installed type: the file or `https://` address it was installed from. */
  installedFrom?: string;
  /** The capability names its page declares (`// artifact.json`), when it declares any. */
  capabilities?: string[];
  /** An installed type: the `https://` origins its page may reach (`openArtifact.network`); empty: none. */
  network?: string[];
  /** An installed type: the fixed note that its title, description and instructions are the publisher's. */
  notice?: string;
}

/** `GET /api/open-artifact.types`. */
export interface TypesResponse {
  roots: Array<{ scope: TypeScope; dir: string }>;
  types: TypeView[];
  /**
   * The project types of other folders this computer knows (where agent sessions worked, the trusted projects, the
   * home workspace), each with whether its project is trusted: the home page lists them so the person can trust one.
   */
  projects?: TypesProject[];
}

/** One project folder's types, as {@link TypesResponse.projects} lists them. */
export interface TypesProject {
  /** The project folder (what `types.trust` takes). */
  dir: string;
  /** Its type root, e.g. `<dir>/.agents/artifact-types`. */
  root: string;
  trusted: boolean;
  types: TypeView[];
}

/**
 * How a type on a connected site stands on this computer ({@link TypesSitesResponse}), checked in this order:
 * - `published-here`: a type of this computer's own folders (not installed) has its `uid`: the person published it
 *   from here;
 * - `installed`: installed here with its `uid` and the same package (`sha256`);
 * - `update`: installed here with its `uid` and another package (another version, or other bytes);
 * - `clash`: another type here has its id with another `uid` (or none): installing it needs another id (`--as`);
 * - `new`: none of those.
 */
export type SiteTypeStanding = 'new' | 'installed' | 'update' | 'published-here' | 'clash';
export const SITE_TYPE_STANDINGS: readonly SiteTypeStanding[] = Object.freeze(['new', 'installed', 'update', 'published-here', 'clash']);

/** One type a connected site lists, and how it stands on this computer. */
export interface TypesSiteType extends LinkSiteType {
  /** Its page on the site (`<site origin>/t/<id>`), made by the daemon from the remote's address: what `types.preview { url }` takes. */
  page: string;
  standing: SiteTypeStanding;
  /**
   * The type of this computer it was matched with: the one of its `uid` (`installed`, `update`, `published-here`), or
   * the one holding its id (`clash`); null for `new`. `sha256` is the installed package's; `installedFrom` where it was
   * installed from (an installed type only).
   */
  local: { id: string; version: string | null; scope: TypeScope; sha256?: string; installedFrom?: string } | null;
}

/** One connected site in {@link TypesSitesResponse}: its types, or why there are none. */
export interface TypesSite {
  /** The remote's name and its host's app origin. */
  remote: string;
  host: string;
  /** The types it lists to this person, delisted ones left out; empty with an error. */
  types: TypesSiteType[];
  /** Why this site's types could not be read, in plain words; null when they were. */
  error: string | null;
  /**
   * {@link error} as a stable code: the site could not be reached in time (`unreachable`, `timeout`), this computer is
   * not signed in to it (`signed_out`), it keeps no published types (`unsupported`: an older site), or it refused or
   * failed (`refused`, `error`). Null with no error.
   */
  code: 'unreachable' | 'timeout' | 'signed_out' | 'unsupported' | 'refused' | 'error' | null;
}

/**
 * `GET /api/open-artifact.types.sites` (the home page's Types tab): for each remote this computer is connected to, the
 * types it lists and how each stands here. Each site answers on its own (asked in parallel, each with a time limit): one
 * that fails is its own entry with an error. Names and descriptions are their publishers' words: shown as text,
 * {@link notice} says so to an agent that reads them.
 */
export interface TypesSitesResponse {
  sites: TypesSite[];
  notice: string;
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
  | { type: 'wake/state'; artifactId: string; via: string; status?: string }
  /** What the person selected on an artifact's page changed (throttled); read it with the Harness API's `view.context`. */
  | { type: 'view/context'; id: string; at: string };

/** `POST /api/open-artifact.artifacts.create`. */
export interface CreateArtifactRequest {
  type: string;
  title?: string;
  /** Folder (absolute). Default: `<homeWorkspace>/<artifactsDir>/<slug>`. */
  folder?: string;
  /** Hand the new artifact to an agent with this prompt. */
  prompt?: string;
  /**
   * Start it blank: once made, its page is opened so its type server writes the type's starting files, and the answer
   * comes back not empty (owned by nobody, as without it). A type with marker files (`detect`) whose server writes none
   * is refused (`unsupported`, nothing kept); one without marker files (Page, most types people make) is never empty,
   * and is made as without it.
   */
  blank?: boolean;
}

/** `POST /api/open-artifact.artifacts.blank`: an empty artifact (made, nothing written) started blank. */
export interface BlankArtifactRequest {
  id: string;
}

/** `POST /api/open-artifact.artifacts.add`: a folder already on this computer added to the library. */
export interface AddArtifactRequest {
  /** The folder (absolute or `~/...`). Its `.artifact.json` says the type, else a type's marker files. */
  folder: string;
}

/** `POST /api/open-artifact.artifacts.relocate`: an artifact's folder was moved; where it is now. */
export interface RelocateArtifactRequest {
  id: string;
  /** The folder (absolute or `~/...`). Its `.artifact.json` must name this artifact's id. */
  folder: string;
}

/**
 * `POST /api/open-artifact.artifacts.assign`: the person hands an artifact no session owns to one of the sessions
 * online now (the Ask pane). The person's call only: from the daemon's own pages or the command line, never from
 * inside an agent's session.
 */
export interface AssignArtifactRequest {
  id: string;
  /** The session's key, as `GET harnesses` lists it in `sessions[].key`; it must be online (`live`). */
  session: string;
}

/** `GET /api/open-artifact.types.servers`: the local type servers that run now. */
export interface TypeServersResponse {
  servers: Array<{ type: string } & TypeServerStatus>;
}

/** `POST /api/open-artifact.types.restart`: stop this type's local server; the next page that needs it starts it again. */
export interface TypeServerRestartRequest {
  id: string;
}

/** {@link TypeServerRestartRequest}'s answer: whether a server was running (or starting) and was stopped. */
export interface TypeServerRestartResult {
  id: string;
  stopped: boolean;
}

/** {@link AssignArtifactRequest}'s answer: the artifact, and how each message that waited for it went. */
export interface AssignArtifactResult {
  artifact: ArtifactView;
  /** One entry per message handed over: `live` (the session has it now), else `inbox` or `wait`. */
  delivered: Array<{ via: string; status?: string }>;
}

/**
 * How the home page offers the built-in types for "New", and whether an empty artifact of one can be started blank.
 * `blank`: the person starts it by hand (created with `blank: true`, it opens in its editor). `agent`: an agent
 * builds it (made as before: Design, Data and Motion open empty, on the prompt that hands it to one; a Page has no
 * marker files and opens as its page). The one list the home page and the Shell both read.
 */
export const BUILTIN_START = {
  blank: ['docs', 'sheets', 'whiteboard', 'slides', 'design-system'],
  agent: ['design', 'data', 'motion', 'page'],
} as const satisfies Record<string, readonly string[]>;

/** The group a built-in type's id is in ({@link BUILTIN_START}), or `null` for any other id. */
export function builtinStartOf(typeId: string): keyof typeof BUILTIN_START | null {
  if ((BUILTIN_START.blank as readonly string[]).includes(typeId)) return 'blank';
  if ((BUILTIN_START.agent as readonly string[]).includes(typeId)) return 'agent';
  return null;
}

/** How a list keys the artifacts of no project ({@link ArtifactView.project} unset), where it filters by project. */
export const NO_PROJECT = '';

/** A project's name: its folder's own name. */
export function projectName(project: string): string {
  return project.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || project;
}

/** A project a list has artifacts of ({@link projectChoices}). */
export interface ProjectChoice {
  /** The project's folder; {@link NO_PROJECT} for the artifacts of none. */
  project: string;
  /** What the menu calls it: the folder's name, with the folder it is in when two projects share a name. */
  label: string;
  count: number;
}

/**
 * The projects the list has artifacts of, by name, then the artifacts of none (last, with an empty label for the page
 * to word). Empty when no artifact has a project: there is nothing to choose between.
 */
export function projectChoices(list: readonly { project?: string | null }[], locale: string): ProjectChoice[] {
  const counts = new Map<string, number>();
  for (const a of list) counts.set(a.project || NO_PROJECT, (counts.get(a.project || NO_PROJECT) ?? 0) + 1);
  const projects = [...counts.keys()].filter((project) => project !== NO_PROJECT);
  if (!projects.length) return [];
  const names = new Map<string, number>();
  for (const project of projects) names.set(projectName(project), (names.get(projectName(project)) ?? 0) + 1);
  const parent = (project: string): string => projectName(project.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, ''));
  const choices = projects
    .map((project) => {
      const name = projectName(project);
      return { project, label: (names.get(name) ?? 0) > 1 ? `${name} (${parent(project)})` : name, count: counts.get(project) ?? 0 };
    })
    .sort((a, b) => a.label.localeCompare(b.label, locale) || a.project.localeCompare(b.project));
  const none = counts.get(NO_PROJECT);
  return none ? [...choices, { project: NO_PROJECT, label: '', count: none }] : choices;
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

/**
 * Longest Ask message, in UTF-8 bytes after trimming: the limit claude.ai's Ask box uses. A UTF-8 byte count is
 * never below the UTF-16 length, so a message within it also fits `MAX_HOST_TEXT` and reaches the host's
 * `comment_summon` whole.
 */
export const MAX_ASK_BYTES = 8000;

const utf8 = new TextEncoder();

/** The UTF-8 size of `text` in bytes, as `MAX_ASK_BYTES` counts it. */
export function utf8Bytes(text: string): number {
  return utf8.encode(text).length;
}

/** The trimmed Ask text, or an `invalid_argument` / `too_large` error before anything is delivered. */
export function askRequestText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new OpenArtifactError('invalid_argument', 'Enter a message to send.');
  if (utf8Bytes(text) > MAX_ASK_BYTES) throw new OpenArtifactError('too_large', `Shorten the message to ${MAX_ASK_BYTES} bytes (UTF-8) or fewer.`);
  return text;
}

/** Library API route names (after `/api/open-artifact.`). */
export const LIBRARY_ROUTES = {
  artifacts: 'artifacts',
  artifact: 'artifact',
  types: 'types',
  harnesses: 'harnesses',
  /**
   * The Open Artifact Desktop app's settings this daemon acts on ({@link DesktopSettings}). `GET` reads them; `POST
   * { openInDesktop }` is the person's (the app's settings dialog): refused from another origin and inside an agent's
   * session, as `cloud.settings` is the person's.
   */
  desktopSettings: 'desktop.settings',
  /**
   * `POST` {@link ConfigSetRequest}: sets or removes one plain setting (`open-artifact config set | unset`), in the
   * person's settings file, a project's own, or the person's entry for a project. The person's to do: refused from
   * another origin and inside an agent's session.
   */
  configSet: 'config.set',
  events: 'events',
  share: 'artifact.share',
  /** `GET`/`HEAD ?id=`: the artifact's folder as a .zip (the type server's `/__open-artifact/archive`). */
  archive: 'artifact.archive',
  thumbnail: 'artifacts.thumbnail',
  restore: 'artifacts.restore',
  open: 'artifacts.open',
  /** `GET ?id=`: the finished {@link ShellBoot} of an artifact (waits for its page to open; never `pending`). */
  boot: 'artifacts.boot',
  preview: 'artifacts.preview',
  create: 'artifacts.create',
  /** `POST { id }` ({@link BlankArtifactRequest}): an empty artifact's type server writes its starting files. */
  blank: 'artifacts.blank',
  /**
   * `POST { folder }` ({@link AddArtifactRequest}): a folder on this computer added to the library, owned by nobody.
   * A folder the library has already answers its artifact as it is.
   */
  add: 'artifacts.add',
  /** `POST { id, folder }` ({@link RelocateArtifactRequest}): the artifact's folder is now there. */
  relocate: 'artifacts.relocate',
  /**
   * `POST { id, session }` ({@link AssignArtifactRequest}): an artifact no session owns goes to that online session,
   * which gets what was sent from it meanwhile. The person's call only.
   */
  assign: 'artifacts.assign',
  update: 'artifacts.update',
  duplicate: 'artifacts.duplicate',
  delete: 'artifacts.delete',
  ask: 'artifacts.ask',
  adopt: 'artifacts.adopt',
  tools: 'tools',
  /**
   * `GET`: where artifact pages are served from (`EmbedOriginsResult`) and the origins connected adapters embed the
   * Shell from (`hosts`, their `caps.open.origins`): {@link EmbedResponse}.
   */
  embed: 'embed',
  /**
   * The Shell of a top-level view (`host.open`'s `view` ticket): `GET ?view=&id=[&key=]` is its event stream (the
   * host's messages; the first event, `view`, carries the key), `POST { view, key, event }` sends the host a message.
   */
  view: 'view',
  /**
   * Making and managing types (`open-artifact types …`). Every one but `types.sites` is a `POST` from this computer: from the CLI (token)
   * or the daemon's own Shell, never from a page or another origin. `types.enable` / `types.disable` / `types.trust`
   * are refused inside an agent's session as well: the person decides them. Names start `types.`, not `type.` (that
   * prefix is the Type API's).
   */
  typesNew: 'types.new',
  typesCheck: 'types.check',
  typesFrom: 'types.from',
  typesEnable: 'types.enable',
  typesDisable: 'types.disable',
  typesTrust: 'types.trust',
  /**
   * Type packages (`type-package.ts`). `types.preview`: a package's bytes (`Content-Type: application/octet-stream`,
   * `?name=`) or `{ url }`, read and checked and kept by sha256: {@link TypePackagePreview}. `types.install`:
   * `{ sha256, as? }`, the bytes the preview kept, never fetched again. `types.uninstall`: `{ id }`. `types.update`:
   * `{ id }` previews the recorded source again; `{ id, sha256 }` installs that preview. Install, uninstall and update
   * are the person's: refused inside an agent's session.
   */
  typesPreview: 'types.preview',
  typesInstall: 'types.install',
  typesUninstall: 'types.uninstall',
  typesUpdate: 'types.update',
  /**
   * A type of this computer published to a site's catalog, and taken off it ({@link TypesPublishRequest},
   * `{ id, remote? }`). The person's: refused inside an agent's session.
   */
  typesPublish: 'types.publish',
  typesUnpublish: 'types.unpublish',
  /**
   * `GET [?remote=<name>]` → {@link TypesSitesResponse}: the types on each site this computer is connected to (or that
   * one), and how each stands here.
   * The one `types.*` read: the home page's Types tab asks it, from this daemon's own origin or with the token (any other
   * origin is refused, as for the other `types.*` routes). An agent's request is answered too, as `types.preview` is,
   * with the third-party notice; it installs nothing.
   */
  typesSites: 'types.sites',
  /**
   * Local type servers. `types.servers` (`GET`): the ones that run now, with their address, pid and restarts
   * ({@link TypeServersResponse}). `types.restart` (`POST { id }`, {@link TypeServerRestartRequest}): stops that type's
   * server, which the next page that needs it starts again; the person's (a host's "restart" button), so from the
   * command line or this daemon's own page only, and refused inside an agent's session.
   */
  typesServers: 'types.servers',
  typesRestart: 'types.restart',
  /**
   * `POST` a zip (`Content-Type: application/zip`, `?folder=` optional): an artifact archive made into a local artifact,
   * opened only by a type of the uid its `.artifact.json` names (`type_missing` otherwise). From the CLI or the home
   * page, never from a page.
   */
  import: 'artifacts.import',
} as const;

/** `GET`/`POST /api/open-artifact.desktop.settings`. */
export interface DesktopSettings {
  /**
   * When an agent opens an artifact and its app cannot show it, the page goes to the Open Artifact Desktop app instead
   * of this computer's browser (the app's adapter when it is connected, else the app started with the artifact's
   * `open-artifact://` link; the browser when neither works). Off by default. Hosts that show pages themselves are
   * not affected.
   */
  openInDesktop: boolean;
}

/** `GET /api/open-artifact.embed`. */
export interface EmbedResponse {
  /** Every origin and pattern pages are served from (`EmbedOriginsResult.origins`). */
  origins: string[];
  entries: Array<{ origin?: string; pattern?: string; kind: 'daemon' | 'frame' | 'server' | 'url'; type?: string; remote: boolean }>;
  /** The origins connected adapters said they embed the Shell from; empty when none said. */
  hosts: string[];
}

/**
 * What the daemon injects into the Shell page (`/a/<id>`) as its boot
 * object. The Shell reads it from `window.__OPEN_ARTIFACT_BOOT__`.
 */
export interface ShellBoot {
  /** The same Shell served by a type server for CLI and LAN visits, without the daemon library. */
  typeServer?: { role: 'owner' | 'editor' | 'commenter' | 'viewer'; invite?: string; sharePath?: string };
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
  /**
   * The page is still being opened (its type server may be starting): `page`, `pageUrl`, `pageKind` and `problem`
   * are not known yet. The Shell draws itself at once and asks {@link LIBRARY_ROUTES.boot} for the finished boot.
   */
  pending?: boolean;
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
  /** Set when a cloud host serves the Shell: who is looking and how to sign in or out. `root` is `''` there. */
  cloud?: ShellCloud;
  /** As {@link ArtifactView.read_only}: the page is opened view-only, and the Shell says how to update. */
  read_only?: boolean;
  type_release?: string | null;
  type_version?: string | null;
  /**
   * The `sandbox` of the Shell's frame, for the page of a restricted static type (installed, or in a project not
   * trusted yet): no popups, no top navigation. Absent: no sandbox.
   */
  sandbox?: string;
}

/** {@link ShellBoot.cloud}: the Shell as a cloud host serves it. */
export interface ShellCloud {
  /** The signed-in person; null for a link guest or an anonymous visitor. */
  user: { id: string; name: string; email?: string; avatar?: string } | null;
  /** The viewer's role on this artifact. */
  role: ArtifactRole;
  /** The host's app origin (Shell, home, sign-in, Library API). */
  appOrigin: string;
  /** Where to sign in, coming back to this artifact. */
  signInUrl: string;
  /** Where to sign out. */
  signOutUrl: string;
  /** The artifact's sharing settings, so the Shell can gate Ask and export before the share view loads. */
  settings?: ShareCloudView['settings'];
  /** The owner's agent, for the Ask pane (later changes come as `artifacts/changed` and the artifact's `agent`). */
  agent?: CloudAgentView;
  /** What the host's plugins add to its pages (links, the site's brand); absent when they add nothing. */
  site?: CloudSiteUi;
}

/**
 * A host's own additions to its pages, from its plugins (`ui`): plain text and checked addresses only (an `https:`
 * or `http:` URL, or a path on the host), never HTML.
 */
export interface CloudSiteUi {
  /** Links in the account menu (`account-menu`) or on the home page (`home`). */
  links?: Array<{ label: string; href: string; where: 'account-menu' | 'home' }>;
  /** The site's name and logo, shown in the top bar, the home page's header and the sign-in page. */
  brand?: { name?: string; logoUrl?: string };
}

/**
 * What a cloud host inlines into the home page (`window.__OPEN_ARTIFACT_HOME__`); the local daemon leaves it `null`.
 * The cloud part is {@link ShellCloud} without an artifact's role or settings.
 */
export interface HomeBoot {
  cloud?: Omit<ShellCloud, 'role' | 'settings' | 'agent'> & {
    /** Days an artifact stays in the trash before the host deletes it for good (`OA_TRASH_DAYS`; 0: until purged). */
    trashDays?: number;
    /** What the host accepts: `importBytes`, the largest archive (zip) an upload may be. */
    limits?: { importBytes: number };
    /** The site keeps published types: the home page has a Types tab (absent: it keeps none). */
    siteTypes?: boolean;
  };
  /**
   * The page is a type's page (`/t/<id>`), not the home page: the type as the asker may see it. Every string in it but
   * the addresses is its publisher's, shown as text.
   */
  typePage?: SiteTypeDetail;
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
  /**
   * How the daemon runs its Node.js type servers: child processes, or worker threads in its own process (a daemon that
   * runs inside an Electron process, such as a utility process). `reason`: `env` (`OPEN_ARTIFACT_NODE_CHILDREN`), `node`
   * (plain Node.js) or `electron` (how Electron runs the daemon). Since 0.14.1: an older daemon leaves it out.
   */
  nodeChildren?: { mode: 'process' | 'threads'; reason: 'env' | 'node' | 'electron'; detail: string };
}
