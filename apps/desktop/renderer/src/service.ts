import type { PageUpdates, UpdateState } from '@open-artifact/library-page';
import type { RuntimeResults, ServiceResults } from '../../src/contracts.ts';
import type { RuntimeView } from '../../src/runtime.ts';
import type { ServiceView } from '../../src/service.ts';
import type { Reply } from '../../src/types.ts';
import type { Translate } from './words.ts';
// The service (the daemon) and the runtime's updates, as the main process sends them: display data only (never the
// daemon's token). `useService()` and `useRuntime()` keep them current; `runtimeUpdates()` is the shared page's
// `PageUpdates` over them (the offer at the top of the library).
import { useEffect, useState } from 'react';

const bridge = () => window.desktop;

/** A bridge answer's value, or a throw with its words. */
export async function unwrap<T>(answer: Promise<Reply<T>>): Promise<T> {
  const out = await answer;
  if (!out || out.ok !== true) throw new Error(out?.error || 'no answer');
  return out.value;
}

export const serviceDo = <K extends keyof ServiceResults>(act: K, arg?: string) => unwrap(bridge().service.do(act, arg));
export const runtimeDo = <K extends keyof RuntimeResults>(act: K, arg?: boolean) => unwrap(bridge().runtime.do(act, arg));

/** The service view, kept current. */
export function useService() {
  const [view, setView] = useState<ServiceView | null>(null);
  useEffect(() => {
    let live = true;
    const stop = bridge().service.onChange((next) => live && setView(next));
    void bridge()
      .service.get(false)
      .then((next) => live && setView((was) => was ?? next));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return view;
}

/** The runtime view, kept current (read again when asked: `refresh`). */
export function useRuntime() {
  const [view, setView] = useState<RuntimeView | null>(null);
  useEffect(() => {
    let live = true;
    const stop = bridge().runtime.onChange((next) => live && setView(next));
    void bridge()
      .runtime.get(false)
      .then((next) => live && setView((was) => was ?? next));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return view;
}

/** "A, B and C" in the language's way. */
export function listOf(t: Translate, names: readonly string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(t('service.list'))}${t('service.and')}${names[names.length - 1]}`;
}

/** How long the daemon has run, from its `startedAt`. */
export function uptime(t: Translate, startedAt: string | null | undefined, now = Date.now()) {
  const at = Date.parse(startedAt ?? '');
  if (!Number.isFinite(at)) return '';
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t('service.uptime.now');
  if (minutes < 60) return t('service.uptime.minutes', { count: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('service.uptime.hours', { count: String(hours) });
  return t('service.uptime.days', { count: String(Math.floor(hours / 24)) });
}

/** A check's time, in the language's way. */
export function timeOf(t: Translate, at: string) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return at ?? '';
  try {
    return when.toLocaleString(t('time.locale'), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return when.toISOString();
  }
}

/** The runtime's line: the update state in words (one sentence), for the service panel and Settings. */
export function runtimeLine(t: Translate, rt: RuntimeView | null) {
  if (!rt) return '';
  // Not connected: what was read before may no longer be true (another daemon may run, with other settings).
  if (rt.unreadable === 'offline') return t('runtime.offline');
  if (rt.unreadable === 'unsupported') return t('runtime.unsupported');
  const parts: string[] = [];
  const policy = rt.policy;
  if (rt.pending) parts.push(t('runtime.pending', { version: rt.pending }));
  if (policy?.update === 'off') parts.push(t('runtime.off.machine'));
  else if (policy?.update === 'bundled') parts.push(t(policy.source === 'settings' ? 'runtime.off.bundled.settings' : 'runtime.off.bundled.adapter'));
  else if (rt.busy === 'checking') parts.push(t('runtime.checking'));
  else if (!rt.check) parts.push(t('runtime.never'));
  else if (rt.check.error) parts.push(t('runtime.checkFailed', { time: timeOf(t, rt.check.at), error: rt.check.error }));
  else if (rt.available) parts.push(`${t('runtime.available', { version: rt.available })} · ${t('runtime.checkedAt', { time: timeOf(t, rt.check.at) })}`);
  else if (!rt.pending) parts.push(t('runtime.upToDate', { time: timeOf(t, rt.check.at) }));
  if (rt.pin) parts.push(t('runtime.pin', { pin: rt.pin }));
  return parts.join(' · ');
}

/** The runtime's version as shown: the one running, marked when it is the one the app carries. */
export function runtimeVersion(t: Translate, rt: RuntimeView | null) {
  const version = rt?.running ?? rt?.carried ?? '';
  return `${t('runtime.version', { version })}${version && version === rt?.carried ? t('runtime.carriedNote') : ''}`;
}

const NO_STATE: UpdateState = Object.freeze({ updates: [], phase: 'idle', to: '', restart: false, failure: null, dismissed: '' });

/** Where the offer stands, for the shared page's update panel. */
export function updateState(rt: RuntimeView | null): UpdateState {
  if (!rt || !rt.policy) return NO_STATE;
  const offer = rt.available && rt.running ? [{ name: 'Open Artifact runtime', version: rt.running, latest: rt.available }] : [];
  if (rt.busy === 'updating') return { ...NO_STATE, updates: offer, phase: 'running', to: rt.available ?? '' };
  if (rt.failure?.act === 'updating')
    return { ...NO_STATE, updates: rt.canUpdate ? offer : [], phase: 'failed', failure: { plugin: 'runtime', message: rt.failure.message, left: 'kept' } };
  if (rt.pending && rt.pending !== rt.closedPending) return { ...NO_STATE, phase: 'done', to: rt.pending, restart: true };
  if (rt.canUpdate || (rt.busy && offer.length)) return { ...NO_STATE, updates: offer, dismissed: rt.dismissed ?? '' };
  return NO_STATE;
}

/**
 * The shared page's `PageUpdates` over the runtime view. `get()`: the latest view; `subscribe(listener)`; `t`; `restart()`:
 * the service's restart, with its confirmation (the service panel's).
 */
export function runtimeUpdates({
  get,
  subscribe,
  t,
  restart,
}: {
  get(): RuntimeView | null;
  subscribe(listener: () => void): () => void;
  t: Translate;
  restart(): void;
}): PageUpdates {
  let last: RuntimeView | null = null;
  let state = NO_STATE;
  return {
    getSnapshot() {
      const rt = get();
      if (rt !== last) {
        last = rt;
        const next = updateState(rt);
        state = JSON.stringify(next) === JSON.stringify(state) ? state : next;
      }
      return state;
    },
    subscribe,
    start: () => void runtimeDo('update').catch(() => {}),
    later: () => void runtimeDo('later'),
    close: () => void runtimeDo('close'),
    reopen: () => void runtimeDo('reopen'),
    restart,
    t: (key, params) => t(`upd.${key}`, params),
  };
}
