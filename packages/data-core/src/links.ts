/**
 * A dataset's `link` (and a certified answer's `url`): an https address with a host and no user name or password.
 * Anything else, a `{{filter}}` in it too, is dropped rather than shown as a button.
 */
export function parseHttpsLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.includes('{{')) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.hostname.endsWith('.')) return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  return url.href;
}

/** The host a link opens in ("docs.example.com"), for its button; empty when it isn't a link the page keeps. */
export function getLinkHost(link: string): string {
  const kept = parseHttpsLink(link);
  return kept === undefined ? '' : new URL(kept).hostname;
}
