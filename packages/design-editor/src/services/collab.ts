/**
 * Collaboration on the design: starts comments, version history and
 * presence, and connects them to the Shell and the keyboard through the
 * shared glue (`@open-artifact/editor-kit`, collab.ts). Comment mode is a canvas mode.
 */

import type { ChromeCommand, ChromeReport } from '@open-artifact/runtime';
import { createCollab, type CollabAsideKind, type CollabKey } from '@open-artifact/editor-kit';
import { canComment, commentOnSelection, designComments, startComments, useComments } from './comments.ts';
import { designHistory, startHistory } from './history.ts';
import { startCollabPresence } from './presence.ts';
import { useDocument } from '../state/document.ts';
import { session } from './session.ts';
import { useView } from '../state/view.ts';

export { collabAside } from '@open-artifact/editor-kit';

/** The design's collaboration glue. */
export const designCollab = createCollab({
  comments: designComments,
  history: designHistory,
  adapter: {
    onSurface: () => useView.getState().mode === 'canvas',
    showSurface: () => useView.getState().focus(null),
    commentOnSelection,
    requestCommentMode(on) {
      const shell = session().shell;
      if (!shell) return false;
      shell.requestCommentMode(on);
      return true;
    },
    readOnly: () => useDocument.getState().readOnly,
  },
});

let started = false;

/** Starts comments, history and presence. Runs once, after the project loaded. */
export function startCollab(): void {
  if (started) return;
  started = true;
  void startComments();
  void startHistory();
  void startCollabPresence().catch(() => undefined);
  // Leaving the canvas, or picking a drawing tool, ends comment mode.
  useView.subscribe((state, previous) => {
    if (!useComments.getState().on) return;
    if ((state.mode !== previous.mode && state.mode !== 'canvas') || (state.tool !== previous.tool && state.tool !== 'select' && state.tool !== 'hand')) useComments.getState().setOn(false);
  });
}

/** Turns comment mode on or off, as C does (the bottom toolbar's Comment); in a Shell the Shell does it. */
export function toggleCommentMode(): void {
  const state = useComments.getState();
  if (!state.available || !canComment()) return;
  const shell = session().shell;
  if (shell) shell.requestCommentMode(!state.on);
  else state.setOn(!state.on);
}

/** Ends comment mode (V, or the Select tool picked again). */
export function leaveCommentMode(): void {
  const comments = useComments.getState();
  if (comments.on) comments.setOn(false);
}

/** What the Shell draws for comments and history. */
export const collabChromeReport = (): Pick<ChromeReport, 'comments' | 'history'> => designCollab.chromeReport();
/** Calls `report` whenever {@link collabChromeReport} may have changed. */
export const subscribeCollab = (report: () => void): void => void designCollab.subscribe(report);
/** Runs a Shell command that belongs to comments or history; returns whether it did. */
export const handleCollabCommand = (command: ChromeCommand): boolean => designCollab.handleCommand(command);
/** Opens or closes the history panel (closing the comment list). */
export const toggleHistoryPanel = (open?: boolean): void => designCollab.toggleHistoryPanel(open);
/** Which collaboration panel is open on the right (a React hook). */
export const useCollabAsideKind = (): CollabAsideKind => designCollab.useAside();
/** Keys of comment mode and of a history preview, ahead of the editor's shortcuts. */
export const runCollabShortcut = (press: CollabKey): boolean => designCollab.runShortcut(press);
