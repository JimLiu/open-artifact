/**
 * The page's frame: the top bar (title, save state, undo, "Send to agent"),
 * the conflict bar, the read-only notice and the composer.
 */

import { Bot, GitCompare, Loader2, Lock, Redo2, RefreshCw, Send, Undo2, Wrench, Workflow, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, IconButton, ScrollBody, cn, diffLines, isComposingKey } from '@open-artifact/ui';
import { useFiles, type Conflict } from '../state/files.ts';
import { useModel } from '../state/model.ts';
import { useView } from '../state/view.ts';
import { REQUESTS, sendPrepared, sendToAgent, useAgent } from '../services/agent.ts';
import { keepMine, saveMineAsCopy, takeTheirs } from '../services/sync.ts';
import { maybeSession } from '../services/session.ts';
import { systemComments, useComments } from '../services/comments.ts';
import { changesSinceSync, useHistory, type SyncChange } from '../services/history.ts';
import { HistoryButton, PeerAvatars } from './Collab.tsx';
import { MOD } from '@open-artifact/editor-kit';
import { CommentsButton, useShellDraw } from '@open-artifact/editor-kit/react';

const SAVE_LABEL = {
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  offline: 'Offline — retrying',
  readonly: 'View only',
} as const;

/** The top bar. */
export function TopBar() {
  const model = useModel();
  const save = useFiles((s) => s.save);
  const canUndo = useFiles((s) => s.undo.length > 0 && !s.readOnly);
  const canRedo = useFiles((s) => s.redo.length > 0 && !s.readOnly);
  const status = useAgent((s) => s.status);
  const openComposer = useView((s) => s.openComposer);
  const commentsAvailable = useComments((s) => s.available);
  const s = maybeSession();
  const inShell = Boolean(s?.shell);
  const owner = Boolean(s?.isOwner);
  // In a Shell its bar shows the title, the save state and the agent: the page keeps only its own controls.
  const shellSaved = useShellDraw(s?.shell, 'saved');
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      {shellSaved ? (
        <div className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">{model.index.lastChange ? `Last change by ${model.index.lastChange.by}` : null}</div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-fg">{model.index.title || 'Design system'}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <span className={cn('size-1.5 rounded-full', save === 'saved' ? 'bg-success' : save === 'offline' ? 'bg-warning' : save === 'readonly' ? 'bg-fg-subtle' : 'bg-accent')} />
            {SAVE_LABEL[save]}
            {model.index.lastChange ? <span className="truncate">· last change by {model.index.lastChange.by}</span> : null}
          </div>
        </div>
      )}
      <PeerAvatars />
      {/* Outside a Shell the page offers its own Comments and History buttons. */}
      {commentsAvailable && !inShell ? <CommentsButton comments={systemComments} /> : null}
      {!inShell ? <HistoryButton /> : null}
      <IconButton label="Undo" shortcut={`${MOD}Z`} icon={<Undo2 className="size-4" />} disabled={!canUndo} onClick={() => useFiles.getState().undoStep()} />
      <IconButton label="Redo" shortcut={`${MOD}⇧Z`} icon={<Redo2 className="size-4" />} disabled={!canRedo} onClick={() => useFiles.getState().redoStep()} />
      {inShell ? null : (
        <span
          title={status.available ? (status.busy ? `${status.name} is working` : `${status.name} is connected`) : 'No agent connected'}
          className={cn('mx-1 size-2 rounded-full', status.available ? (status.busy ? 'animate-pulse bg-accent' : 'bg-success') : 'bg-fg-subtle/50')}
        />
      )}
      {owner ? (
        <Button variant="primary" icon={<Bot className="size-3.5" />} onClick={() => openComposer()}>
          Send to agent
        </Button>
      ) : null}
    </header>
  );
}

/** Notice for systems the page must not edit, with what the owner can do about it. */
export function ReadOnlyBar() {
  const reason = useFiles((s) => s.readOnlyReason);
  const readOnly = useFiles((s) => s.readOnly);
  const previewing = useFiles((s) => s.preview !== null);
  const historyAvailable = useHistory((s) => s.available);
  const [sent, setSent] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  if (!readOnly || previewing) return null;
  const s = maybeSession();
  const role = s?.viewer.role;
  const owner = Boolean(s?.isOwner && s.agent);
  const text =
    reason === 'index'
      ? 'Editing is paused until design-system.json has a valid files index and creation or conversion marker.'
      : reason === 'code'
      ? 'This design system is synced from code. Change it in the code and sync again.'
      : reason === 'off'
        ? 'Editing is turned off until this design system is set up and cleaned up.'
        : role === 'commenter'
          ? 'You can view and comment on this design system.'
          : 'You can view this design system but not change it.';
  const request = async (prepared: string): Promise<void> => {
    const result = await sendPrepared(prepared);
    if (result && result.status !== 'failed') setSent(true);
  };
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5 text-[12px] text-fg-muted">
      <Lock className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      {reason === 'code' && historyAvailable ? (
        <Button size="sm" variant="ghost" icon={<GitCompare className="size-3.5" />} onClick={() => setDiffOpen(true)}>
          Changes since last sync
        </Button>
      ) : null}
      {reason === 'code' && owner ? (
        <Button size="sm" icon={<RefreshCw className="size-3.5" />} disabled={sent} onClick={() => void request(REQUESTS.resyncFromCode)}>
          {sent ? 'Resync requested' : 'Resync from code'}
        </Button>
      ) : null}
      {reason === 'off' && owner ? (
        <Button size="sm" variant="primary" icon={<Wrench className="size-3.5" />} disabled={sent} onClick={() => void request(REQUESTS.finishSetup)}>
          {sent ? 'Sent to the agent' : 'Finish setting up'}
        </Button>
      ) : null}
      {diffOpen ? <SyncDiffDialog onClose={() => setDiffOpen(false)} /> : null}
    </div>
  );
}

/** "Changes since last sync": files changed after the last code sync (or what that sync changed). */
function SyncDiffDialog({ onClose }: { onClose(): void }) {
  const [state, setState] = useState<{
    loading: boolean;
    title: string;
    files: SyncChange[];
  }>({ loading: true, title: '', files: [] });
  useEffect(() => {
    let live = true;
    changesSinceSync().then(
      (result) => {
        if (!live) return;
        if (!result)
          setState({
            loading: false,
            title: 'No sync from code is in the history yet.',
            files: [],
          });
        else {
          const when = new Date(result.since.at).toLocaleString();
          setState({
            loading: false,
            title: result.later ? `Changed since the sync of ${when} (version ${result.since.n})` : `What the sync of ${when} changed (nothing changed since)`,
            files: result.files,
          });
        }
      },
      (error: unknown) =>
        live &&
        setState({
          loading: false,
          title: error instanceof Error ? error.message : String(error),
          files: [],
        }),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Changes since last sync"
      description={state.loading ? 'Reading the history…' : state.title}
      className="w-[min(56rem,calc(100vw-2rem))]"
    >
      {state.loading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-fg-subtle" />
      ) : (
        <ScrollBody className="max-h-[60vh] space-y-3 overflow-auto">
          {state.files.map((file) => (
            <div key={file.path} className="rounded-lg border border-line">
              <div className="border-b border-line bg-surface-2 px-2 py-1 font-mono text-[12px] text-fg">
                {file.path}
                {file.before === null ? ' (added)' : file.after === null ? ' (deleted)' : ''}
              </div>
              <pre className="overflow-x-auto p-2 font-mono text-[11px] leading-relaxed">
                {diffLines(file.before, file.after)
                  .filter((line, i, all) => line.op !== ' ' || all.slice(Math.max(0, i - 2), i + 3).some((near) => near.op !== ' '))
                  .slice(0, 400)
                  .map((line, i) => (
                    <div key={i} className={cn(line.op === '-' && 'bg-danger/10 text-danger', line.op === '+' && 'bg-success/10 text-success')}>
                      {line.op === ' ' ? '  ' : `${line.op} `}
                      {line.text}
                    </div>
                  ))}
              </pre>
            </div>
          ))}
        </ScrollBody>
      )}
    </Dialog>
  );
}

/** A banner while the last change came from a pipeline (CI): edits here will be overwritten by its next run. */
export function PipelineBanner() {
  const via = useModel().index.lastChange?.via ?? '';
  const by = useModel().index.lastChange?.by ?? '';
  const [hidden, setHidden] = useState(false);
  if (hidden || !/^ci\b/i.test(via)) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5 text-[12px] text-fg-muted">
      <Workflow className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        Last updated by a pipeline ({via}
        {by ? `, ${by}` : ''}). Changes made here may be replaced on its next run; change the source it reads instead.
      </span>
      <IconButton size="sm" label="Dismiss" icon={<X className="size-3.5" />} onClick={() => setHidden(true)} />
    </div>
  );
}

/** A minimal line diff (longest common subsequence), for the conflict dialog. */
function lineDiff(a: string, b: string): { kind: 'same' | 'mine' | 'theirs'; text: string }[] {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x.length * y.length > 4_000_000) return [...x.map((text) => ({ kind: 'mine' as const, text })), ...y.map((text) => ({ kind: 'theirs' as const, text }))];
  const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i]![j] = x[i] === y[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: { kind: 'same' | 'mine' | 'theirs'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push({ kind: 'same', text: x[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) out.push({ kind: 'mine', text: x[i++]! });
    else out.push({ kind: 'theirs', text: y[j++]! });
  }
  while (i < x.length) out.push({ kind: 'mine', text: x[i++]! });
  while (j < y.length) out.push({ kind: 'theirs', text: y[j++]! });
  return out;
}

/** The conflict bar: one row per file both sides changed. */
export function ConflictBar() {
  const conflicts = useFiles((s) => s.conflicts);
  const [diff, setDiff] = useState<Conflict | null>(null);
  if (!conflicts.length) return null;
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-warning/40 bg-warning/10 px-4 py-2 text-[12px] text-fg">
      {conflicts.map((conflict) => (
        <div key={conflict.path} className="flex flex-wrap items-center gap-2">
          <GitCompare className="size-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="font-mono">{conflict.path}</span> {conflict.recovered ? 'has unsaved edits recovered from this tab.' : conflict.theirs === null ? 'was deleted elsewhere while you were editing it.' : 'was changed elsewhere while you were editing it.'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setDiff(conflict)}>
            See changes
          </Button>
          <Button size="sm" onClick={() => takeTheirs(conflict.path)}>
            Use theirs
          </Button>
          <Button size="sm" onClick={() => keepMine(conflict.path)}>
            Keep mine
          </Button>
          {conflict.mine !== null ? (
            <Button size="sm" onClick={() => saveMineAsCopy(conflict.path)}>
              Keep as copy
            </Button>
          ) : null}
        </div>
      ))}
      <Dialog
        open={diff !== null}
        onOpenChange={(open) => !open && setDiff(null)}
        title={diff ? `Changes to ${diff.path}` : ''}
        description="Lines marked − are only in your version; lines marked + only in theirs."
        className="w-[min(56rem,calc(100vw-2rem))]"
      >
        {diff ? (
          <ScrollBody className="max-h-[60vh] overflow-auto rounded-lg bg-surface-2 p-2">
            <pre className="font-mono text-[12px] leading-relaxed">
              {lineDiff(diff.mine ?? '', diff.theirs ?? '').map((line, index) => (
                <div key={index} className={cn(line.kind === 'mine' && 'bg-danger/10 text-danger', line.kind === 'theirs' && 'bg-success/10 text-success')}>
                  {line.kind === 'mine' ? '− ' : line.kind === 'theirs' ? '+ ' : '  '}
                  {line.text}
                </div>
              ))}
            </pre>
          </ScrollBody>
        ) : null}
      </Dialog>
    </div>
  );
}

/** What a request from the composer is about. */
function useSubject(): string {
  const focus = useView((s) => s.focus);
  const section = useView((s) => s.section);
  if (focus) return `${focus.kind} “${focus.name}”`;
  return section.startsWith('family:') ? section.slice('family:'.length) : section;
}

/** The "Send to agent" composer. */
export function Composer() {
  const open = useView((s) => s.composer);
  const draft = useView((s) => s.draft);
  const close = useView((s) => s.closeComposer);
  const status = useAgent((s) => s.status);
  const subject = useSubject();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setText(draft);
    requestAnimationFrame(() => {
      const element = area.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
  }, [open, draft]);

  if (!open || !maybeSession()?.isOwner) return null;
  const submit = async (): Promise<void> => {
    if (!text.trim() || sending) return;
    setSending(true);
    const result = await sendToAgent(text);
    setSending(false);
    if (result && result.status !== 'failed') {
      setText('');
      close();
    }
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-[min(560px,100%)] rounded-xl bg-surface p-2 shadow-popup">
        <div className="flex items-center gap-2 px-1 pb-1.5 text-[12px] text-fg-muted">
          <Bot className="size-3.5" />
          <span className="flex-1 truncate">
            About <span className="text-fg">{subject}</span>
          </span>
          <IconButton size="sm" label="Close" icon={<X className="size-3.5" />} onClick={close} />
        </div>
        <textarea
          ref={area}
          value={text}
          rows={3}
          placeholder={status.available ? 'Describe the change you want…' : 'No agent is connected. Your request will wait until one checks this design system.'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (isComposingKey(event.nativeEvent)) return;
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
          className="block w-full resize-none rounded-lg border border-line bg-surface-2 p-2 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <div className="flex items-center justify-between gap-2 pt-1.5">
          <span className="px-1 text-[11px] text-fg-subtle">{MOD}Enter to send</span>
          <Button variant="primary" icon={<Send className="size-3.5" />} disabled={!text.trim() || sending} onClick={() => void submit()}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
