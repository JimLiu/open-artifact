/**
 * The types published to a cloud host, as the home page shows them: the Types tab (the catalog the person may list)
 * and a type's page (`/t/<id>`, whose detail the host inlines in the boot, {@link HomeBoot.typePage}). Pure parsing
 * and the fetches of the host's `types*` routes (`SITE_TYPE_ROUTES`); no DOM, so it runs under `node --test`.
 *
 * Everything a publisher wrote (a name, a description, the SKILL.md) is drawn as text, never as HTML or Markdown.
 */

import { SITE_TYPE_ROUTES, SITE_TYPE_VISIBILITIES, type HomeBoot, type LinkSiteType, type SiteTypeDetail, type SiteTypesResult, type SiteTypeVisibility } from '@open-artifact/protocol';
import { answerOf, ApiError } from './api.ts';

export type { SiteTypeDetail, SiteTypesResult };

const str = (value: unknown): value is string => typeof value === 'string';
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(str) : []);

/** One listed type, or null when it is malformed. */
export function siteTypeOf(value: unknown): LinkSiteType | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!str(v.id) || !str(v.uid) || !str(v.name) || !str(v.version)) return null;
  const visibility = (SITE_TYPE_VISIBILITIES as readonly unknown[]).includes(v.visibility) ? (v.visibility as SiteTypeVisibility) : 'private';
  const publisher = v.publisher && typeof v.publisher === 'object' ? (v.publisher as Record<string, unknown>) : {};
  return {
    id: v.id,
    uid: v.uid,
    name: v.name,
    version: v.version,
    description: str(v.description) ? v.description : '',
    visibility,
    publisher: { id: str(publisher.id) ? publisher.id : '', name: str(publisher.name) ? publisher.name : null },
    mine: v.mine === true,
    unpublished: v.unpublished === true,
    sha256: str(v.sha256) ? v.sha256 : '',
    bytes: typeof v.bytes === 'number' ? v.bytes : 0,
    capabilities: strings(v.capabilities),
    network: strings(v.network),
    createdAt: str(v.createdAt) ? v.createdAt : '',
    updatedAt: str(v.updatedAt) ? v.updatedAt : '',
  };
}

/** A type page's detail, or null when it is malformed. */
export function siteTypeDetailOf(value: unknown): SiteTypeDetail | null {
  const base = siteTypeOf(value);
  if (!base) return null;
  const v = value as Record<string, unknown>;
  if (!str(v.pageUrl) || !str(v.packageUrl) || !str(v.install)) return null;
  return { ...base, skill: str(v.skill) ? v.skill : null, manages: v.manages === true, pageUrl: v.pageUrl, packageUrl: v.packageUrl, install: v.install, notice: str(v.notice) ? v.notice : '' };
}

/** The type page's detail from the boot, or undefined. */
export function typePageOf(boot: unknown): HomeBoot['typePage'] {
  if (!boot || typeof boot !== 'object') return undefined;
  return siteTypeDetailOf((boot as { typePage?: unknown }).typePage) ?? undefined;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const route = (name: string): string => `/api/open-artifact.${name}`;

async function call<T>(doFetch: FetchLike, path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await doFetch(path, init);
  } catch (error) {
    throw new ApiError('connect_failed', error instanceof Error ? error.message : String(error), 0);
  }
  return answerOf<T>(response);
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** The host's type routes on the page's own origin (a signed-in browser's cookie; writes from the same origin). */
export function createSiteTypesApi(doFetch: FetchLike = (input, init) => fetch(input, init)) {
  return {
    async list(): Promise<SiteTypesResult> {
      const out = await call<Partial<SiteTypesResult>>(doFetch, route(SITE_TYPE_ROUTES.list), { cache: 'no-store' });
      const types = Array.isArray(out.types) ? out.types.map(siteTypeOf).filter((t): t is LinkSiteType => !!t) : [];
      const publish = out.publish && typeof out.publish === 'object' ? out.publish : { allowed: false, refusal: null };
      return { types, notice: str(out.notice) ? out.notice : '', publish: { allowed: publish.allowed === true, refusal: str(publish.refusal) ? publish.refusal : null } };
    },
    async setVisibility(id: string, visibility: SiteTypeVisibility): Promise<SiteTypeDetail> {
      const out = siteTypeDetailOf(await call<unknown>(doFetch, route(SITE_TYPE_ROUTES.update), post({ id, visibility })));
      if (!out) throw new ApiError('server_failed', 'The site answered without the type.', 0);
      return out;
    },
    unpublish: (id: string) => call<{ id: string; removed: boolean; artifacts: number }>(doFetch, route(SITE_TYPE_ROUTES.unpublish), post({ id })),
  };
}

/** The address of a type's page on this site. */
export const typePageHref = (id: string): string => `/t/${encodeURIComponent(id)}`;
