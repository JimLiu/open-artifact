/**
 * The rules of a folding toolbar, free of the page so they can be tested:
 * which controls go into the "More tools" card and in what order, which
 * dividers stay, where the card opens, and how keys and focus move.
 * `FoldToolbar.tsx` measures the page and applies them.
 */

/** Presses inside an element matching this belong to a folding strip's Escape (its card is open, or the key that closed it is still down). */
export const FOLD_OWNS_ESCAPE = '[data-fold-escape]';

/** How a control takes part in folding. */
export type FoldRole =
  /** The properties / more button: the first to go, always the card's last item. */
  | 'more'
  /** Stays on the strip: the tail group, and controls marked to keep (a link editor opens from the strip only). */
  | 'pinned'
  /** Folds when the strip is too wide, from the end. */
  | 'loose';

/**
 * Folds `items` (in strip order) until `tooWide()` turns false: the more
 * button first, to the card's end; then loose items from the strip's end,
 * each to the card's front, so the card reads in the strip's order.
 * `move` does the moving (and whatever the strip's width depends on).
 * Returns the card's items, in order.
 */
export function foldItems<T>(items: readonly T[], roleOf: (item: T) => FoldRole, tooWide: () => boolean, move: (item: T, to: 'front' | 'end') => void): T[] {
  const card: T[] = [];
  const more = items.find((item) => roleOf(item) === 'more');
  if (more !== undefined) {
    move(more, 'end');
    card.push(more);
  }
  const loose = items.filter((item) => roleOf(item) === 'loose');
  while (loose.length > 0 && tooWide()) {
    const item = loose.pop()!;
    move(item, 'front');
    card.unshift(item);
  }
  return card;
}

/** A run of a toolbar row: a divider, or a group that holds controls or holds none. */
export type FoldRun = 'divider' | 'group' | 'empty';

/**
 * Which runs of a row show: groups with controls, and between two of them
 * one divider. Empty groups go, and so does a divider at either end or
 * next to another divider.
 */
export function shownRuns(runs: readonly FoldRun[]): boolean[] {
  const shown = runs.map(() => false);
  let seenGroup = false;
  let divider: number | null = null;
  runs.forEach((run, index) => {
    if (run === 'empty') return;
    if (run === 'divider') {
      if (seenGroup && divider === null) divider = index;
      return;
    }
    if (divider !== null) shown[divider] = true;
    divider = null;
    shown[index] = true;
    seenGroup = true;
  });
  return shown;
}

/** Where the card opens: on the strip's side unless that side lacks room and the other has more; `shift` moves it right (px) so it stays in view. */
export interface CardPlace {
  side: 'above' | 'below';
  shift: number;
}

/** Gap between the strip and its card, and the margin the card keeps from the viewport's edges (px). */
export const CARD_GAP = 8;
export const CARD_MARGIN = 8;

/**
 * Places the card for a strip at `strip` (viewport px) that opened toward
 * `side`, inside `band` (the room the card may use, top and bottom).
 */
export function placeCard(strip: { top: number; bottom: number; right: number }, card: { width: number; height: number }, side: 'above' | 'below', band: { top: number; bottom: number }): CardPlace {
  const room = { above: strip.top - band.top, below: band.bottom - strip.bottom };
  const other = side === 'above' ? 'below' : 'above';
  const needed = card.height + CARD_GAP + CARD_MARGIN;
  const fits = room[side] >= needed || room[side] >= room[other];
  // The card lines up with the strip's right edge; past the viewport's left edge it moves right.
  const spill = card.width - (strip.right - CARD_MARGIN);
  return { side: fits ? side : other, shift: spill > 0 ? spill : 0 };
}

/** A key press, as far as the strip's arrow keys care. */
export interface StripKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * The control an arrow key, Home or End moves focus to, among `count`
 * controls with focus at `at` (-1: none of them). The arrows wrap at the
 * ends; `null` for any other key or with a modifier.
 */
export function arrowStep(press: StripKey, at: number, count: number): number | null {
  if (count === 0 || press.altKey || press.ctrlKey || press.metaKey) return null;
  switch (press.key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowLeft':
    case 'ArrowUp':
      return at < 0 ? 0 : (at - 1 + count) % count;
    case 'ArrowRight':
    case 'ArrowDown':
      return at < 0 ? 0 : (at + 1) % count;
    default:
      return null;
  }
}

/** How far to scroll a box so an item in it is in view with `margin` to spare (negative: to the start; 0: already in view). */
export function scrollToShow(item: { left: number; right: number }, box: { left: number; right: number }, margin: number): number {
  if (item.left < box.left + margin) return item.left - (box.left + margin);
  if (item.right > box.right - margin) return item.right - (box.right - margin);
  return 0;
}

/** What focus leaving the strip (or its card) does to an open card. */
export type FocusExit = 'close' | 'close-unless-back' | 'stay';

/**
 * Focus left a control of the strip: Tab closes the card (Tab that leaves
 * the focus nowhere checks again a tick later); F6 or Escape that moved the
 * focus out of the strip closes it too, unless a popup of the strip is open
 * or the focus went to a toast. A pointer press elsewhere leaves it open.
 */
export function focusExit(exit: { into: 'strip' | 'outside' | 'nowhere'; tabbing: boolean; byFocusKey: boolean; popupOpen: boolean; toToast: boolean }): FocusExit {
  if (exit.into === 'strip') return 'stay';
  if (exit.tabbing) return exit.into === 'nowhere' ? 'close-unless-back' : 'close';
  if (exit.byFocusKey && exit.into === 'outside' && !exit.popupOpen && !exit.toToast) return 'close';
  return 'stay';
}

/**
 * Whether the strip takes an Escape for its card: the card is open (or the
 * key that closed it is still down), the press is in the strip or the card,
 * no popup of the strip is open, and it is not typed into a text field (a
 * slider is not one).
 */
export function takesEscape(press: { key: string; defaultPrevented: boolean; ownedHere: boolean; popupOpen: boolean; inTextField: boolean }): boolean {
  return press.key === 'Escape' && !press.defaultPrevented && press.ownedHere && !press.popupOpen && !press.inTextField;
}

/** The control a card opened from the keyboard focuses: its first button, else its first field. */
export function firstInCard<T>(buttons: readonly T[], fields: readonly T[]): T | null {
  return buttons[0] ?? fields[0] ?? null;
}
