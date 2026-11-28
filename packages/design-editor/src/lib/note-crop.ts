/**
 * A cropped image or video note, drawn and edited. The note's box is the
 * frame; the picture fills it (cover), is zoomed `crop.zoom` times past that
 * and aligned by `crop.x`/`crop.y`. The picture's style is in percent of the
 * frame, so resizing the note keeps the crop. Editing works on the picture's
 * rectangle in the note's own (unrotated) space.
 */

import { cleanCrop, MAX_CROP_ZOOM, UNCROPPED, type NoteCrop } from '@open-artifact/design-core';

/** A number as CSS percent, at most 4 places. */
function percent(value: number): string {
  const rounded = Math.round(value * 1e4) / 1e4;
  return `${Object.is(rounded, -0) ? 0 : rounded}%`;
}

/** The picture's style inside the frame of a cropped note. */
export function cropPictureStyle(crop: NoteCrop): Record<string, string> {
  const spread = crop.zoom - 1;
  return {
    position: 'absolute',
    width: percent(crop.zoom * 100),
    height: percent(crop.zoom * 100),
    left: percent(-spread * crop.x * 100),
    top: percent(-spread * crop.y * 100),
    'max-width': 'none',
    'max-height': 'none',
    'object-fit': 'cover',
    'object-position': `${percent(crop.x * 100)} ${percent(crop.y * 100)}`,
  };
}

/** The frame's style of a cropped note: the note's look (border, corners, effects) without what the picture takes. */
export function cropFrameStyle(look: Record<string, string>): Record<string, string> {
  const frame: Record<string, string> = { position: 'absolute', inset: '0', 'box-sizing': 'border-box', overflow: 'hidden' };
  for (const [key, value] of Object.entries(look)) if (!key.startsWith('object-') && key !== 'box-sizing') frame[key] = value;
  return frame;
}

/* ------------------------------- geometry -------------------------------- */

export interface Size {
  w: number;
  h: number;
}

/** A rectangle in the note's own space (its top-left corner at 0,0, before rotation). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How much a picture of `natural` size scales to cover `frame`. */
export function coverScale(natural: Size, frame: Size): number {
  if (natural.w <= 0 || natural.h <= 0) return 1;
  return Math.max(frame.w / natural.w, frame.h / natural.h);
}

/** Where the whole (zoomed) picture lies relative to the frame, in the frame's units. */
export function pictureRect(natural: Size, frame: Box, crop: NoteCrop): Box {
  const scale = coverScale(natural, frame) * crop.zoom;
  const w = natural.w * scale;
  const h = natural.h * scale;
  return { x: frame.x + (frame.w - w) * crop.x, y: frame.y + (frame.h - h) * crop.y, w, h };
}

/** The crop that puts the picture at `picture` behind `frame`; an axis that overflows less than half a pixel sits centred. */
export function cropOf(natural: Size, frame: Box, picture: Box): NoteCrop {
  const cover = coverScale(natural, frame);
  const zoom = natural.w > 0 ? picture.w / (natural.w * cover) : 1;
  const align = (spare: number, offset: number): number => (Math.abs(spare) < 0.5 ? 0.5 : Math.min(1, Math.max(0, offset / spare)));
  const crop = { zoom: Math.min(MAX_CROP_ZOOM, Math.max(1, zoom)), x: align(frame.w - picture.w, picture.x - frame.x), y: align(frame.h - picture.h, picture.y - frame.y) };
  return cleanCrop(crop) ?? UNCROPPED;
}

/** The picture moved by `dx`,`dy`, kept covering the frame. */
export function panPicture(picture: Box, frame: Box, dx: number, dy: number): Box {
  const x = Math.min(frame.x, Math.max(frame.x + frame.w - picture.w, picture.x + dx));
  const y = Math.min(frame.y, Math.max(frame.y + frame.h - picture.h, picture.y + dy));
  return { ...picture, x, y };
}

/** Keeps the picture covering the frame: grown to cover it, then pushed back over it. */
export function coverFrame(picture: Box, frame: Box, natural: Size): Box {
  const least = coverScale(natural, frame);
  let next = picture;
  if (natural.w > 0 && picture.w < natural.w * least) {
    const w = natural.w * least;
    const h = natural.h * least;
    next = { x: picture.x - (w - picture.w) / 2, y: picture.y - (h - picture.h) / 2, w, h };
  }
  return panPicture(next, frame, 0, 0);
}

/** The picture scaled by `factor` about point `px`,`py`, with zoom kept within 1…max of the frame's cover. */
export function zoomPicture(picture: Box, frame: Box, natural: Size, factor: number, px: number, py: number, max = MAX_CROP_ZOOM): Box {
  const cover = coverScale(natural, frame);
  const least = natural.w * cover;
  const most = least * Math.max(max, picture.w / least);
  const w = Math.min(most, Math.max(least, picture.w * factor));
  const ratio = w / picture.w;
  const scaled = { x: px - (px - picture.x) * ratio, y: py - (py - picture.y) * ratio, w, h: picture.h * ratio };
  return panPicture(scaled, frame, 0, 0);
}

export type Corner = 'nw' | 'ne' | 'se' | 'sw';

/** The picture zoomed by dragging `corner` to `px`,`py`, its opposite corner held still; never smaller than covering the frame. */
export function zoomFromCorner(picture: Box, frame: Box, natural: Size, corner: Corner, px: number, py: number, max = MAX_CROP_ZOOM): Box {
  const right = corner === 'ne' || corner === 'se';
  const bottom = corner === 'se' || corner === 'sw';
  const ax = right ? picture.x : picture.x + picture.w;
  const ay = bottom ? picture.y : picture.y + picture.h;
  const ratio = picture.h / picture.w;
  const wanted = Math.max(Math.abs(px - ax), Math.abs(py - ay) / ratio);
  // The frame must stay inside: the anchored picture has to reach past the frame's far edges.
  const reachX = right ? frame.x + frame.w - ax : ax - frame.x;
  const reachY = bottom ? frame.y + frame.h - ay : ay - frame.y;
  const cover = natural.w * coverScale(natural, frame);
  const least = Math.max(cover, reachX, reachY / ratio);
  const w = Math.min(Math.max(cover * max, picture.w), Math.max(least, wanted));
  const h = w * ratio;
  return { x: right ? ax : ax - w, y: bottom ? ay : ay - h, w, h };
}

export type Edge = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
export const MIN_CROP_FRAME = 16;

/** The frame after dragging `edge` by `dx`,`dy`: within the picture, at least 16 by 16, on whole units. */
export function dragFrameEdge(frame: Box, picture: Box, edge: Edge, dx: number, dy: number): Box {
  let left = frame.x;
  let top = frame.y;
  let right = frame.x + frame.w;
  let bottom = frame.y + frame.h;
  if (edge.includes('w')) left = Math.round(Math.min(right - MIN_CROP_FRAME, Math.max(picture.x, left + dx)));
  if (edge.includes('e')) right = Math.round(Math.max(left + MIN_CROP_FRAME, Math.min(picture.x + picture.w, right + dx)));
  if (edge.includes('n')) top = Math.round(Math.min(bottom - MIN_CROP_FRAME, Math.max(picture.y, top + dy)));
  if (edge.includes('s')) bottom = Math.round(Math.max(top + MIN_CROP_FRAME, Math.min(picture.y + picture.h, bottom + dy)));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Where the frame's moved box puts the note in the world: rotation turns about the note's centre, so the top-left moves with it. */
export function placeFrame(note: { x: number; y: number; w: number; h: number; rotate?: number; flipX?: boolean; flipY?: boolean }, frame: Box): Box {
  const angle = ((note.rotate ?? 0) * Math.PI) / 180;
  const cx = note.w / 2;
  const cy = note.h / 2;
  // The frame's centre, from the note's centre, in the note's own space (flips mirror it).
  let ox = frame.x + frame.w / 2 - cx;
  let oy = frame.y + frame.h / 2 - cy;
  if (note.flipX) ox = -ox;
  if (note.flipY) oy = -oy;
  const wx = note.x + cx + ox * Math.cos(angle) - oy * Math.sin(angle);
  const wy = note.y + cy + ox * Math.sin(angle) + oy * Math.cos(angle);
  return { x: Math.round(wx - frame.w / 2), y: Math.round(wy - frame.h / 2), w: frame.w, h: frame.h };
}

/** The crop a picture already shows through `object-fit: cover` and `object-position` (e.g. `20% 50%`): its alignment, unzoomed. */
export function cropFromPosition(position: string | undefined): NoteCrop {
  const words = (position ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const keyword: Record<string, [axis: 'x' | 'y' | 'any', at: number]> = { left: ['x', 0], right: ['x', 1], top: ['y', 0], bottom: ['y', 1], center: ['any', 0.5] };
  let x: number | null = null;
  let y: number | null = null;
  for (const word of words.slice(0, 2)) {
    const known = keyword[word];
    const amount = /^-?\d+(\.\d+)?%$/.test(word) ? Number.parseFloat(word) / 100 : null;
    if (known && known[0] === 'x') x = known[1];
    else if (known && known[0] === 'y') y = known[1];
    else if (known || amount !== null) {
      const at = known ? known[1] : Math.min(1, Math.max(0, amount!));
      if (x === null) x = at;
      else y = at;
    }
  }
  return { zoom: 1, x: x ?? 0.5, y: y ?? 0.5 };
}

/* ------------------------------- the session ------------------------------ */

export const CROP_MESSAGES = {
  flipped: 'Crop does not work while this is flipped. Flip it back first.',
  unloaded: 'This picture has not loaded, so there is nothing to crop yet.',
  started: 'Cropping. Press Enter when done. Drag an edge to crop. Arrow keys move the picture. Plus and minus zoom it.',
  cancelled: 'Cropping cancelled.',
  cropped: 'Cropped.',
  removed: 'Crop removed.',
  busy: 'Finish cropping or editing points first',
  flip: 'Finish cropping to flip',
} as const;

/** Why a note cannot be cropped now, or null. */
export function cropRefusal(note: { locked?: boolean; flipX?: boolean; flipY?: boolean }, loaded: boolean): 'locked' | 'flipped' | 'unloaded' | null {
  if (note.locked) return 'locked';
  if (note.flipX || note.flipY) return 'flipped';
  return loaded ? null : 'unloaded';
}

/** The border a note's box gives up on each side (a border drawn inside the edge; an outline takes nothing). */
export function contentInsets(css: Record<string, string> | undefined): { top: number; right: number; bottom: number; left: number } {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!css) return none;
  const style = css['border-style'];
  const position = css['border-position'];
  if (style === 'none' || style === 'hidden' || position === 'outside' || position === 'center') return none;
  const width = (value: string | undefined): number => {
    const match = value ? /^(\d+(?:\.\d+)?)px$/.exec(value.trim()) : null;
    return match ? Number(match[1]) : 0;
  };
  const all = width(css['border-width']);
  const side = (name: string): number => (css[`border-${name}-width`] !== undefined ? width(css[`border-${name}-width`]) : all);
  return { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
}

/** Each crop handle's name for a screen reader. */
export const EDGE_LABELS: Record<Edge, string> = {
  n: 'Crop handle, top edge',
  e: 'Crop handle, right edge',
  s: 'Crop handle, bottom edge',
  w: 'Crop handle, left edge',
  nw: 'Crop handle, top left',
  ne: 'Crop handle, top right',
  se: 'Crop handle, bottom right',
  sw: 'Crop handle, bottom left',
};

export const ZOOM_LABELS: Record<Corner, string> = {
  nw: 'Zoom handle, top left',
  ne: 'Zoom handle, top right',
  se: 'Zoom handle, bottom right',
  sw: 'Zoom handle, bottom left',
};

/** What a key does while cropping. */
export type CropKey =
  | { kind: 'confirm' }
  /** Confirms, and the key goes on to the editor. */
  | { kind: 'confirm-pass' }
  | { kind: 'cancel' }
  /** Ends nothing; the editor takes the key as usual (Space, canvas zoom). */
  | { kind: 'pass' }
  /** Ends nothing and does nothing (Tab). */
  | { kind: 'hold' }
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'zoom'; factor: number };

export interface CropKeyPress {
  key: string;
  code?: string;
  meta: boolean;
  shift: boolean;
  alt?: boolean;
}

const MODIFIERS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Fn']);
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** What a key press does while cropping: arrows move the picture (Shift 10), + and − zoom, Enter and Escape finish, ⌘Z cancels. */
export function cropKeyAction(press: CropKeyPress): CropKey {
  if (MODIFIERS.has(press.key)) return { kind: 'pass' };
  if (press.meta) {
    const z = press.code === 'KeyZ' || (!press.code && press.key.toLowerCase() === 'z');
    if (z && !press.shift) return { kind: 'cancel' };
    if (['-', '=', '+', '0', '1', '_'].includes(press.key) || ['Minus', 'Equal', 'Digit0', 'Digit1', 'NumpadAdd', 'NumpadSubtract', 'Numpad0', 'Numpad1'].includes(press.code ?? '')) return { kind: 'pass' };
    return { kind: 'confirm-pass' };
  }
  if (press.key === 'Enter' || press.key === 'Escape') return { kind: 'confirm' };
  if (press.key === ' ') return { kind: 'pass' };
  if (press.key === 'Tab') return { kind: 'hold' };
  const arrow = ARROWS[press.key];
  if (arrow) {
    const step = press.shift ? 10 : 1;
    return { kind: 'move', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (!press.alt && (press.key === '+' || press.key === '=')) return { kind: 'zoom', factor: 1.1 };
  if (!press.alt && (press.key === '-' || press.key === '_')) return { kind: 'zoom', factor: 1 / 1.1 };
  return { kind: 'confirm-pass' };
}

/** A screen-space movement in the note's own space: undoes the note's rotation and the canvas zoom. */
export function intoNote(dx: number, dy: number, rotate: number | undefined, zoom: number): { dx: number; dy: number } {
  const angle = (-(rotate ?? 0) * Math.PI) / 180;
  return { dx: (dx * Math.cos(angle) - dy * Math.sin(angle)) / zoom, dy: (dx * Math.sin(angle) + dy * Math.cos(angle)) / zoom };
}
