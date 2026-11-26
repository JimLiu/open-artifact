import assert from 'node:assert/strict';
import { it } from 'node:test';
import { classifyInk, paintsFromSvg, rgbaFromColors } from '../src/lib/ink-bg.ts';

function solid(r: number, g: number, b: number, n = 64): Uint8ClampedArray {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

it('puts white ink on a dark field and black ink on a light field', () => {
  assert.equal(classifyInk(solid(255, 255, 255))?.background, '#161616');
  assert.equal(classifyInk(solid(0, 0, 0))?.background, '#f3f3f1');
});

it('tints a saturated color toward the field that contrasts with it', () => {
  const yellow = classifyInk(solid(255, 220, 40));
  const blue = classifyInk(solid(20, 60, 220));
  assert.equal(yellow?.mode, 'on-dark');
  assert.equal(blue?.mode, 'on-light');
  assert.notEqual(yellow?.background, '#161616');
  assert.notEqual(blue?.background, '#f3f3f1');
});

it('uses a checker when the same image has both very light and very dark ink', () => {
  const data = new Uint8ClampedArray(40 * 4);
  for (let i = 0; i < 40; i++) {
    const c = i < 20 ? [255, 255, 255] : [0, 0, 0];
    data[i * 4] = c[0]!;
    data[i * 4 + 1] = c[1]!;
    data[i * 4 + 2] = c[2]!;
    data[i * 4 + 3] = 255;
  }
  assert.equal(classifyInk(data)?.mode, 'mixed');
});

it('reads a white stroke and ignores the white rect inside a clip path', () => {
  const svg = `<svg fill="none"><path stroke="white"/><defs><clipPath><rect fill="white"/></clipPath></defs></svg>`;
  assert.deepEqual(paintsFromSvg(svg), [[255, 255, 255]]);
  assert.equal(classifyInk(rgbaFromColors(paintsFromSvg(svg)))?.background, '#161616');
});

it('does not guess a background from a few stray pixels', () => {
  assert.equal(classifyInk(solid(255, 255, 255, 4)), null);
});
