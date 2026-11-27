/**
 * The draft flow's view, worked out from what is stored and what this page
 * did: which draft is open, whether it can be shown, saved or canceled, and
 * which drafts are spent and should go. Pure, so it can be tested.
 */

import {
  applyDraftToContent,
  composeDraft,
  dashboardContentHash,
  draftHasPage,
  isDraftForArtifact,
  pickDraftHead,
  remixHeads,
  type DashboardContent,
  type DraftComposition,
  type DraftDocs,
  type RemixDraftHead,
} from '@open-artifact/data-core';

/** A remix request unanswered for this long is dropped, ms. */
export const DRAFT_OVERDUE_MS = 86_400_000;
/** How long a request just sent counts as asked when the agent does not start, ms. */
export const DRAFT_ASKED_MS = 8000;
/** How long a save waits for the dashboard to show the saved page, ms. */
export const DRAFT_ECHO_MS = 5000;
/** How long a status line ("Saved") stays, ms. */
export const STATUS_MS = 4000;

export interface DraftFlowInputs {
  heads: readonly RemixDraftHead[];
  /** Drafts this page dropped or saved and no longer offers. */
  hidden: ReadonlySet<string>;
  viewer: string;
  /** The artifact the drafts are for (`null`: drafts without one). */
  artifact: string | null;
  /** The draft followed and its documents. */
  followedId: string | null;
  docs: DraftDocs;
  heard: boolean;
  /** A request of mine whose read found no page yet. */
  startedId: string | null;
  /** The viewer flipped this draft shown or hidden. */
  opened: { id: string; open: boolean } | null;
  /** The draft of the last remix request sent from here. */
  askedId: string | null;
  /** A request was sent moments ago. */
  asked: boolean;
  saving: boolean;
  agentWorking: boolean;
  content: DashboardContent;
  /** Drafts may show now (see `areDraftsFree`). */
  free: boolean;
  /** The dashboard's hash after this page saved a draft, which replaces the head's `base`. */
  savedBase: { id: string; base: string } | null;
  now: number;
}

export interface DraftFlowView {
  head: RemixDraftHead | null;
  id: string | null;
  docs: DraftDocs;
  /** The draft has a page. */
  ready: boolean;
  /** The draft is the viewer's. */
  mine: boolean;
  /** A request of mine with no page yet. */
  pending: boolean;
  overdue: boolean;
  /** A request of mine with no page yet, not overdue: the bar offers to cancel it. */
  unstarted: boolean;
  /** The draft is flipped to show. */
  open: boolean;
  /** The draft is held here: mine, or flipped by this viewer. */
  held: boolean;
  /** The agent's turn while the draft is held here. */
  waiting: boolean;
  /** The agent works on this draft. */
  working: boolean;
  /** A request just sent that has no draft to show yet. */
  askedPending: boolean;
  composition: DraftComposition | null;
  /** The dashboard with the draft applied, when it is open and ready. */
  applied: DashboardContent | null;
  /** The draft is on the page. */
  showing: boolean;
  /** The dashboard changed after the draft was made. */
  changedSince: boolean;
  /** My other drafts. */
  older: string[];
  /** My other drafts can go: the newest is ready. */
  dropOlder: boolean;
  /** A saved draft still listed, to drop. */
  spentId: string | null;
  /** A request unanswered for a day, to drop. */
  overdueId: string | null;
  can: { undo: boolean; redo: boolean; save: boolean };
}

const compositions = new WeakMap<DraftDocs, DraftComposition>();
const hashes = new WeakMap<DashboardContent, string>();
let lastApplied: { content: DashboardContent; composition: DraftComposition; applied: DashboardContent } | null = null;

function composeOnce(docs: DraftDocs): DraftComposition {
  let composition = compositions.get(docs);
  if (composition === undefined) compositions.set(docs, (composition = composeDraft(docs)));
  return composition;
}

/** The dashboard's draft hash, worked out once per content. */
export function contentHash(content: DashboardContent): string {
  let hash = hashes.get(content);
  if (hash === undefined) hashes.set(content, (hash = dashboardContentHash(content)));
  return hash;
}

function applyOnce(content: DashboardContent, composition: DraftComposition): DashboardContent {
  if (lastApplied !== null && lastApplied.content === content && lastApplied.composition === composition) return lastApplied.applied;
  const applied = applyDraftToContent(content, composition);
  lastApplied = { content, composition, applied };
  return applied;
}

const NO_DOCS: DraftDocs = new Map();

export function deriveDraftView(input: DraftFlowInputs): DraftFlowView {
  const { viewer } = input;
  const heads = remixHeads(input.heads).filter((head) => !input.hidden.has(head.id) && isDraftForArtifact(head, input.artifact));
  const head = viewer === '' ? null : (pickDraftHead(heads, viewer) as RemixDraftHead | null);
  const id = head?.id ?? null;
  const docs = id !== null && input.followedId === id ? input.docs : NO_DOCS;
  const heard = id !== null && input.followedId === id && input.heard;
  const ready = draftHasPage(docs);
  const mine = head !== null && head.by === viewer;
  const pending = mine && !ready && (heard || input.startedId === id);
  const overdue = head !== null && input.now - head.at > DRAFT_OVERDUE_MS;
  const unstarted = pending && !overdue;
  const open = input.opened !== null && input.opened.id === id ? input.opened.open : mine;
  const held = mine || (input.opened !== null && input.opened.id === id);
  const waiting = input.agentWorking && held;
  const working = held && waiting && (ready || input.askedId === id);
  const composition = ready && open ? composeOnce(docs) : null;
  const applied = composition === null ? null : applyOnce(input.content, composition);
  const showing = input.free && applied !== null;
  const hash = ready ? contentHash(input.content) : '';
  const base = input.savedBase !== null && input.savedBase.id === id ? input.savedBase.base : (head?.base ?? '');
  const changedSince = showing && !input.saving && base !== '' && hash !== base;
  const older = heads.filter((item) => item.by === viewer && item.id !== id).map((item) => item.id);
  const spent = input.heads.find((item) => item.saved === true && !input.hidden.has(item.id));
  const askedPending = input.asked && !working && (!ready || input.askedId !== id);
  return {
    head,
    id,
    docs,
    ready,
    mine,
    pending,
    overdue,
    unstarted,
    open,
    held,
    waiting,
    working,
    askedPending,
    composition,
    applied,
    showing,
    changedSince,
    older,
    dropOlder: mine && ready && older.length > 0,
    spentId: spent?.id ?? null,
    overdueId: pending && overdue && !waiting ? id : null,
    can: {
      undo: showing && !input.saving && !working,
      redo: ready && input.free && !showing && !input.saving && !working && !askedPending,
      save: showing && !input.saving && !working,
    },
  };
}

/** The draft bar shows: a draft or a request of mine, held here, with nothing under way. */
export function isDraftBarShown(view: DraftFlowView, free: boolean): boolean {
  return free && (view.ready || view.unstarted) && !view.working && !(view.unstarted && view.waiting) && !view.askedPending && view.held;
}

/** The agent works on a draft held here (the bar gives way to the working mark). */
export function isDraftWorkingShown(view: DraftFlowView, free: boolean): boolean {
  return free && (view.working || (view.unstarted && view.waiting)) && view.held;
}

/** The next head time for a new draft of `viewer`: now, or just after their newest. */
export function nextDraftAt(heads: readonly { by: string; at: number }[], viewer: string, now: number): number {
  return Math.max(now, ...heads.filter((head) => head.by === viewer).map((head) => head.at + 1));
}
