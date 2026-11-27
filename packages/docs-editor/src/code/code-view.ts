/**
 * A code block drawn with its bar (language, source toggle, copy) and, for a live language, its rendering above the
 * source. The source shows while the block is being edited, while it is empty, or when its toggle is on.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { Decoration, EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { CodeBar } from './CodeBar.tsx';
import { isPageContents } from './contents.ts';
import { highlightOf } from './highlight-plugin.ts';
import { type LiveKind, liveKind } from './languages.ts';
import { EMPTY_TEXT, LOADING_TEXT, type LiveResult, renderLater, renderNow } from './live.ts';
import { setSourceOpen, sourceOpen, useCodeBlocks } from './store.ts';

/** Typing pauses this long before a formula or diagram is drawn again. */
const RENDER_DELAY = 250;

let unsaved = 0;

const isActive = (decorations: readonly Decoration[]) => decorations.some(decoration => (decoration.spec as { codeActive?: boolean }).codeActive === true);

export class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly bar: HTMLElement;
  private readonly pane: HTMLElement;
  private readonly output: HTMLElement;
  private readonly status: HTMLElement;
  private readonly root: Root;
  private readonly localKey = `unsaved-${++unsaved}`;
  private readonly unsubscribe: () => void;
  private active: boolean;
  private renderedKey: string | null = null;
  private hasRender = false;
  private version = 0;
  private timer = 0;
  private destroyed = false;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[]) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.active = isActive(decorations);

    this.dom = document.createElement('div');
    this.dom.className = 'code-block';
    this.bar = document.createElement('div');
    this.bar.className = 'code-block-bar';
    this.bar.contentEditable = 'false';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Code block actions');
    this.pane = document.createElement('div');
    this.pane.className = 'code-block-render';
    this.pane.contentEditable = 'false';
    this.output = document.createElement('div');
    this.output.className = 'code-block-output';
    this.status = document.createElement('div');
    this.status.className = 'code-block-status';
    this.status.setAttribute('role', 'status');
    this.pane.append(this.output, this.status);
    const pre = document.createElement('pre');
    this.contentDOM = document.createElement('code');
    pre.append(this.contentDOM);
    this.dom.append(this.bar, this.pane, pre);

    this.pane.addEventListener('mousedown', this.editFromRender);
    this.root = createRoot(this.bar);
    let open = sourceOpen(this.key);
    this.unsubscribe = useCodeBlocks.subscribe(state => {
      const now = state.sourceOpen[this.key] === true;
      if (now === open) return;
      open = now;
      this.draw();
    });
    this.draw();
  }

  private get key(): string {
    return (this.node.attrs.bid as string | null) ?? this.localKey;
  }

  private get kind(): LiveKind | null {
    return liveKind(this.node.attrs.language as string | null);
  }

  private get empty(): boolean {
    return this.node.textContent.trim() === '';
  }

  /** The selection is in the block and the reader can type there. */
  private get editing(): boolean {
    return this.active && this.view.editable;
  }

  private get sourceShown(): boolean {
    return !this.kind || this.empty || this.editing || sourceOpen(this.key);
  }

  private draw(): void {
    const { node, dom } = this;
    const set = (name: string, value: string | null | undefined) => (value ? dom.setAttribute(name, value) : dom.removeAttribute(name));
    set('data-bid', node.attrs.bid as string | null);
    set('data-suggest-id', node.attrs.suggestId as string | null);
    set('data-suggest-op', node.attrs.suggestId ? ((node.attrs.suggestOp as string | null) ?? 'ins') : null);
    set('data-language', node.attrs.language as string | null);
    const kind = this.kind;
    set('data-live', kind);
    dom.toggleAttribute('data-source-hidden', !this.sourceShown);
    this.pane.hidden = kind === null;
    if (kind) this.drawLive(kind);
    else this.renderedKey = null;
    this.root.render(
      createElement(CodeBar, {
        view: this.view,
        getPos: this.getPos,
        language: (node.attrs.language as string | null) ?? null,
        detected: highlightOf(node)?.detected ?? null,
        live: kind,
        sourceShown: this.sourceShown,
        sourceLocked: this.empty || this.editing,
        onToggleSource: () => setSourceOpen(this.key, !sourceOpen(this.key)),
        text: () => this.node.textContent,
      }),
    );
  }

  private drawLive(kind: LiveKind): void {
    const source = this.node.textContent;
    const key = `${kind}\u0000${source}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    const version = ++this.version;
    window.clearTimeout(this.timer);
    if (!source.trim()) {
      this.hasRender = false;
      this.showNote(EMPTY_TEXT[kind], 'empty');
      return;
    }
    if (kind === 'csv' || kind === 'markdown') {
      this.show(renderNow(kind, source), kind);
      return;
    }
    if (!this.hasRender) this.showNote(LOADING_TEXT[kind] ?? '', 'loading');
    this.timer = window.setTimeout(
      () => {
        void renderLater(kind, source).then(result => {
          if (!this.destroyed && version === this.version) this.show(result, kind);
        });
      },
      this.hasRender ? RENDER_DELAY : 0,
    );
  }

  private showNote(text: string, state: 'empty' | 'loading'): void {
    this.output.replaceChildren();
    this.output.removeAttribute('data-stale');
    this.status.textContent = text;
    this.status.dataset.state = state;
    this.status.hidden = false;
  }

  /** Shows a rendering; on an error, keeps the last good one, marked stale, under the message. */
  private show(result: LiveResult, kind: LiveKind): void {
    if (result.ok && result.html) {
      this.output.innerHTML = result.html;
      this.output.removeAttribute('data-stale');
      this.status.hidden = true;
      this.status.textContent = '';
      delete this.status.dataset.state;
      this.hasRender = true;
      return;
    }
    if (result.ok) {
      this.hasRender = false;
      this.showNote(EMPTY_TEXT[kind], 'empty');
      return;
    }
    if (this.hasRender) this.output.setAttribute('data-stale', '');
    else this.output.replaceChildren();
    this.status.textContent = result.message;
    this.status.dataset.state = 'error';
    this.status.hidden = false;
  }

  /** A press on the rendering (not on a link in it) puts the caret in the source, which opens it. */
  private readonly editFromRender = (event: MouseEvent): void => {
    if (!this.view.editable || event.button !== 0 || (event.target instanceof Element && event.target.closest('a'))) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    event.preventDefault();
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1)).scrollIntoView());
    this.view.focus();
  };

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type || isPageContents(node)) return false;
    this.node = node;
    this.active = isActive(decorations);
    this.draw();
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof Node && (this.bar.contains(target) || this.pane.contains(target));
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.timer);
    this.unsubscribe();
    this.pane.removeEventListener('mousedown', this.editFromRender);
    const root = this.root;
    queueMicrotask(() => root.unmount());
  }
}
