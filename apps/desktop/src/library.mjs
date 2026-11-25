/**
 * The home page's calls, answered here: the daemon's Library API with its token, which never leaves this process.
 *
 * The answers are made into the page's shapes with `@open-artifact/library-page/library` (the same functions the DSH
 * plugin's routes use). What would let the window's page reach the daemon by itself is kept here: the token, the
 * thumbnail's daemon address (the page gets an `oa-thumbnail:` address this process answers, `thumbnails.mjs`), and a
 * type's preview page (the page gets an opaque name; the picture is taken here). The Shell's own address (`viewUrl`,
 * the link "Copy link" copies) carries nothing secret and is passed on as it is.
 */
import { artifactList, deleteAnswer, pageView } from '@open-artifact/library-page/library';
import { LIBRARY_ROUTES, builtinStartOf } from '@open-artifact/protocol';
import { artifactIdOf } from './navigation.mjs';

/** The harness this app is to the daemon: an artifact a session of it owns would be its own (it attaches none). */
export const HARNESS = 'open-artifact-desktop';
/** The longest title the page may set. */
const TITLE_MAX = 300;
/** A trash entry's name: what `artifacts.delete` answers (`deleted`), the id or a folder name. */
const TRASH_NAME = /^[A-Za-z0-9._-]{1,200}$/;

export class LibraryError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** An id the page sent: an artifact id, or a throw. */
export function idArg(value) {
  const id = typeof value === 'string' ? artifactIdOf(value) : null;
  if (!id || id !== value) throw new LibraryError('not an artifact id');
  return id;
}

/** The fields a page's `update` may change (title, pinned), checked; a throw for anything else. */
export function patchArg(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LibraryError('not a change');
  const out = {};
  for (const [key, field] of Object.entries(value)) {
    if (key === 'title' && typeof field === 'string' && field.trim() && field.length <= TITLE_MAX) out.title = field.trim();
    else if (key === 'pinned' && typeof field === 'boolean') out.pinned = field;
    else throw new LibraryError(`cannot change ${key}`);
  }
  if (!Object.keys(out).length) throw new LibraryError('nothing to change');
  return out;
}

/** What `create` takes from the page: a type id and an optional title. */
export function createArg(value) {
  if (!value || typeof value !== 'object') throw new LibraryError('not a request');
  const type = value.type;
  if (typeof type !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(type)) throw new LibraryError('not a type');
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, TITLE_MAX) : '';
  return { type, title };
}

/** How a type starts from the app: blank (its editor's starting files, then the editor) or empty (for an agent). */
export const startsBlank = (type) => builtinStartOf(type) === 'blank';

/**
 * The Library API of the kit's daemon. `state()`: the kit's connection state (`{ url, token }`, or null).
 * Every call throws on an answer that is not 2xx, with the daemon's own words.
 */
export function libraryClient({ state, fetchImpl = fetch }) {
  const send = async (name, { query, body, method, contentType, signal } = {}) => {
    const s = state();
    if (!s?.url || !s?.token) throw new LibraryError('not connected to Open Artifact');
    const url = new URL(`/api/open-artifact.${name}`, s.url);
    for (const [key, value] of Object.entries(query ?? {})) if (value != null && value !== '') url.searchParams.set(key, String(value));
    const headers = { Authorization: `Bearer ${s.token}` };
    if (body !== undefined) headers['Content-Type'] = contentType ?? 'application/json';
    return fetchImpl(url, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body !== undefined ? { body: contentType ? body : JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  };
  const call = async (name, options) => {
    const response = await send(name, options);
    const out = await response.json().catch(() => ({}));
    if (!response.ok) throw new LibraryError(typeof out?.message === 'string' && out.message ? out.message : `HTTP ${response.status}`, { status: response.status, code: out?.code ?? '' });
    return out;
  };

  return {
    send,
    call,
    async list() {
      const [list, types] = await Promise.all([call(LIBRARY_ROUTES.artifacts), call(LIBRARY_ROUTES.types)]);
      return artifactList(list, types, HARNESS);
    },
    async artifact(id) {
      return pageView(await call(LIBRARY_ROUTES.artifact, { query: { id } }), HARNESS);
    },
    async update(id, patch) {
      return pageView(await call(LIBRARY_ROUTES.update, { body: { id, ...patch } }), HARNESS);
    },
    async remove(id) {
      return deleteAnswer(await call(LIBRARY_ROUTES.delete, { body: { id } }), id);
    },
    async restore(trash) {
      if (typeof trash !== 'string' || !TRASH_NAME.test(trash)) throw new LibraryError('not a trash entry');
      return pageView(await call(LIBRARY_ROUTES.restore, { body: { id: trash } }), HARNESS);
    },
    /** A new artifact of `type`: started blank when the type is one that goes straight to its editor. */
    async create({ type, title }) {
      const made = await call(LIBRARY_ROUTES.create, { body: { type, ...(title ? { title } : {}), ...(startsBlank(type) ? { blank: true } : {}) } });
      if (typeof made?.id !== 'string' || !made.id) throw new LibraryError('the daemon made no artifact');
      return made;
    },
    /** A type's page of the artifact (for its thumbnail): an address that stays in this process. */
    async preview(id) {
      const out = await call(LIBRARY_ROUTES.preview, { body: { id } });
      return typeof out?.page_url === 'string' ? out.page_url : null;
    },
    async saveThumbnail(id, version, jpeg) {
      const out = await call(LIBRARY_ROUTES.thumbnail, { method: 'POST', query: { id, v: version }, body: jpeg, contentType: 'image/jpeg' });
      return typeof out?.thumbnail === 'string' ? out.thumbnail : version || null;
    },
    /** The saved thumbnail, as the daemon answers it (a Response). */
    thumbnail(id, version) {
      return send(LIBRARY_ROUTES.thumbnail, { query: { id, v: version } });
    },
  };
}
