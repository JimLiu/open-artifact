/**
 * The pieces edit mode works on: words (a run of text), drawings (what the
 * page draws: charts, data values, controls) and blocks (a card). Finding
 * the piece under the pointer, outlining it, and naming it.
 */

import { isApplePlatform } from '@open-artifact/editor-kit';
import { DRAW_ATTRIBUTE } from '../page/draw.ts';
import { describeElementSelection } from '../page/selection.ts';
import { FORM_CONTROL_SELECTOR, INLINE_TAG_SELECTOR, SOURCE_FIELD_SELECTOR, isPageWritten, isWordsAtom } from './runs.ts';
import { isPointInBox, type Box } from './geometry.ts';

export type PieceKind = 'words' | 'drawing' | 'block';

export interface PagePiece {
  el: Element;
  kind: PieceKind;
}

/** A selection clipped to the one run of words it lies in. */
export interface PageWordsRange {
  piece: PagePiece;
  part: Range;
}

export const READ_STAGE_ATTRIBUTE = 'data-read-stage';
export const READ_STEP_ATTRIBUTE = 'data-read-step';
export const READ_PAUSE_ATTRIBUTE = 'data-read-pause';
export const READ_MOVE_ATTRIBUTE = 'data-read-move';
const VISIBILITY_OPTIONS = { visibilityProperty: true, opacityProperty: true, checkVisibilityCSS: true, checkOpacity: true };

const READ_STAGE_CONTROL_SELECTOR = `[${READ_STAGE_ATTRIBUTE}] button, [${READ_MOVE_ATTRIBUTE}], [${READ_PAUSE_ATTRIBUTE}]`;
const TAB_ROLE_SELECTOR = '[role="tab"], [role="tablist"] button, [role="tablist"] a';
export const TAB_LIKE_SELECTOR = `${TAB_ROLE_SELECTOR}, summary, button[aria-pressed], ${READ_STAGE_CONTROL_SELECTOR}`;
const ACTIVE_TAB_SELECTOR = '[aria-selected="true"], [aria-current]:not([aria-current="false"]), details[open] > summary, [aria-pressed="true"]';
const STICKY_MIN_HEIGHT = 100;
const PIECE_SKIP_SELECTOR = 'canvas, template, style, script';
const WORDS_STOP_SELECTOR = 'button, label, summary, td, th';
const TABLE_PART_SELECTOR = 'thead, tbody, tfoot, tr, td, th';
const PIECE_CONTROL_SELECTOR = `${FORM_CONTROL_SELECTOR}, button`;
const PIECE_HIT_SLACK = 4;
const WHOLE_WORDS_SELECTOR = `td, th, button:not(${TAB_LIKE_SELECTOR})`;
const PIECE_MEDIA_SELECTOR = 'svg, canvas, img, table, tr, select, input, button, textarea';
export const MAX_PIECE_LABEL_LENGTH = 48;
/** Rules the source marks layer draws under data lines (a drawing holding one is picked whole). */
export const LINED_RULE_ATTRIBUTE = 'data-dash-rule';

const PIECE_ROLE_LABELS: readonly (readonly [string, string])[] = [
  ['summary', 'Heading'],
  ['button[aria-pressed]', 'Button'],
  [TAB_ROLE_SELECTOR, 'Tab'],
  ['thead th, thead th *', 'Column heading'],
  ['button', 'Button'],
  ['label', 'Label'],
];
const PIECE_KIND_LABELS: Readonly<Record<string, string>> = {
  Heading: 'Heading',
  'Table cell': 'Table cell',
  Caption: 'Caption',
  'List item': 'List item',
  Table: 'Table',
  Paragraph: 'Paragraph',
  Text: 'Text',
  Chart: 'Chart',
};

export const isActiveTab = (element: Element): boolean => element.matches(ACTIVE_TAB_SELECTOR) && !element.matches(READ_STAGE_CONTROL_SELECTOR);
const isVisible = (element: Element, options?: CheckVisibilityOptions): boolean => typeof element.checkVisibility !== 'function' || element.checkVisibility(options);
const hasTabList = (element: Element): boolean => element.matches('[role="tablist"]') || element.querySelector('[role="tablist"]') !== null;
export const hasPieceControl = (element: Element): boolean => element.matches(PIECE_CONTROL_SELECTOR) || element.querySelector(PIECE_CONTROL_SELECTOR) !== null;
const hasText = (node: Node): boolean => (node.textContent ?? '').trim() !== '';
const hasDirectText = (element: Element): boolean => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && hasText(node));
const hasOnlyInlineChildren = (element: Element): boolean =>
  [...element.children].every((child) => isWordsAtom(child) || (child.matches(INLINE_TAG_SELECTOR) && hasOnlyInlineChildren(child)));
const isFieldValueLeaf = (element: Element): boolean => element.childElementCount === 0 && element.matches(SOURCE_FIELD_SELECTOR);
const isEmptyCell = (element: Element): boolean => element.matches('td, th') && element.childElementCount === 0 && !hasText(element);
/** A cell or line holding nothing but one text link: its words are the link's, edited in place. */
function isLoneLinkHolder(element: Element): boolean {
  const link = element.firstElementChild;
  return (
    element.childElementCount === 1 &&
    link !== null &&
    link.matches('a[href]') &&
    !link.matches(TAB_LIKE_SELECTOR) &&
    !isWordsAtom(link) &&
    hasText(link) &&
    !isBlockBox(element)
  );
}
const isWordsElement = (element: Element): boolean =>
  (hasDirectText(element) || isEmptyCell(element) || isLoneLinkHolder(element)) && !isFieldValueLeaf(element) && hasOnlyInlineChildren(element);

/** The scrolling (clipping) box `element` sits in, or null for the window. */
export function getScrollContainer(element: Element): Element | null {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if ((style.overflowX !== '' && style.overflowX !== 'visible') || (style.overflowY !== '' && style.overflowY !== 'visible')) return parent;
  }
  return null;
}

/** The visible box of a scroller (or the window). */
export function getViewportBounds(scroller: Element | null): Box {
  if (scroller === null) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const bounds = scroller.getBoundingClientRect();
  return { left: bounds.left + scroller.clientLeft, top: bounds.top + scroller.clientTop, width: scroller.clientWidth, height: scroller.clientHeight };
}

/** The scroller's box minus its bottom padding: room the page's own toolbars and pills can use. */
export function getViewportRoom(scroller: Element | null): Box {
  const bounds = getViewportBounds(scroller);
  return scroller === null ? bounds : { ...bounds, height: bounds.height - (parseFloat(getComputedStyle(scroller).paddingBlockEnd) || 0) };
}

function findWordsPiece(element: Element, root: Element): Element | null {
  if (element.closest(PIECE_SKIP_SELECTOR) !== null) return null;
  let found: Element | null = null;
  const start = element.matches('thead th') ? (element.querySelector(':scope > button:only-child') ?? element) : element;
  for (let current: Element | null = start; current !== null && current !== root; current = current.parentElement) {
    if (isWordsElement(current)) found = current;
    else if (!current.matches(INLINE_TAG_SELECTOR)) break;
    if (current.matches(WORDS_STOP_SELECTOR)) break;
  }
  return found;
}

/** The outermost drawing (data-draw element, chart, control) holding `element`, or null. */
export function findDrawingRoot(element: Element, root: Element): Element | null {
  let found: Element | null = null;
  const draw = `[${DRAW_ATTRIBUTE}]`;
  for (
    let current = (element.matches('table') ? element.querySelector(`:scope > ${draw}`) : null) ?? element.closest(draw);
    current !== null && current !== root && root.contains(current);
    current = current.parentElement?.closest(draw) ?? null
  )
    found = current;
  if (found !== null) return found;
  for (let current = element.closest('svg, select') ?? element; current !== root && current.parentElement !== null; current = current.parentElement) {
    if (isWordsAtom(current) && !isEmptyCell(current)) found = current;
    else if (!current.matches(INLINE_TAG_SELECTOR)) break;
  }
  return found;
}

/** A box drawn as a card: a border, or a fill or shadow with padding. */
function isBlockBox(element: Element): boolean {
  if (element.matches(`${TABLE_PART_SELECTOR}, ${PIECE_CONTROL_SELECTOR}`) || element.closest('svg') !== null || hasTabList(element)) return false;
  if (element.childElementCount === 0 && (!hasText(element) || element.matches(`${INLINE_TAG_SELECTOR}, ${WORDS_STOP_SELECTOR}`))) return false;
  const style = getComputedStyle(element);
  const bordered = style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) > 0 && parseFloat(style.borderLeftWidth) > 0;
  const filled = !['', 'transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor);
  const shadowed = !['', 'none'].includes(style.boxShadow);
  return bordered || ((filled || shadowed) && parseFloat(style.paddingTop) > 0);
}

export function findBlockBox(element: Element, root: Element): Element | null {
  for (let current: Element | null = element; current !== null && current !== root; current = current.parentElement)
    if (isBlockBox(current)) return isStagedPiece(current, root) ? null : current;
  return null;
}

/** The piece edit mode works on at `target`: a drawing, a run of words, or the card around it. */
export function findPieceAt(target: EventTarget | null, root: Element, pointer?: Pick<MouseEvent, 'clientX' | 'clientY'>): PagePiece | null {
  if (!(target instanceof Element) || target === root || !root.contains(target)) return null;
  const drawing = findDrawingRoot(target, root);
  if (drawing !== null && hasTabList(drawing)) return null;
  if (drawing !== null && hasPieceControl(drawing)) return { el: drawing, kind: 'drawing' };
  if (drawing !== null && (drawing.matches(`[${LINED_RULE_ATTRIBUTE}]`) || drawing.querySelector(`[${LINED_RULE_ATTRIBUTE}]`) !== null)) return { el: drawing, kind: 'drawing' };
  const start = drawing === null ? target : drawing.parentElement;
  const words = start === null ? null : findWordsPiece(start, root);
  const wordsPiece: PagePiece | null = words === null ? null : { el: words, kind: 'words' };
  if (
    wordsPiece !== null &&
    (pointer === undefined || wordsPiece.el.matches(WHOLE_WORDS_SELECTOR) || isPointInBox(getPieceRect(wordsPiece), pointer.clientX, pointer.clientY, PIECE_HIT_SLACK))
  )
    return wordsPiece;
  if (wordsPiece === null && drawing !== null && isPageWritten(drawing))
    return { el: (drawing.matches(TABLE_PART_SELECTOR) ? drawing.closest('table') : null) ?? drawing, kind: 'drawing' };
  const block = findBlockBox(wordsPiece?.el ?? target, root);
  return block === null ? null : { el: block, kind: 'block' };
}

const elementOf = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement);

/** The selection clipped to the one run of words it lies in, when it lies in one. */
export function findWordsRange(range: Range, root: Element): PageWordsRange | null {
  const text = range.toString().trim();
  for (const node of [range.startContainer, range.endContainer]) {
    const piece = findPieceAt(elementOf(node), root);
    if (piece?.kind !== 'words' || getComputedStyle(piece.el).pointerEvents === 'none') continue;
    const part = range.cloneRange();
    if (!piece.el.contains(part.startContainer)) part.setStart(piece.el, 0);
    if (!piece.el.contains(part.endContainer)) part.setEnd(piece.el, piece.el.childNodes.length);
    const common = elementOf(part.commonAncestorContainer);
    if (text !== '' && part.toString().trim() === text && common !== null && findDrawingRoot(common, root) === null) return { piece, part };
  }
  return null;
}

/** Every piece under `element`, outermost first, once each. */
export function collectPieces(element: Element, root: Element): PagePiece[] {
  const pieces = [...element.children]
    .filter((child) => isVisible(child))
    .flatMap((child): PagePiece[] => {
      const piece = findPieceAt(child, root);
      const own: PagePiece[] = piece !== null && (piece.el === child || piece.kind === 'drawing') && isPieceShownOnPage(piece.el) ? [piece] : [];
      return (own[0]?.kind === 'drawing' && !child.matches('table')) || child.matches('svg, canvas, select') ? own : [...own, ...collectPieces(child, root)];
    });
  return pieces.filter((piece, index) => pieces.findIndex((other) => other.el === piece.el) === index);
}

/** The words edit mode can type in (not inside a closed tab). */
export const collectEditableWords = (root: Element): PagePiece[] =>
  collectPieces(root, root).filter((piece) => piece.kind === 'words' && getInactiveTab(piece.el, root) === null);

/** The atoms with text inside words (marked as kept while editing). */
export const collectTextLeaves = (element: Element): Element[] =>
  [...element.children].flatMap((child): Element[] =>
    !isWordsAtom(child) ? collectTextLeaves(child) : hasText(child) && !child.matches(`${FORM_CONTROL_SELECTOR}, svg`) ? [child] : [],
  );

/** Words and short drawings are outlined around their text, not their whole box. */
export function isTextPiece({ el, kind }: PagePiece): boolean {
  return (
    kind === 'words' ||
    (kind === 'drawing' && !el.matches('tbody, select') && el.querySelector(PIECE_MEDIA_SELECTOR) === null && (el.textContent ?? '').trim().length <= MAX_PIECE_LABEL_LENGTH)
  );
}

export function getPieceRect(piece: PagePiece): DOMRect {
  const { el } = piece;
  if (!isTextPiece(piece)) return el.getBoundingClientRect();
  const nodes = [...el.childNodes].filter((node) => (node instanceof Element ? !node.matches(FORM_CONTROL_SELECTOR) : hasText(node)));
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const first = nodes[0];
  const last = nodes.at(-1);
  if (first !== undefined && last !== undefined) {
    range.setStartBefore(first);
    range.setEndAfter(last);
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 ? rect : el.getBoundingClientRect();
}

/** A sticky element holding a tall drawing: the piece of a scroll story that stays in view. */
export function isStickyStage(element: Element): boolean {
  return (
    getComputedStyle(element).position === 'sticky' &&
    [element, ...element.querySelectorAll(`[${DRAW_ATTRIBUTE}]`)].some(
      (drawing) => drawing.hasAttribute(DRAW_ATTRIBUTE) && drawing.getBoundingClientRect().height > STICKY_MIN_HEIGHT,
    )
  );
}

function isStickyStageChain(element: Element): boolean {
  return isStickyStage(element) || (element.firstElementChild !== null && element.childElementCount === 1 && isStickyStageChain(element.firstElementChild));
}

/** Whether `element`, between it and `root`, is (or sits beside) a read stage or a sticky stage: the page swaps it. */
export function isStagedPiece(element: Element, root: Element): boolean {
  const stage = `[${READ_STAGE_ATTRIBUTE}]`;
  for (let current: Element | null = element; current !== null && current !== root; current = current.parentElement)
    if (current.matches(stage) || [...(current.parentElement?.children ?? [])].some(isStickyStageChain)) return true;
  const insideSticky = (candidate: Element): boolean =>
    candidate !== element && (isStickyStage(candidate) || (candidate.parentElement !== null && insideSticky(candidate.parentElement)));
  return element.querySelector(stage) !== null || [...element.querySelectorAll(`[${DRAW_ATTRIBUTE}]`)].some(insideSticky);
}

/** Whether `element` (a control, or anything with a box over 1px) shows on the page. */
export function isPieceShownOnPage(element: Element): boolean {
  if (typeof element.checkVisibility !== 'function' || element.matches(`${TAB_LIKE_SELECTOR}, ${PIECE_CONTROL_SELECTOR}`)) return true;
  const rect = element.getBoundingClientRect();
  return element.checkVisibility(VISIBILITY_OPTIONS) && rect.width > 1 && rect.height > 1;
}

/** Whether `element` is one of two same-tag siblings the page swaps in and out (a drawing on a stage). */
export function isSwappedPiece(element: Element, root: Element): boolean {
  if (
    element.matches(`td, th, figcaption *, [${READ_STEP_ATTRIBUTE}] *`) ||
    ![...(element.parentElement?.children ?? [])].some((sibling) => sibling !== element && sibling.tagName === element.tagName && !isVisible(sibling, VISIBILITY_OPTIONS))
  )
    return false;
  for (let current: Element | null = element; current !== null && current !== root; current = current.parentElement)
    if (current.matches(`[${READ_STAGE_ATTRIBUTE}]`) || isStickyStage(current)) return true;
  return false;
}

/** The tab (or tab-like control) holding `element` when it is not the open one. */
export function getInactiveTab(element: Element, root: Element): Element | null {
  const tab = element.closest(TAB_LIKE_SELECTOR);
  return tab !== null && root.contains(tab) && !isActiveTab(tab) ? tab : null;
}

/** Cmd (Ctrl elsewhere) is held: the click goes to the page as if edit mode were off. */
export const isFollowClick = (event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>, apple: boolean = isApplePlatform()): boolean => event.metaKey || (event.ctrlKey && !apple);

/** A click edit mode lets through to the page: with Cmd (Ctrl), on a form control, or on a tab that isn't open. */
export function isPassThroughClick(event: MouseEvent, root: Element): boolean {
  if (isFollowClick(event)) return true;
  const target = event.target instanceof Element && root.contains(event.target) ? event.target : null;
  if (target?.closest(FORM_CONTROL_SELECTOR) != null) return true;
  const tab = target?.closest(TAB_LIKE_SELECTOR) ?? null;
  if (tab === null) return false;
  const piece = isActiveTab(tab) ? findPieceAt(event.target, root, event) : null;
  return piece === null || !tab.contains(piece.el);
}

/** The text of a piece without its atoms. */
export function readPieceText(element: Element): string {
  return [...element.childNodes]
    .map((node) => (node instanceof Element ? (isWordsAtom(node) ? '' : readPieceText(node)) : (node.textContent ?? '')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Heading “Revenue”`, or the label alone when there are no words. */
export const quotePiece = (label: string, words: string): string => (words === '' ? label : `${label} “${words}”`);

/** What a piece is called in edit mode's labels: its kind and a short quote of its text. */
export function describePiece(piece: PagePiece, root: Element): string {
  const { el } = piece;
  const { kind, text, title, under } = describeElementSelection(el, root);
  if (el.matches('label') ? piece.kind === 'block' : piece.kind === 'drawing' && !el.matches('table') && hasPieceControl(el)) {
    const label = el.closest('label');
    return quotePiece('Control', (label === null ? '' : readPieceText(label)) || (el.getAttribute('aria-label') ?? ''));
  }
  if (piece.kind === 'words' || (piece.kind === 'drawing' && !el.matches(PIECE_MEDIA_SELECTOR) && el.querySelector(PIECE_MEDIA_SELECTOR) === null))
    return quotePiece(
      PIECE_ROLE_LABELS.find(([selector]) => el.matches(selector))?.[1] ?? (kind === 'Card' || kind === 'Chart' ? 'Text' : (PIECE_KIND_LABELS[kind] ?? kind)),
      text,
    );
  const firstWords = collectPieces(el, root).find((inner) => inner.kind === 'words');
  const wordsText = firstWords === undefined ? '' : describeElementSelection(firstWords.el, root).text;
  return quotePiece(
    piece.kind === 'block' ? 'Card' : kind === 'Card' ? 'Figure' : (PIECE_KIND_LABELS[kind] ?? kind),
    title || (wordsText.length <= MAX_PIECE_LABEL_LENGTH ? wordsText : '') || under,
  );
}

/** The piece a drawing mark stands for (the lined source marks layer picks drawings). */
export const asDrawingPiece = (element: Element): PagePiece => ({ el: element, kind: isPageWritten(element) ? 'drawing' : 'block' });
