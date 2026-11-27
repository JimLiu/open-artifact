/**
 * The links a selected item offers to follow, shared by the selection
 * bar's Open link (or Go to) button and the More actions menu: a link
 * card's address, a linked picture's, or the links written in a note,
 * shape or text, as stored. Either control offers one link only; with
 * several, a click on the one wanted follows it.
 */

import { anchorTitle, markdownLinkUrls, NOT_ON_THIS_BOARD, type BoardElement } from '@open-artifact/whiteboard-core';
import { boardLinkElement, boardLinkTarget, linkDisplayUrl } from '../elements/links.ts';
import { useBoard } from '../state/board.ts';

/** The links of one item, as stored, in reading order, without repeats. */
export function elementLinks(element: BoardElement | undefined): string[] {
  switch (element?.type) {
    case 'link':
      return boardLinkTarget(element.href) !== undefined ? [element.href] : [];
    case 'image':
      return element.href !== undefined ? [element.href] : [];
    case 'note':
    case 'shape':
    case 'text':
      return [...markdownLinkUrls(element.text)];
    default:
      return [];
  }
}

/** The links a selection offers: those of its only item (none for several items). */
export function selectionLinks(selected: readonly BoardElement[]): string[] {
  return selected.length === 1 ? elementLinks(selected[0]) : [];
}

/** How the control that follows `link` reads: Go to (an element of this board, by its title) or Open link (its address). */
export function linkAction(link: string): { label: string; description: string; inBoard: boolean } {
  const id = boardLinkElement(link);
  if (id === undefined) return { label: 'Open link', description: linkDisplayUrl(boardLinkTarget(link) ?? link), inBoard: false };
  const target = useBoard.getState().byId.get(id);
  return { label: 'Go to', description: target === undefined ? NOT_ON_THIS_BOARD : anchorTitle(target), inBoard: true };
}
