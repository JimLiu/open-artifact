/**
 * The page edit mode. Over a one-writer page it marks the piece under the
 * pointer (a run of words, a drawing, or a card), picks it on click, and
 * edits through the page draft: typing in a run of words opens a words
 * session, a card can be dragged by its grip, stepped or deleted, and the
 * piece toolbar offers formatting, Ask and the More menu. The keyboard walks
 * the pieces (Tab), opens a run for typing (Enter or a letter), deletes a
 * card (Delete) and opens the toolbar (Shift+F10). Washes show which words
 * can be typed in.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { isComposingKey } from '@open-artifact/ui/keys';
import { createPortal, flushSync } from 'react-dom';
import { announce, isApplePlatform, writeClipboardText } from '@open-artifact/editor-kit';
import { LinkCard, LinkDetailsCard, LINK_COPIED_MESSAGE, LINK_COPY_FAILED_MESSAGE, toast } from '@open-artifact/ui';
import { canOpenLink, screenBox, type ScreenBox } from '@open-artifact/ui/link-card';
import { describeElementSelection, type ElementSelection } from '../page/selection.ts';
import { createCardMover } from './cards.ts';
import type { PageDraft } from './draft.ts';
import { CARD_DRAG_THRESHOLD, createHoverIntent, isContextMenuKey, type CardDropMark } from './drops.ts';
import { inflateBox, rectOf } from './geometry.ts';
import {
  describeClickThrough,
  describePieceKeys,
  editLinkKind,
  hasEditLinkCard,
  isArrowKey,
  LINK_CARET_CARD_MS,
  LINK_CARET_MOVED_MS,
  linkEnterAction,
  pieceKeyAction,
  type EditLinkKind,
} from './keys.ts';
import { DELETE_CARD, EDIT_GROUP_LABEL, MOVE_CARD_EARLIER, MOVE_CARD_LATER } from './labels.ts';
import {
  CARD_GRIP_CLASS,
  EDIT_MARK_INFLATE,
  EDIT_REFUSAL_MS,
  EDIT_TIP_DELAY,
  IBEAM_ATTRIBUTE,
  KEPT_ATTRIBUTE,
  STACKING_CONTEXT_PROPERTIES,
  STICKY_ATTRIBUTE,
  WORDS_ATTRIBUTE,
  clipRectToBounds,
  cutOutClipPath,
  isRowInRoom,
  placeEditTip,
  toLayerBox,
  type EditMarkLook,
  type LayerBox,
} from './layer.ts';
import {
  CardGrip,
  EXPORT_VISIBILITY_OPTIONS,
  EditMark,
  EditTipView,
  addTrustedWindowListener,
  collectFocusableDescendants,
  getEditMarkRect,
  hasOpenOverlay,
  isInlineDrawing,
  isShown,
  listLineRects,
} from './marks.tsx';
import { isModK, PieceToolbar, type PieceToolbarRow } from './PieceToolbar.tsx';
import {
  TAB_LIKE_SELECTOR,
  asDrawingPiece,
  collectEditableWords,
  collectPieces,
  collectTextLeaves,
  describePiece,
  findBlockBox,
  findPieceAt,
  findWordsRange,
  getInactiveTab,
  getPieceRect,
  getScrollContainer,
  getViewportBounds,
  getViewportRoom,
  hasPieceControl,
  isPassThroughClick,
  isPieceShownOnPage,
  isStagedPiece,
  isSwappedPiece,
  type PagePiece,
} from './pieces.ts';
import { FORM_CONTROL_SELECTOR, isWordsAtom, normalizeLinkHref } from './runs.ts';
import { useLinedMarks, type SourceNameOf } from './SourceMarksLayer.tsx';
import { CHROME_SELECTOR, isLinkableHost, describeUneditable, uneditableRefusal, visitWords, type WordsHost, type WordsPoint, type WordsStart, type WordsVisit } from './words.ts';

export const EDIT_MODE_ATTRIBUTE = 'data-dash-mode';

const TYPING_CONTROL_SELECTOR = `${FORM_CONTROL_SELECTOR}, [contenteditable]`;
const USABLE_CONTROL_SELECTOR = `a[href], button, ${FORM_CONTROL_SELECTOR}`;
const EDIT_OBSERVER_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['hidden', 'class', 'style', 'open', 'aria-selected', 'aria-pressed', 'aria-current'],
};

const findPieceControl = (element: Element): Element | null => element.closest(USABLE_CONTROL_SELECTOR) ?? element.querySelector(USABLE_CONTROL_SELECTOR);

const washKeys = new WeakMap<Element, number>();
let washKeyCount = 0;
const washKeyOf = (element: Element): number => {
  const known = washKeys.get(element);
  if (known !== undefined) return known;
  washKeys.set(element, ++washKeyCount);
  return washKeyCount;
};

/** A tip over an element; a refusal (why an edit cannot happen) stays up for a while. */
interface EditTip {
  at: Element;
  words: ReactNode;
  refusal: boolean;
  /** Where the pointer was when the tip came up. */
  pointer?: { x: number; y: number } | null;
}

/** The wash over one editable run of words, in the washes layer's coordinates. */
interface EditWash {
  el: Element;
  line: number;
  at: LayerBox & { zIndex?: number };
}

/** The pointer-down that may pick a piece on pointer-up. */
interface EditPress {
  x: number;
  y: number;
  piece: PagePiece | null;
  words: PagePiece | null;
  box: DOMRect | null;
  on: Element;
  /** A link in the words pressed: released, it shows its card; held, it opens. */
  link?: HTMLAnchorElement;
  /** A link (not in words) whose piece the press picks; its card shows with it. */
  select?: HTMLAnchorElement;
}

/** How long (ms) a press on a link in the words is held to open it. */
export const LINK_HOLD_MS = 250;
/** A second press on the same link this soon (ms) after the first edits its words as usual. */
export const LINK_REPRESS_MS = 500;
/** How far (px) the card keeps clear of the piece toolbar. */
const LINK_CARD_AVOID_PAD = 4;

/** The card of a link on the page. */
interface EditLinkCard {
  link: HTMLAnchorElement;
  /** The piece the link is in: its words, or the piece a select link picked. */
  words: PagePiece;
  /** The link's words may take another address or lose the link. */
  editable: boolean;
  /** The piece picked when the card opened; another pick puts the card away. */
  under: Element | null;
  /** Opened by a press, or by the caret (Mod+K, an arrow key) in the words being typed. */
  by: 'press' | 'caret';
  /** Opens on the address input. */
  edit: boolean;
  /** Tells one opening from the next. */
  n: number;
}

let cardOpenings = 0;
const nextCardOpening = (): number => (cardOpenings += 1);

/** What edit mode does with `link`, in `piece`. */
function editLinkKindOf(link: HTMLAnchorElement, piece: PagePiece | null): EditLinkKind {
  const text = link.textContent ?? '';
  const whole = piece !== null && (link === piece.el || link.contains(piece.el) || (text.trim() !== '' && text.trim() === (piece.el.textContent ?? '').trim()));
  return editLinkKind({ live: link.closest(TAB_LIKE_SELECTOR) !== null, whole, text, inWords: piece?.kind === 'words' && piece.el.contains(link) });
}

/**
 * A link that is part of the words of `words` (not the whole of them: a piece that is all one link is picked as
 * usual), or null.
 */
function textLinkIn(target: EventTarget | null, words: PagePiece | null): HTMLAnchorElement | null {
  if (words === null || !(target instanceof Element)) return null;
  const link = target.closest<HTMLAnchorElement>('a[href]');
  return link !== null && words.el.contains(link) && editLinkKindOf(link, words) === 'edit' ? link : null;
}

/** The link the caret is in, in `words`: a collapsed selection inside a link there. */
function caretLink(words: Element): HTMLAnchorElement | null {
  const selection = document.getSelection();
  if (selection === null || !selection.isCollapsed || selection.anchorNode === null || !words.contains(selection.anchorNode)) return null;
  const node = selection.anchorNode;
  const link = (node instanceof Element ? node : node.parentElement)?.closest<HTMLAnchorElement>('a[href]') ?? null;
  return link !== null && words.contains(link) ? link : null;
}

/** A link in words whose host can hold links, kept whole by nothing, with no link inside it. */
const isEditableLink = (link: HTMLAnchorElement, words: PagePiece): boolean =>
  isLinkableHost(words.el) && !isWordsAtom(link) && link.querySelector('a') === null;

function openPageLink(href: string): void {
  if (canOpenLink(href)) window.open(href, '_blank', 'noopener,noreferrer');
}

async function copyLink(href: string): Promise<boolean> {
  try {
    await writeClipboardText(href);
    announce(LINK_COPIED_MESSAGE);
    return true;
  } catch {
    toast.add({ title: LINK_COPY_FAILED_MESSAGE });
    return false;
  }
}

type EditPointer = Pick<MouseEvent, 'clientX' | 'clientY' | 'metaKey' | 'ctrlKey' | 'target'>;

export interface PageEditModeProps {
  root: HTMLElement;
  draft: PageDraft;
  /** Hide the edit mode's chrome (comments are on, a dialog is open, the page is saving). */
  off: boolean;
  /** Ask about the picked piece (the selection is read only when the ask goes ahead); null: no Ask button. */
  onAsk: ((pick: () => ElementSelection) => void) | null;
  /** Whether edit mode takes over the page's text selection when it opens. */
  adopts?: () => boolean;
  sourceOf?: SourceNameOf;
  onSource?: (target: Element | null) => void;
}

const never = (): boolean => false;
const noSourceName: SourceNameOf = () => null;
const noSource = (): void => undefined;

export function PageEditMode({ root, draft, off, onAsk, adopts = never, sourceOf = noSourceName, onSource = noSource }: PageEditModeProps): ReactNode {
  const propsRef = useRef({ sourceOf, onSource });
  propsRef.current = { sourceOf, onSource };
  const [picked, setPicked] = useState<PagePiece | null>(null);
  const [washes, setWashes] = useState<EditWash[]>([]);
  const washesRef = useRef<HTMLDivElement>(null);
  const [hoveredPiece, setHoveredPiece] = useState<PagePiece | null>(null);
  const [hoveredCard, setHoveredCard] = useState<Element | null>(null);
  const [hoveredCell, setHoveredCell] = useState<Element | null>(null);
  const [dropMarks, setDropMarks] = useState<CardDropMark[]>([]);
  const [tip, setTip] = useState<EditTip | null>(null);
  const [linkCard, setLinkCard] = useState<EditLinkCard | null>(null);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const pressedRef = useRef<WordsPoint | null>(null);
  const visitRef = useRef<WordsVisit | null>(null);
  const lastPickedRef = useRef<PagePiece | null>(null);
  const lastHoveredRef = useRef<PagePiece | null>(null);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const holding = draft.holding();

  const sourceTip = useCallback((element: Element): string | null => propsRef.current.sourceOf(element), []);
  const host = useMemo(
    (): WordsHost => ({
      draft,
      changed: redraw,
      swapped: (at) => isSwappedPiece(at, root),
      refuse(at, words) {
        announce(words);
        setTip({ at, words, refusal: true });
      },
      tip: (at, words = '') =>
        setTip((current) => (current?.refusal === true ? current : at === null ? null : { at, words: sourceTip(at) ?? words, refusal: false })),
      ended(reason) {
        if (reason !== 'key') return;
        lastPickedRef.current = pickedRef.current;
        setPicked(null);
        root.focus({ preventScroll: true });
      },
    }),
    [draft, root, sourceTip],
  );

  const pick = useCallback(
    (piece: PagePiece | null, start?: WordsStart) => {
      const typing = piece?.kind === 'words' && start !== undefined;
      lastPickedRef.current = null;
      pressedRef.current = start != null && 'x' in start ? start : null;
      draft.settle(true);
      setPicked(piece);
      setHoveredPiece(null);
      visitRef.current = piece?.kind === 'words' && start !== undefined ? visitWords(piece.el, start, host) : null;
      if (typing) return;
      document.getSelection()?.removeAllRanges();
      root.focus({ preventScroll: true });
    },
    [draft, host, root],
  );

  const mover = useMemo(
    () => createCardMover({ draft, root, select: (element) => pick(element === null ? null : asDrawingPiece(element)), marks: setDropMarks }),
    [draft, root, pick],
  );

  useEffect(() => draft.subscribe(redraw), [draft]);
  const linkCardRef = useRef(linkCard);
  linkCardRef.current = linkCard;
  // Another piece picked, or edit mode off: the link card goes.
  useEffect(() => {
    if (off || (linkCard !== null && (picked?.el ?? null) !== linkCard.under)) setLinkCard(null);
  }, [picked, off, linkCard]);
  // So does any change to the draft once the card is up (the pick that opened it came before).
  useEffect(() => {
    if (linkCard === null) return;
    const stateOf = (): string => {
      const visiting = draft.visit();
      const typed = visiting === null ? '' : visiting.el === linkCard.words.el ? visiting.el.innerHTML : '*';
      return `${draft.count()}|${draft.canUndo()}|${draft.canRedo()}|${typed}`;
    };
    const opened = stateOf();
    return draft.subscribe(() => {
      if (stateOf() !== opened) setLinkCard(null);
    });
  }, [linkCard, draft]);
  // The card of a link that can't change is placed once; a scroll puts it away rather than leave it behind.
  const fixedCard = linkCard !== null && !linkCard.editable;
  useEffect(() => {
    if (!fixedCard) return;
    const controller = new AbortController();
    window.addEventListener('scroll', () => setLinkCard(null), { capture: true, passive: true, signal: controller.signal });
    return () => controller.abort();
  }, [fixedCard]);

  const adoptedRef = useRef(false);
  useEffect(() => {
    if (adoptedRef.current) return;
    adoptedRef.current = true;
    const selection = document.getSelection();
    const words = adopts() && selection !== null && selection.rangeCount > 0 ? findWordsRange(selection.getRangeAt(0), root) : null;
    if (words !== null) pick(words.piece, words.part);
  }, [adopts, root, pick]);

  useEffect(() => {
    if (tip?.refusal !== true) return;
    const timer = setTimeout(() => setTip(null), EDIT_REFUSAL_MS);
    return () => clearTimeout(timer);
  }, [tip]);

  useEffect(() => {
    if (off) return;
    root.setAttribute(EDIT_MODE_ATTRIBUTE, 'edit');
    const scroller = getScrollContainer(root) ?? root;
    const inRoot = (event: Event): boolean => event.target instanceof Node && root.contains(event.target);
    let frame = 0;
    const scheduleRedraw = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        flushSync(redraw);
      });
    };
    let pointer: Pick<MouseEvent, 'clientX' | 'clientY'> | null = null;
    let ibeam: Element | null = null;
    let tipped: Element | null = null;
    let tipTimer: ReturnType<typeof setTimeout> | undefined;
    const cellHover = createHoverIntent(setHoveredCell);
    const pieceHover = createHoverIntent((target) => {
      setHoveredPiece(findPieceAt(target, root));
      if (target !== null) setHoveredCard(findBlockBox(target, root));
    });
    const tipFor = (element: Element | null, words: ReactNode = null): void => {
      if (element === tipped) return;
      tipped = element;
      clearTimeout(tipTimer);
      host.tip(null);
      if (words !== null && element !== null)
        tipTimer = setTimeout(() => {
          host.tip(element, words);
          const at = pointer === null ? null : { x: pointer.clientX, y: pointer.clientY };
          setTip((current) => (current === null || current.at !== element || current.refusal ? current : { ...current, pointer: at }));
        }, EDIT_TIP_DELAY);
    };
    const setIbeam = (element: Element | null): void => {
      if (element === ibeam) return;
      ibeam?.removeAttribute(IBEAM_ATTRIBUTE);
      element?.setAttribute(IBEAM_ATTRIBUTE, '');
      ibeam = element;
    };
    const leave = (): void => {
      pointer = null;
      pieceHover.leave();
      cellHover.leave();
      setHoveredCard(null);
      tipFor(null);
      setIbeam(null);
    };
    const pieceUnder = (event: EditPointer): PagePiece | null => {
      const piece = isPassThroughClick(event as MouseEvent, root) ? null : findPieceAt(event.target, root, event);
      setIbeam(piece?.kind === 'words' ? piece.el : null);
      return piece;
    };
    const hoverTarget = (piece: PagePiece | null): Element | null => (piece === null || piece.el === pickedRef.current?.el ? null : piece.el);

    const onPointerMove = (event: PointerEvent): void => {
      if (event.buttons !== 0 || draft.holding() || !(event.target instanceof Element)) return;
      if (event.target.classList.contains(CARD_GRIP_CLASS)) {
        tipFor(null);
        return;
      }
      if (!inRoot(event)) {
        leave();
        return;
      }
      pointer = { clientX: event.clientX, clientY: event.clientY };
      const piece = pieceUnder(event);
      pieceHover.move(hoverTarget(piece), event.clientX, event.clientY, event.timeStamp);
      const cell = event.target.closest('td, th');
      cellHover.move(
        cell !== null && cell.hasAttribute('data-source') && propsRef.current.sourceOf(cell) !== null ? cell : null,
        event.clientX,
        event.clientY,
        event.timeStamp,
      );
      const control = piece === null || piece.kind === 'block' || event.target.closest(TAB_LIKE_SELECTOR) !== null ? null : event.target.closest(USABLE_CONTROL_SELECTOR);
      const linkKind = control instanceof HTMLAnchorElement && control.hasAttribute('href') ? editLinkKindOf(control, piece) : null;
      // A link with a card says nothing on hover; one with no words has its tip on its picture.
      if (control !== null && (linkKind === null || !hasEditLinkCard(linkKind)))
        tipFor(linkKind === 'card' ? (control.querySelector('svg') ?? control) : control, describeClickThrough(control.getAttribute('href'), isApplePlatform()));
      else if (piece?.kind === 'drawing') tipFor(piece.el, sourceTip(event.target) ?? describeUneditable(piece.el));
      else tipFor(null);
      const card = findBlockBox(event.target, root);
      setHoveredCard((current) => (current === card ? current : null));
    };
    const onScroll = (): void => {
      setHoveredCard(null);
      tipFor(null);
      pieceHover.scrolled(() =>
        pointer === null
          ? null
          : hoverTarget(pieceUnder({ ...pointer, target: document.elementFromPoint(pointer.clientX, pointer.clientY), metaKey: false, ctrlKey: false })),
      );
      scheduleRedraw();
    };

    let press: EditPress | null = null;
    let linkHold: ReturnType<typeof setTimeout> | undefined;
    let linkPressed: { link: Element; at: number } | null = null;
    let lastSourceClick = { t: -Infinity, x: 0, y: 0 };
    let doubleClick = false;
    let swallowing = false;
    let passThrough = false;
    let tabbing = false;

    const onPointerDown = (event: PointerEvent): void => {
      press = null;
      swallowing = passThrough = false;
      tabbing = false;
      pieceHover.press();
      cellHover.press();
      tipFor(null);
      setTip(null);
      doubleClick =
        event.button === 0 &&
        event.timeStamp - lastSourceClick.t < 500 &&
        Math.hypot(event.clientX - lastSourceClick.x, event.clientY - lastSourceClick.y) <= CARD_DRAG_THRESHOLD;
      if (doubleClick) {
        swallowing = true;
        event.stopPropagation();
        return;
      }
      if (event.button !== 0 || hasOpenOverlay() || !(event.target instanceof Element) || !scroller.contains(event.target) || event.target.closest(CHROME_SELECTOR) !== null) return;
      setLinkCard(null);
      passThrough = isPassThroughClick(event, root);
      if (passThrough && event.target.closest(TYPING_CONTROL_SELECTOR) !== null) draft.settle(true);
      if (passThrough) return;
      swallowing = inRoot(event);
      if (swallowing) event.stopPropagation();
      const piece = findPieceAt(event.target, root, event);
      if ((draft.visit()?.el.contains(event.target) === true && piece?.kind !== 'drawing') || draft.holding()) return;
      const around = piece !== null && isInlineDrawing(piece) && piece.el.parentElement !== null ? findPieceAt(piece.el.parentElement, root) : piece;
      press = {
        x: event.clientX,
        y: event.clientY,
        piece,
        words: around?.kind === 'words' ? around : null,
        box: piece === null ? null : getPieceRect(piece),
        on: event.target,
      };
      const link = textLinkIn(event.target, press.words);
      const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
      // A select link picks its piece as usual and shows its card; pressed again once picked, it only picks.
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (anchor !== null && plain && piece !== null && pickedRef.current?.el !== piece.el && editLinkKindOf(anchor, piece) === 'select') press.select = anchor;
      const again = linkPressed !== null && linkPressed.link === link && event.timeStamp - linkPressed.at < LINK_REPRESS_MS;
      if (link !== null && plain && !again && pickedRef.current?.el !== press.words?.el) {
        press.link = link;
        linkPressed = { link, at: event.timeStamp };
        try {
          link.setPointerCapture(event.pointerId);
        } catch {
          // The press goes on without capture.
        }
        clearTimeout(linkHold);
        const held = press;
        linkHold = setTimeout(() => {
          if (press !== held) return;
          press = null;
          setLinkCard(null);
          openPageLink(link.href);
        }, LINK_HOLD_MS);
        return;
      }
      draft.settle(true);
      const card = piece === null || press.words !== null || isStagedPiece(piece.el, root) ? null : (findBlockBox(piece.el, root) ?? piece.el);
      if (card !== null) mover.press(event, card, false);
    };

    const keepSelectionInWords = (): void => {
      const selection = document.getSelection();
      const words = press?.words?.el ?? null;
      if (
        words === null ||
        selection === null ||
        selection.isCollapsed ||
        selection.anchorNode === null ||
        selection.focusNode === null ||
        !words.contains(selection.anchorNode) ||
        words.contains(selection.focusNode)
      )
        return;
      const after = (words.compareDocumentPosition(selection.focusNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, words, after ? words.childNodes.length : 0);
    };

    const onPointerUp = (event: PointerEvent): void => {
      keepSelectionInWords();
      const pressed = press;
      press = null;
      if (swallowing) event.stopPropagation();
      clearTimeout(linkHold);
      if (pressed === null || draft.holding() || mover.dragging()) return;
      if (pressed.link !== undefined && pressed.words !== null) {
        const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CARD_DRAG_THRESHOLD;
        if (moved || !pressed.link.isConnected) return;
        // A link released where it was pressed shows its card; nothing stays picked under it.
        pick(null);
        propsRef.current.onSource(null);
        setLinkCard({ link: pressed.link, words: pressed.words, editable: isEditableLink(pressed.link, pressed.words), under: null, by: 'press', edit: false, n: nextCardOpening() });
        return;
      }
      const piece = pressed.piece?.el.isConnected === false ? findPieceAt(document.elementFromPoint(event.clientX, event.clientY), root, event) : pressed.piece;
      const selection = document.getSelection();
      if (piece?.kind === 'words' && selection !== null && !selection.isCollapsed && piece.el.contains(selection.anchorNode)) {
        pick(piece, selection.getRangeAt(0));
        return;
      }
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CARD_DRAG_THRESHOLD;
      if (moved && pressed.words?.el.isConnected === true && selection !== null && !selection.isCollapsed && pressed.words.el.contains(selection.anchorNode)) {
        pick(pressed.words, selection.getRangeAt(0));
        return;
      }
      if (moved) return;
      const shift = piece === pressed.piece && piece !== null && pressed.box !== null ? { box: pressed.box, now: getPieceRect(piece) } : null;
      pick(piece, {
        x: event.clientX + (shift === null ? 0 : shift.now.left - shift.box.left),
        y: event.clientY + (shift === null ? 0 : shift.now.top - shift.box.top),
        clicks: 1,
      });
      const on = pressed.on.isConnected ? pressed.on : document.elementFromPoint(event.clientX, event.clientY);
      const source =
        piece === null || piece.kind === 'words' || on === null
          ? null
          : piece.kind === 'block'
            ? on.closest('[data-source]')
            : propsRef.current.sourceOf(on) !== null
              ? on
              : piece.el;
      if (source !== null && propsRef.current.sourceOf(source) !== null) lastSourceClick = { t: event.timeStamp, x: event.clientX, y: event.clientY };
      propsRef.current.onSource(source);
      const select = pressed.select;
      if (select !== undefined && select.isConnected && piece !== null && piece.el === pressed.piece?.el)
        setLinkCard({ link: select, words: piece, editable: false, under: piece.el, by: 'press', edit: false, n: nextCardOpening() });
    };

    const onMouseButton = (event: MouseEvent): void => {
      if (swallowing) event.stopPropagation();
      if (event.type === 'mousedown' && (doubleClick || (passThrough && draft.visit() !== null) || press?.link !== undefined)) event.preventDefault();
    };

    const refuseDrawing = (drawing: Element): void => {
      const words = isStagedPiece(drawing, root) && !isInlineDrawing({ el: drawing, kind: 'drawing' }) ? describeUneditable(drawing) : uneditableRefusal(drawing);
      if (words !== null) host.refuse(drawing, words);
    };

    const onClick = (event: MouseEvent): void => {
      const swallowed = swallowing && event.detail > 0;
      swallowing = false;
      if (!swallowed && !inRoot(event)) return;
      if (!swallowed && isPassThroughClick(event, root)) {
        draft.settle(true);
        onScroll();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const current = pickedRef.current;
      if (event.detail === 2 && current?.kind === 'drawing') refuseDrawing(current.el);
    };

    const stepPiece = (from: PagePiece | null, step: number): boolean => {
      const pieces = collectPieces(root, root);
      const room = getViewportBounds(getScrollContainer(root));
      const index = from === null ? pieces.findIndex((piece) => getPieceRect(piece).bottom >= room.top) : pieces.findIndex((piece) => piece.el === from.el) + step;
      const next = pieces[index] ?? null;
      pick(next);
      if (next === null) return false;
      next.el.scrollIntoView({ block: 'nearest' });
      announce(
        describePieceKeys(
          describePiece(next, root),
          {
            block: next.kind === 'block',
            typing: next.kind === 'words' && getInactiveTab(next.el, root) === null,
            usable: next.el.closest(TAB_LIKE_SELECTOR) === null && findPieceControl(next.el) !== null,
          },
          isApplePlatform(),
        ),
      );
      return true;
    };
    const leaveForward = (): void => {
      const stops = collectFocusableDescendants(document.body).filter((stop) => !root.contains(stop) && isShown(stop));
      (stops.find((stop) => (root.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) ?? stops[0])?.focus();
    };
    const useControl = (control: Element | null): void => {
      if (!(control instanceof HTMLElement)) return;
      if (control.matches(TYPING_CONTROL_SELECTOR)) control.focus();
      else control.click();
    };
    const onFocusIn = (event: FocusEvent): void => {
      if (tabbing && event.target === root && pickedRef.current === null && !(event.relatedTarget instanceof Node && root.contains(event.relatedTarget))) stepPiece(null, 1);
    };

    const deletePiece = (current: PagePiece, event: KeyboardEvent): boolean => {
      const words =
        current.kind === 'drawing' && current.el.parentElement !== null && !(hasPieceControl(current.el) && current.el.closest('label') !== null)
          ? findPieceAt(current.el.parentElement, root)
          : null;
      if (words?.kind === 'words' && words.el.contains(current.el)) {
        const range = document.createRange();
        range.selectNode(current.el);
        pick(words, range);
        propsRef.current.onSource(null);
        event.stopPropagation();
        return false;
      }
      if (isStagedPiece(current.el, root)) refuseDrawing(current.el);
      else {
        const pieces = collectPieces(root, root);
        const before = pieces[pieces.findIndex((piece) => piece.el === current.el) - 1] ?? null;
        mover.remove(current.el.closest('label') ?? current.el);
        lastPickedRef.current = before;
      }
      return true;
    };

    let arrowAt = -Infinity;
    let caretTimer: ReturnType<typeof setTimeout> | undefined;
    let caretFor: HTMLAnchorElement | null = null;
    const caretCard = (link: HTMLAnchorElement, words: PagePiece, edit: boolean): void => {
      const editable = isEditableLink(link, words);
      setLinkCard({ link, words, editable, under: words.el, by: 'caret', edit: edit && editable, n: nextCardOpening() });
    };
    /** The caret's words: the words being typed, while they have the focus. */
    const caretWords = (): PagePiece | null => {
      const typing = draft.visit()?.el ?? null;
      const words = pickedRef.current;
      return typing !== null && words?.el === typing && document.activeElement === typing ? words : null;
    };
    // A caret an arrow key moved into a link shows the link's card once it rests there; moved out, the card goes.
    const onCaretMoved = (): void => {
      const words = caretWords();
      if (words === null) return;
      const link = caretLink(words.el);
      const card = linkCardRef.current;
      if (card?.by === 'caret' && card.link !== link) setLinkCard(null);
      if (link === caretFor) return;
      clearTimeout(caretTimer);
      caretFor = null;
      if (link === null || link === card?.link || performance.now() - arrowAt > LINK_CARET_MOVED_MS || editLinkKindOf(link, words) !== 'edit') return;
      caretFor = link;
      caretTimer = setTimeout(() => {
        caretFor = null;
        if (caretWords() === words && caretLink(words.el) === link) caretCard(link, words, false);
      }, LINK_CARET_CARD_MS);
    };
    /** Enter, Alt+Enter and Mod+K on links; true when the key was taken. */
    const onLinkKey = (event: KeyboardEvent, target: Element): boolean => {
      const typing = draft.visit()?.el ?? null;
      if (isModK(event)) {
        const card = linkCardRef.current;
        if (target.closest('[data-edit-link-card]') !== null) {
          if (card === null || !card.editable || target.closest('input') !== null) return false;
          setLinkCard({ ...card, edit: true, n: nextCardOpening() });
          return true;
        }
        const words = caretWords();
        const link = words === null || target !== words.el ? null : caretLink(words.el);
        if (words === null || link === null || editLinkKindOf(link, words) !== 'edit') return false;
        clearTimeout(caretTimer);
        caretFor = null;
        caretCard(link, words, true);
        return true;
      }
      if (isArrowKey(event.key)) {
        if (typing !== null && target === typing) arrowAt = performance.now();
        return false;
      }
      const focused = target instanceof HTMLAnchorElement && target.hasAttribute('href') && root.contains(target) && typing?.contains(target) !== true ? target : null;
      const opens = focused !== null && (event.altKey || !['live', 'select'].includes(editLinkKindOf(focused, findPieceAt(focused, root))));
      const action = linkEnterAction(event, opens);
      if (action === 'focused' && focused !== null) openPageLink(focused.href);
      else if (action === 'caret') {
        const words = caretWords();
        const link = words === null || target !== words.el ? null : caretLink(words.el);
        if (link === null) return false;
        if (!event.repeat) openPageLink(link.href);
      }
      return action !== null;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      setTip(null);
      tabbing = event.key === 'Tab';
      if (!event.defaultPrevented && !isComposingKey(event) && !draft.holding() && !hasOpenOverlay() && event.target instanceof Element && onLinkKey(event, event.target)) {
        // Taken here, the key reaches neither the words being typed nor the piece toolbar.
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.defaultPrevented || isComposingKey(event) || event.altKey || draft.holding() || hasOpenOverlay() || !(event.target instanceof Element)) return;
      const current = pickedRef.current?.el.isConnected === true ? pickedRef.current : null;
      const typingIn = draft.visit()?.el;
      const inTyping = event.target === typingIn;
      const onPage = event.target === document.body || (root.contains(event.target) && event.target.closest(TYPING_CONTROL_SELECTOR) === null);
      const toolbar = toolbarRef.current;
      const toolbarStops = toolbar?.contains(event.target) === true ? collectFocusableDescendants(toolbar) : [];
      const leavingToolbar =
        toolbarStops.length > 0 &&
        (event.key === 'Escape' ? event.target.matches('button') : event.key === 'Tab' && event.target === toolbarStops.at(event.shiftKey ? 0 : -1));
      if (!inTyping && !onPage && !leavingToolbar) return;
      const printable = event.key.length === 1;
      if (event.metaKey || event.ctrlKey) {
        if (current === null || inTyping || event.key !== 'Enter' || (event.ctrlKey && isApplePlatform())) return;
        useControl(findPieceControl(current.el));
      } else if (event.key === 'Tab') {
        const from = current ?? findPieceAt(draft.last(), root) ?? lastPickedRef.current;
        const stepped = (from !== null || !event.shiftKey) && stepPiece(from, event.shiftKey ? -1 : 1);
        if (!stepped && event.shiftKey) return;
        if (!stepped) leaveForward();
      } else if (current === null) return;
      else if (isContextMenuKey(event)) toolbar?.querySelector('button')?.focus();
      else if (inTyping) return;
      else if (leavingToolbar && typingIn instanceof HTMLElement) typingIn.focus({ preventScroll: true });
      else {
        const inactiveTab = getInactiveTab(current.el, root);
        const action = pieceKeyAction({ key: event.key, kind: current.kind, inactiveTab: inactiveTab !== null, sourced: propsRef.current.sourceOf(current.el) !== null });
        if (action === null) return;
        if (action === 'unpick') {
          pick(null);
          propsRef.current.onSource(null);
          lastPickedRef.current = current;
        } else if (action === 'source') propsRef.current.onSource(current.el);
        else if (action === 'tab') (inactiveTab as HTMLElement | null)?.click();
        else if (action === 'type') pick(current, null);
        else if (action === 'refuse') refuseDrawing(current.el);
        else if (!deletePiece(current, event)) return;
      }
      event.stopPropagation();
      if (!printable || current?.kind !== 'words') event.preventDefault();
    };

    const attributeSetter = (name: string): ((elements: Element[]) => void) => {
      let marked = new Set<Element>();
      return (elements) => {
        const next = new Set(elements);
        for (const element of marked) if (!next.has(element)) element.removeAttribute(name);
        for (const element of next) if (!marked.has(element)) element.setAttribute(name, '');
        marked = next;
      };
    };
    const marks = { words: attributeSetter(WORDS_ATTRIBUTE), kept: attributeSetter(KEPT_ATTRIBUTE), sticky: attributeSetter(STICKY_ATTRIBUTE) };
    let editableWords: PagePiece[] = [];
    let stickyHolders: Element[] = [];
    const stickyParents = (element: Element | null): Element[] =>
      element === null || element === root ? [] : [...(getComputedStyle(element).position === 'sticky' ? [element] : []), ...stickyParents(element.parentElement)];
    const innerScroller = scroller === root ? null : scroller;
    let stackings = new Map<Element, number | undefined>();
    const stackingOf = (element: Element): number | undefined => {
      let index: number | undefined;
      for (let node: Element | null = element; node !== null && node !== root; node = node.parentElement) {
        const style = getComputedStyle(node) as unknown as Record<string, string | undefined>;
        if (
          (!['', 'static'].includes(style.position ?? '') || (node.parentElement !== null && /flex|grid/.test(getComputedStyle(node.parentElement).display))) &&
          !['', 'auto'].includes(style.zIndex ?? '')
        )
          index = Math.max(0, Number(style.zIndex));
        else if (
          /sticky|fixed/.test(style.position ?? '') ||
          !['', '1'].includes(style.opacity ?? '') ||
          style.isolation === 'isolate' ||
          STACKING_CONTEXT_PROPERTIES.some((property) => !['', 'none'].includes(style[property] ?? ''))
        )
          index = 0;
      }
      return index;
    };
    const measureWashes = (): void => {
      const origin = washesRef.current?.getBoundingClientRect() ?? new DOMRect();
      setWashes(
        editableWords.flatMap((words) => {
          const container = getScrollContainer(words.el);
          return listLineRects(words).flatMap((rect, line) => {
            const box = container === innerScroller ? rect : clipRectToBounds(rectOf(rect), getViewportBounds(container));
            return box === null ? [] : [{ el: words.el, line, at: { ...toLayerBox(box, origin), zIndex: stackings.get(words.el) } }];
          });
        }),
      );
    };
    const visitHidden = (): boolean => {
      const visited = draft.visit()?.el;
      return visited !== undefined && !isShown(visited, EXPORT_VISIBILITY_OPTIONS);
    };
    let hiddenFrame = 0;
    const collectWashes = (): void => {
      if (pickedRef.current !== null && draft.visit() === null && !isPieceShownOnPage(pickedRef.current.el)) setPicked(null);
      if (visitHidden())
        hiddenFrame ||= requestAnimationFrame(() => {
          hiddenFrame = 0;
          if (visitHidden()) flushSync(() => pick(null));
        });
      editableWords = collectEditableWords(root);
      stickyHolders = [...editableWords.map((words) => words.el), draft.visit()?.el ?? null].flatMap(stickyParents);
      stackings = new Map(editableWords.map((words) => [words.el, stackingOf(words.el)]));
      marks.words(editableWords.map((words) => words.el));
      marks.kept(editableWords.flatMap((words) => collectTextLeaves(words.el)));
      marks.sticky(stickyHolders.filter((holder) => getComputedStyle(holder).top !== 'auto' || getComputedStyle(holder).bottom !== 'auto'));
      measureWashes();
    };
    let washFrame = 0;
    let recollect = false;
    const scheduleWashes = (again: boolean): void => {
      recollect ||= again;
      washFrame ||= requestAnimationFrame(() => {
        washFrame = 0;
        if (draft.holding()) return;
        flushSync(recollect ? collectWashes : measureWashes);
        recollect = false;
      });
    };
    const inDrawing = (node: Node): boolean => node.parentElement?.closest('svg, canvas') != null;
    const mutations = new MutationObserver((records) => {
      if (!records.every((record) => inDrawing(record.target))) scheduleWashes(true);
    });
    const onAnimated = (event: Event): void => {
      if (inRoot(event) && event.target instanceof Node && !inDrawing(event.target)) scheduleWashes(true);
    };
    mutations.observe(root, EDIT_OBSERVER_OPTIONS);
    collectWashes();
    const onResize = (): void => {
      scheduleWashes(true);
      scheduleRedraw();
    };
    const resizes = new ResizeObserver(onResize);
    resizes.observe(root);
    const groupAttributes = { tabindex: '0', role: 'group', 'aria-label': EDIT_GROUP_LABEL };
    for (const [name, value] of Object.entries(groupAttributes)) root.setAttribute(name, value);
    const unlisten = [
      addTrustedWindowListener('pointermove', onPointerMove),
      addTrustedWindowListener('pointerout', (event) => {
        if (event.relatedTarget === null) leave();
      }),
      addTrustedWindowListener('scroll', (event) => {
        if (stickyHolders.length > 0 || inRoot(event)) scheduleWashes(false);
        onScroll();
      }),
      addTrustedWindowListener('transitionend', onAnimated),
      addTrustedWindowListener('animationend', onAnimated),
      addTrustedWindowListener('resize', onResize),
      addTrustedWindowListener('pointerdown', onPointerDown),
      addTrustedWindowListener('pointerup', onPointerUp),
      addTrustedWindowListener('mousedown', onMouseButton),
      addTrustedWindowListener('mouseup', onMouseButton),
      addTrustedWindowListener('click', onClick),
      addTrustedWindowListener('dblclick', (event) => {
        if (inRoot(event) && !isPassThroughClick(event, root)) event.stopPropagation();
      }),
      addTrustedWindowListener('dragstart', (event) => {
        if (inRoot(event)) event.preventDefault();
      }),
      addTrustedWindowListener('selectionchange', keepSelectionInWords),
      addTrustedWindowListener('selectionchange', onCaretMoved),
      addTrustedWindowListener('keydown', onKeyDown),
      addTrustedWindowListener('focusin', onFocusIn),
      draft.subscribe(() => scheduleWashes(true)),
    ];
    return () => {
      for (const stop of unlisten) stop();
      resizes.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(washFrame);
      cancelAnimationFrame(hiddenFrame);
      marks.words([]);
      marks.kept([]);
      marks.sticky([]);
      for (const name of Object.keys(groupAttributes)) root.removeAttribute(name);
      root.removeAttribute(EDIT_MODE_ATTRIBUTE);
      cancelAnimationFrame(frame);
      clearTimeout(tipTimer);
      mover.stop();
      leave();
      clearTimeout(linkHold);
      clearTimeout(caretTimer);
      draft.settle(true);
      setTip(null);
      setLinkCard(null);
    };
  }, [root, draft, off, host, mover, pick, sourceTip]);

  const shown = picked !== null && picked.el.isConnected ? picked : null;
  const room = getViewportBounds(getScrollContainer(root));
  const toolbarRoom = getViewportRoom(getScrollContainer(root));
  const visit = visitRef.current !== null && draft.visit()?.el === visitRef.current.el ? visitRef.current : null;
  const look: EditMarkLook = visit === null ? 'picked' : 'caret';
  if (hoveredPiece !== null) lastHoveredRef.current = hoveredPiece;
  const over = lastHoveredRef.current?.el.isConnected === true && lastHoveredRef.current.el !== shown?.el ? lastHoveredRef.current : null;
  useLinedMarks(root, off || holding ? [] : [hoveredPiece, shown]);
  const card = shown === null ? null : findBlockBox(shown.el, root);
  const grips = holding ? [] : [...new Set([card, hoveredCard])].flatMap((box) => (box?.isConnected === true ? [box] : []));
  const tipBox = !holding && tip?.at.isConnected === true && isShown(tip.at, tip.refusal ? EXPORT_VISIBILITY_OPTIONS : undefined) ? rectOf(tip.at.getBoundingClientRect()) : null;
  const strip = document.querySelector('[data-mc-strip]')?.getBoundingClientRect();
  const tipPlace = tipBox === null ? null : placeEditTip(tipBox, toolbarRoom, strip === undefined ? null : rectOf(strip), tip?.pointer ?? null);
  const tipSide =
    tipBox === null || tipPlace === null
      ? null
      : (tipPlace.side ?? (tip?.refusal === true ? (tipBox.top < room.top + 48 ? 'bottom' : 'top') : null));
  const rows: PieceToolbarRow[] =
    shown?.kind !== 'block'
      ? []
      : [
          { label: MOVE_CARD_EARLIER, disabled: !mover.canStep(shown.el, -1), onPick: () => mover.step(shown.el, -1) },
          { label: MOVE_CARD_LATER, disabled: !mover.canStep(shown.el, 1), onPick: () => mover.step(shown.el, 1) },
          { label: DELETE_CARD, danger: true, onPick: () => mover.remove(shown.el) },
        ];
  const markRect = shown === null ? null : getEditMarkRect(shown, look);
  const copyMark = dropMarks.find((mark) => mark.kind === 'copy');

  const layer = createPortal(
    <div hidden={off}>
      <div className="dash-edit-layer" data-uncommentable="" data-mc-chrome="" style={room}>
        <div className="dash-edit-drops" style={{ clipPath: cutOutClipPath(copyMark?.box, room) }}>
          {dropMarks.map((mark, index) => (
            <div key={index} className="dash-edit-drop" data-kind={mark.kind} data-land={mark.land ? '' : undefined} style={toLayerBox(mark.box, room)} />
          ))}
        </div>
        {over !== null && <EditMark piece={over} look="over" on={hoveredPiece !== null && !holding} room={room} />}
        {hoveredCell?.isConnected === true && !holding && <EditMark piece={{ el: hoveredCell, kind: 'drawing' }} look="over" on room={room} />}
        {shown !== null && !holding && <EditMark piece={shown} look={look} on room={room} />}
        {grips.map((grip) => (
          <CardGrip key={grip === card ? 'home' : 'under'} card={grip} full={grip === shown?.el} room={room} onPress={(event) => mover.press(event, grip, true)} />
        ))}
        {tipBox !== null && tipSide !== null && (
          <EditTipView box={tipPlace?.anchor ?? tipBox} room={room} side={tipSide} follow={tipPlace?.follow === true}>
            {tip?.words}
          </EditTipView>
        )}
      </div>
      {shown !== null && markRect !== null && !holding && (
        <div ref={toolbarRef} hidden={!isRowInRoom(markRect, toolbarRoom)}>
          <PieceToolbar
            piece={shown}
            box={inflateBox(markRect, EDIT_MARK_INFLATE[look])}
            room={toolbarRoom}
            pressed={pressedRef.current}
            visit={visit}
            onAsk={onAsk === null ? null : () => onAsk(() => describeElementSelection(shown.el, root))}
            rows={rows}
          />
        </div>
      )}
      {linkCard !== null && !holding && linkCard.link.isConnected && (
        <div data-mc-chrome="" data-uncommentable="" data-edit-link-card="">
          <EditLinkCardView
            key={linkCard.n}
            card={linkCard}
            avoid={() => {
              const bar = toolbarRef.current?.querySelector('.dash-edit-toolbar')?.getBoundingClientRect();
              return bar === undefined ? null : screenBox(inflateBox(rectOf(bar), LINK_CARD_AVOID_PAD));
            }}
            onEdit={(href) => {
              const { link, words } = linkCard;
              const range = document.createRange();
              range.selectNodeContents(link);
              pick(words, range);
              const visit = visitRef.current;
              if (visit === null) return false;
              visit.link(href);
              const took = href === null ? !link.isConnected || !words.el.contains(link) : link.getAttribute('href') === normalizeLinkHref(href);
              if (took) setLinkCard(null);
              return took;
            }}
            onClose={() => {
              setLinkCard(null);
              // The focus goes back where it was: the words being typed for a card the caret opened, else the page.
              const typing = draft.visit()?.el;
              if (linkCard.by === 'caret' && typing === linkCard.words.el && typing instanceof HTMLElement) typing.focus({ preventScroll: true });
              else root.focus({ preventScroll: true });
            }}
          />
        </div>
      )}
    </div>,
    document.body,
  );

  return (
    <>
      <div ref={washesRef} className="dash-edit-washes" data-uncommentable="" data-mc-chrome="" hidden={off || holding}>
        {washes.map(({ el, line, at }) => (
          <div key={`${washKeyOf(el)}.${line}`} data-typing={el === visit?.el ? '' : undefined} style={at} />
        ))}
      </div>
      {layer}
    </>
  );
}


interface EditLinkCardViewProps {
  card: EditLinkCard;
  avoid: () => ScreenBox | null;
  /** Writes an address into the link (null takes the link away); false when it could not. */
  onEdit(href: string | null): boolean;
  onClose(): void;
}

/** A link's card in edit mode: Copy link, and Edit link and Remove link when its words can change. */
function EditLinkCardView({ card, avoid, onEdit, onClose }: EditLinkCardViewProps): ReactNode {
  const { link, editable } = card;
  const target = link.getAttribute('href') ?? '';
  if (!editable)
    return <LinkDetailsCard href={link.href} anchor={screenBox(link.getBoundingClientRect())} avoid={avoid()} onCopy={copyLink} onClose={onClose} />;
  return (
    <LinkCard
      link={link}
      target={target}
      href={link.href}
      normalize={normalizeLinkHref}
      onCopy={(address) => void copyLink(address)}
      onEdit={(next) => onEdit(next)}
      onRemove={() => void onEdit(null)}
      onReturn={onClose}
      above
      avoid={avoid}
      editOnOpen={card.edit}
    />
  );
}
