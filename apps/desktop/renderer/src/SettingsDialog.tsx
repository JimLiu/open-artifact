import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { SettingsSnapshot } from '../../src/contracts.ts';
import { errorInfo } from '../../src/errors.ts';
import type { RuntimeView } from '../../src/runtime.ts';
import type { ServersView } from '../../src/servers.ts';
import type { ServiceView } from '../../src/service.ts';
import type { SettingsValues } from '../../src/settings.ts';
import type { DialogProps, WordsProps } from './types.ts';
// The settings dialog: only what takes effect. General (the look, at once; the language, when the app opens again),
// Artifacts (where new ones go; whether agents' artifacts open in this app), Service and updates (the default server
// and the switcher too) (the service's state and its panel, the runtime and Check, the
// "check for updates" setting when this app may change it), Advanced (the profile folder, the versions).
import { useEffect, useRef, useState } from 'react';
import { defaultOf, serversDo } from './ServerSwitcher.tsx';
import { RuntimeRow } from './ServicePanel.tsx';
import { AppUpdateSettings } from './AppUpdate.tsx';
import { runtimeDo } from './service.ts';

const LOOKS = ['system', 'light', 'dark'] as const;
const LANGUAGES = ['system', 'zh-CN', 'en'];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={id} data-testid={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

/** The "check for updates" setting: a switch when this app may change it, else what is in effect and where from. */
function CheckSwitch({ t, runtime }: WordsProps & { runtime: RuntimeView | null }) {
  const [error, setError] = useState('');
  if (!runtime?.policy) return null;
  const { toggle, policy } = runtime;
  const source = t(`settings.policy.source.${policy.source}`);
  if (toggle === 'fixed') {
    return (
      <div className="settings-row" data-testid="auto-check" data-fixed="true">
        <span className="row-text">
          <span>{t('settings.autoCheck')}</span>
          <span className="row-hint">{policy.update === 'auto' ? t('settings.policy.auto', { source }) : t('settings.policy.off', { source })}</span>
        </span>
      </div>
    );
  }
  const on = toggle === 'on';
  const flip = async () => {
    setError('');
    try {
      await runtimeDo('checking', !on);
    } catch (failure) {
      setError(t('runtime.failed.policy', { message: errorInfo(failure).message }));
    }
  };
  return (
    <div className="settings-row" data-testid="auto-check">
      <span className="row-text">
        <span id="auto-check-label">{t('settings.autoCheck')}</span>
        <span className="row-hint">{t('settings.autoCheckHint')}</span>
        {error && (
          <span className="row-error" role="alert" data-testid="auto-check-error">
            {error}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={on}
        aria-labelledby="auto-check-label"
        data-testid="auto-check-switch"
        disabled={runtime.busy === 'policy'}
        onClick={() => void flip()}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

/** `settings`: the settings view (`desktop.settings.get()`, kept current through the state); `onService()`: the panel. */
export function SettingsDialog({
  t,
  settings,
  service,
  runtime,
  appUpdates,
  servers,
  onService,
  onServers,
  onClose,
}: DialogProps & {
  settings: SettingsSnapshot;
  service: ServiceView | null;
  runtime: RuntimeView | null;
  appUpdates: import('../../src/app-update.ts').AppUpdateView | null;
  servers: ServersView | null;
  onService(): void;
  onServers(): void;
}) {
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);
  useEffect(() => {
    void window.desktop.runtime.get(true);
  }, []);

  const set = async <K extends 'theme' | 'locale' | 'artifactsFolder'>(name: K, value: SettingsValues[K]) => {
    setError('');
    try {
      await window.desktop.settings.set(name, value);
    } catch (failure) {
      setError(
        t('settings.failed', { message: String(errorInfo(failure).message ?? failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }),
      );
    }
  };
  const choose = async () => {
    setError('');
    try {
      await window.desktop.settings.chooseFolder();
    } catch (failure) {
      setError(t('settings.failed', { message: String(errorInfo(failure).message ?? failure) }));
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const forcedTheme = !!settings.forced?.theme;
  const forcedLocale = !!settings.forced?.locale;
  const state = service?.state ?? 'reconnecting';
  const stateWord = t(`service.${state}`);
  const version = runtime?.running ?? service?.daemon?.version ?? settings.versions?.runtime ?? '';
  const serviceLine =
    state === 'running'
      ? t('settings.serviceLine', { state: stateWord, version, count: String(service?.apps?.length ?? 0) })
      : t('settings.serviceLineOff', { state: stateWord });
  const folder = settings.artifactsFolder;
  const target = defaultOf(servers);
  const serverLine = target
    ? t(servers?.publish === 'auto' ? 'settings.serverAuto' : 'settings.serverManual', { name: target.name, host: target.host })
    : t('settings.serverNone');
  // "Open agents' artifacts in this app": the daemon's setting (null: this daemon has none, not offered).
  const openInDesktop = servers?.openInDesktop ?? null;
  const flipOpen = async () => {
    setError('');
    try {
      await serversDo('open-in-desktop', { on: !openInDesktop });
    } catch (failure) {
      setError(t('settings.failed', { message: errorInfo(failure).message }));
    }
  };
  const versions = settings.versions ?? {};

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-testid="settings-dialog"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={onKeyDown}
      >
        <div className="settings-head">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button type="button" className="button-primary" data-testid="settings-done" onClick={onClose}>
            {t('settings.done')}
          </button>
        </div>
        <div className="settings-body">
          <Section id="settings-general" title={t('settings.general')}>
            <div className="settings-row">
              <span className="row-text">
                <span id="look-label">{t('settings.look')}</span>
                {forcedTheme && (
                  <span className="row-hint" data-testid="forced-theme">
                    {t('settings.forced.theme')}
                  </span>
                )}
              </span>
              <div role="radiogroup" aria-labelledby="look-label" className="segmented" data-testid="look">
                {LOOKS.map((look) => (
                  <button
                    key={look}
                    type="button"
                    role="radio"
                    aria-checked={settings.theme === look}
                    data-value={look}
                    disabled={forcedTheme}
                    onClick={() => void set('theme', look)}
                  >
                    {t(`settings.look.${look}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <span className="row-text">
                <label htmlFor="settings-language">{t('settings.language')}</label>
                {forcedLocale && (
                  <span className="row-hint" data-testid="forced-locale">
                    {t('settings.forced.locale')}
                  </span>
                )}
                {settings.restartNeeded && (
                  <span className="row-hint" data-testid="relaunch-note">
                    {t('settings.relaunchNote')}
                  </span>
                )}
              </span>
              {settings.restartNeeded && (
                <button type="button" className="button-outline" data-testid="relaunch" onClick={() => void window.desktop.relaunch()}>
                  {t('settings.relaunch')}
                </button>
              )}
              <select
                id="settings-language"
                className="select"
                data-testid="language"
                value={settings.locale}
                disabled={forcedLocale}
                onChange={(event) => void set('locale', event.target.value as SettingsValues['locale'])}
              >
                {LANGUAGES.map((locale) => (
                  <option key={locale} value={locale}>
                    {t(`settings.language.${locale}`)}
                  </option>
                ))}
              </select>
            </div>
          </Section>

          <Section id="settings-artifacts" title={t('settings.artifacts')}>
            <div className="settings-row">
              <span className="row-text">
                <span>{t('settings.folder')}</span>
                <span className="row-hint ellipsis" data-testid="folder" title={folder || settings.libraryFolder}>
                  {folder || t('settings.folderDefault', { path: settings.libraryFolder })}
                </span>
                <span className="row-hint">{t('settings.folderHint')}</span>
              </span>
              {folder && (
                <button type="button" className="button-quiet" data-testid="folder-reset" onClick={() => void set('artifactsFolder', '')}>
                  {t('settings.folderReset')}
                </button>
              )}
              <button type="button" className="button-outline" data-testid="folder-change" onClick={() => void choose()}>
                {t('settings.folderChange')}
              </button>
            </div>
            {openInDesktop !== null && (
              <div className="settings-row" data-testid="open-in-desktop-row">
                <span className="row-text">
                  <span id="open-in-desktop-label">{t('settings.openInDesktop')}</span>
                  <span className="row-hint">{t('settings.openInDesktopHint')}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={openInDesktop}
                  aria-labelledby="open-in-desktop-label"
                  data-testid="open-in-desktop"
                  onClick={() => void flipOpen()}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
            )}
          </Section>

          <AppUpdateSettings t={t} view={appUpdates} />
          <Section id="settings-shared" title={t('settings.shared')}>
            <div className="settings-row">
              <span className="row-text">
                <span>{t('settings.service')}</span>
                <span className="row-hint" data-testid="service-line">
                  {serviceLine}
                </span>
              </span>
              <button type="button" className="button-outline" data-testid="settings-manage" onClick={onService}>
                {t('settings.manage')}
              </button>
            </div>
            <div className="settings-row" data-testid="settings-server">
              <span className="row-text">
                <span>{t('settings.server')}</span>
                <span className="row-hint" data-testid="server-line">
                  {serverLine}
                </span>
              </span>
              <button type="button" className="button-outline" data-testid="settings-servers" onClick={onServers}>
                {t('settings.serversManage')}
              </button>
            </div>
            <RuntimeRow t={t} runtime={runtime} compact />
            <CheckSwitch t={t} runtime={runtime} />
          </Section>

          <Section id="settings-advanced" title={t('settings.advanced')}>
            <div className="settings-row">
              <span className="row-text">
                <span>{t('settings.home')}</span>
                <span className="row-hint ellipsis" data-testid="home-path" title={settings.home}>
                  {settings.home}
                </span>
                <span className="row-hint">{t('settings.homeHint')}</span>
              </span>
              <button type="button" className="button-outline" data-testid="reveal-home" onClick={() => void window.desktop.settings.revealHome()}>
                {t('settings.reveal')}
              </button>
            </div>
            <div className="settings-row">
              <span className="row-text">
                <span>{t('settings.versions')}</span>
                <span className="row-hint" data-testid="versions">
                  {t('settings.versionsLine', {
                    app: versions.app ?? '',
                    runtime: runtime?.running ?? versions.runtime ?? '',
                    electron: versions.electron ?? '',
                  })}
                </span>
              </span>
            </div>
          </Section>
          {error && (
            <p className="row-error" role="alert" data-testid="settings-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
