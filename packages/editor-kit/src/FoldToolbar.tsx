/**
 * A floating toolbar that can fold. With `fold` on, controls that do not fit
 * the strip's width move into a "More tools" card opened from a button at the
 * strip's end (the rules are in `toolbar-fold.ts`). They are the same mounted
 * controls: each lives in a host node that moves, so pressed states, spinners
 * and open popups go with it. On a narrow touch screen the strip does not
 * fold; its row scrolls.
 *
 * Build the strip from {@link FoldGroup}s and {@link FoldDivider}s. Mark the
 * properties / more button `data-fold-more`, a control that must stay on the
 * strip `data-fold-keep`, and the last group `tail`.
 *
 * Arrow keys, Home and End move focus through the strip's and the open
 * card's controls. An editor whose own Escape handling runs first (capturing
 * on the window) leaves alone a press inside {@link FOLD_OWNS_ESCAPE}.
 */

import { Ellipsis } from 'lucide-react';
import {
  Children,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  isValidElement,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn, isComposingKey } from '@open-artifact/ui';
import { Card, ChromeButton, Tip } from './chrome.tsx';
import { FOLD_OWNS_ESCAPE, arrowStep, firstInCard, focusExit, foldItems, placeCard, scrollToShow, shownRuns, takesEscape, type FoldRole, type FoldRun } from './toolbar-fold.ts';

const MORE_TOOLS = 'More tools';
/** Controls the arrow keys visit, and those they pass over. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const PASSED_OVER = ':disabled, [role="radio"][tabindex="-1"]';
const TEXT_FIELD = 'input, select, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]';
/** A popup (menu, popover) opened from a control of the strip; a tooltip is not one. */
const STRIP_POPUP = '[aria-expanded="true"]:not([data-fold-toggle])';
/** A modal dialog anywhere on the page. */
const MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"]';
const NARROW_TOUCH = '(pointer: coarse) and (max-width: 599px)';
/** Margins kept around a control scrolled into view: along the strip, and inside the card. */
const ROW_SCROLL_MARGIN = 48;
const CARD_SCROLL_MARGIN = 8;
/** How often a postponed re-measure checks whether it may run. */
/** A strip class that positions it already (the card is placed against any of these). */
const POSITIONED = /(?:^|\s)(?:fixed|absolute|sticky)(?:\s|$)/;
const IDLE_POLL_MS = 200;

/** The room a card may open into (viewport px). */
export interface FoldBand {
  top: number;
  bottom: number;
}

interface FoldState {
  folded: boolean;
  /** A control was added or removed: measure again. */
  changed: () => void;
}

const FoldContext = createContext<FoldState | null>(null);

/** Whether the strip around the caller is folded (its properties button changes icon in the card). */
export function useFolded(): boolean {
  return useContext(FoldContext)?.folded ?? false;
}

/* ------------------------------ the last key ------------------------------ */

/** Whether the last key down was F6 or Escape: focus that leaves a strip then was moved by the keyboard. */
let focusKeyDown = false;
let trackers = 0;
const noteKey = (event: globalThis.KeyboardEvent): void => {
  // An Escape that ends an input method's composition moves no focus.
  focusKeyDown = !isComposingKey(event) && (event.key === 'F6' || event.key === 'Escape');
};
const forgetKey = (): void => {
  focusKeyDown = false;
};

/** The window listeners behind `focusKeyDown`: [event, listener, capture]. */
const FOCUS_KEY_LISTENERS: readonly [string, (event: Event) => void, boolean][] = [
  ['keydown', noteKey as (event: Event) => void, true],
  ['keyup', forgetKey, true],
  ['pointerdown', forgetKey, true],
  ['blur', forgetKey, false],
];

function trackFocusKeys(view: Window): () => void {
  if (trackers++ === 0) for (const [type, listener, capture] of FOCUS_KEY_LISTENERS) view.addEventListener(type, listener, capture);
  return () => {
    if (--trackers === 0) for (const [type, listener, capture] of FOCUS_KEY_LISTENERS) view.removeEventListener(type, listener, capture);
  };
}

/* ------------------------------ page helpers ------------------------------ */

function subscribeNarrowTouch(change: () => void): () => void {
  const query = window.matchMedia?.(NARROW_TOUCH);
  query?.addEventListener('change', change);
  return () => query?.removeEventListener('change', change);
}
const isNarrowTouch = (): boolean => window.matchMedia?.(NARROW_TOUCH).matches ?? false;

/** Each item's host, by the slot it belongs in. */
const hostOf = new WeakMap<Element, HTMLElement>();

function popupOpenIn(strip: Element): boolean {
  return strip.querySelector(STRIP_POPUP) !== null || strip.ownerDocument.querySelector(MODAL) !== null;
}

const isTextField = (element: Element): boolean => element.matches(TEXT_FIELD) && !element.matches('input[type="range"]');

/** What decides a group's place: whether it holds a control now. */
function runOf(part: Element, folded: boolean): FoldRun {
  if (part.hasAttribute('data-fold-divider')) return 'divider';
  if (part.hasAttribute('data-fold-toggle-group')) return folded ? 'group' : 'empty';
  const slots = part.querySelectorAll('[data-fold-slot]');
  if (slots.length === 0) return 'group';
  return [...slots].some((slot) => slot.childElementCount > 0) ? 'group' : 'empty';
}

/** Hides the row's empty groups and the dividers left without a group on each side. */
function tidyRuns(row: Element, folded: boolean): void {
  const parts = [...row.querySelectorAll('[data-fold-group], [data-fold-divider], [data-fold-toggle-group]')];
  const shown = shownRuns(parts.map((part) => runOf(part, folded)));
  parts.forEach((part, index) => part.toggleAttribute('data-fold-gone', !shown[index]));
}

function roleOf(slot: Element): FoldRole {
  const host = hostOf.get(slot);
  if (host?.querySelector('[data-fold-more]')) return 'more';
  if (slot.closest('[data-fold-tail]') || host?.querySelector('[data-fold-keep]')) return 'pinned';
  return 'loose';
}

/** A strip's content, to tell a real change from a re-render. */
const contentKey = (strip: Element): string => `${strip.getElementsByTagName('*').length}:${strip.textContent ?? ''}`;

/**
 * Puts every item back, measures the strip at its natural width and, when it
 * is wider than its limit, folds. True when it folded.
 */
function refoldStrip(strip: HTMLElement, row: HTMLElement, cardRow: HTMLElement): boolean {
  const slots = [...row.querySelectorAll('[data-fold-slot]')];
  for (const slot of slots) {
    const host = hostOf.get(slot);
    if (host && host.parentElement !== slot) slot.append(host);
  }
  const limit = parseFloat(getComputedStyle(strip).maxWidth);
  // Measured at its natural width: no maximum, and not shrunk by a flex row it sits in.
  const { maxWidth, width, flexShrink } = strip.style;
  strip.style.maxWidth = 'none';
  strip.style.width = 'max-content';
  strip.style.flexShrink = '0';
  const stripWidth = (): number => strip.getBoundingClientRect().width;
  let folded = false;
  tidyRuns(row, false);
  if (limit > 0 && stripWidth() > 0 && stripWidth() > limit) {
    tidyRuns(row, true);
    const card = foldItems(slots, roleOf, () => stripWidth() > limit, (slot, to) => {
      const host = hostOf.get(slot);
      if (!host) return;
      if (to === 'end') cardRow.append(host);
      else cardRow.prepend(host);
      tidyRuns(row, true);
    });
    folded = card.length > 0;
    if (!folded) tidyRuns(row, false);
  }
  strip.style.maxWidth = maxWidth;
  strip.style.width = width;
  strip.style.flexShrink = flexShrink;
  strip.toggleAttribute('data-folded', folded);
  return folded;
}

/* --------------------------------- parts ---------------------------------- */

/** One control of a group: on a folding strip it lives in a host node that moves between its place and the card. */
function FoldSlot({ children }: { children: ReactNode }): ReactNode {
  const fold = useContext(FoldContext);
  const slot = useRef<HTMLSpanElement>(null);
  const [host] = useState(() => {
    const node = document.createElement('span');
    node.style.display = 'contents';
    return node;
  });
  const changed = fold?.changed;
  useLayoutEffect(() => {
    const place = slot.current;
    if (!place) return;
    hostOf.set(place, host);
    place.append(host);
    changed?.();
    return () => {
      host.remove();
      changed?.();
    };
  }, [host, changed]);
  return (
    <span ref={slot} data-fold-slot="" className="contents">
      {createPortal(children, host)}
    </span>
  );
}

/** Props of {@link FoldGroup}. */
export interface FoldGroupProps extends HTMLAttributes<HTMLSpanElement> {
  /** The strip's last group (lead control, Delete, properties): it stays on the strip, apart from a `data-fold-more` button. */
  tail?: boolean;
}

/** A group of related controls; each of its children folds as one item. */
export function FoldGroup({ tail, className, children, ...rest }: FoldGroupProps): ReactNode {
  const fold = useContext(FoldContext);
  const items = fold ? Children.toArray(children).map((child, index) => <FoldSlot key={isValidElement(child) && child.key !== null ? child.key : index}>{child}</FoldSlot>) : children;
  return (
    <span data-fold-group="" data-fold-tail={tail ? '' : undefined} className={cn('flex shrink-0 items-center data-[fold-gone]:hidden', !/(?:^|\s)gap-/.test(className ?? '') && 'gap-0.5', className)} {...rest}>
      {items}
    </span>
  );
}

/** The divider between two groups; it goes when a group next to it empties. */
export function FoldDivider({ className }: { className?: string }): ReactNode {
  return (
    <span data-fold-divider="" aria-hidden="true" className="contents data-[fold-gone]:hidden">
      <span className={cn('mx-0.5 h-[18px] w-px shrink-0 bg-chrome-line', className)} />
    </span>
  );
}

/* --------------------------------- strip ---------------------------------- */

/** Props of {@link FoldToolbar}. */
export interface FoldToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** Fold controls that do not fit into the "More tools" card. */
  fold?: boolean;
  /** Changes with what the strip acts on (the selection): the card closes. */
  foldKey?: unknown;
  /** The room the card may open into; the viewport by default. */
  band?: FoldBand;
  /** Which side of the selection the strip sits on: the card opens on that side. */
  placed?: 'above' | 'below';
  /** The strip's widest (px); the viewport less 16px by default. */
  limit?: number;
  /** Classes of the row that holds the controls (padding, gaps). */
  rowClassName?: string;
  /** Size of the "More tools" button, matching the strip's controls. */
  size?: 'md' | 'lg' | 'xl';
  /** Arrow keys, Home and End move focus along the strip (default on). */
  arrowKeys?: boolean;
  /** Tab inside the strip: return true when it took the focus elsewhere itself. */
  onTabOut?: () => boolean;
}

/** A floating toolbar strip that folds what does not fit into a "More tools" card. */
export const FoldToolbar = forwardRef<HTMLDivElement, FoldToolbarProps>(function FoldToolbar(
  { fold = false, foldKey, band, placed = 'above', limit, rowClassName, size = 'md', arrowKeys = true, onTabOut, className, style, children, onKeyDown, onKeyDownCapture, onKeyUpCapture, onBlurCapture, ...rest },
  ref,
) {
  const narrowTouch = useSyncExternalStore(subscribeNarrowTouch, isNarrowTouch, () => false);
  const foldable = fold && !narrowTouch;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardRowRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const cardId = useId();
  const [folded, setFolded] = useState(false);
  const [open, setOpen] = useState(false);
  const [escapeDown, setEscapeDown] = useState(false);
  const opening = useRef(false);
  const tabbing = useRef(false);
  const remeasure = useRef<() => void>(() => undefined);
  const place = useRef<() => void>(() => undefined);
  const measuredKey = useRef<string | null>(null);

  const setStrip = useCallback(
    (node: HTMLDivElement | null) => {
      stripRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const changed = useCallback(() => remeasure.current(), []);
  const context = useMemo<FoldState>(() => ({ folded, changed }), [folded, changed]);

  useEffect(() => trackFocusKeys(window), []);

  // Measure now and whenever the row's width, the window, the content or the limit changes; never while a popup of
  // the strip is open or the focus is on a control that may move, so neither jumps between the strip and the card.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const row = rowRef.current;
    const card = cardRef.current;
    const cardRow = cardRowRef.current;
    if (!foldable || !strip || !row || !card || !cardRow) {
      remeasure.current = () => undefined;
      setFolded(false);
      setOpen(false);
      return;
    }
    let width = 0;
    let poll: number | undefined;
    const mayMove = (element: Element | null): boolean => {
      if (!element || !strip.contains(element)) return false;
      if (element.closest('[data-fold-slot]')?.querySelector('[data-fold-keep]')) return false;
      if (card.contains(element)) return !card.hidden;
      return element.closest('[data-fold-slot], [data-fold-toggle-group]') !== null;
    };
    const busy = (): boolean => popupOpenIn(strip) || mayMove(document.activeElement);
    const measure = (): void => {
      const isFolded = refoldStrip(strip, row, cardRow);
      width = row.getBoundingClientRect().width;
      measuredKey.current = contentKey(strip);
      observer.takeRecords();
      setFolded(isFolded);
      if (!isFolded) setOpen(false);
      else if (!card.hidden) place.current();
    };
    const run = (): void => {
      window.clearInterval(poll);
      poll = undefined;
      if (!busy()) return measure();
      poll = window.setInterval(() => {
        if (busy()) return;
        window.clearInterval(poll);
        poll = undefined;
        measure();
      }, IDLE_POLL_MS);
    };
    const observer = new MutationObserver(() => {
      if (contentKey(strip) !== measuredKey.current) run();
    });
    observer.observe(row, { childList: true, subtree: true, characterData: true });
    observer.observe(cardRow, { childList: true, subtree: true, characterData: true });
    const resize = new ResizeObserver(() => {
      if (Math.abs(row.getBoundingClientRect().width - width) > 0.5) run();
    });
    resize.observe(row);
    window.addEventListener('resize', run);
    remeasure.current = run;
    run();
    return () => {
      window.clearInterval(poll);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', run);
      remeasure.current = () => undefined;
    };
  }, [foldable]);

  useLayoutEffect(() => remeasure.current(), [limit]);

  // Another selection: the card closes, and focus in it goes back to its button.
  useLayoutEffect(() => {
    if (cardRef.current?.contains(document.activeElement)) toggleRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, [foldKey]);

  useLayoutEffect(() => {
    place.current = () => {
      const strip = stripRef.current;
      const card = cardRef.current;
      if (!strip || !card) return;
      const box = strip.getBoundingClientRect();
      const size = card.getBoundingClientRect();
      const at = placeCard(box, size, placed, band ?? { top: 0, bottom: window.innerHeight });
      card.dataset.side = at.side;
      card.style.right = at.shift > 0 ? `${-at.shift}px` : '';
    };
    if (open) place.current();
  });

  // Opened with More tools (a click or a key): the focus goes to the card's first button (else its first field), in view.
  useLayoutEffect(() => {
    const cardRow = cardRowRef.current;
    if (open && cardRow) cardRow.scrollLeft = 0;
    const pressed = opening.current;
    opening.current = false;
    if (!open || !pressed || !cardRow) return;
    const enabled = (selector: string): HTMLElement[] => [...cardRow.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.matches(':disabled, [tabindex="-1"]'));
    const first = firstInCard(enabled('button'), enabled('input, select, textarea'));
    if (!first) return;
    first.focus({ preventScroll: true });
    showControl(first);
  }, [open]);

  /** Scrolls a control into view along the strip, or inside the card. */
  const showControl = (control: HTMLElement): void => {
    const inCard = cardRowRef.current?.contains(control) === true;
    const box = inCard ? cardRowRef.current : rowRef.current;
    if (!box) return;
    box.scrollLeft += scrollToShow(control.getBoundingClientRect(), box.getBoundingClientRect(), inCard ? CARD_SCROLL_MARGIN : ROW_SCROLL_MARGIN);
  };

  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    // Only the main button clicks: a press of it, with the mouse or the keyboard, leads into the card.
    opening.current = event.button === 0;
    if (cardRef.current?.contains(document.activeElement)) toggleRef.current?.focus({ preventScroll: true });
    setOpen((was) => !was);
  };

  /** Enter and Space on More tools press it: a page's own shortcuts for those keys do not also run. */
  const keepActivation = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  };

  const keyDownCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isComposingKey(event.nativeEvent)) {
      onKeyDownCapture?.(event);
      return;
    }
    const strip = event.currentTarget;
    const target = event.target as Element;
    const inStrip = strip.contains(target);
    const popupOpen = popupOpenIn(strip);
    tabbing.current = event.key === 'Tab' && !event.ctrlKey && !event.metaKey && inStrip && !popupOpen;
    const escape = takesEscape({
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      ownedHere: inStrip && target.closest(FOLD_OWNS_ESCAPE) !== null,
      popupOpen,
      inTextField: isTextField(target),
    });
    if (escape) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (cardRef.current?.contains(target)) toggleRef.current?.focus({ preventScroll: true });
      setOpen(false);
      setEscapeDown(true);
      return;
    }
    onKeyDownCapture?.(event);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || isComposingKey(event.nativeEvent)) return;
    const strip = event.currentTarget;
    const target = event.target as HTMLElement;
    if (!strip.contains(target) || isTextField(target) || target.isContentEditable || popupOpenIn(strip)) return;
    if (event.key === 'Tab') {
      if (onTabOut?.()) event.preventDefault();
      return;
    }
    if (!arrowKeys) return;
    const controls = [...strip.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((control) => control.getClientRects().length > 0 && (control === target || !control.matches(PASSED_OVER)));
    const next = arrowStep(event, controls.findIndex((control) => control.contains(target)), controls.length);
    if (next === null) return;
    event.preventDefault();
    const control = controls[next]!;
    control.focus({ preventScroll: true });
    showControl(control);
  };

  const keyUpCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' || event.key === 'Meta') setEscapeDown(false);
    tabbing.current = false;
    onKeyUpCapture?.(event);
  };

  const blurCapture = (event: FocusEvent<HTMLDivElement>): void => {
    const strip = event.currentTarget;
    const to = event.relatedTarget as Element | null;
    if (to === null || !strip.contains(to)) {
      const exit = focusExit({
        into: to === null ? 'nowhere' : 'outside',
        tabbing: tabbing.current,
        byFocusKey: focusKeyDown && strip.contains(event.target as Node),
        popupOpen: popupOpenIn(strip),
        toToast: to?.closest('[data-toast]') != null,
      });
      if (exit === 'close') setOpen(false);
      else if (exit === 'close-unless-back')
        window.setTimeout(() => {
          if (!strip.contains(document.activeElement)) setOpen(false);
        });
      tabbing.current = false;
      setEscapeDown(false);
    }
    onBlurCapture?.(event);
  };

  return (
    <Card
      ref={setStrip}
      role="toolbar"
      data-fold-strip={foldable ? '' : undefined}
      // The card hangs off the strip: a strip placed some other way keeps its own position.
      className={cn(!POSITIONED.test(className ?? '') && 'relative', 'max-w-[calc(100vw-16px)]', className)}
      style={limit === undefined ? style : { ...style, maxWidth: limit }}
      onKeyDownCapture={keyDownCapture}
      onKeyDown={keyDown}
      onKeyUpCapture={keyUpCapture}
      onBlurCapture={blurCapture}
      {...rest}
    >
      <div
        ref={rowRef}
        data-fold-row=""
        data-fold-escape={foldable && (open || escapeDown) ? '' : undefined}
        className={cn('flex min-w-0 flex-auto items-center gap-1 overflow-x-auto rounded-[inherit] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', rowClassName)}
      >
        <FoldContext.Provider value={foldable ? context : null}>
          {children}
          {foldable ? (
            <span data-fold-toggle-group="" className="flex shrink-0 items-center data-[fold-gone]:hidden">
              <Tip label={MORE_TOOLS} side={placed === 'below' ? 'bottom' : 'top'}>
                <ChromeButton
                  ref={toggleRef}
                  square
                  size={size}
                  data-fold-toggle=""
                  aria-label={MORE_TOOLS}
                  aria-expanded={open}
                  aria-controls={cardId}
                  className={cn(size === 'xl' && '[&_svg]:size-[18px]', open && 'bg-chrome-hover')}
                  onClick={toggle}
                  onKeyDown={keepActivation}
                >
                  <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden="true" />
                </ChromeButton>
              </Tip>
            </span>
          ) : null}
        </FoldContext.Provider>
      </div>
      {foldable ? (
        <div
          ref={cardRef}
          id={cardId}
          role="group"
          aria-label={MORE_TOOLS}
          data-fold-card=""
          data-fold-escape=""
          data-side={placed}
          hidden={!open}
          className="absolute right-0 w-max max-w-[calc(100vw-16px)] rounded-[inherit] bg-chrome text-chrome-fg shadow-chrome data-[side=above]:bottom-[calc(100%+8px)] data-[side=below]:top-[calc(100%+8px)]"
        >
          <div ref={cardRowRef} data-fold-card-row="" className="flex items-center gap-0.5 overflow-x-auto rounded-[inherit] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" />
        </div>
      ) : null}
    </Card>
  );
});
