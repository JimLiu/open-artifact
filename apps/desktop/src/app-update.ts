import { selectRelease, validateFeed, type DesktopRelease } from './app-update-feed.ts';
import type { UpdateProgress } from './app-update-download.ts';

export const FIRST_CHECK_MS = 15_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export type UpdateUnavailable = 'development' | 'platform' | 'test' | null;
export function updateAvailability(packaged: boolean, release: boolean, testMode: boolean, platform: string, arch: string): UpdateUnavailable {
  if (testMode) return 'test';
  if (platform !== 'darwin' || arch !== 'arm64') return 'platform';
  return packaged && release ? null : 'development';
}
export type AppUpdateAction = 'check' | 'download' | 'cancel' | 'install' | 'checking' | 'auto-download' | 'notes';
export interface AppUpdateView {
  current: string;
  unavailable: UpdateUnavailable;
  autoCheck: boolean;
  autoDownload: boolean;
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  release: DesktopRelease | null;
  checkedAt: string | null;
  error: string | null;
  progress: UpdateProgress | null;
}
export interface AppUpdateDeps {
  current: string;
  unavailable: UpdateUnavailable;
  preferences(): { autoCheck: boolean; autoDownload: boolean };
  save(name: 'autoCheck' | 'autoDownload', on: boolean): void;
  releases(signal: AbortSignal): Promise<unknown[]>;
  feed(url: string, signal: AbortSignal): Promise<unknown>;
  download(release: DesktopRelease, signal: AbortSignal, progress: (value: UpdateProgress) => void): void | Promise<void>;
  /** The existing quit guard runs `install` only after pending saves/confirmation. */
  confirmInstall(install: () => void): Promise<boolean>;
  install(): void;
  openNotes(url: string): void;
  changed(view: AppUpdateView): void;
  log(line: string): void;
}

/** Independent of runtime updates. Electron's adapter supplies networking and the native signed ZIP installer. */
export class AppUpdates {
  private deps: AppUpdateDeps;
  private state: AppUpdateView;
  private first?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private checking: Promise<AppUpdateView> | null = null;
  private installing = false;
  private abort = new AbortController();
  private downloadAbort: AbortController | null = null;
  private closed = false;

  constructor(deps: AppUpdateDeps) {
    this.deps = deps;
    this.state = { current: deps.current, unavailable: deps.unavailable, ...deps.preferences(), phase: 'idle', release: null, checkedAt: null, error: null, progress: null };
  }
  view(): AppUpdateView { return structuredClone(this.state); }
  private change(patch: Partial<AppUpdateView>) {
    if (this.closed) return;
    Object.assign(this.state, patch);
    this.deps.changed(this.view());
  }
  private requireAvailable() {
    if (this.closed || this.state.unavailable) throw new Error('Desktop updates are unavailable in this build');
  }
  start() {
    if (this.closed || this.state.unavailable || this.first || this.interval) return;
    const tick = () => { if (this.state.autoCheck) void this.check(); };
    this.first = setTimeout(tick, FIRST_CHECK_MS);
    this.interval = setInterval(tick, CHECK_INTERVAL_MS);
    this.first.unref();
    this.interval.unref();
  }
  setPreference(name: 'autoCheck' | 'autoDownload', on: boolean) {
    this.deps.save(name, on);
    this.change({ [name]: on });
    if (!this.state.unavailable && on) {
      if (name === 'autoCheck') void this.check();
      else if (this.state.phase === 'available') this.download();
    }
    return this.view();
  }
  check(): Promise<AppUpdateView> {
    this.requireAvailable();
    if (this.checking) return this.checking;
    if (['downloading', 'ready', 'installing'].includes(this.state.phase)) return Promise.resolve(this.view());
    this.change({ phase: 'checking', error: null, release: null });
    const run = (async () => {
      try {
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]);
        const release = selectRelease(await this.deps.releases(signal), this.state.current);
        if (release) validateFeed(await this.deps.feed(release.feed, signal), release);
        if (this.closed) return this.view();
        this.change({ release, phase: release ? 'available' : 'current', checkedAt: new Date().toISOString() });
        if (release && this.state.autoDownload) this.download();
      } catch (error) { this.failed(error); }
      return this.view();
    })().finally(() => { this.checking = null; });
    this.checking = run;
    return run;
  }
  download() {
    this.requireAvailable();
    const release = this.state.release;
    if (!release || !['available', 'error'].includes(this.state.phase)) return this.view();
    const abort = new AbortController();
    this.downloadAbort = abort;
    this.change({ phase: 'downloading', error: null, progress: { received: 0, total: release.size, stage: 'download' } });
    try {
      const pending = this.deps.download(release, AbortSignal.any([abort.signal, this.abort.signal]), progress => {
        if (this.downloadAbort === abort && !abort.signal.aborted && this.state.phase === 'downloading') this.change({ progress });
      });
      void Promise.resolve(pending).catch(error => { if (!abort.signal.aborted) this.failed(error); });
    } catch (error) { this.failed(error); }
    return this.view();
  }
  downloaded() {
    if (this.state.phase === 'downloading') this.change({ phase: 'ready', error: null, progress: null });
  }
  cancel() {
    if (this.state.phase !== 'downloading' || this.state.progress?.stage !== 'download') return false;
    this.downloadAbort?.abort(); this.downloadAbort = null;
    this.change({ phase: 'available', progress: null, error: null });
    return true;
  }
  noUpdate() {
    if (this.state.phase === 'downloading') this.failed(new Error('The update feed no longer offers this version; check again'));
  }
  failed(error: unknown) {
    this.downloadAbort?.abort(); this.downloadAbort = null;
    const message = error instanceof Error ? error.message : String(error);
    this.deps.log(`desktop update: ${message}`);
    this.change({ phase: 'error', error: message, progress: null });
  }
  async install() {
    this.requireAvailable();
    if (this.state.phase !== 'ready' || this.installing) return false;
    this.installing = true;
    try {
      return await this.deps.confirmInstall(() => {
        this.change({ phase: 'installing' });
        this.deps.install();
      });
    } catch (error) { this.failed(error); return false; }
    finally { this.installing = false; }
  }
  notes() {
    if (!this.state.release) return false;
    this.deps.openNotes(this.state.release.page);
    return true;
  }
  close() {
    this.closed = true;
    clearTimeout(this.first);
    clearInterval(this.interval);
    this.abort.abort();
    this.downloadAbort?.abort();
  }
}

export function hasAppUpdate(view: AppUpdateView | null) {
  return !!view?.release && ['available', 'downloading', 'ready', 'error'].includes(view.phase);
}
