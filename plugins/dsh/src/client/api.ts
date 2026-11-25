/**
 * The page's calls to its Host routes (src/server/routes.ts). Paths are fetched relative to the document, as the app's
 * own pages call their routes, so the page works under whatever prefix the app is served at.
 */
import type { ChangelogReader, PageApi } from '@open-artifact/library-page';
import type { ChangelogAnswer } from '@open-artifact/library-page/library';
import { PATHS, type ArtifactList, type DeleteAnswer, type OpenAnswer, type PageArtifact } from '../shared/routes.ts';

/** A route path as the page fetches it. */
export const routeUrl = (path: string, params?: Record<string, string>): string =>
  `${path.slice(1)}${params ? `?${new URLSearchParams(params)}` : ''}`;

/** One route call: its JSON answer, or a throw with the route's words. */
async function call<T>(path: string, params: Record<string, string>, init: RequestInit = { method: 'POST' }): Promise<T> {
  const response = await fetch(routeUrl(path, params), init);
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
  return body;
}

export type { PageApi };

/** The routes over `fetch`. */
export const httpApi: PageApi = {
  async list() {
    const response = await fetch(routeUrl(PATHS.list), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as Partial<ArtifactList>;
    return {
      artifacts: Array.isArray(body.artifacts) ? body.artifacts.filter((a) => a && typeof a.id === 'string') : [],
      types: Array.isArray(body.types) ? body.types.filter((t) => t && typeof t.id === 'string') : [],
    };
  },
  open: (id) => call<OpenAnswer>(PATHS.open, { id }),
  preview: async (id) => (await call<{ url?: unknown }>(PATHS.preview, { id })).url as string | null,
  update: (id, patch) => call<PageArtifact>(PATHS.update, { id }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }),
  remove: (id) => call<DeleteAnswer>(PATHS.delete, { id }),
  restore: (trash) => call<PageArtifact>(PATHS.restore, { trash }),
  async saveThumbnail(id, version, jpeg) {
    const out = await call<{ thumbnail?: unknown }>(PATHS.thumbnail, { id, v: version }, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: jpeg as Uint8Array<ArrayBuffer>,
    });
    return typeof out.thumbnail === 'string' ? out.thumbnail : null;
  },
  thumbnailUrl: (id, version) => routeUrl(PATHS.thumbnail, { id, v: version }),
  events(onEvent, onError) {
    if (typeof EventSource === 'undefined') return null;
    const source = new EventSource(routeUrl(PATHS.events));
    source.onmessage = () => onEvent();
    source.onerror = () => onError();
    return () => source.close();
  },
};

/** The release notes, from the changelog route (src/server/changelog.ts); null when it does not answer. */
export const readChangelog: ChangelogReader = async (upcoming) => {
  try {
    const response = await fetch(routeUrl(PATHS.changelog, upcoming ? { upcoming: '1' } : undefined), { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ChangelogAnswer>;
    return typeof body.version === 'string' && Array.isArray(body.releases) ? { version: body.version, releases: body.releases, upcoming: body.upcoming ?? [] } : null;
  } catch {
    return null;
  }
};
