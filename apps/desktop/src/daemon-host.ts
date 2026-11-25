import type { Harness } from '@open-artifact/harness-kit';
import type { DaemonState } from '@open-artifact/protocol';
import type { DaemonHostInfo, DaemonHostMarker } from './types.ts';
/**
 * Where the home's daemon lives: the files it runs from (never `ps`). The daemon runs with an executable and a runtime
 * folder, and later loads the types from that folder by path and starts its type servers with that executable. When
 * those are inside an app made by "install as app" (`installed-apps.ts`), moving that package (a rename in the
 * Finder, a rebuild, an uninstall) leaves a daemon that can no longer load a type it has not loaded yet ("The type …
 * is not installed").
 *
 * What is known of it, without asking the system:
 *
 * - **The marker** `<home>/desktop/daemon-host.json` (`{ pid, startedAt, exe, bin, bundlePath, installId }`): an
 *   artifact's app writes it when its own start of the daemon is the daemon that runs (`artifact-app.ts`: the start
 *   ran, with an executable or an entry inside its own package, and `daemon.json`'s pid is the process it started). It
 *   counts only while `daemon.json` names the same pid (and `startedAt`) and that process is alive: any other start of
 *   the daemon since makes it stale by itself.
 * - **`<home>/runtimes.json`**: the daemon registers its own runtime folder there when it starts (`harness: 'daemon'`,
 *   one entry per folder; the newest `seenAt` not before `daemon.json`'s `startedAt` is the running one's). An app that
 *   says the same folder in its `hello` takes that entry over (its own `harness`), so this is not always there.
 * - **The daemon's own word** (`daemonHostLive`): its `runtime.status` names its own runtime folder (`source: 'own'`)
 *   while that folder's entry file is there.
 *
 * `daemonHost(home)`: `{ pid, paths, marker }` while a daemon runs for the home, else null. `paths`: the executable and
 * the entry of a marker that counts, and the runtime folder `runtimes.json` names for it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathWithin, processAlive, writeJsonAtomicSync } from './installed-apps.ts';

/** `<home>/desktop/daemon-host.json`. */
export const daemonHostFileOf = (home: string) => join(home, 'desktop', 'daemon-host.json');

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/** `daemon.json` of the home when its process is alive (no health asked: only where it lives matters here), else null. */
export function runningDaemon(home: string, alive: (pid: number) => boolean = processAlive) {
  const state = readJson<DaemonState>(join(home, 'daemon.json'));
  return !!state && Number.isInteger(state.pid) && alive(state.pid) ? state : null;
}

/** The marker of `home` when it names the running daemon (`daemon`: its `daemon.json`), else null. */
export function validMarker(home: string, daemon: Partial<DaemonState> | null, alive: (pid: number) => boolean = processAlive) {
  const marker = readJson<DaemonHostMarker>(daemonHostFileOf(home));
  if (!marker || !daemon || marker.pid !== daemon.pid || !alive(marker.pid)) return null;
  if (marker.startedAt && daemon.startedAt && marker.startedAt !== daemon.startedAt) return null;
  return marker;
}

/** The runtime folder the running daemon registered (`harness: 'daemon'`, the newest since it started), or null. */
export function daemonRuntimeDir(home: string, daemon: Partial<DaemonState> | null) {
  const runtimes = readJson<{ runtimes?: { harness: string; dir: string; seenAt?: string }[] }>(join(home, 'runtimes.json'))?.runtimes;
  if (!Array.isArray(runtimes) || !daemon) return null;
  const since = Date.parse(daemon.startedAt ?? '') || 0;
  const mine = runtimes
    .filter((entry) => entry?.harness === 'daemon' && typeof entry.dir === 'string' && (Date.parse(entry.seenAt ?? '') || 0) >= since)
    .sort((a, b) => (Date.parse(b.seenAt ?? '') || 0) - (Date.parse(a.seenAt ?? '') || 0));
  return mine[0]?.dir ?? null;
}

/** Where the home's daemon lives: `{ pid, paths, marker }`, or null when none runs. */
export function daemonHost(home: string, { alive = processAlive }: { alive?: (pid: number) => boolean } = {}) {
  const daemon = runningDaemon(home, alive);
  if (!daemon) return null;
  const marker = validMarker(home, daemon, alive);
  const paths: string[] = [];
  if (marker?.exe) paths.push(marker.exe);
  if (marker?.bin) paths.push(marker.bin);
  const dir = daemonRuntimeDir(home, daemon);
  if (dir) paths.push(dir);
  return { pid: daemon.pid, paths: [...new Set(paths)], marker };
}

/**
 * {@link daemonHost}, with the daemon's own word on its runtime folder when `harness` is connected to that very daemon
 * (`harness.runtime.status()`; skipped when it cannot say).
 */
export async function daemonHostLive(
  home: string,
  harness: Harness | null,
  { alive = processAlive, timeoutMs = 3000 }: { alive?: (pid: number) => boolean; timeoutMs?: number } = {},
) {
  const host = daemonHost(home, { alive });
  if (!host || !harness?.connected || harness.client?.state?.pid !== host.pid || !harness.features?.includes?.('runtime.update')) return host;
  try {
    const status = await Promise.race([
      harness.runtime.status(),
      new Promise<never>((_, fail) => setTimeout(() => fail(new Error('timed out')), timeoutMs).unref?.()),
    ]);
    const own = (Array.isArray(status?.runtimes) ? status.runtimes : []).find((entry) => entry?.source === 'own' && typeof entry.dir === 'string');
    if (own && typeof own.dir === 'string' && !host.paths.includes(own.dir)) host.paths.push(own.dir);
  } catch {
    // The files' word only.
  }
  return host;
}

/** Writes the marker (an artifact's app, once its own start of the daemon is the daemon that runs). */
export function writeDaemonHost(home: string, marker: DaemonHostMarker) {
  writeJsonAtomicSync(daemonHostFileOf(home), marker);
}

/**
 * Whether the daemon lives in an app's package that is gone (renamed, moved or removed since it started), so that it
 * needs a restart: a file its marker names is gone, or a path it lives at that is gone is (as written) inside the
 * install folder `installDir`. A daemon whose files are gone anywhere else (an agent's plugin updated under it) is not
 * this module's to restart: the daemon switches runtimes by itself, once idle.
 */
export function daemonHostGone(host: DaemonHostInfo | null, installDir: string | null = null) {
  if (!host) return false;
  const gone = (path: string | undefined) => typeof path === 'string' && !!path && !existsSync(path);
  if (host.marker && (gone(host.marker.exe) || gone(host.marker.bin))) return true;
  return !!installDir && host.paths.some((path) => gone(path) && pathWithin(path, installDir));
}
