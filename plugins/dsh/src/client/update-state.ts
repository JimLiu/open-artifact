/**
 * The state of updating dsh-open-artifact, and the run that installs a release: what updates.tsx and the page's update
 * panel ({@link pageUpdates}) draw. Here, without React, so the tests can run it.
 */
import type { PageUpdates } from '@open-artifact/library-page';
import { latestOf } from '@open-artifact/library-page/library';
import { PATHS, type PluginUpdate, type UpdateCheck } from '../shared/routes.ts';
import { routeUrl } from './api.ts';

export const NS = 'open-artifact-updates';
const HUB = Symbol.for('open-artifact/dsh-updates');
const DISMISSED_KEY = 'open-artifact.update.dismissed';
/** The first look, once the app has settled; then how often an app left open looks again. */
export const FIRST_CHECK_MS = 3_000;
export const CHECK_EVERY_MS = 6 * 60 * 60_000;
/** The longest reason the panel shows. */
const REASON_MAX = 240;

// ---------- the state, shared with whichever half comes next ----------

type Phase = 'idle' | 'running' | 'done' | 'failed';

/** How a failed update left the plugin: on its old version, or nobody knows, as the reply was lost. */
type Left = 'kept' | 'unknown';

/** Keep this shape: a half of another release can be running while this one draws. */
export interface UpdateState {
  updates: PluginUpdate[];
  phase: Phase;
  /** The version the run went to. */
  to: string;
  /** The install takes effect only after a restart. Only that restart clears it. */
  restart: boolean;
  /** Why the run stopped, and how it left the plugin. */
  failure: { plugin: string; message: string; left: Left } | null;
  /** The version whose offer was put away with Later. */
  dismissed: string;
}

interface Hub {
  state: UpdateState;
  listeners: Set<() => void>;
}

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) ?? '';
  } catch {
    return '';
  }
}

function hub(): Hub {
  const g = globalThis as unknown as Record<symbol, Hub | undefined>;
  return (g[HUB] ??= {
    state: { updates: [], phase: 'idle', to: '', restart: false, failure: null, dismissed: readDismissed() },
    listeners: new Set(),
  });
}

function set(patch: Partial<UpdateState>): void {
  const h = hub();
  h.state = { ...h.state, ...patch };
  for (const listener of [...h.listeners]) listener();
}

export const subscribe = (listener: () => void) => {
  const { listeners } = hub();
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
/** The state now (tests read it). */
export const updateState = (): UpdateState => hub().state;

// ---------- looking, and installing ----------

/** Ask the server half what is new; null when it does not say: the app may be between rows, or offline. */
async function readUpdates(): Promise<PluginUpdate[] | null> {
  try {
    const response = await fetch(routeUrl(PATHS.updates), { cache: 'no-store' });
    if (!response.ok) return null;
    const { updates } = (await response.json()) as UpdateCheck;
    return Array.isArray(updates) ? updates : null;
  } catch {
    return null;
  }
}

/** Look for what is new. A look that gets no answer changes nothing, and a run in progress is left alone. */
export async function look(): Promise<void> {
  const updates = await readUpdates();
  if (updates !== null && hub().state.phase !== 'running') set({ updates });
}

/** What the plugin manager's `installBundle` settles with. */
export interface InstallOutcome {
  application?: string;
  error?: { code?: string; diagnostic?: string; incompatible?: { name: string; version: string; requirements: Record<string, string> }[] };
}

type Answer<T> = { ok: true; value: T } | { ok: false; error: { message?: string } };

const failedOutcome = (outcome: InstallOutcome) => outcome.application === 'failed' || outcome.application === 'cancelled';

/** The app's `ctx.remote.pluginManager`. */
export interface PluginManagerRemote {
  installBundle(spec: string, options: { enabled: boolean; registry: string; requestId: string }): Promise<Answer<InstallOutcome>>;
  waitForInstall(requestId: string): Promise<Answer<InstallOutcome | null>>;
}

/** What went wrong, in the words of whatever refused it. */
export function reasonOf(outcome: InstallOutcome): string {
  const { error } = outcome;
  const refused = error?.incompatible?.[0];
  if (refused) {
    return `${refused.name}@${refused.version} needs ${Object.entries(refused.requirements)
      .map(([what, range]) => `${what} ${range}`)
      .join(', ')}`;
  }
  // A failed run's diagnostic is all of pnpm's output, progress first: the line that says what went wrong, else its last.
  const lines = (error?.diagnostic ?? '')
    .split('\n')
    .map((text) => text.trim())
    .filter(Boolean);
  const line = lines.find((text) => text.includes('ERR_')) ?? lines.at(-1);
  return (line ?? error?.code ?? outcome.application ?? 'unknown').slice(0, REASON_MAX);
}

/** One install, recovering the result when the reply was lost, and how a failure left the plugin. */
async function install(manager: PluginManagerRemote, plugin: PluginUpdate, requestId: string): Promise<{ outcome: InstallOutcome; left: Left }> {
  const answer = await manager.installBundle(plugin.spec, { enabled: plugin.enabled, registry: plugin.registry, requestId });
  if (answer.ok) return { outcome: answer.value, left: 'kept' };
  const again = await manager.waitForInstall(requestId);
  if (again.ok && again.value !== null) return { outcome: again.value, left: 'kept' };
  return { outcome: { application: 'failed', error: { diagnostic: answer.error.message ?? 'the app did not answer' } }, left: 'unknown' };
}

/** Installs what is offered, one release after another (there is normally one). */
export async function run(manager: PluginManagerRemote): Promise<void> {
  set({ phase: 'running', failure: null });
  // What the offer said may be old: the app's own Update, say, can have taken it since.
  const fresh = await readUpdates();
  if (fresh !== null) set({ updates: fresh });
  const plan = hub().state.updates;
  set({ to: latestOf(plan) });
  let restart = false;
  for (const [index, plugin] of plan.entries()) {
    let outcome: InstallOutcome;
    let left: Left = 'kept';
    try {
      ({ outcome, left } = await install(manager, plugin, `open-artifact-update-${Date.now()}-${index}`));
    } catch (error) {
      outcome = { application: 'failed', error: { diagnostic: (error as Error).message } };
      left = 'unknown';
    }
    // This very tarball is what the plugin already has: a run whose reply got lost the time before.
    const already = outcome.application === 'failed' && outcome.error?.code === 'already-installed';
    if (failedOutcome(outcome) && !already) {
      set({ phase: 'failed', failure: { plugin: plugin.name, message: reasonOf(outcome), left } });
      return void look();
    }
    restart ||= outcome.application === 'restart-required';
    set({ updates: hub().state.updates.filter((u) => u.name !== plugin.name) });
  }
  set({ restart: hub().state.restart || restart });
  // Nothing to do after all: the offer was all there was to say.
  if (plan.length === 0) close();
  else set({ phase: 'done' });
  void look();
}

/** The app's plugin manager, while it has one (`joinUpdates`). */
let pluginManager: PluginManagerRemote | undefined;

/** Starts updating; does nothing while a run is on, or with nothing to update. */
export function start(): void {
  const { phase, updates } = hub().state;
  if (phase === 'running' || updates.length === 0) return;
  if (pluginManager === undefined) return set({ phase: 'failed', failure: { plugin: updates[0]!.name, message: 'this app has no plugin manager', left: 'kept' } });
  void run(pluginManager);
}

/** Puts the offer of this version away: it folds to a line and leaves the sidebar quiet. */
export function later(): void {
  const version = latestOf(hub().state.updates);
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Then it comes back next time.
  }
  set({ dismissed: version });
}

/** Puts a run's result away. Whatever it left to update is offered again. */
export function close(): void {
  set({ phase: 'idle', failure: null });
}

/** Unfolds what Later folded. */
export function reopen(): void {
  try {
    localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Then it folds again next time.
  }
  set({ dismissed: '' });
}

// ---------- what it says ----------

export const zh = {
  available: 'Open Artifact 有新版本 {version}',
  current: '当前是 {version}。',
  update: '更新',
  'update.one': '把 Open Artifact 更新到 {version}',
  later: '稍后',
  busy: '正在更新…',
  done: '已更新到 {version}。',
  'done.session': '新开的会话会用新版本。',
  'done.restart': '退出 DSH 再重新打开后生效。',
  failed: 'Open Artifact 没有更新成功',
  'failed.kept': '它还是原来的版本。',
  'failed.unknown': '到插件页看一下它现在是哪个版本。',
  retry: '重试',
  close: '关闭',
  tag: '有新版本 {version}',
  show: '查看',
  'mark.update': '更新',
  'mark.running': '更新中',
  'mark.failed': '更新失败',
  'mark.restart': '待重启',
  'failed.tag': '更新失败，详情见 Open Artifact 页',
};

export const en: Record<keyof typeof zh, string> = {
  available: 'Open Artifact {version} is available',
  current: 'You have {version}.',
  update: 'Update',
  'update.one': 'Update Open Artifact to {version}',
  later: 'Later',
  busy: 'Updating…',
  done: 'Updated to {version}.',
  'done.session': 'New sessions use it.',
  'done.restart': 'Quit DSH and open it again to finish.',
  failed: 'Open Artifact did not update',
  'failed.kept': 'It stays on the version it was.',
  'failed.unknown': 'Check which version it is on, on the Plugins page.',
  retry: 'Try again',
  close: 'Close',
  tag: 'New version {version}',
  show: 'Show',
  'mark.update': 'Update',
  'mark.running': 'Updating',
  'mark.failed': 'Failed',
  'mark.restart': 'Restart',
  'failed.tag': 'Update failed: see Open Artifact',
};

export type Key = keyof typeof zh;
export type Translate = (key: Key, params?: Record<string, string>) => string;

const fill = (text: string, params?: Record<string, string>) => text.replace(/\{(\w+)\}/g, (all, name: string) => params?.[name] ?? all);
let current: Translate = (key, params) => fill(en[key] ?? key, params);
/** The update's words, in the app's language once {@link setTranslate} is called. */
export const translate: Translate = (key, params) => current(key, params);
/** Uses the app's dictionary (`locale.bind(NS)`). */
export function setTranslate(bound: (key: string, params?: Record<string, string>) => string): void {
  current = (key, params) => bound(key, params);
}


/** What the sidebar entry has to say, if anything. A run's result stays until it is closed; an offer goes with Later. */
export function markOf({ phase, updates, restart, dismissed }: UpdateState): Key | null {
  if (phase === 'running') return 'mark.running';
  if (phase === 'failed') return 'mark.failed';
  if (phase === 'done' && restart) return 'mark.restart';
  const latest = latestOf(updates);
  return latest !== '' && latest !== dismissed ? 'mark.update' : null;
}

/** The plugin manager a run uses: the app's, while it has one (joinUpdates). */
export function setPluginManager(manager: PluginManagerRemote | undefined): void {
  pluginManager = manager;
}

/** The update, as the page's panel (`UpdatePanel` of `@open-artifact/library-page`) draws and starts it. */
export const pageUpdates: PageUpdates = { getSnapshot: updateState, subscribe, start, later, close, reopen, t: translate };
