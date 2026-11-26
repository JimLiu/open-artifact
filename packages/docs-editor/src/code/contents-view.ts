/**
 * A table of contents drawn on the page: its links, kept in step with the tab's headings; selected whole, never typed
 * in. Enter on it reaches its links; on a link, the arrow keys move between them and Escape goes back to the text.
 */
import { announce } from '@open-artifact/editor-kit';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { followDocLink } from '../selbar/navigate.ts';
import { CONTENTS_DELETED, CONTENTS_EMPTY, CONTENTS_NAME, CONTENTS_SELECTED, contentsBeside, isPageContents, pageContents, selectedContents, wholeContents } from './contents.ts';

/** The tables of contents each editor shows, to draw again when its headings change. */
const shown = new WeakMap<EditorView, Set<ContentsView>>();

export class ContentsView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly list: HTMLElement;
  private drawn: string | null = null;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'code-block contents-block';
    this.list = document.createElement('nav');
    this.list.className = 'contents-list';
    this.list.contentEditable = 'false';
    this.list.setAttribute('aria-label', CONTENTS_NAME);
    const pre = document.createElement('pre');
    this.contentDOM = document.createElement('code');
    pre.append(this.contentDOM);
    this.dom.append(this.list, pre);
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
  }

  /** Draws the links again when the headings they come from changed. */
  refresh(): void {
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

  /** Selects the block whole and gives the text its focus back. */
  private selectWhole(): void {
    const at = this.getPos();
    const { state } = this.view;
    if (at !== undefined) this.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, at)));
    this.view.focus();
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

  /** The first link, for Enter on the selected block. */
  firstLink(): HTMLElement | null {
    return this.list.querySelector('a');
  }

  update(node: PMNode): boolean {
    if (!isPageContents(node)) return false;
    this.node = node;
    this.marks();
    this.refresh();
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.list.contains(event.target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    shown.get(this.view)?.delete(this);
    this.list.removeEventListener('mousedown', this.press);
    this.list.removeEventListener('click', this.follow);
    this.list.removeEventListener('keydown', this.keys);
  }
}

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
      drawn?.firstLink()?.focus();
      return true;
    }
    case 'Backspace':
    case 'Delete':
      if (!view.editable) return false;
      {
        // In Suggesting mode a whole block can't be taken out yet (the page says so): the block stays, so say nothing.
        const before = view.state.doc;
        view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
        if (!view.state.doc.eq(before)) announce(CONTENTS_DELETED);
      }
      return true;
    default:
      return false;
  }
}

/**
 * Keeps tables of contents whole: a caret landing in one selects it, arrows onto one from the text beside select it,
 * Enter reaches its links, and deleting it says so. Every edit draws them again.
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
    view() {
      return {
        update(view, previous) {
          if (!previous.doc.eq(view.state.doc)) for (const item of shown.get(view) ?? []) item.refresh();
          const now = selectedContents(view.state);
          if (now && selectedContents(previous)?.node !== now.node) announce(CONTENTS_SELECTED);
        },
      };
    },
  });
}
