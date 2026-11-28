/**
 * The board runtime: renders one artboard inside its iframe and exposes
 * `window.__dc` to the editor. Bundled as the classic script `support.js`.
 */

import * as React from 'react';
import { Component as ReactComponent, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseDcDocument, type DcDocument } from '../document.ts';
import { defaultProps } from '../props.ts';
import { TID_ATTRIBUTE, renderTemplate, type RenderHost } from '../render.ts';
import { parseTemplate, type TemplateModel } from '../template.ts';
import type {
  BoardApi,
  BoardBoot,
  BoardError,
  BoardEvent,
  BoardMode,
  BoardRect,
  BoardSize,
  BorderContext,
  ElementInspection,
  MeasuredBox,
  MeasureThere,
  PickResult,
  ImportTextTargetSpec,
  RepeatedRow,
  TextEditOptions,
  TextFormat,
} from '../protocol.ts';
import { TextEditor, textNodeAt } from './text-edit.ts';
import { guardFocus } from './focus-guard.ts';
import { createLogicBase, evaluateLogic, type DCLogicClass, type TemplateRenderer } from './logic.ts';

/** Deepest chain of nested `<dc-import>`s. */
const MAX_IMPORT_DEPTH = 8;

/** How long the size report waits for an animation frame before it is taken anyway (see `scheduleSize`). */
const SIZE_FALLBACK_MS = 100;

/** Computed properties the inspector reports. */
const INSPECTED = [
  'display', 'position', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap',
  'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'flex-grow', 'flex-shrink', 'flex-basis',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'color',
  'background-color', 'background-image', 'border-top-width', 'border-top-style', 'border-top-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'overflow', 'object-fit', 'top', 'left',
  'right', 'bottom', 'z-index', 'transform', 'rotate', 'scale', 'translate', 'transform-origin', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'box-sizing', 'background-clip', '-webkit-background-clip',
  '-webkit-text-fill-color', 'grid-column', 'grid-row',
  // What Copy properties reads when a style is not written inline.
  'border-right-style', 'border-bottom-style', 'border-left-style', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'filter', 'backdrop-filter',
  'mix-blend-mode', 'background-size', 'background-position', 'background-repeat', 'text-shadow', 'fill', 'stroke',
  'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity',
];

/** Computed properties `measure` reports: placement, the text styles an element inherits, and what a container shows. */
const MEASURED = [
  'position', 'display', 'z-index', 'transform', 'rotate', 'scale', 'translate', 'margin-left', 'margin-top',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
  'text-transform', 'background-color', 'border-style', 'border-color', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
];

const readMeasured = (style: CSSStyleDeclaration): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of MEASURED) out[name] = style.getPropertyValue(name);
  return out;
};

/** True when a computed transform does more than move. */
const turnsOrScales = (style: CSSStyleDeclaration): boolean => {
  if ((style.rotate && style.rotate !== 'none') || (style.scale && style.scale !== 'none')) return true;
  const transform = style.transform;
  if (!transform || transform === 'none') return false;
  const matrix = new DOMMatrixReadOnly(transform);
  return Math.abs(matrix.a - 1) > 1e-6 || Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6 || Math.abs(matrix.d - 1) > 1e-6;
};

/** How far an element's own transform and `translate` move its centre. */
const ownShift = (style: CSSStyleDeclaration): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  if (style.transform && style.transform !== 'none') {
    const matrix = new DOMMatrixReadOnly(style.transform);
    x += matrix.e;
    y += matrix.f;
  }
  if (style.translate && style.translate !== 'none') {
    const [tx = '0', ty = '0'] = style.translate.split(/\s+/);
    x += parseFloat(tx) || 0;
    y += parseFloat(ty) || 0;
  }
  return { x, y };
};

/* -------------------------------------------------------------------------- */
/* Error boundary                                                              */
/* -------------------------------------------------------------------------- */

interface BoundaryProps {
  onError(error: Error): void;
  resetKey: number;
  children: ReactNode;
}

/** Catches render errors so one broken artboard (or child) never blanks the frame. */
class ErrorBoundary extends ReactComponent<BoundaryProps, { failed: boolean; key: number }> {
  override state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromProps(props: BoundaryProps, state: { failed: boolean; key: number }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** The small error panel shown over a broken board. */
function ErrorPanel({ errors }: { errors: BoardError[] }): ReactNode {
  if (!errors.length) return null;
  return (
    <div
      data-dc-errors=""
      style={{
        position: 'fixed', left: 8, right: 8, bottom: 8, zIndex: 2147483647, padding: '8px 10px',
        font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#7f1d1d', background: '#fef2f2',
        border: '1px solid #fca5a5', borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: '40%', overflow: 'auto',
      }}
    >
      {errors.map((error, index) => (
        <div key={index}>
          <strong>{error.source}</strong>: {error.message}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Units: one parsed artboard (the board itself or an imported child)          */
/* -------------------------------------------------------------------------- */

/** A parsed and evaluated artboard. */
interface Unit {
  path: string;
  doc: DcDocument;
  model: TemplateModel;
  Logic: DCLogicClass;
  /** Bumped when the logic class changes: forces a remount. */
  logicVersion: number;
  /** The current template renderer, shared by every unit built on the same logic class. */
  rendererRef: { current: TemplateRenderer };
  defaults: Record<string, unknown>;
  errors: BoardError[];
}

/** Imported child state. */
type ChildEntry =
  | { status: 'loading' }
  | { status: 'ready'; unit: Unit; Component: ComponentType<Record<string, unknown>> }
  | { status: 'error'; message: string };

/** Directory part of a path (`sub/A.dc.html` → `sub/`). */
function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** Normalizes `a/./b/../c` and strips a leading `/`. */
function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/* -------------------------------------------------------------------------- */
/* Board                                                                       */
/* -------------------------------------------------------------------------- */

class Board implements BoardApi {
  private unit: Unit | null = null;
  private overrides: Record<string, unknown>;
  private mode: BoardMode;
  private root: Root;
  private renderErrors: BoardError[] = [];
  private renderVersion = 0;
  /** Bumped by `restart()`: part of the logic's key, so a restart mounts it fresh. */
  private run = 0;
  private children = new Map<string, ChildEntry>();
  private lastSize: BoardSize = { width: 0, height: 0 };
  private booted = false;
  private readonly text = new TextEditor((event) => this.report(event));
  private previews = new Map<number, { element: HTMLElement; style: string | null }[]>();

  constructor(private readonly boot: BoardBoot) {
    this.overrides = { ...(boot.props ?? {}) };
    this.mode = boot.mode;
    const container = document.createElement('div');
    container.setAttribute('data-dc-root', '');
    container.style.display = 'contents';
    document.body.appendChild(container);
    this.root = createRoot(container, {
      onUncaughtError: (error) => this.addRenderError('render', error),
    });
    this.installEvents();
    this.setSource(boot.source);
  }

  /* ---------------------------- units ---------------------------- */

  /** Parses a source into a unit, reusing the previous logic class when the script is unchanged. */
  private buildUnit(path: string, source: string, previous: Unit | null, depth: number): Unit {
    const doc = parseDcDocument(source);
    const errors: BoardError[] = [];
    if (!doc.template) errors.push({ source: 'template', message: 'No <x-dc> template found.' });
    if (doc.propsError) errors.push({ source: 'props', message: doc.propsError });

    const scriptChanged = !previous || previous.doc.script?.body.text !== doc.script?.body.text;
    // The logic class reads its renderer through this holder, so a template-only
    // change swaps the renderer under the same class (and keeps state).
    const rendererRef = scriptChanged ? { current: (() => null) as TemplateRenderer } : previous.rendererRef;
    const unit: Unit = {
      path,
      doc,
      model: parseTemplate(doc.template?.text ?? ''),
      Logic: previous?.Logic as DCLogicClass,
      logicVersion: previous?.logicVersion ?? 0,
      rendererRef,
      defaults: defaultProps(doc.props),
      errors,
    };
    rendererRef.current = (values) => renderTemplate(unit.model, values, this.host(unit, depth));

    if (scriptChanged) {
      const Base = createLogicBase(() => rendererRef.current);
      try {
        unit.Logic = doc.script ? evaluateLogic(doc.script.body.text, Base, React, path) : Base;
      } catch (error) {
        errors.push({ source: 'script', message: error instanceof Error ? error.message : String(error) });
        unit.Logic = Base;
      }
      unit.logicVersion = (previous?.logicVersion ?? 0) + 1;
    }
    return unit;
  }

  /** The render host of a unit (the board stamps tids; children do not). */
  private host(unit: Unit, depth: number): RenderHost {
    return {
      head: document.head,
      stamp: depth === 0,
      streaming: false,
      importComponent: (name) => this.importComponent(unit, name, depth),
      globalComponent: (path) => {
        let value: unknown = window;
        for (const key of path.split('.')) value = value == null ? undefined : (value as Record<string, unknown>)[key];
        return typeof value === 'function' || (value && typeof value === 'object') ? (value as ComponentType<Record<string, unknown>>) : null;
      },
    };
  }

  /** Resolves `<dc-import name>` to a component, loading the sibling file on first use. */
  private importComponent(parent: Unit, name: string, depth: number): ComponentType<Record<string, unknown>> | null | undefined {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)) {
      this.noteChildError(`dc-import name "${name}" is not a file name.`);
      return null;
    }
    const path = normalizePath(`${dirOf(parent.path)}${name}.dc.html`);
    if (depth + 1 > MAX_IMPORT_DEPTH || path === this.unit?.path) {
      this.noteChildError(`dc-import "${name}" nests too deep (or imports itself).`);
      return null;
    }
    const entry = this.children.get(path);
    if (entry?.status === 'ready') return entry.Component;
    if (entry?.status === 'error') return null;
    if (!entry) {
      this.children.set(path, { status: 'loading' });
      this.boot
        .load(path)
        .then((source) => {
          const unit = this.buildUnit(path, source, null, depth + 1);
          const Component = (props: Record<string, unknown>): ReactNode => (
            <ErrorBoundary resetKey={unit.logicVersion} onError={(error) => this.addRenderError('import', error, name)}>
              {React.createElement(unit.Logic, { ...unit.defaults, ...props })}
            </ErrorBoundary>
          );
          Component.displayName = `Import(${name})`;
          this.children.set(path, { status: 'ready', unit, Component });
          for (const error of unit.errors) this.addError({ source: 'import', message: `${name}: ${error.message}` });
        })
        .catch((error: unknown) => {
          this.children.set(path, { status: 'error', message: String(error) });
          this.addError({ source: 'import', message: `${name}: could not load ${path}` });
        })
        .finally(() => this.render());
    }
    return undefined;
  }

  private noteChildError(message: string): void {
    queueMicrotask(() => this.addError({ source: 'import', message }));
  }

  /* --------------------------- rendering -------------------------- */

  private render(): void {
    const unit = this.unit;
    if (!unit) return;
    const errors = [...unit.errors, ...this.renderErrors];
    this.root.render(
      <>
        <ErrorBoundary resetKey={this.renderVersion} onError={(error) => this.addRenderError('render', error)}>
          {React.createElement(unit.Logic, { key: `${unit.logicVersion}:${this.run}`, ...unit.defaults, ...this.overrides })}
        </ErrorBoundary>
        <ErrorPanel errors={errors} />
      </>,
    );
  }

  private addRenderError(source: BoardError['source'], error: unknown, prefix?: string): void {
    const message = error instanceof Error ? error.message : String(error);
    this.addError({ source, message: prefix ? `${prefix}: ${message}` : message });
  }

  private addError(error: BoardError): void {
    if (this.renderErrors.some((e) => e.source === error.source && e.message === error.message)) return;
    this.renderErrors = [...this.renderErrors, error];
    this.report({ type: 'errors', errors: this.errors() });
    this.render();
  }

  private report(event: BoardEvent): void {
    try {
      this.boot.report(event);
    } catch {
      /* The editor went away; nothing to do. */
    }
  }

  /* ------------------------------ api ------------------------------ */

  setSource(source: string): void {
    this.endTextEdit(false);
    this.unit = this.buildUnit(this.boot.path, source, this.unit, 0);
    this.renderErrors = [];
    this.renderVersion++;
    this.render();
    this.report({ type: 'errors', errors: this.errors() });
    this.scheduleSize();
  }

  invalidate(paths: readonly string[]): void {
    let changed = false;
    for (const path of paths) changed = this.children.delete(normalizePath(path)) || changed;
    if (changed) {
      this.renderErrors = this.renderErrors.filter((error) => error.source !== 'import');
      this.render();
    }
  }

  setProps(props: Record<string, unknown>): void {
    this.overrides = { ...props };
    this.render();
  }

  setMode(mode: BoardMode): void {
    this.mode = mode;
    if (mode !== 'edit') this.endTextEdit(true);
  }

  restart(): void {
    this.endTextEdit(false);
    this.run++;
    // Like a new source: a run that crashed gets another go.
    this.renderErrors = [];
    this.renderVersion++;
    this.render();
    window.scrollTo(0, 0);
    this.report({ type: 'errors', errors: this.errors() });
    this.scheduleSize();
  }

  errors(): BoardError[] {
    return [...(this.unit?.errors ?? []), ...this.renderErrors];
  }

  size(): BoardSize {
    const doc = document.documentElement;
    return { width: Math.ceil(doc.scrollWidth), height: Math.ceil(doc.scrollHeight) };
  }

  /** Instances of a template node in document order. */
  private instances(tid: number): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(`[${TID_ATTRIBUTE}="${tid}"]`));
  }

  /**
   * The stamped element owning a DOM node: the nearest one up. What a
   * component draws itself carries no tid, so it resolves to the import's
   * boundary; markup written between an `<x-import>`'s tags is this board's
   * template and stays selectable on its own (a provider wrapping the whole
   * artboard must not swallow it). A `<dc-import>`'s board is rendered
   * unstamped, so it resolves to the import as a whole.
   */
  private owner(node: Element | null): HTMLElement | null {
    return node?.closest<HTMLElement>(`[${TID_ATTRIBUTE}]`) ?? null;
  }

  private rectOf(element: Element): BoardRect {
    if (getComputedStyle(element).display === 'contents') {
      const rects = Array.from(element.children).map((child) => this.rectOf(child)).filter((r) => r.width || r.height);
      if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
      const left = Math.min(...rects.map((r) => r.x));
      const top = Math.min(...rects.map((r) => r.y));
      const right = Math.max(...rects.map((r) => r.x + r.width));
      const bottom = Math.max(...rects.map((r) => r.y + r.height));
      return { x: left, y: top, width: right - left, height: bottom - top };
    }
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  private toPick(element: HTMLElement): PickResult {
    const tid = Number(element.getAttribute(TID_ATTRIBUTE));
    return { tid, rect: this.rectOf(element), instance: Math.max(0, this.instances(tid).indexOf(element)) };
  }

  pick(x: number, y: number): PickResult | null {
    const element = this.owner(document.elementFromPoint(x, y));
    return element ? this.toPick(element) : null;
  }

  pickAll(x: number, y: number, skip?: readonly number[]): PickResult[] {
    const out: PickResult[] = [];
    let start = this.owner(document.elementFromPoint(x, y));
    if (skip?.length) {
      const skipped = new Set(skip);
      start = null;
      for (const hit of document.elementsFromPoint(x, y)) {
        const owner = this.owner(hit);
        if (owner && !skipped.has(Number(owner.getAttribute(TID_ATTRIBUTE)))) {
          start = owner;
          break;
        }
      }
    }
    for (let element = start; element; element = this.owner(element.parentElement)) {
      out.push(this.toPick(element));
    }
    return out;
  }

  rects(tids: readonly number[]): Record<number, BoardRect[]> {
    const out: Record<number, BoardRect[]> = {};
    for (const tid of tids) out[tid] = this.instances(tid).map((element) => this.rectOf(element));
    return out;
  }

  repeatedRows(tid: number, instance: number): RepeatedRow[] {
    const rows: RepeatedRow[] = [];
    for (let element: HTMLElement | null = this.instances(tid)[instance] ?? null; element; element = element.parentElement?.closest<HTMLElement>(`[${TID_ATTRIBUTE}]`) ?? null) {
      const own = element.getAttribute(TID_ATTRIBUTE);
      const parent = element.parentElement;
      if (!parent || own === null) continue;
      const copies = Array.from(parent.children).filter((child) => child.getAttribute(TID_ATTRIBUTE) === own);
      if (copies.length < 2) continue;
      const text = (element.innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      rows.unshift({ tid: Number(own), at: copies.indexOf(element) + 1, of: Math.min(copies.length, 9999), text });
    }
    return rows;
  }

  importValues(name: string, props: Record<string, unknown>): Record<string, unknown> | null {
    const parent = this.unit;
    if (!parent) return null;
    const entry = this.children.get(normalizePath(`${dirOf(parent.path)}${name}.dc.html`));
    if (entry?.status !== 'ready') return null;
    try {
      const instance = new entry.unit.Logic({ ...entry.unit.defaults, ...props });
      const values = instance.renderVals();
      return values && typeof values === 'object' ? { ...values } : null;
    } catch {
      return null;
    }
  }

  inspect(tid: number): ElementInspection | null {
    const element = this.instances(tid)[0];
    if (!element) return null;
    const style = getComputedStyle(element);
    const computed: Record<string, string> = {};
    for (const name of INSPECTED) computed[name] = style.getPropertyValue(name);
    return {
      tid,
      tag: element.tagName.toLowerCase(),
      rect: this.rectOf(element),
      computed,
      parentDisplay: element.parentElement ? getComputedStyle(element.parentElement).display : 'block',
      text: (element.innerText ?? '').slice(0, 200),
    };
  }

  borderContext(tid: number): BorderContext | null {
    const element = this.instances(tid)[0];
    if (!element) return null;
    // Measured still: no transform on the box, no transition anywhere.
    const calm = document.createElement('style');
    calm.textContent = '*, *::before, *::after { transition: none !important; animation-play-state: paused !important; }';
    document.head.append(calm);
    const inline = element.getAttribute('style');
    element.style.setProperty('transform', 'none', 'important');
    try {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const width = (side: string) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0;
      const inner = { top: rect.top + width('top'), right: rect.right - width('right'), bottom: rect.bottom - width('bottom'), left: rect.left + width('left') };
      const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
      const pinned = { top: false, right: false, bottom: false, left: false };
      const sides = ['top', 'right', 'bottom', 'left'] as const;
      if (/\binset\b/.test(style.boxShadow)) for (const side of sides) pinned[side] = true;
      for (const pseudo of ['::before', '::after']) {
        const part = getComputedStyle(element, pseudo);
        if (part.content === 'none' || part.content === 'normal' || part.position !== 'absolute') continue;
        if (part.backgroundImage === 'none' && alphaOf(part.backgroundColor) <= 0.02) continue;
        for (const side of sides) {
          const inset = Number.parseFloat(part.getPropertyValue(side));
          if (Number.isFinite(inset) && inset < 0.5 && (inset > -0.5 || clips)) pinned[side] = true;
        }
      }
      let seen = 0;
      for (const child of element.querySelectorAll<Element>('*')) {
        if (sides.every((side) => pinned[side])) break;
        if (child.closest('svg') && child.tagName.toLowerCase() !== 'svg') continue;
        if (++seen > 400) break;
        if (!paints(child)) continue;
        const box = child.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        const gap = { top: box.top - inner.top, right: inner.right - box.right, bottom: inner.bottom - box.bottom, left: box.left - inner.left };
        for (const side of sides) if (gap[side] <= 0.5 && (gap[side] >= -0.5 || clips)) pinned[side] = true;
      }
      // What the classes give without the inline style.
      element.setAttribute('style', 'transform: none !important');
      const bare = getComputedStyle(element);
      const classBorder = sides.some((side) => !/^(none|hidden)$/.test(bare.getPropertyValue(`border-${side}-style`)) && Number.parseFloat(bare.getPropertyValue(`border-${side}-width`)) > 0);
      const classOutline = { width: bare.outlineWidth, style: bare.outlineStyle, color: bare.outlineColor, offset: bare.outlineOffset };
      return { pinned, classBorder, classOutline, focusStyled: focusStyled(element) };
    } finally {
      if (inline === null) element.removeAttribute('style');
      else element.setAttribute('style', inline);
      calm.remove();
    }
  }

  /**
   * What an element would compute placed in `there`: a bare copy of it (no
   * children but a word, no template id, no transitions) is put there,
   * read and taken out again before anything renders.
   */
  private computedThere(element: HTMLElement, there: MeasureThere): Record<string, string> | null {
    const parent = there.parent === null ? document.querySelector<HTMLElement>('[data-dc-root]') : (this.instances(there.parent)[0] ?? null);
    if (!parent) return null;
    const copy = element.cloneNode(false) as HTMLElement;
    copy.removeAttribute(TID_ATTRIBUTE);
    if (element.firstChild) copy.appendChild(document.createTextNode('x'));
    copy.style?.setProperty('transition', 'none', 'important');
    copy.style?.setProperty('animation', 'none', 'important');
    let placed: HTMLElement = copy;
    if (there.wrap) {
      placed = document.createElement('div');
      placed.appendChild(copy);
    }
    try {
      parent.appendChild(placed);
      return readMeasured(getComputedStyle(copy));
    } finally {
      placed.remove();
    }
  }

  measure(tids: readonly number[], within: number | null, there?: MeasureThere): MeasuredBox[] | null {
    // The artboard's root is the page: positions count from the document's corner.
    const container = within === null ? null : (this.instances(within)[0] ?? null);
    if (within !== null && !container) return null;
    let originX = -window.scrollX;
    let originY = -window.scrollY;
    if (container) {
      const frame = container.getBoundingClientRect();
      const frameStyle = getComputedStyle(container);
      originX = frame.left + parseFloat(frameStyle.borderLeftWidth || '0') - container.scrollLeft;
      originY = frame.top + parseFloat(frameStyle.borderTopWidth || '0') - container.scrollTop;
    }
    const out: MeasuredBox[] = [];
    for (const tid of tids) {
      const element = this.instances(tid)[0];
      if (!element) return null;
      const style = getComputedStyle(element);
      const computed = readMeasured(style);
      let transformed = false;
      for (let up = element.parentElement; up && up !== container; up = up.parentElement) if (turnsOrScales(getComputedStyle(up))) transformed = true;
      // The box before its own transform: its layout size around the centre a
      // turn or scale keeps, less what the transform moves it by.
      const rect = this.rectOf(element);
      const layout = style.display !== 'contents';
      const width = layout ? element.offsetWidth : rect.width;
      const height = layout ? element.offsetHeight : rect.height;
      const shift = ownShift(style);
      const left = rect.x + rect.width / 2 - width / 2 - shift.x - originX;
      const top = rect.y + rect.height / 2 - height / 2 - shift.y - originY;
      const box: MeasuredBox = { tid, left, top, width, height, computed, transformed };
      if (there) {
        const placed = this.computedThere(element, there);
        if (placed) box.there = placed;
      }
      out.push(box);
    }
    return out;
  }

  editText(tid: number, instance = 0, options?: TextEditOptions): boolean {
    this.text.end(true);
    const element = this.instances(tid)[instance];
    return element ? this.text.start(element, tid, options) : false;
  }

  editImportText(tid: number, instance: number, x: number, y: number, targets: ImportTextTargetSpec[]): boolean {
    this.text.end(true);
    // A component's words are editable only when it is placed once.
    const mounts = this.instances(tid);
    const mount = mounts[instance];
    return mounts.length === 1 && mount ? this.text.startImport(mount, tid, x, y, targets) : false;
  }

  wordsAt(tid: number, instance: number, x: number, y: number): string | null {
    const mount = this.instances(tid)[instance];
    const node = textNodeAt(x, y);
    if (!mount || !node || !mount.contains(node)) return null;
    return (node.nodeValue ?? '').replace(/[ \t\n\r\f]+/g, ' ').trim() || null;
  }

  endTextEdit(commit: boolean): void {
    this.text.end(commit);
  }

  formatText(format: TextFormat): void {
    this.text.format(format);
  }

  applyLink(href: string | null): void {
    this.text.applyLink(href);
  }

  cancelLinkEdit(): void {
    this.text.cancelLinkEdit();
  }

  preview(tid: number, style: Record<string, string> | null): void {
    const previous = this.previews.get(tid);
    if (previous) {
      for (const { element, style: original } of previous) {
        if (original === null) element.removeAttribute('style');
        else element.setAttribute('style', original);
      }
      this.previews.delete(tid);
    }
    if (!style) return;
    const elements = this.instances(tid);
    this.previews.set(tid, elements.map((element) => ({ element, style: element.getAttribute('style') })));
    for (const element of elements) for (const [name, value] of Object.entries(style)) element.style.setProperty(name, value);
  }

  /* ----------------------------- events ----------------------------- */

  private scheduled = false;
  /**
   * Measures on the next animation frame, or after `SIZE_FALLBACK_MS` when
   * none comes: a frame the browser does not render gets no animation
   * frames (Chrome pauses hidden iframes that are cross-origin to the top
   * page, and the editor keeps a canvas frame hidden until it reports
   * 'booted'), and the report must not wait for it to be shown.
   */
  private scheduleSize(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const run = (): void => {
      if (!this.scheduled) return;
      this.scheduled = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      const size = this.size();
      if (!this.booted) {
        this.booted = true;
        this.lastSize = size;
        this.report({ type: 'booted', size });
        return;
      }
      if (size.width !== this.lastSize.width || size.height !== this.lastSize.height) {
        this.lastSize = size;
        this.report({ type: 'resized', size });
      }
    };
    const frame = requestAnimationFrame(run);
    const timer = setTimeout(run, SIZE_FALLBACK_MS);
  }

  private installEvents(): void {
    new ResizeObserver(() => this.scheduleSize()).observe(document.documentElement);
    window.addEventListener('error', (event) => this.addError({ source: 'runtime', message: event.message }));
    window.addEventListener('unhandledrejection', (event) => this.addError({ source: 'runtime', message: String(event.reason) }));

    document.addEventListener(
      'click',
      (event) => {
        const anchor = (event.target as Element | null)?.closest?.('a[href]');
        if (!anchor || this.text.active) return;
        const href = anchor.getAttribute('href') ?? '';
        if (this.mode !== 'play') {
          event.preventDefault();
          return;
        }
        if (href.startsWith('#')) {
          event.preventDefault();
          document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' });
        } else if (/^https?:\/\//i.test(href)) {
          event.preventDefault();
          window.open(href, '_blank', 'noopener,noreferrer');
        } else if (/\.dc\.html(#.*)?$/i.test(href)) {
          event.preventDefault();
          const target = href.replace(/#.*$/, '');
          const path = target.startsWith('/') ? normalizePath(target) : normalizePath(dirOf(this.boot.path) + target);
          this.report({ type: 'navigate', path });
        } else {
          event.preventDefault();
        }
      },
      true,
    );

    document.addEventListener(
      'keydown',
      (event) => {
        const forward = () => {
          event.preventDefault();
          this.report({ type: 'key', key: event.key, code: event.code, meta: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey, repeat: event.repeat, ctrl: event.ctrlKey && !event.metaKey });
        };
        // Save (⌘S / Ctrl+S) and F6 (move between the editor's regions) always go to the editor.
        const save = (event.metaKey || event.ctrlKey) && !event.altKey && (event.code === 'KeyS' || event.key.toLowerCase() === 's');
        const always = save || event.key === 'F6';
        if (this.text.active) {
          if (always) {
            event.stopPropagation();
            forward();
          } else if (this.text.keydown(event)) event.stopPropagation();
          return;
        }
        if (always) {
          forward();
          return;
        }
        if (this.mode !== 'edit' && event.key !== 'Escape') return;
        const target = event.target as HTMLElement | null;
        if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        forward();
      },
      true,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

/** Boot config when the page runs on its own: fetch our own source, siblings by URL. */
async function standaloneBoot(): Promise<BoardBoot> {
  const embedded = window.__dcExport;
  if (embedded) return {
    path: embedded.path, source: embedded.source, mode: 'play',
    load: async target => {
      if (Object.hasOwn(embedded.files, target)) return embedded.files[target]!;
      throw new Error(`Missing from export: ${target}`);
    },
    report: event => { if (window.parent !== window && event.type === 'navigate') window.parent.postMessage({ __dc: event }, '*'); },
  };
  const source = await fetch(location.href).then((response) => response.text());
  // Keep the served folder in the path. A sibling link or import can climb out
  // of a nested board folder, including when the ZIP is served under a prefix.
  const path = decodeURIComponent(location.pathname.slice(1));
  const urlOf = (target: string) => new URL('/' + target.split('/').map(encodeURIComponent).join('/'), location.href);
  return {
    path,
    source,
    mode: 'play',
    load: (target) => fetch(urlOf(target)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    report: event => {
      if (event.type === 'navigate') location.assign(urlOf(event.path).href);
      else if (window.parent !== window) window.parent.postMessage({ __dc: event }, '*');
    },
  };
}

/** Starts the runtime: hides the raw template, waits for the DOM, then renders. */
export function startBoardRuntime(): void {
  if (window.__dc) return;
  guardFocus();
  const hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}';
  (document.head ?? document.documentElement).appendChild(hide);

  const run = async (): Promise<void> => {
    let boot: BoardBoot | undefined;
    try {
      boot = (window.frameElement as HTMLIFrameElement | null)?.__dcBoot;
    } catch {
      boot = undefined;
    }
    boot ??= await standaloneBoot();
    // The browser parsed the template as DOM; it is not the board.
    document.querySelectorAll('x-dc, script[data-dc-script]').forEach((node) => node.remove());
    const board = new Board(boot);
    Object.defineProperty(window, '__dc', { value: board, configurable: false, writable: false });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void run(), { once: true });
  else void run();
}

/** The alpha of a computed color (`rgb()` / `rgba()`), 1 when it can't be read. */
function alphaOf(color: string): number {
  if (color === 'transparent') return 0;
  const match = /rgba?\(([^)]*)\)/.exec(color);
  if (!match) return 1;
  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean);
  return parts.length > 3 ? Number.parseFloat(parts[3]!) * (parts[3]!.endsWith('%') ? 0.01 : 1) : 1;
}

const REPLACED_TAGS = new Set(['img', 'video', 'canvas', 'svg', 'iframe', 'embed', 'object', 'input', 'select', 'textarea', 'button', 'progress', 'meter']);

/** Whether an element paints anything itself: a background, a border, words, or replaced content. */
function paints(element: Element): boolean {
  const style = getComputedStyle(element);
  if (style.visibility !== 'visible' || Number.parseFloat(style.opacity) === 0 || style.display === 'none') return false;
  if (REPLACED_TAGS.has(element.tagName.toLowerCase())) return true;
  if (style.backgroundImage !== 'none' || alphaOf(style.backgroundColor) > 0) return true;
  if (['top', 'right', 'bottom', 'left'].some((side) => !/^(none|hidden)$/.test(style.getPropertyValue(`border-${side}-style`)) && Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0)) return true;
  if (style.boxShadow !== 'none') return true;
  return [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
}

/** Whether a stylesheet rule styles this element's keyboard focus (the editor's own state rules aside). */
function focusStyled(element: Element): boolean {
  const visit = (rules: CSSRuleList): boolean => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.includes('data-dc-state')) continue;
        for (const selector of rule.selectorText.split(',')) {
          if (!/:focus/.test(selector)) continue;
          const bare = selector.replace(/:focus(-visible|-within)?/g, '').trim() || '*';
          try {
            if (element.matches(bare)) return true;
          } catch {
            /* a selector the browser can't match here */
          }
        }
      } else if ('cssRules' in rule && visit((rule as CSSGroupingRule).cssRules)) return true;
    }
    return false;
  };
  for (const sheet of document.styleSheets) {
    try {
      if (visit(sheet.cssRules)) return true;
    } catch {
      /* a sheet from elsewhere can't be read */
    }
  }
  return false;
}
