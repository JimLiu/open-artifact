/**
 * Screen-space layer over the canvas: artboard labels, selection outlines,
 * resize handles, hovered and selected element boxes, and the error notices
 * under artboards.
 * Over the canvas engine, which draws selection outlines and handles
 * itself, only the rest is drawn here.
 *
 * Element boxes come from the board runtime (`rects`) in artboard pixels and
 * are mapped through the artboard's position and the camera. Labels of
 * artboards far outside the view are left out.
 */

import { Lock, Maximize2, Play, Square, SlidersHorizontal } from 'lucide-react';
import { expandNotesToGroups, groupItems, isLockedObject, unionRect, type Canvas as CanvasDoc, type Rect } from '@open-artifact/design-core';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { parseDcDocument, tweakEntries, type BoardRect } from '@open-artifact/dc';
import { cn, isComposingKey } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView, type Camera, type HoverObject } from '../state/view.ts';
import { boardApi } from '../services/frames.ts';
import { cameraFrame, measuredNoteSize, onCameraFrame } from '../services/engine.ts';
import { useLiveCamera } from '../services/camera-frame.ts';
import { updateBoard } from '../services/commands.ts';
import { ErrorMark, ErrorNotice, useBoardProblems, useCanAskAgent } from './BoardErrors.tsx';
import { noticeClosed } from '../lib/board-errors.ts';
import { isPathNote, noteBounds } from '../lib/notes.ts';
import { measureLines, rectWithin } from '../lib/measure.ts';
import { noteRect } from '../lib/scene.ts';
import { boardChromeBox, projectBox } from '../lib/overlay.ts';
import type { Handle } from './Canvas.tsx';
import { LayoutGuides } from './LayoutGuides.tsx';
import { HoverLink } from './HoverLink.tsx';
import { linkAround } from '../lib/hover-link.ts';
import { templateOf } from '../services/agent.ts';
import { SelectionBar } from './SelectionBar.tsx';
import { useScale } from '../services/scale.ts';
import { viewportSize } from '../services/viewport.ts';
import { boardTakesPart, elementGroupsOf, elementsIn, selectedBoardsOf, selectedNotesOf } from '../lib/selection.ts';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** Clip an artboard's element rects and place them in world coordinates. */
function elementBoxes(board: string, tids: number[], instance: number | null): Rect[] {
  const entry = useDocument.getState().canvas.boards[board];
  const api = boardApi(board);
  if (!entry || !api || !tids.length) return [];
  let rects: Record<number, BoardRect[]>;
  try {
    rects = api.rects(tids);
  } catch {
    return [];
  }
  const out: Rect[] = [];
  for (const tid of tids) {
    const list = rects[tid] ?? [];
    const chosen = instance === null ? list : list.slice(instance, instance + 1);
    for (const rect of chosen) {
      // Clip to the artboard: content outside it is not visible.
      const x = Math.max(0, rect.x);
      const y = Math.max(0, rect.y);
      const w = Math.min(entry.w, rect.x + rect.width) - x;
      const h = Math.min(entry.h, rect.y + rect.height) - y;
      // A straight line is zero-width or zero-height and still selectable.
      if (w >= 0 && h >= 0 && w + h > 0) out.push({ x: entry.x + x, y: entry.y + y, w, h });
    }
  }
  return out;
}

type Box = ReturnType<typeof projectBox>;
const rectOf = (box: Box): Rect => ({ x: box.left, y: box.top, w: box.width, h: box.height });
const boxOf = (rect: Rect): Box => ({ left: rect.x, top: rect.y, width: rect.w, height: rect.h });
const unionBox = (boxes: readonly Box[]): Box | null => {
  const rect = unionRect(boxes.map(rectOf));
  return rect ? boxOf(rect) : null;
};

/** A hover ring: a box, or a thin box turned along a straight line. */
type Ring = { box: Box; angle?: undefined } | { box: Box; angle: number };

/** The ring around a hovered artboard or note (its whole group), in screen space. */
function hoverRing(canvas: CanvasDoc, hover: HoverObject, camera: Camera): Ring | null {
  if (hover.board !== undefined) {
    const entry = canvas.boards[hover.board];
    return entry ? { box: projectBox(camera, entry) } : null;
  }
  const note = canvas.notes[hover.note];
  if (!note) return null;
  const ids = expandNotesToGroups(groupItems(canvas), [hover.note]);
  if (ids.length === 1 && (note.kind === 'line' || note.kind === 'arrow') && note.points?.length === 2) {
    const [[x1, y1], [x2, y2]] = note.points as [[number, number], [number, number]];
    const pad = 6 + ((note.stroke ?? 3) * camera.zoom) / 2;
    const length = Math.hypot(x2 - x1, y2 - y1) * camera.zoom;
    const center = projectBox(camera, { x: note.x + (x1 + x2) / 2, y: note.y + (y1 + y2) / 2, w: 0, h: 0 });
    return { box: { left: center.left, top: center.top, width: length + pad * 2, height: pad * 2 }, angle: Math.atan2(y2 - y1, x2 - x1) };
  }
  const r = unionRect(ids.flatMap((id) => (canvas.notes[id] ? [noteRect(canvas.notes[id]!, measuredNoteSize(id))] : [])));
  return r ? { box: projectBox(camera, r) } : null;
}

export interface OverlayProps {
  boards: string[];
  renamingBoard: string | null;
  onRenameDone(): void;
  /** The canvas engine draws the canvas, with selection outlines and resize handles. */
  engine?: boolean;
}

export function Overlay({ boards, engine = false, renamingBoard, onRenameDone }: OverlayProps) {
  return (
    <div data-design-overlays="" className="pointer-events-none absolute inset-0 overflow-hidden">
      <BoardChrome boards={boards} renamingBoard={renamingBoard} onRenameDone={onRenameDone} />
      <SelectionOverlay engine={engine} />
    </div>
  );
}

function BoardChrome({ boards, renamingBoard, onRenameDone }: Omit<OverlayProps, 'engine'>) {
  const layer = useRef<HTMLDivElement>(null);
  const selection = useView((s) => s.selection);
  const focus = useView((s) => s.focus);
  const canvas = useDocument((s) => s.canvas);
  const readOnly = useDocument((s) => s.readOnly);
  const playing = useView(s => s.playing);
  const sources = useDocument((s) => s.boards);
  const problems = useBoardProblems(boards);
  const closedNotices = useView((s) => s.closedNotices);
  const canAsk = useCanAskAgent();
  const problemOf = useMemo(() => new Map(problems.map((problem) => [problem.path, problem])), [problems]);
  const tweakable = useMemo(() => {
    const out = new Set<string>();
    for (const path of boards) {
      const source = sources[path]?.source;
      if (!source) continue;
      try {
        if (tweakEntries(parseDcDocument(source).props).length) out.add(path);
      } catch {
        // An unreadable file has no tweaks to show.
      }
    }
    return out;
  }, [boards, sources]);

  // Keep the world's rectangles separate from the labels' CSS pixels. Camera
  // frames move and size the anchors without re-rendering the title controls.
  useLayoutEffect(() => {
    const nodes = Array.from(layer.current!.children, (node) => {
      const element = node as HTMLDivElement;
      return { element, entry: canvas.boards[element.dataset.boardChrome!]! };
    });
    const place = (camera: Camera): void => {
      for (const { element, entry } of nodes) {
        const box = boardChromeBox(camera, entry, viewportSize);
        element.hidden = !box;
        if (!box) continue;
        element.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
        element.style.width = `${box.width}px`;
        element.style.height = `${box.height}px`;
        if (entry.guides?.length) element.style.setProperty('--board-zoom', String(camera.zoom));
        element.toggleAttribute('data-compact', box.compact);
      }
    };
    place(cameraFrame());
    const stopCamera = onCameraFrame(place);
    const stopLayout = useView.subscribe((state, previous) => {
      // The canvas ticks the view store after it resizes.
      if (state.layoutTick !== previous.layoutTick) place(cameraFrame());
    });
    return () => {
      stopCamera();
      stopLayout();
    };
  }, [boards, canvas.boards]);

  const singleBoard = selection.kind === 'objects' && selection.boards.length === 1 && selection.notes.length === 0 ? selection.boards[0] : null;
  return (
    <div ref={layer} className="contents">
      {boards.map((path) => {
        const entry = canvas.boards[path]!;
        const problem = problemOf.get(path);
        // A piece has no label (it is a loose element on the canvas) unless it has a problem to show.
        if (entry.frameless && !problem) return null;
        const closed = problem ? noticeClosed(closedNotices, problem) : false;
        const selected = boardTakesPart(selection, path);
        const name = entry.title || path.replace(/\.dc\.html$/, '');
        return (
          // The engine moves selected artboards without the document until the drag ends: their labels hide meanwhile.
          <div key={path} data-board-chrome={path} data-gesture-bound={selected ? '' : undefined} className="absolute left-0 top-0">
            {path !== playing && <LayoutGuides entry={entry} />}
            <div
              data-board-title={path}
              className="pointer-events-auto absolute -top-[22px] left-0 flex h-5 items-center gap-1 text-[11px] leading-5 transition-opacity"
              style={{ width: 'max(60px, 100%)' }}
            >
              {isLockedObject(entry) ? (
                <span className={cn('flex shrink-0', selected ? 'text-accent' : 'text-fg-muted')} title="Locked" aria-label="Locked" role="img" data-board-locked="">
                  <Lock className="size-3" aria-hidden />
                </span>
              ) : null}
              {path === renamingBoard && !readOnly ? (
                <input
                  aria-label="Artboard name"
                  autoFocus
                  defaultValue={name}
                  className="min-w-0 flex-1 rounded-sm bg-chrome px-1 text-fg outline outline-accent"
                  onFocus={(event) => event.currentTarget.select()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim();
                    if (title !== name) updateBoard(path, { title: title || undefined });
                    onRenameDone();
                  }}
                  onKeyDown={(event) => {
                    if (isComposingKey(event.nativeEvent) || (event.key !== 'Enter' && event.key !== 'Escape')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === 'Escape') event.currentTarget.value = name;
                    event.currentTarget.blur();
                  }}
                />
              ) : (
                <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-accent' : 'text-fg-muted')}>{name}</span>
              )}
              {problem && closed ? <ErrorMark problem={problem} /> : null}
              <div data-board-title-wide="" className="contents">
                {tweakable.has(path) ? (
                  <FrameButton
                    label="Tweaks"
                    onClick={() => {
                      useView.getState().select({ kind: 'objects', boards: [path], notes: [] });
                      useView.getState().setPanel('tweaks', true);
                    }}
                  >
                    <SlidersHorizontal className="size-3" />
                  </FrameButton>
                ) : null}
                {entry.is_interactive || path === playing ? <FrameButton label={playing === path ? 'Stop playing' : 'Play on canvas'} onClick={() => useView.getState().play(playing === path ? null : path)}>
                  {playing === path ? <Square className="size-3 text-accent" /> : <Play className="size-3 text-accent" />}
                </FrameButton> : null}
                <FrameButton label={entry.is_interactive ? 'Play full screen' : 'Focus'} onClick={() => focus(path)}>
                  <Maximize2 className="size-3" />
                </FrameButton>
              </div>
              {entry.is_interactive ? (
                <div data-board-title-compact="" className="contents">
                  <FrameButton label="Play" onClick={() => focus(path)}>
                    <Play className="size-3" />
                  </FrameButton>
                </div>
              ) : null}
            </div>
            {/* Under the artboard, and under its size label while it is the only thing selected. */}
            {problem && !closed ? (
              <ErrorNotice
                problem={problem}
                canAsk={canAsk}
                onShowAll={() => useView.getState().setErrorsOpen(true)}
                className="absolute left-0 w-full"
                style={{ top: singleBoard === path ? 'calc(100% + 28px)' : 'calc(100% + 6px)' }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SelectionOverlay({ engine }: { engine: boolean }) {
  const selection = useView((s) => s.selection);
  const hover = useView((s) => s.hover);
  const hoverObject = useView((s) => s.hoverObject);
  const altHeld = useView((s) => s.altHeld);
  const tool = useView((s) => s.tool);
  const textEdit = useView((s) => s.textEdit);
  const layoutTick = useView((s) => s.layoutTick);
  const canvas = useDocument((s) => s.canvas);
  const readOnly = useDocument((s) => s.readOnly);
  const playing = useView((s) => s.playing);
  const panelOpen = useView((s) => s.panelOpen);
  const scaling = useScale((s) => s.session !== null);
  const sources = useDocument((s) => s.boards);

  const selectedBoxes = useMemo(() => {
    return elementGroupsOf(selection).flatMap((group) => group.items.flatMap((item) => elementBoxes(group.board, [item.tid], item.instance)));
    // layoutTick: rects move when the artboard re-renders.
  }, [selection, layoutTick, canvas]);

  const hoverBoxes = useMemo(() => {
    if (!hover || textEdit) return [];
    if (elementsIn(selection, hover.board).some((i) => i.tid === hover.tid)) return [];
    return elementBoxes(hover.board, [hover.tid], null);
  }, [hover, selection, textEdit, layoutTick, canvas]);

  // A hovered element inside a link shows its address; a selected one carries it on the selection bar.
  const hoverLink = useMemo(() => {
    const rect = hoverBoxes[0];
    const source = hover ? sources[hover.board]?.source : undefined;
    if (!hover || !rect || source == null || playing) return null;
    const href = linkAround(templateOf(source), hover.tid);
    return href ? { href, rect } : null;
  }, [hover, hoverBoxes, sources, playing]);

  const objects = useMemo(() => {
    const out: { key: string; rect: Rect; board?: string; note?: string }[] = [];
    for (const path of selectedBoardsOf(selection)) {
      const entry = canvas.boards[path];
      if (entry) out.push({ key: `b:${path}`, rect: entry, board: path });
    }
    for (const id of selectedNotesOf(selection)) {
      const note = canvas.notes[id];
      if (note) out.push({ key: `n:${id}`, rect: noteBounds(note), note: id });
    }
    return out;
  }, [selection, canvas]);

  const camera = useLiveCamera(Boolean(hoverObject || hoverBoxes.length || selectedBoxes.length || objects.length));
  const elementBoxesOnScreen = selectedBoxes.map((rect) => projectBox(camera, rect));
  const objectBoxes = objects.map(({ rect, ...object }) => ({ ...object, box: projectBox(camera, rect) }));

  const hoveredObjectIsSelected = hoverObject?.board !== undefined
    ? selectedBoardsOf(selection).includes(hoverObject.board)
    : hoverObject !== null && selectedNotesOf(selection).includes(hoverObject.note);
  const ring = useMemo(() => {
    if (!hoverObject || hoveredObjectIsSelected || tool !== 'select' || textEdit) return null;
    return hoverRing(canvas, hoverObject, camera);
  }, [hoverObject, hoveredObjectIsSelected, tool, textEdit, canvas, camera, layoutTick]);

  const measureHoverElement = Boolean(hover && !elementsIn(selection, hover.board).some((i) => i.tid === hover.tid));
  const measuredElement = useMemo(() => {
    if (!altHeld || !hover || !measureHoverElement) return null;
    return unionRect(elementBoxes(hover.board, [hover.tid], hover.instance));
  }, [altHeld, hover, measureHoverElement, canvas, layoutTick]);

  // Alt held: distances from the selection to the element, artboard or note under the pointer.
  let measures: ReturnType<typeof measureLines> = [];
  if (altHeld && selection.kind !== 'none') {
    const from = unionBox([...objectBoxes.map((o) => o.box), ...elementBoxesOnScreen]);
    let to = measuredElement ? projectBox(camera, measuredElement) : null;
    if (!measureHoverElement && hoverObject && !hoveredObjectIsSelected) {
      to = ring?.box ?? hoverRing(canvas, hoverObject, camera)?.box ?? null;
      const note = hoverObject.note === undefined ? undefined : canvas.notes[hoverObject.note];
      if (to && note && isPathNote(note)) to = projectBox(camera, noteBounds(note));
    }
    if (from && to && !rectWithin(rectOf(to), rectOf(from))) measures = measureLines(rectOf(from), rectOf(to));
  }

  // A mixed selection has no handles: it moves, it doesn't resize.
  const single = objectBoxes.length === 1 && selection.kind === 'objects' ? objectBoxes[0]! : null;
  const singleNote = single?.note ? canvas.notes[single.note] : undefined;
  const singleLocked = single ? isLockedObject(single.board ? canvas.boards[single.board] : singleNote) : false;
  const resizable = Boolean(single && !readOnly && !singleLocked && !(singleNote && (singleNote.kind === 'pen' || singleNote.kind === 'line' || singleNote.kind === 'arrow')));

  return (
    <>
      {ring ? (
        <div
          data-hover-ring=""
          className={cn('absolute border border-accent/50', ring.angle === undefined ? 'rounded-[3px]' : 'rounded-full')}
          style={ring.angle === undefined
            ? { left: ring.box.left - 2, top: ring.box.top - 2, width: ring.box.width + 4, height: ring.box.height + 4 }
            : { ...ring.box, transform: `translate(-50%, -50%) rotate(${ring.angle}rad)` }}
        />
      ) : null}
      {measures.length ? (
        <div data-measure="" aria-hidden>
          {measures.map((line, index) => (
            <div key={index}>
              <div className="absolute bg-[#e5484d]" style={line.axis === 'x' ? { left: line.x1, top: line.y1 - 0.5, width: line.length, height: 1 } : { left: line.x1 - 0.5, top: line.y1, width: 1, height: line.length }} />
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-[#e5484d] px-1 text-[10px] leading-4 tabular-nums text-white"
                style={{ left: (line.x1 + line.x2) / 2 + (line.axis === 'y' ? 14 : 0), top: (line.y1 + line.y2) / 2 + (line.axis === 'x' ? -10 : 0) }}
              >
                {Math.round(line.length / camera.zoom)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {hoverBoxes.map((rect, index) => (
        <div key={`h${index}`} className="absolute border border-accent/70" style={projectBox(camera, rect)} />
      ))}
      <HoverLink link={hoverLink} />
      {elementBoxesOnScreen.map((box, index) => (
        <div key={`s${index}`} className={cn('absolute border-2', textEdit ? 'border-accent/40' : 'border-accent')} style={box} />
      ))}
      {engine
        ? null
        : objectBoxes.map(({ key, box }) => (
            <div key={key} className="absolute border-2 border-accent" style={{ ...box, left: box.left - 1, top: box.top - 1, width: box.width + 2, height: box.height + 2 }} />
          ))}

      {single && resizable && !engine
        ? HANDLES.filter((handle) => !(singleNote?.kind === 'title1' && handle !== 'e' && handle !== 'w')).map((handle) => {
            const { left, top, width, height } = single.box;
            const x = handle.includes('w') ? left : handle.includes('e') ? left + width : left + width / 2;
            const y = handle.includes('n') ? top : handle.includes('s') ? top + height : top + height / 2;
            return (
              <div
                key={handle}
                data-handle={handle}
                data-handle-board={single.board}
                data-handle-note={single.note}
                className="pointer-events-auto absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-accent bg-white"
                style={{ left: x, top: y, cursor: HANDLE_CURSOR[handle] }}
              />
            );
          })
        : null}

      {/* A selection across files keeps its strip with the panel open: Duplicate and Delete act on all of it. */}
      {elementBoxesOnScreen[0] && (!panelOpen || scaling || selection.kind === 'mixed') ? (
        // Hidden while the camera moves: it does not scale with the canvas.
        <div data-camera-bound="">
          <SelectionBar box={elementBoxesOnScreen[0]} />
        </div>
      ) : null}

      {single?.board ? (
        <div data-gesture-bound="">
          <SizeLabel box={single.box} w={canvas.boards[single.board]!.w} h={canvas.boards[single.board]!.h} />
        </div>
      ) : null}
    </>
  );
}

/** A small icon button in an artboard's name strip. */
function FrameButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className="flex size-4 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}

/** The selected artboard's size, under it. */
function SizeLabel({ box, w, h }: { box: ReturnType<typeof projectBox>; w: number; h: number }) {
  return (
    <div
      data-board-size=""
      className="absolute left-0 top-0 rounded bg-accent px-1 text-[10px] leading-4 text-accent-fg"
      style={{ transform: `translate3d(${box.left + box.width / 2}px, ${box.top + box.height + 6}px, 0) translateX(-50%)` }}
    >
      {w} × {h}
    </div>
  );
}
