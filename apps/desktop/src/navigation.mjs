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

/** Whether a subframe may load this address: the page's own frames, or an allowed origin. */
export function subframeAllowed(address, allowlist) {
  return ownSubframe(address) || allowlist.allows(address);
}
