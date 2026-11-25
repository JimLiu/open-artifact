// "Install as app" for one artifact (`installed-apps.mjs` in the main process): what its app is now, asked once when
// the dialog opens (and again after each call, or every second while another call works on it), and what can be done
// from there. Opened from a card's menu, a sidebar row's, a tab's, or File → Install as App….
//
// - unavailable: why, in words (a development build says only the packaged app installs);
// - available: the name and the folder it goes to; where the package cannot be cloned, the room a copy takes and a
//   box to say yes to it, then the install asked again with `allowCopy`; a name taken meanwhile is shown and asked again;
// - installing / busy: what is going on;
// - installed: Open, Show in Finder, Uninstall… (asked first), and Update when the desktop app changed since;
// - needsRepair: why; Repair when its place holds its own package (or nothing), Remove Record always.
import { useCallback, useEffect, useRef, useState } from 'react';

/** Bytes as the Finder would say them (MB, one decimal past 10 GB…). */
const sizeOf = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '?';
  const mb = bytes / 1e6;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
};
/** A code's words (`installApp.<group>.<code>`), its code when there are none. */
const reasonOf = (t, group, code) => {
  const key = `installApp.${group}.${code}`;
  const word = t(key);
  return word === key ? code : word;
};

export function InstallAppDialog({ t, artifact, onClose }) {
  const apps = window.desktop.apps;
  const [state, setState] = useState(null);
  /** The call under way (`installing`, `updating`, `uninstalling`, `repairing`, `forgetting`), else null. */
  const [working, setWorking] = useState(null);
  /** What the last call came to: `{ kind: 'info' | 'error', text }`. */
  const [message, setMessage] = useState(null);
  const [copyOk, setCopyOk] = useState(false);
  const [asking, setAsking] = useState(false);
  const dialog = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const ask = useCallback(async () => {
    const out = await apps.state(artifact.id);
    if (!alive.current) return null;
    if (out?.ok) setState(out.value);
    else setMessage({ kind: 'error', text: t('installApp.error', { message: out?.error ?? '?' }) });
    return out?.ok ? out.value : null;
  }, [apps, artifact.id, t]);
  useEffect(() => void ask(), [ask]);
  // Another call works on it (another window's, a refresh at start): asked again until it is done.
  const pending = state?.state === 'installing' || state?.state === 'busy';
  useEffect(() => {
    if (!pending || working) return undefined;
    const timer = setInterval(() => void ask(), 1000);
    return () => clearInterval(timer);
  }, [pending, working, ask]);
  useEffect(() => {
    dialog.current?.querySelector('.button-primary:not(:disabled), button:not(:disabled)')?.focus();
  }, [state?.state, asking]);

  /** Runs a call; its answer's `state` (when there is one) becomes the dialog's. */
  const call = async (kind, run, after) => {
    setWorking(kind);
    setMessage(null);
    try {
      const out = await run();
      if (!alive.current) return;
      if (!out?.ok) return setMessage({ kind: 'error', text: t('installApp.error', { message: out?.error ?? '?' }) });
      const value = out.value ?? {};
      if (value.state && typeof value.state === 'object') setState(value.state);
      after?.(value);
    } finally {
      if (alive.current) setWorking(null);
    }
  };

  const install = () =>
    call('installing', () => apps.install(artifact.id, { confirmedName: state.suggestedName, allowCopy: state.needsCopy && copyOk }), (value) => {
      if (value.nameChanged) setMessage({ kind: 'info', text: t('installApp.nameChanged', { name: value.state.suggestedName }) });
      else if (value.conflict) setMessage({ kind: 'error', text: t('installApp.conflict', { name: state.suggestedName }) });
      else if (value.error) setMessage({ kind: 'error', text: t('installApp.error', { message: value.error }) });
      else if (value.needsCopy) setCopyOk(false);
    });
  const rebuilt = (done) => (value) => {
    if (value.rebuilt) setMessage({ kind: 'info', text: t(done) });
    else if (value.stillRunning) setMessage({ kind: 'error', text: t('installApp.stillRunning') });
    else if (value.daemonInUse) setMessage({ kind: 'error', text: t('installApp.daemonInUse') });
    else if (value.needsCopy) setMessage({ kind: 'error', text: t('installApp.rebuildNeedsCopy') });
    else if (value.notOurs) setMessage({ kind: 'error', text: t('installApp.repair.replaced') });
    else if (value.error) setMessage({ kind: 'error', text: t('installApp.error', { message: value.error }) });
  };
  const uninstall = () => {
    setAsking(false);
    return call('uninstalling', () => apps.uninstall(artifact.id, state.installId), (value) => {
      if (value.stillRunning) setMessage({ kind: 'error', text: t('installApp.stillRunning') });
      else if (value.daemonInUse) setMessage({ kind: 'error', text: t('installApp.daemonInUse') });
      else if (value.error) setMessage({ kind: 'error', text: t('installApp.error', { message: value.error }) });
      else if (value.removed) setMessage({ kind: 'info', text: value.left === 'not-ours' ? `${t('installApp.uninstalled')} ${t('installApp.leftNotOurs')}` : t('installApp.uninstalled') });
    });
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (asking) setAsking(false);
      else if (!working) onClose();
    }
  };

  const shown = working ? 'working' : (state?.state ?? 'checking');
  const button = (testid, label, run, { primary = false, disabled = false } = {}) => (
    <button type="button" className={primary ? 'button-primary' : 'button-quiet'} data-testid={testid} onClick={run} disabled={!!working || disabled}>
      {label}
    </button>
  );
  const field = (label, value, testid) => (
    <div className="install-field">
      <span className="new-label">{label}</span>
      <span className="install-value" data-testid={testid}>
        {value}
      </span>
    </div>
  );

  let body = null;
  let actions = [];
  if (working) {
    const word = { installing: 'installApp.installing', updating: 'installApp.updating', uninstalling: 'installApp.uninstalling', repairing: 'installApp.repairing' }[working] ?? 'installApp.checking';
    body = <p className="install-note">{t(word)}</p>;
  } else if (!state) {
    body = <p className="install-note">{t('installApp.checking')}</p>;
  } else if (state.state === 'unavailable') {
    body = (
      <p className="install-note" data-testid="install-app-reason">
        {reasonOf(t, 'unavailable', state.reason)}
      </p>
    );
  } else if (state.state === 'available') {
    body = (
      <>
        <p className="install-note">{t('installApp.intro', { title: artifact.title })}</p>
        {field(t('installApp.name'), state.suggestedName, 'install-app-name')}
        {field(t('installApp.location'), state.installDir, 'install-app-location')}
        {state.needsCopy && (
          <div className="install-copy" data-testid="install-app-copy">
            <span>{t('installApp.needsCopy', { size: sizeOf(state.copyBytes) })}</span>
            <label>
              <input type="checkbox" data-testid="install-app-copy-ok" checked={copyOk} onChange={(event) => setCopyOk(event.target.checked)} />
              {t('installApp.confirmCopy')}
            </label>
          </div>
        )}
      </>
    );
    actions = [button('install-app-install', t('installApp.install'), () => void install(), { primary: true, disabled: state.needsCopy && !copyOk })];
  } else if (state.state === 'installing') {
    body = <p className="install-note">{t('installApp.installing')}</p>;
  } else if (state.state === 'busy') {
    body = <p className="install-note">{t(state.task === 'uninstalling' ? 'installApp.uninstalling' : 'installApp.updating')}</p>;
  } else if (state.state === 'installed') {
    body = (
      <>
        <p className="install-note">{t('installApp.installed', { name: state.displayName })}</p>
        {field(t('installApp.location'), state.bundlePath, 'install-app-path')}
        {state.stale && (
          <p className="install-note" data-testid="install-app-stale">
            {t('installApp.stale')}
          </p>
        )}
        {state.running && (
          <p className="install-note" data-testid="install-app-running">
            {t('installApp.running')}
          </p>
        )}
        {asking && (
          <div className="service-confirm" role="alertdialog" data-testid="install-app-confirm">
            <span className="confirm-body">{t('installApp.uninstallConfirm', { name: state.displayName })}</span>
            <div className="confirm-actions">
              <button type="button" className="button-quiet" data-testid="install-app-confirm-cancel" onClick={() => setAsking(false)}>
                {t('installApp.cancel')}
              </button>
              <button type="button" className="button-dark" data-testid="install-app-confirm-yes" onClick={() => void uninstall()}>
                {t('installApp.uninstallYes')}
              </button>
            </div>
          </div>
        )}
      </>
    );
    actions = [
      button('install-app-uninstall', t('installApp.uninstall'), () => setAsking(true), { disabled: asking }),
      button('install-app-reveal', t('installApp.reveal'), () => void call('revealing', () => apps.reveal(artifact.id, state.installId))),
      ...(state.stale ? [button('install-app-update', t('installApp.update'), () => void call('updating', () => apps.refresh(artifact.id, state.installId), rebuilt('installApp.updated')))] : []),
      button('install-app-open', t('installApp.open'), () => void call('opening', () => apps.open(artifact.id, state.installId)), { primary: true }),
    ];
  } else if (state.state === 'needsRepair') {
    body = (
      <>
        <p className="install-note">{t('installApp.needsRepair')}</p>
        <p className="install-note" data-testid="install-app-reason">
          {reasonOf(t, 'repair', state.reason)}
        </p>
        <p className="install-note install-hint">{t('installApp.forgetHint')}</p>
      </>
    );
    actions = [
      button('install-app-forget', t('installApp.forget'), () => void call('forgetting', () => apps.forget(artifact.id, state.installId))),
      ...(state.repairable ? [button('install-app-repair', t('installApp.repair'), () => void call('repairing', () => apps.repair(artifact.id, state.installId), rebuilt('installApp.repaired')), { primary: true })] : []),
    ];
  }

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && !working && onClose()}>
      <div className="new-dialog install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title" data-testid="install-app-dialog" data-state={shown} data-artifact={artifact.id} ref={dialog} onKeyDown={onKeyDown}>
        <h2 id="install-title">{t('installApp.title')}</h2>
        {body}
        {message && (
          <p className={message.kind === 'error' ? 'new-error' : 'install-note install-done'} role={message.kind === 'error' ? 'alert' : 'status'} data-testid="install-app-message" data-kind={message.kind}>
            {message.text}
          </p>
        )}
        <div className="new-actions">
          {button('install-app-close', t('installApp.close'), onClose)}
          <span className="new-spacer" />
          {actions}
        </div>
      </div>
    </div>
  );
}
