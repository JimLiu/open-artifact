/**
 * The shared draft flow. Everyone who can edit works in one draft
 * (`drafts/shared`): hand edits and the agent's changes gather there, and
 * the published artifact stays as it is until someone publishes the draft.
 * People who can only look may see the draft on request.
 *
 * After the agent's turn (or a pause after hand edits) the draft goes live
 * by itself, unless auto-publish is off (`dash/settings.autoPublish`), the
 * draft holds someone else's changes, or the artifact changed after the
 * draft began. Publishing or discarding keeps a past head for History; a
 * discarded draft can be restored. Each person can undo and redo their own
 * steps in the draft.
 */

import { create } from 'zustand';
import { announce } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import {
  DASHBOARD_ENTRY_FILENAME,
  DASHBOARD_ENTRY_PATH,
  DASH_PARAMS_PATH,
  SHARED_DRAFT_ID,
  areDraftDocsEqual,
  autoPublishBlock,
  changedOnlyByDraft,
  datasetPath,
  draftFileCopy,
  filePath,
  filesToCopy,
  hasStaleCopies,
  isDraftForArtifact,
  isUntouchedCopy,
  newDraftId,
  orderDraftWrites,
  planSharedPublish,
  withoutCopies,
  type DashboardContent,
  type DashboardFile,
  type DraftDocs,
  type PastDraftHead,
  type SharedDraftHead,
  type UnknownRecord,
} from '@open-artifact/data-core';
import type { SyncWrite } from '@open-artifact/live-store';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { isInlineView } from '../platform/inline-view.ts';
import { maybeSession } from '../services/session.ts';
import { useDocument } from '../state/document.ts';
import {
  beginSharedDraft,
  followSharedDraft,
  patchDraftHead,
  putSharedDoc,
  putSharedDocs,
  readDraft,
  readSharedDoc,
  restorePastDraft,
  settleSharedDraft,
  stampEdit,
  startDrafts,
  useDrafts,
  type SettledDraft,
} from '../state/drafts.ts';
import { setShownShared, useShown } from '../state/shown.ts';
import { applyStorePatch, liveDocument, writeSettings } from '../sync/index.ts';
import { DRAFT_ECHO_MS, STATUS_MS, contentHash } from './draft-state.ts';
import { followPeople, nameOfPerson } from './people.ts';
import { deriveSharedDraftView, sharedWriteTo, type SharedDraftView } from './shared-state.ts';
import {
  AUTO_PUBLISH_FAILED_MESSAGE,
  CHANGE_REDONE_LABEL,
  CHANGE_UNDONE_LABEL,
  DRAFT_DISCARDED_LABEL,
  DRAFT_DISCARDED_TOAST,
  DRAFT_DISCARD_FAILED_MESSAGE,
  DRAFT_RESTORED_MESSAGE,
  DRAFT_RESTORE_FAILED_MESSAGE,
  DRAFT_RESTORE_GONE_MESSAGE,
  DRAFT_WORKING_LABEL,
  PAGE_CHANGED_ELSEWHERE_MESSAGE,
  PUBLISHED_LABEL,
  RESTORE_DRAFT_LABEL,
  SHARED_AGENT_WORKING_MESSAGE,
  SHARED_BEHIND_MESSAGE,
  SHARED_CHANGED_MESSAGE,
  SHARED_GONE_MESSAGE,
  SHARED_HIDDEN_MESSAGE,
  SHARED_LEFT_MESSAGE,
  SHARED_OTHERS_HOLD_MESSAGE,
  SHARED_PARTLY_PUBLISHED_MESSAGE,
  SHARED_READ_ONLY_MESSAGE,
  SHARED_READY_MESSAGE,
  SHARED_SHOWN_MESSAGE,
  SHARED_UNREADABLE_MESSAGE,
  SOMEONE_LABEL,
  STEP_FAILED_MESSAGE,
  STEP_MOVED_MESSAGE,
  UNDO_TOAST_LABEL,
  sharedSettledMessage,
  type DraftQuestion,
} from './words.ts';

/** A step this viewer took in the draft: the documents it touched, before and after. */
export interface SharedStep {
  paths: string[];
  before: DraftDocs;
  after: DraftDocs;
  /** The agent's turn made it. */
  agent: boolean;
}

interface SharedFlowState {
  /** The flow runs: this viewer may publish (false: they only look). */
  on: boolean;
  looks: boolean;
  /** The viewer chose to see the draft or the published artifact (`null`: the default for their role). */
  open: boolean | null;
  publishing: 'press' | 'auto' | null;
  asking: DraftQuestion | null;
  restoring: boolean;
  /** A discarded draft whose restore would replace newer changes, waiting on the question. */
  replacing: PastDraftHead | null;
  /** Discarded drafts being restored. */
  restoringIds: ReadonlySet<string>;
  /** Auto-publish as just set here, until the dashboard says so too. */
  autoSet: boolean | null;
  /** The agent's turn is under way. */
  turn: boolean;
  /** Where the agent's changes go (`drafts/shared`), or null for the artifact itself. */
  writeTo: string | null;
  /** The artifact changed after the draft began. */
  changedSince: boolean;
  steps: { undo: readonly SharedStep[]; redo: readonly SharedStep[] };
  /** An undo or redo is being written. */
  moving: boolean;
  /** A short status line ("Draft discarded"). */
  status: string | null;
  view: SharedDraftView;
}

/** Waits between failed tries to start the shared draft, ms (doubling, four tries). */
export const SHARED_BEGIN_RETRY_MS = 5000;
const SHARED_BEGIN_TRIES = 4;
/** How long hand edits rest before the draft is written, ms. */
export const SHARED_KEEP_MS = 400;
/** How long after hand edits end the draft waits before going live by itself, ms. */
export const SHARED_PAUSE_MS = 3000;
/** The head's `changed` is touched at most this often, ms. */
export const SHARED_TOUCH_MS = 60_000;
const NOTICE_MS = 10_000;

const NO_STEPS = { undo: [], redo: [] };

function viewer(): string {
  return maybeSession()?.viewer.id ?? '';
}

function sharedHead(): SharedDraftHead | null {
  const head = useDrafts.getState().heads.find((item) => item.id === SHARED_DRAFT_ID);
  return head !== undefined && head.kind === 'edit' && head.saved !== true && isDraftForArtifact(head, null) ? head : null;
}

/** The shared draft may show: no earlier version is open, comments are off and no source holds unsaved changes. */
function sharedFree(): boolean {
  const { version, commenting, sourceDirty } = useShown.getState();
  return version === null && !commenting && !sourceDirty;
}

function autoPublishOn(state: Pick<SharedFlowState, 'autoSet'>): boolean {
  return state.autoSet ?? useDocument.getState().content.autoPublish !== false;
}

type FlowInputs = Omit<SharedFlowState, 'view'>;

function deriveView(state: FlowInputs): SharedDraftView {
  const drafts = useDrafts.getState();
  return deriveSharedDraftView({
    head: sharedHead(),
    docs: drafts.shared,
    heard: drafts.sharedHeard,
    looks: state.looks,
    open: state.open,
    content: useDocument.getState().content,
    free: sharedFree(),
    turn: state.turn,
    publishing: state.publishing !== null,
    restoring: state.restoring,
    me: viewer(),
  });
}

const INITIAL: FlowInputs = {
  on: false,
  looks: false,
  open: null,
  publishing: null,
  asking: null,
  restoring: false,
  replacing: null,
  restoringIds: new Set(),
  autoSet: null,
  turn: false,
  writeTo: null,
  changedSince: false,
  steps: NO_STEPS,
  moving: false,
  status: null,
};

export const useSharedDraft = create<SharedFlowState>()(() => ({ ...INITIAL, view: deriveView(INITIAL) }));

let running = false;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let pauseTimer: ReturnType<typeof setTimeout> | undefined;
let beginTimer: ReturnType<typeof setTimeout> | undefined;
let beginTries = 0;
let beginning = false;
let behindToast: string | null = null;
let stamping = '';
/** The dashboard when it last matched the draft's base, for telling whether it changed since. */
let seen: { base: string; content: DashboardContent } | null = null;
/** The base this page wrote when it published, over the head's base it replaced. */
let ownBase: { base: string; over: string } | null = null;
/** The draft's documents when the agent's turn or hand edits began. */
let stepFrom: { docs: DraftDocs; agent: boolean } | null = null;
let lastTouch = 0;
let quietFlip = false;
let copying = false;
/** Past heads already listed, so others' settles are told once. */
let knownPast: Set<string> | null = null;
/** The steps' round: they are cleared when the draft is published, discarded or restored. */
let round = '';
/** The page shows the shared draft (as last set). */
let shownShared = false;
/** Source changes being written into the draft, and whether they began the step being kept. */
let patching = 0;
let patchStep = false;
/** The publish under way: source changes wait for it before they read the draft. */
let publishRun: Promise<void> = Promise.resolve();

function say(words: string | null): void {
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  statusTimer = undefined;
  useSharedDraft.setState({ status: words });
  if (words === null) return;
  announce(words);
  statusTimer = setTimeout(() => useSharedDraft.setState({ status: null }), STATUS_MS);
}

function notice(title: string, timeout = NOTICE_MS): string {
  return toast.add({ title, timeout });
}

function update(patch: Partial<FlowInputs>): void {
  useSharedDraft.setState(patch);
  refresh();
}

function workOutChangedSince(view: SharedDraftView): boolean {
  const { head, composition } = view;
  // Until the artifact has loaded there is nothing to tell it by.
  if (head === null || !view.ready || useDocument.getState().status !== 'ready') return false;
  const content = useDocument.getState().content;
  const base = ownBase !== null && ownBase.over === head.base ? ownBase.base : head.base;
  if (
    contentHash(content) === base ||
    (seen !== null && seen.base === base && seen.content !== content && composition !== null && changedOnlyByDraft(seen.content, content, composition, view.docs))
  )
    seen = { base, content };
  return hasStaleCopies(useDrafts.getState().shared, content.files) || (base !== '' && (seen === null || seen.base !== base || seen.content !== content));
}

function ensureBegun(state: SharedFlowState): void {
  if (state.looks || beginning || beginTimer !== undefined || !useDrafts.getState().loaded || viewer() === '') return;
  if (useDrafts.getState().heads.some((head) => head.kind === 'edit' && head.saved !== true)) return;
  if (!useDocument.getState().canWrite || beginTries >= SHARED_BEGIN_TRIES) return;
  beginning = true;
  void beginSharedDraft({ id: SHARED_DRAFT_ID, kind: 'edit', by: viewer(), at: Date.now(), base: '' }).then((begun) => {
    beginning = false;
    if (begun || !running) return;
    beginTimer = setTimeout(() => {
      beginTimer = undefined;
      refresh();
    }, SHARED_BEGIN_RETRY_MS * 2 ** beginTries++);
  });
}

function tellOthersSettles(): void {
  const { loaded, heads } = useDrafts.getState();
  if (!loaded) return;
  const past = heads.filter((head): head is PastDraftHead => head.kind === 'past' && isDraftForArtifact(head, null));
  const before = knownPast;
  knownPast = new Set(past.map((head) => head.id));
  if (before === null || useSharedDraft.getState().looks) return;
  const fresh = past.filter((head) => !before.has(head.id) && head.by !== viewer());
  const told = fresh.find((head) => head.what === 'discarded') ?? fresh[0];
  if (told === undefined) return;
  const title = sharedSettledMessage(told.what, told.left === true, nameOfPerson(told.by) || SOMEONE_LABEL);
  if (told.what === 'saved') return void notice(title);
  toast.add({ title, timeout: NOTICE_MS, actionProps: { children: RESTORE_DRAFT_LABEL, onClick: () => void restoreSharedDraft(told) } });
}

function react(view: SharedDraftView, before: SharedDraftView): void {
  const state = useSharedDraft.getState();
  ensureBegun(state);
  tellOthersSettles();
  // While the page is edited by hand, what it shows stays as it was when the edit began: the edits are what changes.
  if (!(useShown.getState().editing && isJointEditing())) {
    const shown = view.showing && view.applied !== null;
    setShownShared(shown ? { content: view.applied! } : null);
    if (shown !== shownShared) {
      shownShared = shown;
      if (shown) announce(SHARED_SHOWN_MESSAGE);
      else if (sharedFree() && !quietFlip && before.ready) announce(SHARED_HIDDEN_MESSAGE);
      quietFlip = false;
    }
  }
  // The draft holds changes but no base yet: the dashboard as it is now (once loaded) is what it began from.
  if (!state.looks && view.ready && view.head !== null && view.head.base === '' && stamping === '' && useDocument.getState().status === 'ready') {
    stamping = contentHash(useDocument.getState().content);
    void patchDraftHead(SHARED_DRAFT_ID, { base: stamping }).finally(() => (stamping = ''));
  }
  const changedSince = workOutChangedSince(view);
  if (changedSince !== state.changedSince) useSharedDraft.setState({ changedSince });
  const behind = changedSince && view.showing && !state.looks && state.publishing === null;
  if (behind && behindToast === null) behindToast = notice(SHARED_BEHIND_MESSAGE, 0);
  else if (!behind && behindToast !== null) {
    toast.close(behindToast);
    behindToast = null;
  }
  const nextRound = [view.head?.at ?? '', ...useDrafts.getState().heads.filter((head) => head.kind === 'past').map((head) => head.id)].join(' ');
  if (nextRound !== round) {
    round = nextRound;
    if (state.steps !== NO_STEPS) useSharedDraft.setState({ steps: NO_STEPS });
  }
  if (!state.turn && !state.looks) {
    const writeTo = sharedWriteTo({ on: view.head !== null, autoPublish: autoPublishOn(state), readyAtStart: view.ready, editing: useShown.getState().editing });
    if (writeTo !== state.writeTo) useSharedDraft.setState({ writeTo });
  }
  if (state.autoSet !== null && state.autoSet === (useDocument.getState().content.autoPublish !== false)) useSharedDraft.setState({ autoSet: null });
}

function refresh(): void {
  const state = useSharedDraft.getState();
  const before = state.view;
  const view = deriveView(state);
  useSharedDraft.setState({ view });
  if (running) react(view, before);
}

/** Writes the page files the agent's turn may edit into the draft, as copies (missing or gone stale). */
async function copyFilesForTurn(): Promise<void> {
  const { writeTo, turn } = useSharedDraft.getState();
  if (writeTo === null || !turn || copying) return;
  const files = filesToCopy(useDrafts.getState().shared, useDocument.getState().content.files);
  if (files.length === 0) return;
  copying = true;
  try {
    await putSharedDocs(files.map(({ name, text }) => [filePath(name), draftFileCopy(text)]));
  } catch {
    // The agent reads the artifact's own file instead; the next change tries again.
  } finally {
    copying = false;
  }
}

/** Credits this viewer (and the agent) in the head, once. */
function credit(agent: boolean): void {
  const me = viewer();
  const head = sharedHead();
  if (me === '' || head === null) return;
  if (head.editors?.includes(me) === true && (!agent || head.agent === true)) return;
  void patchDraftHead(SHARED_DRAFT_ID, { editors: { [me]: true }, ...(agent ? { agent: true } : {}) });
}

function touch(): void {
  const now = Date.now();
  if (Math.abs(now - Math.max(lastTouch, sharedHead()?.changed ?? 0)) < SHARED_TOUCH_MS) return;
  lastTouch = now;
  void patchDraftHead(SHARED_DRAFT_ID, { changed: now });
}

const sameDoc = (path: string, left: DraftDocs, right: DraftDocs): boolean => {
  const strip = (data: UnknownRecord | undefined): unknown => {
    if (data === undefined || path === DASH_PARAMS_PATH) return data;
    const { edit: _edit, copy: _copy, ...rest } = data;
    return rest;
  };
  return JSON.stringify(strip(left.get(path))) === JSON.stringify(strip(right.get(path)));
};

/** Keeps a step from `stepFrom` to the draft as it is now, read fresh. */
async function recordStep(): Promise<void> {
  const from = stepFrom;
  stepFrom = null;
  if (from === null) return;
  const read = await readDraft(SHARED_DRAFT_ID);
  if (read === null) return;
  const after = withoutCopies(read);
  const paths = [...new Set([...from.docs.keys(), ...after.keys()])].filter((path) => !sameDoc(path, from.docs, after));
  if (paths.length === 0) return;
  credit(from.agent);
  touch();
  const state = useSharedDraft.getState();
  useSharedDraft.setState({ steps: { undo: [...state.steps.undo, { paths, before: from.docs, after, agent: from.agent }], redo: [] } });
  // Said unless the draft is about to go live by itself.
  const due = autoPublishBlock({ autoPublish: autoPublishOn(state), others: state.view.others, changedSince: state.changedSince }) === null;
  if (state.view.ready && !due) announce(SHARED_READY_MESSAGE);
}

/** After the agent's turn or hand edits: goes live by itself when nothing holds it back. */
function publishIfDue(): void {
  const state = useSharedDraft.getState();
  const { view } = state;
  if (!running || state.looks || !view.ready || state.publishing !== null || state.turn || useShown.getState().editing) return;
  if (state.asking !== null || state.replacing !== null || patching > 0) return;
  const block = autoPublishBlock({ autoPublish: autoPublishOn(state), others: view.others, changedSince: state.changedSince });
  if (block === 'others') notice(SHARED_OTHERS_HOLD_MESSAGE);
  if (block !== null) {
    if (block !== 'off' && view.head?.held !== true) void patchDraftHead(SHARED_DRAFT_ID, { held: true });
    return;
  }
  void publishNow('auto');
}

function onTurn(working: boolean): void {
  const state = useSharedDraft.getState();
  if (working === state.turn) return;
  if (working) {
    update({ turn: true });
    if (state.view.ready) announce(DRAFT_WORKING_LABEL);
    if (!state.looks && state.writeTo !== null) {
      stepFrom = { docs: state.view.docs, agent: true };
      void copyFilesForTurn();
    }
    return;
  }
  update({ turn: false });
  if (stepFrom === null) return;
  void recordStep().then(publishIfDue);
}

function filesEqual(left: readonly DashboardFile[], right: readonly DashboardFile[]): boolean {
  return right.every((file) => left.some((item) => item.name === file.name && item.text === file.text));
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
    stop = useDocument.subscribe((doc) => {
      if (filesEqual(doc.content.files, files)) done();
    });
  });
}

/** Writes the draft over the artifact in one batch, each document but the filters stamped as this viewer's edit. */
async function writePublish(stored: DraftDocs): Promise<boolean> {
  const live = liveDocument();
  if (live === null) return false;
  const now = Date.now();
  const by = viewer();
  const writes: SyncWrite[] = planSharedPublish(stored).write.map(
    ([path, data]): SyncWrite => ({ op: 'set', path, data: path === DASH_PARAMS_PATH ? data : stampEdit(data, by, now) }),
  );
  try {
    await live.store.writeNow(writes);
    return true;
  } catch {
    return false;
  }
}

function publishNow(how: 'press' | 'auto'): Promise<void> {
  const state = useSharedDraft.getState();
  if (!state.view.ready || state.publishing !== null || state.looks) return Promise.resolve();
  if (!useDocument.getState().canWrite) {
    notice(SHARED_READ_ONLY_MESSAGE);
    return Promise.resolve();
  }
  const run = writeOut(how, state.view);
  publishRun = run.catch(() => undefined);
  return run;
}

async function writeOut(how: 'press' | 'auto', view: SharedDraftView): Promise<void> {
  update({ publishing: how });
  try {
    const stored = await readDraft(SHARED_DRAFT_ID);
    if (stored === null) return void notice(SHARED_UNREADABLE_MESSAGE);
    const docs = withoutCopies(stored);
    if (!areDraftDocsEqual(docs, view.docs)) return void notice(docs.size === 0 ? SHARED_GONE_MESSAGE : SHARED_CHANGED_MESSAGE);
    quietFlip = true;
    if (!(await writePublish(stored))) {
      quietFlip = false;
      void patchDraftHead(SHARED_DRAFT_ID, { held: true });
      return void notice(SHARED_PARTLY_PUBLISHED_MESSAGE, 15_000);
    }
    if (view.applied !== null) await waitForFiles(view.composition?.files ?? []);
    const base = contentHash(useDocument.getState().content);
    ownBase = { base, over: view.head?.base ?? '' };
    const settled = await settleSharedDraft(docs, { id: newDraftId(), what: 'saved', by: viewer() }, { base });
    if (settled?.left === true) notice(SHARED_LEFT_MESSAGE);
    useSharedDraft.setState({ open: null });
    announce(PUBLISHED_LABEL);
  } finally {
    update({ publishing: null });
  }
}

/** Publish: right away for the viewer's own draft, after asking when it holds others' changes. */
export function publishShared(): void {
  const state = useSharedDraft.getState();
  if (state.turn && state.publishing === null) return void notice(SHARED_AGENT_WORKING_MESSAGE);
  if (!state.view.ready || state.publishing !== null || state.looks) return;
  if (state.view.others.length === 0) void publishNow('press');
  else update({ asking: 'save' });
}

/** Discard draft: always asks. */
export function discardShared(): void {
  const state = useSharedDraft.getState();
  if (!state.view.ready || state.publishing !== null || state.looks) return;
  update({ asking: 'discard' });
}

/** Answers the publish / discard question. */
export function answerShared(yes: boolean): void {
  const { asking, view } = useSharedDraft.getState();
  update({ asking: null });
  if (!yes || asking === null) return;
  if (asking === 'save') return void publishNow('press');
  quietFlip = view.showing;
  void settleSharedDraft(view.docs, { id: newDraftId(), what: 'discarded', by: viewer() }).then((settled: SettledDraft | null) => {
    useSharedDraft.setState({ steps: NO_STEPS, open: null });
    if (settled === null) return void notice(DRAFT_DISCARD_FAILED_MESSAGE);
    if (settled.left) notice(SHARED_LEFT_MESSAGE);
    const { past } = settled;
    if (past === null) return say(DRAFT_DISCARDED_LABEL);
    toast.add({ title: DRAFT_DISCARDED_TOAST, timeout: NOTICE_MS, actionProps: { children: UNDO_TOAST_LABEL, onClick: () => void restoreSharedDraft(past) } });
  });
}

/** See published (`false`) or See draft (`true`). */
export function seeShared(draft: boolean): void {
  const { view } = useSharedDraft.getState();
  if (!view.ready || (!view.canSee && draft !== view.showing)) return;
  update({ open: draft });
}

/** Turns auto-publish on or off for everyone (`dash/settings.autoPublish`). */
export async function setAutoPublish(on: boolean): Promise<void> {
  update({ autoSet: on });
  try {
    await writeSettings({ autoPublish: on });
  } catch {
    update({ autoSet: null });
    notice(AUTO_PUBLISH_FAILED_MESSAGE);
  }
}

/**
 * Puts a discarded draft back into the shared draft. When the draft holds newer changes to the same parts, asks
 * first (`force` answers yes).
 */
export async function restoreSharedDraft(past: PastDraftHead, force = false): Promise<void> {
  const state = useSharedDraft.getState();
  if (state.restoringIds.has(past.id)) return;
  update({ restoring: true, restoringIds: new Set([...state.restoringIds, past.id]) });
  let outcome: Awaited<ReturnType<typeof restorePastDraft>> = null;
  try {
    outcome = await restorePastDraft(past, contentHash(useDocument.getState().content), force, viewer());
  } finally {
    const ids = new Set(useSharedDraft.getState().restoringIds);
    ids.delete(past.id);
    update({ restoring: ids.size > 0, restoringIds: ids });
  }
  if (outcome === 'clash') return update({ replacing: past });
  if (outcome === 'gone') return void notice(DRAFT_RESTORE_GONE_MESSAGE);
  if (outcome === null) return void notice(DRAFT_RESTORE_FAILED_MESSAGE);
  update({ open: null, steps: NO_STEPS });
  if (useSharedDraft.getState().view.showing) announce(DRAFT_RESTORED_MESSAGE);
  else notice(DRAFT_RESTORED_MESSAGE);
}

/** Answers "Replace newer changes in the draft?". */
export function answerReplace(yes: boolean): void {
  const { replacing } = useSharedDraft.getState();
  update({ replacing: null });
  if (yes && replacing !== null) void restoreSharedDraft(replacing, true);
}

/** Discards the shared draft as History lists it (the row's Discard). */
export function discardFromHistory(): void {
  discardShared();
}

async function takeStep(direction: 'undo' | 'redo'): Promise<void> {
  const state = useSharedDraft.getState();
  const step = state.steps[direction].at(-1);
  if (step === undefined || state.moving || state.turn || stepFrom !== null) return;
  update({ moving: true });
  try {
    const read = await readDraft(SHARED_DRAFT_ID);
    if (read === null) throw new Error('not read');
    const now = withoutCopies(read);
    const [from, to] = direction === 'undo' ? [step.after, step.before] : [step.before, step.after];
    if (step.paths.some((path) => !sameDoc(path, now, from) && !sameDoc(path, now, to))) {
      const keep = (item: SharedStep): boolean => !item.paths.some((path) => step.paths.includes(path));
      const { steps } = useSharedDraft.getState();
      useSharedDraft.setState({ steps: { undo: steps.undo.filter(keep), redo: steps.redo.filter(keep) } });
      return void notice(STEP_MOVED_MESSAGE);
    }
    const at = Date.now();
    const me = viewer();
    const writes = orderDraftWrites(step.paths.map((path): [string, UnknownRecord | null] => [path, to.get(path) ?? null])).map(
      ([path, data]): [string, UnknownRecord | null] => [path, data === null || path === DASH_PARAMS_PATH ? data : stampEdit(data, me, at)],
    );
    await putSharedDocs(writes);
    const other = direction === 'undo' ? 'redo' : 'undo';
    const { steps } = useSharedDraft.getState();
    useSharedDraft.setState({ steps: { ...steps, [direction]: steps[direction].filter((item) => item !== step), [other]: [...steps[other], step] } as SharedFlowState['steps'] });
    announce(direction === 'undo' ? CHANGE_UNDONE_LABEL : CHANGE_REDONE_LABEL);
    // Nothing left in the draft: it starts afresh; otherwise this viewer changed it, and it waits to be published.
    const settled = await settleSharedDraft(new Map(), { id: newDraftId(), what: 'discarded', by: me }, { quiet: true });
    if (settled?.left !== false) {
      credit(step.agent);
      touch();
      void patchDraftHead(SHARED_DRAFT_ID, { held: true });
    }
  } catch {
    notice(STEP_FAILED_MESSAGE);
  } finally {
    update({ moving: false });
  }
}

export function undoShared(): void {
  void takeStep('undo');
}

export function redoShared(): void {
  void takeStep('redo');
}

/** Hand edits go into the shared draft: on while this viewer may publish and the draft is open. */
export function isJointEditing(): boolean {
  const state = useSharedDraft.getState();
  return running && !state.looks && state.view.head !== null;
}

/** Joint mode: the entry page's text in the draft this edit expects to find (`null`: none, the published page shows). */
let jointExpects: string | null = null;

const entryText = (data: UnknownRecord | null | undefined): string | null => (typeof data?.text === 'string' ? data.text : null);

/** The pencil turned edit mode on: notes the draft's page as it is, which the edits will be written over. */
export function prepareJointEdits(): void {
  jointExpects = entryText(useDrafts.getState().shared.get(DASHBOARD_ENTRY_PATH));
}

/** Hand edits began: their changes become one step. */
export function beginJointEdits(): void {
  if (stepFrom === null) stepFrom = { docs: useSharedDraft.getState().view.docs, agent: false };
  if (pauseTimer !== undefined) clearTimeout(pauseTimer);
  pauseTimer = undefined;
}

/**
 * Writes the edited entry page into the draft (taken out again when it matches the published page). When someone
 * else changed the draft's page meanwhile, nothing is written and a notice says so (`clash`).
 */
export async function keepJointPage(html: string): Promise<'kept' | 'clash'> {
  const found = entryText(await readSharedDoc(DASHBOARD_ENTRY_PATH));
  if (found !== jointExpects) {
    notice(PAGE_CHANGED_ELSEWHERE_MESSAGE);
    return 'clash';
  }
  const live = useDocument.getState().content.files.find((file) => file.name === DASHBOARD_ENTRY_FILENAME)?.text ?? null;
  const data = html === live ? null : stampEdit({ text: html }, viewer(), Date.now());
  if (data !== null || found !== null) await putSharedDoc(DASHBOARD_ENTRY_PATH, data);
  jointExpects = data === null ? null : html;
  if (data !== null) {
    credit(false);
    touch();
  }
  return 'kept';
}

/** Fields a source change may touch without counting as an edit (no stamp, no credit). */
const UNSTAMPED_SOURCE_FIELDS: readonly string[] = ['certifiedAs', 'certifiedFrom'];

/** The dashboard a source change is checked against: with the shared draft applied while changes go into it. */
export function sharedSourceContent(): DashboardContent {
  const live = useDocument.getState().content;
  return isJointEditing() ? (useSharedDraft.getState().view.applied ?? live) : live;
}

function nothingToWriteTo(): Error {
  return Object.assign(new Error('there is no draft to write to'), { code: 'unavailable' });
}

/**
 * Writes a source's change into the shared draft instead of the published artifact: merged over the draft's copy of
 * the source, or over the published one when the draft has none. The change is one step this viewer can undo, and
 * once written the draft goes live by itself when nothing holds it back.
 */
export async function patchSharedSource(id: string, patch: UnknownRecord): Promise<void> {
  const path = datasetPath(id);
  if (stepFrom === null) {
    stepFrom = { docs: useSharedDraft.getState().view.docs, agent: false };
    patchStep = true;
  }
  patching++;
  try {
    await publishRun;
    if (!isJointEditing()) throw nothingToWriteTo();
    const held = await readSharedDoc(path);
    const over = held !== null && !isUntouchedCopy(held) ? held : useDocument.getState().documents.get(path);
    if (over === undefined) throw nothingToWriteTo();
    const counts = !Object.keys(patch).every((key) => UNSTAMPED_SOURCE_FIELDS.includes(key));
    const merged = applyStorePatch(over, patch);
    await putSharedDoc(path, counts ? stampEdit(merged, viewer(), Date.now()) : merged);
    if (!counts) return;
    credit(false);
    touch();
  } finally {
    patching--;
    if (patching === 0 && patchStep) {
      patchStep = false;
      void recordStep().then(publishIfDue);
    }
  }
}

/**
 * Hand edits ended: keeps their step, and after a pause publishes the draft when nothing holds it back (`pause`
 * false: the draft is about to be published or discarded by hand).
 */
export function endJointEdits(pause = true): void {
  void recordStep().then(() => {
    if (!pause) return;
    if (pauseTimer !== undefined) clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      pauseTimer = undefined;
      publishIfDue();
    }, SHARED_PAUSE_MS);
  });
}

/**
 * Starts the shared draft flow (call once the session and live document run). People who can edit work in the
 * draft; others who can read it may look at it. Returns a stop function.
 */
export function startSharedDraft(): () => void {
  const session = maybeSession();
  if (running || session === null || isInlineView()) return () => {};
  running = true;
  const looks = !session.canEdit;
  useSharedDraft.setState({ on: !looks, looks });
  const stops = [
    // The remix flow lists the heads for people who can edit; anyone else's page lists them here.
    looks ? startDrafts() : () => {},
    followPeople(),
    useDrafts.subscribe(refresh),
    useDocument.subscribe((doc, previous) => {
      if (doc.content === previous.content && doc.status === previous.status) return;
      refresh();
      void copyFilesForTurn();
    }),
    useShown.subscribe((shown, previous) => {
      if (shown.version !== previous.version || shown.commenting !== previous.commenting || shown.sourceDirty !== previous.sourceDirty || shown.editing !== previous.editing) refresh();
    }),
    useAgentActivity.subscribe((activity, previous) => {
      if (activity.activity !== previous.activity) onTurn(activity.activity === 'working');
    }),
  ];
  followSharedDraft(true);
  onTurn(useAgentActivity.getState().activity === 'working');
  refresh();
  return () => {
    running = false;
    for (const stop of stops) stop();
    followSharedDraft(false);
    for (const timer of [statusTimer, pauseTimer, beginTimer]) if (timer !== undefined) clearTimeout(timer);
    beginTimer = undefined;
    pauseTimer = undefined;
    if (behindToast !== null) toast.close(behindToast);
    behindToast = null;
    setShownShared(null);
    shownShared = false;
    seen = null;
    ownBase = null;
    stepFrom = null;
    knownPast = null;
    beginTries = 0;
    beginning = false;
    stamping = '';
    lastTouch = 0;
    quietFlip = false;
    copying = false;
    patching = 0;
    patchStep = false;
    publishRun = Promise.resolve();
    jointExpects = null;
    round = '';
    useSharedDraft.setState({ ...INITIAL, restoringIds: new Set(), view: deriveView(INITIAL) });
  };
}
