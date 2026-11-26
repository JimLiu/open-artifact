/**
 * The backdrop a picture needs to stay visible on its tile: `dark` behind a
 * white or knocked-out mark, `light` behind a dark mark drawn on
 * transparency. `null` keeps the page's own checkerboard.
 */

export type AssetTone = 'dark' | 'light';

/** A word in a file name, not part of a longer one (`-`, `_`, `.` and spaces separate). */
const word = (pattern: string): RegExp => new RegExp(`(?<![a-z0-9])(?:${pattern})(?![a-z0-9])`, 'i');

const MEANT_FOR_DARK = word('(?:on|for)[-_ ]?(?:dark|black)');
const MEANT_FOR_LIGHT = word('(?:on|for)[-_ ]?(?:light|white)');
const LIGHT_MARK = word('white|reversed?|inverse|inverted|knockout');

/** What the file name says about the backdrop it was made for. */
export function toneFromName(name: string): AssetTone | null {
  if (MEANT_FOR_DARK.test(name)) return 'dark';
  if (MEANT_FOR_LIGHT.test(name)) return 'light';
  return LIGHT_MARK.test(name) ? 'dark' : null;
}

/** Below this alpha a pixel counts as see-through. */
const CLEAR_ALPHA = 0.9;
/** A picture with less of its area see-through brings its own background. */
const MIN_CLEAR_SHARE = 0.1;
/** Share of the drawn ink, by alpha, that makes a mark dark or light. */
const DARK_INK_SHARE = 0.2;
const LIGHT_INK_SHARE = 0.6;
/** Channel ceiling of a dark pixel, and the relative luminance floor of a light one. */
const DARK_CHANNEL = 90;
const LIGHT_LUMA = 0.8;

/** Judges a small RGBA drawing of the picture (four bytes a pixel). */
export function toneFromPixels(rgba: ArrayLike<number>): AssetTone | null {
  const pixels = Math.floor(rgba.length / 4);
  let ink = 0;
  let darkInk = 0;
  let lightInk = 0;
  let clear = 0;
  for (let p = 0; p < pixels; p++) {
    const r = rgba[p * 4] ?? 0;
    const g = rgba[p * 4 + 1] ?? 0;
    const b = rgba[p * 4 + 2] ?? 0;
    const alpha = (rgba[p * 4 + 3] ?? 0) / 255;
    if (alpha < CLEAR_ALPHA) clear += 1;
    ink += alpha;
    if (Math.max(r, g, b) < DARK_CHANNEL) darkInk += alpha;
    if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 > LIGHT_LUMA) lightInk += alpha;
  }
  if (ink === 0 || clear < pixels * MIN_CLEAR_SHARE) return null;
  if (darkInk / ink > DARK_INK_SHARE) return 'light';
  return lightInk / ink > LIGHT_INK_SHARE ? 'dark' : null;
}

/** Whether a picture's own pixels are worth reading: formats that can be transparent. */
export function canSampleTone(name: string): boolean {
  return !/\.jpe?g$/i.test(name);
}

/** Side of the square the picture is drawn into for {@link sampleTone}. */
const SAMPLE_SIDE = 24;
/** Bitmaps larger than this are not drawn just to pick a backdrop. */
const MAX_SAMPLED_PIXELS = 1_000_000;

/** Draws a loaded picture small and judges it; `null` when it cannot be read (too large, or from elsewhere). */
export function sampleTone(image: HTMLImageElement, vector: boolean): AssetTone | null {
  if (!vector && image.naturalWidth * image.naturalHeight > MAX_SAMPLED_PIXELS) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIDE;
    canvas.height = SAMPLE_SIDE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
    return toneFromPixels(context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data);
  } catch {
    return null;
  }
}
