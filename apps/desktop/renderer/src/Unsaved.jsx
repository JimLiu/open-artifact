// What the window's page draws about unsaved work and lost folders:
//
// - `UnsavedDialog`: the main process's question (`state.ask`) before work that is not saved is let go: a tab's close,
//   the app's quit (every such tab named), a Reload of a tab kept as it was. The same question as the service panel's
//   (`Confirm`), on a scrim of its own; the artifact's view makes room for it (the overlay).
// - `MissingFolder`: a tab whose artifact's folder is gone (moved, renamed or deleted outside Open Artifact): where the
//   library still has it, Relocate… (the folder picked with the system's dialog, the library told, the tab opened from
//   there) and Remove from Library (the library's delete: the record goes to the trash, with Undo; no file is touched).
import { useEffect, useState } from 'react';
import { TypeIcon, typeStyle, usePage } from '@open-artifact/library-page';
import { Confirm } from './ServicePanel.jsx';
import { listOf } from './service.js';

const ACTION = { close: 'unsaved.close', quit: 'unsaved.quit', reload: 'unsaved.reload' };

export function UnsavedDialog({ t, ask }) {
  const answer = (yes) => void window.desktop.answer(ask.id, yes);
  const names = ask.names ?? [];
  const title =
    ask.kind === 'quit' ? t('unsaved.quitTitle') : t(ask.kind === 'reload' ? 'unsaved.reloadTitle' : 'unsaved.closeTitle', { title: names[0] ?? '' });
  const body =
    ask.kind === 'quit'
      ? t('unsaved.quitBody', { names: listOf(t, names), have: names.length > 1 ? 'have' : 'has' })
      : t(ask.kind === 'reload' ? 'unsaved.reloadBody' : 'unsaved.closeBody');
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.id]);
  return (
    <div className="scrim" data-testid="unsaved-scrim">
      <div className="unsaved-dialog" role="dialog" aria-modal="true" data-kind={ask.kind} data-testid="unsaved-dialog">
        <Confirm
          t={t}
          testid="confirm-unsaved"
          title={title}
          body={body}
          action={t(ACTION[ask.kind] ?? ACTION.close)}
          cancel={t('unsaved.cancel')}
          onCancel={() => answer(false)}
          onConfirm={() => answer(true)}
          focusCancel
        />
      </div>
    </div>
  );
}

export function MissingFolder({ t, tab, title, type }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const artifact = usePage((s) => s.artifacts.find((a) => a.id === tab.id));
  const remove = usePage((s) => s.remove);
  const relocate = async () => {
    setError('');
    setBusy('relocate');
    try {
      const out = await window.desktop.artifactDo('relocate', tab.id);
      if (out && out.ok === false) setError(t('missing.failed', { message: out.error }));
    } finally {
      setBusy(null);
    }
  };
  const forget = async () => {
    setError('');
    setBusy('remove');
    try {
      // The library page's own delete: its toast says so, with Undo; the main process closes the tab.
      if (artifact) await remove(artifact);
      else {
        const out = await window.desktop.library.remove(tab.id);
        if (out && out.ok === false) setError(out.error);
      }
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="missing" data-testid="missing-folder" data-tab={tab.id}>
      <div className="missing-card">
        <span className="missing-swatch" style={typeStyle(type)} aria-hidden="true">
          <TypeIcon type={type} size={18} />
        </span>
        <h1 className="missing-name">{title}</h1>
        <h2 className="missing-title">{t('missing.title')}</h2>
        <p className="missing-body">{t('missing.body')}</p>
        <p className="missing-path mono" data-testid="missing-path" title={tab.missing}>
          {tab.missing}
        </p>
        {error && (
          <p className="row-error" role="alert" data-testid="missing-error">
            {error}
          </p>
        )}
        <div className="missing-actions">
          <button type="button" className="button-dark" data-testid="missing-relocate" title={t('missing.relocateHint')} disabled={!!busy} onClick={() => void relocate()}>
            {busy === 'relocate' ? t('missing.relocating') : t('missing.relocate')}
          </button>
          <button type="button" className="button-outline" data-testid="missing-remove" title={t('missing.removeHint')} disabled={!!busy} onClick={() => void forget()}>
            {t('missing.remove')}
          </button>
        </div>
        <p className="row-hint">{t('missing.removeHint')}</p>
      </div>
    </div>
  );
}
