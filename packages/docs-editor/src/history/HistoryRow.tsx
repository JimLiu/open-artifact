/** One row of the history list: a version, the current one, a restore, or a folded run of one author's edits. */
import type { DocVersion } from '@open-artifact/runtime/doc-api';
import { Button } from '@open-artifact/ui';
import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { useDocs } from '../app/store.ts';
import { canCopyVersions, canRestoreVersions, copyPreview, selectPreview, toggleExpanded } from './data.ts';
import { type VersionRow, compareBase, editsLabel, fullTime, restoredLabel, timeLabel, whoOf } from './groups.ts';
import { type Preview, setHistory, useVersionHistory } from './store.ts';

interface RowProps {
  row: VersionRow;
  tab: string;
  /** Every version of the tab, newest first (what each is compared with). */
  versions: readonly DocVersion[];
}

export function HistoryRow({ row, tab, versions }: RowProps): ReactNode {
  const expanded = useVersionHistory(state => !!state.expanded[row.key]);
  if (row.kind !== 'group') return <VersionItem version={row.versions[0]!} row={row} tab={tab} versions={versions} />;
  const newest = row.versions[0]!;
  const oldest = row.versions[row.versions.length - 1]!;
  const count = row.versions.length;
  return (
    <div data-testid="history-group">
      <VersionItem
        version={newest}
        row={row}
        tab={tab}
        versions={versions}
        base={compareBase(versions, oldest.rev)}
        lead={
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} ${count} versions`}
            onClick={() => toggleExpanded(row.key)}
            className="mt-0.5 grid size-5 flex-none place-items-center rounded text-chrome-muted hover:bg-chrome-hover"
          >
            <ChevronRight className={`size-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        }
      />
      {expanded ? (
        <div className="pl-5" role="group" aria-label={`${count} versions`}>
          {row.versions.map(version => (
            <VersionItem key={version.rev} version={version} row={{ ...row, kind: 'single', key: `r${version.rev}`, versions: [version] }} tab={tab} versions={versions} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ItemProps extends RowProps {
  version: DocVersion;
  /** The version the row is compared with, when it is not the one just before `version`. */
  base?: number | null;
  lead?: ReactNode;
}

function VersionItem({ version, row, tab, versions, base, lead }: ItemProps): ReactNode {
  const me = useDocs(state => state.me);
  const selected = useVersionHistory(state => state.preview?.row === row.key && state.preview.tab === tab);
  const count = row.versions.length;
  const who = whoOf(version, me);
  const restored = restoredLabel(version, versions);
  const time = timeLabel(version.at);
  const title = row.kind === 'current' ? 'Current version' : row.kind === 'group' ? editsLabel(count, who) : time;
  const showTime = row.kind === 'current' || row.kind === 'group';
  const preview: Preview = {
    tab,
    rev: version.rev,
    base: base === undefined ? compareBase(versions, version.rev) : base,
    at: version.at,
    current: row.kind === 'current',
    count,
    row: row.key,
  };
  return (
    <div className={`rounded-md ${selected ? 'bg-chrome-pressed' : ''}`} data-testid="history-version">
      <div className="flex items-start gap-1 px-1.5 py-1.5">
        {lead ?? <span className="size-5 flex-none" />}
        <button
          type="button"
          aria-pressed={selected}
          data-version-focus=""
          title={fullTime(version.at)}
          onClick={() => (selected ? setHistory({ preview: null }) : selectPreview(preview))}
          className={`min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-chrome-focus ${selected ? '' : 'hover:bg-chrome-hover'}`}
        >
          <div className="flex min-w-0 items-baseline gap-2 text-[13px] font-medium text-chrome-fg">
            <span className="line-clamp-2">{title}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-chrome-muted">
            <span className="truncate">{who}</span>
            {showTime ? <span className="shrink-0">· {time}</span> : null}
          </div>
          {restored ? <div className="mt-0.5 truncate text-[11px] text-chrome-muted">{restored}</div> : null}
        </button>
      </div>
      {selected ? <RowActions current={row.kind === 'current'} /> : null}
    </div>
  );
}

function RowActions({ current }: { current: boolean }): ReactNode {
  const busy = useVersionHistory(state => state.busy);
  const writable = useDocs(state => state.writable);
  const restorable = writable && !current && canRestoreVersions();
  const copyable = writable && canCopyVersions();
  if (!restorable && !copyable) return null;
  return (
    <div className="flex flex-wrap gap-2 px-2 pb-2 pl-8">
      {!restorable ? null : (
        <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => setHistory({ confirmRestore: true })} data-testid="history-restore">
          {busy === 'restoring' ? 'Restoring…' : 'Restore this version'}
        </Button>
      )}
      {!copyable ? null : (
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void copyPreview()} data-testid="history-copy">
          {busy === 'copying' ? 'Making a copy…' : 'Make a copy'}
        </Button>
      )}
    </div>
  );
}
