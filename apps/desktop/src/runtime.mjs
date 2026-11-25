/**
 * The runtime's updates as the app shows them: the runtime that runs and the one the app carries, the update policy
 * and where it comes from, a pin, the last check, a newer runtime downloaded and waiting for a restart, and the
 * person's Check, Update and the "check for updates" setting.
 *
 * - Status and Update go over the Harness API (`harness.runtime.status()`, `harness.runtime.update()`). The daemon
 *   refuses Update when updates are off for the computer or the person set `bundled`; the app does not offer it then.
 * - Check has no Harness API call: it is the command line's `runtime status --json --check` (`service.mjs`'s `runCli`),
 *   which asks the registry and records the answer where the daemon reads it; the status is read again after it. It
 *   is not run when updates are off for the computer or `bundled` (an Update it found could not be made).
 * - The setting (`runtime.update` in the Open Artifact home's `settings.json`) is the command line's
 *   `runtime policy prompt|bundled --json`: a person-only command, run because the person clicked it here; it is
 *   refused inside an agent's session, and that refusal is shown as it is. The switch speaks only `prompt` (on: a
 *   newer runtime is offered at the top of the library, nothing installs by itself) and `bundled` (off: no check, no
 *   offer); under `auto` or the computer's switch the setting is shown, not changed here.
 * - The daemon's own background check sends `runtime/update`; the status is read again then.
 *
 * What the page is sent is picked field by field from the daemon's answers.
 */
import { errorLine, jsonOf, runCli } from './service.mjs';

const str = (value, max = 300) => (typeof value === 'string' ? value.slice(0, max) : '');
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const version = (value) => (typeof value === 'string' && VERSION.test(value) ? value : null);

/** `a` is newer than `b` (x.y.z; a pre-release is older than its release). */
export function newer(a, b) {
  if (!a) return false;
  if (!b) return true;
  const parse = (v) => {
    const [core, pre] = v.split(/[-+]/, 2);
    return { parts: core.split('.').map(Number), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] > y.parts[i];
  if (x.pre === y.pre) return false;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  return x.pre > y.pre;
}

/** The runtime status as the page shows it. */
export function statusView(status) {
  if (!status || typeof status !== 'object') return null;
  const policy = status.policy && typeof status.policy === 'object' ? status.policy : {};
  const check = status.check && typeof status.check === 'object' ? status.check : null;
  return {
    running: version(status.running),
    selected: status.selected ? { version: version(status.selected.version), source: str(status.selected.source, 20) } : null,
    policy: { update: str(policy.update, 20) || 'prompt', source: str(policy.source, 20) || 'default' },
    pin: str(status.pin, 100) || null,
    check: check ? { at: str(check.at, 40), available: version(check.available), error: str(check.error, 500) || null } : null,
    pending: version(status.pending),
  };
}

/**
 * The runtime side. `harness`: the kit; `runtimeDir`, `profile`: for the command line; `carried`: the version this
 * app carries; `onChange(view)`; `cli`: `runCli` (tests replace it).
 */
export class RuntimeUpdates {
  constructor({ harness, runtimeDir, profile, carried, onChange = () => {}, log = () => {}, cli = runCli }) {
    this.harness = harness;
    this.runtimeDir = runtimeDir;
    this.profile = profile;
    this.carried = carried;
    this.onChange = onChange;
    this.log = log;
    this.cli = cli;
    this.status = null;
    /** Why the status could not be read (not connected, an older daemon). */
    this.unreadable = null;
    /** `checking`, `updating`, `policy` while one runs. */
    this.busy = null;
    /** The last Check, Update or setting change asked for here that failed, as `{ act, message }`. */
    this.failure = null;
    /** The version an Update asked for here installed. */
    this.installed = null;
    /** The version whose offer was put away with Later, and the waiting install put away with Close. */
    this.dismissed = '';
    this.closedPending = '';
    this.closed = false;
  }

  /** The newer runtime the registry has, newer than what runs and what would start (null: none known). */
  available() {
    const s = this.status;
    const found = s?.check?.available ?? null;
    if (!found) return null;
    if (!newer(found, s.running) || (s.selected?.version && !newer(found, s.selected.version))) return null;
    return found;
  }

  /** Whether this app may check and update: not when the computer's switch is off or the person said `bundled`. */
  allowed() {
    const policy = this.status?.policy?.update;
    return !!policy && policy !== 'off' && policy !== 'bundled';
  }

  view() {
    const s = this.status;
    const policy = s?.policy ?? null;
    return {
      carried: this.carried,
      running: s?.running ?? null,
      selected: s?.selected ?? null,
      policy,
      pin: s?.pin ?? null,
      check: s?.check ?? null,
      available: this.available(),
      pending: s?.pending ?? null,
      installed: this.installed,
      busy: this.busy,
      failure: this.failure,
      unreadable: this.unreadable,
      // Only while the status is read from a connected daemon: one read before may not hold any more.
      canCheck: !!s && !this.unreadable && this.allowed() && !this.busy,
      canUpdate: !!s && !this.unreadable && this.allowed() && !this.busy && !!this.available(),
      /** The switch "check for updates": `on`/`off` it may change, or `fixed` (shown with its source). */
      toggle: !policy ? null : policy.source === 'machine' || policy.update === 'auto' ? 'fixed' : policy.update === 'bundled' ? 'off' : 'on',
      dismissed: this.dismissed,
      closedPending: this.closedPending,
    };
  }

  changed() {
    if (!this.closed) this.onChange(this.view());
  }

  /** Reads the status again. */
  async refresh() {
    if (!this.harness.connected) {
      this.unreadable = 'offline';
      return this.changed();
    }
    try {
      this.status = statusView(await this.harness.runtime.status());
      this.unreadable = null;
    } catch (error) {
      this.unreadable = error?.code === 'unsupported' ? 'unsupported' : 'offline';
      this.log(`runtime: status: ${error?.message ?? error}`);
    }
    this.changed();
  }

  async run(name, work) {
    if (this.busy) throw new Error(`${this.busy} is under way`);
    this.busy = name;
    this.failure = null;
    this.changed();
    try {
      return await work();
    } catch (error) {
      this.failure = { act: name, message: String(error?.message ?? error) };
      this.log(`runtime: ${name} failed: ${this.failure.message}`);
      throw error;
    } finally {
      this.busy = null;
      await this.refresh();
    }
  }

  /** The person's Check: the command line asks the registry; the answer (or its failure) is in the status. */
  check() {
    return this.run('checking', async () => {
      if (!this.allowed()) throw new Error('Updates are off here; nothing was checked.');
      if (this.unreadable) throw new Error('Not connected to the service; nothing was checked.');
      const { code, stdout, stderr } = await this.cli({ runtimeDir: this.runtimeDir, profile: this.profile, args: ['runtime', 'status', '--json', '--check'] });
      const out = jsonOf(stdout);
      if (code !== 0 || !out) throw new Error(errorLine(stderr) || `runtime status exited ${code}`);
      const check = out.check ?? null;
      this.log(`runtime: checked: ${check?.error ? `failed: ${check.error}` : check?.available ? `${check.available} is available` : 'up to date'}`);
      return check;
    });
  }

  /** The person's Update: the daemon downloads the newer runtime; it takes effect when the service restarts. */
  update() {
    return this.run('updating', async () => {
      const result = await this.harness.runtime.update();
      this.installed = version(result?.installed);
      this.closedPending = '';
      this.log(`runtime: update: ${str(result?.message, 500)}`);
      return { installed: this.installed, pending: result?.pending === true };
    });
  }

  /** The switch "check for updates": on is `prompt`, off is `bundled` (the person's setting, through the command line). */
  setChecking(on) {
    return this.run('policy', async () => {
      if (this.view().toggle === 'fixed') throw new Error('This setting is not changed here.');
      const word = on ? 'prompt' : 'bundled';
      const { code, stdout, stderr } = await this.cli({ runtimeDir: this.runtimeDir, profile: this.profile, args: ['runtime', 'policy', word, '--json'] });
      const out = jsonOf(stdout);
      if (code !== 0 || !out?.update) throw new Error(errorLine(stderr) || errorLine(stdout) || `runtime policy exited ${code}`);
      this.log(`runtime: policy ${word}: in effect ${out.update} (${out.source})`);
      return { update: str(out.update, 20), source: str(out.source, 20) };
    });
  }

  later() {
    this.dismissed = this.available() ?? '';
    this.changed();
  }

  /** Unfolds what Later folded. */
  reopen() {
    this.dismissed = '';
    this.changed();
  }

  /** Puts away the "downloaded, restart to finish" panel (the service panel and Settings still say it). */
  closeDone() {
    this.closedPending = this.status?.pending ?? this.installed ?? '';
    this.failure = null;
    this.changed();
  }

  /** The daemon's `runtime/update` event (its background check found or installed one). */
  event() {
    void this.refresh();
  }

  close() {
    this.closed = true;
  }
}
