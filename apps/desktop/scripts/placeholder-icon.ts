export interface IconLook {
  tint: string;
  glyph: 'sheet' | 'slide' | 'grid' | 'diamond' | 'swatches' | 'bars' | 'ring' | 'play' | 'window';
}
/**
 * The app's icon: a rounded square in the brand blue with the Open Artifact mark in white (two rounded squares in line,
 * the front one overlapping half of the one behind, a dot in the front one: `plugins/codex/assets/icon.svg`), drawn
 * here pixel by pixel at every size an `.icns` holds, written as PNGs (Node's zlib, no image library) and put together
 * with macOS's `iconutil`. Nothing binary is kept in the repository. The type icons below are still placeholders.
 *
 *   node scripts/placeholder-icon.ts <out.icns>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (bytes: Uint8Array) => {
  let c = -1;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};

/** An RGBA picture as a PNG file's bytes. */
export function png(width: number, height: number, rgba: Buffer) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0;
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Inside a rounded rectangle (x0, y0, x1, y1, radius r), in units of the icon's side. */
const inRounded = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** `#rrggbb` as `[r, g, b]`. */
const rgb = (hex: string) => [0, 2, 4].map((at) => parseInt(hex.slice(1 + at, 3 + at), 16));
const mix = (c: readonly number[], to: readonly number[], t: number) => c.map((v, i) => Math.round(v + (to[i] - v) * t));

/**
 * The icons of artifacts installed as apps (`installed-apps.ts`): one per type, in the type's colour on the library
 * page (`packages/library-page/src/look.tsx`) with a white mark of its own; `default` for a type with none. Placeholders
 * too, like the app's.
 */
export const TYPE_ICONS: Record<string, IconLook> = {
  docs: { tint: '#3f8ef0', glyph: 'sheet' },
  slides: { tint: '#e8703a', glyph: 'slide' },
  sheets: { tint: '#3d9e3a', glyph: 'grid' },
  design: { tint: '#7a5cf0', glyph: 'diamond' },
  'design-system': { tint: '#c79a1b', glyph: 'swatches' },
  data: { tint: '#e5484d', glyph: 'bars' },
  whiteboard: { tint: '#d6409f', glyph: 'ring' },
  motion: { tint: '#14a38b', glyph: 'play' },
  page: { tint: '#5b6b82', glyph: 'window' },
  default: { tint: '#8a8a8a', glyph: 'sheet' },
};

const WHITE = [255, 255, 255];
/** The colour of a type's mark at (x, y), or null off it. `ink`: the lines drawn on the white. */
function glyphAt(glyph: IconLook['glyph'], x: number, y: number, ink: number[], sheet = { fold: mix(WHITE, ink, 0.25), line: ink }) {
  const inBox = (x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  switch (glyph) {
    case 'slide': {
      if (!inBox(0.24, 0.3, 0.76, 0.66)) return x >= 0.47 && x <= 0.53 && y > 0.66 && y <= 0.76 ? WHITE : null;
      return inBox(0.31, 0.38, 0.6, 0.43) || inBox(0.31, 0.49, 0.52, 0.53) ? ink : WHITE;
    }
    case 'grid': {
      if (!inBox(0.26, 0.28, 0.74, 0.72)) return null;
      const line = [0.28, 0.43, 0.57, 0.72].some((v) => Math.abs(y - v) < 0.016) || [0.26, 0.42, 0.58, 0.74].some((v) => Math.abs(x - v) < 0.016);
      return line ? WHITE : y < 0.43 ? mix(WHITE, ink, 0.35) : null;
    }
    case 'diamond':
      return Math.abs(x - 0.5) + Math.abs(y - 0.5) <= 0.24 ? (Math.abs(x - 0.5) + Math.abs(y - 0.5) <= 0.1 ? ink : WHITE) : null;
    case 'swatches': {
      const cells = [
        [0.27, 0.27],
        [0.52, 0.27],
        [0.27, 0.52],
        [0.52, 0.52],
      ];
      const shade = [0, 0.25, 0.5, 0.75];
      for (let k = 0; k < 4; k++) if (inRounded(x, y, cells[k][0], cells[k][1], cells[k][0] + 0.21, cells[k][1] + 0.21, 0.04)) return mix(WHITE, ink, shade[k]);
      return null;
    }
    case 'bars': {
      const bars = [
        [0.27, 0.52],
        [0.42, 0.38],
        [0.57, 0.46],
        [0.72, 0.28],
      ];
      for (const [x0, top] of bars) if (x >= x0 - 0.05 && x <= x0 + 0.05 && y >= top && y <= 0.72) return WHITE;
      return y > 0.735 && y < 0.765 && x > 0.2 && x < 0.8 ? WHITE : null;
    }
    case 'ring': {
      // Shapes on a board: a ring and a square over it.
      if (inRounded(x, y, 0.46, 0.46, 0.74, 0.74, 0.03)) return WHITE;
      const d = Math.hypot(x - 0.4, y - 0.4);
      return d <= 0.15 && d >= 0.1 ? WHITE : null;
    }
    case 'play':
      return x >= 0.36 && x <= 0.7 && Math.abs(y - 0.5) <= (0.7 - x) * 0.72 ? WHITE : null;
    case 'window': {
      if (!inRounded(x, y, 0.24, 0.28, 0.76, 0.72, 0.04)) return null;
      if (y < 0.37) return [0.3, 0.35, 0.4].some((cx) => Math.hypot(x - cx, y - 0.325) < 0.017) ? ink : WHITE;
      return y < 0.395 ? ink : inBox(0.3, 0.45, 0.7, 0.66) ? mix(WHITE, ink, 0.2) : WHITE;
    }
    default: {
      // The sheet, with its top-right corner folded.
      const fold = 0.14;
      const onSheet = x >= 0.3 && x <= 0.7 && y >= 0.24 && y <= 0.76 && !(x > 0.7 - fold && y < 0.24 + fold && x - (0.7 - fold) > y - 0.24);
      const onFold = x >= 0.7 - fold && x <= 0.7 && y >= 0.24 && y <= 0.24 + fold && x - (0.7 - fold) <= y - 0.24;
      const line = x >= 0.37 && x <= 0.63 && [0.46, 0.55, 0.64].some((ly) => Math.abs(y - ly) < 0.018) && !(y > 0.6 && x > 0.55);
      if (onFold) return sheet.fold;
      if (onSheet) return line ? sheet.line : WHITE;
      return null;
    }
  }
}

/** The brand blue of the mark (the plugins' `brandColor`). */
export const BRAND = '#2f5bb7';

/**
 * Whether (u, v), in the units of the mark's 24-unit grid, is on the Open Artifact mark: the lines (`stroke` wide) of a
 * rounded square from 9 to 21, of the one behind it from 3 to 15 where the front one does not cover it, and a dot of
 * radius 2 in the front one, as in `plugins/codex/assets/icon.svg`.
 */
export function onMark(u: number, v: number, stroke = 2) {
  // Signed distance to a rounded square centred on (cx, cy), `half` its half side, `r` its corner radius.
  const square = (cx: number, cy: number, half: number, r: number) => {
    const qx = Math.abs(u - cx) - (half - r);
    const qy = Math.abs(v - cy) - (half - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const front = square(15, 15, 6, 3);
  if (Math.abs(front) <= stroke / 2 || Math.hypot(u - 15, v - 15) <= 2) return true;
  return front > 0 && Math.abs(square(9, 9, 6, 3)) <= stroke / 2;
}

/**
 * The mark alone as a PNG, `ink` on `paper` (a colour, or transparent when left out), the 24-unit grid `scale` of the
 * side wide (0.864 puts its lines at 7% to 93%): the plugins' `icon.png`.
 */
export function drawMark(size: number, { ink = BRAND, paper, scale = 0.864 }: { ink?: string; paper?: string; scale?: number } = {}) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  const fg = rgb(ink);
  const bg = paper ? rgb(paper) : null;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          if (onMark(12 + ((x - 0.5) * 24) / scale, 12 + ((y - 0.5) * 24) / scale)) hits++;
        }
      const t = hits / (S * S);
      const i = (py * size + px) * 4;
      const c = bg ? mix(bg, fg, t) : fg;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = bg ? 255 : Math.round(255 * t);
    }
  }
  return png(size, size, out);
}

/**
 * The icon at `size` pixels: 4×4 samples a pixel, so the edges are smooth. With no `look`, the app's own (the brand
 * blue, the mark in white); `look`: `{ tint, glyph }` (see {@link TYPE_ICONS}).
 */
export function drawIcon(size: number, look?: IconLook) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  const tint = rgb(look?.tint ?? BRAND);
  const top = mix(tint, WHITE, 0.12);
  const bottom = mix(tint, [0, 0, 0], look ? 0.18 : 0.12);
  const ink = mix(tint, [0, 0, 0], 0.1);
  const glyph = look?.glyph ?? 'sheet';
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          // macOS icons sit in a 10% margin.
          if (!inRounded(x, y, 0.1, 0.1, 0.9, 0.9, 0.18)) continue;
          // The mark's 24 units are 0.6 of the side, so its lines sit in the middle 50%.
          let c = look ? glyphAt(glyph, x, y, ink) : onMark(12 + (x - 0.5) * 40, 12 + (y - 0.5) * 40) ? WHITE : null;
          if (!c) {
            // The square: a little lighter at the top.
            const t = (y - 0.1) / 0.8;
            c = mix(top, bottom, t);
          }
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((255 * a) / (S * S));
    }
  }
  return png(size, size, out);
}

/** Writes the `.icns` to `file` (the app's, or with `look` a type's placeholder). */
export function writeIcns(file: string, look?: IconLook) {
  const dir = mkdtempSync(join(tmpdir(), 'oa-icon-'));
  try {
    const set = join(dir, 'icon.iconset');
    mkdirSync(set);
    for (const base of [16, 32, 128, 256, 512]) {
      writeFileSync(join(set, `icon_${base}x${base}.png`), drawIcon(base, look));
      writeFileSync(join(set, `icon_${base}x${base}@2x.png`), drawIcon(base * 2, look));
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return file;
}

/** Writes every type's icon into `dir` (`<type>.icns`, and `default.icns`). */
export function writeTypeIcons(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const [type, look] of Object.entries(TYPE_ICONS)) writeIcns(join(dir, `${type}.icns`), look);
  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = resolve(process.argv[2] ?? 'icon.icns');
  writeIcns(file);
  console.log(`icon: ${file}`);
}
