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
import { announce, isApplePlatform } from '@open-artifact/editor-kit';
import { describeElementSelection, type ElementSelection } from '../page/selection.ts';
import { createCardMover } from './cards.ts';
import type { PageDraft } from './draft.ts';
import { CARD_DRAG_THRESHOLD, createHoverIntent, isContextMenuKey, type CardDropMark } from './drops.ts';
import { inflateBox, rectOf } from './geometry.ts';
import { describeClickThrough, describePieceKeys, pieceKeyAction } from './keys.ts';
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
  pickTipSide,
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
import { PieceToolbar, type PieceToolbarRow } from './PieceToolbar.tsx';
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
import { FORM_CONTROL_SELECTOR } from './runs.ts';
import { useLinedMarks, type SourceNameOf } from './SourceMarksLayer.tsx';
import { CHROME_SELECTOR, describeUneditable, uneditableRefusal, visitWords, type WordsHost, type WordsPoint, type WordsStart, type WordsVisit } from './words.ts';

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
      if (words !== null && element !== null) tipTimer = setTimeout(() => host.tip(element, words), EDIT_TIP_DELAY);
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
      if (control !== null) tipFor(control, describeClickThrough(control.getAttribute('href'), isApplePlatform()));
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
      if (pressed === null || draft.holding() || mover.dragging()) return;
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
    };

    const onMouseButton = (event: MouseEvent): void => {
      if (swallowing) event.stopPropagation();
      if (event.type === 'mousedown' && (doubleClick || (passThrough && draft.visit() !== null))) event.preventDefault();
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

    const onKeyDown = (event: KeyboardEvent): void => {
      setTip(null);
      tabbing = event.key === 'Tab';
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
      draft.settle(true);
      setTip(null);
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
  const tipSide =
    tipBox === null
      ? null
      : (pickTipSide(tipBox, toolbarRoom, strip === undefined ? null : rectOf(strip)) ?? (tip?.refusal === true ? (tipBox.top < room.top + 48 ? 'bottom' : 'top') : null));
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
          <EditTipView box={tipBox} room={room} side={tipSide}>
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

