/**
 * What the page shows: the stored dashboard, an open draft, or an earlier
 * version from the history. The page runtime renders `useShownContent()`.
 *
 * A version preview wins. A remix draft shows only while drafts are free:
 * not while the person edits the page by hand, comments, previews a version
 * or holds unsaved source changes (it waits, and comes back after). The
 * shared draft also shows while the page is edited by hand, since those
 * edits go into it.
 */

import { create } from 'zustand';
import type { DashboardContent } from '@open-artifact/data-core';
import { useDocument } from './document.ts';

export type ShownMode = 'live' | 'draft' | 'version';

export interface ShownContent {
  mode: ShownMode;
  content: DashboardContent;
  /** The draft shown (mode `draft`). */
  draftId?: string;
  /** The history version shown (mode `version`). */
  version?: number;
}

/** What decides {@link ShownContent}. */
export interface ShownInputs {
  /** The page is in hand-edit mode. */
  editing: boolean;
  /** Comment mode is on. */
  commenting: boolean;
  /** The sources panel holds unsaved changes. */
  sourceDirty: boolean;
  /** The history version previewed, as composed with today's data. */
  version: { n: number; content: DashboardContent } | null;
  /** The open, ready draft applied to the dashboard (whether or not drafts are free now). */
  draft: { id: string; content: DashboardContent } | null;
  /** The shared draft applied to the dashboard, when the viewer is to see it. */
  shared: { content: DashboardContent } | null;
}

/** The draft id the shared draft shows under. */
export const SHARED_SHOWN_ID = 'shared';

export const NO_SHOWN_INPUTS: ShownInputs = { editing: false, commenting: false, sourceDirty: false, version: null, draft: null, shared: null };

/** A draft may show (and its bar act). */
export function areDraftsFree(inputs: ShownInputs): boolean {
  return !inputs.editing && !inputs.commenting && !inputs.sourceDirty && inputs.version === null;
}

/** The pencil may turn edit mode on: the stored dashboard is shown and comments are off. */
export function isPencilFree(inputs: ShownInputs): boolean {
  return inputs.version === null && !(inputs.draft !== null && areDraftsFree(inputs)) && !inputs.commenting;
}

export function deriveShownContent(live: DashboardContent, inputs: ShownInputs): ShownContent {
  if (inputs.version !== null) return { mode: 'version', content: inputs.version.content, version: inputs.version.n };
  if (inputs.draft !== null && areDraftsFree(inputs)) return { mode: 'draft', content: inputs.draft.content, draftId: inputs.draft.id };
  if (inputs.shared !== null && !inputs.commenting && !inputs.sourceDirty) return { mode: 'draft', content: inputs.shared.content, draftId: SHARED_SHOWN_ID };
  return { mode: 'live', content: live };
}

interface ShownState extends ShownInputs {
  shown: ShownContent;
}

export const useShown = create<ShownState>()(() => ({
  ...NO_SHOWN_INPUTS,
  shown: { mode: 'live', content: useDocument.getState().content },
}));

function sameShown(left: ShownContent, right: ShownContent): boolean {
  return left.mode === right.mode && left.content === right.content && left.draftId === right.draftId && left.version === right.version;
}

function recompute(): void {
  const state = useShown.getState();
  const next = deriveShownContent(useDocument.getState().content, state);
  if (!sameShown(next, state.shown)) useShown.setState({ shown: next });
}

useDocument.subscribe((state, previous) => {
  if (state.content !== previous.content) recompute();
});

function setInputs(patch: Partial<ShownInputs>): void {
  useShown.setState(patch);
  recompute();
}

/** What the page shows now. */
export function useShownContent(): ShownContent {
  return useShown((state) => state.shown);
}

/** What the page shows now, outside React. */
export function getShownContent(): ShownContent {
  return useShown.getState().shown;
}

/** The inputs now, outside React. */
export function getShownInputs(): ShownInputs {
  const { editing, commenting, sourceDirty, version, draft, shared } = useShown.getState();
  return { editing, commenting, sourceDirty, version, draft, shared };
}

/** Comment mode turned on or off (the comments layer calls this). */
export function setCommenting(commenting: boolean): void {
  if (useShown.getState().commenting !== commenting) setInputs({ commenting });
}

/** The sources panel holds unsaved changes, or no longer does. */
export function setSourceDraftDirty(sourceDirty: boolean): void {
  if (useShown.getState().sourceDirty !== sourceDirty) setInputs({ sourceDirty });
}

/** Hand-edit mode turned on or off (the edit flow calls this). */
export function setEditingShown(editing: boolean): void {
  if (useShown.getState().editing !== editing) setInputs({ editing });
}

/** Shows a history version (`null`: back to the latest). */
export function setShownVersion(version: ShownInputs['version']): void {
  setInputs({ version });
}

/** The open draft applied to the dashboard (`null`: none to show). */
export function setShownDraft(draft: ShownInputs['draft']): void {
  const was = useShown.getState().draft;
  if (was === draft || (was !== null && draft !== null && was.id === draft.id && was.content === draft.content)) return;
  setInputs({ draft });
}

/** The shared draft applied to the dashboard (`null`: the published artifact shows). */
export function setShownShared(shared: ShownInputs['shared']): void {
  const was = useShown.getState().shared;
  if (was === shared || (was !== null && shared !== null && was.content === shared.content)) return;
  setInputs({ shared });
}
