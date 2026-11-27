/**
 * Picking one layer of a drawing: a styled SVG drawing whose named groups
 * right under the root are its layers. Double-click (or Enter) on the
 * selected drawing picks the layer there; while one is picked, presses on
 * the drawing switch layers, a press elsewhere ends picking, and the layer
 * can be moved, hidden and shown. The pick lives in the selection store
 * (`layer`). An edit rewrites the drawing's SVG and records an undo step
 * of its own that undoes and redoes only that layer, so changes made to
 * the drawing meanwhile stay.
 */

import { useMemo } from 'react';
import {
  decodeSvgDataUrl,
  drawingLayerHits,
  drawingLayerShapesOf,
  drawingLayersOf,
  drawingPlacement,
  findDrawingLayer,
  firstSolidDrawingLayer,
  hitSlop,
  imageDrawingLook,
  isElementLocked,
  isLayerEditRefusal,
  layerMoveEdit,
  layerVisibilityEdit,
  moveDrawingLayer,
  normalizeImageSource,
  overlappingDrawingLayer,
  svgToBase64DataUrl,
  topDrawingLayerHit,
  type BoardElement,
  type DrawingLayer,
  type DrawingLayerEdit,
  type DrawingLayerShapes,
  type ElementId,
  type HistoryStep,
  type ImageElement,
  type LayerBox,
  type LayerDestination,
  type LayerEditRefusal,
  type LayerRef,
  type LayerShapes,
} from '@open-artifact/whiteboard-core';
import { focusBoardHome, isInSelectionBar } from '../elements/embed-control.ts';
import type { Point } from '../lib/camera.ts';
import {
  LAYER_EDIT_LABELS,
  LAYER_MESSAGES,
  LAYER_REENTRY_GRACE_MS,
  LAYER_REFUSAL_GAP_MS,
  drawingPointAt,
  drawingSlop,
  isLayeredStyle,
  layerEditWait,
  layerHiddenMessage,
  layerMovedMessage,
  layerSelectedMessage,
  layerShownMessage,
  type LayerRefusal,
  type LayerStep,
} from '../lib/layer-picking.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useSelection, type PickedLayer } from '../state/selection.ts';
import { useTool, type ToolState } from '../state/tool.ts';
import { canEditBoard, patchElements } from './actions.ts';
import { LOCKED_MESSAGE, announce, notify, refuse } from './announce.ts';

/** A drawing whose layers can be picked. */
export interface LayeredDrawing {
  element: ImageElement;
  svg: string;
  /** Every layer, back to front. */
  layers: readonly DrawingLayer[];
  shapes: DrawingLayerShapes;
  /** The layers that draw something inside the frame, back to front. */
  shown: readonly DrawingLayer[];
  /** The shown layers and the hidden ones that would draw something, back to front. */
  listed: readonly DrawingLayer[];
  /** The part of the drawing the frame shows, in viewBox units. */
  window: LayerBox;
}

const DRAWN_PART = /<(?:path|rect|circle|ellipse|line|polyline|polygon|use|image)\b/;

function overlaps(a: LayerBox, b: LayerBox): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

function readLayeredDrawing(element: ImageElement): LayeredDrawing | undefined {
  if (!isLayeredStyle(imageDrawingLook(element))) return undefined;
  const svg = decodeSvgDataUrl(element.src, true);
  const layers = svg === undefined ? undefined : drawingLayersOf(svg);
  const shapes = svg === undefined || layers === undefined ? undefined : drawingLayerShapesOf(svg);
  if (svg === undefined || layers === undefined || shapes === undefined) return undefined;
  const place = drawingPlacement(element.w, element.h, shapes.size, element.crop);
  const window: LayerBox = [-place.x / place.scale, -place.y / place.scale, (element.w - place.x) / place.scale, (element.h - place.y) / place.scale];
  const drawn = new Map(shapes.layers.map((layer) => [layer.n, layer]));
  const shown = layers.filter((layer) => {
    const shape = drawn.get(layer.n);
    return shape !== undefined && !layer.hidden && overlaps(shape.box, window);
  });
  const listed = layers.filter((layer) => shown.includes(layer) || (layer.hidden && DRAWN_PART.test(svg.slice(layer.open, layer.to))));
  return listed.length === 0 ? undefined : { element, svg, layers, shapes, shown, listed, window };
}

const drawings = new WeakMap<ImageElement, LayeredDrawing | null>();

/** The element as a drawing with pickable layers, if it is one. */
export function layeredDrawing(element: BoardElement | undefined): LayeredDrawing | undefined {
  if (element?.type !== 'image') return undefined;
  let drawing = drawings.get(element);
  if (drawing === undefined) {
    drawing = readLayeredDrawing(element) ?? null;
    drawings.set(element, drawing);
  }
  return drawing ?? undefined;
}

/** The layer picked now, with where it stands. */
export interface PickedDrawingLayer {
  drawing: LayeredDrawing;
  layer: DrawingLayer;
  shape: LayerShapes;
  /** Its place among the shown layers, 1 at the back. */
  nth: number;
  /** How many layers show. */
  of: number;
}

/** What `pick` names on `element`, while it can still be worked on. */
export function resolvePickedLayer(pick: PickedLayer | null, element: BoardElement | undefined, editable: boolean = canEditBoard()): PickedDrawingLayer | undefined {
  if (pick === null || element?.id !== pick.el || !editable || isElementLocked(element)) return undefined;
  const drawing = layeredDrawing(element);
  const layer = drawing === undefined ? undefined : findDrawingLayer(drawing.svg, pick);
  const index = layer === undefined || drawing === undefined ? -1 : drawing.shown.indexOf(layer);
  const shape = drawing?.shapes.layers.find((item) => item.n === layer?.n);
  if (drawing === undefined || layer === undefined || index < 0 || shape === undefined) return undefined;
  return { drawing, layer, shape, nth: index + 1, of: drawing.shown.length };
}

/** Layers are not worked on while another tool is out or comments are being placed (a pick waits until they end). */
function isAway(tool: Pick<ToolState, 'tool' | 'commentMode'>): boolean {
  return tool.tool !== 'select' || tool.commentMode;
}

/** The layer picked now. */
export function pickedDrawingLayer(): PickedDrawingLayer | undefined {
  const { layer, ids } = useSelection.getState();
  if (layer === null || ids.length !== 1 || isAway(useTool.getState())) return undefined;
  return resolvePickedLayer(layer, useBoard.getState().byId.get(layer.el));
}

/** The layer picked now, for components. */
export function usePickedLayer(): PickedDrawingLayer | undefined {
  const pick = useSelection((state) => state.layer);
  const element = useBoard((state) => (pick === null ? undefined : state.byId.get(pick.el)));
  const away = useTool(isAway);
  return useMemo(() => (away ? undefined : resolvePickedLayer(pick, element)), [away, pick, element]);
}

/* ------------------------------------------------------------------------ */
/* Picking                                                                  */
/* ------------------------------------------------------------------------ */

/** When picking last ended by a press, and on which drawing. */
let endedByPress: { id: ElementId; at: number } = { id: '', at: Number.NEGATIVE_INFINITY };
/** A layer was just hidden: the next Delete only says the whole drawing is selected. */
let justHid = false;

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function pick(drawing: LayeredDrawing, layer: DrawingLayer, message: (name: string, n: number, of: number) => string = layerSelectedMessage): void {
  useSelection.getState().pickLayer({ el: drawing.element.id, n: layer.n, id: layer.id });
  const shown = drawing.shown.includes(layer) ? drawing.shown : [...drawing.shown, layer].sort((a, b) => a.n - b.n);
  announce(message(layer.name, shown.indexOf(layer) + 1, shown.length));
}

/** The shown layers under a board point on a drawing, front first. */
export function layersAt(drawing: LayeredDrawing, point: Point, slop: number): DrawingLayer[] {
  const { element, shapes } = drawing;
  const [x, y] = drawingPointAt(element, shapes.size, point);
  const reach = drawingSlop(element, shapes.size, slop);
  return drawingLayerHits(shapes, x, y, reach).flatMap((hit) => drawing.shown.filter((layer) => layer.n === hit.n));
}

function topLayerAt(drawing: LayeredDrawing, point: Point, slop: number): DrawingLayer | undefined {
  const { element, shapes } = drawing;
  const [x, y] = drawingPointAt(element, shapes.size, point);
  const shownHits = drawingLayerHits(shapes, x, y, drawingSlop(element, shapes.size, slop)).filter((hit) => drawing.shown.some((layer) => layer.n === hit.n));
  const n = topDrawingLayerHit(shownHits);
  return drawing.shown.find((layer) => layer.n === n);
}

/** Whether picking can start on `element`: a selected, unlocked drawing with layers on an editable board. */
function enterable(element: BoardElement | undefined): LayeredDrawing | undefined {
  if (element === undefined || !canEditBoard() || isElementLocked(element) || isAway(useTool.getState())) return undefined;
  return layeredDrawing(element);
}

/**
 * A double-click (or double tap) on a drawing with layers picks the layer
 * there. `true` when the drawing has layers (so the press does not crop it),
 * even when nothing was picked.
 */
export function enterLayerAt(element: BoardElement, point: Point, pointerType: string): boolean {
  const drawing = enterable(element);
  if (drawing === undefined) return false;
  if (endedByPress.id === element.id && now() - endedByPress.at < LAYER_REENTRY_GRACE_MS) return true;
  const layer = topLayerAt(drawing, point, hitSlop(pointerType, useCamera.getState().camera.zoom));
  if (layer !== undefined) pick(drawing, layer);
  return true;
}

/** Enter on a selected drawing with layers (not a link) picks its first solid layer. */
export function enterFirstLayer(): boolean {
  const { ids, layer: current } = useSelection.getState();
  const element = ids.length === 1 ? useBoard.getState().byId.get(ids[0]!) : undefined;
  const drawing = current === null ? enterable(element) : undefined;
  if (drawing === undefined || drawing.element.href !== undefined) return false;
  const n = firstSolidDrawingLayer({ ...drawing.shapes, layers: drawing.shapes.layers.filter((shape) => drawing.shown.some((layer) => layer.n === shape.n)) });
  const layer = drawing.shown.find((item) => item.n === n);
  if (layer !== undefined) pick(drawing, layer);
  return true;
}

/** Ends picking: the whole drawing is selected again. */
export function leaveLayer(): boolean {
  if (useSelection.getState().layer === null) return false;
  const picked = pickedDrawingLayer();
  useSelection.getState().pickLayer(null);
  if (picked !== undefined) announce(LAYER_MESSAGES.ended);
  return true;
}

/** Says which layer is picked (as picking it does); `false` when none is. */
export function sayPickedLayer(): boolean {
  const picked = pickedDrawingLayer();
  if (picked === undefined) return false;
  announce(layerSelectedMessage(picked.layer.name, picked.nth, picked.of));
  return true;
}

/** Picks a listed layer; a hidden one is shown first. */
export function chooseLayer(ref: LayerRef, element: BoardElement | undefined = selectedDrawing()): boolean {
  const drawing = enterable(element);
  const layer = drawing?.listed.find((item) => item.n === ref.n && item.id === ref.id);
  if (drawing === undefined || layer === undefined) return false;
  if (layer.hidden) return showLayer(drawing, layer);
  pick(drawing, layer);
  return true;
}

/** The one selected element, when it is a drawing. */
function selectedDrawing(): BoardElement | undefined {
  const { ids } = useSelection.getState();
  return ids.length === 1 ? useBoard.getState().byId.get(ids[0]!) : undefined;
}

/**
 * A press while a layer is picked (no modifiers, primary button). On the
 * drawing it picks the layer there and takes the press; with no layer
 * there, or elsewhere, picking ends and the press goes on as usual.
 * `true` when it took the press.
 */
export function pressWhilePicked(hit: BoardElement | undefined, point: Point, pointerType: string): boolean {
  const picked = pickedDrawingLayer();
  if (picked === undefined) return false;
  const drawing = picked.drawing;
  const under = hit?.id === drawing.element.id ? layersAt(drawing, point, hitSlop(pointerType, useCamera.getState().camera.zoom)) : [];
  if (pointerType === 'touch' && under.length > 0) return false;
  const top = under[0];
  if (top === undefined) {
    endedByPress = { id: drawing.element.id, at: now() };
    leaveLayer();
    return false;
  }
  if (top.n !== picked.layer.n) pick(drawing, top);
  return true;
}

/** A right-click while a layer is picked picks the layer under it, or ends picking. */
export function rightClickWhilePicked(point: Point): void {
  const picked = pickedDrawingLayer();
  if (picked === undefined) return;
  const [top] = layersAt(picked.drawing, point, hitSlop('mouse', useCamera.getState().camera.zoom));
  if (top === undefined) leaveLayer();
  else if (top.n !== picked.layer.n) pick(picked.drawing, top);
}

/* ------------------------------------------------------------------------ */
/* Edits                                                                    */
/* ------------------------------------------------------------------------ */

/** A layer action from the toolbar, menus or keys. */
export type LayerAction = LayerStep | 'hide';

/** Where layer edits record their undo steps (installed by sync). */
export interface LayerHistory {
  /** Called before an edit writes, so earlier open steps end first. */
  begin(): void;
  seed(step: HistoryStep): void;
}

let layerHistory: LayerHistory | null = null;

/** Installs (or, with `null`, removes) where layer edits record their steps. */
export function setLayerHistory(next: LayerHistory | null): void {
  layerHistory = next;
}

/** When this page last wrote a layer edit that may not be saved yet. */
let wroteAt: number | undefined;
let lastRefusal: { why: string; at: number } = { why: '', at: Number.NEGATIVE_INFINITY };

function refuseLayer(why: LayerRefusal): false {
  if (lastRefusal.why === why && now() - lastRefusal.at < LAYER_REFUSAL_GAP_MS) return false;
  lastRefusal = { why, at: now() };
  return refuse(LAYER_MESSAGES.refused[why]);
}

function waitNow(): 'offline' | 'unsaved' | undefined {
  const { status, pending } = useBoard.getState();
  return layerEditWait({ status, pending, online: typeof navigator === 'undefined' || navigator.onLine !== false, wroteAt, now: now() });
}

/** Why a layer edit has to wait now, as a message; `undefined` when it can run. */
export function layerEditBlocked(): string | undefined {
  const why = waitNow();
  return why === undefined ? undefined : LAYER_MESSAGES.refused[why];
}

/** Writes `change` of the drawing `id`'s SVG without a step of the board's own: the new SVG, `false` when unchanged, or why not. */
function writeDrawing(id: ElementId, change: (svg: string) => string | LayerEditRefusal): string | LayerEditRefusal | false {
  const element = useBoard.getState().byId.get(id);
  const svg = element?.type === 'image' ? decodeSvgDataUrl(element.src, true) : undefined;
  if (element === undefined || svg === undefined) return 'gone';
  const next = change(svg);
  if (isLayerEditRefusal(next)) return next;
  if (next === svg) return false;
  const src = normalizeImageSource(svgToBase64DataUrl(next));
  if (src === undefined) return 'long';
  if (!patchElements([id], (item) => (item === element ? { ...element, src } : item), { history: false })) return 'gone';
  wroteAt = now();
  return next;
}

/** A layer edit may run now; says why not when it can't. */
function layerEditAllowed(): boolean {
  const wait = waitNow();
  if (wait !== undefined) refuseLayer(wait);
  return wait === undefined;
}

/** Makes a layer edit and records its step; the new SVG, or `false` when refused or unchanged. */
function editDrawing(id: ElementId, label: string, edit: DrawingLayerEdit): string | false {
  const element = useBoard.getState().byId.get(id);
  if (element === undefined) return refuseLayer('gone');
  if (isElementLocked(element)) return refuse(LOCKED_MESSAGE);
  if (layeredDrawing(element) === undefined) return refuseLayer('gone');
  if (!layerEditAllowed()) return false;
  layerHistory?.begin();
  const next = writeDrawing(id, (svg) => edit.apply(svg));
  if (next === false) return false;
  if (isLayerEditRefusal(next)) return refuseLayer(next);
  const replay = (change: (svg: string) => string | LayerEditRefusal) => (): void => {
    const done = writeDrawing(id, change);
    if (done !== false && isLayerEditRefusal(done)) refuseLayer(done);
  };
  layerHistory?.seed({
    label,
    do: replay((svg) => edit.apply(svg)),
    undo: replay((svg) => edit.revert(svg)),
    canDo: layerEditAllowed,
    canUndo: layerEditAllowed,
  });
  return next;
}

/** Why each layer action cannot run on the picked layer now. */
export function layerActionRefusals(picked: PickedDrawingLayer | undefined): Partial<Record<LayerAction, string>> {
  if (picked === undefined) return {};
  const { drawing, layer } = picked;
  const stays = (to: number): boolean => {
    const moved = moveDrawingLayer(drawing.svg, layer, to);
    return isLayerEditRefusal(moved) || moved === drawing.svg;
  };
  const refusals: Partial<Record<LayerAction, string>> = {};
  if (stays(drawing.layers.length - 1)) refusals.front = LAYER_MESSAGES.atFront;
  if (stays(0)) refusals.back = LAYER_MESSAGES.atBack;
  if (overlappingDrawingLayer(drawing.shapes, layer.n, 'forward') === undefined) refusals.forward = LAYER_MESSAGES.nothingOver;
  if (overlappingDrawingLayer(drawing.shapes, layer.n, 'backward') === undefined) refusals.backward = LAYER_MESSAGES.nothingUnder;
  if (picked.of === 1) refusals.hide = LAYER_MESSAGES.refused.last;
  return refusals;
}

/** Moves or hides the picked layer. */
export function runLayerAction(action: LayerAction): boolean {
  const picked = pickedDrawingLayer();
  if (picked === undefined) return false;
  const { drawing, layer } = picked;
  const id = drawing.element.id;
  if (action === 'hide') {
    if (picked.of === 1) return refuseLayer('last');
    const fromBar = typeof document !== 'undefined' && isInSelectionBar(document.activeElement);
    if (editDrawing(id, LAYER_EDIT_LABELS.hide, layerVisibilityEdit(layer, true)) === false) return false;
    useSelection.getState().pickLayer(null);
    justHid = true;
    announce(layerHiddenMessage(layer.name));
    // The hide button goes away with the pick: the keyboard goes back to the drawing.
    if (fromBar) focusBoardHome();
    return true;
  }
  let to: LayerDestination;
  if (action === 'front' || action === 'back') to = action;
  else {
    const neighbor = overlappingDrawingLayer(drawing.shapes, layer.n, action);
    if (neighbor === undefined) {
      notify(action === 'forward' ? LAYER_MESSAGES.nothingOver : LAYER_MESSAGES.nothingUnder);
      return false;
    }
    to = neighbor;
  }
  const own = drawing.svg.slice(layer.from, layer.to);
  const next = editDrawing(id, LAYER_EDIT_LABELS[action], layerMoveEdit(layer, to));
  if (next === false) return false;
  const moved = drawingLayersOf(next)?.find((item) => item.id === layer.id && next.slice(item.from, item.to) === own);
  if (moved !== undefined) useSelection.getState().pickLayer({ el: id, n: moved.n, id: moved.id });
  announce(layerMovedMessage(layer.name, action));
  return true;
}

/** Shows a hidden layer and picks it. */
function showLayer(drawing: LayeredDrawing, layer: DrawingLayer): boolean {
  const next = editDrawing(drawing.element.id, LAYER_EDIT_LABELS.show, layerVisibilityEdit(layer, false));
  if (next === false) return false;
  const shown = layeredDrawing(useBoard.getState().byId.get(drawing.element.id));
  const again = shown?.shown.find((item) => item.id === layer.id && item.n === layer.n);
  if (shown !== undefined && again !== undefined) pick(shown, again, layerShownMessage);
  return true;
}

/* ------------------------------------------------------------------------ */
/* Keys and lifetime                                                        */
/* ------------------------------------------------------------------------ */

/** Says a whole-drawing command does not run while a layer is picked. */
export function holdWholeDrawing(repeat = false): void {
  if (!repeat) notify(LAYER_MESSAGES.held);
}

/**
 * Delete right after hiding a layer only says the whole drawing is
 * selected (so a second press does not delete the drawing). `true` when
 * it took the key.
 */
export function deleteAfterHide(key: string, repeat: boolean): boolean {
  if (key !== 'Delete' && key !== 'Backspace') {
    if (key !== 'Shift' && key !== 'Control' && key !== 'Alt' && key !== 'Meta') justHid = false;
    return false;
  }
  if (!justHid) return false;
  if (!repeat) {
    justHid = false;
    announce(LAYER_MESSAGES.ended);
  }
  return true;
}

function isTypingNode(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * Keeps the pick honest: ends it (saying so) when its layer is gone,
 * hidden or no longer selectable, refuses copy and cut while one is
 * picked, and learns when layer edits are saved.
 */
export function startDrawingLayers(): () => void {
  const check = (): void => {
    const { layer, ids } = useSelection.getState();
    if (layer === null || isAway(useTool.getState()) || pickedDrawingLayer() !== undefined) return;
    useSelection.getState().pickLayer(null);
    if (ids.length === 1 && ids[0] === layer.el) announce(LAYER_MESSAGES.ended);
  };
  const offSelection = useSelection.subscribe((state, previous) => {
    if (state.layer !== previous.layer || state.ids !== previous.ids) check();
  });
  const offBoard = useBoard.subscribe((state, previous) => {
    if (state.pending === 0) wroteAt = undefined;
    if (state.byId !== previous.byId) check();
  });
  const offTool = useTool.subscribe((state, previous) => {
    if (isAway(state) !== isAway(previous)) check();
  });
  const onClipboard = (event: ClipboardEvent): void => {
    if (event.defaultPrevented || pickedDrawingLayer() === undefined || isTypingNode(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    holdWholeDrawing();
  };
  const onPointerDown = (): void => {
    justHid = false;
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('copy', onClipboard, true);
    document.addEventListener('cut', onClipboard, true);
    window.addEventListener('pointerdown', onPointerDown, true);
  }
  return () => {
    offSelection();
    offBoard();
    offTool();
    if (typeof document !== 'undefined') {
      document.removeEventListener('copy', onClipboard, true);
      document.removeEventListener('cut', onClipboard, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    }
    useSelection.getState().pickLayer(null);
    wroteAt = undefined;
    justHid = false;
  };
}
