/**
 * The one href a docs document may store. Typed links still go through
 * `normalizeHref` (which completes a bare host) and comment / Word export
 * keep their own allowlists; this function does not complete or rewrite
 * those. It only answers whether an href is safe to keep on a link mark.
 *
 * Allowed: `http:`, `https:`, `mailto:`, `tel:`, a `#fragment`, and a
 * same-origin path that starts with one `/`. Refused: `javascript:`, `data:`,
 * `vbscript:`, a protocol-relative `//`, and anything that uses a control
 * character or an HTML entity to hide one of those.
 */

const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** One pass of the entities that can hide a colon or a slash. Anything else is left as written. */
function decodeHrefEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    const token = body.toLowerCase();
    if (Object.hasOwn(NAMED_ENTITIES, token)) return NAMED_ENTITIES[token]!;
    const code = token.startsWith('#x') ? Number.parseInt(token.slice(2), 16) : token.startsWith('#') ? Number.parseInt(token.slice(1), 10) : Number.NaN;
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return entity;
    try {
      return String.fromCodePoint(code);
    } catch {
      return entity;
    }
  });
}

/**
 * The href to store, or null when it must not be a link. Outer whitespace is
 * trimmed; a control character left inside the value is refused rather than
 * stripped, because the URL parser ignores tab and newline and would otherwise
 * read `java\nscript:` as `javascript:`.
 */
export function storableHref(input: string): string | null {
  if (typeof input !== 'string') return null;
  const text = decodeHrefEntities(input).trim();
  if (!text || INVISIBLE.test(text) || text.includes('\\') || /\s/.test(text)) return null;
  if (text.startsWith('#')) return text;
  if (!text.startsWith('/') || text.startsWith('//')) {
    if (text.startsWith('//')) return null;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (!/^https?:\/\//i.test(text) || !url.hostname) return null;
      return text;
    }
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
      if (!/^(?:mailto|tel):./i.test(text)) return null;
      return text;
    }
    return null;
  }
  return text;
}
