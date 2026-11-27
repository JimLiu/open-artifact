/**
 * Links that open the board at an element: a page opened at
 * `#element=<id>` shows that element once the board is shown (instead of
 * the remembered view or a fit of the whole board), and a later change of
 * the fragment, or the Shell's `goto_element` command (its own address
 * changed), goes there as a link on the board does (Back returns).
 *
 * An element that is not on the board shows the whole board and says so.
 */

import { elementAnchorId, type ElementId } from '@open-artifact/whiteboard-core';
import type { ChromeCommand } from '@open-artifact/runtime';
import { useBoard } from '../state/board.ts';
import { announce, notify } from './announce.ts';
import { fitBoard, goToElement, MISSING_LINK_TARGET_MESSAGE } from './navigation.ts';
import { onShellCommand } from './shell.ts';

/** The element the page was opened at (`#element=<id>`), if any. */
export function openedAtElement(): ElementId | undefined {
  return typeof location === 'undefined' ? undefined : elementAnchorId(location.hash);
}

/** Says the element a link points at is not on the board. */
function sayMissing(): void {
  announce(MISSING_LINK_TARGET_MESSAGE);
  notify(MISSING_LINK_TARGET_MESSAGE);
}

/** Starts following links to elements (see the module comment); returns a function that stops. */
export function startElementDeepLinks(): () => void {
  /** An element to show once the board is shown, and whether it is the first view (no glide, nothing to go back to). */
  let pending: { id: ElementId; first: boolean } | undefined;
  const opened = openedAtElement();
  if (opened !== undefined) pending = { id: opened, first: true };

  const show = (): void => {
    if (pending === undefined || !useBoard.getState().revealed) return;
    const { id, first } = pending;
    pending = undefined;
    if (goToElement(id, first ? { glide: false, back: false } : {})) return;
    if (first) fitBoard();
    sayMissing();
  };
  const go = (id: ElementId): void => {
    pending = { id, first: pending?.first ?? false };
    show();
  };

  const stopBoard = useBoard.subscribe((state, previous) => {
    if (state.revealed !== previous.revealed) show();
  });
  const onHashChange = (): void => {
    const id = openedAtElement();
    if (id !== undefined) go(id);
  };
  window.addEventListener('hashchange', onHashChange);
  const stopShell = onShellCommand((command: ChromeCommand) => {
    if (command.cmd === 'goto_element' && elementAnchorId(`#element=${command.id}`) !== undefined) go(command.id);
  });
  show();
  return () => {
    stopBoard();
    stopShell();
    window.removeEventListener('hashchange', onHashChange);
  };
}
