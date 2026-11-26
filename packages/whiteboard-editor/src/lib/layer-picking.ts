/**
 * Pure parts of picking a drawing's layers (see `services/drawing-layers.ts`):
 * which drawings have pickable layers, where a board point falls in a
 * drawing, where a layer's frame goes, when an edit must wait, and what is
 * said and shown.
 */

import { DRAWING_STYLES, drawingPlacement, type ImageCrop, type LayerBox } from '@open-artifact/whiteboard-core';
import type { SyncStatus } from '../state/board.ts';

/** The drawing styles whose drawings offer their layers (all but `plain`). */
const LAYERED_STYLES: ReadonlySet<string> = new Set(DRAWING_STYLES.filter((style) => style !== 'plain'));

/** True when a drawing in `style` offers its layers. */
export function isLayeredStyle(style: string | undefined): boolean {
  return style !== undefined && LAYERED_STYLES.has(style);
}

/** A press within this long after picking ended on the same drawing does not pick again. */
export const LAYER_REENTRY_GRACE_MS = 700;
/** The same refusal is shown at most once in this long. */
export const LAYER_REFUSAL_GAP_MS = 1500;
/** An edit waits when the last one is still unsaved after this long. */
export const LAYER_UNSAVED_AFTER_MS = 3000;
/** Most layers the context menu offers under the pointer. */
export const LAYERS_UNDER_POINTER = 4;

/** Why a layer edit cannot run now (a locked drawing is refused with the board's usual message). */
export type LayerRefusal = 'gone' | 'last' | 'long' | 'unread' | 'offline' | 'unsaved';

/** Where the board stands, for {@link layerEditWait}. */
export interface LayerSaveFacts {
  status: SyncStatus;
  /** Local changes the store has not acknowledged. */
  pending: number;
  online: boolean;
  /** When this page last wrote a layer edit (ms), if it is not yet known to be saved. */
  wroteAt: number | undefined;
  now: number;
}

/** Whether a layer edit must wait: the board is offline, or the last edit is still unsaved after a while. */
export function layerEditWait(facts: LayerSaveFacts): 'offline' | 'unsaved' | undefined {
  if (!facts.online || facts.status !== 'ready') return 'offline';
  return facts.wroteAt !== undefined && facts.pending > 0 && facts.now - facts.wroteAt > LAYER_UNSAVED_AFTER_MS ? 'unsaved' : undefined;
}

/** The parts of an image a drawing's placement needs. */
export interface DrawingFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  turn?: number;
  crop?: ImageCrop;
}

/** A board point in a drawing's viewBox units (the drawing has viewBox `size`). */
export function drawingPointAt(frame: DrawingFrame, size: readonly [number, number], point: { x: number; y: number }): [number, number] {
  const radians = (-(frame.turn ?? 0) * Math.PI) / 180;
  const [cx, cy] = [frame.x + frame.w / 2, frame.y + frame.h / 2];
  const [dx, dy] = [point.x - cx, point.y - cy];
  const local = [cx + dx * Math.cos(radians) - dy * Math.sin(radians) - frame.x, cy + dx * Math.sin(radians) + dy * Math.cos(radians) - frame.y] as const;
  const place = drawingPlacement(frame.w, frame.h, size, frame.crop);
  return [(local[0] - place.x) / place.scale, (local[1] - place.y) / place.scale];
}

/** A press's reach (board units) in a drawing's viewBox units. */
export function drawingSlop(frame: DrawingFrame, size: readonly [number, number], slop: number): number {
  return slop / drawingPlacement(frame.w, frame.h, size, frame.crop).scale;
}

/**
 * A layer's frame on the board, before the drawing's turn (which turns it
 * about the drawing's center), cut to what the drawing shows;
 * `undefined` when none of it shows.
 */
export function layerFrameBox(frame: DrawingFrame, size: readonly [number, number], box: LayerBox): { x: number; y: number; w: number; h: number } | undefined {
  const place = drawingPlacement(frame.w, frame.h, size, frame.crop);
  const left = Math.max(0, place.x + box[0] * place.scale);
  const top = Math.max(0, place.y + box[1] * place.scale);
  const right = Math.min(frame.w, place.x + box[2] * place.scale);
  const bottom = Math.min(frame.h, place.y + box[3] * place.scale);
  return right > left && bottom > top ? { x: frame.x + left, y: frame.y + top, w: right - left, h: bottom - top } : undefined;
}

/** A layer's name as a label: starting with a capital. */
export function layerLabel(name: string): string {
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/** A layer's name inside a sentence, kept apart from the text around it. */
function spokenName(name: string): string {
  return '⁨' + layerLabel(name) + '⁩';
}

/** What is said and shown about layers. */
export const LAYER_MESSAGES = {
  layers: 'Layers',
  menu: 'Layer actions',
  list: 'Layers of this drawing',
  select: 'Select layer',
  all: 'All layers',
  forward: 'Bring forward',
  backward: 'Send backward',
  hide: 'Hide',
  show: 'Show',
  whole: 'This works on the whole drawing, not on one layer.',
  held: 'That works on the whole drawing, so nothing was done. Press Esc first.',
  ended: 'Whole drawing selected',
  atFront: 'This layer is already at the front.',
  atBack: 'This layer is already at the back.',
  nothingOver: 'Nothing lies over this layer.',
  nothingUnder: 'Nothing lies under this layer.',
  refused: {
    gone: 'This layer has been changed or removed, so nothing was done.',
    last: 'This is the only layer that shows.',
    long: 'This drawing has no room for that change.',
    unread: 'This layer can’t be changed.',
    offline: 'Layers can’t be changed while you’re offline.',
    unsaved: 'Your last change isn’t saved yet. Try again in a moment.',
  } satisfies Record<LayerRefusal, string>,
} as const;

/** Said when a layer is picked: "{name}, layer {n} of {of}, selected". */
export function layerSelectedMessage(name: string, n: number, of: number): string {
  return `${spokenName(name)}, layer ${String(n)} of ${String(of)}, selected`;
}

/** The picked layer's name on its button. */
export function layerNameLabel(name: string): string {
  return `Layer: ${spokenName(name)}`;
}

/** Said when a layer is hidden. */
export function layerHiddenMessage(name: string): string {
  return `${spokenName(name)} hidden`;
}

/** Said when a hidden layer is shown and picked. */
export function layerShownMessage(name: string, n: number, of: number): string {
  return `${spokenName(name)} shown, layer ${String(n)} of ${String(of)}, selected`;
}

/** How a layer moved. */
export type LayerStep = 'front' | 'back' | 'forward' | 'backward';

/** Said when a layer moved. */
export function layerMovedMessage(name: string, step: LayerStep): string {
  const how = { front: 'brought to front', back: 'sent to back', forward: 'brought forward', backward: 'sent backward' }[step];
  return `${spokenName(name)} ${how}`;
}

/** Undo labels of layer edits. */
export const LAYER_EDIT_LABELS: Readonly<Record<LayerStep | 'hide' | 'show', string>> = {
  front: 'Bring layer to front',
  back: 'Send layer to back',
  forward: 'Bring layer forward',
  backward: 'Send layer backward',
  hide: 'Hide layer',
  show: 'Show layer',
};
