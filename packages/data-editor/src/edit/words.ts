/**
 * A words session: typing in one text block of the page through
 * `contenteditable`, with its own undo steps, bold / italic / link, atoms
 * (data values, written values, form controls) kept whole and refused with a
 * reason, and the spaces around atoms restored. When it ends, the block's new
 * runs go to the draft as one typing / styling step (or deleting, for a block
 * emptied out).
 */

import type { ReactNode } from 'react';
import { SOURCE_ATTRIBUTE } from '@open-artifact/data-core';
import { isApplePlatform } from '@open-artifact/editor-kit';
import { isComposingKey } from '../../../ui/src/keys.ts';
import type { DraftEnded, DraftVisit, PageDraft } from './draft.ts';
import {
  CHAPTER_NEEDS_WORDS,
  CLICK_IN_TEXT_FIRST,
  LINK_CANT_HOLD_WRITTEN,
  REFUSE_CUT,
  SELECT_TEXT_FIRST,
  describeUneditableKind,
  emptiedRefusal,
  uneditableRefusalFor,
} from './labels.ts';
import { READ_STEP_ATTRIBUTE } from './pieces.ts';
import {
  FORM_CONTROL_SELECTOR,
  collectWordsRuns,
  findCaretNeighbour,
  hasHiddenInline,
  isPageWritten,
  isWordsAtom,
  needsAtomSpace,
  normalizeLinkHref,
  readAtomNeighbours,
  readShownText,
  restoreAtomSpacing,
  type CaretNeighbour,
  type InlineRun,
  type WordsAtoms,
} from './runs.ts';

export type WordsFormat = 'bold' | 'italic';
/** One toolbar cell: pressed or not, and why it is disabled (null when enabled). */
export interface WordsCell {
  on: boolean;
  why: string | null;
}
export interface WordsLinkCell extends WordsCell {
  href: string | null;
}
/** The format cells for the selection; null for a cell the words do not offer. */
export interface WordsCells {
  bold: WordsCell | null;
  italic: WordsCell | null;
  link: WordsLinkCell | null;
}

/** Where the caret goes when a session opens: a range, a click point, or the end (null). */
export interface WordsPoint {
  x: number;
  y: number;
  clicks: number;
}
export type WordsStart = Range | WordsPoint | null;
export type WordsEndReason = 'away' | 'key';

/** What edit mode gives a words session. */
export interface WordsHost {
  draft: PageDraft;
  changed(): void;
  refuse(at: Element, words: string): void;
  /** Part of what the page swaps in and out (a deleted-and-restored step can't be found again). */
  swapped(at: Element): boolean;
  /** Show a tip over an element. */
  tip(at: Element | null, words?: ReactNode): void;
  ended(reason: WordsEndReason): void;
}

/** A words session: a draft visit with the formatter and the link-input parking. */
export interface WordsVisit extends DraftVisit {
  cells(): WordsCells;
  format(kind: WordsFormat): void;
  link(href: string | null): void;
  /** Keep the selection while the link input has focus; the returned function restores it. */
  park(): () => void;
}

interface WordsUnseenPlace {
  u: Element;
  parent: ParentNode | null;
  before: ChildNode | null;
  after: ChildNode | null;
}
type WordsSnapshotKid = string | { node: Node; kids?: WordsSnapshotKid[]; href?: string | null };
interface WordsSnapshot {
  kids: WordsSnapshotKid[];
  caret: number | null;
}
type WordsShapeItem = string | number | null | WordsShapeItem[];
interface WordsPendingSpace {
  node: Node;
  offset: number;
  space: 'before' | 'after';
}

const FORMAT_WRAPPER_SELECTORS: Record<WordsFormat, string> = { bold: 'b, strong', italic: 'i, em' };
export const COMPOSITION_INPUT_TYPES: ReadonlySet<string> = new Set(['insertCompositionText', 'insertFromComposition', 'deleteCompositionText']);
export const INSERT_INPUT_TYPES: ReadonlySet<string> = new Set(['insertText', 'insertReplacementText', ...COMPOSITION_INPUT_TYPES]);
export const DELETE_INPUT_TYPE_PATTERN = /^delete(Content|Word|SoftLine|HardLine|EntireSoftLine)(Backward|Forward)?$|^deleteByCut$/;
export const WORDS_UNDO_MERGE_MS = 700;
export const LINK_PARK_HIGHLIGHT = 'dash-edit-link';
/** Where the toolbar and the floating chrome live (focus there keeps a session open). */
export const CHROME_SELECTOR = '[data-mc-chrome]';

/** Whether an input type is one a words session handles itself (typing and deleting). */
export const isHandledInputType = (inputType: string): boolean => INSERT_INPUT_TYPES.has(inputType) || DELETE_INPUT_TYPE_PATTERN.test(inputType);

/** ⌘B / ⌘I / ⌘A in words (Ctrl elsewhere), or null. */
export function wordsShortcutOf(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, apple: boolean): 'b' | 'i' | 'a' | null {
  if (!(event.metaKey || (event.ctrlKey && !apple)) || event.shiftKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  return key === 'b' || key === 'i' || key === 'a' ? key : null;
}

const highlights = (): HighlightRegistry | undefined => (typeof Highlight === 'function' ? CSS.highlights : undefined);
const isTextNode = (node: Node | null | undefined): node is Text => node?.nodeType === Node.TEXT_NODE;
const isVisible = (element: Element): boolean => typeof element.checkVisibility !== 'function' || element.checkVisibility();

export const uneditableRefusal = (element: Element): string => uneditableRefusalFor(element.hasAttribute(SOURCE_ATTRIBUTE));

export function describeUneditable(element: Element): string | null {
  return describeUneditableKind({ written: isPageWritten(element), fromData: element.hasAttribute(SOURCE_ATTRIBUTE), control: element.matches(FORM_CONTROL_SELECTOR) });
}

function splitOutOfWrapper(atom: Element, wrapper: Element): void {
  const before = wrapper.ownerDocument.createRange();
  const after = wrapper.ownerDocument.createRange();
  before.selectNodeContents(wrapper);
  before.setEndBefore(atom);
  after.selectNodeContents(wrapper);
  after.setStartAfter(atom);
  const head = wrapper.cloneNode(false);
  const tail = wrapper.cloneNode(false);
  tail.appendChild(after.extractContents());
  head.appendChild(before.extractContents());
  wrapper.replaceWith(...[head, ...wrapper.childNodes, tail].filter((node) => (node !== head && node !== tail) || (node.textContent ?? '') !== ''));
}

interface WordsFormatterInput {
  el: Element;
  selected(): Range | null;
  select(range: Range): void;
  struck(range: Range): Element[];
  wordsIn(range: Range): boolean;
  exec(command: string, value?: string): void;
  mark(kind: string | null): void;
}

interface WordsFormatter {
  cells(): WordsCells;
  format(kind: WordsFormat): void;
  link(href: string | null): void;
  linkAt(range: Range): HTMLAnchorElement | null;
}

function createWordsFormatter({ el, selected, select, struck, wordsIn, exec, mark }: WordsFormatterInput): WordsFormatter {
  const doc = el.ownerDocument;
  const linkable = el.closest('a, button, summary, label, [role="tab"]') === null;
  const offers: Record<WordsFormat, boolean> = {
    bold: Number(getComputedStyle(el).fontWeight) < 500,
    italic: getComputedStyle(el).fontStyle !== 'italic',
  };
  const inside = <T extends Element>(node: T | null): T | null => (node !== null && node !== el && el.contains(node) ? node : null);
  const wrapperOf = (atom: Element, kind: WordsFormat): Element | null => inside(atom.parentElement?.closest(FORMAT_WRAPPER_SELECTORS[kind]) ?? null);
  const atomsOnly = (range: Range): boolean => struck(range).length > 0 && !wordsIn(range);
  const isOn = (kind: WordsFormat, range: Range): boolean =>
    struck(range).every((atom) => wrapperOf(atom, kind) !== null) && (atomsOnly(range) || doc.queryCommandState(kind));
  const linkAt = (range: Range): HTMLAnchorElement | null => {
    const linkOf = (node: Node): HTMLAnchorElement | null => inside((node instanceof Element ? node : node.parentElement)?.closest('a') ?? null);
    return linkOf(range.startContainer) === linkOf(range.endContainer) ? linkOf(range.startContainer) : null;
  };
  const cells = (): WordsCells => {
    const range = selected();
    if (range === null) {
      const off = { on: false, why: CLICK_IN_TEXT_FIRST };
      return { bold: offers.bold ? off : null, italic: offers.italic ? off : null, link: linkable ? { ...off, href: null } : null };
    }
    const link = linkAt(range);
    const linkRefusal = struck(range).some(isPageWritten) ? LINK_CANT_HOLD_WRITTEN : range.collapsed && link === null ? SELECT_TEXT_FIRST : null;
    return {
      bold: offers.bold ? { on: isOn('bold', range), why: null } : null,
      italic: offers.italic ? { on: isOn('italic', range), why: null } : null,
      link: linkable ? { on: link !== null, why: linkRefusal, href: link?.getAttribute('href') ?? null } : null,
    };
  };
  const format = (kind: WordsFormat): void => {
    const range = selected();
    if (range === null || !offers[kind]) return;
    if (atomsOnly(range) && struck(range).every(hasHiddenInline)) return;
    const atoms = struck(range).filter((atom) => !hasHiddenInline(atom));
    const first = atoms[0];
    const last = atoms.at(-1);
    const turnOn = !isOn(kind, range);
    const onlyAtoms = atomsOnly(range);
    if (!range.collapsed) mark(null);
    if (atoms.length === 0 || (!onlyAtoms && doc.queryCommandState(kind) !== turnOn)) exec(kind);
    for (const atom of atoms) {
      if (turnOn && wrapperOf(atom, kind) === null) {
        const wrapper = doc.createElement(kind === 'bold' ? 'b' : 'i');
        atom.replaceWith(wrapper);
        wrapper.append(atom);
      }
      if (!turnOn) for (let wrapper = wrapperOf(atom, kind); wrapper !== null; wrapper = wrapperOf(atom, kind)) splitOutOfWrapper(atom, wrapper);
    }
    if (!onlyAtoms || first === undefined || last === undefined) return;
    const next = doc.createRange();
    next.setStartBefore(first);
    next.setEndAfter(last);
    select(next);
  };
  const link = (href: string | null): void => {
    const range = selected();
    const normalized = href === null ? null : normalizeLinkHref(href);
    if (range === null || !linkable || (href !== null && normalized === null)) return;
    const current = linkAt(range);
    mark(null);
    if (current !== null && normalized !== null) current.setAttribute('href', normalized);
    else exec(normalized === null ? 'unlink' : 'createLink', normalized ?? undefined);
  };
  return { cells, format, link, linkAt };
}

function trimPreLeadingNewline(words: Element, runs: InlineRun[]): InlineRun[] {
  const [first, ...rest] = runs;
  return words.matches('pre, listing') && typeof first === 'string' && first.startsWith('\n') ? [first.replace(/^\n+/, ''), ...rest] : runs;
}

/** Opens a words session on `words` (a live element of the page) and makes it the draft's visit. */
export function visitWords(words: Element, start: WordsStart, host: WordsHost): WordsVisit {
  const selection = words.ownerDocument.getSelection();
  if (!(words instanceof HTMLElement) || selection === null) throw new Error('visitWords: these words take no caret');
  return openWordsSession(words, selection, start, host);
}

function openWordsSession(words: HTMLElement, selection: Selection, start: WordsStart, host: WordsHost): WordsVisit {
  const { draft } = host;
  const doc = words.ownerDocument;
  const atoms: Element[] = [];
  const unseen: Element[] = [];
  const collect = (parent: Element): void => {
    for (const child of parent.children) {
      const stored = draft.storedOf(child);
      if ((child.localName !== 'br' && (child.textContent ?? '') === '' && child.getBoundingClientRect().width === 0) || child.hasAttribute('hidden') || !isVisible(child))
        unseen.push(child);
      else if (stored !== null && isWordsAtom(stored)) atoms.push(child);
      else collect(child);
    }
  };
  collect(words);
  const unseenPlaces = unseen.map((element): WordsUnseenPlace => ({ u: element, parent: element.parentNode, before: element.previousSibling, after: element.nextSibling }));
  const context: WordsAtoms = { words, atoms, unseen };
  const kept = [...atoms, ...unseen];
  const editableAttributes = [words, ...kept]
    .map((element): [Element, string, string] => [element, 'contenteditable', String(element === words)])
    .concat([...words.querySelectorAll('a')].map((link): [Element, string, string] => [link, 'draggable', 'false']))
    .concat(words.matches('button') ? [[words, 'tabindex', '0']] : [])
    .filter(([element, name]) => !element.hasAttribute(name));
  const inButton = words.closest('button, summary') !== null;
  const controller = new AbortController();
  let parked: Range | null = null;
  let executing = false;
  let pendingSpace: WordsPendingSpace | null = null;
  const keptOf = (target: EventTarget | null): Element | null => (target instanceof Node ? (kept.find((element) => element.contains(target)) ?? null) : null);
  const struckBy = (range: Range): Element[] => (range.collapsed ? [] : atoms.filter((atom) => range.intersectsNode(atom)));
  const makeRange = (setup: (range: Range) => void): Range => {
    const range = doc.createRange();
    setup(range);
    return range;
  };
  const selectRange = (range: Range): void => {
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const currentRange = (): Range | null =>
    selection.rangeCount > 0 && words.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0) : parked;
  const widenOverKept = (range: Range): Range => {
    for (const element of kept) {
      if (element.contains(range.startContainer)) range.setStartBefore(element);
      if (element.contains(range.endContainer)) range.setEndAfter(element);
    }
    return range;
  };
  const hasOwnWords = (range: Range): boolean => {
    const contents = range.cloneContents();
    for (const element of contents.querySelectorAll('[contenteditable="false"]')) element.remove();
    return (contents.textContent ?? '').trim() !== '';
  };
  const readText = (parent: Element = words): string =>
    [...parent.childNodes]
      .map((node) => (isTextNode(node) ? node.data.replace(/ /g, ' ') : node instanceof Element && !unseen.includes(node) ? readText(node) : ''))
      .join('');
  const readShape = (parent: Element): WordsShapeItem[] => {
    const shape: WordsShapeItem[] = [];
    for (const node of parent.childNodes) {
      const last = shape.at(-1);
      if (isTextNode(node) && typeof last === 'string') shape[shape.length - 1] = last + node.data;
      else if (isTextNode(node)) shape.push(node.data);
      else if (node instanceof Element) shape.push(kept.includes(node) ? kept.indexOf(node) : [node.localName, node.getAttribute('href'), ...readShape(node)]);
    }
    return shape.filter((item) => item !== '');
  };
  const shapeKey = (): string => JSON.stringify(readShape(words));
  let size = '';
  let lastRange: Range | null = null;
  let touched = false;
  const onChanged = (): void => {
    touched = true;
    const wasSize = size;
    size = `${words.offsetWidth}x${words.offsetHeight}`;
    lastRange = currentRange()?.cloneRange() ?? lastRange;
    if (wasSize !== size) draft.pass();
    host.changed();
    draft.touch();
  };
  const exec = (command: string, value?: string): void => {
    words.focus({ preventScroll: true });
    executing = true;
    try {
      doc.execCommand('styleWithCSS', false, 'false');
      doc.execCommand(command, false, value);
    } finally {
      executing = false;
    }
  };

  const undoStack: WordsSnapshot[] = [];
  const redoStack: WordsSnapshot[] = [];
  let lastKind: string | null = null;
  let lastAt = 0;
  const snapshotKids = (parent: Element): WordsSnapshotKid[] =>
    [...parent.childNodes].map((node) =>
      isTextNode(node) ? node.data : node instanceof Element && !kept.includes(node) ? { node, kids: snapshotKids(node), href: node.getAttribute('href') } : { node },
    );
  const restoreKids = (kids: WordsSnapshotKid[]): Node[] =>
    kids.map((kid) => {
      if (typeof kid === 'string') return doc.createTextNode(kid);
      if (kid.kids !== undefined && kid.node instanceof Element) kid.node.replaceChildren(...restoreKids(kid.kids));
      if (typeof kid.href === 'string' && kid.node instanceof Element) kid.node.setAttribute('href', kid.href);
      return kid.node;
    });
  const snapshot = (): WordsSnapshot => {
    const { focusNode, focusOffset } = selection;
    return {
      kids: snapshotKids(words),
      caret:
        focusNode !== null && words.contains(focusNode)
          ? makeRange((range) => {
              range.selectNodeContents(words);
              range.setEnd(focusNode, focusOffset);
            }).toString().length
          : null,
    };
  };
  const placeCaret = (caret: number): void => {
    const walker = doc.createTreeWalker(words, NodeFilter.SHOW_TEXT);
    let left = caret;
    for (let node = walker.nextNode(); isTextNode(node); node = walker.nextNode()) {
      if (left <= node.length) {
        const atom = keptOf(node);
        if (atom === null) selection.collapse(node, left);
        else
          selectRange(
            makeRange((range) => {
              range.setStartAfter(atom);
              range.collapse(true);
            }),
          );
        return;
      }
      left -= node.length;
    }
    selection.selectAllChildren(words);
    selection.collapseToEnd();
  };
  const mark = (kind: string | null): void => {
    const now = performance.now();
    if (kind === null || kind !== lastKind || now - lastAt > WORDS_UNDO_MERGE_MS) {
      undoStack.push(snapshot());
      redoStack.length = 0;
    }
    lastKind = kind;
    lastAt = now;
  };
  const turn = (forward: boolean): boolean => {
    const from = forward ? redoStack : undoStack;
    const to = forward ? undoStack : redoStack;
    const step = from.pop();
    if (step === undefined) return false;
    to.push(snapshot());
    words.replaceChildren(...restoreKids(step.kids));
    if (step.caret !== null) placeCaret(step.caret);
    lastKind = null;
    pendingSpace = null;
    onChanged();
    return true;
  };
  const isCharLike = (neighbour: CaretNeighbour | Element | null, pattern: RegExp): neighbour is CaretNeighbour =>
    neighbour !== null && !(neighbour instanceof Element) && pattern.test(neighbour.ch);
  const skipSpaces = (container: Node, offset: number, direction: number): { to: [Node, number]; spaced: boolean; next: CaretNeighbour | Element | null } => {
    let to: [Node, number] = [container, offset];
    let next = findCaretNeighbour(context, container, offset, direction);
    for (; isCharLike(next, /\s/); next = findCaretNeighbour(context, to[0], to[1], direction)) to = [next.node, direction < 0 ? next.at : next.at + next.ch.length];
    return { to, spaced: to[0] !== container || to[1] !== offset, next };
  };
  const restoreUnseen = (): void => {
    const standsIn = (node: ChildNode | null, place: WordsUnseenPlace): node is ChildNode => node !== null && node.parentNode === place.parent && words.contains(node);
    for (const place of unseenPlaces.filter(({ u }) => !words.contains(u))) {
      const range =
        currentRange() ??
        makeRange((end) => {
          end.selectNodeContents(words);
          end.collapse(false);
        });
      if (standsIn(place.before, place)) place.before.after(place.u);
      else if (standsIn(place.after, place)) place.after.before(place.u);
      else {
        range.insertNode(place.u);
        range.collapse(false);
      }
    }
  };
  let atomNeighbours: string[] = [];
  const afterInput = (event?: Event): void => {
    if (event instanceof InputEvent && event.isComposing) {
      onChanged();
      return;
    }
    restoreUnseen();
    restoreAtomSpacing(context, atomNeighbours);
    onChanged();
  };
  const replaceRange = (range: Range, text: string | null): void => {
    const before = skipSpaces(range.startContainer, range.startOffset, -1);
    const after = skipSpaces(range.endContainer, range.endOffset, 1);
    const space: 'before' | 'after' | null =
      text !== null
        ? null
        : before.spaced && (after.spaced || after.next === null || isCharLike(after.next, /[.,;:!?)]/))
          ? 'before'
          : !before.spaced && before.next === null && after.spaced
            ? 'after'
            : null;
    if (space === 'before') range.setStart(...before.to);
    if (space === 'after') range.setEnd(...after.to);
    const hidden = unseen.filter((element) => range.intersectsNode(element));
    range.deleteContents();
    if (text !== null) range.insertNode(doc.createTextNode(text));
    for (const element of hidden.reverse()) range.insertNode(element);
    if (text === null && readText() === '' && !atoms.some((atom) => words.contains(atom))) words.append(doc.createElement('br'));
    selection.collapse(range.endContainer, range.endOffset);
    pendingSpace = space === null ? null : { node: range.endContainer, offset: range.endOffset, space };
    afterInput();
  };
  const spaceJump = (direction: number): [Node, number] | Element | null => {
    const { anchorNode, anchorOffset } = selection;
    if (anchorNode === null) return null;
    const { to, spaced, next } = skipSpaces(anchorNode, anchorOffset, direction);
    if (!spaced) return next instanceof Element ? next : null;
    const behind = findCaretNeighbour(context, anchorNode, anchorOffset, direction < 0 ? 1 : -1);
    const edgeChar = (neighbour: CaretNeighbour | Element | null, side: number): string =>
      neighbour instanceof Element ? ([...readShownText(neighbour)].at(side < 0 ? -1 : 0) ?? '') : (neighbour?.ch ?? '');
    const needsSpace = (atom: CaretNeighbour | Element | null, other: CaretNeighbour | Element | null, side: number): boolean =>
      atom instanceof Element && needsAtomSpace(edgeChar(other, side), atom, side);
    return needsSpace(next, behind, direction < 0 ? 1 : -1) || needsSpace(behind, next, direction) ? to : null;
  };
  const stepOutOfKept = (): boolean => {
    const { anchorNode, anchorOffset } = selection;
    const atom = selection.isCollapsed ? keptOf(anchorNode) : null;
    if (atom === null || anchorNode === null) return false;
    const atStart =
      makeRange((range) => {
        range.selectNodeContents(atom);
        range.setEnd(anchorNode, anchorOffset);
      }).toString() === '';
    selectRange(
      makeRange((range) => {
        if (atStart) range.setStartBefore(atom);
        else range.setStartAfter(atom);
        range.collapse(true);
      }),
    );
    return true;
  };
  const stepOutOfLink = (): boolean => {
    const anchor = selection.anchorNode;
    if (anchor === null || !selection.isCollapsed) return false;
    const link = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest('a') ?? null;
    const atLinkEnd =
      link !== null &&
      link !== words &&
      words.contains(link) &&
      makeRange((range) => {
        range.selectNodeContents(link);
        range.setStart(anchor, selection.anchorOffset);
      }).toString() === '';
    if (!atLinkEnd && !(anchor instanceof Element)) return false;
    const empty = doc.createTextNode('');
    if (atLinkEnd) link.after(empty);
    else anchor.insertBefore(empty, anchor.childNodes[selection.anchorOffset] ?? null);
    selection.collapse(empty, 0);
    return true;
  };
  const widenToWrapper = (range: Range): Range => {
    const wrapper = range.startContainer.parentElement;
    if (range.collapsed || !isTextNode(range.startContainer) || wrapper === null || wrapper === words || !range.isPointInRange(wrapper, wrapper.childNodes.length))
      return range;
    const head = makeRange((part) => {
      part.selectNodeContents(wrapper);
      part.setEnd(range.startContainer, range.startOffset);
    });
    const tail = makeRange((part) => {
      part.setStartAfter(wrapper);
      part.setEnd(range.endContainer, range.endOffset);
    });
    return head.toString() !== '' || hasOwnWords(tail) || struckBy(tail).length > 0 ? range : makeRange((part) => part.selectNodeContents(wrapper));
  };
  const refuse = (at: Element, why: string): boolean => {
    host.refuse(at, why);
    return false;
  };
  /** True: let the browser do it; false: handled (or refused) here. */
  const handleInput = (inputType: string, data: string | null, targets: readonly StaticRange[]): boolean => {
    const inserting = !inputType.startsWith('delete');
    const kind = inserting || COMPOSITION_INPUT_TYPES.has(inputType) ? 'insert' : 'delete';
    const steppedOut = !COMPOSITION_INPUT_TYPES.has(inputType) && stepOutOfKept();
    const space =
      pendingSpace !== null && selection.isCollapsed && selection.anchorNode === pendingSpace.node && selection.anchorOffset === pendingSpace.offset
        ? pendingSpace.space
        : null;
    pendingSpace = null;
    if (space !== null && inputType === 'insertText' && data !== null && /^[^\s.,;:!?)]/.test(data)) {
      mark(kind);
      exec('insertText', space === 'before' ? ` ${data}` : `${data} `);
      if (space === 'after') selection.modify('move', 'backward', 'character');
      return false;
    }
    if (inputType === 'insertText' && data !== null && stepOutOfLink()) {
      mark(kind);
      exec('insertText', data);
      return false;
    }
    const range = currentRange()?.cloneRange();
    if (range === undefined || targets.some((target) => !words.contains(target.startContainer) || !words.contains(target.endContainer))) return false;
    const direction = inputType.endsWith('Backward') ? -1 : 1;
    const jump = range.collapsed && /(Back|For)ward$/.test(inputType) ? spaceJump(direction) : null;
    if (Array.isArray(jump) && inputType.startsWith('deleteContent')) {
      selection.collapse(jump[0], jump[1]);
      return false;
    }
    const atom = jump instanceof Element ? jump : null;
    const target = targets[0];
    const span =
      atom !== null
        ? makeRange((part) => part.selectNode(atom))
        : widenOverKept(
            range.collapsed && target !== undefined
              ? makeRange((part) => {
                  part.setStart(target.startContainer, target.startOffset);
                  part.setEnd(target.endContainer, target.endOffset);
                })
              : range,
          );
    const neighbour =
      range.collapsed && inputType.startsWith('deleteContent') && (steppedOut || unseen.some((element) => span.intersectsNode(element)))
        ? findCaretNeighbour(context, range.startContainer, range.startOffset, direction)
        : null;
    const cut = isCharLike(neighbour, /./su)
      ? makeRange((part) => {
          part.setStart(neighbour.node, neighbour.at);
          part.setEnd(neighbour.node, neighbour.at + neighbour.ch.length);
        })
      : inserting
        ? widenToWrapper(span)
        : span;
    const struck = struckBy(cut);
    const written = struck.find(isPageWritten);
    if (written !== undefined && inserting && !hasOwnWords(cut)) return refuse(written, uneditableRefusal(written));
    if (written !== undefined && inputType === 'deleteByCut') return refuse(written, REFUSE_CUT);
    const native = COMPOSITION_INPUT_TYPES.has(inputType) || (struck.length === 0 && cut === span && !unseen.some((element) => cut.intersectsNode(element)));
    if (!native && inserting && data === null) return false;
    mark(kind);
    if (native) return true;
    replaceRange(cut, inserting ? data : null);
    return false;
  };
  const caretAtPoint = (x: number, y: number): void => {
    const position = typeof doc.caretPositionFromPoint === 'function' ? doc.caretPositionFromPoint(x, y) : null;
    const range = position !== null ? null : typeof doc.caretRangeFromPoint === 'function' ? doc.caretRangeFromPoint(x, y) : null;
    if (position !== null) selection.collapse(position.offsetNode, position.offset);
    else if (range !== null) selection.collapse(range.startContainer, range.startOffset);
  };
  const selectByClicks = (target: EventTarget | null, clicks: number): void => {
    const atom = keptOf(target);
    if (clicks >= 3) selection.selectAllChildren(words);
    else if (atom !== null) selectRange(makeRange((range) => range.selectNode(atom)));
    else if (clicks === 2) {
      selection.modify('move', 'forward', 'character');
      selection.modify('move', 'backward', 'word');
      selection.modify('extend', 'forward', 'word');
      if (/\s$/.test(selection.toString())) selection.modify('extend', 'backward', 'character');
    }
  };
  const formatter = createWordsFormatter({ el: words, selected: currentRange, select: selectRange, struck: struckBy, wordsIn: hasOwnWords, exec, mark });
  const applyFormat = (kind: WordsFormat): void => {
    formatter.format(kind);
    onChanged();
  };
  const applyLink = (href: string | null): void => {
    formatter.link(href);
    onChanged();
  };
  const park = (): (() => void) => {
    parked = currentRange()?.cloneRange() ?? null;
    const link = parked === null ? null : formatter.linkAt(parked);
    if (link !== null) parked?.selectNodeContents(link);
    if (parked !== null) highlights()?.set(LINK_PARK_HIGHLIGHT, new Highlight(parked));
    return () => {
      highlights()?.delete(LINK_PARK_HIGHLIGHT);
      if (!controller.signal.aborted) words.focus({ preventScroll: true });
    };
  };
  const end = (reason: WordsEndReason): void => {
    draft.settle(true);
    host.ended(reason);
  };
  const endSoon = (): void =>
    queueMicrotask(() => {
      if (!controller.signal.aborted) end('away');
    });
  const listen = <K extends keyof WindowEventMap>(type: K, handler?: (event: WindowEventMap[K]) => void): void => {
    const guarded = (event: WindowEventMap[K]): void => {
      if (!event.isTrusted || !(event.target instanceof Node) || !words.contains(event.target)) return;
      event.stopPropagation();
      handler?.(event);
    };
    window.addEventListener(type, guarded, { capture: true, signal: controller.signal });
  };

  let startShape: string | null = null;
  let startText = '';
  let swapped = false;
  const finish = (): DraftEnded | null => {
    const stored = draft.storedOf(words);
    if (stored === null || !touched || shapeKey() === startShape) return null;
    const emptied = readText().trim() === '' && !atoms.some((atom) => words.contains(atom));
    const refusal = emptied ? emptiedRefusal((selector) => words.closest(selector) !== null) : null;
    const readStep = emptied ? words.closest(`[${READ_STEP_ATTRIBUTE}]`) : null;
    if (refusal !== null || (readStep !== null && (readStep.textContent ?? '').trim() === '') || (emptied && swapped)) {
      host.refuse(words, refusal ?? CHAPTER_NEEDS_WORDS);
      draft.pass();
      return null;
    }
    if (emptied && !words.matches('td, th')) return { step: { place: stored, in: null, before: null }, verb: 'deleting' };
    return {
      step: { words: stored, runs: trimPreLeadingNewline(words, collectWordsRuns(words, draft.storedOf)) },
      verb: readText() === startText ? 'styling' : 'typing',
    };
  };
  const endVisit = (): DraftEnded | null => {
    controller.abort();
    restoreUnseen();
    restoreAtomSpacing(context, atomNeighbours);
    parked = null;
    highlights()?.delete(LINK_PARK_HIGHLIGHT);
    for (const [element, name] of editableAttributes) element.removeAttribute(name);
    if (currentRange() !== null) selection.removeAllRanges();
    words.blur();
    return finish();
  };
  const visit: WordsVisit = {
    el: words,
    dirty: () => touched && shapeKey() !== startShape,
    can: (forward) => (forward ? redoStack : undoStack).length > 0,
    turn,
    end: endVisit,
    cells: formatter.cells,
    format: applyFormat,
    link: applyLink,
    park,
  };
  draft.open(visit);
  listen('beforeinput', (event) => {
    if (executing) return;
    const { inputType } = event;
    if (isHandledInputType(inputType) && handleInput(inputType, event.data, event.getTargetRanges())) return;
    event.preventDefault();
    if (inputType === 'historyUndo') draft.undo();
    if (inputType === 'historyRedo') draft.redo();
    if (inputType === 'formatBold' || inputType === 'formatItalic')
      setTimeout(() => {
        if (!controller.signal.aborted) applyFormat(inputType === 'formatBold' ? 'bold' : 'italic');
      });
  });
  listen('input', afterInput);
  listen('compositionend', afterInput);
  let tipped: Element | null = null;
  const tipAt = (element: Element | null): void => {
    const label = element === null || element === tipped ? null : describeUneditable(element);
    if (element !== tipped) host.tip(label === null ? null : element, label ?? undefined);
    tipped = element;
  };
  listen('keydown', (event) => {
    tipAt(null);
    if (event.key === 'Escape') {
      if (isComposingKey(event)) return;
      event.preventDefault();
      end('key');
      return;
    }
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (isComposingKey(event)) return;
      end('key');
      return;
    }
    if (isComposingKey(event)) return;
    if (event.key === ' ' && inButton) {
      event.preventDefault();
      if (handleInput('insertText', ' ', [])) exec('insertText', ' ');
    }
    const shortcut = wordsShortcutOf(event, isApplePlatform());
    if (shortcut !== null) event.preventDefault();
    if (shortcut === 'b' || shortcut === 'i') applyFormat(shortcut === 'b' ? 'bold' : 'italic');
    if (shortcut === 'a') selection.selectAllChildren(words);
    if (event.key === 'Enter') {
      event.preventDefault();
      end('key');
    }
  });
  listen('keyup', (event) => {
    if (event.key === ' ' && inButton) event.preventDefault();
  });
  listen('keypress');
  listen('click', (event) => {
    event.preventDefault();
    selectByClicks(event.target, event.detail);
  });
  listen('paste', (event) => {
    event.preventDefault();
    const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\s*[\r\n]+\s*/g, ' ');
    const href = /^https?:\/\/\S+$/i.test(text.trim()) && !selection.isCollapsed && formatter.cells().link?.why === null ? normalizeLinkHref(text) : null;
    if (href !== null) applyLink(href);
    else if (text !== '' && handleInput('insertText', text, [])) exec('insertText', text);
  });
  listen('cut');
  listen('drop', (event) => event.preventDefault());
  listen('dragstart', (event) => event.preventDefault());
  const staysInside = (target: EventTarget | null): boolean => target instanceof Element && (words.contains(target) || target.closest(CHROME_SELECTOR) !== null);
  listen('blur', (event) => {
    const hidden = event.relatedTarget === null && !isVisible(words);
    if (!hidden && !staysInside(event.relatedTarget)) {
      endSoon();
      return;
    }
    parked ??= lastRange;
    const refocus = (retry: boolean): void => {
      if (controller.signal.aborted) return;
      if (isVisible(words)) words.focus({ preventScroll: true });
      else if (retry) requestAnimationFrame(() => refocus(false));
      else end('away');
    };
    if (hidden) queueMicrotask(() => refocus(true));
  });
  listen('focus', () => {
    if (parked !== null) selectRange(parked);
    parked = null;
  });
  window.addEventListener(
    'focusin',
    (event) => {
      if (!staysInside(event.target)) endSoon();
    },
    { capture: true, signal: controller.signal },
  );
  listen('mousemove', (event) => tipAt(keptOf(event.target)));
  listen('mouseout', (event) => {
    if (!staysInside(event.relatedTarget)) tipAt(null);
  });
  doc.addEventListener(
    'selectionchange',
    () => {
      if (parked !== null) return;
      lastRange = currentRange()?.cloneRange() ?? lastRange;
      host.changed();
    },
    { signal: controller.signal },
  );
  for (const [element, name, value] of editableAttributes) element.setAttribute(name, value);
  size = `${words.offsetWidth}x${words.offsetHeight}`;
  atomNeighbours = readAtomNeighbours(context);
  startText = readText();
  swapped = host.swapped(words);
  startShape = shapeKey();
  words.focus({ preventScroll: true });
  if (start instanceof Range) selectRange(widenOverKept(start.cloneRange()));
  else if (start === null) {
    selection.selectAllChildren(words);
    selection.collapseToEnd();
  } else {
    caretAtPoint(start.x, start.y);
    selectByClicks(doc.elementFromPoint(start.x, start.y), start.clicks);
  }
  return visit;
}
