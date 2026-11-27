/**
 * The History panel's content: the versions by day (each earlier one with a
 * Restore that shows on hover or focus), and one version's changes with line
 * diffs and Restore. The version open here is shown on the page with today's
 * data.
 */

import { ArrowLeft, Bot, ChevronRight, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HistoryFileDiff, HistoryVersion } from '@open-artifact/runtime';
import { Button, ConfirmDialog, cn, diffHunks, diffLines, diffStats, groupVersions, toast, type DiffHunk } from '@open-artifact/ui';
import { useStyleEditor } from '../design/style.ts';
import { useEditFlow } from '../drafts/edit-flow.ts';
import { useDraftFlow } from '../drafts/flow.ts';
import {
  AGENT_VERSION_LABEL,
  BACK_TO_VERSIONS_LABEL,
  CURRENT_VERSION_LABEL,
  HISTORY_UNREADABLE_MESSAGE,
  IS_NOW_MESSAGE,
  NO_VERSIONS_MESSAGE,
  NO_VERSIONS_TITLE,
  RESTORED_MESSAGE,
  RESTORE_EARLIER_TITLE,
  RESTORE_LABEL,
  RESTORING_LABEL,
  TOO_MUCH_CHANGED_MESSAGE,
  VERSIONS_LABEL,
  VERSION_CHANGE_LABELS,
  VERSION_MARK_LABELS,
  datasetTitleOf,
  describeDataVersion,
  describeVersionDiffChange,
  describeVersionRowLabel,
  formatVersionDay,
  formatVersionTime,
  hadPageBefore,
  historyPathOf,
  isPageFilePath,
  listVersionChanges,
  restoreEarlierDescription,
  restoreVersionLabel,
  versionByline,
  versionChangeName,
  versionDayLabel,
  versionDiffSides,
  versionWho,
  type VersionChange,
} from './describe.ts';
import { historyCapability, openVersion, restoreVersion, restoreVersionNow, useVersionHistory } from './store.ts';

/** Lines of context around a change. */
const DIFF_CONTEXT_LINES = 2;

function Who({ version, who }: { version: HistoryVersion; who: string }): ReactNode {
  if (who === '') return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-chrome-muted">
      {version.author.kind === 'agent' ? (
        <Bot className="size-3.5 flex-none" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="flex size-4 flex-none items-center justify-center rounded-full bg-chrome-hover text-[9px] font-semibold uppercase text-chrome-fg">
          {who.slice(0, 1)}
        </span>
      )}
      <span className="truncate" title={who}>
        {version.author.kind === 'agent' ? AGENT_VERSION_LABEL : who}
      </span>
    </span>
  );
}

/**
 * Restoring from the list waits while something else holds the page: hand edits, unsaved style changes, a draft
 * being saved, or the agent's turn on the draft held here. (A version's own page still offers Restore.)
 */
function useRestoreHeld(): boolean {
  const editing = useEditFlow((state) => state.phase !== 'off');
  const styling = useStyleEditor((state) => state.pending !== null);
  const saving = useDraftFlow((state) => state.saving);
  const waiting = useDraftFlow((state) => state.view.waiting);
  return editing || styling || saving || waiting;
}

/**
 * Shown on a precise pointer while the row is hovered, holds focus or restores; never on touch, where the version's
 * own page has Restore. Invisible, it still takes focus, so the keyboard reaches it.
 */
const ROW_RESTORE_CLASS = cn(
  'absolute end-2 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none',
  'group-hover/version:opacity-100 group-hover/version:pointer-events-auto',
  'group-focus-within/version:opacity-100 group-focus-within/version:pointer-events-auto',
  'aria-busy:opacity-100 aria-busy:pointer-events-auto',
  '[@media(hover:none)]:hidden [@media(pointer:coarse)]:hidden',
);

/** Brings version `n` back from its row, staying on the list; a toast says how it went. */
async function restoreFromList(n: number): Promise<void> {
  const problem = await restoreVersionNow(n);
  toast.add(problem === null ? { title: RESTORED_MESSAGE } : { title: problem, timeout: 10_000 });
}

function VersionRow({ version, now, held }: { version: HistoryVersion; now: number; held: boolean }): ReactNode {
  const at = Date.parse(version.at);
  const when = formatVersionDay(at, now);
  const who = versionWho(version.author);
  const current = version.current === true;
  const canRestore = useVersionHistory((state) => state.canRestore);
  const restoring = useVersionHistory((state) => state.restoring);
  const busy = useVersionHistory((state) => state.restoringN === version.n);
  const offered = canRestore && !current && !held;
  const [confirming, setConfirming] = useState(false);
  const confirmed = useRef(false);
  const rowButton = useRef<HTMLButtonElement | null>(null);
  const restoreButton = useRef<HTMLButtonElement | null>(null);
  // Something took hold of the page while the question was open: it goes away unanswered.
  if (confirming && !offered) setConfirming(false);
  return (
    <li className="group/version relative">
      <button
        ref={rowButton}
        type="button"
        data-version={version.n}
        data-row-main=""
        aria-label={describeVersionRowLabel(when, current, who)}
        onClick={() => openVersion(version.n)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start outline-none hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-focus"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2 text-[13px] text-chrome-fg">
            {formatVersionTime(at)}
            {current ? <span className="text-[11px] text-chrome-muted">{CURRENT_VERSION_LABEL}</span> : null}
          </span>
          <Who version={version} who={who} />
        </span>
        <ChevronRight className="size-3.5 flex-none text-chrome-muted" aria-hidden="true" />
      </button>
      {offered || busy ? (
        <Button
          ref={restoreButton}
          size="sm"
          data-version-restore={version.n}
          aria-label={restoreVersionLabel(when)}
          aria-busy={busy || undefined}
          disabled={restoring}
          onClick={() => setConfirming(true)}
          className={ROW_RESTORE_CLASS}
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          {busy ? RESTORING_LABEL : RESTORE_LABEL}
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirming && offered}
        onOpenChange={(open) => {
          if (open) confirmed.current = false;
          setConfirming(open);
        }}
        title={RESTORE_EARLIER_TITLE}
        description={restoreEarlierDescription(when)}
        confirmLabel={RESTORE_LABEL}
        initialFocus="cancel"
        finalFocus={() => (confirmed.current ? rowButton.current : restoreButton.current)}
        onConfirm={() => {
          confirmed.current = true;
          void restoreFromList(version.n);
        }}
      />
    </li>
  );
}

function VersionList({ versions, now }: { versions: readonly HistoryVersion[]; now: number }): ReactNode {
  const days = useMemo(() => groupVersions(versions), [versions]);
  const held = useRestoreHeld();
  const none = versions.length === 0 || (versions.length === 1 && versions[0]!.current === true);
  if (none)
    return (
      <div role="note" className="flex flex-col gap-1 p-4">
        <p className="text-[13px] font-medium text-chrome-fg">{NO_VERSIONS_TITLE}</p>
        <p className="text-[12px] text-chrome-muted">{NO_VERSIONS_MESSAGE}</p>
      </div>
    );
  return (
    <div aria-label={VERSIONS_LABEL} role="list" className="flex flex-col gap-3 p-2">
      {days.map((day) => (
        <section key={day.key} role="listitem" aria-label={versionDayLabel(day.date.getTime(), now)} className="flex flex-col">
          <h4 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-chrome-muted">{versionDayLabel(day.date.getTime(), now)}</h4>
          <ul className="flex flex-col">
            {day.runs.flatMap((run) => run.versions.map((version) => <VersionRow key={version.n} version={version} now={now} held={held} />))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DiffLines({ hunks }: { hunks: readonly DiffHunk[] }): ReactNode {
  return (
    <>
      {hunks.map((hunk, index) => (
        <pre key={index} className="overflow-x-auto rounded-md border border-chrome-line font-mono text-[11px] leading-[17px]">
          {hunk.lines.map((line, lineIndex) => {
            const mark = line.op === ' ' ? null : line.op;
            return (
              <span
                key={lineIndex}
                className={cn('block min-w-max whitespace-pre px-2', mark === '+' && 'bg-success/10', mark === '-' && 'bg-danger/10', mark === null && 'text-chrome-muted')}
              >
                {mark !== null ? (
                  <span className={cn('inline-block w-3 select-none', mark === '+' ? 'text-success' : 'text-danger')}>
                    <span aria-hidden="true">{mark === '+' ? '+' : '−'}</span>
                    <span className="sr-only">{VERSION_MARK_LABELS[mark]}</span>
                  </span>
                ) : (
                  <span className="inline-block w-3" />
                )}
                {line.text + '\n'}
              </span>
            );
          })}
        </pre>
      ))}
    </>
  );
}

/** One changed document: its line diff, folded under a tally for page files. */
function ChangeDiff({ change, name, diff }: { change: VersionChange; name: string; diff: HistoryFileDiff | undefined }): ReactNode {
  const hunks = useMemo(() => {
    if (diff === undefined || diff.binary === true || diff.tooLarge === true) return null;
    const [was, now] = versionDiffSides(change.path, diff.before, diff.after);
    return diffHunks(diffLines(was, now), DIFF_CONTEXT_LINES);
  }, [change.path, diff]);
  const body =
    diff === undefined ? null : hunks === null ? (
      <p className="text-[12px] text-chrome-muted">{TOO_MUCH_CHANGED_MESSAGE}</p>
    ) : (
      <DiffLines hunks={hunks} />
    );
  if (!isPageFilePath(change.path))
    return (
      <section aria-label={name} className="flex flex-col gap-1.5">
        <h4 className="flex items-center justify-between gap-2 text-[12px] text-chrome-muted">
          <span className="truncate">{name}</span>
          {change.kind === 'edited' ? null : <span>{VERSION_CHANGE_LABELS[change.kind]}</span>}
        </h4>
        {body}
      </section>
    );
  const tally = hunks === null ? null : diffStats(hunks.flatMap((hunk) => hunk.lines));
  return (
    <details aria-label={name} className="group flex flex-col gap-1.5">
      <summary
        aria-label={describeVersionDiffChange(name, change.kind, tally)}
        className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md text-[12px] text-chrome-muted outline-none focus-visible:ring-2 focus-visible:ring-chrome-focus [&::-webkit-details-marker]:hidden"
      >
        <span className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 flex-none transition-transform group-open:rotate-90" aria-hidden="true" />
          <span className="truncate">{name}</span>
        </span>
        <span aria-hidden="true" className="flex gap-1.5">
          {VERSION_CHANGE_LABELS[change.kind]}
          {tally !== null && tally.added > 0 ? <span className="text-success">+{tally.added}</span> : null}
          {tally !== null && tally.removed > 0 ? <span className="text-danger">−{tally.removed}</span> : null}
        </span>
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5">{body}</div>
    </details>
  );
}

interface VersionReads {
  diffs: Map<string, HistoryFileDiff>;
  pageBefore: boolean | undefined;
}

/** Reads each change's before and after, and what the dashboard held before the version. */
function useVersionReads(version: HistoryVersion, changes: readonly VersionChange[]): VersionReads | null {
  const [reads, setReads] = useState<VersionReads | null>(null);
  useEffect(() => {
    const history = historyCapability();
    if (history === null) return;
    let live = true;
    setReads(null);
    const diffs = Promise.all(
      changes.map((change) =>
        history.diff(version.n, historyPathOf(change.path)).then(
          (diff): [string, HistoryFileDiff] | null => [change.path, diff],
          () => null,
        ),
      ),
    );
    const files = history.files(version.n).then(
      (listing) => hadPageBefore(version, Object.keys(listing)),
      () => undefined,
    );
    void Promise.all([diffs, files]).then(([found, pageBefore]) => {
      if (live) setReads({ diffs: new Map(found.filter((entry): entry is [string, HistoryFileDiff] => entry !== null)), pageBefore });
    });
    return () => {
      live = false;
    };
  }, [version, changes]);
  return reads;
}

function VersionDetail({ version, versions, now }: { version: HistoryVersion; versions: readonly HistoryVersion[]; now: number }): ReactNode {
  const changes = useMemo(() => listVersionChanges(version), [version]);
  const reads = useVersionReads(version, changes);
  const canRestore = useVersionHistory((state) => state.canRestore);
  const restoring = useVersionHistory((state) => state.restoring);
  const problem = useVersionHistory((state) => state.problem);
  const titles = useMemo(() => {
    const found: Record<string, string> = {};
    for (const [path, diff] of reads?.diffs ?? []) {
      const title = datasetTitleOf(diff.after) || datasetTitleOf(diff.before);
      if (title !== '') found[path] = title;
    }
    return found;
  }, [reads]);
  const restored = version.restoredFrom === undefined ? undefined : versions.find((item) => item.n === version.restoredFrom);
  const oldest = versions[versions.length - 1]?.n === version.n;
  const description = describeDataVersion(version, {
    restoredAt: restored === undefined ? undefined : Date.parse(restored.at),
    pageBefore: reads?.pageBefore,
    titles,
    oldest,
    now,
  });
  const isNow = version.current === true;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-medium text-chrome-fg">{formatVersionDay(Date.parse(version.at), now)}</h3>
          <p className="text-[13px] text-chrome-muted">{versionByline(versionWho(version.author), description)}</p>
        </div>
        {reads === null ? (
          <LoaderCircle className="size-4 animate-spin text-chrome-muted" aria-hidden="true" />
        ) : (
          changes.map((change) => <ChangeDiff key={change.path} change={change} name={versionChangeName(change, titles)} diff={reads.diffs.get(change.path)} />)
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-chrome-line p-3">
        {problem !== null || isNow ? (
          <p className="text-[12px] text-chrome-muted" role={problem !== null ? 'alert' : undefined}>
            {problem ?? IS_NOW_MESSAGE}
          </p>
        ) : null}
        {!isNow && canRestore ? (
          <Button variant="primary" className="self-end" disabled={restoring} aria-busy={restoring || undefined} onClick={() => void restoreVersion(version.n)}>
            {restoring ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {restoring ? RESTORING_LABEL : RESTORE_LABEL}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The panel's content; the toolbar or app owner frames it (title, close) and opens it with `toggleVersionHistory`. */
export function HistoryPanel(): ReactNode {
  const versions = useVersionHistory((state) => state.versions);
  const failed = useVersionHistory((state) => state.failed);
  const opened = useVersionHistory((state) => state.opened);
  const now = Date.now();
  if (versions === null)
    return failed ? (
      <p className="p-4 text-[13px] text-chrome-muted">{HISTORY_UNREADABLE_MESSAGE}</p>
    ) : (
      <div className="flex justify-center p-4">
        <LoaderCircle className="size-4 animate-spin text-chrome-muted" aria-hidden="true" />
      </div>
    );
  const version = opened === null ? undefined : versions.find((item) => item.n === opened);
  if (version === undefined) return <VersionList versions={versions} now={now} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pt-2">
        <Button variant="ghost" size="sm" onClick={() => openVersion(null)}>
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {BACK_TO_VERSIONS_LABEL}
        </Button>
      </div>
      <VersionDetail key={version.n} version={version} versions={versions} now={now} />
    </div>
  );
}
