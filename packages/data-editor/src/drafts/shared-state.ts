/**
 * The shared draft's view, worked out from what is stored and what this page
 * did: whether it holds changes, whether the page shows it, what the publish
 * control offers and where the agent's changes go. Pure, so it can be tested.
 */

import {
  SHARED_DRAFT_ID,
  applyDraftToContent,
  composeDraft,
  draftHeadPath,
  hasSharedChanges,
  mergeDraftFiles,
  withoutCopies,
  type DashboardContent,
  type DraftComposition,
  type DraftDocs,
  type SharedDraftHead,
} from '@open-artifact/data-core';

/** What the publish control shows. */
export type PublishShows =
  /** Nothing waits: "Published", with the version menu. */
  | 'none'
  /** The draft is on the page for an editor: "Publish", with the draft menu. */
  | 'draft'
  /** The draft is on the page for someone who can't publish: "See published". */
  | 'viewing'
  /** The published artifact is on the page while a draft waits: "See draft". */
  | 'published'
  /** Waiting on something (the draft being read, restored or published): the last state, disabled. */
  | 'held';

export interface SharedDraftInputs {
  head: SharedDraftHead | null;
  /** The shared draft's documents as stored (copies included). */
  docs: DraftDocs;
  heard: boolean;
  /** This viewer may only look: the draft shows on request, never publishes. */
  looks: boolean;
  /** The viewer chose to see the draft (true) or the published artifact (false); `null` until they do. */
  open: boolean | null;
  content: DashboardContent;
  /** Drafts may show now: no earlier version is open, comments are off, no source holds unsaved changes. */
  free: boolean;
  /** The agent's turn is under way. */
  turn: boolean;
  publishing: boolean;
  restoring: boolean;
  me: string;
}

export interface SharedDraftView {
  head: SharedDraftHead | null;
  /** The draft's documents without untouched copies. */
  docs: DraftDocs;
  /** The draft holds a change. */
  ready: boolean;
  /** Who changed it besides this viewer. */
  others: string[];
  composition: DraftComposition | null;
  /** The dashboard with the draft applied (the live page files joined by the draft's). */
  applied: DashboardContent | null;
  /** The page shows the draft. */
  showing: boolean;
  shows: PublishShows;
  /** The control is drawn. */
  drawn: boolean;
  /** "See published" / "See draft" can flip what shows. */
  canSee: boolean;
  /** What the agent is told the page shows (`drafts/shared`), or null. */
  showingPath: string | null;
}

const NO_DOCS: DraftDocs = new Map();
const compositions = new WeakMap<DraftDocs, DraftComposition>();
let lastApplied: { content: DashboardContent; composition: DraftComposition; applied: DashboardContent } | null = null;

/** The dashboard with the shared draft applied: its sources and filters, and the live page files joined by its own. */
export function applySharedDraft(content: DashboardContent, composition: DraftComposition): DashboardContent {
  if (lastApplied !== null && lastApplied.content === content && lastApplied.composition === composition) return lastApplied.applied;
  const applied = applyDraftToContent(content, { ...composition, files: mergeDraftFiles(content.files, composition.files) });
  lastApplied = { content, composition, applied };
  return applied;
}

function composeOnce(docs: DraftDocs): DraftComposition {
  let composition = compositions.get(docs);
  if (composition === undefined) compositions.set(docs, (composition = composeDraft(docs)));
  return composition;
}

/** The shared draft's path, as the agent is told it. */
export const SHARED_DRAFT_PATH = draftHeadPath(SHARED_DRAFT_ID);

export function deriveSharedDraftView(input: SharedDraftInputs): SharedDraftView {
  const { head } = input;
  const raw = head === null || !input.heard ? NO_DOCS : input.docs;
  const docs = withoutCopies(raw);
  const ready = head !== null && hasSharedChanges(raw);
  const others = (head?.editors ?? []).filter((editor) => editor !== input.me);
  const open = input.open ?? !input.looks;
  const composition = ready ? composeOnce(docs) : null;
  const applied = composition === null ? null : applySharedDraft(input.content, composition);
  const showing = applied !== null && open && input.free;
  const held = input.restoring || (head !== null && !input.heard);
  const shows: PublishShows = !ready
    ? held
      ? 'held'
      : 'none'
    : showing
      ? input.looks
        ? 'viewing'
        : 'draft'
      : input.free
        ? 'published'
        : 'held';
  return {
    head,
    docs,
    ready,
    others,
    composition,
    applied,
    showing,
    shows,
    drawn: !input.looks || ready,
    canSee: ready && input.free && !input.turn && !input.publishing,
    showingPath: showing ? SHARED_DRAFT_PATH : null,
  };
}

/**
 * Where the agent's changes go during its turn: into the shared draft, unless auto-publish is on and the draft held
 * nothing when the turn began (then they go live, as they would without drafts).
 */
export function sharedWriteTo(input: { on: boolean; autoPublish: boolean; readyAtStart: boolean; editing: boolean }): string | null {
  if (!input.on) return null;
  return input.autoPublish && !input.readyAtStart && !input.editing ? null : SHARED_DRAFT_PATH;
}
