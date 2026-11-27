/**
 * The arithmetic of the text styles bar that floats over a line of words in full screen: when it may show, which
 * layer a pressed word's styles belong to, and where the bar goes. Pure.
 */

import { flattenLayers } from '@open-artifact/motion-stage/layers';
import type { LayerBox, LayerRow } from '@open-artifact/motion-stage/protocol';
import type { TextBox } from '@open-artifact/motion-core';

/** What decides whether the bar may show. */
export interface TextBarGate {
  fullscreen: boolean;
  /** The Tweaks panel is open. */
  tweaksOpen: boolean;
  /** The film is drawn and can be read. */
  ready: boolean;
  playing: boolean;
  /** Comment mode is on, or a comment is being placed. */
  commenting: boolean;
  readOnly: boolean;
}

/**
 * The bar shows where the Layers section cannot: in full screen, with Tweaks open and the film paused, while the words
 * can be changed (not in comment mode, not read only).
 */
export const textBarApplies = (gate: TextBarGate): boolean =>
  gate.fullscreen && gate.tweaksOpen && gate.ready && !gate.playing && !gate.commenting && !gate.readOnly;

const inside = (box: LayerBox, x: number, y: number): boolean => x >= box[0] && x <= box[0] + box[2] && y >= box[1] && y <= box[1] + box[3];

/**
 * The line of words a pressed word belongs to: the smallest text layer, with styles the stage can tell, whose words'
 * box (else its box) holds the middle of the word's first box. Film pixels. null: none.
 */
export function textRowForWord(rows: readonly LayerRow[] | null, boxes: readonly TextBox[]): LayerRow | null {
  const first = boxes[0];
  if (first === undefined) return null;
  const x = first.x + first.w / 2;
  const y = first.y + first.h / 2;
  let best: LayerRow | null = null;
  let bestArea = Infinity;
  for (const row of flattenLayers(rows)) {
    const box = row.wordsBox ?? row.box;
    if (row.kind !== 'text' || row.look === null || /[+*]/.test(row.id) || box === null || !inside(box, x, y)) continue;
    const area = box[2] * box[3];
    if (area < bestArea) {
      best = row;
      bestArea = area;
    }
  }
  return best;
}

/** Sides of a box, in the picture's pixels on screen. */
export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The box round all of a word's boxes, from film pixels to the picture on screen (`scale`). null: no box. */
export function wordEdges(boxes: readonly TextBox[], scale: number): Edges | null {
  if (boxes.length === 0) return null;
  return {
    left: Math.min(...boxes.map((box) => box.x)) * scale,
    top: Math.min(...boxes.map((box) => box.y)) * scale,
    right: Math.max(...boxes.map((box) => box.x + box.w)) * scale,
    bottom: Math.max(...boxes.map((box) => box.y + box.h)) * scale,
  };
}

/** Gap between the bar and the words. */
export const TEXT_BAR_GAP = 10;
/** How far inside the picture's top and bottom the bar stays. */
export const TEXT_BAR_INSET = 4;
/** How far inside the picture's sides the bar stays. */
export const TEXT_BAR_MARGIN = 8;

export interface TextBarPlace {
  left: number;
  top: number;
  /** Which side of the words the bar is on: the More tools card opens on that side. */
  placed: 'above' | 'below';
  /** No room above or below: the bar sits over part of the words. */
  covers: boolean;
  /** The bar's widest. */
  most: number;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/**
 * Where the bar goes over the picture (`view`, its size on screen): above the words where there is room inside the
 * picture, else below them; across, centred on the words and kept inside the picture's sides.
 */
export function placeTextBar(view: { width: number; height: number }, bar: { width: number; height: number }, words: Edges): TextBarPlace {
  const half = Math.min(bar.width, view.width - 2 * TEXT_BAR_MARGIN) / 2;
  const above = words.top - bar.height - TEXT_BAR_GAP;
  const below = words.bottom + TEXT_BAR_GAP;
  const lowest = view.height - TEXT_BAR_INSET - bar.height;
  const noRoomAbove = Math.round(above) < TEXT_BAR_INSET;
  const covers = noRoomAbove && lowest < words.bottom;
  const placed = noRoomAbove && !covers ? 'below' : 'above';
  const centre = clamp((words.left + words.right) / 2, TEXT_BAR_MARGIN + half, view.width - TEXT_BAR_MARGIN - half);
  return {
    left: Math.max(TEXT_BAR_MARGIN, centre - bar.width / 2),
    top: clamp(placed === 'below' ? below : above, TEXT_BAR_INSET, Math.max(TEXT_BAR_INSET, lowest)),
    placed,
    covers,
    most: Math.max(0, view.width - 2 * TEXT_BAR_MARGIN),
  };
}

/** The label of the bar's style chip: the weight and the size, e.g. "Semibold · 48"; else what the chip holds. */
export function styleChipLabel(weight: string | null, px: number | null, fallback: string): string {
  const parts = [weight, px === null ? null : String(Math.round(px))].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : fallback;
}

/** What {@link boldItalicKey} reads of a key press. */
export interface ModKeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Cmd+B or Cmd+I (Ctrl elsewhere) without Shift or Option: 'b' or 'i'. The letter is read off the key where the
 * keyboard types Latin letters, else off where the key sits. null: neither.
 */
export function boldItalicKey(press: ModKeyPress, apple: boolean): 'b' | 'i' | null {
  if (press.altKey || press.shiftKey) return null;
  if (apple ? !press.metaKey || press.ctrlKey : !press.ctrlKey || press.metaKey) return null;
  const code = /^\p{Script=Latin}$/u.test(press.key) ? 'Key' + press.key.toUpperCase() : press.code;
  return code === 'KeyB' ? 'b' : code === 'KeyI' ? 'i' : null;
}
