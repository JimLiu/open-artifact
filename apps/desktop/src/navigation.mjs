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
 * (`tabs.mjs`). In such a view (`decideServer`):
 * - an address on one of the sites (its pages, its sign-in): allowed; only those origins;
 * - a local artifact's Shell: opens a tab of it; the daemon's home page: the first tab; anything else local: blocked;
 * - any other http(s) address: the system browser; anything else: blocked.
 * Its subframes (`serverSubframeAllowed`): any http(s) address but this computer's own pages (the site's content
 * origin is not listed anywhere, its own CSP decides its frames), and the page's own frames.
 * Pure: the tests check it without Electron.
 */

/** A test for one origin or a CSP-style pattern (`http://*.frame.localhost:4123`). */
function matcherOf(entry) {
  let pattern;
  try {
    pattern = new URL(entry.replace('*.', 'wildcard-placeholder.'));
  } catch {
    return () => false;
  }
  const wildcard = entry.includes('*.');
  const suffix = wildcard ? pattern.hostname.replace(/^wildcard-placeholder/, '') : null;
  return (url) =>
    url.protocol === pattern.protocol &&
    url.port === pattern.port &&
    (wildcard ? url.hostname.endsWith(suffix) && url.hostname.length > suffix.length : url.hostname === pattern.hostname);
}

const parse = (address) => {
  try {
    return new URL(address);
  } catch {
    return null;
  }
};

export const httpish = (address) => /^https?:\/\//i.test(String(address ?? ''));

/** A subframe address with no origin of its own: the page made it. */
export const ownSubframe = (address) => address.startsWith('blob:') || address === 'about:srcdoc' || address === 'about:blank';

export class OriginAllowlist {
  constructor() {
    this.daemon = null;
    this.origins = [];
    this.matchers = [];
    this.servers = [];
  }

  /** The daemon's own origin (`http://127.0.0.1:<port>`), from its `daemon.json`. */
  setDaemon(url) {
    this.daemon = url ? new URL(url).origin : null;
    this.rebuild();
  }

  /** From an `embed.origins` answer or an `embed/origins` event: every local entry; remote ones are left out. */
  fromDaemon(result) {
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    this.listed = entries.length ? entries.filter((entry) => !entry.remote).map((entry) => entry.origin ?? entry.pattern).filter(Boolean) : [...(result?.origins ?? [])];
    this.rebuild();
  }

  /** The sites in `remotes` (each one's `host`): their origins, the only ones a server view loads. */
  setServers(hosts) {
    const origins = [];
    for (const host of Array.isArray(hosts) ? hosts : []) {
      const url = parse(host);
      if (url && (url.protocol === 'https:' || url.protocol === 'http:')) origins.push(url.origin);
    }
    this.servers = [...new Set(origins)];
  }

  /** The site's origin an address is on (one of `setServers`), or null; this computer's own pages never are. */
  serverOf(address) {
    const url = parse(address);
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || this.allows(address)) return null;
    return (this.servers ?? []).find((origin) => origin === url.origin) ?? null;
  }

  rebuild() {
    this.origins = [...new Set([...(this.daemon ? [this.daemon] : []), ...(this.listed ?? [])])];
    this.matchers = this.origins.map(matcherOf);
  }

  allows(address) {
    const url = parse(address);
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false;
    return this.matchers.some((matches) => matches(url));
  }
}

/** The artifact id of a Shell address (`/a/<id>`), or null. */
export function shellArtifactId(address) {
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
export function decide(address, { allowlist, current }) {
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
export function decideServer(address, { allowlist }) {
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

/** Whether a subframe of a site's page may load this address: its own frames, or any http(s) address not this computer's pages. */
export function serverSubframeAllowed(address, allowlist) {
  return ownSubframe(address) || (httpish(address) && !allowlist.allows(address));
}

/** Whether a subframe may load this address: the page's own frames, or an allowed origin. */
export function subframeAllowed(address, allowlist) {
  return ownSubframe(address) || allowlist.allows(address);
}

/** `open-artifact://artifact/<id>`, `/a/<id>` or a bare id → the id. */
export function artifactIdOf(ref) {
  const text = String(ref ?? '').trim();
  const link = /^open-artifact:\/\/artifact\/([^/?#]+)/.exec(text);
  if (link) return decodeURIComponent(link[1]);
  const shell = /\/a\/([^/?#]+)/.exec(text);
  if (/^https?:\/\//.test(text) && shell) return decodeURIComponent(shell[1]);
  return /^[A-Za-z0-9_-]{1,80}$/.test(text) ? text : null;
}
