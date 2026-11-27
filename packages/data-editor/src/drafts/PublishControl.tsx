/**
 * The shared draft's controls: Publish (with the draft menu) while the draft
 * shows, "Published" (with the version menu) while nothing waits, "See
 * draft" / "See published", the Undo / Redo of this viewer's steps in the
 * draft, and the questions they ask.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Eye, History, RotateCcw, Trash2, Zap } from 'lucide-react';
import { announce } from '@open-artifact/editor-kit';
import { Button, ConfirmDialog, Dialog, Menu, MenuItem, MenuLabel, MenuSeparator, MenuSwitchItem, cn, toast } from '@open-artifact/ui';
import { openPanel } from '../app/panels.ts';
import { useStyleEditor } from '../design/style.ts';
import { followVersions, revertToBefore, useVersionHistory } from '../history/store.ts';
import { formatVersionDay } from '../history/describe.ts';
import { maybeSession } from '../services/session.ts';
import { useDocument } from '../state/document.ts';
import { EditHistoryButtons } from './EditBar.tsx';
import { discardFromEdit, savePageEdits, useEditFlow } from './edit-flow.ts';
import { useEditKeys } from './keys.ts';
import { usePersonName } from './people.ts';
import {
  answerReplace,
  answerShared,
  discardShared,
  publishShared,
  redoShared,
  seeShared,
  setAutoPublish,
  undoShared,
  useSharedDraft,
} from './shared-flow.ts';
import {
  AUTO_PUBLISH_DESCRIPTION,
  AUTO_PUBLISH_LABEL,
  AUTO_PUBLISH_TITLE,
  DISCARD_DRAFT_LABEL,
  DISCARD_LABEL,
  DRAFT_OPTIONS_LABEL,
  DRAFT_SEEN_BY_ALL_LABEL,
  KEEP_DRAFT_LABEL,
  KEEP_NEWER_LABEL,
  PUBLISHED_LABEL,
  PUBLISHING_LABEL,
  PUBLISH_LABEL,
  REPLACE_NEWER_DESCRIPTION,
  REPLACE_NEWER_TITLE,
  RESTORE_DRAFT_LABEL,
  REVERTED_LABEL,
  REVERT_LABEL,
  REVERT_MOVED_MESSAGE,
  REVERT_TITLE,
  SEE_DRAFT_LABEL,
  SEE_HISTORY_LABEL,
  SEE_PUBLISHED_LABEL,
  TURN_ON_LABEL,
  YOU_LABEL,
  AGENT_LABEL,
  draftQuestionTitle,
  revertDescription,
  sharedQuestionDescription,
  versionMadeBy,
} from './words.ts';

/** A second press within this long is the rest of a double click, ms. */
const PRESS_GAP_MS = 500;
/** How long the control takes to fade to a new state, ms. */
const FADE_MS = 300;

function useLast<T>(value: T | null, initial: T): T {
  const last = useRef(initial);
  if (value !== null) last.current = value;
  return last.current;
}

/** "{when} by {name}" for a version: "you" for this viewer's, "the agent" for the agent's, the time alone for a restore. */
function useVersionWhen(version: { at: string; author: { kind: string; id: string; name: string }; restoredFrom?: number } | undefined): string {
  const me = maybeSession()?.viewer.id ?? '';
  const person = version?.author.kind === 'person' && version.author.id !== me ? version.author.id : '';
  const looked = usePersonName(person);
  if (version === undefined) return '';
  const when = formatVersionDay(Date.parse(version.at));
  const { author } = version;
  const name =
    author.kind === 'person'
      ? author.id === me
        ? YOU_LABEL
        : author.name || looked
      : author.kind === 'agent' || version.restoredFrom === undefined
        ? AGENT_LABEL
        : '';
  return versionMadeBy(when, name);
}

function seeHistory(): void {
  if (useVersionHistory.getState().available) openPanel('history');
}

/** The draft's Publish, its menu, and the version menu or See draft / See published. Null when none shows. */
export function PublishControl(): ReactNode {
  const flow = useSharedDraft();
  const editing = useEditFlow((state) => state.joint && state.phase !== 'off');
  const pending = useEditFlow((state) => state.joint && state.pending);
  const autoStored = useDocument((state) => state.content.autoPublish !== false);
  const versions = useVersionHistory((state) => state.versions);
  const historyAvailable = useVersionHistory((state) => state.available);
  const { view } = flow;
  const seat = useRef<HTMLSpanElement>(null);
  const pressed = useRef(-Infinity);
  const flipped = useRef(-Infinity);
  const [menu, setMenu] = useState<'none' | 'draft' | null>(null);
  const [reverting, setReverting] = useState<{ open: boolean; to: string; newest: number; previous: number } | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  const [askAuto, setAskAuto] = useState(false);
  const on = flow.on;
  useEffect(() => (on && historyAvailable ? followVersions() : undefined), [on, historyAvailable]);

  // While hand edits are under way, the draft shows and can be published once they hold a change.
  const shows = editing ? (view.ready || pending ? 'draft' : 'none') : view.shows;
  const [last, setLast] = useState(shows === 'held' ? 'none' : shows);
  if (shows !== 'held' && shows !== last) setLast(shows);
  const [faded, setFaded] = useState(shows);
  useEffect(() => {
    const timer = setTimeout(() => setFaded(shows), FADE_MS);
    return () => clearTimeout(timer);
  }, [shows]);
  const held = shows === 'held';
  const none = last === 'none';
  const auto = flow.autoSet ?? autoStored;
  const publishesNow = !flow.turn && view.others.length === 0;
  const newest = versions?.[0];
  const previous = versions?.[1];
  const newestWhen = useVersionWhen(newest);
  const previousWhen = useVersionWhen(previous);
  // Unsaved style changes hold Revert back too.
  const styleOpen = useStyleEditor((state) => state.pending !== null);
  const canRevert =
    previous !== undefined && newest !== undefined && !editing && !styleOpen && !flow.turn && flow.publishing === null && (maybeSession()?.canRestore ?? false);
  if (menu !== null && menu !== shows) setMenu(null);
  if (askAuto && (shows !== 'draft' || auto || !publishesNow)) setAskAuto(false);
  if (reverting?.open === true && !revertBusy && (shows !== 'none' || !canRevert)) setReverting({ ...reverting, open: false });

  if (!view.drawn || (!on && !view.ready)) return null;
  const lastButton = (): HTMLElement | null => [...(seat.current?.querySelectorAll('button') ?? [])].at(-1) ?? null;
  const spaced = (since = pressed): boolean => performance.now() - since.current > PRESS_GAP_MS;
  const publish = (): void => {
    if (!spaced()) return;
    pressed.current = performance.now();
    if (editing) void savePageEdits();
    else publishShared();
  };
  const discard = (): void => (editing ? discardFromEdit() : discardShared());
  // Turning it on from the draft's menu asks first when the draft would go live at once (the menu closes then).
  const autoItem = (ask: boolean): ReactNode => {
    if (!on) return null;
    const asks = ask && !auto && publishesNow;
    return (
      <MenuSwitchItem
        icon={<Zap className="size-3.5" />}
        checked={auto}
        closeOnClick={asks}
        onCheckedChange={(next) => {
          if (asks) {
            setMenu(null);
            setAskAuto(true);
            return;
          }
          void setAutoPublish(next);
        }}
      >
        {AUTO_PUBLISH_LABEL}
      </MenuSwitchItem>
    );
  };

  return (
    <>
      <span ref={seat} className={cn('dash-draft-seat inline-flex items-center gap-0.5', faded !== shows && 'opacity-60 transition-opacity')} data-fades={faded === shows ? undefined : ''}>
        {none && on ? (
          <Menu
            align="end"
            open={menu === 'none'}
            onOpenChange={(open) => setMenu(open ? 'none' : null)}
            trigger={
              <Button variant="secondary" disabled={held} aria-busy={flow.publishing === 'auto' || undefined} aria-haspopup="menu">
                {PUBLISHED_LABEL}
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            }
          >
            {newestWhen === '' ? null : <MenuLabel>{newestWhen}</MenuLabel>}
            {canRevert ? (
              <MenuItem
                icon={<RotateCcw className="size-3.5" />}
                onSelect={() => newest !== undefined && previous !== undefined && setReverting({ open: true, to: previousWhen, newest: newest.n, previous: previous.n })}
              >
                {REVERT_LABEL}
              </MenuItem>
            ) : null}
            <MenuItem icon={<History className="size-3.5" />} onSelect={seeHistory}>
              {SEE_HISTORY_LABEL}
            </MenuItem>
            {on ? <MenuSeparator /> : null}
            {autoItem(false)}
          </Menu>
        ) : null}
        {last === 'draft' ? (
          <span role="group" aria-label={DRAFT_OPTIONS_LABEL} className="inline-flex">
            <Button
              variant="primary"
              className="rounded-e-none"
              disabled={held}
              aria-busy={flow.publishing !== null || undefined}
              aria-label={flow.publishing !== null ? PUBLISHING_LABEL : PUBLISH_LABEL}
              onClick={() => (flow.publishing === null ? publish() : undefined)}
            >
              {flow.publishing !== null ? PUBLISHING_LABEL : PUBLISH_LABEL}
            </Button>
            <Menu
              align="end"
              open={menu === 'draft'}
              onOpenChange={(open) => setMenu(open ? 'draft' : null)}
              trigger={
                <Button variant="primary" className="rounded-s-none border-s border-white/20 px-1.5" disabled={held} aria-label={DRAFT_OPTIONS_LABEL}>
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </Button>
              }
            >
              <MenuLabel>{DRAFT_SEEN_BY_ALL_LABEL}</MenuLabel>
              {view.canSee && !editing ? (
                <MenuItem icon={<Eye className="size-3.5" />} onSelect={() => seeShared(false)}>
                  {SEE_PUBLISHED_LABEL}
                </MenuItem>
              ) : null}
              <MenuItem icon={<History className="size-3.5" />} onSelect={seeHistory}>
                {SEE_HISTORY_LABEL}
              </MenuItem>
              <MenuSeparator />
              {autoItem(true)}
              <MenuItem icon={<Trash2 className="size-3.5" />} danger disabled={flow.publishing !== null} onSelect={discard}>
                {DISCARD_DRAFT_LABEL}
              </MenuItem>
            </Menu>
          </span>
        ) : null}
        {last === 'viewing' ? (
          <Button
            variant="secondary"
            disabled={held}
            onClick={() => {
              if (!spaced()) return;
              flipped.current = performance.now();
              seeShared(false);
            }}
          >
            {SEE_PUBLISHED_LABEL}
          </Button>
        ) : null}
        {last === 'published' ? (
          <Button
            variant="ghost"
            className="bg-chrome-accent/10 text-chrome-accent"
            disabled={held}
            onClick={() => {
              if (!spaced(flipped)) return;
              pressed.current = performance.now();
              seeShared(true);
            }}
          >
            {SEE_DRAFT_LABEL}
          </Button>
        ) : null}
      </span>
      {reverting === null ? null : (
        <ConfirmDialog
          open={reverting.open}
          onOpenChange={(open) => {
            if (!revertBusy) setReverting({ ...reverting, open });
          }}
          title={REVERT_TITLE}
          description={revertDescription(reverting.to)}
          confirmLabel={REVERT_LABEL}
          initialFocus="cancel"
          finalFocus={lastButton}
          onConfirm={() => {
            setRevertBusy(true);
            seeShared(false);
            void revertToBefore(reverting.newest, reverting.previous, REVERT_MOVED_MESSAGE).then((problem) => {
              setRevertBusy(false);
              setReverting((was) => (was === null ? null : { ...was, open: false }));
              if (problem === null) announce(REVERTED_LABEL);
              else toast.add({ title: problem, timeout: 10_000 });
            });
          }}
        />
      )}
      <ConfirmDialog
        open={askAuto}
        onOpenChange={setAskAuto}
        title={AUTO_PUBLISH_TITLE}
        description={AUTO_PUBLISH_DESCRIPTION}
        confirmLabel={TURN_ON_LABEL}
        initialFocus="cancel"
        finalFocus={lastButton}
        onConfirm={() => {
          void setAutoPublish(true);
          publish();
        }}
      />
    </>
  );
}

/** The publish / discard question and "Replace newer changes in the draft?"; mount once beside the page. */
export function SharedDraftDialogs(): ReactNode {
  const asking = useSharedDraft((state) => state.asking);
  const replacing = useSharedDraft((state) => state.replacing);
  const others = useSharedDraft((state) => state.view.others);
  const first = usePersonName(others[0] ?? '');
  const second = usePersonName(others[1] ?? '');
  const names = others.length === 0 ? null : others.length > 2 || first === '' || (others.length === 2 && second === '') ? '' : others.length === 1 ? first : `${first} and ${second}`;
  const last = useLast(asking === null ? null : { what: asking, names }, { what: 'discard' as const, names: null as string | null });
  const save = last.what === 'save';
  return (
    <>
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) answerShared(false);
        }}
        title={draftQuestionTitle(last.what, null)}
        description={sharedQuestionDescription(last.what, last.names)}
        footer={
          <>
            <Button autoFocus onClick={() => answerShared(false)}>
              {KEEP_DRAFT_LABEL}
            </Button>
            <Button variant={save ? 'primary' : 'danger'} onClick={() => answerShared(true)}>
              {save ? PUBLISH_LABEL : DISCARD_LABEL}
            </Button>
          </>
        }
      />
      <Dialog
        open={replacing !== null}
        onOpenChange={(open) => {
          if (!open) answerReplace(false);
        }}
        title={REPLACE_NEWER_TITLE}
        description={REPLACE_NEWER_DESCRIPTION}
        footer={
          <>
            <Button autoFocus onClick={() => answerReplace(false)}>
              {KEEP_NEWER_LABEL}
            </Button>
            <Button variant="danger" onClick={() => answerReplace(true)}>
              {RESTORE_DRAFT_LABEL}
            </Button>
          </>
        }
      />
    </>
  );
}

/**
 * Undo / Redo on their own: this viewer's steps in the shared draft, or the page editor's while editing by hand. Null
 * when there is nothing to step.
 */
export function SharedUndoBar({ tipSide = 'bottom' }: { tipSide?: 'top' | 'bottom' }): ReactNode {
  const steps = useSharedDraft((state) => state.steps);
  const moving = useSharedDraft((state) => state.moving);
  const on = useSharedDraft((state) => state.on);
  const passing = useSharedDraft((state) => state.publishing !== null);
  const asking = useSharedDraft((state) => state.asking !== null);
  const editing = useEditFlow((state) => state.phase !== 'off');
  const shown = useRef(false);
  const canUndo = steps.undo.length > 0;
  const canRedo = steps.redo.length > 0;
  shown.current = on && !editing && !passing && (canUndo || canRedo || (shown.current && moving));
  // The usual keys step through this viewer's changes to the draft while no edit takes them.
  useEditKeys(on && !editing && !asking && (canUndo || canRedo), (key) => {
    if (key === 'save' || moving || passing) return false;
    if (key === 'undo' ? !canUndo : !canRedo) return false;
    if (key === 'undo') undoShared();
    else redoShared();
    return true;
  });
  if (!shown.current) return null;
  return (
    <EditHistoryButtons
      alone
      tipSide={tipSide}
      edit={{ phase: 'editing', canUndo: canUndo && !moving, canRedo: canRedo && !moving, undo: undoShared, redo: redoShared }}
    />
  );
}
