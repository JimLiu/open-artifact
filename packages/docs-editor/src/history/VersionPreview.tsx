/**
 * A past version shown read-only in place of the tab's text: its changes against the version before it, the tab as it
 * is now or (a restore) the version it brought back, stepped through one by one; restore it, or go back.
 */
import { ChromeButton, ChromeMenu, ChromeMenuItem, TipButton } from '@open-artifact/editor-kit/react';
import { Button } from '@open-artifact/ui';
import { ChevronDown, ChevronUp, Eye, History, Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useDocs } from '../app/store.ts';
import { type Comparison, compareVersions, stepChange } from './compare.ts';
import { type CompareState, type CompareTarget, againstLabel, changesLabel, compareStatus, compareTarget } from './compare-target.ts';
import { canRestoreVersions, clearPreview, loadVersion, setCompare, setCompareBase } from './data.ts';
import { fullTime, whenLabel, whoOf } from './groups.ts';
import { type Preview, setHistory, useVersionHistory, versionKey } from './store.ts';
import { VersionText } from './VersionText.tsx';

/** Drawn by the page in place of the editor while {@link useVersionPreviewing} is true. */
export function VersionPreview(): ReactNode {
  const preview = useVersionHistory(state => state.preview);
  if (!preview) return null;
  return <PreviewPane key={`${preview.tab}:${preview.rev}:${preview.base ?? ''}`} preview={preview} />;
}

/** A version read for the preview: its doc, or that it could not be read. */
function useVersionDoc(tab: string, rev: number | null) {
  const doc = useVersionHistory(state => (rev === null ? null : (state.docs[versionKey(tab, rev)] ?? null)));
  const error = useVersionHistory(state => (rev === null ? null : (state.docErrors[versionKey(tab, rev)] ?? null)));
  return { doc, error };
}

function PreviewPane({ preview }: { preview: Preview }): ReactNode {
  const compare = useVersionHistory(state => state.compare);
  const compareWith = useVersionHistory(state => state.compareWith);
  const restoreBase = useVersionHistory(state => state.restoreBase);
  const versions = useVersionHistory(state => state.versions);
  const confirming = useVersionHistory(state => state.confirmRestore);
  const target = useMemo(() => compareTarget(preview, versions, compareWith, restoreBase), [preview, versions, compareWith, restoreBase]);
  const { doc, error: docError } = useVersionDoc(preview.tab, preview.rev);
  const older = useVersionDoc(preview.tab, compare ? target.before : null);
  const newer = useVersionDoc(preview.tab, compare && target.before !== null ? target.after : null);

  useEffect(() => {
    void loadVersion(preview.tab, preview.rev);
  }, [preview.tab, preview.rev]);
  useEffect(() => {
    if (!compare || target.before === null) return;
    void loadVersion(preview.tab, target.before);
    void loadVersion(preview.tab, target.after);
  }, [compare, preview.tab, target.before, target.after]);

  useEffect(() => {
    if (confirming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      clearPreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  const result = useMemo((): { state: CompareState; comparison: Comparison | null } => {
    if (!compare) return { state: { kind: 'off' }, comparison: null };
    if (target.before === null) return { state: { kind: 'none' }, comparison: null };
    // The tab as first saved isn't kept by every doc: then the oldest version has nothing earlier to compare.
    if (older.error && target.firstSaved) return { state: { kind: 'none' }, comparison: null };
    if (older.error || newer.error) return { state: { kind: 'failed' }, comparison: null };
    if (!older.doc || !newer.doc) return { state: { kind: 'loading' }, comparison: null };
    try {
      const comparison = compareVersions(older.doc, newer.doc);
      return { state: { kind: 'shown', count: comparison.changes.length }, comparison };
    } catch {
      return { state: { kind: 'failed' }, comparison: null };
    }
  }, [compare, target.before, target.firstSaved, older.doc, older.error, newer.doc, newer.error]);
  const { comparison } = result;
  // The tab as first saved couldn't be read: the bar then speaks of the previous version, as for any oldest version.
  const shown = useMemo(() => (target.firstSaved && older.error ? { ...target, firstSaved: false } : target), [target, older.error]);

  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [comparison]);
  const count = comparison?.changes.length ?? 0;
  const step = (dir: 1 | -1) => setActive(now => stepChange(now, count, dir));
  const activeChange = active >= 0 ? (comparison?.changes[active] ?? null) : null;

  return (
    <div className="relative" role="region" aria-label="Version preview, read-only" data-testid="version-preview">
      <div className="sticky top-0 z-20 -mx-2 mb-6 rounded-b-lg border-b border-chrome-line bg-page/95 backdrop-blur">
        <PreviewBar preview={preview} target={shown} status={compareStatus(shown, result.state)} />
        {comparison && count > 0 ? (
          <div className="flex items-center gap-2 border-t border-chrome-line px-2 py-1" data-testid="version-changes">
            <span className="shrink-0 text-[12px] text-chrome-muted" role="status">
              {changesLabel(count, target.against)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-chrome-fg" data-testid="version-change-summary">
              {activeChange?.summary ?? ''}
            </span>
            <ChromeButton square aria-label="Previous change" title="Previous change" onClick={() => step(-1)} data-testid="version-change-prev">
              <ChevronUp className="size-3.5" />
            </ChromeButton>
            <ChromeButton square aria-label="Next change" title="Next change" onClick={() => step(1)} data-testid="version-change-next">
              <ChevronDown className="size-3.5" />
            </ChromeButton>
          </div>
        ) : null}
      </div>
      {docError ? (
        <div role="alert" className="py-10 text-center text-sm text-chrome-muted">
          This version could not be read: {docError}
        </div>
      ) : !doc || result.state.kind === 'loading' ? (
        <div className="grid place-items-center py-16 text-chrome-muted">
          <Loader2 className="size-5 animate-spin" aria-label="Loading the version" />
        </div>
      ) : (
        <VersionText doc={comparison ?? doc} active={activeChange?.id ?? null} />
      )}
    </div>
  );
}

function PreviewBar({ preview, target, status }: { preview: Preview; target: CompareTarget; status: string | null }): ReactNode {
  const me = useDocs(state => state.me);
  const writable = useDocs(state => state.writable);
  const busy = useVersionHistory(state => state.busy);
  const compare = useVersionHistory(state => state.compare);
  const version = useVersionHistory(state => state.versions?.find(item => item.rev === preview.rev) ?? null);
  const when = whenLabel(preview.at);
  const title = preview.current ? 'Current version' : preview.count > 1 ? `Newest of ${preview.count} versions · ${when}` : when;
  const restorable = writable && !preview.current && canRestoreVersions();
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-2" data-testid="version-bar">
      <History className="size-4 flex-none text-chrome-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-chrome-fg" title={fullTime(preview.at)}>
          {title}
        </div>
        <div className="truncate text-[11px] text-chrome-muted" data-testid="version-status">
          {[version ? whoOf(version, me) : null, 'Read-only', status].filter(Boolean).join(' · ')}
        </div>
      </div>
      {compare ? <CompareMenu preview={preview} target={target} /> : null}
      <TipButton tip={compare ? 'Hide changes' : 'Show changes'} square pressed={compare} aria-label="Show changes" onClick={() => setCompare(!compare)} data-testid="version-compare">
        <Eye className="size-4" />
      </TipButton>
      {restorable ? (
        <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => setHistory({ confirmRestore: true })} data-testid="version-restore">
          {busy === 'restoring' ? 'Restoring…' : 'Restore this version'}
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" onClick={clearPreview} data-testid="version-back">
        Back to editing
      </Button>
    </div>
  );
}

/** What the version is compared with: the previous version, the current one, or (a restore) the version it restored. */
function CompareMenu({ preview, target }: { preview: Preview; target: CompareTarget }): ReactNode {
  const source = useVersionHistory(state => (target.restoredFrom === null ? null : (state.versions?.find(item => item.rev === target.restoredFrom) ?? null)));
  if (preview.current && !target.restore) return null;
  const tip = target.restore
    ? source
      ? `Previous version: shows what this restore changed. Restored version: checks this version against the one it brought back (from ${whenLabel(source.at)}); the two should match.`
      : 'Previous version: shows what this restore changed. Restored version: checks this version against the one it brought back; the two should match.'
    : 'Compare with';
  return (
    <ChromeMenu
      align="end"
      tip={{ label: tip }}
      trigger={
        <ChromeButton className="text-[13px]" data-testid="version-compare-menu">
          {againstLabel(target)}
          <ChevronDown className="size-3.5 text-chrome-muted" />
        </ChromeButton>
      }
    >
      <ChromeMenuItem
        checked={target.against === 'previous'}
        description={target.restore ? 'The one before this restore' : target.firstSaved ? 'The tab as first saved' : 'The one before this version'}
        onSelect={() => setCompareBase('previous')}
      >
        Previous version
      </ChromeMenuItem>
      {preview.current ? null : (
        <ChromeMenuItem checked={target.against === 'current'} description="The tab as it is now" onSelect={() => setCompareBase('current')}>
          Current version
        </ChromeMenuItem>
      )}
      {target.restore ? (
        <ChromeMenuItem
          checked={target.against === 'restored'}
          description={source ? `The one it brought back (${whenLabel(source.at)})` : 'The one it brought back'}
          onSelect={() => setCompareBase('restored')}
        >
          Restored version
        </ChromeMenuItem>
      ) : null}
    </ChromeMenu>
  );
}
