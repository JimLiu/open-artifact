/**
 * Comments on the deck: the Slides adapter of the shared comments controller
 * (`@open-artifact/editor-kit`, comments.ts). The host stores the threads;
 * this file says what a slide anchor is and where it points. A thread is
 * anchored to:
 * - a whole slide (`{slide}`),
 * - an element of a slide (`{slide, el}`, `el` being its view-context id),
 * - a point on an element or the slide (`{slide, el?, x, y}` in slide px),
 * - an area drawn on the slide (`{slide, x, y, w, h}`),
 * - or the whole artifact (`{}`).
 * A point dropped on a list item or a table cell also records which one
 * (`item`, `cell`); anchors written without them read as before.
 *
 * Comment mode (C, or the Shell's Comment button) turns clicks on the stage
 * into new threads; the list shows every thread. Unresolved counts appear on
 * slide thumbnails.
 */

import type { NodePath, Slide } from '@open-artifact/slides-core';
import type { CommentThread, JsonRecord } from '@open-artifact/runtime';
import { createComments } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { deckOrder, useDeck } from '../state/deck.ts';
import { useView } from '../state/view.ts';
import { useAgent } from './agent.ts';
import { maybeSession } from './session.ts';
import { anchoredPath, anchorLocation, describeAnchor, makeAnchor, readAnchor, type AnchorPart, type SlideAnchor } from '../lib/comment-anchor.ts';

export type { AnchorPart, SlideAnchor } from '../lib/comment-anchor.ts';

/** True when this viewer is a commenter or more. */
const commenter = (): boolean => {
  const s = maybeSession();
  return Boolean(s?.shell && s.viewer.role !== 'viewer');
};

/** The deck's comments. */
export const slidesComments = createComments<SlideAnchor>({
  parse: parseAnchor,
  serialize: (anchor) => JSON.stringify(anchor),
  label: (anchor) => anchorLabel(anchor),
  location: (anchor) => locationOf(anchor),
  reveal: (anchor) => revealAnchor(anchor),
  canComment: commenter,
  // Anyone who may comment may hand a thread to the agent.
  canSendToAgent: commenter,
  agentName: () => useAgent.getState().status.name,
  agentWakesIdle: () => useAgent.getState().status.wakesIdle,
  onModeChange(on) {
    if (on) useView.getState().endTextEdit();
  },
  noun: 'deck',
  maxThreads: 200,
  notify: (message) => toast.add(message),
  // The whole deck (no slide): no pin; written from the "All comments" panel.
  wholeArtifact: () => ({}),
  parksDrafts: true,
});

/** The comments store. */
export const useComments = slidesComments.store;

/** True when this viewer may write comments (commenters and up). */
export const canComment = slidesComments.canComment;

/** Comment mode on with the All comments panel open, or both off (Comment in the toolbar, and C). */
export function setCommenting(on: boolean): void {
  if (on && !canComment()) return;
  useComments.getState().setListOpen(on);
  // The Shell owns comment mode (its own button shows it too) and hands the change back.
  maybeSession()?.shell?.requestCommentMode(on);
}

/** Ask the frame to enter comment mode at the selected slide or element. */
export function requestAnchoredComment(anchor: SlideAnchor): void {
  if (canComment()) maybeSession()?.shell?.requestCommentMode(true, JSON.stringify(anchor));
}

/** Loads the threads and keeps them current. */
export async function startComments(): Promise<void> {
  const host = maybeSession();
  if (host?.shell) await slidesComments.start(host.comments);
}

/** Reads a stored anchor; anything unreadable is the whole deck. */
export function parseAnchor(text: string): SlideAnchor {
  return readAnchor(text);
}

/** Reads a thread's anchor. */
export const anchorOf = slidesComments.anchorOf;

/** Unresolved thread counts by slide id. */
export function openCounts(threads: readonly CommentThread[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (thread.status !== 'open') continue;
    const slide = anchorOf(thread).slide;
    if (slide) counts.set(slide, (counts.get(slide) ?? 0) + 1);
  }
  return counts;
}

/** The element path an anchor names on its slide, if it still resolves. */
export function anchorPath(slide: Slide, anchor: SlideAnchor): NodePath | null {
  return anchoredPath(slide, anchor);
}

/** A short label of an anchor: `Slide 3 › Text "Q3 revenue"`. */
export function anchorLabel(anchor: SlideAnchor): string {
  if (!anchor.slide) return describeAnchor(anchor, undefined, 0);
  const deck = useDeck.getState();
  return describeAnchor(anchor, deck.slides[anchor.slide]?.slide, deckOrder(deck).indexOf(anchor.slide) + 1);
}

/** The anchor of an element (and an optional point on it, and the list item or table cell there). */
export function elementAnchor(slide: Slide, path: NodePath | null, point?: { x: number; y: number }, area?: { w: number; h: number }, part?: AnchorPart): SlideAnchor {
  return makeAnchor(slide, path, point, area, part);
}

/** Location details the agent reads alongside the label. */
function locationOf(anchor: SlideAnchor): JsonRecord {
  const deck = useDeck.getState();
  const slide = anchor.slide ? deck.slides[anchor.slide]?.slide : undefined;
  return anchorLocation(anchor, slide, anchor.slide ? deckOrder(deck).indexOf(anchor.slide) + 1 : 0);
}

/** Brings an anchor's slide on stage (the card opens after it). */
function revealAnchor(anchor: SlideAnchor): void {
  const view = useView.getState();
  if (anchor.slide && useDeck.getState().slides[anchor.slide]) {
    if (view.mode !== 'edit') view.setMode('edit');
    view.showSlide(anchor.slide);
  }
}
