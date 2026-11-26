/**
 * The daemon's Library API answers, in the page's shapes (routes.ts): what a host's routes answer the page with.
 */
import type { ArtifactView, TypeView } from '@open-artifact/protocol';
import type { ArtifactList, DeleteAnswer, OpenAnswer, PageArtifact, TypeTile } from './routes.ts';

/**
 * The version a thumbnail was taken at. The daemon names it either by the stamp itself or by a URL carrying it as `v`
 * (`/api/open-artifact.artifacts.thumbnail?id=…&v=…`).
 */
export function thumbnailStamp(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.startsWith('/')) return value;
  try {
    return new URL(value, 'http://localhost').searchParams.get('v') ?? value;
  } catch {
    return value;
  }
}

/** One artifact of the daemon's library as the page reads one; `harness` is the host's: an owner of it is its session. */
export function pageView(a: Partial<ArtifactView>, harness: string): PageArtifact {
  const created = a.createdAt ?? '';
  const owner = a.owner ?? null;
  return {
    id: a.id ?? '',
    root: a.root ?? '',
    project: a.project ?? '',
    type: a.type ?? '',
    typeTitle: a.typeTitle ?? a.type ?? '',
    sessionId: owner?.harness === harness && typeof owner.session === 'string' ? owner.session : '',
    ownerStatus: owner ? (owner.live === false ? 'offline' : (owner.status ?? null)) : null,
    title: a.title ?? '',
    openedAt: a.openedAt ?? created,
    createdAt: created,
    updatedAt: a.contentAt ?? a.updatedAt ?? created,
    pinned: !!a.pinned,
    shared: !!a.shared,
    thumbnail: thumbnailStamp(a.thumbnail),
    openable: !a.typeMissing,
    viewUrl: a.view_url ?? '',
  };
}

/** The installed types a new session can make one of, as the page's tiles read them. */
export function typeTiles(types: Partial<TypeView>[]): TypeTile[] {
  return types
    .filter((t) => typeof t.id === 'string' && t.enabled !== false && t.runnable !== false && !t.shadowedBy && !(t.problems?.length))
    .map((t) => ({ id: t.id!, title: t.title || t.id!, description: t.description ?? '' }));
}

/** The list route's answer, from the Library API's artifacts and types. */
export function artifactList(list: { artifacts?: ArtifactView[] }, types: { types?: TypeView[] }, harness: string): ArtifactList {
  return { artifacts: (list.artifacts ?? []).map((a) => pageView(a, harness)), types: typeTiles(types.types ?? []) };
}

/** The open route's answer, from the Library API's open and the artifact (as {@link pageView} reads it). */
export function openAnswer(opened: { view_url?: string }, view: PageArtifact): OpenAnswer {
  return { url: opened.view_url ?? view.viewUrl, sessionId: view.sessionId, title: view.title };
}

/** The delete route's answer, from the Library API's delete of `id`. */
export function deleteAnswer(out: { deleted?: string; folderKept?: string }, id: string): DeleteAnswer {
  return { trash: out.deleted ?? id, path: out.folderKept ?? '' };
}
