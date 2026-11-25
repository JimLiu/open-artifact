/**
 * The servers (the Open Artifact sites this computer is connected to) as the home page's switcher shows them, and the
 * person's changes to them: every one a call of the daemon's own routes, with its token, in this process. The settings
 * are the daemon's (shared by every app on this computer: `remote …` on the command line, the agent apps' plugins);
 * this app keeps no copy of them, only whether it asked once about automatic publishing (its own settings).
 *
 * | The switcher | The daemon's route |
 * | --- | --- |
 * | the list (name, address, account, reachable, default) | `remotes` |
 * | add a server: address and name, a code, waiting, cancel | `remotes.add` (`browse: false`), `remotes.add.wait`, `remotes.add.cancel` |
 * | choose one: only the default | `cloud.settings { default }` |
 * | the automatic publishing switch | `cloud.settings { publish }` |
 * | remove one | `remotes.remove` |
 *
 * "This Mac" is not a server one picks: it is the state while automatic publishing is off (the only remote is always
 * the default and cannot be cleared). Only https is taken; a plain http address is sent only once the person said so
 * (`insecureHttp`, the CLI's `--insecure-http`).
 *
 * Changes made elsewhere (the command line, another app) have no event of the daemon's: the list is read when the
 * switcher opens, after each change here, and every {@link POLL_MS} while connected.
 *
 * The page gets display data only: names, addresses, the account's name, states; never a token.
 */
import { LIBRARY_ROUTES } from '@open-artifact/protocol';

/** How often the list is read while connected, ms. */
export const POLL_MS = 3000;
/** A remote's name, as the daemon takes it (`REMOTE_NAME`). */
export const SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
/** How long one `remotes.add.wait` waits, ms (the daemon's longest is 60 s). */
const WAIT_MS = 20_000;

/**
 * An address the person typed: `{ host }` (its origin, https or http), or a throw. `insecure`: the person said a plain
 * http address is all right; without it one is answered `{ needsConfirm: 'http' }`.
 */
export function serverAddress(value, { insecure = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 300) throw new Error('not an address');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error('not an address');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('an address starts with https://');
  if (url.username || url.password) throw new Error('an address has no user or password in it');
  if (url.protocol === 'http:' && !insecure) return { host: url.origin, needsConfirm: 'http' };
  return { host: url.origin, insecure: url.protocol === 'http:' };
}

/** A name for a server, from its address (`oa.example.com` → `oa`), else `server`. */
export function suggestName(host, taken = []) {
  let base = 'server';
  try {
    const hostname = new URL(host).hostname;
    // An IP address names nothing: the default.
    const label = /^\[|^\d+(\.\d+){3}$/.test(hostname) ? '' : hostname.split('.')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+/, '');
    if (label && SERVER_NAME.test(label)) base = label.slice(0, 28);
  } catch {
    /* the default */
  }
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`;
  return name;
}

/** One remote of `remotes`, as the page shows it. */
function remoteView(remote) {
  const user = remote.user && typeof remote.user === 'object' ? remote.user.name || remote.user.email || remote.user.id || null : null;
  return {
    name: String(remote.name ?? ''),
    host: String(remote.host ?? ''),
    user: typeof user === 'string' ? user : null,
    signedIn: remote.signedIn === true,
    reachable: remote.reachable === true,
    connected: remote.connected === true,
    isDefault: remote.default === true,
    preset: remote.preset === true,
    insecure: remote.insecure === true,
    lastError: typeof remote.lastError === 'string' ? remote.lastError : null,
    published: Array.isArray(remote.artifacts) ? remote.artifacts.length : 0,
  };
}

export class Servers {
  /**
   * `library`: the daemon's Library API (`libraryClient`); `connected()`: whether the kit is connected now;
   * `asked()` / `setAsked()`: whether the person was asked once about automatic publishing (this app's setting);
   * `onChange(view)`; `log(line)`.
   */
  constructor({ library, connected, asked, setAsked, onChange, log, pollMs = POLL_MS }) {
    Object.assign(this, { library, connected, asked, setAsked, onChange, log, pollMs });
    this.remotes = [];
    this.cloud = { default: null, publish: 'manual' };
    this.presetProblem = null;
    /** The `desktop.settings` the daemon answers (`{ openInDesktop }`), or null when it has none (an older daemon). */
    this.desktop = null;
    /** Read once since connecting. */
    this.read = false;
    this.failure = null;
    /** A sign-in under way: `{ name, host, userCode, verificationUri, state: 'waiting' | 'done' | 'failed' | 'cancelled', error? }`. */
    this.adding = null;
    this.timer = null;
    this.key = '';
  }

  view() {
    const preset = this.remotes.find((r) => r.preset && !r.isDefault) ?? null;
    return {
      connected: this.connected(),
      read: this.read,
      remotes: this.remotes,
      defaultName: this.cloud.default,
      publish: this.cloud.publish === 'auto' ? 'auto' : 'manual',
      presetProblem: this.presetProblem,
      // A preset (a plugin's server setting, OPEN_ARTIFACT_REMOTE, preset.json) added a server that is not the default
      // now: the person's choice won; said so the switcher does not seem to have done nothing.
      presetOther: preset ? { name: preset.name, host: preset.host } : null,
      adding: this.adding,
      asked: this.asked() === true,
      openInDesktop: this.desktop ? this.desktop.openInDesktop === true : null,
      failure: this.failure,
    };
  }

  /** The origins of the sites in the list and whether each can be reached. */
  reachable() {
    return new Map(this.remotes.map((r) => [safeOrigin(r.host), r.reachable]).filter(([origin]) => origin));
  }

  changed() {
    const view = this.view();
    const key = JSON.stringify(view);
    if (key === this.key) return;
    this.key = key;
    this.onChange?.(view);
  }

  /** Reads the list (and `desktop.settings`) again. */
  async refresh() {
    if (!this.connected()) {
      this.read = false;
      this.changed();
      return this.view();
    }
    try {
      const out = await this.library.call('remotes');
      this.remotes = (Array.isArray(out?.remotes) ? out.remotes : []).map(remoteView).filter((r) => SERVER_NAME.test(r.name));
      this.cloud = { default: typeof out?.cloud?.default === 'string' ? out.cloud.default : null, publish: out?.cloud?.publish === 'auto' ? 'auto' : 'manual' };
      this.presetProblem = typeof out?.presetProblem === 'string' ? out.presetProblem : null;
      this.failure = null;
      this.read = true;
    } catch (error) {
      this.failure = String(error?.message ?? error);
    }
    try {
      const desktop = await this.library.call(LIBRARY_ROUTES.desktopSettings);
      this.desktop = { openInDesktop: desktop?.openInDesktop === true };
    } catch (error) {
      // An older daemon (shared with another app) has no such route: the setting is not offered.
      if (error?.status === 404 || error?.code === 'not_found') this.desktop = null;
    }
    this.changed();
    return this.view();
  }

  /** Reads the list now and every {@link POLL_MS} while connected. */
  start() {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.pollMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Adds a server: `remotes.add` (no browser opened: the switcher shows the code), then `remotes.add.wait` until the
   * person approved it on the site, refused it, or cancelled here. `insecure`: the person confirmed a plain http address.
   */
  async add({ host: typed, name, insecure = false }) {
    if (this.adding?.state === 'waiting') throw new Error('a server is being added already');
    const address = serverAddress(typed, { insecure: insecure === true });
    if (address.needsConfirm) return { needsConfirm: 'http', host: address.host };
    const remoteName = String(name ?? '').trim() || suggestName(address.host, this.remotes.map((r) => r.name));
    if (!SERVER_NAME.test(remoteName)) throw new Error('a name is letters, digits, - and _ (at most 32)');
    if (this.remotes.some((r) => r.name === remoteName)) throw new Error(`there is a server called ${remoteName} already`);
    const started = await this.library.call('remotes.add', { body: { name: remoteName, host: address.host, browse: false, ...(address.insecure ? { insecureHttp: true } : {}) } });
    this.adding = {
      name: remoteName,
      host: String(started?.host ?? address.host),
      userCode: String(started?.user_code ?? ''),
      verificationUri: String(started?.verification_uri_complete ?? started?.verification_uri ?? ''),
      state: 'waiting',
    };
    this.log(`servers: adding ${remoteName} (${this.adding.host}${address.insecure ? ', plain http as confirmed' : ''})`);
    this.changed();
    void this.waitFor(this.adding);
    return { name: remoteName, userCode: this.adding.userCode };
  }

  async waitFor(adding) {
    while (this.adding === adding && adding.state === 'waiting') {
      try {
        const out = await this.library.call('remotes.add.wait', { body: { name: adding.name, ms: WAIT_MS } });
        if (this.adding !== adding || adding.state !== 'waiting') return;
        if (out?.status === 'done') {
          this.adding = { ...adding, state: 'done' };
          this.log(`servers: ${adding.name} added`);
          await this.refresh();
          this.changed();
          return;
        }
      } catch (error) {
        if (this.adding !== adding || adding.state !== 'waiting') return;
        this.adding = { ...adding, state: 'failed', error: String(error?.message ?? error) };
        this.log(`servers: adding ${adding.name}: ${this.adding.error}`);
        this.changed();
        return;
      }
    }
  }

  /** The person cancelled the sign-in: the daemon stops waiting for the site. */
  async cancel() {
    const adding = this.adding;
    if (!adding) return false;
    this.adding = adding.state === 'waiting' ? { ...adding, state: 'cancelled' } : null;
    if (adding.state === 'waiting') {
      try {
        await this.library.call('remotes.add.cancel', { body: { name: adding.name } });
      } catch (error) {
        this.log(`servers: cancel ${adding.name}: ${error?.message ?? error}`);
      }
      this.log(`servers: adding ${adding.name} cancelled`);
    }
    this.adding = null;
    this.changed();
    return true;
  }

  /** Lets the finished (or failed) sign-in go from the switcher. */
  dismiss() {
    if (this.adding?.state === 'waiting') return false;
    this.adding = null;
    this.changed();
    return true;
  }

  /**
   * The person chose a server: only the default (automatic publishing stays as it is). Answers whether to ask, once,
   * about turning automatic publishing on.
   */
  async setDefault(name) {
    if (!SERVER_NAME.test(String(name)) || !this.remotes.some((r) => r.name === name)) throw new Error(`not a server: ${name}`);
    await this.library.call('cloud.settings', { body: { default: name } });
    await this.refresh();
    return { ask: this.shouldAsk() };
  }

  /** Whether the person is to be asked about automatic publishing now (once, while it is off). */
  shouldAsk() {
    return !this.asked() && this.cloud.publish !== 'auto' && (!!this.cloud.default || this.remotes.some((r) => r.isDefault));
  }

  /** The person answered the question (`on`: turn it on); never asked again. */
  async answerAsk(on) {
    this.setAsked(true);
    if (on === true) await this.setPublish(true);
    else this.changed();
    return this.view();
  }

  /** The automatic publishing switch. */
  async setPublish(on) {
    await this.library.call('cloud.settings', { body: { publish: on === true ? 'auto' : 'manual' } });
    return this.refresh();
  }

  /** Removes a server (`force`: also when artifacts are published there; they stay on this computer only). */
  async remove(name, force = false) {
    if (!SERVER_NAME.test(String(name)) || !this.remotes.some((r) => r.name === name)) throw new Error(`not a server: ${name}`);
    const out = await this.library.call('remotes.remove', { body: { name, force: force === true } });
    this.log(`servers: removed ${name}`);
    await this.refresh();
    return { removed: String(out?.removed ?? name), unlinked: Array.isArray(out?.unlinked) ? out.unlinked.length : 0 };
  }

  /** The address of a server's home page. */
  homeOf(name) {
    const remote = this.remotes.find((r) => r.name === name);
    if (!remote) throw new Error(`not a server: ${name}`);
    return { name: remote.name, origin: safeOrigin(remote.host) };
  }

  /** "Open agents' artifacts in this app" (`desktop.settings`): the person's switch. */
  async setOpenInDesktop(on) {
    const out = await this.library.call(LIBRARY_ROUTES.desktopSettings, { body: { openInDesktop: on === true } });
    this.desktop = { openInDesktop: out?.openInDesktop === true };
    this.log(`setting openInDesktop = ${this.desktop.openInDesktop}`);
    this.changed();
    return this.view();
  }
}

function safeOrigin(host) {
  try {
    return new URL(host).origin;
  } catch {
    return null;
  }
}
