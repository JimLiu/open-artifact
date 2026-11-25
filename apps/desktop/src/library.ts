import type { ArtifactView, DesktopSettings, HarnessesResponse, TypeServerRestartResult, TypeServersResponse, TypeView } from '@open-artifact/protocol';
import { objectOf } from './errors.ts';
export interface RemoteRecord {
  name: string;
  host: string;
  user?: { name?: string; email?: string; id?: string } | null;
  signedIn?: boolean;
  reachable?: boolean;
  connected?: boolean;
  default?: boolean;
  preset?: boolean;
  insecure?: boolean;
  lastError?: string | null;
  artifacts?: {
    id: string;
    url: string;
    title: string;
    view_url: string;
    syncedAt: string | null;
    lastSyncAt: string | null;
    pending: string[];
    lastError: string | null;
    code: string | null;
  }[];
}
export interface RemotesResponse {
  remotes: RemoteRecord[];
  cloud?: { default?: string | null; publish?: string };
  presetProblem?: string | null;
}
export interface LibraryResponses {
  artifacts: { artifacts: ArtifactView[] };
  types: { types: TypeView[] };
  artifact: ArtifactView;
  'artifacts.update': ArtifactView;
  'artifacts.restore': ArtifactView;
  'artifacts.delete': { deleted?: string; folderKept?: string };
  'artifacts.create': ArtifactView;
  'artifacts.add': ArtifactView;
  'artifacts.import': ArtifactView;
  'artifacts.relocate': ArtifactView;
  'artifacts.preview': { page_url?: string };
  'artifacts.thumbnail': { thumbnail?: string };
  harnesses: HarnessesResponse;
  'types.servers': TypeServersResponse;
  'types.restart': TypeServerRestartResult;
  remotes: RemotesResponse;
  'desktop.settings': DesktopSettings;
  'remotes.add': { host?: string; user_code?: string; verification_uri_complete?: string; verification_uri?: string };
  'remotes.add.wait': { status: 'done'; user: { id: string; name: string; email?: string } } | { status: 'pending' };
  'remotes.add.cancel': { name: string; cancelled: boolean };
  'cloud.settings': {
    cloud: {
      default: string | null;
      publish: 'auto' | 'manual';
      pending: {
        id: string;
        url: string;
        title: string;
        remote: string | null;
        attempts: number;
        lastError: string | null;
        code: string | null;
        nextAt: string | null;
      }[];
    };
  };
  'remotes.remove': { removed?: string; unlinked?: string[] };
}
export interface SendOptions {
  query?: Record<string, string | number | null | undefined>;
  body?: unknown;
  method?: string;
  contentType?: string;
  signal?: AbortSignal;
}
export type LibraryClient = ReturnType<typeof libraryClient>;
/**
 * The home page's calls, answered here: the daemon's Library API with its token, which never leaves this process.
 *
 * The answers are made into the page's shapes with `@open-artifact/library-page/library` (the same functions the DSH
 * plugin's routes use). What would let the window's page reach the daemon by itself is kept here: the token, the
 * thumbnail's daemon address (the page gets an `oa-thumbnail:` address this process answers, `thumbnails.ts`), and a
 * type's preview page (the page gets an opaque name; the picture is taken here). The Shell's own address (`viewUrl`,
 * the link "Copy link" copies) carries nothing secret and is passed on as it is.
 */
import { artifactList, deleteAnswer, pageView } from '@open-artifact/library-page/library';
import { LIBRARY_ROUTES, builtinStartOf } from '@open-artifact/protocol';
import { artifactIdOf } from './navigation.ts';

/** The harness this app is to the daemon: an artifact a session of it owns would be its own (it attaches none). */
export const HARNESS = 'open-artifact-desktop';
/** The longest title the page may set. */
const TITLE_MAX = 300;
/** A trash entry's name: what `artifacts.delete` answers (`deleted`), the id or a folder name. */
const TRASH_NAME = /^[A-Za-z0-9._-]{1,200}$/;

export class LibraryError extends Error {
  status: number;
  code: string;
  constructor(message: string, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** An id the page sent: an artifact id, or a throw. */
export function idArg(value: unknown) {
  const id = typeof value === 'string' ? artifactIdOf(value) : null;
  if (!id || id !== value) throw new LibraryError('not an artifact id');
  return id;
}

/** The fields a page's `update` may change (title, pinned), checked; a throw for anything else. */
export function patchArg(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LibraryError('not a change');
  const out: { title?: string; pinned?: boolean } = {};
  for (const [key, field] of Object.entries(objectOf(value))) {
    if (key === 'title' && typeof field === 'string' && field.trim() && field.length <= TITLE_MAX) out.title = field.trim();
    else if (key === 'pinned' && typeof field === 'boolean') out.pinned = field;
    else throw new LibraryError(`cannot change ${key}`);
  }
  if (!Object.keys(out).length) throw new LibraryError('nothing to change');
  return out;
}

/** What `create` takes from the page: a type id and an optional title. */
export function createArg(value: unknown) {
  if (!value || typeof value !== 'object') throw new LibraryError('not a request');
  const raw = value as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(type)) throw new LibraryError('not a type');
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : '';
  return { type, title };
}

/** How a type starts from the app: blank (its editor's starting files, then the editor) or empty (for an agent). */
export const startsBlank = (type: string) => builtinStartOf(type) === 'blank';

/**
 * The Library API of the kit's daemon. `state()`: the kit's connection state (`{ url, token }`, or null).
 * Every call throws on an answer that is not 2xx, with the daemon's own words.
 */
export function libraryClient({ state, fetchImpl = fetch }: { state: () => { url: string; token: string } | null; fetchImpl?: typeof fetch }) {
  const send = async (name: string, { query, body, method, contentType, signal }: SendOptions = {}) => {
    const s = state();
    if (!s?.url || !s?.token) throw new LibraryError('not connected to Open Artifact');
    const url = new URL(`/api/open-artifact.${name}`, s.url);
    for (const [key, value] of Object.entries(query ?? {})) if (value != null && value !== '') url.searchParams.set(key, String(value));
    const headers: Record<string, string> = { Authorization: `Bearer ${s.token}` };
    if (body !== undefined) headers['Content-Type'] = contentType ?? 'application/json';
    return fetchImpl(url, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body !== undefined ? { body: contentType ? (body as BodyInit) : JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  };
  const call = async <K extends keyof LibraryResponses>(name: K, options?: SendOptions): Promise<LibraryResponses[K]> => {
    const response = await send(name, options);
    const raw: unknown = await response.json().catch(() => ({}));
    const out = objectOf(raw);
    if (!response.ok)
      throw new LibraryError(typeof out?.message === 'string' && out.message ? out.message : `HTTP ${response.status}`, {
        status: response.status,
        code: typeof out.code === 'string' ? out.code : '',
      });
    return raw as LibraryResponses[K];
  };

  return {
    send,
    call,
    async list() {
      const [list, types] = await Promise.all([call(LIBRARY_ROUTES.artifacts), call(LIBRARY_ROUTES.types)]);
      return artifactList(list, types, HARNESS);
    },
    async artifact(id: string) {
      return pageView(await call(LIBRARY_ROUTES.artifact, { query: { id } }), HARNESS);
    },
    async update(id: string, patch: { title?: string; pinned?: boolean }) {
      return pageView(await call(LIBRARY_ROUTES.update, { body: { id, ...patch } }), HARNESS);
    },
    async remove(id: string) {
      return deleteAnswer(await call(LIBRARY_ROUTES.delete, { body: { id } }), id);
    },
    async restore(trash: string) {
      if (typeof trash !== 'string' || !TRASH_NAME.test(trash)) throw new LibraryError('not a trash entry');
      return pageView(await call(LIBRARY_ROUTES.restore, { body: { id: trash } }), HARNESS);
    },
    /**
     * A new artifact of `type`: started blank when the type is one that goes straight to its editor; in `folder`
     * (absolute) when given, else where the daemon puts new artifacts.
     */
    async create({ type, title, folder }: { type: string; title?: string; folder?: string }) {
      const made = await call(LIBRARY_ROUTES.create, {
        body: { type, ...(title ? { title } : {}), ...(folder ? { folder } : {}), ...(startsBlank(type) ? { blank: true } : {}) },
      });
      if (typeof made?.id !== 'string' || !made.id) throw new LibraryError('the daemon made no artifact');
      return made;
    },
    /** The artifact's record as the daemon keeps it (its folder is `root`): for this process only, never the page. */
    async record(id: string) {
      return call(LIBRARY_ROUTES.artifact, { query: { id } });
    },
    /** "Open Folder": an artifact folder on this computer joins the library, owned by nobody (`artifacts.add`). */
    async add(folder: string) {
      const made = await call(LIBRARY_ROUTES.add, { body: { folder } });
      if (typeof made?.id !== 'string' || !made.id) throw new LibraryError('the daemon added no artifact');
      return made;
    },
    /** "Import": a zip of an artifact made into one here (`artifacts.import`), where the daemon puts new ones. */
    async importZip(bytes: Uint8Array<ArrayBuffer>, name: string) {
      const made = await call(LIBRARY_ROUTES.import, { method: 'POST', query: { name }, body: bytes, contentType: 'application/zip' });
      if (typeof made?.id !== 'string' || !made.id) throw new LibraryError('the daemon imported no artifact');
      return made;
    },
    /** The artifact's folder was moved to `folder` (`artifacts.relocate`). */
    async relocate(id: string, folder: string) {
      return call(LIBRARY_ROUTES.relocate, { body: { id, folder } });
    },
    /** A type's page of the artifact (for its thumbnail): an address that stays in this process. */
    async preview(id: string) {
      const out = await call(LIBRARY_ROUTES.preview, { body: { id } });
      return typeof out?.page_url === 'string' ? out.page_url : null;
    },
    async saveThumbnail(id: string, version: string, jpeg: Uint8Array<ArrayBuffer>) {
      const out = await call(LIBRARY_ROUTES.thumbnail, { method: 'POST', query: { id, v: version }, body: jpeg, contentType: 'image/jpeg' });
      return typeof out?.thumbnail === 'string' ? out.thumbnail : version || null;
    },
    /** The saved thumbnail, as the daemon answers it (a Response). */
    thumbnail(id: string, version: string) {
      return send(LIBRARY_ROUTES.thumbnail, { query: { id, v: version } });
    },
  };
}
