/** The arithmetic of pictures: which files are taken, size names, alt text, crops and widths. */

/** Pictures larger than this are not taken. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** The most pictures one paste, drop or pick adds. */
export const MAX_IMAGE_FILES = 20;

/** Picture types the doc can read the size of, and so keeps. */
export const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export type FileVerdict = 'ok' | 'notImage' | 'tooLarge' | 'empty';

export function judgeImageFile(file: { type: string; size: number }): FileVerdict {
  if (!IMAGE_TYPES.has(file.type.toLowerCase())) return 'notImage';
  if (file.size === 0) return 'empty';
  if (file.size > MAX_IMAGE_BYTES) return 'tooLarge';
  return 'ok';
}

/** Why some of the files given were left out, or null when every one was taken. */
export function refusalMessage(verdicts: readonly FileVerdict[], overCount = 0): string | null {
  const count = (kind: FileVerdict) => verdicts.filter(verdict => verdict === kind).length;
  const tooLarge = count('tooLarge');
  const notImage = count('notImage');
  const empty = count('empty');
  if (tooLarge + notImage + empty === 0) return overCount ? `Only ${MAX_IMAGE_FILES} images can be added at once. The first ${MAX_IMAGE_FILES} were added.` : null;
  if (tooLarge && !notImage && !empty) return tooLarge === 1 ? 'That image is over 20 MB.' : `${tooLarge} images are over 20 MB.`;
  if (notImage && !tooLarge && !empty) return notImage === 1 ? 'Only PNG, JPEG, GIF and WebP images can be added.' : `${notImage} files aren’t PNG, JPEG, GIF or WebP images.`;
  if (empty && !tooLarge && !notImage) return 'That file is empty.';
  return `${tooLarge + notImage + empty} files couldn’t be added. Images can be up to 20 MB.`;
}

/** The size names of the size menu, and what the doc stores for each. */
export const IMAGE_SIZES = [
  { width: 'small', label: 'Small' },
  { width: 'medium', label: 'Medium' },
  { width: 'large', label: 'Large' },
  { width: 'full', label: 'Extra large' },
] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number]['width'];

export function sizeOf(width: unknown): ImageSize | null {
  return IMAGE_SIZES.find(size => size.width === width)?.width ?? null;
}

export const sizeLabel = (size: ImageSize) => IMAGE_SIZES.find(item => item.width === size)!.label;

/** Longest alt text kept. */
export const ALT_MAX = 2048;

/** Alt text as it is kept: on one line, without invisible characters, trimmed; empty is null. */
export function cleanAlt(text: string): string | null {
  const flat = text
    .replace(/[\t\n\r\u000B\u000C\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, '')
    .trim();
  return flat ? flat : null;
}

/** The kept part of a picture, as fractions of the whole. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export type CropEdge = 'n' | 's' | 'e' | 'w';

/** Narrowest crop, as a fraction of the picture. */
const MIN_SIDE = 0.02;
/** How close to the picture's edge, or to where the crop started, a drag snaps to it. */
const SNAP = 0.01;

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const near = (value: number, target: number) => (Math.abs(value - target) < SNAP ? target : value);

/**
 * The crop after dragging one edge to the pointer, at (`fx`, `fy`) as fractions of the whole picture.
 * The edge snaps to the picture's sides and to where it was when crop mode began (`entry`).
 */
export function dragCropEdge(rect: CropRect, edge: CropEdge, fx: number, fy: number, entry: CropRect): CropRect {
  const x = clamp01(fx);
  const y = clamp01(fy);
  const next = { ...rect };
  if (edge === 'w') {
    const left = Math.min(x < SNAP ? 0 : near(x, entry.x), rect.x + rect.w - MIN_SIDE);
    next.w = rect.x + rect.w - left;
    next.x = left;
  } else if (edge === 'e') {
    const right = Math.max(x > 1 - SNAP ? 1 : near(x, entry.x + entry.w), rect.x + MIN_SIDE);
    next.w = right - rect.x;
  } else if (edge === 'n') {
    const top = Math.min(y < SNAP ? 0 : near(y, entry.y), rect.y + rect.h - MIN_SIDE);
    next.h = rect.y + rect.h - top;
    next.y = top;
  } else {
    const bottom = Math.max(y > 1 - SNAP ? 1 : near(y, entry.y + entry.h), rect.y + MIN_SIDE);
    next.h = bottom - rect.y;
  }
  return next;
}

/** The crop as the doc keeps it: rounded and inside the picture; null when it keeps the whole picture. */
export function storedCrop(rect: CropRect): CropRect | null {
  const w = Math.min(1, Math.max(0.01, round4(rect.w)));
  const h = Math.min(1, Math.max(0.01, round4(rect.h)));
  const x = Math.min(1 - w, Math.max(0, round4(rect.x)));
  const y = Math.min(1 - h, Math.max(0, round4(rect.y)));
  return w >= 1 && h >= 1 ? null : { x: round4(x), y: round4(y), w, h };
}

export const sameCrop = (a: CropRect | null, b: CropRect | null) => {
  const left = a ?? FULL_CROP;
  const right = b ?? FULL_CROP;
  return round4(left.x) === round4(right.x) && round4(left.y) === round4(right.y) && round4(left.w) === round4(right.w) && round4(left.h) === round4(right.h);
};

/** Narrowest width a drag can give a picture, in pixels. */
export const MIN_IMAGE_WIDTH = 40;

/** A dragged width, kept between {@link MIN_IMAGE_WIDTH} and the room there is. */
export function clampWidth(width: number, room: number): number {
  return Math.round(Math.max(MIN_IMAGE_WIDTH, Math.min(width, Math.max(MIN_IMAGE_WIDTH, room))));
}

/**
 * The width a side handle's drag asks for, from the width at the press and how far the pointer went (`delta`, screen
 * px). A picture sits in its line by the line's `text-align`, so a centered one grows by both sides at once and its
 * edge moves half as far as its width changes: the width changes by as much as keeps the dragged edge under the
 * pointer. A handle on the side that stays put (the left one of a left-aligned picture) changes the width by `delta`.
 */
export function draggedWidth(side: 'e' | 'w', startWidth: number, delta: number, textAlign: string, direction: string): number {
  const rtl = direction === 'rtl';
  const share =
    textAlign === 'center' || textAlign === '-webkit-center'
      ? 0.5
      : textAlign === 'right' || textAlign === '-webkit-right' || (textAlign === 'end' && !rtl) || ((textAlign === 'start' || textAlign === 'justify') && rtl)
        ? 1
        : 0;
  // How far the dragged edge moves for each pixel of width.
  const follows = side === 'e' ? 1 - share : share;
  const grow = side === 'e' ? delta : -delta;
  return startWidth + (follows > 0 ? grow / follows : grow);
}

/**
 * The width that puts a picture's dragged edge at `target` (screen px). `edgeAt` draws the picture at a width and
 * says where that edge then is; the answer starts from `guess` ({@link draggedWidth}) and follows the line through
 * the last two tries, as a picture in a cell that widens with it moves differently from one in a fixed column. Null
 * when the edge does not move as the width changes (it is the side that stays put).
 */
export function widthForEdge(
  target: number,
  edgeAt: (width: number) => number,
  start: { width: number; edge: number },
  guess: number,
  clamp: (width: number) => number,
): number | null {
  let [width, edge] = [start.width, start.edge];
  let next = clamp(guess);
  for (let tries = 0; tries < 4; tries++) {
    const landed = edgeAt(next);
    if (Math.abs(landed - target) < 0.5) return next;
    if (Math.abs(landed - edge) < 0.01) return next === width ? next : null;
    const better = clamp(next + ((target - landed) * (next - width)) / (landed - edge));
    if (better === next) return next;
    [width, edge, next] = [next, landed, better];
  }
  return next;
}

/**
 * The width a picture keeps after a crop: a size name stays (it is a share of the column); otherwise the picture keeps
 * its scale, so it is the whole picture's shown width times the part kept.
 */
export function widthAfterCrop(width: unknown, fullWidth: number, crop: CropRect | null): string | number | null {
  if (sizeOf(width)) return width as ImageSize;
  if (typeof width !== 'number' && !crop) return null;
  return Math.max(MIN_IMAGE_WIDTH, Math.round(fullWidth * (crop ?? FULL_CROP).w));
}

/** A picture's pixel size, read from what the browser decoded: null when it has none. */
export function pixelDims(width: number, height: number): { w: number; h: number } | null {
  const w = Math.round(width);
  const h = Math.round(height);
  return w > 0 && h > 0 && w <= 100000 && h <= 100000 ? { w, h } : null;
}

/** The box an upload's placeholder takes: the picture's own size, no wider than `room`. */
export function placeholderBox(dims: { w: number; h: number } | null, room: number): { w: number; h: number } {
  const source = dims ?? { w: 320, h: 180 };
  const w = Math.max(48, Math.min(source.w, room));
  return { w: Math.round(w), h: Math.max(24, Math.round((w * source.h) / source.w)) };
}
