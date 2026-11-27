/**
 * A table of contents drawn on the page: its links, kept in step with the tab's headings; selected whole, never typed
 * in. Enter on it reaches its links; on a link, the arrow keys move between them and Escape goes back to the text.
 * Selected where it can be changed, it shows a bar of its actions, which the bar keys (F6) reach. In a version preview, one
 * the version dropped is drawn as a card that says so, without its links.
 */
import { announce, modKey } from '@open-artifact/editor-kit';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { Decoration, EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { CONTENTS_REMOVED } from '../history/compare.ts';
import { blockDropped } from '../history/preview-doc.ts';
import { followDocLink } from '../selbar/navigate.ts';
import { ContentsBar } from './ContentsBar.tsx';
import {
  CONTENTS_DELETED,
  CONTENTS_EMPTY,
  CONTENTS_NAME,
  type ContentsHint,
  type HintLessons,
  contentsBeside,
  contentsSelected,
  freshLessons,
  hintsToSay,
  isPageContents,
  pageContents,
  selectedContents,
  stillOnContents,
  wholeContents,
} from './contents.ts';

/** The tables of contents each editor shows, to draw again when its headings change. */
const shown = new WeakMap<EditorView, Set<ContentsView>>();

/** What `drawn` holds while the card for a dropped table of contents is up. */
const GONE = 'gone';

/** Which ways on from a selected table of contents each editor's reader has used or been told, for as long as the page is open. */
const lessons = new WeakMap<EditorView, HintLessons>();

function lessonsOf(view: EditorView): HintLessons {
  let held = lessons.get(view);
  if (!held) lessons.set(view, (held = freshLessons()));
  return held;
}

export class ContentsView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly list: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly root: Root;
  private drawn: string | null = null;
  /** Dropped by the version a preview shows: a card in its place. */
  private gone: boolean;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[] = []) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.gone = blockDropped(decorations);
    this.dom = document.createElement('div');
    this.dom.className = 'code-block contents-block';
    this.list = document.createElement('nav');
    this.list.className = 'contents-list';
    this.list.contentEditable = 'false';
    this.list.setAttribute('aria-label', CONTENTS_NAME);
    this.bar = document.createElement('div');
    this.bar.className = 'contents-actions';
    this.bar.contentEditable = 'false';
    const pre = document.createElement('pre');
    this.contentDOM = document.createElement('code');
    pre.append(this.contentDOM);
    this.dom.append(this.bar, this.list, pre);
    this.root = createRoot(this.bar);
    this.list.addEventListener('mousedown', this.press);
    this.list.addEventListener('click', this.follow);
    this.list.addEventListener('keydown', this.keys);
    let views = shown.get(view);
    if (!views) shown.set(view, (views = new Set()));
    views.add(this);
    this.marks();
    this.refresh();
  }

  private marks(): void {
    const set = (name: string, value: unknown) => (typeof value === 'string' && value ? this.dom.setAttribute(name, value) : this.dom.removeAttribute(name));
    set('data-bid', this.node.attrs.bid);
    set('data-suggest-id', this.node.attrs.suggestId);
    set('data-suggest-op', this.node.attrs.suggestId ? (this.node.attrs.suggestOp ?? 'ins') : null);
    set('data-language', this.node.attrs.language);
    this.dom.classList.toggle('contents-gone', this.gone);
  }

  /** Draws the links again when the headings they come from changed (or the card, once, for a dropped one). */
  refresh(): void {
    if (this.gone) {
      if (this.drawn === GONE) return;
      this.drawn = GONE;
      const label = document.createElement('span');
      label.className = 'contents-gone-label';
      label.textContent = CONTENTS_REMOVED;
      this.list.replaceChildren(label);
      return;
    }
    const lines = pageContents(this.view.state.doc);
    const key = JSON.stringify(lines);
    if (key === this.drawn) return;
    this.drawn = key;
    if (!lines.length) {
      const note = document.createElement('p');
      note.className = 'contents-empty';
      note.textContent = CONTENTS_EMPTY;
      this.list.replaceChildren(note);
      return;
    }
    this.list.replaceChildren(
      ...lines.map(line => {
        const item = document.createElement(line.href ? 'a' : 'span');
        item.className = 'contents-line';
        item.dataset.step = String(line.indent);
        if (line.group) item.dataset.group = '';
        if (line.href) item.setAttribute('href', line.href);
        item.textContent = line.text;
        return item;
      }),
    );
  }

  /**
   * Gives the text its focus back and selects the block whole: focus first, so the page has the keyboard by the time
   * the selection is announced (what is said depends on it).
   */
  private selectWhole(): void {
    this.view.focus();
    const at = this.getPos();
    const { state } = this.view;
    if (at !== undefined) this.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, at)));
  }

  /** A press anywhere on the block but a link selects it whole. */
  private readonly press = (event: MouseEvent): void => {
    const onLink = event.target instanceof Element && !!event.target.closest('a');
    if (onLink || event.button) return;
    event.preventDefault();
    this.selectWhole();
  };

  private readonly follow = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    const href = link?.getAttribute('href');
    if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    followDocLink(href);
  };

  private readonly keys = (event: KeyboardEvent): void => {
    const links = [...this.list.querySelectorAll<HTMLElement>('a')];
    const at = links.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      links[Math.min(Math.max(at + (event.key === 'ArrowDown' ? 1 : -1), 0), links.length - 1)]!.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      links[event.key === 'Home' ? 0 : links.length - 1]!.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.selectWhole();
    }
  };

  /** Selected, the block shows its bar when it can be changed (the reader's rights can change while it is drawn). */
  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    this.root.render(this.view.editable ? createElement(ContentsBar, { onDelete: () => this.remove() }) : null);
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
    this.root.render(null);
  }

  private remove(): void {
    const at = this.getPos();
    if (at === undefined) return;
    const view = this.view;
    deleteContents(view, at);
    // The menu gives the keyboard back to its button once it has closed, and that went with the block: the text takes it.
    setTimeout(() => {
      if (!view.isDestroyed && !view.dom.contains(view.dom.ownerDocument.activeElement)) view.focus();
    });
  }

  /** The first link, for Enter on the selected block. */
  firstLink(): HTMLElement | null {
    return this.list.querySelector('a');
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (!isPageContents(node)) return false;
    this.node = node;
    const gone = blockDropped(decorations);
    if (gone !== this.gone) [this.gone, this.drawn] = [gone, null];
    this.marks();
    this.refresh();
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && (this.list.contains(event.target) || this.bar.contains(event.target));
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    shown.get(this.view)?.delete(this);
    this.list.removeEventListener('mousedown', this.press);
    this.list.removeEventListener('click', this.follow);
    this.list.removeEventListener('keydown', this.keys);
    const root = this.root;
    queueMicrotask(() => root.unmount());
  }
}

/**
 * Takes out the table of contents at `at` (by a key or from its bar) and gives the text its keyboard back. In
 * Suggesting mode a whole block can't be taken out yet (the page says so): the block stays, so nothing is said.
 */
export function deleteContents(view: EditorView, at: number): void {
  const before = view.state.doc;
  const node = before.nodeAt(at);
  if (!view.editable || !node || !isPageContents(node)) return;
  const tr = view.state.tr.setSelection(NodeSelection.create(before, at));
  view.dispatch(tr.deleteSelection().scrollIntoView());
  view.focus();
  if (!view.state.doc.eq(before)) announce(CONTENTS_DELETED);
}

/**
 * What is said when a table of contents is selected: Enter reaches its links, and the bar keys its actions. Where it
 * can be changed and the page has the keyboard, each way on is named until the reader has used it, again only after
 * two minutes away from tables of contents (`hintsToSay`).
 */
function selectedWords(view: EditorView, now: number): string {
  const offered: ContentsHint[] = [];
  if (view.editable && view.dom.ownerDocument.hasFocus()) {
    if (pageContents(view.state.doc).some(line => line.href !== null)) offered.push('links');
    offered.push('actions');
  }
  const say = hintsToSay(lessonsOf(view), offered, now);
  return contentsSelected(say.has('links'), say.has('actions') ? `${modKey()}F6` : null);
}

/** The bar keys: F6 (with or without the modifier), or Alt-F10. */
const barKey = (event: KeyboardEvent): boolean => (event.key === 'F6' ? !event.shiftKey && !event.altKey : event.code === 'F10' && event.altKey);

const ARROWS: Record<string, { dir: -1 | 1; edge: 'up' | 'down' | 'left' | 'right' }> = {
  ArrowUp: { dir: -1, edge: 'up' },
  ArrowLeft: { dir: -1, edge: 'left' },
  ArrowDown: { dir: 1, edge: 'down' },
  ArrowRight: { dir: 1, edge: 'right' },
};

/** An arrow key at the edge of a block selects the table of contents beside it. */
function arrowOnto(view: EditorView, arrow: (typeof ARROWS)[string]): boolean {
  const target = contentsBeside(view.state, arrow.dir, view.endOfTextblock(arrow.edge));
  if (target) view.dispatch(view.state.tr.setSelection(target).scrollIntoView());
  return !!target;
}

/** A key on a selected table of contents: Enter reaches its links, Backspace or Delete takes it out. */
function keyOnContents(view: EditorView, key: string, at: number): boolean {
  switch (key) {
    case 'Enter': {
      const drawn = [...(shown.get(view) ?? [])].find(item => item.dom === view.nodeDOM(at));
      const link = drawn?.firstLink();
      link?.focus();
      if (link && link.ownerDocument.activeElement === link) lessonsOf(view).links.learned = true;
      return true;
    }
    case 'Backspace':
    case 'Delete':
      if (!view.editable) return false;
      deleteContents(view, at);
      return true;
    default:
      return false;
  }
}

/**
 * Keeps tables of contents whole: a caret landing in one selects it, arrows onto one from the text beside select it,
 * Enter reaches its links, and deleting it says so. Every edit draws them again. Selecting one says so, with the ways
 * on the reader hasn't used yet; a bar key pressed on one counts as having used the bar.
 */
export function contentsPlugin(): Plugin {
  return new Plugin({
    appendTransaction(_transactions, _old, state) {
      const whole = wholeContents(state);
      return whole ? state.tr.setSelection(whole) : null;
    },
    props: {
      handleKeyDown(view, event) {
        if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return false;
        const arrow = ARROWS[event.key];
        if (arrow) return arrowOnto(view, arrow);
        const selected = selectedContents(view.state);
        return selected ? keyOnContents(view, event.key, selected.pos) : false;
      },
    },
    view(editorView) {
      const learnBar = (event: KeyboardEvent): void => {
        if (barKey(event) && editorView.editable && editorView.hasFocus() && selectedContents(editorView.state)) lessonsOf(editorView).actions.learned = true;
      };
      const win = editorView.dom.ownerDocument.defaultView;
      win?.addEventListener('keydown', learnBar, true);
      let wasOn = !!selectedContents(editorView.state);
      return {
        update(view, previous) {
          if (!previous.doc.eq(view.state.doc)) for (const item of shown.get(view) ?? []) item.refresh();
          const now = Date.now();
          if (wasOn) stillOnContents(lessonsOf(view), now);
          const on = selectedContents(view.state);
          wasOn = !!on;
          if (on && selectedContents(previous)?.node !== on.node) announce(selectedWords(view, now));
        },
        destroy() {
          win?.removeEventListener('keydown', learnBar, true);
        },
      };
    },
  });
}
