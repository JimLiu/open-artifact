/**
 * The types on the sites this computer is connected to, as the local home page's Types tab shows them under the
 * person's own (`GET types.sites`): the daemon's answer read defensively, and what each type offers by how it stands
 * here. Pure (no DOM, no fetch), so it runs under `node --test`.
 *
 * Everything a publisher wrote (a name, a description, their account name) stays text. The only address drawn as a
 * link is the type's page, which the daemon made from the remote's own address; it is checked again here.
 */

import { SITE_TYPE_STANDINGS, siteTypePageOf, type SiteTypeStanding, type TypeScope, type TypesSite, type TypesSitesResponse, type TypesSiteType } from '@open-artifact/protocol';
import { siteTypeOf } from './site-types.ts';

export type { TypesSite, TypesSitesResponse, TypesSiteType };

const str = (value: unknown): value is string => typeof value === 'string';
const CODES: ReadonlyArray<NonNullable<TypesSite['code']>> = ['unreachable', 'timeout', 'signed_out', 'unsupported', 'refused', 'error'];
const SCOPES: readonly TypeScope[] = ['project', 'user', 'extra', 'installed', 'builtin'];

/** The page of a type on `host`, when `page` is that: `<host's origin>/t/<id>`; else null (no link is drawn). */
export function typePageLink(page: unknown, host: string, id: string): string | null {
  if (!str(page)) return null;
  const at = siteTypePageOf(page);
  if (!at || at.id !== id) return null;
  try {
    return new URL(host).origin === at.origin ? page : null;
  } catch {
    return null;
  }
}

function localOf(value: unknown): TypesSiteType['local'] {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!str(v.id)) return null;
  return {
    id: v.id,
    version: str(v.version) ? v.version : null,
    scope: (SCOPES as readonly unknown[]).includes(v.scope) ? (v.scope as TypeScope) : 'user',
    ...(str(v.sha256) ? { sha256: v.sha256 } : {}),
    ...(str(v.installedFrom) ? { installedFrom: v.installedFrom } : {}),
  };
}

/** One site of the answer, or null when it is malformed. A type whose page is not on that site is left out. */
function siteOf(value: unknown): TypesSite | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!str(v.remote) || !str(v.host)) return null;
  const types: TypesSiteType[] = [];
  for (const item of Array.isArray(v.types) ? v.types : []) {
    const base = siteTypeOf(item);
    if (!base || base.unpublished) continue;
    const raw = item as Record<string, unknown>;
    const page = typePageLink(raw.page, v.host, base.id);
    if (!page) continue;
    const standing = (SITE_TYPE_STANDINGS as readonly unknown[]).includes(raw.standing) ? (raw.standing as SiteTypeStanding) : 'new';
    types.push({ ...base, page, standing, local: localOf(raw.local) });
  }
  const error = str(v.error) && v.error ? v.error : null;
  const code = error ? ((CODES as readonly unknown[]).includes(v.code) ? (v.code as TypesSite['code']) : 'error') : null;
  return { remote: v.remote, host: v.host, types: error ? [] : types, error, code };
}

/** `GET types.sites`, read defensively: the sites, each with its types or its error, and the third-party note. */
export function typesSitesOf(value: unknown): TypesSitesResponse {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const sites = (Array.isArray(v.sites) ? v.sites : []).map(siteOf).filter((s): s is TypesSite => !!s);
  return { sites, notice: str(v.notice) ? v.notice : '' };
}

/** What the Install dialog is opened with: an installed type to update, or a site type's page to read. */
export type InstallingRequest = { update: string } | { url: string; as?: string; auto: boolean };

/**
 * What a site type offers here, by its standing:
 * - `new`: Install, the dialog reading its page at once;
 * - `update`: Update; the update of the installed type when it was installed from this page, else its page read
 *   again under the installed id (the dialog shows what it replaces);
 * - `clash`: Install under another id: the dialog's form, its page filled in, for the person to name the id;
 * - `installed`, `published-here`: a quiet label, no button.
 */
export function siteTypeOffer(type: Pick<TypesSiteType, 'page' | 'standing' | 'local'>): { action: 'install' | 'update' | 'install-as'; open: InstallingRequest } | { action: 'none'; label: 'installed' | 'published-here' } {
  switch (type.standing) {
    case 'installed':
    case 'published-here':
      return { action: 'none', label: type.standing };
    case 'update':
      if (type.local?.installedFrom === type.page) return { action: 'update', open: { update: type.local.id } };
      return { action: 'update', open: { url: type.page, ...(type.local ? { as: type.local.id } : {}), auto: true } };
    case 'clash':
      return { action: 'install-as', open: { url: type.page, auto: false } };
    default:
      return { action: 'install', open: { url: type.page, auto: true } };
  }
}
