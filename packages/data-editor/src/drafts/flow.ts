/**
 * The draft flow: follows the viewer's open draft, shows it on the page,
 * saves it as the dashboard or discards it, and starts a remix by asking
 * the agent for a draft in another format.
 *
 * A draft is written beside the dashboard under `drafts/<id>` and changes
 * nothing for anyone until an editor saves it; saving writes the draft's
 * documents over the dashboard's in one batch (the history keeps the
 * version before). Only people who can edit see drafts.
 */

import { create } from 'zustand';
import { announce } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import {
  areDraftDocsEqual,
  draftHasPage,
  isDraftForArtifact,
  newDraftId,
  pickDraftHead,
  planDraftSave,
  remixFormName,
  remixPrompt,
  remixSelection,
  type DashboardFile,
  type DraftHead,
  type UnknownRecord,
} from '@open-artifact/data-core';
import type { SyncWrite } from '@open-artifact/live-store';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { maybeSession } from '../services/session.ts';
import { useDocument } from '../state/document.ts';
import { beginDraft, dropDrafts, followDraft, markDraftSaved, readDraft, startDrafts, useDrafts } from '../state/drafts.ts';
import { areDraftsFree, setShownDraft, useShown } from '../state/shown.ts';
import { liveDocument } from '../sync/index.ts';
import { DRAFT_ASKED_MS, DRAFT_ECHO_MS, STATUS_MS, contentHash, deriveDraftView, nextDraftAt, type DraftFlowView } from './draft-state.ts';
import { followPeople } from './people.ts';
import { canAskAgent, sendPageRequest } from './request.ts';
import {
  CANCEL_REQUEST_FAILED_MESSAGE,
  DRAFT_BEHIND_MESSAGE,
  DRAFT_CHANGED_MESSAGE,
  DRAFT_DISCARD_FAILED_MESSAGE,
  DRAFT_DISCARDED_LABEL,
  DRAFT_GONE_MESSAGE,
  DRAFT_HIDDEN_MESSAGE,
  DRAFT_PARTLY_SAVED_MESSAGE,
  DRAFT_READ_ONLY_MESSAGE,
  DRAFT_READY_MESSAGE,
  DRAFT_SHOWN_MESSAGE,
  DRAFT_START_FAILED_MESSAGE,
  DRAFT_UNREADABLE_MESSAGE,
  DRAFT_WORKING_LABEL,
  REQUEST_CANCELED_LABEL,
  SAVED_LABEL,
  type DraftQuestion,
} from './words.ts';

interface DraftFlowState {
  hidden: ReadonlySet<string>;
  opened: { id: string; open: boolean } | null;
  startedId: string | null;
  askedId: string | null;
  asked: boolean;
  saving: boolean;
  /** The save or discard question open for a draft. */
  asking: { id: string; what: DraftQuestion } | null;
  savedBase: { id: string; base: string } | null;
  /** A short status line ("Saved", "Draft discarded"), cleared after a few seconds. */
  status: string | null;
  view: DraftFlowView;
}

function viewer(): string {
  return maybeSession()?.viewer.id ?? '';
}

function inputsView(state: Omit<DraftFlowState, 'view'>): DraftFlowView {
  const drafts = useDrafts.getState();
  return deriveDraftView({
    heads: drafts.heads,
    hidden: state.hidden,
    viewer: viewer(),
    artifact: null,
    followedId: drafts.id,
    docs: drafts.docs,
    heard: drafts.heard,
    startedId: state.startedId,
    opened: state.opened,
    askedId: state.askedId,
    asked: state.asked,
    saving: state.saving,
    agentWorking: useAgentActivity.getState().activity === 'working',
    content: useDocument.getState().content,
    free: areDraftsFree(useShown.getState()),
    savedBase: state.savedBase,
    now: Date.now(),
  });
}

const INITIAL: Omit<DraftFlowState, 'view'> = {
  hidden: new Set(),
  opened: null,
  startedId: null,
  askedId: null,
  asked: false,
  saving: false,
  asking: null,
  savedBase: null,
  status: null,
};

export const useDraftFlow = create<DraftFlowState>()(() => ({ ...INITIAL, view: inputsView(INITIAL) }));

let running = false;
let quietFlip = false;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let askedTimer: ReturnType<typeof setTimeout> | undefined;
let behindToast: string | null = null;
const checkedStarted = new Set<string>();
const droppingSpent = new Set<string>();
const droppedOverdue = new Set<string>();
let droppingOlder = '';

function update(patch: Partial<Omit<DraftFlowState, 'view'>>): void {
  useDraftFlow.setState(patch);
  refresh();
}

function say(words: string | null): void {
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  statusTimer = undefined;
  useDraftFlow.setState({ status: words });
  if (words === null) return;
  announce(words);
  statusTimer = setTimeout(() => useDraftFlow.setState({ status: null }), STATUS_MS);
}

function showToast(title: string, timeout = 10_000): void {
  toast.add({ title, timeout });
}

/** The heads this page offers. */
function visibleHeads(): DraftHead[] {
  const { hidden } = useDraftFlow.getState();
  return useDrafts.getState().heads.filter((head) => !hidden.has(head.id) && isDraftForArtifact(head, null));
}

/** Drops drafts and hides them meanwhile; `spent` ones stay hidden even when dropping fails. */
async function dropFromFlow(ids: string[], why?: 'spent' | 'bare'): Promise<boolean> {
  const spent = why === 'spent';
  update({ hidden: new Set([...useDraftFlow.getState().hidden, ...ids]) });
  const dropped = (await dropDrafts(ids, why === 'bare')) || (spent && (await dropDrafts(ids)));
  if (!dropped && !spent) update({ hidden: new Set([...useDraftFlow.getState().hidden].filter((id) => !ids.includes(id))) });
  return dropped;
}

function react(view: DraftFlowView, before: DraftFlowView): void {
  if (useDrafts.getState().id !== view.id) followDraft(view.id);
  const { heard } = useDrafts.getState();
  if (view.id !== null && view.mine && !view.ready && !heard && !checkedStarted.has(view.id)) {
    const id = view.id;
    checkedStarted.add(id);
    void readDraft(id).then((found) => {
      if (found !== null && !draftHasPage(found) && useDraftFlow.getState().view.id === id) update({ startedId: id });
    });
  }
  if (view.spentId !== null && !droppingSpent.has(view.spentId)) {
    droppingSpent.add(view.spentId);
    void dropFromFlow([view.spentId], 'spent');
  }
  if (view.overdueId !== null && !droppedOverdue.has(view.overdueId)) {
    droppedOverdue.add(view.overdueId);
    void dropFromFlow([view.overdueId], 'bare');
  }
  const olderKey = view.dropOlder ? view.older.join(' ') : '';
  if (olderKey !== '' && olderKey !== droppingOlder) {
    droppingOlder = olderKey;
    void dropFromFlow(view.older, 'spent');
  }
  setShownDraft(view.id !== null && view.applied !== null ? { id: view.id, content: view.applied } : null);
  const free = areDraftsFree(useShown.getState());
  if (view.showing !== before.showing) {
    if (view.showing) announce(DRAFT_SHOWN_MESSAGE);
    else if (free && !quietFlip) announce(DRAFT_HIDDEN_MESSAGE);
    quietFlip = false;
  }
  if (view.working && !before.working) announce(DRAFT_WORKING_LABEL);
  if (!view.working && before.working && view.ready && !areDraftDocsEqual(before.docs, view.docs)) announce(DRAFT_READY_MESSAGE);
  if (view.changedSince && behindToast === null) behindToast = toast.add({ title: DRAFT_BEHIND_MESSAGE, timeout: 0 });
  else if (!view.changedSince && behindToast !== null) {
    toast.close(behindToast);
    behindToast = null;
  }
}

function refresh(): void {
  const state = useDraftFlow.getState();
  const before = state.view;
  const view = inputsView(state);
  useDraftFlow.setState({ view });
  if (running) react(view, before);
}

function flip(show: boolean): void {
  const { id } = useDraftFlow.getState().view;
  if (id !== null) update({ opened: { id, open: show } });
}

function filesEqual(left: readonly DashboardFile[], right: readonly DashboardFile[]): boolean {
  return left.length === right.length && left.every((file, index) => file.name === right[index]?.name && file.text === right[index]?.text);
}

/** Resolves once the dashboard shows `files`, or after {@link DRAFT_ECHO_MS}. */
function waitForFiles(files: readonly DashboardFile[]): Promise<void> {
  return new Promise((resolve) => {
    let stop = (): void => {};
    const timer = setTimeout(() => done(), DRAFT_ECHO_MS);
    const done = (): void => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    if (filesEqual(useDocument.getState().content.files, files)) return done();
    stop = useDocument.subscribe((state) => {
      if (filesEqual(state.content.files, files)) done();
    });
  });
}

/** Writes a draft's documents over the dashboard's in one batch, each stamped as this viewer's edit. */
async function writeDraftPlan(plan: ReturnType<typeof planDraftSave>): Promise<boolean> {
  const live = liveDocument();
  if (live === null) return false;
  const now = Date.now();
  const by = viewer();
  const stamp = (data: UnknownRecord): UnknownRecord => {
    const edit = typeof data.edit === 'object' && data.edit !== null && !Array.isArray(data.edit) ? (data.edit as UnknownRecord) : {};
    return { ...data, edit: { ...edit, by, byAt: now } };
  };
  const writes: SyncWrite[] = [
    ...plan.write.map(([path, data]): SyncWrite => ({ op: 'set', path, data: stamp(data) })),
    ...plan.remove.map((path): SyncWrite => ({ op: 'delete', path })),
  ];
  try {
    await live.store.writeNow(writes);
    return true;
  } catch {
    return false;
  }
}

async function saveDraftNow(): Promise<void> {
  const { view, saving } = useDraftFlow.getState();
  const { id, composition } = view;
  if (id === null || composition === null || saving) return;
  if (!useDocument.getState().canWrite) return showToast(DRAFT_READ_ONLY_MESSAGE);
  update({ saving: true });
  let wrote = false;
  try {
    const stored = await readDraft(id);
    if (stored === null) return showToast(DRAFT_UNREADABLE_MESSAGE);
    if (!areDraftDocsEqual(stored, view.docs)) return showToast(stored.size === 0 ? DRAFT_GONE_MESSAGE : DRAFT_CHANGED_MESSAGE);
    quietFlip = true;
    wrote = true;
    if (!(await writeDraftPlan(planDraftSave(useDocument.getState().content.files, stored)))) {
      quietFlip = false;
      return showToast(DRAFT_PARTLY_SAVED_MESSAGE, 15_000);
    }
    await waitForFiles(composition.files);
    const done = [id, ...view.older];
    update({ hidden: new Set([...useDraftFlow.getState().hidden, ...done]) });
    // The page shows the saved dashboard now: say so before the draft is marked and cleared away.
    say(SAVED_LABEL);
    await markDraftSaved(id);
    await dropFromFlow(done, 'spent');
  } finally {
    update({
      saving: false,
      ...(wrote ? { savedBase: { id, base: contentHash(useDocument.getState().content) } } : {}),
    });
  }
}

/** Shows the saved dashboard instead of the draft. */
export function undoDraft(): void {
  if (useDraftFlow.getState().view.can.undo) flip(false);
}

/** Shows the draft again. */
export function redoDraft(): void {
  if (useDraftFlow.getState().view.can.redo) flip(true);
}

/** Saves the shown draft; someone else's asks first. */
export function saveDraft(): void {
  const { view } = useDraftFlow.getState();
  if (view.id === null || !view.can.save) return;
  if (view.mine) void saveDraftNow();
  else update({ asking: { id: view.id, what: 'save' } });
}

/** Cancel on the draft bar: asks before discarding a draft, or drops a request with no draft yet. */
export function cancelDraft(): void {
  const { view, saving } = useDraftFlow.getState();
  const { id } = view;
  if (id === null || saving) return;
  if (view.ready) return update({ asking: { id, what: 'discard' } });
  if (!view.unstarted || view.waiting) return;
  const me = viewer();
  const previous = pickDraftHead(
    visibleHeads().filter((head) => head.id !== id && head.by === me),
    me,
  )?.id;
  if (previous !== undefined) {
    update({ opened: { id: previous, open: false } });
    void readDraft(previous).then((found) => {
      if (found !== null && !draftHasPage(found) && useDraftFlow.getState().opened?.id === previous) update({ opened: null });
    });
  }
  void dropFromFlow([id], 'bare').then((dropped) => {
    if (dropped) return say(REQUEST_CANCELED_LABEL);
    void readDraft(id).then((found) => {
      if (found === null || !draftHasPage(found)) showToast(CANCEL_REQUEST_FAILED_MESSAGE);
    });
  });
}

/** Answers the save / discard question. */
export function answerDraft(yes: boolean): void {
  const { asking, view } = useDraftFlow.getState();
  update({ asking: null });
  if (!yes || asking === null) return;
  if (asking.what === 'save') return void saveDraftNow();
  quietFlip = view.showing;
  void dropFromFlow([asking.id, ...view.older]).then((dropped) => {
    if (!dropped) return showToast(DRAFT_DISCARD_FAILED_MESSAGE);
    say(DRAFT_DISCARDED_LABEL);
  });
}

/** Asks the agent for a draft of the dashboard in another format. */
export async function remixDraft(form: string): Promise<void> {
  const me = viewer();
  if (!running || me === '') return;
  const draftId = newDraftId();
  const mineBefore = visibleHeads().filter((head) => head.by === me);
  const begun = beginDraft({
    id: draftId,
    kind: 'remix',
    form,
    by: me,
    at: nextDraftAt(useDrafts.getState().heads, me, Date.now()),
    base: contentHash(useDocument.getState().content),
  });
  if (!canAskAgent()) {
    if (await begun) void dropDrafts([draftId]);
    return;
  }
  const { view } = useDraftFlow.getState();
  if (view.ready && view.open) flip(false);
  if (askedTimer !== undefined) clearTimeout(askedTimer);
  askedTimer = setTimeout(() => update({ asked: false }), DRAFT_ASKED_MS);
  update({ askedId: draftId, asked: true });
  if (!(await begun)) {
    update({ asked: false });
    return showToast(DRAFT_START_FAILED_MESSAGE);
  }
  const handed = await sendPageRequest({
    title: `Remix as a ${remixFormName(form)}`,
    request: remixPrompt(form, draftId),
    selection: remixSelection(form, draftId),
  });
  if (!handed) {
    update({ asked: false });
    void dropFromFlow([draftId]);
    return;
  }
  if (mineBefore.length > 0) void dropFromFlow(mineBefore.map((head) => head.id), 'bare');
}

/**
 * Starts following drafts (call once the session and live document run).
 * Only people who can edit see drafts. Returns a stop function.
 */
export function startDraftFlow(): () => void {
  if (running || !(maybeSession()?.canEdit ?? false)) return () => {};
  running = true;
  const stops = [
    startDrafts(),
    followPeople(),
    useDrafts.subscribe(refresh),
    useDocument.subscribe((state, previous) => {
      if (state.content !== previous.content) refresh();
    }),
    useAgentActivity.subscribe((state, previous) => {
      if (state.activity !== previous.activity) refresh();
    }),
    useShown.subscribe((state, previous) => {
      if (areDraftsFree(state) !== areDraftsFree(previous)) refresh();
    }),
  ];
  refresh();
  return () => {
    running = false;
    for (const stop of stops) stop();
    for (const timer of [statusTimer, askedTimer]) if (timer !== undefined) clearTimeout(timer);
    if (behindToast !== null) toast.close(behindToast);
    behindToast = null;
    setShownDraft(null);
    checkedStarted.clear();
    droppingSpent.clear();
    droppedOverdue.clear();
    droppingOlder = '';
    useDraftFlow.setState({ ...INITIAL, hidden: new Set(), view: inputsView(INITIAL) });
  };
}
