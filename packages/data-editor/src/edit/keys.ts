/** What edit mode says about keys and clicks (pure: no DOM). */

export const LINK_HINT_MAX = 56;

const modName = (apple: boolean): string => (apple ? '⌘' : 'Ctrl');

/** The tip over a control or link on the page: ⌘/Ctrl-click uses it, goes there, or opens its address. */
export function describeClickThrough(href: string | null, apple: boolean): string {
  const key = modName(apple);
  if (href === null) return `${key}-click to use`;
  if (href === '' || href.startsWith('#')) return `${key}-click to go there`;
  const shown = href.replace(/^https?:\/\//, '');
  return `${key}-click to open: ${shown.length > LINK_HINT_MAX ? `${shown.slice(0, LINK_HINT_MAX - 1)}…` : shown}`;
}

/** How a piece can be worked with from the keyboard. */
export interface PieceKeys {
  /** A card: Delete removes it, Shift+F10 opens its menu. */
  block: boolean;
  /** Words that Enter opens for typing. */
  typing: boolean;
  /** A control or link inside that ⌘/Ctrl+Enter uses. */
  usable: boolean;
}

/** What the screen reader says of a piece: its name, then the keys that work on it. */
export function describePieceKeys(name: string, { block, typing, usable }: PieceKeys, apple: boolean): string {
  if (block) return `${name}, Delete to remove, Shift+F10 for more`;
  const enter = 'Enter';
  const keys = usable ? (apple ? `⌘${enter}` : `Ctrl+${enter}`) : null;
  if (keys === null) return typing ? `${name}, ${enter} to edit` : name;
  return typing ? `${name}, ${enter} to edit, ${keys} to use` : `${name}, ${keys} to use`;
}

/** What a key does to the picked piece when no words are being typed in. */
export type PieceKeyAction = 'type' | 'use' | 'source' | 'tab' | 'delete' | 'refuse' | 'unpick' | null;

export interface PieceKeyInput {
  key: string;
  kind: 'words' | 'drawing' | 'block';
  /** The piece sits in a tab that isn't open. */
  inactiveTab: boolean;
  /** The piece has a source to show. */
  sourced: boolean;
}

/** Enter or a letter types into words (or opens a closed tab), Enter shows a source, Delete removes, Escape unpicks. */
export function pieceKeyAction({ key, kind, inactiveTab, sourced }: PieceKeyInput): PieceKeyAction {
  const printable = key.length === 1;
  if (key === 'Escape') return 'unpick';
  if (kind !== 'words' && key === 'Enter' && !inactiveTab && sourced) return 'source';
  if (inactiveTab && key === 'Enter') return 'tab';
  if (!inactiveTab && kind === 'words' && (key === 'Enter' || printable)) return 'type';
  if (kind === 'drawing' && (key === 'Enter' || printable)) return 'refuse';
  if (kind !== 'words' && (key === 'Delete' || key === 'Backspace')) return 'delete';
  return null;
}

/**
 * How edit mode treats a link on the page:
 * - `live`: in a tab or other control that keeps working while editing; left to the page.
 * - `whole`: the link is all of its piece's words; the piece is picked as usual, with no card.
 * - `edit`: a link in a piece's words; a press shows its card, holding it opens the link.
 * - `select`: any other link with words; a press picks its piece as usual and shows its card.
 * - `card`: a link with no words (an icon or a picture); no card, its click-through tip sits on its picture.
 */
export type EditLinkKind = 'live' | 'whole' | 'edit' | 'select' | 'card';

export interface EditLinkFacts {
  /** Inside a tab or another control that keeps working. */
  live: boolean;
  /** It is its piece, holds it, or has all of the piece's words. */
  whole: boolean;
  /** The link's own words. */
  text: string;
  /** It sits in a words piece. */
  inWords: boolean;
}

export function editLinkKind({ live, whole, text, inWords }: EditLinkFacts): EditLinkKind {
  if (live) return 'live';
  if (whole) return 'whole';
  if (text.trim() === '') return 'card';
  return inWords ? 'edit' : 'select';
}

/** Links whose press shows a card (and so no click-through tip). */
export const hasEditLinkCard = (kind: EditLinkKind): boolean => kind === 'edit' || kind === 'select';

/** How long (ms) after an arrow key a caret that lands in a link still counts as moved into it. */
export const LINK_CARET_MOVED_MS = 400;
/** How long (ms) a caret moved into a link rests there before the link's card shows. */
export const LINK_CARET_CARD_MS = 300;

export const isArrowKey = (key: string): boolean => key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';

type LinkKeyEvent = Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'repeat'>;

/**
 * What Enter does to a link in edit mode:
 * - `focused`: open the focused link (Enter on a link that has the focus, or Alt+Enter);
 * - `caret`: open the link the caret is in (Alt+Enter with no link focused);
 * - `swallow`: a held Enter repeating on a link opens nothing more;
 * - null: not a link key; Enter goes on as usual.
 * `focused` is whether a link Enter may open has the focus (not a live or select link, not in the words being typed).
 */
export function linkEnterAction(event: LinkKeyEvent, focused: boolean): 'focused' | 'caret' | 'swallow' | null {
  if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  const action = focused ? 'focused' : event.altKey ? 'caret' : null;
  return action !== null && event.repeat ? 'swallow' : action;
}
