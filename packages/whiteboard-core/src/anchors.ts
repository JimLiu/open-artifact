/**
 * Links between the elements of a board: a link card, a linked picture or a
 * link in text that points at `#element=<id>` (see `links.ts`). Which element
 * a link points at, what a card to it is titled, and how copies keep their
 * links pointing where they should.
 *
 * DOM-free; the editor follows the links and draws the cards.
 */

import { artifactAddress, artifactAddressParts, ELEMENT_ANCHOR_PREFIX, elementAnchor, elementAnchorId, linkSubtitle, linkTitle, sanitizeShortLabel } from './links.ts';
import { MAX_LINK_TITLE_CHARS, elementPlainText, type BoardElement, type ElementId, type ElementType, type LinkElement } from './schema.ts';
import { stripInlineMarkers, stripMarkdownLinks, tableColumnIds, tableRowIds } from './table.ts';
import { MARKDOWN_LINK_PATTERN, TEXT_LINK_PATTERN } from './text/inline-markdown.ts';

/** What a card to an element of the same board calls the element's kind. */
export const ANCHOR_KIND_LABELS: Readonly<Record<ElementType, string>> = {
  note: 'Sticky note',
  shape: 'Shape',
  text: 'Text',
  container: 'Section',
  arrow: 'Arrow',
  sticker: 'Sticker',
  image: 'Image',
  stroke: 'Sketch',
  timer: 'Timer',
  html: 'Web embed',
  link: 'Link card',
  table: 'Table',
};

/** The line under the title of a card to an element of the same board. */
export const ON_THIS_BOARD = 'On this board';

/** The line under the title of a card whose element is gone. */
export const NOT_ON_THIS_BOARD = 'Not on this board';

/* -------------------------------------------------------------------------- */
/* Reading links                                                              */
/* -------------------------------------------------------------------------- */

/** The texts of an element that may hold Markdown links. */
function linkableTexts(element: BoardElement): string[] {
  switch (element.type) {
    case 'note':
    case 'shape':
    case 'text':
      return [element.text];
    case 'table':
      return Object.values(element.rows).flatMap((row) => Object.entries(row).flatMap(([key, value]) => (key !== 'at' && typeof value === 'string' ? [value] : [])));
    default:
      return [];
  }
}

/** Every link an element holds, as stored: a card's or picture's address and the targets of the links in its text. */
export function elementLinkHrefs(element: BoardElement): string[] {
  const hrefs: string[] = [];
  if (element.type === 'link') hrefs.push(element.href);
  if (element.type === 'image' && element.href !== undefined) hrefs.push(element.href);
  for (const text of linkableTexts(element)) {
    for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) if (match[1] !== undefined && TEXT_LINK_PATTERN.test(match[1])) hrefs.push(match[1]);
  }
  return hrefs;
}

/** The ids of the elements of the same board an element links to, without repeats. */
export function anchoredIds(element: BoardElement): ElementId[] {
  return [...new Set(elementLinkHrefs(element).flatMap((href) => elementAnchorId(href) ?? []))];
}

/**
 * The element of this board a stored link points at: `#element=<id>`, or the
 * address of this very board (`here`) at `#element=<id>`. `undefined` for
 * links elsewhere.
 */
export function linkedElementId(href: string, here?: string): ElementId | undefined {
  const anchored = elementAnchorId(href);
  if (anchored !== undefined) return anchored;
  if (here === undefined) return undefined;
  const parts = artifactAddressParts(href);
  return parts?.artifact === here ? elementAnchorId(parts.place) : undefined;
}

/* -------------------------------------------------------------------------- */
/* Titles                                                                     */
/* -------------------------------------------------------------------------- */

/** The first line of some markup with something to show, without link targets, markers or a list bullet. */
function firstShownLine(text: string): string {
  for (const line of stripInlineMarkers(stripMarkdownLinks(text)).split('\n')) {
    const shown = sanitizeShortLabel(line.replace(/^ *(?:[-•*]|\d{1,3}\.) /, ''), MAX_LINK_TITLE_CHARS);
    if (shown !== '') return shown;
  }
  return '';
}

/** The words of a table's first row, joined. */
function firstRowText(element: Extract<BoardElement, { type: 'table' }>): string {
  const row = tableRowIds(element)[0];
  if (row === undefined) return '';
  const cells = tableColumnIds(element).map((column) => element.rows[row]?.[column]);
  return firstShownLine(cells.filter((cell): cell is string => typeof cell === 'string' && cell.trim() !== '').join(', '));
}

/** The title a card to `target` shows: its words (a section's title, a note's first line), else its kind. */
export function anchorTitle(target: BoardElement): string {
  switch (target.type) {
    case 'link':
      return linkTitle(target);
    case 'table':
      return firstRowText(target) || ANCHOR_KIND_LABELS.table;
    default:
      return firstShownLine(elementPlainText(target)) || (target.type === 'container' ? 'Untitled section' : ANCHOR_KIND_LABELS[target.type]);
  }
}

/** The line under the title of a card to `target` (`undefined`: the element is gone). */
export function anchorSubtitle(target: BoardElement | undefined): string {
  return target === undefined ? NOT_ON_THIS_BOARD : `${ANCHOR_KIND_LABELS[target.type]} · ${ON_THIS_BOARD}`;
}

/** The title of a card to an element that is gone and had no title stored. */
export const MISSING_ANCHOR_TITLE = 'Missing item';

/** What a link card shows. */
export interface LinkCardFace {
  title: string;
  subtitle: string;
  /** The element of this board it points at, if it does. */
  anchored?: ElementId;
  /** It points at an element of this board that is not on it. */
  gone: boolean;
}

/**
 * What a link card shows: a card to an element of this board (`here` is
 * this board's artifact id, when known) shows the element's title and kind
 * as they are now, and its stored title once the element is gone; any
 * other card its stored title and kind or address.
 */
export function linkCardFace(link: LinkElement, byId: ReadonlyMap<ElementId, BoardElement>, here?: string): LinkCardFace {
  const anchored = linkedElementId(link.href, here);
  if (anchored === undefined) return { title: linkTitle(link), subtitle: linkSubtitle(link), gone: false };
  const target = byId.get(anchored);
  return { title: target === undefined ? (link.title ?? MISSING_ANCHOR_TITLE) : anchorTitle(target), subtitle: anchorSubtitle(target), anchored, gone: target === undefined };
}

/* -------------------------------------------------------------------------- */
/* Rewriting links                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The element with every link passed through `rewrite` (which returns the
 * new target, or `undefined` to keep it). The element itself when nothing
 * changes.
 */
export function rewriteElementLinks<T extends BoardElement>(element: T, rewrite: (href: string) => string | undefined): T {
  const swap = (href: string): string => rewrite(href) ?? href;
  const inText = (text: string): string =>
    text.includes('](') ? text.replace(MARKDOWN_LINK_PATTERN, (whole, href: string) => (TEXT_LINK_PATTERN.test(href) ? whole.slice(0, whole.length - href.length - 1) + swap(href) + ')' : whole)) : text;
  let next: BoardElement = element;
  if (element.type === 'link') {
    const href = swap(element.href);
    if (href !== element.href) next = { ...element, href };
  } else if (element.type === 'image' && element.href !== undefined) {
    const href = swap(element.href);
    if (href !== element.href) next = { ...element, href };
  } else if (element.type === 'note' || element.type === 'shape' || element.type === 'text') {
    const text = inText(element.text);
    if (text !== element.text) next = { ...element, text };
  } else if (element.type === 'table') {
    let changed = false;
    const rows = Object.fromEntries(
      Object.entries(element.rows).map(([rowId, row]) => [
        rowId,
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => {
            if (key === 'at' || typeof value !== 'string') return [key, value];
            const text = inText(value);
            if (text !== value) changed = true;
            return [key, text];
          }),
        ),
      ]),
    ) as typeof element.rows;
    if (changed) next = { ...element, rows };
  }
  return next as T;
}

/** Where copied elements come from and go to: the artifact ids of both boards, when known. */
export interface CopiedLinkBoards {
  /** The board the elements were copied from. */
  from?: string;
  /** The board they land on. */
  here?: string;
}

/**
 * Copies with their links kept pointing where they should (`idMap`: source
 * id to copy id):
 * - a link to an element copied with it points at that element's copy;
 * - a link to an element left behind keeps pointing at it: on the same
 *   board as it is, on another board through the source board's address
 *   (`open-artifact://artifact/<from>#element=<id>`);
 * - a link to an element of the destination board through that board's
 *   address becomes a plain `#element=<id>`.
 */
export function relinkCopies(copies: readonly BoardElement[], idMap: ReadonlyMap<ElementId, ElementId>, boards: CopiedLinkBoards = {}): BoardElement[] {
  const elsewhere = boards.from !== undefined && boards.here !== undefined && boards.from !== boards.here;
  return copies.map((copy) =>
    rewriteElementLinks(copy, (href) => {
      const anchored = elementAnchorId(href);
      if (anchored !== undefined) {
        const copied = idMap.get(anchored);
        if (copied !== undefined) return elementAnchor(copied);
        return elsewhere ? artifactAddress(boards.from!, ELEMENT_ANCHOR_PREFIX + anchored) : undefined;
      }
      const parts = artifactAddressParts(href);
      if (parts === undefined || boards.here === undefined || parts.artifact !== boards.here) return undefined;
      const target = elementAnchorId(parts.place);
      return target === undefined ? undefined : elementAnchor(target);
    }),
  );
}

/**
 * The board's other elements with their links to cut elements (`idMap`:
 * the id each had to the id of its pasted copy) moved to the copies, so
 * cutting and pasting an element on the same board keeps the links to it.
 * Only links to elements no longer on the board move.
 */
export function followPastedLinks(elements: readonly BoardElement[], idMap: ReadonlyMap<ElementId, ElementId>): BoardElement[] {
  const present = new Set(elements.map((element) => element.id));
  return elements.map((element) =>
    rewriteElementLinks(element, (href) => {
      const anchored = elementAnchorId(href);
      const copied = anchored !== undefined && !present.has(anchored) ? idMap.get(anchored) : undefined;
      return copied === undefined ? undefined : elementAnchor(copied);
    }),
  );
}
