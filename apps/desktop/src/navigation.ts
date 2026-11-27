export type NavigationDecision = { action: 'allow' | 'home' | 'block' } | { action: 'open-tab'; id: string } | { action: 'external'; url: string };
/**
 * Which addresses an artifact view may load, and what the app does with a top-level navigation in a view.
 *
 * The allowlist is the daemon's own origin plus exactly the origins `embed.origins` lists (refreshed on every
 * `embed/origins` event), never "all of loopback": another program on this computer may serve loopback too. Remote
 * entries (a type whose page is on another computer) are left out: this app does not show remote pages yet.
 * Adapted from `examples/harness-node/allowlist.mjs`.
 *
 * A top-level navigation in a view (`decide`):
 * - the same artifact's Shell (`/a/<this id>`, a reload or a new place): allowed;
 * - another artifact's Shell (`/a/<other id>` on an allowed origin: "Duplicate", the doc's "Copy as…"): not loaded
 *   here; the app opens that artifact in a tab of its own;
 * - the daemon's home page (`/`): not loaded here; the app goes to its first tab;
 * - anything else on an allowed origin: blocked (a view shows one artifact);
 * - an http(s) address elsewhere: handed to the system browser;
 * - anything else: blocked.
 *
 * The sites this computer is connected to (`remotes`: Open Artifact servers an artifact is published to) are a list of
 * their own (`setServers`, refreshed with the list), never part of the local allowlist: a local view (the daemon's
 * partition) never loads a site's page, and a site's page is shown only in a view of the servers' partition
 * (`tabs.ts`). In such a view (`decideServer`):
 * - an address on one of the sites (its pages, its sign-in): allowed; only those origins;
 * - a local artifact's Shell: opens a tab of it; the daemon's home page: the first tab; anything else local: blocked;
 * - any other http(s) address: the system browser; anything else: blocked.
 * Its subframes (`serverSubframeAllowed`): the page's own frames, the connected site's origin (even when that origin
 * is on this computer), that site's content hosts (`*.content.localhost`), and public http(s). Literal loopback,
 * `::1`, RFC1918, link-local, and any other `localhost` name are refused. This is not `offline.ts`'s `onThisComputer`
 * turned around: a private address is not "this computer" there, and is still refused here.
 * Pure: the tests check it without Electron.
 */

/** A test for one origin or a CSP-style pattern (`http://*.frame.localhost:4123`). */
function matcherOf(entry: string) {
  let pattern: URL;
  try {
    pattern = new URL(entry.replace('*.', 'wildcard-placeholder.'));
  } catch {
    return () => false;
  }
  const wildcard = entry.includes('*.');
  const suffix = wildcard ? pattern.hostname.replace(/^wildcard-placeholder/, '') : '';
  return (url: URL) =>
    url.protocol === pattern.protocol &&
    url.port === pattern.port &&
    (wildcard ? url.hostname.endsWith(suffix) && url.hostname.length > suffix.length : url.hostname === pattern.hostname);
}

const parse = (address: string | null | undefined) => {
  try {
    return address ? new URL(address) : null;
  } catch {
    return null;
  }
};

export const httpish = (address: unknown) => /^https?:\/\//i.test(String(address ?? ''));

/** A subframe address with no origin of its own: the page made it. */
export const ownSubframe = (address: string) => address.startsWith('blob:') || address === 'about:srcdoc' || address === 'about:blank';

export class OriginAllowlist {
  daemon: string | null = null;
  origins: string[] = [];
  matchers: ((url: URL) => boolean)[] = [];
  servers: string[] = [];
  listed: string[] = [];
  constructor() {
    this.daemon = null;
    this.origins = [];
    this.matchers = [];
    this.servers = [];
  }

  /** The daemon's own origin (`http://127.0.0.1:<port>`), from its `daemon.json`. */
  setDaemon(url: string | null) {
    this.daemon = url ? new URL(url).origin : null;
    this.rebuild();
  }

  /** From an `embed.origins` answer or an `embed/origins` event: every local entry; remote ones are left out. */
  fromDaemon(result: { origins?: readonly string[]; entries?: { origin?: string; pattern?: string; remote?: boolean }[] }) {
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    this.listed = entries.length
      ? entries
          .filter((entry) => !entry.remote)
          .map((entry) => entry.origin ?? entry.pattern)
          .filter((origin): origin is string => typeof origin === 'string')
      : [...(result?.origins ?? [])];
    this.rebuild();
  }

  /** The sites in `remotes` (each one's `host`): their origins, the only ones a server view loads. */
  setServers(hosts: readonly string[]) {
    const origins: string[] = [];
    for (const host of hosts) {
      const url = parse(host);
      if (url && (url.protocol === 'https:' || url.protocol === 'http:')) origins.push(url.origin);
    }
    this.servers = [...new Set(origins)];
  }

  /** The site's origin an address is on (one of `setServers`), or null; this computer's own pages never are. */
  serverOf(address: string | null | undefined) {
    const url = parse(address);
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || this.allows(address)) return null;
    return (this.servers ?? []).find((origin) => origin === url.origin) ?? null;
  }

  rebuild() {
    this.origins = [...new Set([...(this.daemon ? [this.daemon] : []), ...(this.listed ?? [])])];
    this.matchers = this.origins.map(matcherOf);
  }

  allows(address: string | null | undefined) {
    const url = parse(address);
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false;
    return this.matchers.some((matches) => matches(url));
  }
}

/** The artifact id of a Shell address (`/a/<id>`), or null. */
export function shellArtifactId(address: string) {
  const url = parse(address);
  if (!url) return null;
  const match = /^\/a\/([^/?#]+)/.exec(url.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * What to do with a top-level navigation of the view showing artifact `current` (see the module comment):
 * `{ action: 'allow' }`, `{ action: 'open-tab', id }`, `{ action: 'home' }`, `{ action: 'external', url }` or
 * `{ action: 'block' }`.
 */
export function decide(address: string, { allowlist, current }: { allowlist: OriginAllowlist; current: string }): NavigationDecision {
  const url = parse(address);
  if (!url) return { action: 'block' };
  if (allowlist.allows(address)) {
    const id = shellArtifactId(address);
    if (id && id === current) return { action: 'allow' };
    if (id) return { action: 'open-tab', id };
    if (url.pathname === '/' && allowlist.daemon && url.origin === allowlist.daemon) return { action: 'home' };
    return { action: 'block' };
  }
  if (httpish(address)) return { action: 'external', url: url.href };
  return { action: 'block' };
}

/**
 * What to do with a top-level navigation of a view showing a site's page (see the module comment): a site of
 * `remotes` stays; this computer's Shell of an artifact opens (or goes back to) its tab; the daemon's home is the home
 * tab; any other web address goes to the system browser.
 */
export function decideServer(address: string, { allowlist }: { allowlist: OriginAllowlist }): NavigationDecision {
  const url = parse(address);
  if (!url) return { action: 'block' };
  if (allowlist.allows(address)) {
    const id = shellArtifactId(address);
    if (id) return { action: 'open-tab', id };
    if (url.pathname === '/' && allowlist.daemon && url.origin === allowlist.daemon) return { action: 'home' };
    return { action: 'block' };
  }
  // Only the sites in `remotes`: anything else (another site's sign-in included) goes to the system browser.
  if (allowlist.serverOf(address)) return { action: 'allow' };
  if (httpish(address)) return { action: 'external', url: url.href };
  return { action: 'block' };
}

/** One decimal octet of a parsed host, or null. */
function octet(part: string): number | null {
  if (part.length < 1 || part.length > 3) return null;
  let value = 0;
  for (let i = 0; i < part.length; i++) {
    const digit = part.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return null;
    value = value * 10 + digit;
  }
  return value > 255 ? null : value;
}

/** `a.b.c.d` from a parsed hostname, or null. `new URL` has already folded the odd IPv4 spellings. */
function ipv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    const value = octet(part);
    if (value === null) return null;
    octets.push(value);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

/** Four hex digits of an IPv6 group. */
function hex16(text: string): number | null {
  if (text.length < 1 || text.length > 4) return null;
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const digit = code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : -1;
    if (digit < 0) return null;
    value = value * 16 + digit;
  }
  return value;
}

/**
 * The IPv4 address inside a parsed `::ffff:` host. `new URL('http://[::ffff:127.0.0.1]/')` is `[::ffff:7f00:1]`,
 * so the dotted form alone would miss it.
 */
function mappedIpv4(host: string): [number, number, number, number] | null {
  const prefix = '::ffff:';
  if (host.slice(0, prefix.length) !== prefix) return null;
  const rest = host.slice(prefix.length);
  const dotted = ipv4(rest);
  if (dotted) return dotted;
  const groups = rest.split(':');
  if (groups.length !== 2) return null;
  const hi = hex16(groups[0] ?? '');
  const lo = hex16(groups[1] ?? '');
  if (hi === null || lo === null) return null;
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

/** A parsed hostname: brackets off an IPv6 literal, lower case, no trailing dot. */
function hostOf(hostname: string): string {
  const bare = hostname.charCodeAt(0) === 91 && hostname.charCodeAt(hostname.length - 1) === 93 ? hostname.slice(1, -1) : hostname;
  const lower = bare.toLowerCase();
  return lower.charCodeAt(lower.length - 1) === 46 ? lower.slice(0, -1) : lower;
}

/** `*.content.localhost` with at least one label in front: a site's content host, not every `*.localhost`. */
function isContentLocalhost(hostname: string): boolean {
  const labels = hostOf(hostname).split('.');
  return labels.length >= 3 && labels[labels.length - 1] === 'localhost' && labels[labels.length - 2] === 'content';
}

function isLocalhostName(hostname: string): boolean {
  const labels = hostOf(hostname).split('.');
  return labels[labels.length - 1] === 'localhost';
}

/**
 * A literal address of this machine: `127.0.0.0/8`, `::1`, RFC1918 (`10/8`, `172.16/12`, `192.168/16`) and
 * link-local `169.254.0.0/16`, including IPv4-mapped IPv6. Only used from this file. Not `offline.ts`'s check.
 */
function isMachineAddress(hostname: string): boolean {
  const host = hostOf(hostname);
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const v4 = ipv4(host) ?? mappedIpv4(host);
  if (!v4) return false;
  const a = v4[0];
  const b = v4[1];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Whether a subframe of a site's page may load this address. The same predicate answers `will-frame-navigate` and a
 * subframe `will-redirect`: the page's own frames, the connected site, its `*.content.localhost` hosts, and public
 * http(s). This computer's other addresses are refused, including a localhost name the site did not declare.
 */
export function serverSubframeAllowed(address: string, allowlist: OriginAllowlist) {
  if (ownSubframe(address)) return true;
  const url = parse(address);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false;
  // The site this tab is connected to, before the machine-address refusal: a test server may be on localhost.
  if (allowlist.serverOf(url.origin)) return true;
  if (isContentLocalhost(url.hostname)) return true;
  if (isLocalhostName(url.hostname) || isMachineAddress(url.hostname)) return false;
  return true;
}

/**
 * An http(s) link for the system browser, with the userinfo removed. `null` when it cannot be parsed or is not
 * http(s). `log` is the origin and the path only: a password or a query must not be written down. Loopback is not
 * refused here; a top-level navigation to it stays `external` (`decide`).
 */
export function externalTarget(input: string): { href: string; log: string } | null {
  const url = parse(input);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  url.username = '';
  url.password = '';
  return { href: url.href, log: `${url.origin}${url.pathname}` };
}

/** Whether a subframe may load this address: the page's own frames, or an allowed origin. */
export function subframeAllowed(address: string, allowlist: OriginAllowlist) {
  return ownSubframe(address) || allowlist.allows(address);
}

/** `open-artifact://artifact/<id>`, `/a/<id>` or a bare id → the id. */
export function artifactIdOf(ref: unknown) {
  const text = String(ref ?? '').trim();
  const link = /^open-artifact:\/\/artifact\/([^/?#]+)/.exec(text);
  if (link) return decodeURIComponent(link[1]);
  const shell = /\/a\/([^/?#]+)/.exec(text);
  if (/^https?:\/\//.test(text) && shell) return decodeURIComponent(shell[1]);
  return /^[A-Za-z0-9_-]{1,80}$/.test(text) ? text : null;
}
