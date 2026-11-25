/**
 * The site's published types on its app origin, for people in a browser (the Link's `types.*` routes are a linked
 * computer's): the catalog list, one type's detail with its SKILL.md, its package, and, for its publisher or a site
 * admin, a change of visibility and unpublishing. And the type's page, `GET /t/<id>`, which the home page's bundle
 * draws from its boot ({@link HomeBoot.typePage}).
 *
 * Who sees what (the catalog's rules, `catalog/site-types.ts`):
 * - the list: what {@link mayListSiteType} allows (`site` types and their own; a site admin every one);
 * - a type's page, detail and package: what {@link mayDownloadSiteType} allows (listed, or `link` to anyone signed in
 *   who names it). Someone not signed in gets a `link` type only where the site allows public access
 *   (`OA_PUBLIC_ACCESS`, as public artifacts), else is sent to sign in;
 * - a delisted type: only to those who manage it, who are told it is delisted;
 * - anything else is answered exactly as an unknown id ({@link noSiteType}): nothing says a `private` type exists.
 *
 * Writes go through the app origin's rules (same origin, no Bearer token: `routes.ts`) and are audited. Every name,
 * description and SKILL.md is the publisher's text: the page shows it as text, and the answers say so (`notice`).
 */

import { SITE_TYPE_ROUTES, SITE_TYPE_VISIBILITIES, siteTypePagePath, THIRD_PARTY_NOTICE, TYPE_ID, type HomeBoot, type SiteTypeDetail, type SiteTypesResult, type SiteTypeVisibility } from '@open-artifact/protocol';
import { authenticate, type Authentication } from '../auth/session.ts';
import { managesSiteType, mayDownloadSiteType, mayListSiteType, SiteTypes, typesPublishRefusal, type SiteTypeActor, type SiteTypeRow } from '../catalog/site-types.ts';
import { httpError, json, readJson, type Router } from '../http.ts';
import { linkSiteTypes, siteTypePackageResponse, unpublishSiteType } from '../link/types-routes.ts';
import type { UserPrincipal } from '../types.ts';
import { HOME_BOOT_PLACEHOLDER, signInRedirect } from './pages.ts';
import { builtPage, inlineBoot } from './security.ts';
import type { AppCtx } from './services.ts';
import { homeBoot, personOf, signedIn } from './views.ts';

/** The API path of a site type route. */
export const siteTypeApiPath = (route: string): string => `/api/open-artifact.${route}`;

const BODY_BYTES = 64 * 1024;

/** How far a visibility shows a type: `private` < `link` < `site`. */
const REACH: Record<SiteTypeVisibility, number> = { private: 0, link: 1, site: 2 };

const actorOf = (person: UserPrincipal): SiteTypeActor => ({ id: person.id, siteRole: person.siteRole });

/**
 * The one answer for "no such type" and "not yours to see": a 404 with the same body to a signed-in person, a 401 to
 * anyone else (signing in may show it), whether or not the id exists.
 */
export function noSiteType(signedInPerson: boolean): Error {
  if (!signedInPerson) return httpError('unauthorized', 'Sign in to see this type.', { status: 401 });
  return httpError('not_found', 'There is no such type on this site, or it is not shared with you.', { status: 404 });
}

/** A type the request may see (download), or {@link noSiteType}. */
export async function seeSiteType(request: Request, ctx: AppCtx, id: string): Promise<{ row: SiteTypeRow; person: UserPrincipal | null; auth: Authentication }> {
  const auth = await authenticate(request, ctx);
  if (auth.invalid.includes('bearer')) throw httpError('unauthorized', 'The access token is expired, revoked or unknown.', { status: 401 });
  const person = personOf(auth.principal);
  const row = ctx.siteTypes && TYPE_ID.test(id) ? await new SiteTypes(ctx.catalog.driver, () => ctx.now()).byId(id) : undefined;
  const may = !!row && (person ? mayDownloadSiteType(row, actorOf(person)) : ctx.config.publicAccess === true && !row.unpublished && row.visibility === 'link');
  if (!row || !may) throw noSiteType(!!person);
  return { row, person, auth };
}

/** What the type page shows of a type, for this asker. */
export async function siteTypeDetail(ctx: AppCtx, row: SiteTypeRow, person: UserPrincipal | null): Promise<SiteTypeDetail> {
  const [view] = await linkSiteTypes(ctx, [row], person?.id ?? '');
  const skill = (await ctx.siteTypes?.skill?.(row.uid, row.version).catch(() => null)) ?? null;
  const pageUrl = ctx.config.appOrigin + siteTypePagePath(row.id);
  return {
    ...view!,
    skill,
    manages: !!person && managesSiteType(row, actorOf(person)),
    pageUrl,
    packageUrl: `${ctx.config.appOrigin}${siteTypeApiPath(SITE_TYPE_ROUTES.package)}?${new URLSearchParams({ id: row.id })}`,
    install: `open-artifact types install ${pageUrl}`,
    notice: THIRD_PARTY_NOTICE,
  };
}

/** The `id` of a JSON write's body, checked. */
function bodyId(body: unknown): string {
  const id = body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string' ? (body as { id: string }).id : '';
  if (!TYPE_ID.test(id)) throw httpError('invalid_argument', 'The body names the type: {"id": "<type id>"}.', { status: 400 });
  return id;
}

/** A type the signed-in person may manage, or 404 (cannot see it) / 403 (sees it, someone else's). */
async function managed(request: Request, ctx: AppCtx, id: string, what: string): Promise<{ row: SiteTypeRow; person: UserPrincipal }> {
  const { person } = await signedIn(request, ctx);
  const { row } = await seeSiteType(request, ctx, id);
  if (!managesSiteType(row, actorOf(person))) throw httpError('not_granted', `${row.id} was published by someone else: only its publisher or a site admin may ${what}.`, { status: 403 });
  return { row, person };
}

/** Registers the site type routes and the type page. */
export function siteTypeRoutes(router: Router<AppCtx>): void {
  router.get(siteTypeApiPath(SITE_TYPE_ROUTES.list), async (request, ctx) => {
    const { person } = await signedIn(request, ctx);
    const rows = ctx.siteTypes ? (await new SiteTypes(ctx.catalog.driver, () => ctx.now()).all()).filter((row) => mayListSiteType(row, actorOf(person))) : [];
    const refusal = ctx.siteTypes ? typesPublishRefusal(ctx.config.typesPublish ?? 'admins', person.siteRole, ctx.config.contentSameSite === true) : 'This site keeps no published types.';
    const result: SiteTypesResult = { types: await linkSiteTypes(ctx, rows, person.id), notice: THIRD_PARTY_NOTICE, publish: { allowed: refusal === null, refusal } };
    return json(result);
  });

  router.get(siteTypeApiPath(SITE_TYPE_ROUTES.detail), async (request, ctx) => {
    const { row, person } = await seeSiteType(request, ctx, new URL(request.url).searchParams.get('id') ?? '');
    return json(await siteTypeDetail(ctx, row, person));
  });

  router.get(siteTypeApiPath(SITE_TYPE_ROUTES.package), async (request, ctx) => {
    const { row } = await seeSiteType(request, ctx, new URL(request.url).searchParams.get('id') ?? '');
    const bytes = await ctx.siteTypes!.package(row.uid, row.version);
    if (!bytes) throw httpError('not_found', `The package of ${row.id} ${row.version} is missing on this site.`, { status: 404 });
    const [view] = await linkSiteTypes(ctx, [row], '');
    return siteTypePackageResponse(row, bytes, request.method, view!.publisher.name);
  });

  router.post(siteTypeApiPath(SITE_TYPE_ROUTES.update), async (request, ctx) => {
    const body = await readJson<unknown>(request, BODY_BYTES);
    const id = bodyId(body);
    const visibility = (body as { visibility?: unknown }).visibility;
    if (typeof visibility !== 'string' || !(SITE_TYPE_VISIBILITIES as readonly string[]).includes(visibility)) {
      throw httpError('invalid_argument', 'visibility is private, site or link.', { status: 400 });
    }
    const { row, person } = await managed(request, ctx, id, 'change who sees it');
    const to = visibility as SiteTypeVisibility;
    if (row.unpublished) throw httpError('conflict', `${row.id} is unpublished: publish it again to list it.`, { status: 409, fix: `open-artifact types publish ${row.id} --remote <this site>` });
    // Showing it to more people is publishing it to them: only someone the site lets publish now.
    if (REACH[to] > REACH[row.visibility]) {
      const refusal = typesPublishRefusal(ctx.config.typesPublish ?? 'admins', person.siteRole, ctx.config.contentSameSite === true);
      if (refusal) throw httpError('not_granted', refusal, { status: 403, fix: 'Ask a site admin.' });
    }
    if (to === row.visibility) return json(await siteTypeDetail(ctx, row, person));
    const next = (await new SiteTypes(ctx.catalog.driver, () => ctx.now()).setVisibility(row.uid, to))!;
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: person.id, action: 'type.visibility', detail: { id: row.id, uid: row.uid, version: row.version, from: row.visibility, to, user: person.id } });
    return json(await siteTypeDetail(ctx, next, person));
  });

  router.post(siteTypeApiPath(SITE_TYPE_ROUTES.unpublish), async (request, ctx) => {
    const id = bodyId(await readJson<unknown>(request, BODY_BYTES));
    const { row, person } = await managed(request, ctx, id, 'unpublish it');
    return json(await unpublishSiteType(ctx, ctx.siteTypes!, row, { actorKind: 'user', actorId: person.id, user: person.id }));
  });

  router.get('/t/:id', async (request, ctx) => {
    const id = ctx.params.id!;
    let seen: Awaited<ReturnType<typeof seeSiteType>>;
    try {
      seen = await seeSiteType(request, ctx, id);
    } catch (error) {
      // Not signed in: maybe signing in shows it (the same for an id that does not exist).
      if ((error as { code?: unknown }).code === 'unauthorized') return signInRedirect(TYPE_ID.test(id) ? siteTypePagePath(id) : '/');
      throw error;
    }
    const boot: HomeBoot = { ...homeBoot(ctx, seen.auth.principal, siteTypePagePath(seen.row.id)), typePage: await siteTypeDetail(ctx, seen.row, seen.person) };
    const html = inlineBoot(await ctx.homeHtml(), HOME_BOOT_PLACEHOLDER, boot);
    return builtPage(html, ctx.config, undefined, { headers: seen.auth.setCookie ? { 'set-cookie': seen.auth.setCookie } : {} });
  });
}
