/**
 * The layers list at the top of the Properties and Code tabs: the current
 * page's artboards, each opening into its template tree. Clicking selects
 * (Shift or ⌘ adds); hovering highlights on the canvas.
 *
 * Layers are edited in place, each a minimal source edit through the usual
 * operations (undoable, replayed over remote changes): double-click a name
 * to rename it (`data-label`), the eye hides or shows it (inline
 * `display: none`), and dragging rows moves the elements before, after or
 * into another layer of the same artboard. Dropped on another artboard's
 * rows, elements move into that artboard, and notes and pieces join it.
 * Locked layers show a lock; clicking it unlocks that layer alone.
 */

import { Box, ChevronRight, Eye, EyeOff, GitBranch, Hash, Image, LayoutGrid, Lock, Repeat, Shapes, StretchHorizontal, StretchVertical, Type } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { boardsOnPage, groupSelectionUnits, isLockedObject, noteGroupIndex, notesOnPage } from '@open-artifact/design-core';
import { cn, isComposingKey } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView, type ElementSelection } from '../state/view.ts';
import { attributeValue } from '@open-artifact/dc';
import { templateOf } from '../services/agent.ts';
import { boardApi } from '../services/frames.ts';
import { edit } from '../services/commands.ts';
import { announce } from '../services/announce.ts';
import { refuseLocked, unlockElement, unlockObjects } from '../services/locks.ts';
import { isElementLocked } from '../lib/locks.ts';
import { ancestorTids, buildOutline, carryTids, climbAfter, draggedAncestorSteps, dropLevels, isHiddenLayer, loneLabelOp, renameOp, reorderOp, rowTidOf, visibilityOps, type OutlineDrop, type OutlineGlyph, type OutlineLayout, type OutlineNode } from '../lib/outline.ts';
import { boardsReached, elementsIn, selectedBoardsOf, selectedNotesOf } from '../lib/selection.ts';
import { shiftBoard, shiftElement, shiftNotes } from '../services/selecting.ts';
import { moveLayers } from '../services/structure.ts';
import { canTakeRows, joinFromOutline, moveElementsInto, useOutlineInto } from '../services/outline-move.ts';
import type { LooseObjects } from '../lib/join.ts';
import { rowsCanLeave } from '../lib/outline-into.ts';
import { outlineKeepsKey, outlineKeyStep, type OutlineRowState } from '../lib/outline-keys.ts';

/** The row the layers list's one tab stop is on (`data-row-key`). */
const TabStop = createContext<{ key: string | null; set(key: string): void }>({ key: null, set() {} });

const rowsOf = (tree: Element | null): HTMLElement[] => (tree ? [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')] : []);
const rowState = (row: HTMLElement): OutlineRowState => ({
  level: Number(row.getAttribute('aria-level')) || 1,
  expandable: row.hasAttribute('aria-expanded'),
  open: row.getAttribute('aria-expanded') === 'true',
});
const focusRow = (row: HTMLElement | undefined): void => {
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
};

const GLYPH_PROPS = { className: 'size-3.5', strokeWidth: 1.75 } as const;

const GLYPHS: Record<OutlineGlyph | 'artboard', ReactNode> = {
  column: <StretchHorizontal {...GLYPH_PROPS} />,
  row: <StretchVertical {...GLYPH_PROPS} />,
  grid: <LayoutGrid {...GLYPH_PROPS} />,
  text: <Type {...GLYPH_PROPS} />,
  frame: <Hash {...GLYPH_PROPS} />,
  artboard: <Hash {...GLYPH_PROPS} />,
  image: <Image {...GLYPH_PROPS} />,
  shape: <Shapes {...GLYPH_PROPS} />,
  component: <Box {...GLYPH_PROPS} />,
  repeat: <Repeat {...GLYPH_PROPS} />,
  conditional: <GitBranch {...GLYPH_PROPS} />,
};

/** One row of the tree. */
function TreeRow({
  level,
  name,
  detail,
  glyph,
  selected,
  hovered,
  open,
  hasChildren,
  bold = true,
  onToggle,
  onSelect,
  onHover,
  row,
  board,
  into = false,
  label,
  hidden = false,
  drop = null,
  dropShift = 0,
  editable = false,
  onPress,
  onRename,
  onToggleHidden,
  locked = false,
  onUnlock,
  rowKey,
}: {
  /** Names the row for the list's tab stop (`data-row-key`). */
  rowKey: string;
  level: number;
  name: string;
  detail?: string;
  glyph: OutlineGlyph | 'artboard';
  selected: boolean;
  hovered: boolean;
  open: boolean;
  hasChildren: boolean;
  /** Selected rows go medium weight (artboards do not). */
  bold?: boolean;
  onToggle(): void;
  onSelect(additive: boolean): void;
  onHover(on: boolean): void;
  /** Marks the row as a drop target (`data-outline-row`, `data-outline-tid`). */
  row?: { board: string; tid: number };
  /** An artboard's own row (`data-outline-board`): rows dropped on it go into the artboard. */
  board?: string;
  /** Rows dragged from elsewhere would drop into this artboard. */
  into?: boolean;
  /** The layer's own name (`data-label`), edited by Rename. */
  label?: string;
  /** Hidden with `display: none`: the row dims and its eye stays shown. */
  hidden?: boolean;
  /** Where a drag would drop relative to this row. */
  drop?: OutlineDrop | null;
  /** Levels shallower than this row the drop line sits (a drop after the container this row closes). */
  dropShift?: number;
  /** Rename, hide and drag are offered. */
  editable?: boolean;
  /** A left press (after selecting): may start a drag. */
  onPress?(event: ReactMouseEvent): void;
  onRename?(name: string): void;
  onToggleHidden?(): void;
  /** Locked: a lock shows, which unlocks the row when `onUnlock` is given. */
  locked?: boolean;
  onUnlock?(): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const tabStop = useContext(TabStop);
  const self = useRef<HTMLDivElement>(null);
  /** The row rings its layer on the canvas while it has the keyboard focus. */
  const keyed = useRef(false);
  /** A rename ended with Enter or Escape: the focus goes back to the row. */
  const refocus = useRef(false);
  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    self.current?.focus({ preventScroll: true });
  }, [renaming]);
  useEffect(() => () => {
    if (keyed.current) onHover(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || isComposingKey(event.nativeEvent)) return;
    const rows = rowsOf(event.currentTarget.closest('[role="tree"]'));
    const press = { key: event.key, shift: event.shiftKey, meta: event.metaKey || event.ctrlKey, alt: event.altKey };
    if (!outlineKeepsKey(press)) return;
    // The list keeps these keys even where they do nothing (the last row's ↓ moves nothing on the canvas).
    event.preventDefault();
    const step = outlineKeyStep(rows.map(rowState), rows.indexOf(event.currentTarget), press);
    if (!step) return;
    if (step.kind === 'focus') focusRow(rows[step.index]);
    else if (step.kind === 'open') onToggle();
    else if (step.kind === 'select') {
      if (!event.repeat) onSelect(step.additive);
    } else if (editable && onRename) setRenaming(true);
  };
  return (
    <div
      ref={self}
      data-row-key={rowKey}
      tabIndex={tabStop.key === rowKey ? 0 : -1}
      aria-label={locked ? `${detail ? `${name} ${detail}` : name}, Locked` : undefined}
      data-outline-row={row?.board}
      data-outline-tid={row?.tid}
      data-outline-board={board}
      data-drop-into={into || undefined}
      role="treeitem"
      aria-level={level + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      data-outline-selected={selected || undefined}
      onMouseDown={(event) => {
        if (event.button !== 0 || renaming) return;
        // A click leaves the keys with the canvas, unless the list already has the focus.
        event.preventDefault();
        tabStop.set(rowKey);
        if (event.currentTarget.ownerDocument.activeElement?.closest('[role="tree"]')) event.currentTarget.focus({ preventScroll: true });
        onSelect(event.shiftKey || event.metaKey || event.ctrlKey);
        onPress?.(event);
      }}
      onDoubleClick={(event) => {
        if (!editable || !onRename) return;
        event.preventDefault();
        setRenaming(true);
      }}
      onKeyDown={keyDown}
      onFocus={(event) => {
        if (event.target !== event.currentTarget) return;
        tabStop.set(rowKey);
        keyed.current = event.currentTarget.matches(':focus-visible');
        if (keyed.current) onHover(true);
      }}
      onBlur={(event) => {
        if (event.target !== event.currentTarget || !keyed.current) return;
        keyed.current = false;
        onHover(false);
      }}
      // A finger on a row marks nothing on the canvas.
      onPointerEnter={(event) => onHover(event.pointerType !== 'touch')}
      onPointerLeave={() => onHover(false)}
      className={cn(
        'group/row relative flex h-6 cursor-default select-none items-center rounded-[6px] pr-1 text-[12px] leading-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-chrome-accent',
        selected ? cn('bg-chrome-selected text-chrome-fg', bold && 'font-medium') : cn('text-chrome-secondary', hovered ? 'bg-chrome-hover' : 'hover:bg-chrome-hover'),
        (drop === 'inside' || into) && 'outline outline-2 -outline-offset-2 outline-chrome-accent',
      )}
      style={{ paddingLeft: 6 + level * 16 }}
    >
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Collapse' : 'Expand'}
          onMouseDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onToggle();
          }}
          className="flex size-5 shrink-0 items-center justify-center text-chrome-muted hover:text-chrome-fg"
        >
          <ChevronRight className={cn('size-3 transition-transform duration-100', open && 'rotate-90')} strokeWidth={2} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <span className={cn('-ml-1 mr-1.5 flex size-4 shrink-0 items-center justify-center text-chrome-fg/35', hidden && 'opacity-50')}>{GLYPHS[glyph]}</span>
      {renaming ? (
        <input
          autoFocus
          aria-label={`Rename ${name}`}
          defaultValue={label ?? ''}
          placeholder={name}
          className="h-5 min-w-0 flex-1 rounded-[4px] border border-chrome-accent bg-chrome px-1 text-[12px] font-normal text-chrome-fg outline-none"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (isComposingKey(event.nativeEvent)) return;
            if (event.key === 'Enter') {
              refocus.current = true;
              onRename?.(event.currentTarget.value);
              setRenaming(false);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              refocus.current = true;
              setRenaming(false);
            }
          }}
          onBlur={(event) => {
            if (!renaming) return;
            onRename?.(event.currentTarget.value);
            setRenaming(false);
          }}
        />
      ) : (
        <>
          <span className={cn('min-w-0 truncate', hidden && 'opacity-50')}>{name}</span>
          {detail ? <span className={cn('mx-1.5 min-w-0 flex-auto shrink-[9999] truncate font-normal text-chrome-muted', hidden && 'opacity-50')}>{detail}</span> : <span className="flex-auto" />}
        </>
      )}
      {editable && onToggleHidden && !renaming ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
          aria-pressed={hidden}
          onMouseDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onToggleHidden();
          }}
          className={cn('ml-auto flex size-5 shrink-0 items-center justify-center rounded-[4px] text-chrome-muted hover:text-chrome-fg', hidden ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100')}
        >
          {hidden ? <EyeOff className="size-3.5" strokeWidth={1.75} /> : <Eye className="size-3.5" strokeWidth={1.75} />}
        </button>
      ) : null}
      {locked && !renaming ? (
        editable && onUnlock ? (
          <button
            type="button"
            tabIndex={-1}
            title="Unlock"
            aria-label={`Unlock ${name}`}
            onMouseDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onUnlock();
            }}
            className={cn('flex size-5 shrink-0 items-center justify-center rounded-[4px] text-chrome-muted hover:text-chrome-fg', !(onToggleHidden && editable) && 'ml-auto')}
          >
            <Lock className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : (
          <span role="img" aria-label="Locked" title="Locked" className="ml-auto flex size-5 shrink-0 items-center justify-center text-chrome-muted">
            <Lock className="size-3.5" strokeWidth={1.75} />
          </span>
        )
      ) : null}
      {drop === 'before' || drop === 'after' ? (
        <span aria-hidden="true" className={cn('pointer-events-none absolute right-1 h-0.5 rounded-full bg-chrome-accent', drop === 'before' ? '-top-px' : '-bottom-px')} style={{ left: 6 + (level - dropShift) * 16 + 20 }} />
      ) : null}
    </div>
  );
}

/** Rendered layout of each element with children, for Row/Column/Grid names. */
function useLayouts(board: string, source: string | null, enabled: boolean): (tid: number) => OutlineLayout | undefined {
  const tick = useView((s) => s.layoutTick);
  return useMemo(() => {
    const cache = new Map<number, OutlineLayout | undefined>();
    return (tid: number) => {
      if (!enabled) return undefined;
      if (!cache.has(tid)) {
        const computed = boardApi(board)?.inspect(tid)?.computed;
        cache.set(tid, computed ? { display: computed.display ?? '', direction: computed['flex-direction'] ?? '' } : undefined);
      }
      return cache.get(tid);
    };
    // `tick` invalidates the cache when frames re-render.
  }, [board, source, enabled, tick]);
}

/** The tree of one artboard. */
/** The artboard of the layers-list row under a point: its own row or one of its elements' rows. */
function rowBoardAt(x: number, y: number): string | null {
  const row = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-outline-board], [data-outline-row]');
  return row?.dataset.outlineBoard ?? row?.dataset.outlineRow ?? null;
}

/** Marks the artboard rows dragged from `from` would drop into, at a point; returns it. */
function markInto(x: number, y: number, from: string | null): string | null {
  const board = rowBoardAt(x, y);
  const into = board && board !== from && canTakeRows(board, from) ? board : null;
  if (useOutlineInto.getState().into !== into) useOutlineInto.setState({ into });
  return into;
}

/**
 * A press on a note, group or piece row: past a few pixels it drags them,
 * and dropped on an artboard's row they join that artboard.
 */
function pressLoose(members: () => LooseObjects, from: string | null) {
  return (event: ReactMouseEvent): void => {
    if (useDocument.getState().readOnly || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let refused = false;
    let into: string | null = null;
    const move = (e: MouseEvent): void => {
      if (refused || (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 4)) return;
      if (!dragging) {
        const { canvas } = useDocument.getState();
        const { boards, notes } = members();
        if (boards.some((path) => isLockedObject(canvas.boards[path])) || notes.some((id) => isLockedObject(canvas.notes[id]))) {
          refused = true;
          refuseLocked();
          return;
        }
      }
      dragging = true;
      into = markInto(e.clientX, e.clientY, from);
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      useOutlineInto.setState({ into: null });
      if (dragging && into) joinFromOutline(members(), into);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
}

function BoardTree({ path, flipped, flip, unflip, carry, autoOpen }: { path: string; flipped: Set<string>; flip(key: string): void; unflip(keys: string[]): void; carry(path: string, before: string, after: string): void; autoOpen: boolean }) {
  const entry = useDocument((s) => s.canvas.boards[path]);
  const source = useDocument((s) => s.boards[path]?.source ?? null);
  const selection = useView((s) => s.selection);
  const hover = useView((s) => s.hover);
  const booted = useView((s) => s.frames[path]?.booted ?? false);

  const boardKey = `b:${path}`;
  const boardSelected = selectedBoardsOf(selection).includes(path);
  const open = autoOpen !== flipped.has(boardKey);

  // Rows opened or closed by hand stay so when an edit renumbers the elements.
  const lastSource = useRef(source);
  useEffect(() => {
    const before = lastSource.current;
    lastSource.current = source;
    if (before && source && before !== source) carry(path, before, source);
  }, [source, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const layoutOf = useLayouts(path, source, open && booted);
  const model = useMemo(() => (source && open ? templateOf(source) : null), [source, open]);
  const nodes = useMemo(() => (model ? buildOutline(model, layoutOf) : []), [model, layoutOf]);

  const selectedTids = useMemo(() => new Set(elementsIn(selection, path).map((item) => (model ? rowTidOf(model, item.tid) : item.tid))), [selection, path, model]);
  const hoveredTid = hover?.board === path && model ? rowTidOf(model, hover.tid) : null;
  const openTids = useMemo(() => {
    const out = new Set<number>();
    if (model) for (const item of elementsIn(selection, path)) for (const tid of ancestorTids(model, item.path)) out.add(tid);
    return out;
  }, [model, selection, path]);

  // Ancestors of a new selection open, whatever was toggled before.
  useEffect(() => {
    if (openTids.size) unflip([...openTids].map((tid) => `${path}:${tid}`));
  }, [openTids, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const readOnly = useDocument((s) => s.readOnly);
  const into = useOutlineInto((s) => s.into === path);
  /** The drop: target row and side, and the row the line shows on (`at`, `shift` levels in). */
  const [drop, setDrop] = useState<{ tid: number; where: OutlineDrop; at: number; shift: number } | null>(null);

  /** A press on a row: past a few pixels it drags the selected layers of this artboard. */
  const press = (node: OutlineNode) => (event: ReactMouseEvent) => {
    if (readOnly || !model || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let target: { tid: number; where: OutlineDrop; at: number; shift: number } | null = null;
    let into: string | null = null;
    let refused = false;
    const sourceAtStart = source;
    const leaves = rowsCanLeave(model, dragged(node.tid));
    const move = (e: MouseEvent): void => {
      if (refused || (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 4)) return;
      if (!dragging && dragged(node.tid).some((tid) => { const element = model.elements[tid]; return element ? isElementLocked(element) : false; })) {
        // Locked layers stay where they are.
        refused = true;
        refuseLocked();
        return;
      }
      dragging = true;
      into = leaves ? markInto(e.clientX, e.clientY, path) : null;
      const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-outline-tid]');
      if (into || !row || row.dataset.outlineRow !== path) {
        target = null;
        setDrop(null);
        return;
      }
      const tid = Number(row.dataset.outlineTid);
      const box = row.getBoundingClientRect();
      const at = (e.clientY - box.top) / box.height;
      const element = model.elements[tid];
      const inside = element && reorderOp(model, dragged(node.tid), tid, 'inside') !== null;
      const where: OutlineDrop = inside ? (at < 0.25 ? 'before' : at > 0.75 ? 'after' : 'inside') : at < 0.5 ? 'before' : 'after';
      target = dropTarget(dragged(node.tid), tid, where, box.left, Number(row.getAttribute('aria-level')) - 1, e.clientX, startX);
      setDrop(target);
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrop(null);
      useOutlineInto.setState({ into: null });
      if (dragging && into && sourceAtStart) {
        moveElementsInto(path, items(node), into, sourceAtStart);
        return;
      }
      if (!dragging || !target) return;
      const op = reorderOp(model, dragged(node.tid), target.tid, target.where);
      if (op?.kind === 'move' && moveLayers(path, op)) announce(`Moved ${target.where === 'inside' ? 'into' : target.where} the layer`);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /**
   * Below a row, pulled left of its indent: after the container the row
   * closes, one level per indent step, or as far toward that as a drop may go.
   */
  const dropTarget = (moving: number[], tid: number, where: OutlineDrop, rowLeft: number, level: number, pointerX: number, startX: number): { tid: number; where: OutlineDrop; at: number; shift: number } | null => {
    if (!model) return null;
    const levels = dropLevels({ indentStart: rowLeft + 6 + level * 16, pointerX, startX, indent: 16, ancestorSteps: draggedAncestorSteps(model, tid, moving) });
    const climb = where === 'after' ? climbAfter(model, tid, levels) : [tid];
    for (let shift = climb.length - 1; shift >= 0; shift--) {
      if (reorderOp(model, moving, climb[shift]!, where)) return { tid: climb[shift]!, where, at: tid, shift };
    }
    return null;
  };
  const dragged = (tid: number): number[] => {
    const items = elementsIn(useView.getState().selection, path);
    return items.some((item) => item.tid === tid) ? items.map((item) => item.tid) : [tid];
  };
  /** The elements a drag from `node`'s row moves: the selected ones, when it is one of them. */
  const items = (node: OutlineNode): ElementSelection[] => {
    const selected = elementsIn(useView.getState().selection, path);
    return selected.some((item) => item.tid === node.tid) ? [...selected] : [{ tid: node.tid, path: node.path, instance: 0 }];
  };

  const rename = (node: OutlineNode) => (name: string) => {
    if (!model) return;
    const op = renameOp(model, node.tid, name);
    if (!op) return;
    const key = `rename:${node.tid}:${Date.now()}`;
    if (!edit(path, op, { coalesce: key })) return;
    const shapeOp = loneLabelOp(model, node.tid);
    if (shapeOp) edit(path, shapeOp, { coalesce: key });
    announce(name.trim() ? `Renamed to ${name.trim()}` : 'Name removed');
  };

  const toggleHidden = (node: OutlineNode) => () => {
    if (!model) return;
    const element = model.elements[node.tid];
    const hiding = element ? !isHiddenLayer(element) : true;
    const key = `visibility:${node.tid}:${Date.now()}`;
    for (const op of visibilityOps(model, node.tid)) {
      // Each edit re-reads the source, so the second one's address still matches.
      edit(path, op, { coalesce: key });
    }
    announce(hiding ? `${node.name} hidden` : `${node.name} shown`);
  };

  const view = useView.getState;
  const selectBoard = (additive: boolean) => {
    if (additive) shiftBoard(path);
    else view().select({ kind: 'objects', boards: [path], notes: [] });
  };
  const selectNode = (node: OutlineNode, additive: boolean) => {
    const item: ElementSelection = { tid: node.tid, path: node.path, instance: 0 };
    const current = view().selection;
    if (additive && current.kind !== 'none') {
      // Taking out the last element leaves its artboard selected.
      if (shiftElement(path, item).kind === 'none') view().select({ kind: 'objects', boards: [path], notes: [] });
    } else view().select({ kind: 'elements', board: path, items: [item] });
  };

  const renderNodes = (list: OutlineNode[], level: number): ReactNode =>
    list.map((node) => {
      const key = `${path}:${node.tid}`;
      const defaultOpen = level < 2 || openTids.has(node.tid);
      const nodeOpen = node.children.length > 0 && defaultOpen !== flipped.has(key);
      return (
        <div key={node.tid} role="group">
          <TreeRow
            rowKey={key}
            level={level}
            name={node.name}
            detail={node.detail}
            glyph={node.glyph}
            selected={selectedTids.has(node.tid)}
            hovered={hoveredTid === node.tid}
            open={nodeOpen}
            hasChildren={node.children.length > 0}
            onToggle={() => flip(key)}
            onSelect={(additive) => selectNode(node, additive)}
            onHover={(on) => view().setHover(on ? { board: path, tid: node.tid, instance: 0 } : null)}
            row={{ board: path, tid: node.tid }}
            label={model?.elements[node.tid] ? attributeValue(model.elements[node.tid]!, 'data-label') : undefined}
            hidden={model?.elements[node.tid] ? isHiddenLayer(model.elements[node.tid]!) : false}
            drop={drop?.at === node.tid ? drop.where : null}
            dropShift={drop?.at === node.tid ? drop.shift : 0}
            editable={!readOnly}
            onPress={press(node)}
            onRename={rename(node)}
            onToggleHidden={toggleHidden(node)}
            locked={model?.elements[node.tid] ? isElementLocked(model.elements[node.tid]!) : false}
            onUnlock={() => unlockElement(path, { tid: node.tid, path: node.path })}
          />
          {nodeOpen ? renderNodes(node.children, level + 1) : null}
        </div>
      );
    });

  if (!entry) return null;
  return (
    <div role="group">
      <TreeRow
        rowKey={boardKey}
        level={0}
        name={entry.title || path.replace(/\.dc\.html$/, '')}
        glyph="artboard"
        selected={boardSelected}
        hovered={false}
        bold={false}
        open={open}
        hasChildren
        onToggle={() => flip(boardKey)}
        onSelect={selectBoard}
        onHover={(on) => view().setHoverObject(on ? { board: path } : null)}
        board={path}
        into={into}
        editable={!readOnly}
        onPress={entry.frameless ? pressLoose(() => ({ boards: [path], notes: [] }), path) : undefined}
        locked={isLockedObject(entry)}
        onUnlock={() => unlockObjects([path], [])}
      />
      {open ? nodes.length ? renderNodes(nodes, 1) : <div className="py-1 pl-[42px] text-[12px] text-chrome-muted">{source === null ? 'Loading…' : 'No elements yet'}</div> : null}
    </div>
  );
}

/** The layers list of the current page. */
export function Outline() {
  const canvas = useDocument((s) => s.canvas);
  const page = useView((s) => s.page);
  const selection = useView((s) => s.selection);
  const readOnly = useDocument((s) => s.readOnly);
  const boards = useMemo(() => boardsOnPage(canvas, page), [canvas, page]);
  const units = useMemo(() => {
    const ids = notesOnPage(canvas, page);
    const items = ids.map(id => ({ id, groups: canvas.notes[id]!.groups }));
    return groupSelectionUnits(noteGroupIndex(items), items, new Set(ids));
  }, [canvas, page]);
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState<string | null>(null);
  const tabStop = useMemo(() => ({ key: stop, set: setStop }), [stop]);
  // The list keeps one tab stop: the row last focused or clicked while it shows, else the selected row, else the first.
  useLayoutEffect(() => {
    const rows = rowsOf(scroller.current);
    if (!rows.length || rows.some((row) => row.tabIndex === 0)) return;
    const next = (rows.find((row) => row.hasAttribute('data-outline-selected')) ?? rows[0]!).dataset.rowKey ?? null;
    if (next !== stop) setStop(next);
  });

  const reached = boardsReached(selection);
  const activeBoard = reached.length === 1 ? reached[0] : null;

  // Nothing stays marked on the canvas once the pointer or the list goes.
  const clearHover = () => {
    useView.getState().setHover(null);
    useView.getState().setHoverObject(null);
  };
  useEffect(() => clearHover, []);

  // A newly selected element's row scrolls into view.
  useEffect(() => {
    const row = scroller.current?.querySelector('[data-outline-selected]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  // Selecting inside a collapsed artboard opens it again.
  useEffect(() => {
    if (!activeBoard) return;
    setFlipped((current) => {
      const key = `b:${activeBoard}`;
      if (!current.has(key) || boards.length === 1) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, [activeBoard, boards.length]);

  const unflip = (keys: string[]) =>
    setFlipped((current) => {
      if (!keys.some((key) => current.has(key))) return current;
      const next = new Set(current);
      for (const key of keys) next.delete(key);
      return next;
    });

  /** Hand-toggled rows of an artboard follow their elements through an edit. */
  const carry = (board: string, before: string, after: string) =>
    setFlipped((current) => {
      const prefix = `${board}:`;
      if (![...current].some((key) => key.startsWith(prefix))) return current;
      const map = carryTids(templateOf(before), templateOf(after));
      const next = new Set<string>();
      let changed = false;
      for (const key of current) {
        if (!key.startsWith(prefix)) {
          next.add(key);
          continue;
        }
        const tid = Number(key.slice(prefix.length));
        const to = map.get(tid);
        if (to !== undefined) next.add(prefix + to);
        if (to !== tid) changed = true;
      }
      return changed ? next : current;
    });

  const flip = (key: string) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectedNotes = selectedNotesOf(selection);
  const selectNotes = (ids: string[], additive: boolean) => {
    if (additive) shiftNotes(ids, ids.every((id) => selectedNotes.includes(id)));
    else useView.getState().select({ kind: 'objects', boards: [], notes: [...ids] });
  };
  // The canvas rings a note's whole group, so a group row rings it through any of its notes.
  const hoverNote = (id: string | null) => useView.getState().setHoverObject(id === null ? null : { note: id });
  /** The notes a drag from a note or group row moves: the selected ones, when those include the row's. */
  const draggedNotes = (ids: string[]) => (): LooseObjects => {
    const selected = selectedNotesOf(useView.getState().selection);
    return { boards: [], notes: ids.every((id) => selected.includes(id)) ? [...selected] : ids };
  };
  const noteRow = (id: string, level: number) => {
    const note = canvas.notes[id]!;
    const name = note.title || note.text?.split('\n')[0] || note.alt || note.href || note.kind || 'Sticky';
    const glyph = note.kind === 'image' ? 'image' : !note.kind || ['link', 'title1', 'sticky'].includes(note.kind) ? 'text' : 'shape';
    return <TreeRow key={id} rowKey={`n:${id}`} level={level} name={name} glyph={glyph} selected={selectedNotes.includes(id)}
      hovered={false} open={false} hasChildren={false} onHover={on => hoverNote(on ? id : null)} onToggle={() => {}} onSelect={add => selectNotes([id], add)}
      editable={!readOnly} onPress={pressLoose(draggedNotes([id]), null)} locked={isLockedObject(note)} onUnlock={() => unlockObjects([], [id])} />;
  };

  return (
    <TabStop.Provider value={tabStop}>
    <div ref={scroller} role="tree" aria-label="Layers" className="h-full overflow-y-auto px-1.5 py-1.5" onMouseLeave={clearHover}>
      {boards.map(path => <BoardTree key={path} path={path} flipped={flipped} flip={flip} unflip={unflip} carry={carry} autoOpen={boards.length === 1 || path === activeBoard} />)}
      {units.map(({ group, ids }) => {
        if (!group) return noteRow(ids[0]!, 0);
        const key = 'g:' + group;
        const open = flipped.has(key);
        return <div key={key} role="group">
          <TreeRow rowKey={key} level={0} name="Group" detail={String(ids.length)} glyph="frame" selected={ids.every(id => selectedNotes.includes(id))}
            hovered={false} open={open} hasChildren onHover={on => hoverNote(on ? ids[0]! : null)} onToggle={() => flip(key)} onSelect={add => selectNotes(ids, add)} onPress={pressLoose(draggedNotes(ids), null)} />
          {open && ids.map(id => noteRow(id, 1))}
        </div>;
      })}
      {!boards.length && !units.length ? <div className="px-2 py-1 text-[12px] text-chrome-muted">No elements yet</div> : null}
    </div>
    </TabStop.Provider>
  );
}
