/**
 * The app's placeholder icon (there is no designed one yet): a rounded square in the library page's blue with a white
 * sheet whose corner is folded, drawn here pixel by pixel at every size an `.icns` holds, written as PNGs (Node's zlib,
 * no image library) and put together with macOS's `iconutil`. Nothing binary is kept in the repository.
 *
 *   node scripts/placeholder-icon.mjs <out.icns>
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
const crc32 = (bytes) => {
  let c = -1;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};

/** An RGBA picture as a PNG file's bytes. */
export function png(width, height, rgba) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0;
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** Inside a rounded rectangle (x0, y0, x1, y1, radius r), in units of the icon's side. */
const inRounded = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** The icon at `size` pixels: 4×4 samples a pixel, so the edges are smooth. */
export function drawIcon(size) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          // macOS icons sit in a 10% margin.
          if (!inRounded(x, y, 0.1, 0.1, 0.9, 0.9, 0.18)) continue;
          // The sheet, with its top-right corner folded.
          const fold = 0.14;
          const onSheet = x >= 0.3 && x <= 0.7 && y >= 0.24 && y <= 0.76 && !(x > 0.7 - fold && y < 0.24 + fold && x - (0.7 - fold) > y - 0.24);
          const onFold = x >= 0.7 - fold && x <= 0.7 && y >= 0.24 && y <= 0.24 + fold && x - (0.7 - fold) <= y - 0.24;
          const line = x >= 0.37 && x <= 0.63 && [0.46, 0.55, 0.64].some((ly) => Math.abs(y - ly) < 0.018) && !(y > 0.6 && x > 0.55);
          let c;
          if (onFold) c = [200, 216, 255];
          else if (onSheet) c = line ? [120, 150, 235] : [255, 255, 255];
          else {
            // The square: blue, a little lighter at the top.
            const t = (y - 0.1) / 0.8;
            c = [Math.round(70 - 30 * t), Math.round(120 - 40 * t), Math.round(255 - 25 * t)];
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

/** Writes the placeholder `.icns` to `file`. */
export function writeIcns(file) {
  const dir = mkdtempSync(join(tmpdir(), 'oa-icon-'));
  try {
    const set = join(dir, 'icon.iconset');
    mkdirSync(set);
    for (const base of [16, 32, 128, 256, 512]) {
      writeFileSync(join(set, `icon_${base}x${base}.png`), drawIcon(base));
      writeFileSync(join(set, `icon_${base}x${base}@2x.png`), drawIcon(base * 2));
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = resolve(process.argv[2] ?? 'icon.icns');
  writeIcns(file);
  console.log(`placeholder icon: ${file}`);
}
