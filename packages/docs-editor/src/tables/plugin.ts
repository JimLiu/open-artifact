/**
 * Draws cell colours and fits tables to the page ({@link fitTable}), keeps a table's columns while the caret is in it,
 * marks a table cut off on its left or right, opens the cell menu on a right-click or the Menu key inside a table, and on
 * Mod-Y, with nothing to redo, inserts again the row or column last inserted.
 */
import { announce } from '@open-artifact/editor-kit';
import { redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from 'prosemirror-state';
import { CellSelection, TableMap, cellAround, columnResizingPluginKey } from 'prosemirror-tables';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { type DrawnCell, type PageSide, fitTable, measureColumns, tableLead, tableRoom } from './fit.ts';
import { caretIn, cellSelectionHas, refOf, repeatTableInsert, selectionCell, targetOf } from './table-menu.ts';
import { isHexColor } from './table-ops.ts';
import { openContextMenu, pagePoint } from './store.ts';

/** The widths a table's columns keep while the caret is in it. */
interface Lock {
  pos: number;
  widths: number[];
}

interface TableState {
  lock: Lock | null;
  decorations: DecorationSet;
}

const key = new PluginKey<TableState>('tableCells');

/** Cell colours, how each table fits the page, and the widths of the one the caret keeps. */
function tableDecorations(doc: PMNode, lock: Lock | null): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.tableRole !== 'table') return !node.isTextblock;
    const locked = lock?.pos === pos ? lock.widths : null;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, locked ? { 'data-fit-lock': 'cursor' } : { 'data-fit': '' }));
    const fits = new Map(fitTable(node).map(cell => [cell.offset, cell]));
    const map = TableMap.get(node);
    const seen = new Set<number>();
    for (const offset of map.map) {
      if (seen.has(offset)) continue;
      seen.add(offset);
      const cell = node.nodeAt(offset);
      if (!cell) continue;
      const fit = fits.get(offset);
      const color: unknown = cell.attrs.background;
      const { left, right } = map.findCell(offset);
      const width = locked ? locked.slice(left, right).reduce((sum, each) => sum + each, 0) : 0;
      const style = [isHexColor(color) ? `--cell-bg: ${color.toLowerCase()}` : '', fit?.style ?? '', width ? `--fit-lock: ${Math.round(width * 1000) / 1000}px` : '']
        .filter(Boolean)
        .join('; ');
      const attrs = { ...(style ? { style } : {}), ...(fit?.wrap ? { 'data-fit-cell': fit.wrap } : {}) };
      const at = pos + 1 + offset;
      if (Object.keys(attrs).length) decorations.push(Decoration.node(at, at + cell.nodeSize, attrs));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** The lock after a change: moved with its table, and let go when the table is gone or its columns changed. */
function mapLock(lock: Lock | null, tr: Transaction): Lock | null {
  if (!lock || !tr.docChanged) return lock;
  const mapped = tr.mapping.mapResult(lock.pos, 1);
  const table = mapped.deleted ? null : tr.doc.nodeAt(mapped.pos);
  if (table?.type.spec.tableRole !== 'table' || TableMap.get(table).width !== lock.widths.length) return null;
  return mapped.pos === lock.pos ? lock : { ...lock, pos: mapped.pos };
}

/** The outermost table around the caret, if any. */
function caretTable(state: EditorState): { pos: number; node: PMNode } | null {
  const { $head } = state.selection;
  for (let depth = 1; depth <= $head.depth; depth++) {
    const node = $head.node(depth);
    if (node.type.spec.tableRole === 'table') return { pos: $head.before(depth), node };
  }
  return null;
}

/** The width a table's wrapper leaves for it. */
function roomOf(wrapper: HTMLElement): number {
  const style = getComputedStyle(wrapper);
  return wrapper.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
}

/** The wrapper of a table the editor draws, and the table in it. */
function tableDOM(view: EditorView, pos: number): { wrapper: HTMLElement; table: HTMLElement } | null {
  const wrapper = view.nodeDOM(pos);
  if (!(wrapper instanceof HTMLElement) || !wrapper.classList.contains('tableWrapper')) return null;
  const table = wrapper.querySelector<HTMLElement>(':scope > table');
  return table ? { wrapper, table } : null;
}

/** The cell under a right-click, with the caret moved into it unless the selection already holds it. */
function cellAtPointer(view: EditorView, event: MouseEvent): number | null {
  const element = event.target instanceof Element ? event.target.closest('td, th') : null;
  if (!element || !view.dom.contains(element)) return null;
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!hit) return null;
  const $cell = cellAround(view.state.doc.resolve(hit.pos));
  if (!$cell || !targetOf(view.state, $cell.pos)) return null;
  const { selection } = view.state;
  const holds =
    selection instanceof CellSelection
      ? cellSelectionHas(view.state, $cell.pos)
      : cellAround(selection.$from)?.pos === $cell.pos && cellAround(selection.$to)?.pos === $cell.pos;
  if (!holds) {
    const $hit = view.state.doc.resolve(hit.pos);
    const inside = cellAround($hit)?.pos === $cell.pos && $hit.parent.inlineContent;
    view.dispatch(inside ? view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.pos)) : caretIn(view.state.tr, $cell.pos));
  }
  return $cell.pos;
}

/**
 * Keeps `--table-room` and `--table-left` on the text's parent: how wide a table of its own may be ({@link tableRoom})
 * and how far left of the text it may be scrolled into ({@link tableLead}).
 */
function roomTracker(view: EditorView): () => void {
  const scroller = view.dom.closest<HTMLElement>('[data-doc-scroll]');
  const holder = view.dom.parentElement;
  if (!scroller || !holder || typeof ResizeObserver === 'undefined') return () => {};
  const measure = () => {
    const text = view.dom.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const column = scroller.dataset.marginColumn;
    const side: PageSide = column === 'rail' || column === 'icons' ? column : 'none';
    const room = tableRoom(
      { left: text.left + view.dom.clientLeft, width: view.dom.clientWidth },
      { left: box.left + scroller.clientLeft, contentWidth: scroller.clientWidth, paddingRight: Number.parseFloat(getComputedStyle(scroller).paddingRight) || 0 },
      side,
    );
    const lead = tableLead({ left: text.left + view.dom.clientLeft }, { left: box.left + scroller.clientLeft });
    for (const [name, value] of [['--table-room', `${room}px`], ['--table-left', `${lead}px`]] as const)
      if (holder.style.getPropertyValue(name) !== value) holder.style.setProperty(name, value);
  };
  const resize = new ResizeObserver(measure);
  resize.observe(scroller);
  resize.observe(view.dom);
  const column = new MutationObserver(measure);
  column.observe(scroller, { attributes: true, attributeFilter: ['data-margin-column', 'style'] });
  measure();
  return () => {
    resize.disconnect();
    column.disconnect();
    holder.style.removeProperty('--table-room');
    holder.style.removeProperty('--table-left');
  };
}

/**
 * Marks each table wrapper that hides some of its table: `data-clip` holds `left` when the table is scrolled past the
 * wrapper's left edge and `right` when more of it lies beyond the right; an edge is drawn on each such side.
 */
function clipTracker(view: EditorView): { sync(): void; destroy(): void } {
  if (typeof ResizeObserver === 'undefined') return { sync() {}, destroy() {} };
  const watched = new Set<HTMLElement>();
  const check = (wrapper: HTMLElement) => {
    const table = wrapper.querySelector(':scope > table');
    const left = !!table && wrapper.scrollLeft > 0 && table.getBoundingClientRect().left < wrapper.getBoundingClientRect().left + wrapper.clientLeft - 0.5;
    const right = wrapper.scrollWidth - wrapper.clientWidth - wrapper.scrollLeft > 1;
    const clip = [left ? 'left' : '', right ? 'right' : ''].filter(Boolean).join(' ');
    if (clip !== (wrapper.dataset.clip ?? '')) {
      if (clip) wrapper.dataset.clip = clip;
      else delete wrapper.dataset.clip;
    }
  };
  const onScroll = (event: Event) => check(event.currentTarget as HTMLElement);
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) {
      const wrapper = (entry.target as HTMLElement).closest<HTMLElement>('.tableWrapper');
      if (wrapper && watched.has(wrapper)) check(wrapper);
    }
  });
  const forget = (wrapper: HTMLElement) => {
    wrapper.removeEventListener('scroll', onScroll);
    resize.unobserve(wrapper);
    const table = wrapper.querySelector(':scope > table');
    if (table) resize.unobserve(table);
    watched.delete(wrapper);
  };
  const sync = () => {
    const now = new Set(view.dom.querySelectorAll<HTMLElement>('.tableWrapper'));
    for (const wrapper of watched) if (!now.has(wrapper)) forget(wrapper);
    for (const wrapper of now) {
      if (watched.has(wrapper)) continue;
      watched.add(wrapper);
      wrapper.addEventListener('scroll', onScroll, { passive: true });
      resize.observe(wrapper);
      const table = wrapper.querySelector(':scope > table');
      if (table) resize.observe(table);
      check(wrapper);
    }
  };
  sync();
  return {
    sync,
    destroy() {
      for (const wrapper of [...watched]) forget(wrapper);
      resize.disconnect();
    },
  };
}

/**
 * Keeps a table's columns while the caret is in it and it fills its room, so typing does not move them: they are
 * measured as drawn and held; let go when the caret leaves, a column is dragged, or the room changes (and then
 * measured again).
 */
function lockKeeper(view: EditorView): { update(): void; destroy(): void } {
  let watching: HTMLElement | null = null;
  let watchedWidth = 0;
  const release = () => {
    if (key.getState(view.state)?.lock) view.dispatch(view.state.tr.setMeta(key, { lock: null }).setMeta('addToHistory', false));
  };
  const resize =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (!watching) return;
          const width = watching.clientWidth;
          if (Math.abs(width - watchedWidth) < 0.5) return;
          watchedWidth = width;
          release();
        });
  const watch = (wrapper: HTMLElement | null) => {
    if (watching === wrapper) return;
    if (watching) resize?.unobserve(watching);
    watching = wrapper;
    if (wrapper) {
      watchedWidth = wrapper.clientWidth;
      resize?.observe(wrapper);
    }
  };
  const update = () => {
    if (view.composing) return;
    const lock = key.getState(view.state)?.lock ?? null;
    const dragging = !!columnResizingPluginKey.getState(view.state)?.dragging;
    const table = view.editable && !dragging ? caretTable(view.state) : null;
    if (!table) {
      watch(null);
      return release();
    }
    const drawn = tableDOM(view, table.pos);
    if (lock?.pos === table.pos) return watch(drawn?.wrapper ?? null);
    if (!drawn || drawn.table.getBoundingClientRect().width < roomOf(drawn.wrapper) - 1.5) {
      watch(null);
      return release();
    }
    const map = TableMap.get(table.node);
    const seen = new Set<number>();
    const cells: DrawnCell[] = [];
    for (const offset of map.map) {
      if (seen.has(offset)) continue;
      seen.add(offset);
      const dom = view.nodeDOM(table.pos + 1 + offset);
      const { left, right } = map.findCell(offset);
      cells.push({ left, right, width: dom instanceof HTMLElement ? dom.getBoundingClientRect().width : null });
    }
    const widths = measureColumns(cells, map.width);
    if (!widths) return release();
    watch(drawn.wrapper);
    view.dispatch(view.state.tr.setMeta(key, { lock: { pos: table.pos, widths } }).setMeta('addToHistory', false));
  };
  return {
    update,
    destroy() {
      resize?.disconnect();
    },
  };
}

/** How long after the Menu key (or Shift+F10) the browser's own context menu event is still that key's. */
const KEY_MENU_MS = 1000;

export function tablePlugins(): Plugin[] {
  let keyMenuAt = 0;
  return [
    keymap({ 'Mod-y': (state, dispatch, view) => redo(state, dispatch) || (!!view && repeatTableInsert(view, announce)) }),
    new Plugin<TableState>({
      key,
      state: {
        init: (_config, state) => ({ lock: null, decorations: tableDecorations(state.doc, null) }),
        apply(tr, before) {
          const meta = tr.getMeta(key) as { lock: Lock | null } | undefined;
          const lock = meta ? meta.lock : mapLock(before.lock, tr);
          if (!tr.docChanged && lock === before.lock) return before;
          return { lock, decorations: tableDecorations(tr.doc, lock) };
        },
      },
      view(view) {
        const room = roomTracker(view);
        const clip = clipTracker(view);
        const lock = lockKeeper(view);
        return {
          update() {
            clip.sync();
            lock.update();
          },
          destroy() {
            room();
            clip.destroy();
            lock.destroy();
          },
        };
      },
      props: {
        decorations: state => key.getState(state)?.decorations,
        handleDOMEvents: {
          contextmenu(view, event) {
            if (Date.now() - keyMenuAt < KEY_MENU_MS) {
              keyMenuAt = 0;
              event.preventDefault();
              return true;
            }
            if (!view.editable) return false;
            const cellPos = cellAtPointer(view, event);
            if (cellPos === null) return false;
            const target = targetOf(view.state, cellPos);
            const at = pagePoint(view.dom, event.clientX, event.clientY);
            if (!target || !at) return false;
            event.preventDefault();
            openContextMenu(refOf(target), at);
            return true;
          },
        },
        handleKeyDown(view, event) {
          if (!view.editable || !(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return false;
          const target = selectionCell(view.state);
          if (!target) return false;
          const coords = view.coordsAtPos(view.state.selection.head);
          const at = pagePoint(view.dom, coords.left, coords.bottom);
          if (!at) return false;
          event.preventDefault();
          keyMenuAt = Date.now();
          openContextMenu(refOf(target), at);
          return true;
        },
      },
    }),
  ];
}
