import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { resolve } from 'node:path';

const ID = /^art_[a-z0-9]+$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export interface GuestShareTarget {
  id: string;
  /** A concrete local LAN listener, never the loopback owner listener. */
  upstream: string;
  pagePath: string;
  token: string;
  cookieName: string;
}

export function safePath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\r\n\0]/.test(value)) throw new Error('Invalid guest path');
  const decoded = decodeURIComponent(value.split('?')[0]!);
  if (/[\\\0]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..') || /%[0-9a-f]{2}/i.test(decoded)) throw new Error('Invalid guest path');
  return decoded;
}

export function publicOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Guest sharing requires an HTTPS origin');
  return url.origin;
}

/** Map a trusted type-server share response onto its matching non-loopback listener. */
export function guestShareTarget(id: string, root: string, pageUrl: string, shareUrl: string, localAddresses: readonly string[]): GuestShareTarget {
  if (!ID.test(id)) throw new Error('Invalid artifact id');
  const page = new URL(pageUrl);
  const link = new URL(shareUrl);
  const address = link.hostname.replace(/^\[|\]$/g, '');
  const token = /^\/s\/([A-Za-z0-9_-]{16,64})$/.exec(link.pathname)?.[1];
  if (page.protocol !== 'http:' || link.protocol !== 'http:' || page.username || page.password || link.username || link.password || link.search || link.hash || !token) throw new Error('Invalid type-server share URL');
  if (!isIP(address) || address === '::1' || address === '0.0.0.0' || address === '::' || address.startsWith('127.') || address.toLowerCase().startsWith('::ffff:') || !localAddresses.includes(address)) throw new Error('Guest upstream must be an allowlisted non-loopback local address');
  if (page.port !== link.port) throw new Error('Guest and owner must use the same type-server port');
  const pagePath = safePath(page.pathname);
  if (!/^\/[a-z][a-z0-9-]*\/[A-Za-z0-9_-]+\/$/.test(pagePath)) throw new Error('Unsupported guest page path');
  return { id, upstream: link.origin, pagePath, token, cookieName: `oa_guest_${createHash('sha256').update(resolve(root)).digest('hex').slice(0, 12)}` };
}

/** Only the native guest credential is allowed back to the public browser. */
export function publicGuestCookie(target: GuestShareTarget, value: string): string | null {
  const first = value.split(';')[0]!;
  if (!first.startsWith(`${target.cookieName}=`) || !TOKEN.test(first.slice(target.cookieName.length + 1))) return null;
  return `${first}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}
