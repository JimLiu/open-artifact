import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ServerArguments, ServerResults } from '../../src/contracts.ts';
import { errorInfo } from '../../src/errors.ts';
import type { ServersView } from '../../src/servers.ts';
import type { DialogProps, WordsProps } from './types.ts';
import type { Translate } from './words.ts';
// The servers switcher: the Open Artifact sites this computer is connected to, as the daemon keeps them (shared with
// the command line's `remote` and the agent apps' plugins). The title-bar button says where new artifacts go (「本机」
// while automatic publishing is off, else the default server), the switch next to it is automatic publishing; the panel
// lists the servers (address, account, reachable), chooses the default (only the default), adds one (address and name,
// then the site's code and a wait, cancellable), removes one (asked first) and opens a server's home page in a tab.
// Every change is a daemon call in the main process; this page gets display data only.
import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './icons.tsx';
import { unwrap } from './service.ts';
import { Confirm } from './ServicePanel.tsx';

const bridge = () => window.desktop;
export const serversDo = <K extends keyof ServerResults>(act: K, arg?: ServerArguments[K]) => unwrap(bridge().servers.do(act, arg));

/** The servers view, kept current (the main process reads the daemon's list every few seconds while connected). */
export function useServers() {
  const [view, setView] = useState<ServersView | null>(null);
  useEffect(() => {
    let live = true;
    const stop = bridge().servers.onChange((next) => live && setView(next));
    void bridge()
      .servers.get(false)
      .then((next) => live && setView((was) => was ?? next));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return view;
}

/** The default server's entry, or null. */
export const defaultOf = (view: ServersView | null) => view?.remotes?.find((remote) => remote.isDefault) ?? null;

/** Where new artifacts go, in words: 「本机」 while automatic publishing is off, else the default server's name. */
export function placeWord(t: Translate, view: ServersView | null) {
  const target = defaultOf(view);
  return view?.publish === 'auto' && target ? target.name : t('servers.local');
}

/** The button in the home page's heading, and the automatic publishing switch next to it. */
export function ServerButton({ t, view, onOpen }: WordsProps & { view: ServersView | null; onOpen(): void }) {
  const target = defaultOf(view);
  const auto = view?.publish === 'auto' && !!target;
  const word = placeWord(t, view);
  const [error, setError] = useState('');
  const flip = async () => {
    setError('');
    try {
      await serversDo('publish', { on: !auto });
    } catch (failure) {
      setError(errorInfo(failure).message);
    }
  };
  return (
    <span className="server-tools">
      <button
        type="button"
        className="server-button"
        data-testid="server-button"
        data-place={auto ? 'server' : 'local'}
        aria-haspopup="dialog"
        title={t('servers.button', { place: word })}
        onClick={onOpen}
      >
        <span className="server-dot" data-reachable={auto ? String(target.reachable) : 'local'} aria-hidden="true" />
        <span className="ellipsis">{word}</span>
        <span className="server-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {target && (
        <button
          type="button"
          role="switch"
          className="switch small"
          aria-checked={auto}
          aria-label={t('servers.autoLabel', { name: target.name })}
          title={`${t('servers.autoLabel', { name: target.name })} ${t('servers.autoHint')}${error ? ` · ${error}` : ''}`}
          data-testid="auto-publish-bar"
          onClick={() => void flip()}
        >
          <span aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/** The add form: address and name, http asked about first, then the site's code and the wait. */
function AddServer({ t, view, onDone }: WordsProps & { view: ServersView | null; onDone(): void }) {
  const adding = view?.adding ?? null;
  const [host, setHost] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [http, setHttp] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  const submit = async (insecure = false) => {
    setError('');
    try {
      const out = await serversDo('add', { host, name, insecure });
      if (out?.needsConfirm === 'http') setHttp(out.host);
      else setHttp(null);
    } catch (failure) {
      setHttp(null);
      setError(errorInfo(failure).message);
    }
  };
  const cancel = async () => {
    try {
      await serversDo('cancel');
    } catch {
      /* gone already */
    }
  };

  if (adding) {
    return (
      <div className="server-adding" data-testid="server-adding" data-state={adding.state}>
        {adding.state === 'waiting' && (
          <>
            <span className="confirm-title">{t('servers.waitingTitle', { name: adding.name })}</span>
            <span className="confirm-body">{t('servers.waitingBody', { host: adding.host })}</span>
            <span className="server-code" data-testid="server-code">
              {adding.userCode}
            </span>
            <span className="row-hint">
              <span className="server-spinner" aria-hidden="true" /> {t('servers.waiting')}
            </span>
            <div className="confirm-actions">
              <button type="button" className="button-quiet" data-testid="server-add-cancel" onClick={() => void cancel()}>
                {t('servers.cancel')}
              </button>
              <button type="button" className="button-dark" data-testid="server-approve-page" onClick={() => void serversDo('approve-page')}>
                {t('servers.approvePage')}
              </button>
            </div>
          </>
        )}
        {adding.state !== 'waiting' && (
          <>
            <span className="confirm-title">{t(`servers.added.${adding.state}`, { name: adding.name })}</span>
            {adding.error && <span className="row-error">{adding.error}</span>}
            <div className="confirm-actions">
              <button type="button" className="button-dark" data-testid="server-add-done" onClick={() => void serversDo('dismiss').then(onDone)}>
                {t('servers.ok')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <form
      className="server-add"
      data-testid="server-add"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      <label className="new-label" htmlFor="server-host">
        {t('servers.address')}
      </label>
      <input
        id="server-host"
        ref={field}
        className="text-field"
        data-testid="server-host"
        placeholder="https://"
        value={host}
        onChange={(event) => setHost(event.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <label className="new-label" htmlFor="server-name">
        {t('servers.name')}
      </label>
      <input
        id="server-name"
        className="text-field"
        data-testid="server-name"
        placeholder={t('servers.namePlaceholder')}
        value={name}
        onChange={(event) => setName(event.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <span className="row-hint">{t('servers.nameHint')}</span>
      {error && (
        <span className="row-error" role="alert" data-testid="server-add-error">
          {error}
        </span>
      )}
      {http ? (
        <Confirm
          t={t}
          testid="confirm-http"
          title={t('servers.httpTitle')}
          body={t('servers.httpBody', { host: http })}
          action={t('servers.httpYes')}
          cancel={t('servers.cancel')}
          focusCancel
          onCancel={() => setHttp(null)}
          onConfirm={() => void submit(true)}
        />
      ) : (
        <div className="confirm-actions">
          <button type="button" className="button-quiet" onClick={onDone}>
            {t('servers.cancel')}
          </button>
          <button type="submit" className="button-dark" data-testid="server-add-submit" disabled={!host.trim()}>
            {t('servers.addSubmit')}
          </button>
        </div>
      )}
    </form>
  );
}

/** The panel. `view`: the servers view; `onClose()`. */
export function ServerPanel({ t, view, onClose }: DialogProps & { view: ServersView | null }) {
  const [adding, setAdding] = useState(!!view?.adding);
  const [ask, setAsk] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ name: string; conflict: string | null } | null>(null);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void bridge().servers.get(true);
    panel.current?.focus();
  }, []);
  // A sign-in that made the new server the default: asked once about automatic publishing.
  const finished = view?.adding?.state === 'done' ? view.adding.name : null;
  useEffect(() => {
    if (finished && view && !view.asked && view.publish !== 'auto' && view.defaultName === finished) setAsk(finished);
  }, [finished, view]);

  const act = async <K extends keyof ServerResults>(name: K, arg?: ServerArguments[K]) => {
    setError('');
    try {
      return await serversDo(name, arg);
    } catch (failure) {
      setError(errorInfo(failure).message);
      return null;
    }
  };
  const choose = async (name: string) => {
    const out = await act('default', { name });
    if (out?.ask) setAsk(name);
  };
  const remove = async (name: string, force: boolean) => {
    setError('');
    try {
      await serversDo('remove', { name, force });
      setRemoving(null);
    } catch (failure) {
      setRemoving({ name, conflict: errorInfo(failure).message });
    }
  };
  const openHome = async (name: string) => {
    if (await act('home', { name })) onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (ask) void act('answer-ask', { on: false }).then(() => setAsk(null));
      else if (removing) setRemoving(null);
      else onClose();
    }
  };

  const remotes = view?.remotes ?? [];
  const target = defaultOf(view);
  const auto = view?.publish === 'auto' && !!target;
  const connected = view?.connected !== false;

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="service-panel server-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="servers-title"
        data-testid="server-panel"
        tabIndex={-1}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <div className="service-head">
          <h2 id="servers-title">{t('servers.title')}</h2>
          <button type="button" className="icon-button" aria-label={t('servers.close')} title={t('servers.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {!connected && <p className="service-note">{t('servers.offline')}</p>}

        <section className="service-section first" aria-label={t('servers.listTitle')} data-testid="server-list">
          {/* 「本机」 is where new artifacts go while automatic publishing is off: a state, not a server one picks. */}
          <div className="server-row" data-testid="server-local" data-current={String(!auto)}>
            <span className="server-dot" data-reachable="local" aria-hidden="true" />
            <span className="row-text">
              <span>{t('servers.local')}</span>
              <span className="row-hint">{auto ? t('servers.localOff') : t('servers.localOn')}</span>
            </span>
            {!auto && <span className="server-chip">{t('servers.now')}</span>}
          </div>
          {remotes.map((remote) => (
            <div
              className="server-row"
              key={remote.name}
              data-testid="server-row"
              data-name={remote.name}
              data-default={String(remote.isDefault)}
              data-reachable={String(remote.reachable)}
            >
              <button
                type="button"
                role="radio"
                className="server-pick"
                aria-checked={remote.isDefault}
                aria-label={t('servers.pick', { name: remote.name })}
                data-testid="server-pick"
                onClick={() => (remote.isDefault ? undefined : void choose(remote.name))}
              >
                <span aria-hidden="true" />
              </button>
              <span className="row-text">
                <span>
                  {remote.name}
                  {remote.isDefault && <span className="row-hint"> · {t('servers.default')}</span>}
                </span>
                <span className="row-hint ellipsis mono" title={remote.host}>
                  {remote.host}
                </span>
                <span className="row-hint">
                  <span className="server-dot inline" data-reachable={String(remote.reachable)} aria-hidden="true" />{' '}
                  {remote.reachable ? t('servers.reachable') : t('servers.unreachable')} ·{' '}
                  {remote.signedIn ? t('servers.account', { user: remote.user || t('servers.someone') }) : t('servers.signedOut')}
                  {remote.insecure ? ` · ${t('servers.insecure')}` : ''}
                </span>
              </span>
              <span className="server-actions">
                <button type="button" className="button-small" data-testid="server-home" onClick={() => void openHome(remote.name)}>
                  {t('servers.home')}
                </button>
                <button type="button" className="button-small" data-testid="server-remove" onClick={() => setRemoving({ name: remote.name, conflict: null })}>
                  {t('servers.remove')}
                </button>
              </span>
            </div>
          ))}
          {remotes.length === 0 && <span className="row-hint">{t('servers.none')}</span>}
          {remotes.length === 1 && <span className="row-hint">{t('servers.onlyOne')}</span>}
        </section>

        <section className="service-section" aria-label={t('servers.autoTitle')}>
          <div className="settings-row" data-testid="auto-publish-row">
            <span className="row-text">
              <span id="auto-publish-label">{target ? t('servers.autoLabel', { name: target.name }) : t('servers.autoNone')}</span>
              <span className="row-hint">{t('servers.autoHint')}</span>
            </span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={auto}
              aria-labelledby="auto-publish-label"
              data-testid="auto-publish"
              disabled={!target}
              onClick={() => void act('publish', { on: !auto })}
            >
              <span aria-hidden="true" />
            </button>
          </div>
          {view?.presetOther && (
            <p className="service-note" data-testid="server-preset">
              {t('servers.presetOther', { name: view.presetOther.name, host: view.presetOther.host })}
            </p>
          )}
          {view?.presetProblem && (
            <p className="row-error" data-testid="server-preset-problem">
              {t('servers.presetProblem', { message: view.presetProblem })}
            </p>
          )}
        </section>

        {error && (
          <p className="row-error" role="alert" data-testid="server-error">
            {error}
          </p>
        )}

        {ask && (
          <Confirm
            t={t}
            testid="confirm-auto"
            title={t('servers.askTitle', { name: ask })}
            body={t('servers.askBody')}
            action={t('servers.askYes')}
            cancel={t('servers.askNo')}
            onCancel={() => void act('answer-ask', { on: false }).then(() => setAsk(null))}
            onConfirm={() => void act('answer-ask', { on: true }).then(() => setAsk(null))}
          />
        )}
        {removing && (
          <Confirm
            t={t}
            testid="confirm-remove"
            title={t('servers.removeTitle', { name: removing.name })}
            body={removing.conflict ? removing.conflict : t('servers.removeBody')}
            extra={removing.conflict ? t('servers.removeForceBody') : null}
            action={removing.conflict ? t('servers.removeForce') : t('servers.remove')}
            cancel={t('servers.cancel')}
            focusCancel
            onCancel={() => setRemoving(null)}
            onConfirm={() => void remove(removing.name, !!removing.conflict)}
          />
        )}

        <section className="service-section">
          {adding || view?.adding ? (
            <AddServer t={t} view={view} onDone={() => setAdding(false)} />
          ) : (
            <button type="button" className="link-button" data-testid="server-add-open" disabled={!connected} onClick={() => setAdding(true)}>
              {t('servers.add')}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
