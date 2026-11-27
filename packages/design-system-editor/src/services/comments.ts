/**
 * Comments on the design system, on the editor kit's comments controller
 * (`createComments`, the one every editor uses). The host stores the threads
 * (the `comments` capability); `lib/comment-anchors.ts` says what each is on.
 * Commenters and up write; only the owner hands a thread to the agent.
 *
 * Comment mode (the Shell's Comment button or the top bar's) turns clicks on
 * tokens, styles, components, assets and sections into new threads: the
 * comment panel opens on the item with the shared composer.
 *
 * The controller's anchor is a {@link CommentTarget} (a wrapped
 * `SystemAnchor`), because its draft uses `null` for "no draft" while a
 * `SystemAnchor` uses it for the whole system.
 */

import { createComments } from '@open-artifact/editor-kit';
import type { CommentThread, JsonRecord } from '@open-artifact/runtime';
import { toast } from '@open-artifact/ui';
import { create } from 'zustand';
import { anchorLabel, parseAnchor, serializeAnchor, type SystemAnchor } from '../lib/comment-anchors.ts';
import { focusTarget, useView } from '../state/view.ts';
import { useAgent } from './agent.ts';
import { maybeSession, session } from './session.ts';

export { anchorLabel, openCount, parseAnchor, serializeAnchor, threadsByAnchor, type SystemAnchor } from '../lib/comment-anchors.ts';

/** What a thread is on, as the comments controller holds it. */
export interface CommentTarget {
  anchor: SystemAnchor;
}

/** Where a thread sits, for the agent. */
function locationOf(anchor: SystemAnchor): JsonRecord {
  if (!anchor) return { section: 'overview' };
  const target = focusTarget(anchor);
  return { kind: anchor.kind, name: anchor.name, ...(anchor.family ? { family: anchor.family } : {}), section: target.section };
}

/** Shows the item a thread is on. */
function showItem(anchor: SystemAnchor): void {
  if (!anchor) return;
  const target = focusTarget(anchor);
  const view = useView.getState();
  if (target.section === 'files') view.openFile(anchor.name);
  else view.go(target.section, target.anchor);
  view.setFocus(anchor);
}

export const systemComments = createComments<CommentTarget>({
  notify: (message) => toast.add(message),
  parse: (text) => ({ anchor: parseAnchor(text) }),
  serialize: (target) => serializeAnchor(target.anchor),
  label: (target) => anchorLabel(target.anchor),
  location: (target) => locationOf(target.anchor),
  // A row of the "All comments" panel: the item comes into view with its cards beside its badge.
  reveal(target) {
    showItem(target.anchor);
    useCommentScope.setState({ scope: target.anchor });
  },
  canComment: () => maybeSession()?.viewer.role !== 'viewer',
  onModeChange(on) {
    if (!on) closeComments();
  },
  canSendToAgent: () => {
    const s = maybeSession();
    return Boolean(s?.isOwner && s.agent);
  },
  agentName: () => useAgent.getState().status.name || 'the agent',
  agentWakesIdle: () => useAgent.getState().status.wakesIdle,
  noun: 'design system',
  maxThreads: 500,
  // The whole system: written from the "All comments" panel, its card beside the panel.
  wholeArtifact: () => ({ anchor: null }),
  // A comment set aside shows on its item's badge, and pressing that takes it up again.
  parksDrafts: true,
});

/** The comments store. */
export const useComments = systemComments.store;

/** True when this viewer may write comments (commenters and up). */
export const canComment = systemComments.canComment;

/** True when this viewer may hand threads to the agent (the owner, with an agent connected). */
export const canSendToAgent = systemComments.canSendToAgent;

/** The item whose cards show beside its badge (`null`: the whole system); `undefined`: none. */
export const useCommentScope = create<{ scope: SystemAnchor | undefined }>()(() => ({ scope: undefined }));

// The panel's composer closes the item's cards; a comment begun there waits on its badge.
useComments.subscribe((state, previous) => {
  if (state.draft !== previous.draft && state.draft !== null && systemComments.isWholeAnchor(state.draft)) useCommentScope.setState({ scope: undefined });
});

/** Loads the threads and keeps them current; `?comment=<id>` (the protocol's `SHELL_PARAMS.comment`) opens one. */
export async function startComments(): Promise<void> {
  const capability = session().comments ?? null;
  await systemComments.start(capability, new URLSearchParams(location.search).get('comment'));
}

/* -------------------------------------------------------------------------- */
/* The list and the items                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Shows an item's threads beside its badge, with a composer for a new one for those who may comment (`undefined`:
 * opens the "All comments" panel instead; `null`, the whole system: the panel, with its composer).
 */
export function openComments(target?: SystemAnchor): void {
  const comments = useComments.getState();
  if (target === undefined || target === null) {
    comments.setListOpen(true);
    if (target === null && canComment()) systemComments.composeWhole();
    return;
  }
  useCommentScope.setState({ scope: target });
  comments.setDraft(canComment() ? { anchor: target } : null);
}

/** Closes an item's cards. */
export function closeComments(): void {
  useCommentScope.setState({ scope: undefined });
  const comments = useComments.getState();
  comments.setDraft(null);
  comments.setActive(null);
}

/** Shows the item a thread is on, and opens the thread. */
export function revealThread(thread: CommentThread): void {
  systemComments.reveal(thread);
}

/** Moves a thread to another item (its token was renamed). */
export function moveThread(id: string, anchor: SystemAnchor): Promise<void> {
  return systemComments.move(id, { anchor });
}

/** Hands every open thread not yet sent to the agent. */
export const sendAllToAgent = systemComments.sendAllToAgent;
