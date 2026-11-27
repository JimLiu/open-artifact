/**
 * Where a Design comment sits, and where its pin is drawn. Pure.
 *
 * A thread's `anchor` (a JSON string the host stores as is) names one of:
 *
 * - `element`: an element of an artboard, by its template address (`tid` +
 *   child-index `path`, see `@open-artifact/dc`), with its tag and label as
 *   a fingerprint so it is found again after edits move it. `fx`/`fy` place
 *   the pin as a fraction of the element's box (default: its top-right
 *   corner); `rect` is the box when the comment was made, used while the
 *   artboard is not rendered live. `row` says which copy it is when the
 *   template repeats it (or a parent of it): `row 2 of 5 › item 1 of 3`.
 * - `board`: a whole artboard; `x`/`y` (artboard px) a point on it.
 * - `note`: a canvas note (sticky, title, shape…), `fx`/`fy` as above.
 * - `point`: a point on the canvas (world px).
 * - `area`: a dragged rectangle on the canvas (world px); may span artboards.
 * - `canvas`: the whole design (no pin).
 *
 * Every anchor but `canvas` carries the `page` it was made on: pins show on
 * that page only.
 */

import { elementAtPath, elementLabel, elementPath, resolveElement, type TemplateModel } from '@open-artifact/dc';
import type { BoardEntry, Canvas, CanvasNote, Rect } from '@open-artifact/design-core';
import type { AnchorState } from '@open-artifact/editor-kit';

// The shared pin geometry (`@open-artifact/editor-kit`, pins.ts), re-exported for the design's callers.
export { spreadPins, toScreenPoint, type AnchorState } from '@open-artifact/editor-kit';

/** An element's fingerprint: what it was when the comment was made. */
export interface ElementPrint {
  tag?: string;
  text?: string;
}

/** One repeated layer an element sits in: the `at`-th (from 1) of `of` copies of template node `tid`. */
export interface RowLayer {
  at: number;
  of: number;
  tid: number;
}

/**
 * The repeated rows an element sits in, outermost first (1 to
 * {@link ROW_LAYERS_MAX} layers), and the innermost row's words as shown.
 */
export interface ElementRow {
  layers: RowLayer[];
  text?: string;
}

/** Most repeated layers an anchor keeps (the innermost ones). */
export const ROW_LAYERS_MAX = 3;
/** Most copies a layer counts. */
export const ROW_COUNT_MAX = 9999;

/** Where a thread sits. */
export type DesignAnchor =
  | ({ kind: 'element'; page: string | null; board: string; tid: number; path: number[]; fx?: number; fy?: number; rect?: Rect; row?: ElementRow } & ElementPrint)
  | { kind: 'board'; page: string | null; board: string; x?: number; y?: number }
  | { kind: 'note'; page: string | null; note: string; fx?: number; fy?: number }
  | { kind: 'point'; page: string | null; x: number; y: number }
  | { kind: 'area'; page: string | null; x: number; y: number; w: number; h: number; corner?: number }
  | { kind: 'canvas' };

/** Longest label text kept in an element fingerprint. */
export const PRINT_TEXT_MAX = 60;

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isStr = (value: unknown): value is string => typeof value === 'string';
const pageOf = (value: unknown): string | null => (isStr(value) ? value : null);
const fraction = (value: unknown): number | undefined => (isNum(value) ? Math.min(1, Math.max(0, value)) : undefined);
const round = (value: number): number => Math.round(value * 10) / 10;

function rectOf(value: unknown): Rect | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  return isNum(r.x) && isNum(r.y) && isNum(r.w) && isNum(r.h) && r.w >= 0 && r.h >= 0 ? { x: r.x, y: r.y, w: r.w, h: r.h } : undefined;
}

/** A stored row, or `undefined` when it is not a valid one. */
function rowFrom(value: unknown): ElementRow | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r.layers) || r.layers.length < 1 || r.layers.length > ROW_LAYERS_MAX) return undefined;
  const layers: RowLayer[] = [];
  for (const raw of r.layers as unknown[]) {
    if (!raw || typeof raw !== 'object') return undefined;
    const { at, of, tid } = raw as Record<string, unknown>;
    if (!Number.isInteger(at) || !Number.isInteger(of) || !Number.isInteger(tid)) return undefined;
    const layer = { at: at as number, of: of as number, tid: tid as number };
    if (layer.of < 2 || layer.of > ROW_COUNT_MAX || layer.at < 1 || layer.at > layer.of || layer.tid < 0) return undefined;
    layers.push(layer);
  }
  return isStr(r.text) && r.text ? { layers, text: r.text.slice(0, PRINT_TEXT_MAX) } : { layers };
}

/**
 * The row of an element from the repeated layers it sits in (outermost
 * first, as the artboard reports them): the innermost
 * {@link ROW_LAYERS_MAX}, and the innermost one's words. `undefined` when
 * it sits in none.
 */
export function rowOf(rows: readonly { tid: number; at: number; of: number; text?: string }[]): ElementRow | undefined {
  const kept = rows.filter((r) => r.of >= 2 && r.at >= 1 && r.at <= r.of).slice(-ROW_LAYERS_MAX);
  if (!kept.length) return undefined;
  const layers = kept.map((r) => ({ at: r.at, of: Math.min(r.of, ROW_COUNT_MAX), tid: r.tid }));
  const text = kept[kept.length - 1]!.text?.replace(/\s+/g, ' ').trim().slice(0, PRINT_TEXT_MAX);
  return text ? { layers, text } : { layers };
}

/**
 * An element anchor with its row kept only while every layer of it is still
 * repeated (`repeated(tid)`); otherwise a plain element anchor.
 */
export function keepRow(anchor: DesignAnchor, repeated: (tid: number) => boolean): DesignAnchor {
  if (anchor.kind !== 'element' || !anchor.row) return anchor;
  if (anchor.row.layers.every((layer) => repeated(layer.tid))) return anchor;
  const { row: _row, ...plain } = anchor;
  return plain;
}

/** `row 2 of 5`, `item 1 of 3`: the words of a row's layers, outermost first. */
export function rowWords(row: ElementRow): string[] {
  return row.layers.map((layer, i) => `${i === 0 ? 'row' : 'item'} ${layer.at} of ${layer.of}`);
}

/** Drops `undefined` fields (so the stored JSON stays small). */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Reads a stored anchor; anything unreadable is the whole design. */
export function parseAnchor(text: string): DesignAnchor {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'canvas' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'canvas' };
  const a = raw as Record<string, unknown>;
  const page = pageOf(a.page);
  switch (a.kind) {
    case 'element':
      if (!isStr(a.board) || !isNum(a.tid) || !Array.isArray(a.path) || !a.path.every((n) => Number.isInteger(n) && (n as number) >= 0)) break;
      return compact({
        kind: 'element',
        page,
        board: a.board,
        tid: a.tid,
        path: a.path as number[],
        fx: fraction(a.fx),
        fy: fraction(a.fy),
        rect: rectOf(a.rect),
        tag: isStr(a.tag) ? a.tag : undefined,
        text: isStr(a.text) ? a.text : undefined,
        row: rowFrom(a.row),
      });
    case 'board':
      if (!isStr(a.board)) break;
      return compact({ kind: 'board', page, board: a.board, x: isNum(a.x) ? a.x : undefined, y: isNum(a.y) ? a.y : undefined });
    case 'note':
      if (!isStr(a.note)) break;
      return compact({ kind: 'note', page, note: a.note, fx: fraction(a.fx), fy: fraction(a.fy) });
    case 'point':
      if (!isNum(a.x) || !isNum(a.y)) break;
      return { kind: 'point', page, x: a.x, y: a.y };
    case 'area': {
      const r = rectOf(a);
      if (!r) break;
      const corner = Number.isInteger(a.corner) && (a.corner as number) >= 0 && (a.corner as number) <= 3 ? (a.corner as number) : undefined;
      return compact({ kind: 'area', page, ...r, corner });
    }
  }
  return { kind: 'canvas' };
}

/** The stored form of an anchor. */
export function serializeAnchor(anchor: DesignAnchor): string {
  return JSON.stringify(compact(anchor));
}

/** The page an anchor shows on (`undefined`: every page, the whole design). */
export function anchorPage(anchor: DesignAnchor): string | null | undefined {
  return anchor.kind === 'canvas' ? undefined : anchor.page;
}

/** True when an anchor's pin belongs on `page` (the canvas' first page stands for `null`). */
export function onPage(anchor: DesignAnchor, page: string | null, firstPage: string | null): boolean {
  if (anchor.kind === 'canvas') return false;
  const own = anchor.page ?? firstPage;
  const here = page ?? firstPage;
  return own === here;
}

/* -------------------------------------------------------------------------- */
/* Making anchors                                                              */
/* -------------------------------------------------------------------------- */

/** The fingerprint of an element. */
export function printOf(model: TemplateModel, tid: number): ElementPrint {
  const element = model.elements[tid];
  if (!element) return {};
  const text = elementLabel(element);
  return compact({ tag: element.tag, text: text ? text.slice(0, PRINT_TEXT_MAX) : undefined });
}

/**
 * The anchor of a press at `local` (artboard px) on an element whose box is
 * `box` (artboard px; `null` when it is not measured).
 */
export function elementAnchor(input: { page: string | null; board: string; tid: number; path: readonly number[]; model: TemplateModel; box: Rect | null; local?: { x: number; y: number }; row?: ElementRow }): DesignAnchor {
  const { box, local } = input;
  const at =
    box && local && box.w > 0 && box.h > 0
      ? { fx: round(Math.min(1, Math.max(0, (local.x - box.x) / box.w)) * 100) / 100, fy: round(Math.min(1, Math.max(0, (local.y - box.y) / box.h)) * 100) / 100 }
      : {};
  return compact({
    kind: 'element',
    page: input.page,
    board: input.board,
    tid: input.tid,
    path: [...input.path],
    ...at,
    rect: box ? { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) } : undefined,
    ...printOf(input.model, input.tid),
    row: input.row,
  });
}

/** The anchor of a press on an artboard (outside any element), `local` in artboard px. */
export function boardAnchor(page: string | null, board: string, local?: { x: number; y: number }): DesignAnchor {
  return local ? { kind: 'board', page, board, x: Math.round(local.x), y: Math.round(local.y) } : { kind: 'board', page, board };
}

/** The anchor of a press on a note whose box is `rect` (world px). */
export function noteAnchor(page: string | null, note: string, rect: Rect | null, world?: { x: number; y: number }): DesignAnchor {
  if (!rect || !world || rect.w <= 0 || rect.h <= 0) return { kind: 'note', page, note };
  const fx = Math.min(1, Math.max(0, (world.x - rect.x) / rect.w));
  const fy = Math.min(1, Math.max(0, (world.y - rect.y) / rect.h));
  return { kind: 'note', page, note, fx: Math.round(fx * 100) / 100, fy: Math.round(fy * 100) / 100 };
}

/**
 * The anchor of a dragged area (world px) from where the drag started (`a`) to where it was let go (`b`), normalized
 * so `w`/`h` are positive. `corner` is the corner it was let go at: the pin
 * goes there, where the composer opened.
 */
export function areaAnchor(page: string | null, a: { x: number; y: number }, b: { x: number; y: number }): DesignAnchor {
  const corner = (b.x >= a.x ? 1 : 0) | (b.y >= a.y ? 2 : 0);
  return { kind: 'area', page, x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), w: Math.round(Math.abs(a.x - b.x)), h: Math.round(Math.abs(a.y - b.y)), corner };
}

/* -------------------------------------------------------------------------- */
/* Resolving anchors                                                           */
/* -------------------------------------------------------------------------- */

/**
 * An anchor against the current design. Its `state` (see `AnchorState`):
 * `moved` is an element found again by its fingerprint at another address,
 * `detached` an element that is gone (the pin falls back to its artboard),
 * `orphaned` an artboard or note that is gone (the thread shows in the list only).
 */
export interface ResolvedAnchor {
  anchor: DesignAnchor;
  state: AnchorState;
  /** The element's address now (element anchors that resolved). */
  element?: { tid: number; path: number[] };
}

/** What resolving reads from the design. */
export interface AnchorDocument {
  canvas: Pick<Canvas, 'boards' | 'notes'>;
  /** The parsed template of an artboard, `null` when its source is unknown. */
  model(board: string): TemplateModel | null;
}

/** True when an element still matches a fingerprint (an empty one matches anything with the same tag). */
function matches(model: TemplateModel, tid: number, print: ElementPrint): boolean {
  const element = model.elements[tid];
  if (!element) return false;
  if (print.tag && element.tag !== print.tag) return false;
  if (print.text !== undefined) {
    const text = elementLabel(element)?.slice(0, PRINT_TEXT_MAX);
    if (text !== print.text) return false;
  }
  return true;
}

/** Finds an element anchor's element in a model. */
export function findElement(model: TemplateModel, anchor: Extract<DesignAnchor, { kind: 'element' }>): { tid: number; path: number[]; exact: boolean } | null {
  const print: ElementPrint = { ...(anchor.tag ? { tag: anchor.tag } : {}), ...(anchor.text !== undefined ? { text: anchor.text } : {}) };
  const exact = resolveElement(model, anchor.tid, anchor.path);
  if (exact && matches(model, anchor.tid, print)) return { tid: anchor.tid, path: [...anchor.path], exact: true };
  // The same path or the same tid, if it is still the same element.
  const byPath = elementAtPath(model, anchor.path);
  const pathTid = byPath ? model.tidOf.get(byPath) : undefined;
  if (byPath && pathTid !== undefined && matches(model, pathTid, print)) return { tid: pathTid, path: [...anchor.path], exact: false };
  if (model.elements[anchor.tid] && matches(model, anchor.tid, print)) return { tid: anchor.tid, path: elementPath(model, model.elements[anchor.tid]!), exact: false };
  // Elsewhere: the one element with the same tag and label (labelled elements only, so a match means something).
  if (print.tag && print.text) {
    const found = model.elements.map((_, tid) => tid).filter((tid) => matches(model, tid, print));
    if (found.length === 1) return { tid: found[0]!, path: elementPath(model, model.elements[found[0]!]!), exact: false };
  }
  return null;
}

/** Resolves an anchor against the design. */
export function resolveAnchor(anchor: DesignAnchor, doc: AnchorDocument): ResolvedAnchor {
  switch (anchor.kind) {
    case 'canvas':
    case 'point':
    case 'area':
      return { anchor, state: 'ok' };
    case 'note':
      return { anchor, state: doc.canvas.notes[anchor.note] ? 'ok' : 'orphaned' };
    case 'board':
      return { anchor, state: doc.canvas.boards[anchor.board] ? 'ok' : 'orphaned' };
    case 'element': {
      if (!doc.canvas.boards[anchor.board]) return { anchor, state: 'orphaned' };
      const model = doc.model(anchor.board);
      // Not loaded yet: trust the address.
      if (!model) return { anchor, state: 'ok', element: { tid: anchor.tid, path: [...anchor.path] } };
      const found = findElement(model, anchor);
      if (!found) return { anchor, state: 'detached' };
      return { anchor, state: found.exact ? 'ok' : 'moved', element: { tid: found.tid, path: found.path } };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Pins                                                                        */
/* -------------------------------------------------------------------------- */

/** What pin placement reads besides the anchor. */
export interface PinContext {
  boards: Readonly<Record<string, BoardEntry>>;
  notes: Readonly<Record<string, CanvasNote>>;
  /** A note's box (world px). */
  noteRect(note: CanvasNote): Rect;
  /** An element's rendered box in artboard px, `null` when the artboard is not rendered live. */
  elementRect?(board: string, tid: number): Rect | null;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * The world point a resolved anchor's pin sits at, or `null` when it has
 * none (the whole design, or an orphaned anchor). Pins follow what they are
 * anchored to: an artboard or note moved on the canvas carries its pins.
 */
export function pinWorld(resolved: ResolvedAnchor, ctx: PinContext): { x: number; y: number } | null {
  const { anchor, state } = resolved;
  if (state === 'orphaned') return null;
  switch (anchor.kind) {
    case 'canvas':
      return null;
    case 'point':
      return { x: anchor.x, y: anchor.y };
    case 'area': {
      // Where the drag was let go (top right for a thread from before corners were kept).
      const corner = anchor.corner ?? 1;
      return { x: anchor.x + (corner & 1 ? anchor.w : 0), y: anchor.y + (corner & 2 ? anchor.h : 0) };
    }
    case 'note': {
      const note = ctx.notes[anchor.note];
      if (!note) return null;
      const r = ctx.noteRect(note);
      return { x: r.x + (anchor.fx ?? 1) * r.w, y: r.y + (anchor.fy ?? 0) * r.h };
    }
    case 'board': {
      const entry = ctx.boards[anchor.board];
      if (!entry) return null;
      if (anchor.x === undefined || anchor.y === undefined) return { x: entry.x + entry.w, y: entry.y };
      return { x: entry.x + clamp(anchor.x, 0, entry.w), y: entry.y + clamp(anchor.y, 0, entry.h) };
    }
    case 'element': {
      const entry = ctx.boards[anchor.board];
      if (!entry) return null;
      const live = state !== 'detached' && resolved.element ? (ctx.elementRect?.(anchor.board, resolved.element.tid) ?? null) : null;
      const box = live ?? anchor.rect ?? null;
      if (!box) return { x: entry.x + entry.w, y: entry.y };
      const local = { x: box.x + (anchor.fx ?? 1) * box.w, y: box.y + (anchor.fy ?? 0) * box.h };
      return { x: entry.x + clamp(local.x, 0, entry.w), y: entry.y + clamp(local.y, 0, entry.h) };
    }
  }
}

/** The world box an anchor highlights while its thread is open (`null`: none). */
export function anchorHighlight(resolved: ResolvedAnchor, ctx: PinContext): Rect | null {
  const { anchor, state } = resolved;
  if (state === 'orphaned') return null;
  switch (anchor.kind) {
    case 'area':
      return { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
    case 'board': {
      const e = ctx.boards[anchor.board];
      return e ? { x: e.x, y: e.y, w: e.w, h: e.h } : null;
    }
    case 'note': {
      const note = ctx.notes[anchor.note];
      return note ? ctx.noteRect(note) : null;
    }
    case 'element': {
      const e = ctx.boards[anchor.board];
      if (!e) return null;
      if (state === 'detached' || !resolved.element) return null;
      const box = ctx.elementRect?.(anchor.board, resolved.element.tid) ?? anchor.rect ?? null;
      return box ? { x: e.x + box.x, y: e.y + box.y, w: box.w, h: box.h } : null;
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Labels and locations                                                        */
/* -------------------------------------------------------------------------- */

/** An artboard's display name. */
export function boardName(path: string, entry: BoardEntry | undefined): string {
  return entry?.title || path.replace(/^.*\//, '').replace(/\.dc\.html$/, '');
}

/** A note's display name. */
export function noteName(note: CanvasNote | undefined): string {
  if (!note) return 'Deleted note';
  const text = note.text?.trim().replace(/\s+/g, ' ');
  const kind = note.kind === 'title1' ? 'Text' : note.kind === 'rect' ? 'Rectangle' : note.kind === 'oval' ? 'Oval' : note.kind === 'pen' ? 'Drawing' : note.kind === 'line' ? 'Line' : note.kind === 'arrow' ? 'Arrow' : note.kind === 'image' ? 'Image' : note.kind === 'link' ? 'Link' : 'Sticky';
  return text ? `${kind} "${text.length > 30 ? `${text.slice(0, 29)}…` : text}"` : kind;
}

/** A short label: `Home › Button "Sign up"`, `Canvas › Area`. */
export function anchorLabel(anchor: DesignAnchor, canvas: Pick<Canvas, 'boards' | 'notes'>): string {
  switch (anchor.kind) {
    case 'canvas':
      return 'Whole design';
    case 'point':
      return 'Canvas';
    case 'area':
      return 'Canvas › Area';
    case 'note':
      return noteName(canvas.notes[anchor.note]);
    case 'board': {
      const entry = canvas.boards[anchor.board];
      return entry ? boardName(anchor.board, entry) : `Deleted artboard (${boardName(anchor.board, undefined)})`;
    }
    case 'element': {
      const entry = canvas.boards[anchor.board];
      const head = entry ? boardName(anchor.board, entry) : `Deleted artboard (${boardName(anchor.board, undefined)})`;
      return [head, ...(anchor.row ? rowWords(anchor.row) : []), elementWhat(anchor)].join(' › ');
    }
  }
}

/** An element anchor's own words: `Button "Sign up"`. */
function elementWhat(anchor: Extract<DesignAnchor, { kind: 'element' }>): string {
  return anchor.text ? `${anchor.tag ?? 'Element'} "${anchor.text.length > 30 ? `${anchor.text.slice(0, 29)}…` : anchor.text}"` : (anchor.tag ?? 'Element');
}

/**
 * What the agent reads about an element in a repeated row:
 * `Button "Edit", row 2 of 5, item 1 of 3, shown as "Ada Lovelace"`.
 * `undefined` for anything else.
 */
export function anchorDetail(anchor: DesignAnchor): string | undefined {
  if (anchor.kind !== 'element' || !anchor.row) return undefined;
  const shown = anchor.row.text ? `, shown as "${anchor.row.text}"` : '';
  return `${elementWhat(anchor)}, ${rowWords(anchor.row).join(', ')}${shown}`;
}

/** Location details the agent reads with a thread (paths under `project/`). */
export function anchorLocation(anchor: DesignAnchor, address: (board: string, tid: number, path: readonly number[]) => string | null): Record<string, string | number | { x: number; y: number } | { x: number; y: number; w: number; h: number }> {
  const out: Record<string, string | number | { x: number; y: number } | { x: number; y: number; w: number; h: number }> = { kind: anchor.kind };
  if (anchor.kind !== 'canvas' && anchor.page) out.page = anchor.page;
  switch (anchor.kind) {
    case 'element': {
      out.artboard = anchor.board;
      const id = address(anchor.board, anchor.tid, anchor.path);
      if (id) out.element = id;
      if (anchor.row) out.row = rowWords(anchor.row).join(', ');
      break;
    }
    case 'board':
      out.artboard = anchor.board;
      if (anchor.x !== undefined && anchor.y !== undefined) out.point = { x: anchor.x, y: anchor.y };
      break;
    case 'note':
      out.note = anchor.note;
      break;
    case 'point':
      out.point = { x: anchor.x, y: anchor.y };
      break;
    case 'area':
      out.area = { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
      break;
  }
  return out;
}

/** Artboards an area anchor overlaps (in canvas order). */
export function boardsInArea(area: Rect, boards: Readonly<Record<string, BoardEntry>>, paths: readonly string[]): string[] {
  return paths.filter((path) => {
    const e = boards[path];
    return e && e.x < area.x + area.w && e.x + e.w > area.x && e.y < area.y + area.h && e.y + e.h > area.y;
  });
}
