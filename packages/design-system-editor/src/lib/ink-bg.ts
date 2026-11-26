/**
 * A review background for an asset image, chosen from its ink.
 * Light ink (a white icon) sits on a dark field, dark ink on a light field.
 * Saturated ink keeps a muted version of its own hue, so different colors read apart.
 * Ink that is both very light and very dark keeps a checker, so neither half disappears.
 */

/** Shown until the ink is known, and for files that are not images. */
export const ASSET_CHECKER = 'repeating-conic-gradient(var(--color-surface-2) 0% 25%, var(--color-surface) 0% 50%) 50% / 16px 16px';

const DARK = '#161616';
const LIGHT = '#f3f3f1';
const MIXED = 'repeating-conic-gradient(#2b2b2b 0% 25%, #f3f3f1 0% 50%) 50% / 12px 12px';

export interface InkField {
  mode: 'on-dark' | 'on-light' | 'mixed';
  background: string;
}

function relLum(r: number, g: number, b: number): number {
  const f = (c: number): number => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(y1: number, y2: number): number {
  const a = Math.max(y1, y2);
  const b = Math.min(y1, y2);
  return (a + 0.05) / (b + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h * 12) % 12;
    const color = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * Math.min(1, Math.max(0, color)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function parsePaint(raw: string): [number, number, number] | null {
  const s = raw.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent' || s === 'currentcolor' || s.startsWith('url(')) return null;
  if (s === 'white') return [255, 255, 255];
  if (s === 'black') return [0, 0, 0];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1] ?? '';
    if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    if (alpha < 0.2) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(s);
  if (!m) return null;
  const alpha = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (alpha < 0.2) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Visible paints only. Clip paths, masks and other defs are not ink. */
export function paintsFromSvg(text: string): Array<[number, number, number]> {
  const cleaned = text.replace(/<(defs|clipPath|mask|pattern|symbol|filter)\b[\s\S]*?<\/\1>/gi, '');
  const found: Array<[number, number, number]> = [];
  const add = (raw: string): void => {
    const color = parsePaint(raw);
    if (color) found.push(color);
  };
  for (const match of cleaned.matchAll(/\b(?:fill|stroke)\s*=\s*["']([^"']+)["']/gi)) if (match[1]) add(match[1]);
  for (const match of cleaned.matchAll(/\b(?:fill|stroke)\s*:\s*([^;"']+)/gi)) if (match[1]) add(match[1]);
  return found;
}

/** Repeats each paint so a handful of SVG colors meets the opaque-pixel minimum. */
export function rgbaFromColors(colors: Array<[number, number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(Math.max(colors.length, 1) * 16 * 4);
  colors.forEach((c, i) => {
    for (let n = 0; n < 16; n++) {
      const o = (i * 16 + n) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  });
  return data;
}

/** `data` is flat RGBA. `null` when there is not enough opaque ink to judge. */
export function classifyInk(data: ArrayLike<number>): InkField | null {
  const opaque: Array<[number, number, number]> = [];
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 96) continue;
    opaque.push([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]);
  }
  if (opaque.length < 8) return null;
  const lums = opaque.map(([r, g, b]) => relLum(r, g, b)).sort((a, b) => a - b);
  const p20 = lums[Math.floor(lums.length * 0.2)] ?? 0;
  const p80 = lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.8))] ?? 0;
  if (p20 < 0.22 && p80 > 0.78) return { mode: 'mixed', background: MIXED };

  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of opaque) {
    r += c[0];
    g += c[1];
    b += c[2];
  }
  const n = opaque.length;
  r /= n;
  g /= n;
  b /= n;
  const y = relLum(r, g, b);
  const onDark = contrast(y, relLum(0x16, 0x16, 0x16)) >= contrast(y, relLum(0xf3, 0xf3, 0xf1));
  const [h, s] = rgbToHsl(r, g, b);
  if (s < 0.12) return { mode: onDark ? 'on-dark' : 'on-light', background: onDark ? DARK : LIGHT };
  return { mode: onDark ? 'on-dark' : 'on-light', background: hslToHex(h, Math.min(0.38, s * 0.55), onDark ? 0.16 : 0.94) };
}

function sampleImage(img: HTMLImageElement): InkField | null {
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 72;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 72, 72);
  return classifyInk(ctx.getImageData(0, 0, 72, 72).data);
}

async function resolveInkBackground(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('svg') || /\.svg(?:$|\?)/i.test(url)) {
      const colors = paintsFromSvg(await res.text());
      const fromSvg = colors.length ? classifyInk(rgbaFromColors(colors)) : null;
      if (fromSvg) return fromSvg.background;
    }
  } catch {
    // The image element below is the other way to read the same URL.
  }
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return sampleImage(img)?.background ?? ASSET_CHECKER;
  } catch {
    return ASSET_CHECKER;
  }
}

const cache = new Map<string, Promise<string>>();

/** The CSS `background` for this image URL. Repeated calls share one read. */
export function assetInkBackground(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit) return hit;
  const job = resolveInkBackground(url);
  cache.set(url, job);
  return job;
}
