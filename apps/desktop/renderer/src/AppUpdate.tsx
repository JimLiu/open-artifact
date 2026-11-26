import { useEffect, useRef, useState } from 'react';
import type { AppUpdateAction, AppUpdateView } from '../../src/app-update.ts';
import { hasAppUpdate } from '../../src/app-update.ts';
import { errorInfo } from '../../src/errors.ts';
import type { WordsProps } from './types.ts';
import { timeOf, unwrap } from './service.ts';

export function useAppUpdates() {
  const [view, setView] = useState<AppUpdateView | null>(null);
  useEffect(() => {
    let live = true;
    const stop = window.desktop.updates.onChange(next => { if (live) setView(next); });
    void window.desktop.updates.get().then(next => { if (live) setView(was => was ?? next); });
    return () => { live = false; stop(); };
  }, []);
  return view;
}

const percentOf = (view: AppUpdateView) => view.progress ? Math.min(100, Math.floor(100 * view.progress.received / view.progress.total)) : 0;
const bytesOf = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function SidebarUpdateButton({ t, view, onOpen }: WordsProps & { view: AppUpdateView | null; onOpen(): void }) {
  if (!hasAppUpdate(view) || !view?.release) return null;
  return (
    <button type="button" className="app-update-button" data-testid="app-update-button" onClick={onOpen} aria-haspopup="dialog"
      title={t(view.phase === 'ready' ? 'appUpdate.notice.ready' : 'appUpdate.notice.available', { version: view.release.version })}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M8 2v8m-3-3 3 3 3-3M3 10v3h10v-3" />
      </svg>
      {view.phase === 'downloading' ? `${percentOf(view)}%` : t('appUpdate.sidebar')}
    </button>
  );
}

function DownloadProgress({ t, view }: WordsProps & { view: AppUpdateView }) {
  if (view.phase !== 'downloading' || !view.progress) return null;
  const { received, total, stage } = view.progress;
  return (
    <div className="app-update-progress" data-testid="app-update-progress" aria-live="polite">
      <div className="app-update-progress-text">
        <span>{t(stage === 'verify' ? 'appUpdate.verifying' : 'appUpdate.progress', { percent: String(percentOf(view)) })}</span>
        <span>{bytesOf(received)} / {bytesOf(total)}</span>
      </div>
      <progress max={total} value={received} aria-label={t('appUpdate.progressLabel')} />
    </div>
  );
}

/** A sidebar click starts the download and opens this window; closing it keeps a download running. */
export function AppUpdateDialog({ t, view, onClose }: WordsProps & { view: AppUpdateView | null; onClose(): void }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => { box.current?.focus(); }, []);
  const act = async (action: AppUpdateAction) => {
    setError('');
    try { await unwrap(window.desktop.updates.do(action)); }
    catch (failure) { setError(errorInfo(failure).message ?? String(failure)); }
  };
  if (!view) return null;
  return (
    <div className="scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="app-update-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title"
        data-testid="app-update-dialog" tabIndex={-1} ref={box} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
        <div className="settings-head">
          <h2 id="update-title">{view.release ? t('appUpdate.available', { version: view.release.version }) : t('appUpdate.title')}</h2>
          <button type="button" className="button-quiet" aria-label={t('appUpdate.close')} onClick={onClose}>×</button>
        </div>
        <p className="row-hint">{t(`appUpdate.phase.${view.phase}`, { version: view.release?.version ?? '' })}</p>
        {view.release?.notes && <div className="app-update-notes">{view.release.notes}</div>}
        <DownloadProgress t={t} view={view} />
        {(error || view.error) && <p className="row-error" role="alert">{error || view.error}</p>}
        <div className="app-update-actions">
          <button type="button" className="button-quiet" data-testid="app-update-later" onClick={onClose}>{t('appUpdate.later')}</button>
          {view.phase === 'downloading' && view.progress?.stage === 'download' && (
            <button type="button" className="button-outline" data-testid="app-update-cancel" onClick={() => void act('cancel')}>{t('appUpdate.cancel')}</button>
          )}
          {view.release && ['available', 'error'].includes(view.phase) && (
            <button type="button" className="button-primary" data-testid="app-update-dialog-download" onClick={() => void act('download')}>{t('appUpdate.download')}</button>
          )}
          {view.phase === 'ready' && (
            <button type="button" className="button-primary" data-testid="app-update-dialog-install" onClick={() => void act('install')}>{t('appUpdate.install')}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Desktop application updates have their own preferences; the daemon's runtime controls remain separate. */
export function AppUpdateSettings({ t, view }: WordsProps & { view: AppUpdateView | null }) {
  const [error, setError] = useState('');
  if (!view) return null;
  const { phase, release, unavailable } = view;
  const busy = ['checking', 'downloading', 'installing'].includes(phase);
  const act = async (action: AppUpdateAction, on?: boolean) => {
    setError('');
    try { await unwrap(window.desktop.updates.do(action, on)); }
    catch (failure) { setError(errorInfo(failure).message ?? String(failure)); }
  };
  const toggle = (id: string, action: 'checking' | 'auto-download', on: boolean) => (
    <button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby={`${id}-label`}
      data-testid={id} onClick={() => void act(action, !on)}><span aria-hidden="true" /></button>
  );
  return (
    <section className="settings-section" aria-labelledby="app-update-heading" data-testid="app-update-settings" data-phase={phase}>
      <h3 id="app-update-heading">{t('appUpdate.title')}</h3>
      <div className="settings-row">
        <span className="row-text">
          <span>{t('appUpdate.version', { version: view.current })}</span>
          <span className="row-hint" data-testid="app-update-line" role="status">
            {t(unavailable ? `appUpdate.unavailable.${unavailable}` : `appUpdate.phase.${phase}`, { version: release?.version ?? '' })}
          </span>
          {view.checkedAt && <span className="row-hint">{t('appUpdate.checked', { time: timeOf(t, view.checkedAt) })}</span>}
        </span>
        <button type="button" className="button-outline" data-testid="app-update-check" disabled={!!unavailable || busy || phase === 'ready'}
          onClick={() => void act('check')}>{t('appUpdate.check')}</button>
        {release && (phase === 'available' || phase === 'error') && (
          <button type="button" className="button-outline" data-testid="app-update-download" onClick={() => void act('download')}>
            {t('appUpdate.download')}
          </button>
        )}
        {phase === 'ready' && (
          <button type="button" className="button-outline" data-testid="app-update-install" onClick={() => void act('install')}>
            {t('appUpdate.install')}
          </button>
        )}
      </div>
      <DownloadProgress t={t} view={view} />
      <div className="settings-row">
        <span className="row-text"><span id="app-update-auto-check-label">{t('appUpdate.autoCheck')}</span>
          <span className="row-hint">{t('appUpdate.autoCheckHint')}</span></span>
        {toggle('app-update-auto-check', 'checking', view.autoCheck)}
      </div>
      <div className="settings-row">
        <span className="row-text"><span id="app-update-auto-download-label">{t('appUpdate.autoDownload')}</span>
          <span className="row-hint">{t('appUpdate.autoDownloadHint')}</span></span>
        {toggle('app-update-auto-download', 'auto-download', view.autoDownload)}
      </div>
      {release && (
        <div className="settings-row">
          <span className="row-text">
            <span>{t('appUpdate.available', { version: release.version })}</span>
            {release.notes && <details><summary>{t('appUpdate.notes')}</summary><p className="app-update-notes">{release.notes}</p></details>}
          </span>
          <button type="button" className="button-quiet" data-testid="app-update-notes" onClick={() => void act('notes')}>{t('appUpdate.github')}</button>
        </div>
      )}
      {(error || view.error) && <p className="row-error" role="alert" data-testid="app-update-error">{error || view.error}</p>}
    </section>
  );
}
