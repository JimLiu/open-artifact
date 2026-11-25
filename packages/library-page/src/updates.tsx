/**
 * A newer release of the host, offered at the top of the page ({@link UpdatePanel}): the versions, what the new one
 * brings (its release notes, changelog.tsx), Update, Later, and how the run is going. Later folds it to one line.
 *
 * Whether there is a newer release, and how it is installed, are the host's ({@link PageUpdates}); the page only draws
 * them. A host without one draws nothing here.
 */
import type { ReactNode } from 'react';
import { latestOf } from './library/routes.ts';
import { UpcomingNotes } from './changelog.tsx';
import { useUpdates } from './env.tsx';

/** One of the panel's buttons, in the page's own button style. */
export function Action({ primary, onClick, children, label, disabled }: { primary?: boolean; onClick(): void; children: ReactNode; label?: string; disabled?: boolean }) {
  return (
    <button type="button" className="oa-btn" {...(primary ? { 'data-primary': 'true' } : {})} {...(label ? { 'aria-label': label } : {})} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** The panel at the top of the Open Artifact page: the offer, then the run and how it went. */
export function UpdatePanel() {
  const { phase, updates, to, restart, failure, dismissed, offer } = useUpdates();
  const { t, start, later, close, reopen } = offer;
  const latest = latestOf(updates);
  if (phase === 'idle' && latest === '') return null;
  if (phase === 'idle' && latest === dismissed) {
    return (
      <div className="oau-line" data-testid="open-artifact-update-line">
        <span>{t('available', { version: latest })}</span>
        <button type="button" className="oau-show" onClick={reopen}>
          {t('show')}
        </button>
      </div>
    );
  }
  let title: string;
  let text: string | null = null;
  let actions: ReactNode = null;
  if (phase === 'running') {
    title = t('busy');
  } else if (phase === 'done') {
    title = t('done', { version: to });
    text = t(restart ? 'done.restart' : 'done.session');
    actions = (
      <>
        <Action onClick={close}>{t('close')}</Action>
        {restart && offer.restart && (
          <Action primary onClick={() => offer.restart?.()}>
            {t('restart')}
          </Action>
        )}
      </>
    );
  } else if (phase === 'failed' && failure) {
    title = t('failed');
    text = `${failure.message} ${t(failure.left === 'unknown' ? 'failed.unknown' : 'failed.kept')}`;
    actions = (
      <>
        <Action onClick={close}>{t('close')}</Action>
        {updates.length > 0 && (
          <Action primary onClick={start}>
            {t('retry')}
          </Action>
        )}
      </>
    );
  } else {
    title = t('available', { version: latest });
    text = t('current', { version: updates[0]?.version ?? '' });
    actions = (
      <>
        <Action onClick={later}>{t('later')}</Action>
        <Action primary onClick={start} label={t('update.one', { version: latest })}>
          {t('update')}
        </Action>
      </>
    );
  }
  return (
    <section className="oau-panel" role={phase === 'failed' ? 'alert' : 'status'} data-testid="open-artifact-update" data-phase={phase}>
      <div className="oau-head">
        <div className="oau-head-text">
          <div className="oau-title">{title}</div>
          {text !== null && <div className="oau-text">{text}</div>}
        </div>
        {actions !== null && <div className="oau-actions">{actions}</div>}
      </div>
      {phase === 'idle' && <UpcomingNotes />}
    </section>
  );
}
