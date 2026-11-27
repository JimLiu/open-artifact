/**
 * The infinite canvas: artboards and notes of the current page under a
 * pan/zoom camera, with every pointer interaction.
 *
 * By default the WebGL2 engine draws it (services/engine.ts): the grid,
 * artboard snapshots and placeholders, note bodies, selection, marquee and
 * snap guides, with live artboards showing through holes in it. The engine
 * runs the object gestures (select, marquee, move, resize, pan, zoom); note
 * text, artboard labels and element boxes stay in the DOM. With
 * `?open_artifact_engine=off`, or when the engine cannot start, everything is DOM:
 * artboards, notes and the grid in one camera-transformed layer.
 *
 * Presses the engine does not take (elements inside an artboard, creation
 * tools, the context menu, artboard labels) are handled here. What is under
 * the pointer comes from the engine's hit test on its canvas, and from DOM
 * markers elsewhere: `data-board` (an artboard body), `data-board-title`
 * (its label), `data-note` (a note) and `data-handle` (a resize handle drawn
 * by the overlay). Inside an artboard, the board runtime's `pick` finds the
 * template element under the pointer.
 */

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { contains, elementPath, isTextEditable, resolveElement } from '@open-artifact/dc';
import {
  boardsOnPage,
  enterNoteGroup,
  expandNotesToGroups,
  groupItems,
  intersects,
  isLockedObject,
  MAX_BOARD_SIZE,
  MIN_BOARD_SIZE,
  notesOnPage,
  pageOf,
  unlockedObjects,
  type BoardEntry,
  type Canvas as CanvasModel,
  type CanvasNote,
  type Rect,
} from '@open-artifact/design-core';
import { toast } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { NO_SELECTION, toWorld, useView, type Camera, type ElementSelection, type ViewState } from '../state/view.ts';
import { boardApi } from '../services/frames.ts';
import { addBoard, addNote, copyMixed, copyObjects, copySelectedElements, edit, moveMixed, moveObjects, moveSelectedElements, resizeObject, selectionIsPositioned, selectionPinnedAxes, startTextEdit, editTextAt, type ResizeTarget } from '../services/commands.ts';
import { combineSelection, flowDropAt, freezeInherited, marqueeCandidates, marqueeHits, rootAddress, templateRoot, type FlowDrop, type MarqueeCandidate } from '../services/gestures.ts';
import { pickDepth, type PickMode } from '../lib/pick-depth.ts';
import { staysTap, TOUCH_TAP_SLOP } from '../lib/touch.ts';
import { drawSpan, drawStart, drewShape, hoverGuides, snapTargets, spanBox, type DrawStart, type DrawTool, type SnapTargets } from '../lib/draw-snap.ts';
import type { Guide } from '@open-artifact/canvas-engine';
import { shiftDragDelta } from '../lib/drag-axis.ts';
import { isElementLocked, lockedTids } from '../lib/locks.ts';
import { boardPassesThrough, refuseLocked, selectionHasLock } from '../services/locks.ts';
import type { Address } from '../lib/ops.ts';
import { placeImages } from '../services/images.ts';
import { session } from '../services/session.ts';
import { templateOf, useAgent } from '../services/agent.ts';
import { pendingFit, viewportSize, visibleRect, zoomAt, zoomToBoards, zoomToFit } from '../services/viewport.ts';
import { dashArray, noteBounds, noteFontSize } from '../lib/notes.ts';
import { noteRect } from '../lib/scene.ts';
import { BoardFrame } from './BoardFrame.tsx';
import { NoteView } from './NoteView.tsx';
import { Overlay } from './Overlay.tsx';
import { CommentCapture, CommentPins } from './comments/CommentPins.tsx';
import { PresenceLayer } from './Presence.tsx';
import { CanvasMenu } from './CanvasMenu.tsx';
import { setMenuPoint } from '../services/clipboard.ts';
import { isLive, liveAll, startLive, useLive } from '../services/live.ts';
import { activeEngine, engineEnabled, engineMotion, itemAt, liveCamera, measuredNoteSize, onCameraFrame, registerLiveBoard, startEngine, startEngineMove } from '../services/engine.ts';
import { bezierPathData, relativeNodes, sampleBezier, type BezierNode } from '../lib/bezier.ts';
import { CropOverlay } from './CropOverlay.tsx';
import { NodeEditor } from './NodeEditor.tsx';
import { announce } from '../services/announce.ts';
import { endsMode } from '../lib/mode-keys.ts';
import { installRightDragPan, isTextField } from '@open-artifact/editor-kit';
import { elementsIn, selectedBoardsOf, selectedNotesOf, withBoardElements, withObjects, type Selection } from '../lib/selection.ts';
import { shiftBoard, shiftElement, shiftNotes } from '../services/selecting.ts';

/** Resize handle directions. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** A running pointer gesture. */
type Drag =
  | { kind: 'pan'; startX: number; startY: number; camera: { x: number; y: number; zoom: number } }
  /**
   * Dragging artboards and notes on the DOM canvas (the engine runs its own).
   * Alt makes it a copy: the originals stay and ghosts follow (`all` is what
   * copies, locked ones too; `boards`/`notes` what moves).
   */
  | { kind: 'move'; startX: number; startY: number; base: CanvasModel; boards: string[]; notes: string[]; all: { boards: string[]; notes: string[] }; ghostBase: Rect[]; moved: boolean; copy: boolean; offset: Offset }
  | { kind: 'marquee'; startX: number; startY: number; additive: boolean; initial: { boards: string[]; notes: string[] }; base: Selection }
  /** Drawing with a tool: the press point snapped (`start`) to the lines in `targets` (the Pen draws freehand). */
  | { kind: 'create'; tool: DrawTool | 'pen'; startX: number; startY: number; points?: [number, number][]; start: DrawStart; targets: SnapTargets }
  | { kind: 'resize'; handle: Handle; target: ResizeTarget; startX: number; startY: number; base: CanvasModel; rect: Rect }
  /** A box dragged inside an artboard selects elements. `click` runs when it stays a click. */
  | { kind: 'elementMarquee'; board: string; startX: number; startY: number; deep: boolean; toggle: boolean; candidates: MarqueeCandidate[] | null; container: Address | null; initial: ElementSelection[]; base: Selection; click: () => void; moved: boolean }
  /** Dragging a selection that spans files: artboards, notes and positioned elements move together, live. */
  | { kind: 'mixedMove'; startX: number; startY: number; moved: boolean; applied: Offset; key: string; click: (() => void) | null; copy: boolean; offset: Offset; ghostBase: Rect[] | null }
  /** Dragging selected elements: positioned ones move live, flow ones land among their siblings. */
  | { kind: 'elementMove'; board: string; startX: number; startY: number; moved: boolean; positioned: boolean; pinned?: { x: boolean; y: boolean }; applied: Offset; drop: FlowDrop | null; key: string; click: (() => void) | null; copy: boolean; locked: boolean; offset: Offset; ghostBase: Rect[] | null }
  /** The Pen tool: dragging out the handles of the node just placed. */
  | { kind: 'pathHandle'; startX: number; startY: number };

/** A world offset. */
interface Offset {
  x: number;
  y: number;
}

/** The keys a drag step reads. */
interface DragKeys {
  shift: boolean;
  alt: boolean;
  /** ⌘ or Ctrl: no snapping while drawing. */
  meta: boolean;
}

const keysOf = (event: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): DragKeys => ({ shift: event.shiftKey, alt: event.altKey, meta: event.metaKey || event.ctrlKey });

/** Tools that draw by dragging and snap while they do. */
const DRAW_TOOLS: ReadonlySet<string> = new Set<DrawTool>(['board', 'rect', 'oval', 'line', 'arrow']);
const isDrawTool = (tool: string): tool is DrawTool => DRAW_TOOLS.has(tool);

/** World distance within which a drawing snaps: the touch drag slop on screen. */
const snapReach = (keys: DragKeys): number | null => (keys.meta ? null : TOUCH_TAP_SLOP / liveCamera().zoom);

/** The lines drawings snap to: the edges and centres of the page's artboards and notes. */
function drawTargets(): SnapTargets {
  const { canvas } = useDocument.getState();
  const { page } = useView.getState();
  const rects = [
    ...boardsOnPage(canvas, page).map((path) => canvas.boards[path]!),
    ...notesOnPage(canvas, page).map((id) => noteRect(canvas.notes[id]!, measuredNoteSize(id))),
  ];
  return snapTargets(rects);
}

/** Where selected elements are on the canvas (world rects). */
function elementWorldRects(board: string, items: readonly ElementSelection[]): Rect[] {
  const entry = useDocument.getState().canvas.boards[board];
  const api = boardApi(board);
  if (!entry || !api || !items.length) return [];
  try {
    const rects = api.rects(items.map((item) => item.tid));
    return items.flatMap((item) => (rects[item.tid] ?? []).slice(item.instance, item.instance + 1).map((r) => ({ x: entry.x + r.x, y: entry.y + r.y, w: r.width, h: r.height })));
  } catch {
    return [];
  }
}

/** Where artboards and notes are on the canvas. */
function objectRects(canvas: CanvasModel, boards: readonly string[], notes: readonly string[]): Rect[] {
  return [
    ...boards.flatMap((path) => (canvas.boards[path] ? [canvas.boards[path]!] : [])),
    ...notes.flatMap((id) => (canvas.notes[id] ? [noteRect(canvas.notes[id]!, measuredNoteSize(id))] : [])),
  ].map(({ x, y, w, h }) => ({ x, y, w, h }));
}

const shifted = (rects: readonly Rect[], by: Offset): Rect[] => rects.map((r) => ({ ...r, x: r.x + by.x, y: r.y + by.y }));

/** An artboard drawn out from its snapped corner, kept within the artboard size limits. */
function drawnBoard(from: Offset, to: Offset): Rect {
  const clamp = (v: number) => Math.min(MAX_BOARD_SIZE, Math.max(MIN_BOARD_SIZE, Math.round(v)));
  const w = clamp(Math.abs(to.x - from.x));
  const h = clamp(Math.abs(to.y - from.y));
  return { x: to.x < from.x ? from.x - w : from.x, y: to.y < from.y ? from.y - h : from.y, w, h };
}

/** Screen px within which a Pen-tool press on the first node closes the path. */
const CLOSE_RADIUS = 8;

/** A path being drawn with the Pen tool: world nodes, and where the pointer is. */
interface PathDraft {
  nodes: BezierNode[];
  hover: { x: number; y: number } | null;
}

/** Ends the Pen tool's path: two nodes or more become a path note. */
function commitPath(draft: PathDraft | null, closed = false): void {
  // A double-click places the last node twice; repeated corners add nothing.
  const kept = draft?.nodes.filter((node, i, all) => i === 0 || node.out || node.in || node.x !== all[i - 1]!.x || node.y !== all[i - 1]!.y) ?? [];
  if (kept.length < 2) return;
  const { origin, nodes } = relativeNodes(kept);
  const { stroke, dash } = useView.getState().pen;
  addNote('pen', origin, { points: sampleBezier(nodes, closed), nodes, ...(closed ? { closed: true } : {}), ...(stroke !== 3 ? { stroke } : {}), ...(dash !== 'solid' ? { dash } : {}) });
  announce(`Path with ${nodes.length} points added`);
}

/** Opens the file picker; the chosen images are placed at `at`. */
export function pickImages(at: { x: number; y: number }): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    if (files.length) void placeImages(files, at);
  });
  input.click();
}

/** What a press landed on. */
type Hit =
  | { kind: 'handle'; handle: Handle; target: ResizeTarget }
  | { kind: 'title'; board: string }
  | { kind: 'note'; note: string }
  | { kind: 'board'; board: string }
  | { kind: 'empty' };

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

/** Note text smaller than this on screen (CSS pixels) is not drawn; the engine draws the note's body. */
const MIN_TEXT_PX = 3;

/** What the DOM element under the pointer belongs to (markers on the DOM canvas and the overlay). */
function domHit(target: HTMLElement): Hit {
  const handle = target.closest<HTMLElement>('[data-handle]');
  const handleBoard = handle?.dataset.handleBoard;
  const handleNote = handle?.dataset.handleNote;
  if (handle && (handleBoard || handleNote)) return { kind: 'handle', handle: handle.dataset.handle as Handle, target: handleBoard ? { board: handleBoard } : { note: handleNote! } };
  const title = target.closest<HTMLElement>('[data-board-title]')?.dataset.boardTitle;
  if (title) return { kind: 'title', board: title };
  const note = target.closest<HTMLElement>('[data-note]')?.dataset.note;
  if (note) return { kind: 'note', note };
  const board = target.closest<HTMLElement>('[data-board]')?.dataset.board;
  // A locked artboard nothing is selected in counts as empty canvas (its title still selects it).
  return board && !boardPassesThrough(board) ? { kind: 'board', board } : { kind: 'empty' };
}

/** Whether the pointer is over the canvas itself, not a control drawn on it or an artboard's page. */
function overCanvas(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.tagName !== 'IFRAME' && !target.closest('button, a[href], input, textarea, select, [contenteditable="true"], [role="toolbar"], [role="menu"], [role="dialog"], [data-selection-bar]');
}

/** What the engine draws at a point of its canvas. */
function engineHit(point: { x: number; y: number }): Hit {
  const item = itemAt(point);
  if (!item) return { kind: 'empty' };
  if ('board' in item) return boardPassesThrough(item.board) ? { kind: 'empty' } : { kind: 'board', board: item.board };
  return { kind: 'note', note: item.note };
}

/** The artboards and notes selected whole (elements selected with them aside). */
const selectedObjects = (view: ViewState): { boards: string[]; notes: string[] } => ({
  boards: selectedBoardsOf(view.selection),
  notes: selectedNotesOf(view.selection),
});

/**
 * Whether a press on the engine's canvas is the engine's: pans, the select
 * tool's presses on notes, empty canvas and artboards as wholes. Presses
 * that pick an element inside an artboard, creation tools and the context
 * menu are handled here.
 */
function engineTakes(event: ReactPointerEvent, hit: Hit, world: { x: number; y: number }): boolean {
  const view = useView.getState();
  if (event.button === 2) return false;
  if (event.button === 1 || view.spacePan || view.tool === 'hand') return true;
  if (view.tool !== 'select') return false;
  // A selection that holds elements is not the engine's to change or move:
  // Shift adds to it here, and a press on one of its members moves all of it.
  const { selection } = view;
  if (hit.kind !== 'empty' && (selection.kind === 'mixed' || (event.shiftKey && selection.kind === 'elements'))) return false;
  if (hit.kind === 'note') return hit.note !== view.noteEdit;
  if (hit.kind !== 'board') return true;
  const deep = event.metaKey || event.ctrlKey;
  if (selectedObjects(view).boards.includes(hit.board) && !deep) return true;
  return !pickElement(hit.board, world, deep ? 'deep' : 'plain');
}

/**
 * Element under a screen point inside an artboard, or `null`: which level
 * of the elements under it follows the selection (see `pickDepth`). Locked
 * elements are passed through, except for the context menu (`locked`).
 */
function pickElement(path: string, world: { x: number; y: number }, mode: PickMode, { locked = false }: { locked?: boolean } = {}): ElementSelection | null {
  const entry = useDocument.getState().canvas.boards[path];
  const api = boardApi(path);
  const source = useDocument.getState().boards[path]?.source;
  if (!entry || !api || !source) return null;
  const model = templateOf(source);
  const skip = locked ? [] : lockedTids(model);
  let chain = api.pickAll(world.x - entry.x, world.y - entry.y, skip).reverse();
  if (skip.length) {
    const skipped = new Set(skip);
    chain = chain.filter((pick) => !skipped.has(pick.tid));
  }
  if (!chain.length) return null;
  const { selection } = useView.getState();
  const selected = elementsIn(selection, path);
  let onChain = -1;
  let holder = -1;
  if (selected.length) {
    const selectedRects = api.rects(selected.map((item) => item.tid));
    chain.forEach((pick, index) => {
      if (selected.some((item) => item.tid === pick.tid && item.instance === pick.instance)) onChain = index;
      const element = model.elements[pick.tid];
      if (!element) return;
      const holds = selected.some((item) => {
        const inner = model.elements[item.tid];
        const rect = selectedRects[item.tid]?.[item.instance];
        return Boolean(inner && rect && inner !== element && contains(element, inner) && rectInside(rect, pick.rect));
      });
      if (holds) holder = index;
    });
  }
  const root = templateRoot(model);
  const rootFirst = Boolean(root) && model.tidOf.get(root!) === chain[0]!.tid;
  const editable = (index: number): boolean => {
    const element = model.elements[chain[index]!.tid];
    return Boolean(element && isTextEditable(element));
  };
  const hit = chain[pickDepth(chain.length, rootFirst, onChain, holder, mode, editable)];
  if (!hit) return null;
  // The runtime reports tids; the path is recovered from the parsed template.
  const elementAt = pathOfTid(source, hit.tid);
  return elementAt ? { tid: hit.tid, path: elementAt, instance: hit.instance } : null;
}

/** Whether any of the selected elements is not locked. */
function selectionHasUnlocked(path: string, items: readonly ElementSelection[]): boolean {
  const source = useDocument.getState().boards[path]?.source;
  if (!source) return false;
  const model = templateOf(source);
  return items.some((item) => {
    const element = resolveElement(model, item.tid, item.path);
    return element ? !isElementLocked(element) : false;
  });
}

/** Whether `inner` lies within `outer` (a pixel of slack for rounding). */
function sameElement(a: ElementSelection, b: ElementSelection): boolean {
  return a.tid === b.tid && a.instance === b.instance;
}

/** Whether the element's text is written in the template (so it can be edited in place). */
function textEditable(path: string, item: ElementSelection): boolean {
  const doc = useDocument.getState();
  const source = doc.boards[path]?.source;
  if (!source || doc.readOnly) return false;
  const element = resolveElement(templateOf(source), item.tid, item.path);
  return Boolean(element && isTextEditable(element));
}

function rectInside(inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }): boolean {
  return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
}

/** The child-index path of a tid in an artboard source. */
function pathOfTid(source: string, tid: number): number[] | null {
  const model = templateOf(source);
  const element = model.elements[tid];
  return element ? elementPath(model, element) : null;
}

/** The rectangle spanned by two world points. */
const spanRect = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

/** Applies a handle drag to a rect. */
function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, min: number): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes('e')) w = Math.max(min, w + dx);
  if (handle.includes('s')) h = Math.max(min, h + dy);
  if (handle.includes('w')) {
    const next = Math.max(min, w - dx);
    x += w - next;
    w = next;
  }
  if (handle.includes('n')) {
    const next = Math.max(min, h - dy);
    y += h - next;
    h = next;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Ends a running in-place text edit, committing it. */
function endTextEdit(): void {
  const { textEdit } = useView.getState();
  if (textEdit) boardApi(textEdit.board)?.endTextEdit(true);
}

/** Ends a note text edit unless the press is on that note. */
function endNoteEdit(hit: Hit): void {
  const { noteEdit } = useView.getState();
  if (noteEdit && !(hit.kind === 'note' && hit.note === noteEdit)) (document.activeElement as HTMLElement | null)?.blur();
}

export function Canvas() {
  const root = useRef<HTMLDivElement>(null);
  const engineCanvas = useRef<HTMLCanvasElement>(null);
  /** Who draws the canvas: the engine, or the DOM (`?open_artifact_engine=off`, or the engine could not start). */
  const [renderer, setRenderer] = useState<'engine' | 'dom'>(engineEnabled ? 'engine' : 'dom');
  const drag = useRef<Drag | null>(null);
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const touchTap = useRef<{ hit: Hit; target: HTMLElement; x: number; y: number } | null>(null);
  /** The element last pressed: pointer capture retargets the later click events to the root. */
  const pressed = useRef<HTMLElement | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [dropLine, setDropLine] = useState<FlowDrop | null>(null);
  /** Where Alt-dragged copies will land (the DOM's; the engine draws its own for artboards and notes). */
  const [ghosts, setGhosts] = useState<Rect[] | null>(null);
  /** Snap guides while drawing or hovering with a drawing tool, on the DOM canvas (the engine draws them on its own). */
  const [domGuides, setDomGuides] = useState<Guide[]>([]);
  const shownGuides = useRef<string>('[]');
  const showGuides = (guides: Guide[]): void => {
    const key = JSON.stringify(guides);
    if (key === shownGuides.current) return;
    shownGuides.current = key;
    const engine = activeEngine();
    if (engine) engine.setGuides(guides);
    else setDomGuides(guides);
  };
  /** The world point of the last pointer move in a drag: a key that changes the drag replays it. */
  const lastWorld = useRef<Offset | null>(null);
  const pathDraft = useRef<PathDraft | null>(null);
  const [pathShown, setPathShown] = useState<PathDraft | null>(null);
  const showPath = (next: PathDraft | null): void => {
    pathDraft.current = next;
    setPathShown(next ? { nodes: [...next.nodes], hover: next.hover } : null);
  };
  /** Finishes the Pen tool's path (closing it when asked) and puts the tool down. */
  const finishPath = (closed = false): void => {
    const draft = pathDraft.current;
    showPath(null);
    commitPath(draft, closed);
    if (useView.getState().tool === 'path') useView.getState().setTool('select');
  };

  const page = useView((s) => s.page);
  const tool = useView((s) => s.tool);
  const agentStatus = useAgent(s => s.status);
  const spacePan = useView((s) => s.spacePan);
  const canvas = useDocument((s) => s.canvas);
  const readOnly = useDocument((s) => s.readOnly);

  // The engine starts on its canvas; the DOM canvas takes over when it cannot.
  useEffect(() => {
    if (renderer !== 'engine') return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    startEngine(engineCanvas.current!, root.current!).then(
      (stopEngine) => {
        if (cancelled) stopEngine();
        else stop = stopEngine;
      },
      (error: unknown) => {
        console.warn('The canvas engine could not start; using the DOM canvas.', error);
        if (!cancelled) setRenderer('dom');
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [renderer]);

  // The Pen tool: Enter finishes the path, Escape too (dropping a lone node); another tool keeps what was drawn.
  useEffect(() => {
    if (tool !== 'path') {
      if (pathDraft.current) {
        const draft = pathDraft.current;
        showPath(null);
        commitPath(draft);
      }
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (!pathDraft.current || !endsMode(event, isTextField(event.target))) return;
      event.preventDefault();
      event.stopPropagation();
      finishPath();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only some artboards run live; the others show snapshots (services/live.ts).
  useEffect(() => startLive(renderer === 'engine' ? engineMotion : undefined), [renderer]);

  const boards = boardsOnPage(canvas, page);
  const notes = notesOnPage(canvas, page);

  // Track the viewport size for camera math.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      viewportSize.width = element.clientWidth;
      viewportSize.height = element.clientHeight;
      useView.getState().tick();
    });
    observer.observe(element);
    viewportSize.width = element.clientWidth;
    viewportSize.height = element.clientHeight;
    if (pendingFit.current && element.clientWidth > 0) {
      pendingFit.current = false;
      if (pendingFit.boards) zoomToBoards(pendingFit.boards);
      else zoomToFit();
      pendingFit.boards = null;
    }
    return () => observer.disconnect();
  }, []);

  // Wheel: pan, or zoom around the pointer with Ctrl/⌘ (and pinch, which browsers report as Ctrl+wheel).
  // The engine takes the wheel on its canvas, and is handed it over labels and note text.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) {
        const sticky = (event.target as Element)?.closest<HTMLElement>('[data-sticky-scroll]');
        if (sticky && sticky.scrollHeight > sticky.clientHeight) return;
        const engine = activeEngine();
        if (engine && event.target === engine.canvas) {
          const { left, top } = element.getBoundingClientRect();
          const hit = itemAt({ x: event.clientX - left, y: event.clientY - top });
          if (hit && 'note' in hit) {
            const note = element.querySelector<HTMLElement>(`[data-note="${CSS.escape(hit.note)}"][data-sticky-scroll]`);
            if (note && note.scrollHeight > note.clientHeight) {
              event.preventDefault();
              event.stopImmediatePropagation();
              note.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
              return;
            }
          }
        }
      }
      const engine = activeEngine();
      if (engine && event.target === engine.canvas) return;
      event.preventDefault();
      const view = useView.getState();
      const bounds = element.getBoundingClientRect();
      if (engine) {
        const unit = event.deltaMode === 1 ? 16 : 1;
        engine.input.wheel({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          dx: event.deltaX * unit,
          dy: event.deltaY * unit,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          shift: event.shiftKey,
        });
      } else if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025));
        view.setCamera(zoomAt(view.camera, view.camera.zoom * factor, event.clientX - bounds.left, event.clientY - bounds.top));
      } else {
        const scale = event.deltaMode === 1 ? 16 : 1;
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        view.setCamera({ ...view.camera, x: view.camera.x - dx * scale, y: view.camera.y - dy * scale });
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => element.removeEventListener('wheel', onWheel, true);
  }, []);

  // Right-button drag pans, leaving the selection alone; a right-click without travel opens the menu as before.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    return installRightDragPan(element, {
      pan(dx, dy) {
        const engine = activeEngine();
        if (engine) {
          engine.panBy(-dx, -dy);
          return;
        }
        const view = useView.getState();
        view.setCamera({ ...view.camera, x: view.camera.x + dx, y: view.camera.y + dy });
      },
    });
  }, []);

  /** Screen point relative to the canvas element. */
  const local = (event: { clientX: number; clientY: number }) => {
    const bounds = root.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const worldOf = (event: { clientX: number; clientY: number }) => {
    const point = local(event);
    return toWorld(liveCamera(), point.x, point.y);
  };
  /** What is under the pointer: the engine's hit test on its canvas, DOM markers elsewhere. */
  const hitOf = (target: EventTarget, event: { clientX: number; clientY: number }): Hit => {
    const engine = activeEngine();
    return engine && target === engine.canvas ? engineHit(local(event)) : domHit(target as HTMLElement);
  };

  const selectObject = (hit: Extract<Hit, { kind: 'note' | 'title' }>): void => {
    const view = useView.getState();
    const objects = selectedObjects(view);
    if (hit.kind === 'title') {
      if (!objects.boards.includes(hit.board)) view.select({ kind: 'objects', boards: [hit.board], notes: [] });
    } else if (!objects.notes.includes(hit.note)) {
      const notes = expandNotesToGroups(groupItems(useDocument.getState().canvas), [hit.note], objects.notes);
      view.select({ kind: 'objects', boards: [], notes });
    }
  };

  /** Right-click: what is under the pointer joins the selection before the menu opens. */
  const selectForMenu = (event: ReactPointerEvent<HTMLDivElement>, hit: Hit): void => {
    const view = useView.getState();
    const selection = view.selection;
    const objects = selectedObjects(view);
    setMenuPoint(null);
    if (hit.kind === 'note' || hit.kind === 'title') {
      selectObject(hit);
      return;
    }
    const board = hit.kind === 'board' ? hit.board : undefined;
    setMenuPoint(board ? { board, world: worldOf(event) } : null);
    if (!board) return;
    if (objects.boards.includes(board)) return;
    // A locked element is picked too: its menu unlocks it.
    const picked = pickElement(board, worldOf(event), event.metaKey || event.ctrlKey ? 'deep' : 'click', { locked: true });
    if (!picked) {
      view.select({ kind: 'objects', boards: [board], notes: [] });
      return;
    }
    const has = elementsIn(selection, board).some((item) => item.tid === picked.tid);
    if (!has) view.select({ kind: 'elements', board, items: [picked] });
  };

  // Both renderers share touch navigation. Delay selection until release so a
  // swipe or a second finger cannot start moving the element under the hand.
  const startTouch = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
    if (event.pointerType !== 'touch') return false;
    const target = event.target as HTMLElement;
    const view = useView.getState();
    const point = local(event);
    const hit = hitOf(target, event);
    if (!fingers.current.size) {
      if (view.tool !== 'select' && view.tool !== 'hand') return false;
      if (target.closest('button, a, input, textarea, [contenteditable="true"], [role="button"]')) return false;
      if (drag.current || view.crop || view.playing || view.noteEdit) return false;
      if (view.tool === 'select') {
        const objects = selectedObjects(view);
        if (hit.kind === 'handle' || activeEngine()?.hitHandle(point)) return false;
        if (hit.kind === 'note' && objects.notes.includes(hit.note)) return false;
        if ((hit.kind === 'title' || hit.kind === 'board') && objects.boards.includes(hit.board)) return false;
      }
      if (view.tool === 'select' && hit.kind === 'board') {
        const items = elementsIn(view.selection, hit.board);
        const picked = items.length ? pickElement(hit.board, worldOf(event), 'click') : null;
        if (picked && items.some(item => sameElement(item, picked))) return false;
      }
      touchTap.current = { hit, target, ...point };
    } else touchTap.current = null;
    fingers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    return true;
  };

  const moveTouch = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const points = fingers.current;
    const previous = points.get(event.pointerId);
    if (!previous) return;
    event.stopPropagation();
    const next = local(event);
    const tap = touchTap.current;
    if (tap && staysTap(tap, next)) return;
    touchTap.current = null;
    const pair = [...points.keys()].slice(0, 2);
    points.set(event.pointerId, next);
    if (!pair.includes(event.pointerId)) return;
    const otherId = pair.find(id => id !== event.pointerId);
    const other = otherId === undefined ? undefined : points.get(otherId);
    let camera = useView.getState().camera;
    if (other) {
      const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
      if (distance < 1) return;
      const ratio = Math.hypot(next.x - other.x, next.y - other.y) / distance;
      camera = zoomAt(camera, camera.zoom * ratio, (previous.x + other.x) / 2, (previous.y + other.y) / 2);
    }
    const count = pair.length;
    useView.getState().setCamera({ ...camera, x: camera.x + (next.x - previous.x) / count, y: camera.y + (next.y - previous.y) / count });
  };

  const endTouch = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!fingers.current.delete(event.pointerId)) return;
    event.stopPropagation();
    const tap = touchTap.current;
    touchTap.current = null;
    if (!tap || event.type !== 'pointerup' || useView.getState().tool !== 'select') return;
    pressed.current = tap.target;
    endTextEdit();
    endNoteEdit(tap.hit);
    const view = useView.getState();
    if (tap.hit.kind === 'empty') view.select(NO_SELECTION);
    if (tap.hit.kind === 'title' || tap.hit.kind === 'note') selectObject(tap.hit);
    if (tap.hit.kind === 'board') {
      const board = tap.hit.board;
      const item = pickElement(board, worldOf(event), 'click');
      view.select(item ? { kind: 'elements', board, items: [item] } : { kind: 'objects', boards: [board], notes: [] });
    }
  };

  /**
   * Presses on the engine's canvas, before it sees them: the engine runs the
   * ones it takes (with the selection a press makes in place first, so a
   * drag moves what was pressed); the others are stopped and handled here.
   */
  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (startTouch(event)) return;
    const engine = activeEngine();
    if (!engine || event.target !== engine.canvas) return;
    const point = local(event);
    const view = useView.getState();
    // On the selected item's resize handles the engine resizes, whatever lies beneath.
    const hit = event.button === 0 && view.tool === 'select' && !view.spacePan && engine.hitHandle(point) ? null : engineHit(point);
    pressed.current = engine.canvas;
    if (hit && !engineTakes(event, hit, toWorld(liveCamera(), point.x, point.y))) {
      event.stopPropagation();
      begin(event, hit);
      return;
    }
    endTextEdit();
    endNoteEdit(hit ?? { kind: 'empty' });
    if (!hit || event.button !== 0 || event.shiftKey || view.spacePan || view.tool !== 'select') return;
    const objects = selectedObjects(view);
    if (hit.kind === 'empty') {
      // The engine clears a selection of objects itself; elements are not its own.
      if (view.selection.kind === 'elements' || view.selection.kind === 'mixed') view.select(NO_SELECTION);
    } else if (hit.kind === 'board' && !objects.boards.includes(hit.board)) {
      view.select({ kind: 'objects', boards: [hit.board], notes: [] });
    } else if (hit.kind === 'note' && !objects.notes.includes(hit.note)) {
      // A grouped note brings its whole group, unless the selection has stepped into that group.
      view.select({ kind: 'objects', boards: [], notes: expandNotesToGroups(groupItems(useDocument.getState().canvas), [hit.note], objects.notes) });
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Presses on the engine's canvas were routed before it saw them.
    if (event.target === activeEngine()?.canvas) return;
    begin(event, domHit(event.target as HTMLElement));
  };

  /** Starts what a press does here, given what it landed on. */
  const begin = (event: ReactPointerEvent<HTMLDivElement>, hit: Hit): void => {
    useView.getState().setHoverObject(null);
    if (event.button === 2) {
      endTextEdit();
      selectForMenu(event, hit);
      return;
    }
    const view = useView.getState();
    const doc = useDocument.getState();
    pressed.current = event.target as HTMLElement;
    const point = local(event);
    const camera = liveCamera();
    const world = toWorld(camera, point.x, point.y);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events carry no capturable pointer.
    }
    endTextEdit();
    endNoteEdit(hit);

    // Pan: middle button, Space held, or the hand tool.
    if (event.button === 1 || view.spacePan || view.tool === 'hand') {
      drag.current = { kind: 'pan', startX: point.x, startY: point.y, camera };
      return;
    }

    // Creation tools.
    if (view.tool !== 'select' && !doc.readOnly) {
      if (view.tool === 'sticky' || view.tool === 'title') {
        addNote(view.tool === 'title' ? 'title1' : 'sticky', world);
        view.setTool('select');
        drag.current = null;
        return;
      }
      if (view.tool === 'image') {
        drag.current = null;
        view.setTool('select');
        pickImages(world);
        return;
      }
      if (view.tool === 'path') {
        const draft = pathDraft.current ?? { nodes: [], hover: null };
        const first = draft.nodes[0];
        if (first && draft.nodes.length >= 2 && Math.hypot(world.x - first.x, world.y - first.y) * camera.zoom <= CLOSE_RADIUS) {
          drag.current = null;
          finishPath(true);
          return;
        }
        showPath({ nodes: [...draft.nodes, { x: Math.round(world.x), y: Math.round(world.y) }], hover: null });
        drag.current = { kind: 'pathHandle', startX: world.x, startY: world.y };
        return;
      }
      // The press snaps to the artboards and notes around it (not the Pen, ⌘ / Ctrl not held).
      const targets = view.tool === 'pen' ? { xs: [], ys: [] } : drawTargets();
      const start = drawStart(targets, world, view.tool === 'pen' ? null : snapReach(keysOf(event)));
      lastWorld.current = world;
      drag.current = { kind: 'create', tool: view.tool, startX: world.x, startY: world.y, ...(view.tool === 'pen' ? { points: [[0, 0]] as [number, number][] } : {}), start, targets };
      if (view.tool !== 'pen') showGuides(hoverGuides(targets, world, snapReach(keysOf(event))));
      return;
    }

    // Resize handles drawn by the overlay (the DOM canvas; the engine draws its own).
    if (hit.kind === 'handle' && !doc.readOnly) {
      const { target } = hit;
      const note = 'note' in target ? doc.canvas.notes[target.note] : undefined;
      const rect = 'board' in target ? doc.canvas.boards[target.board] : note ? noteBounds(note) : undefined;
      if ('board' in target ? isLockedObject(rect as BoardEntry | undefined) : isLockedObject(note)) {
        refuseLocked();
        drag.current = null;
        return;
      }
      if (rect) {
        doc.beginGesture();
        drag.current = { kind: 'resize', handle: hit.handle, target, startX: world.x, startY: world.y, base: doc.canvas, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
        return;
      }
    }

    const selection = view.selection;
    const objects = selectedObjects(view);

    /**
     * Selects an object (Shift toggles) and starts moving the selection. A
     * grouped note brings its whole group, unless the selection has stepped
     * into that group.
     */
    const grab = (item: { board?: string; note?: string }): void => {
      const has = item.board ? objects.boards.includes(item.board) : objects.notes.includes(item.note!);
      const notes = item.note ? expandNotesToGroups(groupItems(doc.canvas), [item.note], objects.notes) : [];
      // Shift adds or takes away and keeps the elements selected with them.
      if (event.shiftKey) {
        if (item.board) shiftBoard(item.board);
        else shiftNotes(notes, has);
      } else if (!has) {
        view.select(item.board ? { kind: 'objects', boards: [item.board], notes: [] } : { kind: 'objects', boards: [], notes });
      }
      if (doc.readOnly) return;
      // A locked item is selected but stays put; locked items in the selection stay behind.
      // An Alt-drag copies them all, locked ones too.
      if (!event.altKey && (item.board ? isLockedObject(doc.canvas.boards[item.board]) : isLockedObject(doc.canvas.notes[item.note!]))) {
        drag.current = null;
        return;
      }
      const after = useView.getState().selection;
      if (after.kind === 'mixed') {
        drag.current = { kind: 'mixedMove', startX: world.x, startY: world.y, moved: false, applied: { x: 0, y: 0 }, key: `drag-${Date.now()}`, click: null, copy: false, offset: { x: 0, y: 0 }, ghostBase: null };
        return;
      }
      const next = selectedObjects(useView.getState());
      const free = unlockedObjects(doc.canvas, next.boards, next.notes);
      // The engine moves what it draws (snapping, Shift locking the axis) and commits the move.
      const kept = item.board ? next.boards.includes(item.board) : next.notes.includes(item.note!);
      if (kept && startEngineMove(item.board ? { board: item.board } : { note: item.note! }, event.nativeEvent, point)) drag.current = null;
      else drag.current = { kind: 'move', startX: world.x, startY: world.y, base: doc.canvas, boards: free.boards, notes: free.notes, all: next, ghostBase: objectRects(doc.canvas, next.boards, next.notes), moved: false, copy: false, offset: { x: 0, y: 0 } };
    };

    if (hit.kind === 'title') {
      grab({ board: hit.board });
      return;
    }
    if (hit.kind === 'note') {
      if (view.noteEdit === hit.note) return;
      grab({ note: hit.note });
      return;
    }
    if (hit.kind === 'board') {
      const path = hit.board;
      const deep = event.metaKey || event.ctrlKey;
      // A selected artboard moves as a whole; otherwise a click selects inside it.
      if (objects.boards.includes(path) && !deep) {
        grab({ board: path });
        return;
      }
      // A plain click goes on to the text under the pointer; a shift-click
      // adds at the selection's level.
      const picked = pickElement(path, world, deep ? 'deep' : event.shiftKey ? 'plain' : 'click');
      if (!picked) {
        grab({ board: path });
        return;
      }
      const current = elementsIn(selection, path);
      const inSelection = current.some((item) => item.tid === picked.tid);
      const toggle = (): void => {
        shiftElement(path, picked);
      };
      const root = rootAddress(path);
      const onRoot = root?.tid === picked.tid;

      // ⌘-drag selects any element fully inside the box; a press on the
      // artboard's own background boxes its direct children.
      if (deep || (onRoot && !inSelection)) {
        const click = (): void => {
          if (event.shiftKey) toggle();
          else view.select({ kind: 'elements', board: path, items: [picked] });
        };
        drag.current = {
          kind: 'elementMarquee',
          board: path,
          startX: world.x,
          startY: world.y,
          deep,
          toggle: event.shiftKey,
          candidates: null,
          container: deep ? null : root,
          initial: current,
          base: event.shiftKey ? selection : NO_SELECTION,
          click,
          moved: false,
        };
        return;
      }

      if (event.shiftKey) {
        toggle();
        drag.current = null;
        return;
      }
      if (!inSelection) view.select({ kind: 'elements', board: path, items: [picked] });
      if (doc.readOnly || onRoot) {
        drag.current = null;
        return;
      }
      if (inSelection && selection.kind === 'mixed') {
        // A press on one member moves them all; a click narrows to it.
        const only = (): void => view.select({ kind: 'elements', board: path, items: [picked] });
        drag.current = { kind: 'mixedMove', startX: world.x, startY: world.y, moved: false, applied: { x: 0, y: 0 }, key: `drag-${Date.now()}`, click: only, copy: false, offset: { x: 0, y: 0 }, ghostBase: null };
        return;
      }
      // Pressing one of several selected elements narrows to it on release.
      const narrow = inSelection && current.length > 1 ? () => view.select({ kind: 'elements', board: path, items: [picked] }) : null;
      drag.current = { kind: 'elementMove', board: path, startX: world.x, startY: world.y, moved: false, positioned: false, applied: { x: 0, y: 0 }, drop: null, key: `drag-${Date.now()}`, click: narrow, copy: false, locked: false, offset: { x: 0, y: 0 }, ghostBase: null };
      return;
    }

    // Empty canvas: marquee.
    drag.current = { kind: 'marquee', startX: world.x, startY: world.y, additive: event.shiftKey, initial: objects, base: event.shiftKey ? selection : NO_SELECTION };
    if (!event.shiftKey) view.select(NO_SELECTION);
  };

  const hoverFrame = useRef(0);
  /**
   * One step of a drag that follows the pointer and the keys: moves (Alt
   * turning them into copies that land where the ghosts are), and drawing.
   * Pointer moves run it, and so do the keys that change it.
   */
  const dragStep = (current: Extract<Drag, { kind: 'move' | 'mixedMove' | 'elementMove' | 'create' }>, world: Offset, keys: DragKeys): void => {
    const view = useView.getState();
    const doc = useDocument.getState();
    const camera = liveCamera();
    const far = (dx: number, dy: number) => Math.hypot(dx, dy) * camera.zoom >= DRAG_THRESHOLD;
    switch (current.kind) {
      case 'move': {
        let dx = world.x - current.startX;
        let dy = world.y - current.startY;
        if (!current.moved && !far(dx, dy)) return;
        if (!current.moved) {
          current.moved = true;
          doc.beginGesture();
        }
        // Shift keeps the move across, upright or on a diagonal.
        if (keys.shift) ({ x: dx, y: dy } = shiftDragDelta(dx, dy));
        current.offset = { x: Math.round(dx), y: Math.round(dy) };
        current.copy = keys.alt;
        if (keys.alt) {
          doc.updateCanvas(() => current.base);
          setGhosts(shifted(current.ghostBase, current.offset));
        } else {
          setGhosts(null);
          doc.updateCanvas(() => moveObjects(current.base, current.boards, current.notes, dx, dy));
        }
        break;
      }
      case 'mixedMove': {
        let dx = world.x - current.startX;
        let dy = world.y - current.startY;
        if (!current.moved && !far(dx, dy)) return;
        const selection = view.selection;
        if (selection.kind !== 'mixed') return;
        if (!current.moved) {
          current.moved = true;
          current.click = null;
          view.setHover(null);
          current.ghostBase = [...objectRects(doc.canvas, selection.boards, selection.notes), ...selection.elements.flatMap((group) => elementWorldRects(group.board, group.items))];
        }
        if (keys.shift) ({ x: dx, y: dy } = shiftDragDelta(dx, dy));
        const x = Math.round(dx);
        const y = Math.round(dy);
        current.offset = { x, y };
        current.copy = keys.alt;
        // Each step joins the drag's one undo step; a copy puts the originals back first.
        const to = keys.alt ? { x: 0, y: 0 } : { x, y };
        if ((to.x !== current.applied.x || to.y !== current.applied.y) && moveMixed(selection, to.x - current.applied.x, to.y - current.applied.y, { key: current.key })) current.applied = to;
        setGhosts(keys.alt ? shifted(current.ghostBase ?? [], current.offset) : null);
        break;
      }
      case 'elementMove': {
        const dx = world.x - current.startX;
        const dy = world.y - current.startY;
        if (!current.moved && !far(dx, dy)) return;
        const selection = view.selection;
        if (selection.kind !== 'elements' || selection.board !== current.board) return;
        if (!current.moved) {
          current.moved = true;
          current.click = null;
          current.positioned = selectionIsPositioned();
          current.pinned = current.positioned ? selectionPinnedAxes() : undefined;
          current.ghostBase = elementWorldRects(current.board, selection.items);
          view.setHover(null);
          // Positioned elements move without the locked ones; in the flow nothing moves when any is locked.
          // An Alt-drag copies them all.
          current.locked = selectionHasLock() && (!current.positioned || !selectionHasUnlocked(current.board, selection.items));
          if (current.locked && !keys.alt) {
            drag.current = null;
            refuseLocked();
            return;
          }
        }
        current.copy = keys.alt;
        if (current.positioned) {
          // Shift keeps the move on one of eight directions; an element set
          // from both sides on an axis never moves along it.
          let { x, y } = keys.shift ? shiftDragDelta(Math.round(dx), Math.round(dy)) : { x: Math.round(dx), y: Math.round(dy) };
          if (current.pinned?.x) x = 0;
          if (current.pinned?.y) y = 0;
          current.offset = { x, y };
          // A copy puts the originals back first; locked ones stay.
          const to = keys.alt || current.locked ? { x: 0, y: 0 } : { x, y };
          if (to.x !== current.applied.x || to.y !== current.applied.y) {
            if (moveSelectedElements(to.x - current.applied.x, to.y - current.applied.y, { coalesce: current.key })) current.applied = to;
          }
        } else {
          current.offset = { x: Math.round(dx), y: Math.round(dy) };
          current.drop = flowDropAt(current.board, selection.items, world);
          setDropLine(current.drop);
        }
        setGhosts(keys.alt ? shifted(current.ghostBase ?? [], current.offset) : null);
        break;
      }
      case 'create': {
        const from = { x: current.startX, y: current.startY };
        if (current.points) {
          const last = current.points[current.points.length - 1]!;
          const dx = world.x - current.startX;
          const dy = world.y - current.startY;
          // Keep a point every couple of screen pixels.
          if (Math.hypot(dx - last[0], dy - last[1]) * camera.zoom >= 2) current.points.push([Math.round(dx), Math.round(dy)]);
          setDraft({ tool: current.tool, rect: spanRect(from, world), from, to: world, points: [...current.points] });
          break;
        }
        if (current.tool === 'pen') break;
        const span = drawSpan(current.targets, current.start, world, { tool: current.tool, shift: keys.shift, threshold: snapReach(keys) });
        setDraft({ tool: current.tool, rect: current.tool === 'board' && drewShape(span, { tool: 'board', shift: keys.shift, zoom: camera.zoom }) ? drawnBoard(span.from, span.to) : spanBox(span), from: span.from, to: span.to });
        showGuides(span.guides);
        break;
      }
    }
  };

  /**
   * Escape drops a drag that follows the pointer: what moved goes back, and
   * nothing is drawn or copied. Returns whether there was one.
   */
  const cancelDrag = (): boolean => {
    const current = drag.current;
    if (!current || (current.kind !== 'move' && current.kind !== 'mixedMove' && current.kind !== 'elementMove' && current.kind !== 'create')) return false;
    drag.current = null;
    lastWorld.current = null;
    const doc = useDocument.getState();
    const { selection } = useView.getState();
    if (current.kind === 'move' && current.moved) {
      doc.updateCanvas(() => current.base);
      doc.endGesture();
    } else if (current.kind === 'mixedMove' && selection.kind === 'mixed' && (current.applied.x || current.applied.y)) {
      moveMixed(selection, -current.applied.x, -current.applied.y, { key: current.key });
    } else if (current.kind === 'elementMove' && current.positioned && (current.applied.x || current.applied.y)) {
      moveSelectedElements(-current.applied.x, -current.applied.y, { coalesce: current.key });
    }
    setDraft(null);
    setDropLine(null);
    setGhosts(null);
    showGuides([]);
    useView.getState().tick();
    return true;
  };
  const dragKeys = useRef({ step: dragStep, cancel: cancelDrag });
  dragKeys.current = { step: dragStep, cancel: cancelDrag };

  // While a drag runs: Escape drops it, and Alt, Shift and ⌘ / Ctrl change it without waiting for the pointer to move.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const current = drag.current;
      if (!current) return;
      if (event.type === 'keydown' && event.key === 'Escape') {
        if (!dragKeys.current.cancel()) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!['Alt', 'Shift', 'Meta', 'Control'].includes(event.key) || !lastWorld.current) return;
      if (current.kind === 'move' || current.kind === 'mixedMove' || current.kind === 'elementMove' || current.kind === 'create') {
        if (event.key === 'Alt') event.preventDefault();
        dragKeys.current.step(current, lastWorld.current, keysOf(event));
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, []);

  // Hover guides belong to the drawing tool that showed them.
  useEffect(() => {
    if (!isDrawTool(tool)) showGuides([]);
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    const view = useView.getState();
    if (!current && view.tool === 'path' && pathDraft.current) {
      showPath({ ...pathDraft.current, hover: worldOf(event) });
      return;
    }
    if (current?.kind === 'pathHandle') {
      const draft = pathDraft.current;
      if (!draft?.nodes.length) return;
      const world = worldOf(event);
      const dx = world.x - current.startX;
      const dy = world.y - current.startY;
      const last = draft.nodes[draft.nodes.length - 1]!;
      // A drag past the threshold pulls out symmetric handles (a smooth node); a click leaves a corner.
      const node: BezierNode = Math.hypot(dx, dy) * liveCamera().zoom > DRAG_THRESHOLD ? { x: last.x, y: last.y, out: [Math.round(dx), Math.round(dy)], in: [-Math.round(dx), -Math.round(dy)] } : { x: last.x, y: last.y };
      showPath({ nodes: [...draft.nodes.slice(0, -1), node], hover: null });
      return;
    }
    if (!current) {
      // The pointer carries Alt too: keys pressed while an artboard frame has focus don't reach this window.
      view.setAltHeld(event.altKey);
      // A drawing tool shows the lines a press here would snap to (not over an artboard's page or the editor's controls).
      if (isDrawTool(view.tool) && !event.buttons && !useDocument.getState().readOnly && overCanvas(event.target)) showGuides(hoverGuides(drawTargets(), worldOf(event), snapReach(keysOf(event))));
      else showGuides([]);
      // Hover highlight inside artboards (throttled to one pick per frame); none while the engine drags.
      if (view.tool !== 'select' || view.textEdit || event.buttons) {
        view.setHoverObject(null);
        return;
      }
      const target = event.target;
      const clientX = event.clientX;
      const clientY = event.clientY;
      const touch = event.pointerType === 'touch';
      cancelAnimationFrame(hoverFrame.current);
      hoverFrame.current = requestAnimationFrame(() => {
        const hit = hitOf(target, { clientX, clientY });
        // The artboard or note under the pointer gets a hover ring (not under a finger).
        view.setHoverObject(touch ? null : hit.kind === 'note' ? { note: hit.note } : hit.kind === 'board' || hit.kind === 'title' ? { board: hit.board } : null);
        const board = hit.kind === 'board' ? hit.board : undefined;
        if (!board) {
          view.setHover(null);
          return;
        }
        const picked = pickElement(board, worldOf({ clientX, clientY }), event.metaKey || event.ctrlKey ? 'deep' : 'click');
        view.setHover(picked ? { board, tid: picked.tid, instance: picked.instance } : null);
      });
      return;
    }
    const point = local(event);
    const camera = liveCamera();
    const world = toWorld(camera, point.x, point.y);
    const doc = useDocument.getState();
    switch (current.kind) {
      case 'pan':
        view.setCamera({ ...current.camera, x: current.camera.x + point.x - current.startX, y: current.camera.y + point.y - current.startY });
        break;
      case 'move':
      case 'mixedMove':
      case 'elementMove':
      case 'create':
        lastWorld.current = world;
        dragStep(current, world, keysOf(event));
        break;
      case 'resize': {
        const dx = world.x - current.startX;
        const dy = world.y - current.startY;
        const min = 'board' in current.target ? MIN_BOARD_SIZE : 16;
        const next = resizeRect(current.rect, current.handle, dx, dy, min);
        doc.updateCanvas(() => resizeObject(current.base, current.target, next));
        break;
      }
      case 'marquee': {
        const rect = spanRect({ x: current.startX, y: current.startY }, world);
        setMarquee(rect);
        const canvasNow = doc.canvas;
        // Locked artboards are left out.
        const hitBoards = boardsOnPage(canvasNow, view.page).filter((p) => !isLockedObject(canvasNow.boards[p]) && intersects(rect, canvasNow.boards[p]!));
        const touched = notesOnPage(canvasNow, view.page).filter((id) => intersects(rect, noteBounds(canvasNow.notes[id]!)));
        // A box touching one note of a group selects the whole group.
        const hitNotes = touched.length ? expandNotesToGroups(groupItems(canvasNow), touched, current.initial.notes) : touched;
        // With Shift the box adds to what was selected, elements included.
        view.select(withObjects(current.base, hitBoards, hitNotes));
        break;
      }
      case 'elementMarquee': {
        if (!current.moved && Math.hypot(world.x - current.startX, world.y - current.startY) * camera.zoom < DRAG_THRESHOLD) return;
        if (!current.moved) {
          current.moved = true;
          current.candidates = marqueeCandidates(current.board, current.container);
          view.setHover(null);
        }
        const rect = spanRect({ x: current.startX, y: current.startY }, world);
        setMarquee(rect);
        const items = combineSelection(current.initial, marqueeHits(current.candidates ?? [], rect, current.deep), current.toggle);
        view.select(withBoardElements(current.base, current.board, items));
        break;
      }
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    // The keys held at release decide: a last step with them (Alt let go just before is a move).
    if (current && (current.kind === 'move' || current.kind === 'mixedMove' || current.kind === 'elementMove') && current.moved) dragStep(current, worldOf(event), keysOf(event));
    drag.current = null;
    lastWorld.current = null;
    if (root.current?.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId);
    setMarquee(null);
    setDraft(null);
    setDropLine(null);
    setGhosts(null);
    showGuides([]);
    // A step at release can end the drag (a locked selection let go without Alt).
    if (!current || (current.kind === 'elementMove' && current.moved && current.locked && !current.copy)) {
      if (current?.kind === 'elementMove') refuseLocked();
      return;
    }
    const doc = useDocument.getState();
    const view = useView.getState();
    const offsetSet = (offset: Offset) => offset.x !== 0 || offset.y !== 0;
    if (current.kind === 'pathHandle') return;
    if (current.kind === 'elementMarquee') {
      if (!current.moved) current.click();
      return;
    }
    if (current.kind === 'mixedMove') {
      if (!current.moved) current.click?.();
      else if (current.copy && view.selection.kind === 'mixed' && offsetSet(current.offset)) copyMixed(view.selection, current.offset.x, current.offset.y, current.key);
      else view.tick();
      return;
    }
    if (current.kind === 'elementMove') {
      if (!current.moved) {
        current.click?.();
        return;
      }
      const selection = view.selection;
      if (selection.kind !== 'elements' || selection.board !== current.board) return;
      if (current.drop) {
        // Moving to another parent keeps the inherited text styles (one undo step with the move).
        const frozen = freezeInherited(current.board, selection.items, current.drop);
        if (current.copy) {
          copySelectedElements({ target: current.drop.target, position: current.drop.position, frozen }, current.key);
          return;
        }
        if (frozen.length) edit(current.board, { kind: 'styles', edits: frozen }, { coalesce: current.key });
        edit(current.board, { kind: 'move', targets: selection.items.map(({ tid, path }) => ({ tid, path })), target: current.drop.target, position: current.drop.position }, { selectCreated: true, coalesce: frozen.length ? current.key : undefined });
      } else if (current.copy && current.positioned && offsetSet(current.offset)) {
        copySelectedElements({ dx: current.offset.x, dy: current.offset.y }, current.key);
      }
      return;
    }
    if (current.kind === 'move') {
      doc.endGesture();
      if (current.moved && current.copy && offsetSet(current.offset)) copyObjects(current.all.boards, current.all.notes, current.offset.x, current.offset.y);
      view.tick();
      return;
    }
    if (current.kind === 'resize') {
      doc.endGesture();
      view.tick();
      return;
    }
    if (current.kind !== 'create') return;
    const world = worldOf(event);
    const { zoom } = liveCamera();
    if (current.tool === 'pen') {
      if (current.points && current.points.length > 1) {
        const { stroke, dash } = useView.getState().pen;
        addNote('pen', { x: current.startX, y: current.startY }, { points: current.points, ...(stroke !== 3 ? { stroke } : {}), ...(dash !== 'solid' ? { dash } : {}) });
      }
      // The pen stays armed for the next stroke.
      return;
    }
    const keys = keysOf(event);
    const span = drawSpan(current.targets, current.start, world, { tool: current.tool, shift: keys.shift, threshold: snapReach(keys) });
    const drew = drewShape(span, { tool: current.tool, shift: keys.shift, zoom });
    // A click puts the default size at the (snapped) press point.
    const at = current.start.at;
    switch (current.tool) {
      case 'board':
        if (drew) {
          const box = drawnBoard(span.from, span.to);
          addBoard({ x: box.x, y: box.y }, { w: box.w, h: box.h });
        } else addBoard(at);
        break;
      case 'rect':
      case 'oval': {
        if (!drew) {
          addNote(current.tool, at, { w: 160, h: 100 });
          break;
        }
        // Rounded edges, so a snapped edge stays on its line.
        const box = spanBox(span);
        const x = Math.round(box.x);
        const y = Math.round(box.y);
        addNote(current.tool, { x, y }, { w: Math.max(1, Math.round(box.x + box.w) - x), h: Math.max(1, Math.round(box.y + box.h) - y) });
        break;
      }
      case 'line':
      case 'arrow': {
        const end = drew ? span.to : { x: at.x + 160, y: at.y };
        const from = { x: Math.round(at.x), y: Math.round(at.y) };
        addNote(current.tool, from, { points: [[0, 0], [Math.round(end.x) - from.x, Math.round(end.y) - from.y]] });
        break;
      }
    }
    view.setTool('select');
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const view = useView.getState();
    const doc = useDocument.getState();
    if (doc.readOnly) return;
    if (view.tool === 'path') {
      // The double-click's first press placed a node; its second, a duplicate of it.
      const draft = pathDraft.current;
      if (draft && draft.nodes.length > 2) showPath({ nodes: draft.nodes.slice(0, -1), hover: null });
      finishPath();
      return;
    }
    const hit = hitOf(pressed.current ?? event.target, event);
    if (hit.kind === 'note') {
      const id = hit.note;
      const note = doc.canvas.notes[id];
      // Double-click on a grouped note steps one group in, then edits it.
      const selected = selectedNotesOf(view.selection);
      const inside = enterNoteGroup(groupItems(doc.canvas), id, selected);
      if (inside) {
        view.select({ kind: 'objects', boards: [], notes: inside });
        return;
      }
      if (note && note.kind !== 'image' && note.kind !== 'pen' && note.kind !== 'line' && note.kind !== 'arrow') view.setNoteEdit(id);
      return;
    }
    if (hit.kind === 'board') {
      const board = hit.board;
      const world = worldOf(event);
      const deep = event.metaKey || event.ctrlKey;
      const current = useView.getState().selection;
      const single = current.kind === 'elements' && current.board === board && current.items.length === 1 ? current.items[0]! : null;
      //
      // level, so a double-click on the one selected text element edits it;
      // anywhere else it goes one level deeper under the pointer.
      const plain = pickElement(board, world, deep ? 'deep' : 'click');
      if (single && plain && sameElement(plain, single) && textEditable(board, single)) {
        startTextEdit(board, single);
        return;
      }
      const picked = pickElement(board, world, deep ? 'deep' : 'deeper');
      if (!picked) return;
      if (single && sameElement(picked, single)) {
        // Nothing deeper: edit it when it holds its own text; otherwise the words under the pointer.
        const entry = doc.canvas.boards[board];
        if (textEditable(board, picked)) startTextEdit(board, picked);
        else if (entry) editTextAt(board, picked, { x: world.x - entry.x, y: world.y - entry.y });
        return;
      }
      view.select({ kind: 'elements', board, items: [picked] });
      return;
    }
    if (hit.kind === 'empty') addNote('sticky', worldOf(event));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (useDocument.getState().readOnly) return;
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'));
    const world = worldOf(event);
    const hit = [...boards].reverse().find(path => {
      const b = canvas.boards[path]!;
      return world.x >= b.x && world.y >= b.y && world.x < b.x + b.w && world.y < b.y + b.h;
    });
    if (files.length) void placeImages(files, world, hit);
  };

  const cursor = spacePan || tool === 'hand' ? (drag.current?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : 'crosshair';

  return (
    <CanvasMenu>
    <div
      ref={root}
      data-canvas-surface=""
      // Home for F6 and Escape: the canvas takes the focus itself.
      data-focus-region="canvas"
      tabIndex={-1}
      // The engine sets its canvas' cursor; creation tools keep the crosshair over it (styles.css).
      data-tool-cursor={tool !== 'select' && tool !== 'hand' ? '' : undefined}
      className="relative isolate size-full touch-none select-none overflow-hidden bg-canvas outline-none data-[focus-ring]:focus:outline-solid data-[focus-ring]:focus:outline-2 data-[focus-ring]:focus:-outline-offset-2 data-[focus-ring]:focus:outline-chrome-accent"
      style={{ cursor }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMoveCapture={moveTouch}
      onPointerUpCapture={endTouch}
      onPointerCancelCapture={endTouch}
      onLostPointerCaptureCapture={endTouch}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        useView.getState().setHover(null);
        useView.getState().setHoverObject(null);
        if (!drag.current) showGuides([]);
      }}
      onPointerOut={(event) => {
        // Into an artboard's page: its events no longer reach the canvas.
        if (!drag.current && (event.relatedTarget === null || (event.relatedTarget instanceof Element && event.relatedTarget.tagName === 'IFRAME'))) showGuides([]);
      }}
      onDoubleClick={onDoubleClick}
      onDragOver={(event) => {
        if (!readOnly) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      {renderer === 'engine' ? (
        <>
          <LiveBoards boards={boards} />
          <canvas ref={engineCanvas} data-canvas-engine="" className="absolute inset-0 z-[1] size-full" />
          <NoteText notes={notes} />
        </>
      ) : (
        <DomWorld boards={boards} notes={notes} />
      )}
      <CommentCapture />
      <CameraFollow>
        <Overlay boards={boards} notes={notes} engine={renderer === 'engine'} />
        <PresenceLayer />
        <CommentPins />
        {marquee ? <ScreenRect rect={marquee} className="border border-accent bg-accent/10" /> : null}
        {dropLine ? <DropLine drop={dropLine} /> : null}
        {draft ? <Draft draft={draft} /> : null}
        {ghosts ? <Ghosts rects={ghosts} /> : null}
        {renderer === 'dom' && domGuides.length ? <SnapGuides guides={domGuides} /> : null}
        {pathShown ? <PathDraftView draft={pathShown} /> : null}
        <NodeEditor />
        <CropOverlay />
      </CameraFollow>
      {boards.length === 0 && notes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center text-[13px] text-fg-subtle">
          {agentStatus.busy ? `${agentStatus.name} is working…` : readOnly ? 'This page is empty.' : 'Press B and drag to add an artboard, or ask your agent to design something.'}
        </div>
      ) : null}
    </div>
    </CanvasMenu>
  );
}

/** Follow prototype links on the canvas, including links across pages. */
function playTarget(path: string): void {
  const { canvas } = useDocument.getState();
  const entry = canvas.boards[path];
  if (!entry) { toast.add({ title: 'That artboard is not on the canvas', description: path }); return; }
  const view = useView.getState();
  view.setPage(pageOf(canvas, entry));
  view.play(path);
  zoomToBoards([path]);
}

/** The DOM canvas (`?open_artifact_engine=off`, or no WebGL2): the grid, artboards and notes in one camera-transformed layer. */
function DomWorld({ boards, notes }: { boards: string[]; notes: string[] }) {
  const camera = useView((s) => s.camera);
  const playing = useView(s => s.playing);
  const textEdit = useView((s) => s.textEdit);
  const frames = useView((s) => s.frames);
  const canvas = useDocument((s) => s.canvas);
  const live = useLive((s) => s.live);
  const resting = useLive((s) => s.resting);
  const snapshots = useLive((s) => s.snapshots);
  return (
    <>
      {/* Dot grid that follows the camera. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: 'radial-gradient(var(--color-line-strong) 1px, transparent 1px)',
          backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
          display: camera.zoom < 0.3 ? 'none' : undefined,
        }}
      />
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        {boards.map((path) => {
          const entry = canvas.boards[path]!;
          const shown = isLive(path, live);
          const snapshot = liveAll ? null : snapshots[path]?.url ?? null;
          // A resting artboard keeps its frame, hidden under its snapshot.
          const rests = Boolean(snapshot) && resting.has(path);
          return (
            <div
              key={path}
              data-board={path}
              className="absolute overflow-hidden bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.06)]"
              style={{ left: entry.x, top: entry.y, width: entry.w, height: entry.h, borderRadius: entry.radius }}
            >
              {snapshot && !(shown && frames[path]?.booted && !rests) ? (
                <img data-board-snapshot="" src={snapshot} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0 block select-none" style={{ width: entry.w, height: entry.h }} />
              ) : null}
              {shown ? <BoardFrame path={path} mode={playing === path ? 'play' : 'edit'} onNavigate={playTarget} width={entry.w} height={entry.h} interactive={textEdit?.board === path || playing === path} hideUntilBooted={Boolean(snapshot)} hidden={rests} /> : null}
            </div>
          );
        })}
        {notes.map((id) => (
          <NoteView key={id} id={id} note={canvas.notes[id]!} />
        ))}
      </div>
    </>
  );
}

/**
 * Frames of the live artboards, under the engine's canvas: each is placed
 * over its artboard's hole (services/engine.ts), and hidden while it has
 * none. The one being text-edited sits above the canvas to take the pointer.
 */
function LiveBoards({ boards }: { boards: string[] }) {
  const live = useLive((s) => s.live);
  const playing = useView(s => s.playing);
  const textEdit = useView((s) => s.textEdit);
  const entries = useDocument((s) => s.canvas.boards);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {boards
        .filter((path) => isLive(path, live))
        .map((path) => (
          <LiveBoard key={path} path={path} entry={entries[path]!} playing={playing === path} interactive={textEdit?.board === path || playing === path} />
        ))}
    </div>
  );
}

function LiveBoard({ path, entry, interactive, playing }: { path: string; entry: BoardEntry; interactive: boolean; playing: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => registerLiveBoard(path, element.current!), [path]);
  return (
    <div
      ref={element}
      data-board={path}
      data-live-board=""
      className="absolute left-0 top-0 origin-top-left overflow-hidden bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.06)]"
      style={{ width: entry.w, height: entry.h, borderRadius: entry.radius, visibility: 'hidden', ...(interactive ? { zIndex: 2, pointerEvents: 'auto' } : {}) }}
    >
      <BoardFrame path={path} mode={playing ? 'play' : 'edit'} onNavigate={playTarget} width={entry.w} height={entry.h} interactive={interactive} />
    </div>
  );
}

/** Notes whose text is drawn in the DOM over the engine's note bodies. */
const hasText = (note: CanvasNote): boolean =>
  note.kind === 'title1' || note.kind === 'link' || ((!note.kind || note.kind === 'sticky' || note.kind === 'rect' || note.kind === 'oval') && Boolean(note.text));

/**
 * Note text over the engine's canvas, in a layer that follows its camera
 * every frame. Only notes near the view are mounted; text too small to read
 * is laid out (stickies, titles and link cards take their size from it) but
 * not drawn.
 */
function NoteText({ notes }: { notes: string[] }) {
  const layer = useRef<HTMLDivElement>(null);
  const camera = useView((s) => s.camera);
  const noteEdit = useView((s) => s.noteEdit);
  const all = useDocument((s) => s.canvas.notes);
  useLayoutEffect(() => {
    const follow = (c: Camera): void => {
      if (layer.current) layer.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`;
    };
    follow(liveCamera());
    return onCameraFrame(follow);
  }, []);
  // The view and half a screen around it, so a pan shows text already laid out.
  const view = visibleRect(camera);
  const near = { x: view.x - view.w / 2, y: view.y - view.h / 2, w: view.w * 2, h: view.h * 2 };
  return (
    <div ref={layer} className="pointer-events-none absolute left-0 top-0 z-[1] origin-top-left">
      {notes.map((id) => {
        const note = all[id]!;
        if (id !== noteEdit && (!hasText(note) || !intersects(near, noteRect(note)))) return null;
        const readable = id === noteEdit || noteFontSize(note.size, note.kind) * camera.zoom >= MIN_TEXT_PX;
        return (
          <div key={id} style={readable ? undefined : { visibility: 'hidden' }}>
            <NoteView id={id} note={note} bare />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Screen-space layers drawn with the view store's camera (the overlay, the
 * marquee, drafts), kept in line with the camera drawn now: while the engine
 * moves it, the store's camera lags, and this transform makes up the
 * difference until the layers are drawn again.
 */
function CameraFollow({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const follow = (live: Camera): void => {
      const stored = useView.getState().camera;
      const k = live.zoom / stored.zoom;
      const x = live.x - stored.x * k;
      const y = live.y - stored.y * k;
      if (element.current) element.current.style.transform = k === 1 && Math.abs(x) < 0.01 && Math.abs(y) < 0.01 ? '' : `translate(${x}px, ${y}px) scale(${k})`;
    };
    follow(liveCamera());
    const stopFrames = onCameraFrame(follow);
    const stopStore = useView.subscribe((state, prev) => {
      if (state.camera !== prev.camera) follow(liveCamera());
    });
    return () => {
      stopFrames();
      stopStore();
    };
  }, []);
  return (
    <div ref={element} data-camera-follow="" className="pointer-events-none absolute inset-0 z-[3] origin-top-left">
      {children}
    </div>
  );
}

/** A world rect drawn in screen space. */
function ScreenRect({ rect, className }: { rect: Rect; className?: string }) {
  const camera = useView((s) => s.camera);
  return (
    <div
      className={`pointer-events-none absolute ${className ?? ''}`}
      style={{ left: rect.x * camera.zoom + camera.x, top: rect.y * camera.zoom + camera.y, width: rect.w * camera.zoom, height: rect.h * camera.zoom }}
    />
  );
}

/** Where Alt-dragged copies will land. */
function Ghosts({ rects }: { rects: readonly Rect[] }) {
  const camera = useView((s) => s.camera);
  return (
    <>
      {rects.map((rect, i) => (
        <div
          key={i}
          data-drag-ghost=""
          className="pointer-events-none absolute border border-accent bg-accent/15"
          style={{ left: rect.x * camera.zoom + camera.x, top: rect.y * camera.zoom + camera.y, width: rect.w * camera.zoom, height: rect.h * camera.zoom }}
        />
      ))}
    </>
  );
}

/** The engine's guide colour (services/engine.ts). */
const GUIDE_COLOR = '#f43f5e';

/** Snap guides on the DOM canvas (the engine draws its own). */
function SnapGuides({ guides }: { guides: readonly Guide[] }) {
  const camera = useView((s) => s.camera);
  const at = (v: number, axis: 'x' | 'y') => v * camera.zoom + camera[axis];
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
      {guides.map((g, i) =>
        g.vertical ? (
          <line key={i} data-snap-guide="" data-at={g.at} x1={at(g.at, 'x')} y1={at(g.from, 'y')} x2={at(g.at, 'x')} y2={at(g.to, 'y')} stroke={GUIDE_COLOR} strokeWidth={1} />
        ) : (
          <line key={i} data-snap-guide="" data-at={g.at} x1={at(g.from, 'x')} y1={at(g.at, 'y')} x2={at(g.to, 'x')} y2={at(g.at, 'y')} stroke={GUIDE_COLOR} strokeWidth={1} />
        ),
      )}
    </svg>
  );
}

/** Where dragged elements will land: the insertion line, and the container they move into. */
function DropLine({ drop }: { drop: FlowDrop }) {
  const camera = useView((s) => s.camera);
  const at = (x: number, y: number) => ({ x: x * camera.zoom + camera.x, y: y * camera.zoom + camera.y });
  const { line, outline } = drop;
  const a = line && at(line.x1, line.y1);
  const b = line && at(line.x2, line.y2);
  const box = outline && at(outline.x, outline.y);
  return (
    <svg className="pointer-events-none absolute inset-0 size-full">
      {outline && box ? (
        <rect x={box.x} y={box.y} width={outline.w * camera.zoom} height={outline.h * camera.zoom} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />
      ) : null}
      {a && b ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-accent)" strokeWidth={2} strokeLinecap="round" /> : null}
    </svg>
  );
}

/** A shape being drawn. */
interface DraftShape {
  tool: string;
  rect: Rect;
  from: { x: number; y: number };
  to: { x: number; y: number };
  points?: [number, number][];
}

/** Preview of a shape being drawn. */
function Draft({ draft }: { draft: DraftShape }) {
  const camera = useView((s) => s.camera);
  const pen = useView((s) => s.pen);
  if (draft.tool === 'pen' && draft.points) {
    const d = draft.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(draft.from.x + x) * camera.zoom + camera.x} ${(draft.from.y + y) * camera.zoom + camera.y}`).join(' ');
    return (
      <svg className="pointer-events-none absolute inset-0 size-full">
        <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={pen.stroke * camera.zoom} strokeDasharray={dashArray(pen.dash, pen.stroke * camera.zoom)} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (draft.tool === 'arrow' || draft.tool === 'line') {
    const a = { x: draft.from.x * camera.zoom + camera.x, y: draft.from.y * camera.zoom + camera.y };
    const b = { x: draft.to.x * camera.zoom + camera.x, y: draft.to.y * camera.zoom + camera.y };
    return (
      <svg className="pointer-events-none absolute inset-0 size-full">
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-accent)" strokeWidth={2} />
      </svg>
    );
  }
  return <ScreenRect rect={draft.rect} className={draft.tool === 'oval' ? 'rounded-[50%] border-2 border-accent' : 'border-2 border-accent'} />;
}

/** The Pen tool's path so far: the curve, a rubber band to the pointer, and its nodes and handles. */
function PathDraftView({ draft }: { draft: PathDraft }) {
  const camera = useView((s) => s.camera);
  const pen = useView((s) => s.pen);
  const at = (x: number, y: number) => ({ x: x * camera.zoom + camera.x, y: y * camera.zoom + camera.y });
  const last = draft.nodes[draft.nodes.length - 1];
  const first = draft.nodes[0];
  const hover = draft.hover && at(draft.hover.x, draft.hover.y);
  const closing = Boolean(first && draft.hover && draft.nodes.length >= 2 && Math.hypot(draft.hover.x - first.x, draft.hover.y - first.y) * camera.zoom <= CLOSE_RADIUS);
  const band = last && hover ? bezierPathData([last, { x: draft.hover!.x, y: draft.hover!.y }], false, at) : '';
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
      <path d={bezierPathData(draft.nodes, false, at)} fill="none" stroke="var(--color-accent)" strokeWidth={Math.max(1, pen.stroke * camera.zoom)} strokeDasharray={dashArray(pen.dash, pen.stroke * camera.zoom)} strokeLinecap="round" strokeLinejoin="round" />
      {band ? <path d={band} fill="none" stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="4 3" /> : null}
      {draft.nodes.map((node, i) => {
        const p = at(node.x, node.y);
        return (
          <g key={i}>
            {node.out ? (
              <>
                <line x1={p.x} y1={p.y} x2={at(node.x + node.out[0], node.y + node.out[1]).x} y2={at(node.x + node.out[0], node.y + node.out[1]).y} stroke="var(--color-accent)" strokeWidth={1} />
                <circle cx={at(node.x + node.out[0], node.y + node.out[1]).x} cy={at(node.x + node.out[0], node.y + node.out[1]).y} r={3} fill="white" stroke="var(--color-accent)" />
              </>
            ) : null}
            {node.in ? (
              <>
                <line x1={p.x} y1={p.y} x2={at(node.x + node.in[0], node.y + node.in[1]).x} y2={at(node.x + node.in[0], node.y + node.in[1]).y} stroke="var(--color-accent)" strokeWidth={1} />
                <circle cx={at(node.x + node.in[0], node.y + node.in[1]).x} cy={at(node.x + node.in[0], node.y + node.in[1]).y} r={3} fill="white" stroke="var(--color-accent)" />
              </>
            ) : null}
            <rect x={p.x - 4} y={p.y - 4} width={8} height={8} fill={i === 0 && closing ? 'var(--color-accent)' : 'white'} stroke="var(--color-accent)" strokeWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
}
