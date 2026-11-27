/**
 * The canvas as the WebGL2 engine draws it (`@open-artifact/canvas-engine`):
 * artboards and notes turned into engine items, and engine ids and cameras
 * mapped back. Pure.
 *
 * Artboards are textured rects (their snapshot, or a white placeholder) or,
 * while their frame is live, holes the frame shows through. Notes draw their
 * bodies here; their text stays in the DOM (`NoteView` with `bare`).
 */

import { parseColor, type CameraState, type CanvasItem, type Color } from '@open-artifact/canvas-engine';
import { boardsOnPage, intersects, type BoardEntry, type Canvas, type CanvasNote, type Rect } from '@open-artifact/design-core';
import type { Camera } from '../state/view.ts';
import { noteOpacity, shapeLook } from './note-look.ts';
import { DEFAULT_STICKY, arrowHeads, noteStroke, penViewBox, isPathNote, noteBounds, noteColor } from './notes.ts';

/** Engine item id of an artboard. */
export const boardItemId = (path: string): string => `b:${path}`;

/** Engine item id of a note. */
export const noteItemId = (id: string): string => `n:${id}`;

/** What an engine item id stands for. */
export function itemTarget(id: string): { board: string } | { note: string } | null {
  if (id.startsWith('b:')) return { board: id.slice(2) };
  if (id.startsWith('n:')) return { note: id.slice(2) };
  return null;
}

/** Editor camera (screen = world × zoom + (x, y)) → engine camera (world point at the canvas' top-left corner). */
export const toEngineCamera = (camera: Camera): CameraState => ({ x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, zoom: camera.zoom });

/** Engine camera → editor camera. */
export const fromEngineCamera = (camera: CameraState): Camera => ({ x: -camera.x * camera.zoom, y: -camera.y * camera.zoom, zoom: camera.zoom });

/** Below this settled zoom, nearby artboards show overview snapshots. */
export const LIVE_MIN_ZOOM = 0.3;
/** After entering the overview, resume live frames at this zoom. */
export const LIVE_RESUME_ZOOM = 0.32;
/** At most this many artboards are live for being on screen. */
const MAX_LIVE = 16;

/** Whether the settled zoom admits live frames for nearby artboards. */
export function liveViewportEnabled(zoom: number, wasEnabled: boolean): boolean {
  return zoom >= (wasEnabled ? LIVE_MIN_ZOOM : LIVE_RESUME_ZOOM);
}

/** The nearest artboards on the page, including a half-viewport margin on each side. */
export function nearbyLiveBoards(canvas: Canvas, page: string | null, viewport: Rect): string[] {
  const { x, y, w, h } = viewport;
  const near = { x: x - w / 2, y: y - h / 2, w: w * 2, h: h * 2 };
  const cx = x + w / 2;
  const cy = y + h / 2;
  return boardsOnPage(canvas, page)
    .map((path) => ({ path, entry: canvas.boards[path]! }))
    .filter(({ entry }) => intersects(entry, near))
    .map(({ path, entry }) => ({ path, distance: Math.hypot(entry.x + entry.w / 2 - cx, entry.y + entry.h / 2 - cy) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_LIVE)
    .map(({ path }) => path);
}

/** Snapshot width used while an artboard is small on screen (overview zooms). */
export const SMALL_SNAPSHOT_WIDTH = 256;

/** Whether an artboard is drawn from the small copy of its snapshot at a zoom (device pixels counted). */
export const smallSnapshot = (entry: BoardEntry, zoom: number, dpr: number): boolean => entry.w * zoom * dpr <= SMALL_SNAPSHOT_WIDTH * 1.25;

/**
 * The scale an artboard's snapshot is taken at: `side` image pixels on its
 * longest side, or more where that would be blurry at `sharpZoom` (the
 * highest zoom at which snapshots stand for every artboard) on a display of
 * `dpr` (counted up to 2); never above the artboard's own size, nor `limit`
 * pixels on its longest side.
 */
export function snapshotScale(entry: Pick<BoardEntry, 'w' | 'h'>, { side, limit, sharpZoom, dpr }: { side: number; limit: number; sharpZoom: number; dpr: number }): number {
  const longest = Math.max(entry.w, entry.h, 1);
  return Math.min(1, limit / longest, Math.max(side / longest, sharpZoom * Math.min(Math.max(dpr, 1), 2)));
}

/** How an artboard is drawn. */
export interface BoardLook {
  /** Its live frame shows through a hole in the canvas. */
  hole: boolean;
  /** Texture key of its snapshot. */
  texture?: string;
  /** Stacking among artboards. */
  z: number;
  /** It can be moved and resized. */
  editable: boolean;
  /** Locked: it stays where it is, at its size. */
  locked?: boolean;
  /** Locked with nothing selected in it: pointers pass through it to the canvas. */
  passThrough?: boolean;
}

/**
 * The engine item of an artboard. Objects draw no hover outline (the DOM canvas
 * has none; artboards outline the hovered element inside them instead).
 */
export function boardItem(path: string, entry: BoardEntry, look: BoardLook): CanvasItem {
  const fixed = look.editable && !look.locked;
  const base = {
    id: boardItemId(path), x: entry.x, y: entry.y, w: entry.w, h: entry.h, radius: entry.radius ?? 0, layer: 0, z: look.z,
    movable: fixed, resizable: fixed, hover: false,
    ...(look.passThrough ? { hittable: false, selectable: false } : {}),
  };
  if (look.hole) return { ...base, kind: 'hole' };
  // A piece is drawn without the artboard's page, edge and shadow.
  if (entry.frameless) return { ...base, kind: 'image', fill: 'rgba(0,0,0,0)', ...(look.texture ? { texture: look.texture } : {}) };
  return {
    ...base,
    kind: 'image',
    fill: '#ffffff',
    stroke: 'rgba(0,0,0,0.08)',
    strokeWidth: 1,
    screenStroke: true,
    shadow: { color: 'rgba(0,0,0,0.06)', blur: 8, dy: 2 },
    ...(look.texture ? { texture: look.texture } : {}),
  };
}

/** How a note is drawn. */
export interface NoteLook {
  /** Stacking among notes (notes draw over artboards). */
  z: number;
  editable: boolean;
  /** Locked: it stays where it is, at its size. */
  locked?: boolean;
  /** Size of its rendered text box (stickies grow with their text, titles and link cards fit it). */
  measured?: { w: number; h: number };
}

/**
 * A note colour (palette name or CSS colour) as the engine takes it; CSS forms
 * the engine cannot resolve (`var()`, `currentColor`) draw in `fallback`.
 */
function noteFill(value: string | undefined, use: 'sticky' | 'stroke', fallback: string): Color {
  try {
    return parseColor(noteColor(value, use, fallback));
  } catch {
    return parseColor(fallback);
  }
}

/** A CSS colour as the engine takes it, or null when it cannot resolve it. */
function engineColor(value: string): number | null {
  try {
    return parseColor(value);
  } catch {
    return null;
  }
}

/** Texture key of an image note. */
export const imageKey = (src: string): string => `img:${src}`;

/** The world rect a note's item covers. */
export function noteRect(note: CanvasNote, measured?: { w: number; h: number }): Rect {
  if (isPathNote(note)) return noteBounds(note);
  switch (note.kind) {
    case 'image':
      return { x: note.x, y: note.y, w: note.w ?? 320, h: note.h ?? 240 };
    case 'rect':
    case 'oval':
      return { x: note.x, y: note.y, w: note.w ?? 160, h: note.h ?? 100 };
    case 'link':
      return { x: note.x, y: note.y, w: note.w ?? 640, h: measured?.h ?? note.h ?? 112 };
    case 'title1': {
      const bounds = noteBounds(note);
      return { ...bounds, w: measured?.w ?? bounds.w, h: measured?.h ?? bounds.h };
    }
    default:
      return { x: note.x, y: note.y, w: note.w ?? 240, h: Math.max(note.h ?? 80, measured?.h ?? 0) };
  }
}

/** The engine item of a note: its body (text is drawn by the DOM), without a hover outline like artboards. */
export function noteItem(id: string, note: CanvasNote, look: NoteLook): CanvasItem {
  const rect = noteRect(note, look.measured);
  const base = { id: noteItemId(id), ...rect, ...(note.rotate ? { rotation: note.rotate * Math.PI / 180 } : {}), layer: 1, z: look.z, movable: look.editable && !look.locked, resizable: look.editable && !look.locked && !isPathNote(note), hover: false };
  if (isPathNote(note)) {
    const { width, color, dash } = noteStroke(note);
    const stroke = noteFill(color, 'stroke', '#2b2b2b');
    const points = (note.points ?? []).map(([x, y]) => [x + note.x - rect.x, y + note.y - rect.y] as const);
    const opacity = noteOpacity(note);
    const line = { ...base, kind: 'path' as const, stroke, strokeWidth: width, ...(dash ? { dash } : {}), ...(opacity !== undefined ? { opacity } : {}), cap: 'round' as const, join: 'round' as const, hitStrokeOnly: true };
    if (note.kind === 'pen' && note.d && !points.length) return { ...line, d: note.d, viewBox: penViewBox(note.d) };
    const heads = arrowHeads(note, points);
    if (heads.length) {
      // Close only the filled triangles. Open subpaths get an implicit closing edge
      // when filled, so retrace open wings and the shaft before adding the heads.
      const shaft = [...points, ...points.slice(0, -1).reverse()].map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
      const d = shaft + heads.map(h => h.d).join('');
      return { ...line, d, fill: heads.some(h => h.filled) ? stroke : undefined };
    }
    return { ...line, points: points.flat() };
  }
  switch (note.kind) {
    case 'image':
      return { ...base, kind: 'image', fill: '#00000010', ...(note.src ? { texture: imageKey(note.src) } : {}) };
    case 'rect':
    case 'oval': {
      const shape = shapeLook(note).engine;
      const fill = shape && engineColor(shape.fill);
      const stroke = shape && engineColor(shape.stroke);
      // A look only the DOM body draws (see note-look.ts): the scene keeps a clear box to hit.
      if (!shape || fill === null || stroke === null) return { ...base, kind: 'rect', fill: 'transparent' };
      const paint = { stroke, strokeWidth: shape.strokeWidth, ...(shape.dash ? { dash: shape.dash } : {}), ...(shape.opacity !== undefined ? { opacity: shape.opacity } : {}) };
      if (note.kind === 'rect') return { ...base, kind: 'rect', fill, radius: shape.radius, ...paint };
      // An ellipse inset by half the stroke, so the stroke stays inside the box (as a CSS border does).
      const half = shape.strokeWidth / 2;
      const rx = Math.max(0, rect.w / 2 - half);
      const ry = Math.max(0, rect.h / 2 - half);
      const d = `M${half} ${rect.h / 2}A${rx} ${ry} 0 1 0 ${rect.w - half} ${rect.h / 2}A${rx} ${ry} 0 1 0 ${half} ${rect.h / 2}Z`;
      // An unfilled oval still takes clicks inside (a path is hit by its fill): a fill too faint to see.
      return { ...base, kind: 'path', d, fill: (fill & 0xff) === 0 ? '#00000001' : fill, ...paint };
    }
    case 'link':
      return { ...base, kind: 'rect', fill: '#ffffff', stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1, radius: 8, shadow: { color: 'rgba(0,0,0,0.06)', blur: 3, dy: 1 } };
    case 'title1':
      // Only its text shows; the transparent body is what is hit and selected.
      return { ...base, kind: 'rect', fill: 'transparent' };
    default:
      return {
        ...base,
        kind: 'rect',
        fill: noteFill(note.fill ?? note.color, 'sticky', DEFAULT_STICKY),
        radius: 2,
        shadow: { color: 'rgba(0,0,0,0.1)', blur: 10, dy: 3 },
      };
  }
}
