import { localeOverride } from '@open-artifact/runtime';

/** Keep the explicit UI language across pages without copying page-specific query parameters. */
export function withUiLanguage(href: string, search = globalThis.location?.search ?? ''): string {
  const source = new URLSearchParams(search);
  const lang = source.get('lang');
  if (!lang || !localeOverride(source)) return href;
  const base = globalThis.location?.href ?? 'https://example.invalid/';
  try {
    if (new URL(href, base).origin !== new URL(base).origin) return href;
  } catch {
    return href;
  }
  const fragment = href.indexOf('#');
  const path = fragment === -1 ? href : href.slice(0, fragment);
  const hash = fragment === -1 ? '' : href.slice(fragment);
  const query = path.indexOf('?');
  const params = new URLSearchParams(query === -1 ? '' : path.slice(query + 1));
  if (params.has('lang')) return href;
  const separator = query === -1 ? '?' : path.endsWith('?') || path.endsWith('&') ? '' : '&';
  return `${path}${separator}${new URLSearchParams({ lang })}${hash}`;
}

export function shellHref(id: string, search?: string): string {
  return withUiLanguage(`/a/${encodeURIComponent(id)}`, search);
}
