import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { MessageCircle, TriangleAlert, X } from 'lucide-react';
import { Button, IconButton, cn } from '@open-artifact/ui';
import type { ConnectionFix, Dataset } from '@open-artifact/data-core';
import { useDismissFocusLanding } from '../app/dismiss-focus.ts';
import { connectionFixAriaLabel, connectionFixLabel } from './fixes.ts';
import { ASK_AGENT_TO_LOOK_QUESTION, DIDNT_LOAD_SENTENCE_END, describeFailedSourcesCount, type SourcesFailureNotice } from './status.ts';

/** The ask button of a source's own failure notice. */
export const ASK_AGENT_LABEL = 'Ask your agent';
/** The dashboard notice's ask button. */
export const TAKE_A_LOOK_LABEL = 'Take a look';
export const RETRY_NOTICE_LABEL = 'Retry';
export const SEE_SOURCES_LABEL = 'See sources';
export const DISMISS_LABEL = 'Dismiss';

export interface SourcesNoticeProps {
  notice: SourcesFailureNotice;
  /** Opens the Sources panel. */
  onSources?: () => void;
  /** Opens the failed sources: the one in detail, or the list of them. Left out where they can't be opened (comments). */
  onFailed?: (failed: Dataset[]) => void;
  onFix: (connector: string, fix: ConnectionFix) => unknown;
  /** Asks the agent why these sources failed. */
  onAskWhy?: (datasets: Dataset[]) => unknown;
  onRetry: () => void;
  loading?: boolean;
  onDismiss?: () => void;
  canAskAgent: boolean;
}

/**
 * A press that stays busy while the loads it started run: it counts once pressed, shows busy only while sources load,
 * and clears once loading stopped and the press's own work (a fix, a request) settled.
 */
function usePressBusy(loading: boolean): { busy: boolean; press: (work?: unknown) => void } {
  const [pressed, setPressed] = useState(false);
  const [working, setWorking] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (pressed && !loading && !working) setPressed(false);
  }, [pressed, loading, working]);
  const press = (work?: unknown): void => {
    setPressed(true);
    if (work === undefined) return;
    setWorking(true);
    void Promise.resolve(work)
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current) setWorking(false);
      });
  };
  return { busy: working || (pressed && loading), press };
}

/** "<link>3 sources</link> didn’t load.", and the question when the agent can be asked. */
function FailedSourcesText({ failed, ask, onFailed }: { failed: Dataset[]; ask: boolean; onFailed?: (failed: Dataset[]) => void }): ReactElement {
  const count = describeFailedSourcesCount(failed.length);
  const link =
    onFailed === undefined ? (
      <span role="link" aria-disabled="true" className="underline underline-offset-2 opacity-70">
        {count}
      </span>
    ) : (
      <button type="button" className="cursor-pointer text-fg underline underline-offset-2 hover:text-accent" onClick={() => onFailed(failed)}>
        {count}
      </button>
    );
  return (
    <>
      {link}
      {DIDNT_LOAD_SENTENCE_END}
      {ask ? ASK_AGENT_TO_LOOK_QUESTION : null}
    </>
  );
}

/** The dashboard's notice about its sources, with the one action that helps most. */
export function SourcesNotice({
  notice,
  onSources,
  onFailed,
  onFix,
  onAskWhy,
  onRetry,
  loading = false,
  onDismiss,
  canAskAgent,
}: SourcesNoticeProps): ReactElement {
  const banner = useRef<HTMLDivElement | null>(null);
  const dismiss = useDismissFocusLanding(banner, onDismiss);
  const fixPress = usePressBusy(loading);
  const askPress = usePressBusy(false);
  const retryPress = usePressBusy(loading);
  const { fix, ask, failed } = notice;
  const quiet = notice.quiet === true;
  const listed = failed !== undefined && failed.length > 0;
  const asking = ask !== undefined && onAskWhy !== undefined && canAskAgent;
  const neutral = quiet || listed;

  let action: ReactNode = null;
  if (fix !== undefined)
    action = (
      <Button
        size="sm"
        disabled={fixPress.busy}
        aria-busy={fixPress.busy || undefined}
        aria-label={connectionFixAriaLabel(fix.fix, fix.connector, canAskAgent)}
        onClick={() => fixPress.press(onFix(fix.connector, fix.fix))}
      >
        {connectionFixLabel(fix.fix, canAskAgent)}
      </Button>
    );
  else if (asking)
    action = (
      <Button size="sm" disabled={askPress.busy} aria-busy={askPress.busy || undefined} onClick={() => askPress.press(onAskWhy(ask) ?? undefined)}>
        {TAKE_A_LOOK_LABEL}
      </Button>
    );
  else if (listed)
    action = (
      <Button
        size="sm"
        disabled={retryPress.busy}
        aria-busy={retryPress.busy || undefined}
        onClick={() => {
          retryPress.press();
          onRetry();
        }}
      >
        {RETRY_NOTICE_LABEL}
      </Button>
    );
  else if (!neutral && onSources !== undefined)
    action = (
      <Button size="sm" onClick={onSources}>
        {SEE_SOURCES_LABEL}
      </Button>
    );

  const Icon = asking ? MessageCircle : TriangleAlert;
  return (
    <div
      ref={banner}
      role="none"
      data-dash-sources-notice=""
      className={cn(
        'flex items-center gap-2 rounded-control border px-3 py-2 text-[13px] text-fg',
        neutral ? 'border-line bg-surface' : 'border-warning/40 bg-warning/10',
      )}
    >
      {quiet ? null : <Icon className={cn('size-4 shrink-0', neutral ? 'text-fg-muted' : 'text-warning')} aria-hidden />}
      <span className="min-w-0 flex-1">{listed ? <FailedSourcesText failed={failed} ask={asking} {...(onFailed === undefined ? {} : { onFailed })} /> : notice.text}</span>
      {action}
      {dismiss === undefined ? null : <IconButton size="sm" label={DISMISS_LABEL} icon={<X className="size-3.5" />} onClick={dismiss} />}
    </div>
  );
}
