// The service panel: the daemon this app shares with the agent apps on this computer. What it runs (version, address,
// process, profile folder), the apps connected, the editors (type servers) running, the runtime and its updates; the
// person's restart, stop and start (each asked first, naming the other apps it affects), an editor's restart, the
// logs folder and `open-artifact doctor`. Every one of them runs in the main process; this page gets display data.
import { useEffect, useRef, useState } from 'react';
import { TypeIcon, typeStyle } from '@open-artifact/library-page';
import { CloseIcon } from './icons.jsx';
import { listOf, runtimeDo, runtimeLine, runtimeVersion, serviceDo, uptime } from './service.js';
import { typeName } from './words.js';

/** The status button in the home page's heading: the dot, the state, how many apps are connected. */
export function ServiceStatus({ t, service, onOpen }) {
  const state = service?.state ?? 'reconnecting';
  const count = state === 'running' ? (service?.apps?.length ?? 0) : 0;
  const label = t(`service.${state}`);
  return (
    <button type="button" className="service-status" data-testid="service-status" data-state={state} aria-haspopup="dialog" onClick={onOpen} title={t('service.button', { state: label })}>
      <span className="service-dot" data-state={state} aria-hidden="true" />
      <span>{count > 0 ? `${label} · ${t('service.apps', { count: String(count) })}` : label}</span>
    </button>
  );
}

/** The other apps connected now (this one's left out), as names. */
const othersOf = (service) => (service?.apps ?? []).filter((a) => !a.self).map((a) => a.title || a.harness);

/** The runtime's row: its version, where its updates stand, and Check. */
export function RuntimeRow({ t, runtime, compact }) {
  const [error, setError] = useState('');
  const check = async () => {
    setError('');
    try {
      await runtimeDo('check');
    } catch (failure) {
      setError(t('runtime.failed.checking', { message: failure.message }));
    }
  };
  const allowed = runtime?.policy && !runtime.unreadable && runtime.policy.update !== 'off' && runtime.policy.update !== 'bundled';
  return (
    <div className={compact ? 'settings-row' : 'service-runtime'} data-testid="runtime-row">
      <span className="row-text">
        <span>{runtimeVersion(t, runtime)}</span>
        <span className="row-hint" data-testid="runtime-line">
          {runtimeLine(t, runtime)}
        </span>
        {(error || (runtime?.failure && runtime.failure.act !== 'updating')) && (
          <span className="row-error" role="alert" data-testid="runtime-error">
            {error || t(`runtime.failed.${runtime.failure.act}`, { message: runtime.failure.message })}
          </span>
        )}
      </span>
      {allowed && (
        <button type="button" className="button-outline" data-testid="runtime-check" disabled={!runtime.canCheck} onClick={() => void check()}>
          {runtime.busy === 'checking' ? t('runtime.checking') : t('runtime.check')}
        </button>
      )}
    </div>
  );
}

function Confirm({ t, title, body, extra, action, onCancel, onConfirm, testid }) {
  const yes = useRef(null);
  useEffect(() => yes.current?.focus(), []);
  return (
    <div className="service-confirm" role="alertdialog" aria-label={title} data-testid={testid}>
      <span className="confirm-title">{title}</span>
      <span className="confirm-body">{body}</span>
      {extra && <span className="confirm-body">{extra}</span>}
      <div className="confirm-actions">
        <button type="button" className="button-quiet" onClick={onCancel}>
          {t('service.cancel')}
        </button>
        <button type="button" ref={yes} className="button-dark" data-testid={`${testid}-yes`} onClick={onConfirm}>
          {action}
        </button>
      </div>
    </div>
  );
}

const STATUS_ORDER = { fail: 0, warn: 1, ok: 2, 'n/a': 3 };

function Doctor({ t, doctor }) {
  if (!doctor) return null;
  if (doctor.running) return <p className="service-note" data-testid="doctor">{t('service.doctorRunning')}</p>;
  if (doctor.error) return <p className="row-error" role="alert" data-testid="doctor">{t('service.doctorFailed', { message: doctor.error })}</p>;
  const report = doctor.report;
  const findings = [...report.findings].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  return (
    <div className="service-doctor" data-testid="doctor" data-ok={String(report.ok)}>
      <span className="service-note">{t('service.doctorDone', { ok: String(report.counts.ok), warn: String(report.counts.warn), fail: String(report.counts.fail) })}</span>
      <ul>
        {findings.map((f, i) => (
          <li key={`${f.id}-${i}`} data-status={f.status}>
            <span className="doctor-chip" data-status={f.status}>
              {t(`service.doctorStatus.${f.status}`)}
            </span>
            <span className="doctor-text">
              {f.message}
              {f.fix && <span className="row-hint">{f.fix}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The panel. `service`, `runtime`: the views; `ask`: open with a question already asked (`restart`, from the update
 * offer's "Restart now"); `onClose()`.
 */
export function ServicePanel({ t, service, runtime, ask: asked = null, onClose }) {
  const [ask, setAsk] = useState(asked);
  const [error, setError] = useState('');
  const [stopOthers, setStopOthers] = useState(null);
  const panel = useRef(null);

  // Read again while open: the apps and the editors change.
  useEffect(() => {
    void window.desktop.service.get(true);
    void window.desktop.runtime.get(true);
  }, []);
  useEffect(() => {
    panel.current?.focus();
  }, []);

  const state = service?.state ?? 'reconnecting';
  const daemon = service?.daemon ?? null;
  const others = othersOf(service);
  const busy = service?.busy ?? null;

  const act = async (name, arg) => {
    setError('');
    try {
      return await serviceDo(name, arg);
    } catch (failure) {
      setError(t('service.actionFailed', { message: failure.message }));
      return null;
    }
  };
  const restart = async () => {
    setAsk(null);
    await act('restart');
  };
  const stop = async () => {
    setAsk(null);
    const out = await act('stop');
    if (out) setStopOthers(out.others);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (ask) setAsk(null);
      else onClose();
    }
  };

  const title = t(`service.${state}`);
  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="service-panel" role="dialog" aria-modal="true" aria-labelledby="service-title" data-testid="service-panel" data-state={state} tabIndex={-1} ref={panel} onKeyDown={onKeyDown}>
        <div className="service-head">
          <span className="service-dot big" data-state={state} aria-hidden="true" />
          <h2 id="service-title">{title}</h2>
          {state === 'running' && daemon && <span className="service-uptime">{uptime(t, daemon.startedAt)}</span>}
          <button type="button" className="icon-button" aria-label={t('service.close')} title={t('service.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {busy && <p className="service-note" data-testid="service-busy">{t(`service.busy.${busy}`)}</p>}
        {state === 'stopped' && !busy && (
          <p className="service-note" data-testid="service-stopped">
            {t('service.stoppedBody')}
            {stopOthers && stopOthers.length > 0 && ` ${t('service.stopOthers', { apps: listOf(t, stopOthers.map((o) => o.title || o.harness)) })}`}
          </p>
        )}
        {state === 'elsewhere' && <p className="service-note" data-testid="service-elsewhere">{t('service.elsewhereBody')}</p>}
        {state === 'reconnecting' && !busy && <p className="service-note">{t('service.reconnectingBody')}</p>}
        {state === 'failed' && (
          <p className="row-error" role="alert" data-testid="service-failure">
            {t('service.failedBody', { message: service?.failure ?? '' })}
          </p>
        )}

        {daemon && (
          <dl className="service-facts" data-testid="service-facts">
            <dt>{t('service.version')}</dt>
            <dd data-testid="service-version">{t(daemon.version === service.carried ? 'service.carried' : 'service.shared', { version: daemon.version })}</dd>
            <dt>{t('service.address')}</dt>
            <dd className="mono" data-testid="service-address">
              {t('service.process', { address: daemon.address, pid: String(daemon.pid ?? '') })}
            </dd>
            <dt>{t('service.home')}</dt>
            <dd className="ellipsis" title={service.home}>
              {service.home}
            </dd>
          </dl>
        )}
        {!daemon && service?.home && (
          <dl className="service-facts">
            <dt>{t('service.home')}</dt>
            <dd className="ellipsis" title={service.home}>
              {service.home}
            </dd>
          </dl>
        )}

        {state === 'running' && (
          <section className="service-section" aria-label={t('service.appsTitle')} data-testid="service-apps">
            <span className="section-label">{t('service.appsTitle')}</span>
            {service.apps.map((app) => (
              <div className="service-row" key={app.connection} data-harness={app.harness} data-self={String(app.self)}>
                <span className="service-dot" data-state="running" aria-hidden="true" />
                <span className="row-grow">{app.title}</span>
                <span className="row-hint">{app.self ? t('service.thisApp') : app.sessions > 0 ? t('service.sessions', { count: String(app.sessions) }) : t('service.noSessions')}{app.polling ? t('service.polling') : ''}</span>
              </div>
            ))}
          </section>
        )}

        {state === 'running' && (
          <section className="service-section" aria-label={t('service.serversTitle')} data-testid="service-servers">
            <span className="section-label">{t('service.serversTitle')}</span>
            {service.servers.length === 0 && <span className="row-hint">{t('service.noServers')}</span>}
            {service.servers.map((server) => {
              const name = typeName(t, server.type, server.type);
              return (
                <div className="service-row" key={server.type} data-type={server.type} data-pid={server.pid ?? ''}>
                  <span className="server-swatch" style={typeStyle(server.type)} aria-hidden="true">
                    <TypeIcon type={server.type} size={11} />
                  </span>
                  <span className="row-grow">
                    {name}
                    {server.state !== 'running' && <span className="row-hint"> · {t(`service.serverState.${server.state}`)}</span>}
                  </span>
                  <button type="button" className="button-small" aria-label={t('service.restartTypeLabel', { name })} data-testid="restart-type" onClick={() => void act('restart-type', server.type)}>
                    {t('service.restartType')}
                  </button>
                </div>
              );
            })}
          </section>
        )}

        <section className="service-section" aria-label={t('runtime.title')}>
          <span className="section-label">{t('runtime.title')}</span>
          <RuntimeRow t={t} runtime={runtime} />
        </section>

        {error && (
          <p className="row-error" role="alert" data-testid="service-error">
            {error}
          </p>
        )}

        {/* While a question is asked, the findings make room for it. */}
        {!ask && <Doctor t={t} doctor={service?.doctor} />}

        <span className="service-spacer" />

        {ask === 'restart' && (
          <Confirm
            t={t}
            testid="confirm-restart"
            title={others.length ? t('service.restartAsk', { apps: listOf(t, others) }) : t('service.restartAskAlone')}
            body={others.length ? t('service.restartBody') : t('service.restartBodyAlone')}
            action={t('service.restart')}
            onCancel={() => setAsk(null)}
            onConfirm={() => void restart()}
          />
        )}
        {ask === 'stop' && (
          <Confirm
            t={t}
            testid="confirm-stop"
            title={t('service.stopAsk')}
            body={t('service.stopBody')}
            extra={others.length ? t('service.stopOthers', { apps: listOf(t, others) }) : null}
            action={t('service.stop')}
            onCancel={() => setAsk(null)}
            onConfirm={() => void stop()}
          />
        )}

        <div className="service-links">
          {(state === 'running' || state === 'reconnecting' || state === 'failed') && (
            <>
              <button type="button" className="link-button" data-testid="service-restart" disabled={!!busy} onClick={() => setAsk('restart')}>
                {t('service.restart')}
              </button>
              {state === 'running' && (
                <button type="button" className="link-button" data-testid="service-stop" disabled={!!busy} onClick={() => setAsk('stop')}>
                  {t('service.stop')}
                </button>
              )}
            </>
          )}
          {state === 'stopped' && (
            <button type="button" className="link-button" data-testid="service-start" disabled={!!busy} onClick={() => void act('start')}>
              {t('service.start')}
            </button>
          )}
          {state === 'elsewhere' && (
            <button type="button" className="link-button" data-testid="service-connect" disabled={!!busy} onClick={() => void act('start')}>
              {t('service.connect')}
            </button>
          )}
          <button type="button" className="link-button" data-testid="service-logs" onClick={() => void act('logs')}>
            {t('service.logs')}
          </button>
          <button type="button" className="link-button" data-testid="service-doctor" disabled={!!service?.doctor?.running} onClick={() => void act('doctor')}>
            {t('service.doctor')}
          </button>
        </div>
      </div>
    </div>
  );
}
