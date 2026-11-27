/** The version history beside the page: the open tab's versions, newest first, by day. */
import { Button, isComposingKey } from '@open-artifact/ui';
import { X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo } from 'react';
import { docClient } from '../app/doc-client.ts';
import { setDocs, useDocs } from '../app/store.ts';
import { loadHistory, showOlder } from './data.ts';
import { dayKey, dayLabel, foldVersions, sectionByDay } from './groups.ts';
import { HistoryRow } from './HistoryRow.tsx';
import { useVersionHistory } from './store.ts';

/** How long the list waits after a write before reading the versions again. */
const REFRESH_MS = 1200;

/** How long a version reached with the arrow keys stays focused before it is previewed. */
const PREVIEW_AFTER_MS = 250;

export function HistoryPanel(): ReactNode {
  const open = useDocs(state => state.history);
  const tab = useDocs(state => state.activeTab);
  if (!open || !tab) return null;
  return <HistoryAside tab={tab} />;
}

function HistoryAside({ tab }: { tab: string }): ReactNode {
  useHistoryFollowsTab(tab);
  const tabName = useDocs(state => state.project?.files.find(file => file.id === tab)?.name ?? '');
  return (
    <aside className="flex w-80 flex-none flex-col border-l border-chrome-line bg-chrome text-chrome-fg" aria-label="Version history" data-testid="history-panel">
      <div className="flex h-11 flex-none items-center gap-2 border-b border-chrome-line pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">Version history</div>
          {tabName ? <div className="truncate text-[11px] text-chrome-muted">{tabName}</div> : null}
        </div>
        <button
          type="button"
          aria-label="Close version history"
          onClick={() => setDocs({ history: false })}
          className="grid size-7 place-items-center rounded-md text-chrome-muted hover:bg-chrome-hover"
        >
          <X className="size-4" />
        </button>
      </div>
      <VersionList tab={tab} />
    </aside>
  );
}

/** Reads the tab's versions when the panel opens on it, and again shortly after each write to it. */
function useHistoryFollowsTab(tab: string): void {
  useEffect(() => {
    void loadHistory(tab);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = docClient().onShadow(changed => {
      if (changed !== tab) return;
      clearTimeout(timer);
      timer = setTimeout(() => void loadHistory(tab), REFRESH_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [tab]);
}

function VersionList({ tab }: { tab: string }): ReactNode {
  const versions = useVersionHistory(state => (state.tab === tab ? state.versions : null));
  const loading = useVersionHistory(state => state.loading);
  const error = useVersionHistory(state => state.error);
  const shown = useVersionHistory(state => state.shown);
  const sections = useMemo(() => (versions ? sectionByDay(foldVersions(versions.slice(0, shown), dayKey)) : []), [versions, shown]);

  let body: ReactNode;
  if (!versions && error) {
    body = (
      <div role="alert" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <div className="text-[13px] font-medium">Couldn’t load version history</div>
        <div className="text-xs text-chrome-muted">{error}</div>
        <Button size="sm" disabled={loading} onClick={() => void loadHistory(tab)}>
          {loading ? 'Retrying…' : 'Try again'}
        </Button>
      </div>
    );
  } else if (!versions) {
    body = <ListLoading />;
  } else if (versions.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
        <div className="text-[13px] font-medium">No versions yet</div>
        <div className="text-xs text-chrome-muted">Versions are saved automatically as you edit.</div>
      </div>
    );
  } else {
    const now = new Date();
    body = (
      <>
        {sections.map(section => (
          <section key={section.day} aria-label={dayLabel(section.rows[0]!.versions[0]!.at, now)} className="mb-2">
            <h3 className="px-2 pt-2 pb-1 text-[11px] font-medium text-chrome-muted">{dayLabel(section.rows[0]!.versions[0]!.at, now)}</h3>
            {section.rows.map(row => (
              <HistoryRow key={row.key} row={row} tab={tab} versions={versions} />
            ))}
          </section>
        ))}
        {versions.length > shown ? (
          <div className="px-2 pt-1 pb-3">
            <Button size="sm" onClick={showOlder} data-testid="history-load-older">
              Show older versions
            </Button>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <div
      role="group"
      aria-label="Versions"
      aria-busy={loading}
      className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      data-testid="history-list"
      onKeyDown={stepThroughVersions}
    >
      {body}
    </div>
  );
}

let previewSoon: ReturnType<typeof setTimeout> | undefined;

/**
 * Up and down move between the versions and preview the one reached, Home and End go to the newest and the oldest
 * shown, and Enter on the version being previewed asks to restore it.
 */
function stepThroughVersions(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey || isComposingKey(event.nativeEvent)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-version-focus]')];
  const active = document.activeElement as HTMLElement;
  const at = rows.indexOf(active);
  if (event.key === 'Enter' && at >= 0 && active.getAttribute('aria-pressed') === 'true') {
    const restore = active.closest('[data-testid="history-version"]')?.querySelector<HTMLButtonElement>('[data-testid="history-restore"]:not([disabled])');
    if (!restore) return;
    event.preventDefault();
    restore.click();
    return;
  }
  const to =
    event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? (at < 0 ? rows.length - 1 : at - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
  if (to === null || !rows.length) return;
  event.preventDefault();
  const row = rows[Math.max(0, Math.min(rows.length - 1, to))]!;
  row.focus();
  clearTimeout(previewSoon);
  previewSoon = setTimeout(() => {
    if (document.activeElement === row && row.getAttribute('aria-pressed') !== 'true') row.click();
  }, PREVIEW_AFTER_MS);
}

function ListLoading(): ReactNode {
  return (
    <div role="status" aria-label="Loading versions" className="flex flex-col gap-4 px-2 py-2">
      {[0, 1, 2].map(index => (
        <div key={index} className="flex flex-col gap-1.5">
          <div className="h-3 w-2/3 animate-pulse rounded bg-chrome-hover" />
          <div className="h-2.5 w-1/3 animate-pulse rounded bg-chrome-hover" />
        </div>
      ))}
    </div>
  );
}
